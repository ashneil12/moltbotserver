/**
 * Auto-detect export source and handle ZIP extraction.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ImportSource, NormalizedConversation } from "../types.js";
import { parseChatGptExport } from "./chatgpt.js";
import { parseClaudeExport } from "./claude.js";

type DetectResult = {
  source: ImportSource;
  conversations: NormalizedConversation[];
};

/**
 * Check if a file is a ZIP archive by reading the magic bytes.
 */
function isZipFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    // ZIP magic: PK\x03\x04
    return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  } catch {
    return false;
  }
}

/**
 * Extract conversations.json from a ZIP file.
 * Shells out to the system `unzip` command to avoid bundling a ZIP library.
 */
async function extractJsonFromZip(zipPath: string): Promise<unknown> {
  // Lazy-import to keep startup fast; this is only needed for ZIP files
  const { execFileSync } = await import("node:child_process");

  // Try using `unzip` CLI (available on most systems)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "history-import-"));
  try {
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", tmpDir], {
      timeout: 30_000,
    });

    // Look for conversations.json (ChatGPT) at any depth
    const conversationsPath = findFile(tmpDir, "conversations.json");
    if (conversationsPath) {
      const content = fs.readFileSync(conversationsPath, "utf-8");
      return JSON.parse(content);
    }

    // Look for any JSON file
    const anyJson = findFile(tmpDir, "*.json");
    if (anyJson) {
      const content = fs.readFileSync(anyJson, "utf-8");
      return JSON.parse(content);
    }

    throw new Error("No JSON files found in ZIP archive");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Recursively find a file by name in a directory.
 */
function findFile(dir: string, pattern: string): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(fullPath, pattern);
      if (found) {
        return found;
      }
    } else if (pattern.startsWith("*")) {
      if (entry.name.endsWith(pattern.slice(1))) {
        return fullPath;
      }
    } else if (entry.name === pattern) {
      return fullPath;
    }
  }
  return null;
}

/**
 * Detect the source format of a JSON export by inspecting its structure.
 */
function detectSource(data: unknown): ImportSource {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      throw new Error("Export file contains an empty array");
    }

    const first = data[0];
    if (first && typeof first === "object") {
      // ChatGPT has `mapping` objects in each conversation
      if ("mapping" in first) {
        return "chatgpt";
      }
      // Claude has `chat_messages` arrays
      if ("chat_messages" in first) {
        return "claude";
      }
    }
  }

  // Single object with chat_messages → Claude
  if (data && typeof data === "object" && "chat_messages" in data) {
    return "claude";
  }

  throw new Error(
    "Could not auto-detect export source. Use --source chatgpt or --source claude to specify.",
  );
}

/**
 * Load and parse a chat history export file.
 * Handles both JSON files and ZIP archives (ChatGPT).
 * Auto-detects source if not specified.
 */
export async function loadAndParse(
  filePath: string,
  forcedSource?: ImportSource,
): Promise<DetectResult> {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  let data: unknown;

  if (isZipFile(resolvedPath)) {
    data = await extractJsonFromZip(resolvedPath);
  } else {
    // Size guard: reading files >500MB into memory risks OOM
    const stat = fs.statSync(resolvedPath);
    const MAX_JSON_BYTES = 500 * 1024 * 1024; // 500MB
    if (stat.size > MAX_JSON_BYTES) {
      throw new Error(
        `File is ${(stat.size / (1024 * 1024)).toFixed(0)}MB — too large to load into memory safely. ` +
          `Try extracting the ZIP first and importing the conversations.json directly.`,
      );
    }

    const content = fs.readFileSync(resolvedPath, "utf-8");
    try {
      data = JSON.parse(content);
    } catch {
      throw new Error(`Failed to parse JSON from: ${resolvedPath}`);
    }
  }

  const source = forcedSource ?? detectSource(data);
  let conversations: NormalizedConversation[];

  switch (source) {
    case "chatgpt":
      conversations = parseChatGptExport(data);
      break;
    case "claude":
      conversations = parseClaudeExport(data);
      break;
    default:
      throw new Error(`Unknown source: ${source}`);
  }

  return { source, conversations };
}
