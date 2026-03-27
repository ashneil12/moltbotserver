import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

const repoRoot = import.meta.dirname;
const entrypoint = readFileSync(join(repoRoot, "docker-entrypoint.sh"), "utf8");
const qmdPatch = readFileSync(join(repoRoot, "scripts/patch-qmd-gemini.sh"), "utf8");

test("docker entrypoint does not derive GEMINI_API_KEY from the ByteRover key", () => {
  assert.equal(entrypoint.includes("GEMINI_API_KEY derived from BYTEROVER_GEMINI_KEY"), false);
  assert.equal(entrypoint.includes('export GEMINI_API_KEY="$BYTEROVER_KEY"'), false);
});

test("docker entrypoint patches QMD before the pre-warm status run", () => {
  const patchIndex = entrypoint.indexOf('bash "$PATCH_SCRIPT"');
  const prewarmIndex = entrypoint.indexOf('echo "[entrypoint] qmd pre-warm');
  assert.ok(patchIndex > -1);
  assert.ok(prewarmIndex > -1);
  assert.ok(patchIndex < prewarmIndex);
});

test("QMD patch forces CPU-only llama.cpp unless explicitly overridden", () => {
  assert.ok(qmdPatch.includes('const gpu = process.env.QMD_GPU || "false";'));
  assert.ok(qmdPatch.includes('gpu === "false" ? false : gpu'));
});

test("QMD patch only enables Gemini embeddings for direct Google API keys", () => {
  assert.ok(qmdPatch.includes('const geminiKey = process.env.GEMINI_API_KEY || "";'));
  assert.ok(qmdPatch.includes('const hasDirectGeminiApiKey = geminiKey.startsWith("AIza");'));
  assert.ok(qmdPatch.includes("const useGemini = hasDirectGeminiApiKey && process.env.QMD_EMBED_PROVIDER !== \"local\";"));
});
