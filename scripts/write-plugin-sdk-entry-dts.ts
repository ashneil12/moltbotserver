import fs from "node:fs";
import path from "node:path";
import { pluginSdkEntrypoints } from "./lib/plugin-sdk-entries.mjs";

const RUNTIME_SHIMS: Partial<Record<string, string>> = {
  "secret-input-runtime": [
    "export {",
    "  hasConfiguredSecretInput,",
    "  normalizeResolvedSecretInputString,",
    "  normalizeSecretInputString,",
    '} from "./config-runtime.js";',
    "",
  ].join("\n"),
  "webhook-path": [
    "/** Normalize webhook paths into the canonical registry form used by route lookup. */",
    "export function normalizeWebhookPath(raw) {",
    "  const trimmed = raw.trim();",
    "  if (!trimmed) {",
    '    return "/";',
    "  }",
    '  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;',
    '  if (withSlash.length > 1 && withSlash.endsWith("/")) {',
    "    return withSlash.slice(0, -1);",
    "  }",
    "  return withSlash;",
    "}",
    "",
    "/** Resolve the effective webhook path from explicit path, URL, or default fallback. */",
    "export function resolveWebhookPath(params) {",
    "  const trimmedPath = params.webhookPath?.trim();",
    "  if (trimmedPath) {",
    "    return normalizeWebhookPath(trimmedPath);",
    "  }",
    "  if (params.webhookUrl?.trim()) {",
    "    try {",
    "      const parsed = new URL(params.webhookUrl);",
    '      return normalizeWebhookPath(parsed.pathname || "/");',
    "    } catch {",
    "      return null;",
    "    }",
    "  }",
    "  return params.defaultPath ?? null;",
    "}",
    "",
  ].join("\n"),
};

const TYPE_SHIMS: Partial<Record<string, string>> = {
  "secret-input-runtime": [
    "export {",
    "  hasConfiguredSecretInput,",
    "  normalizeResolvedSecretInputString,",
    "  normalizeSecretInputString,",
    '} from "./config-runtime.js";',
    "",
  ].join("\n"),
};

// Keep package exports stable by generating entrypoint declaration shims that
// point back at the shipped source tree. This avoids an extra whole-repo d.ts
// compile pass in `build`, which is disproportionately expensive on slower
// hosts with cold dependency trees.
for (const entry of pluginSdkEntrypoints) {
  const typeOut = path.join(process.cwd(), `dist/plugin-sdk/${entry}.d.ts`);
  fs.mkdirSync(path.dirname(typeOut), { recursive: true });
  fs.writeFileSync(
    typeOut,
    TYPE_SHIMS[entry] ?? `export * from "../../src/plugin-sdk/${entry}.js";\n`,
    "utf8",
  );

  const runtimeShim = RUNTIME_SHIMS[entry];
  if (!runtimeShim) {
    continue;
  }
  const runtimeOut = path.join(process.cwd(), `dist/plugin-sdk/${entry}.js`);
  fs.mkdirSync(path.dirname(runtimeOut), { recursive: true });
  fs.writeFileSync(runtimeOut, runtimeShim, "utf8");
}
