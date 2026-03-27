#!/usr/bin/env bash
# patch-qmd-gemini.sh — Patch QMD runtime defaults
#
# Extends LlamaCpp with GeminiEmbedProxy that overrides embed() / embedBatch()
# to call the Gemini REST API instead of loading a local GGUF model.
# Rerank and query-expansion still use local llama.cpp models.
#
# Defaults llama.cpp to CPU-only. Set QMD_GPU=auto (or a backend such as
# QMD_GPU=vulkan) to opt back into GPU detection/selection.
# Gemini embeddings still require GEMINI_API_KEY and can be disabled with
# QMD_EMBED_PROVIDER=local.
#
# Idempotent — safe to run on every container boot.
# Rollback: restore from .bak file created during patching.
set -euo pipefail

MARKER="__GEMINI_EMBED_PATCHED__"

# ─── Locate QMD source ───────────────────────────────────────────────
QMD_LLM=""
for candidate in \
    /opt/qmd/src/llm.ts \
    /root/.bun/install/global/node_modules/@tobilu/qmd/src/llm.ts; do
  if [ -f "$candidate" ]; then
    QMD_LLM="$candidate"
    break
  fi
done

if [ -z "$QMD_LLM" ]; then
  echo "[patch-qmd-gemini] QMD llm.ts not found — skipping"
  exit 0
fi

# ─── Idempotent check ────────────────────────────────────────────────
if grep -q "$MARKER" "$QMD_LLM" 2>/dev/null; then
  echo "[patch-qmd-gemini] Already patched — skipping"
  exit 0
fi

echo "[patch-qmd-gemini] Patching $QMD_LLM for Gemini embeddings..."

# ─── Backup original (for rollback) ──────────────────────────────────
cp "$QMD_LLM" "${QMD_LLM}.bak"

# ─── Step 1: Append GeminiEmbedProxy class ────────────────────────────
cat >> "$QMD_LLM" << 'GEMINI_CLASS_EOF'

// __GEMINI_EMBED_PATCHED__
// =============================================================================
// Gemini Embedding Proxy — patched by patch-qmd-gemini.sh
// Overrides embed/embedBatch to call Google Gemini text-embedding API.
// Rerank, query expansion, and generation still use local llama.cpp models.
// =============================================================================

const GEMINI_EMBED_API = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_EMBED_MODEL_DEFAULT = "gemini-embedding-2-preview";
const GEMINI_BATCH_LIMIT = 100; // Gemini batch API max per request

async function geminiEmbed(
  texts: string[],
  apiKey: string,
  model: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT"
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  if (!apiKey) {
    process.stderr.write("[gemini-embed] ERROR: GEMINI_API_KEY not set\n");
    return texts.map(() => null);
  }

  const allResults: (number[] | null)[] = [];

  for (let i = 0; i < texts.length; i += GEMINI_BATCH_LIMIT) {
    const batch = texts.slice(i, i + GEMINI_BATCH_LIMIT);
    const url = `${GEMINI_EMBED_API}/models/${model}:batchEmbedContents?key=${apiKey}`;
    const body = {
      requests: batch.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        taskType,
      })),
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (resp.status === 429) {
          const wait = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          process.stderr.write(
            `[gemini-embed] Rate limited, retrying in ${Math.round(wait)}ms...\n`
          );
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "unknown");
          throw new Error(`Gemini embed API ${resp.status}: ${errText}`);
        }

        const data = (await resp.json()) as {
          embeddings?: { values: number[] }[];
        };
        if (!data.embeddings) {
          throw new Error("Gemini response missing embeddings field");
        }

        for (const emb of data.embeddings) {
          allResults.push(emb.values);
        }
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
        }
      }
    }

    if (lastError) {
      process.stderr.write(
        `[gemini-embed] Failed after retries: ${lastError.message}\n`
      );
      for (let j = 0; j < batch.length; j++) allResults.push(null);
    }
  }

  return allResults;
}

export class GeminiEmbedProxy extends LlamaCpp {
  private _geminiKey: string;
  private _geminiModel: string;

  constructor(config: LlamaCppConfig = {}) {
    super(config);
    this._geminiKey = process.env.GEMINI_API_KEY || "";
    this._geminiModel =
      process.env.QMD_GEMINI_EMBED_MODEL || GEMINI_EMBED_MODEL_DEFAULT;
  }

  async embed(
    text: string,
    options?: EmbedOptions
  ): Promise<EmbeddingResult | null> {
    const taskType = options?.isQuery
      ? "RETRIEVAL_QUERY"
      : "RETRIEVAL_DOCUMENT";
    const results = await geminiEmbed(
      [text],
      this._geminiKey,
      this._geminiModel,
      taskType
    );
    const vec = results[0];
    if (!vec) return null;
    return { embedding: vec, model: `gemini/${this._geminiModel}` };
  }

  async embedBatch(texts: string[]): Promise<(EmbeddingResult | null)[]> {
    const results = await geminiEmbed(
      texts,
      this._geminiKey,
      this._geminiModel,
      "RETRIEVAL_DOCUMENT"
    );
    return results.map((vec) =>
      vec ? { embedding: vec, model: `gemini/${this._geminiModel}` } : null
    );
  }
}
GEMINI_CLASS_EOF

# ─── Step 2: Replace getDefaultLlamaCpp() to use Gemini ───────────────
# Uses env var instead of shell interpolation to avoid injection risk.
export QMD_LLM_PATH="$QMD_LLM"
python3 << 'PYEOF'
import os, re, sys

path = os.environ.get("QMD_LLM_PATH", "")
if not path or not os.path.isfile(path):
    print("[patch-qmd-gemini] ERROR: QMD_LLM_PATH not set or invalid")
    sys.exit(1)

with open(path, "r") as f:
    content = f.read()

old_fn = '''export function getDefaultLlamaCpp(): LlamaCpp {
  if (!defaultLlamaCpp) {
    const embedModel = process.env.QMD_EMBED_MODEL;
    defaultLlamaCpp = new LlamaCpp(embedModel ? { embedModel } : {});
  }
  return defaultLlamaCpp;
}'''

new_fn = '''export function getDefaultLlamaCpp(): LlamaCpp {
  if (!defaultLlamaCpp) {
    const gpu = process.env.QMD_GPU || "false";
    const geminiKey = process.env.GEMINI_API_KEY || "";
    const hasDirectGeminiApiKey = geminiKey.startsWith("AIza");
    const useGemini = hasDirectGeminiApiKey && process.env.QMD_EMBED_PROVIDER !== "local";
    const llamaConfig = {
      ...(process.env.QMD_EMBED_MODEL ? { embedModel: process.env.QMD_EMBED_MODEL } : {}),
      gpu: gpu === "false" ? false : gpu,
    };
    if (useGemini) {
      process.stderr.write("[qmd] Using Gemini text-embedding API\\n");
      defaultLlamaCpp = new GeminiEmbedProxy(llamaConfig);
    } else {
      if (geminiKey && !hasDirectGeminiApiKey) {
        process.stderr.write("[qmd] Ignoring GEMINI_API_KEY because it is not a direct Google API key\\n");
      }
      defaultLlamaCpp = new LlamaCpp(llamaConfig);
    }
  }
  return defaultLlamaCpp;
}'''

if old_fn in content:
    content = content.replace(old_fn, new_fn, 1)
    with open(path, "w") as f:
        f.write(content)
    print("[patch-qmd-gemini] getDefaultLlamaCpp() patched for Gemini")
else:
    # Regex fallback for minor formatting differences
    pattern = r'export function getDefaultLlamaCpp\(\): LlamaCpp \{.*?return defaultLlamaCpp;\n\}'
    if re.search(pattern, content, re.DOTALL):
        content = re.sub(pattern, new_fn, content, count=1, flags=re.DOTALL)
        with open(path, "w") as f:
            f.write(content)
        print("[patch-qmd-gemini] getDefaultLlamaCpp() patched (regex fallback)")
    else:
        print("[patch-qmd-gemini] FATAL: Could not find getDefaultLlamaCpp()")
        sys.exit(1)
PYEOF

echo "[patch-qmd-gemini] ✅ QMD patched for Gemini embeddings"
