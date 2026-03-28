import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = import.meta.dirname;
const entrypoint = readFileSync(join(repoRoot, "docker-entrypoint.sh"), "utf8");

test("docker entrypoint does not derive GEMINI_API_KEY from the ByteRover key", () => {
  assert.equal(entrypoint.includes("GEMINI_API_KEY derived from BYTEROVER_GEMINI_KEY"), false);
  assert.equal(entrypoint.includes('export GEMINI_API_KEY="$BYTEROVER_KEY"'), false);
});
