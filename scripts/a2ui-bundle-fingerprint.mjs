import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const rootDir = process.env.ROOT_DIR ?? process.cwd();
const inputs = process.argv.slice(2);

if (inputs.length === 0) {
  console.error("Usage: node scripts/a2ui-bundle-fingerprint.mjs <path...>");
  process.exit(1);
}

const entries = [];

async function walk(entryPath) {
  const stat = await fs.stat(entryPath);
  const normalizedPath = path.resolve(entryPath);

  if (stat.isDirectory()) {
    const children = await fs.readdir(normalizedPath);
    children.sort((left, right) => left.localeCompare(right));
    for (const child of children) {
      await walk(path.join(normalizedPath, child));
    }
    return;
  }

  entries.push({
    path: normalizedPath,
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
  });
}

function normalize(p) {
  return p.split(path.sep).join("/");
}

for (const input of inputs) {
  await walk(input);
}

entries.sort((left, right) => normalize(left.path).localeCompare(normalize(right.path)));

const hash = createHash("sha256");
for (const entry of entries) {
  const rel = normalize(path.relative(rootDir, entry.path));
  hash.update(rel);
  hash.update("\0");
  hash.update(String(entry.size));
  hash.update("\0");
  hash.update(String(entry.mtimeMs));
  hash.update("\0");
}

process.stdout.write(hash.digest("hex"));
