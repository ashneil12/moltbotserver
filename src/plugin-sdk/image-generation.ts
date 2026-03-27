// Public image-generation helpers and types for provider plugins.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageGenerationProvider } from "../image-generation/types.js";

export type {
  GeneratedImageAsset,
  ImageGenerationProvider,
  ImageGenerationResolution,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageGenerationSourceImage,
} from "../image-generation/types.js";

const require = createRequire(import.meta.url);
const currentFilePath = fileURLToPath(import.meta.url);
const runningFromDist = currentFilePath.includes(`${path.sep}dist${path.sep}`);

function isModuleNotFoundForPath(error: unknown, modulePath: string): boolean {
  if (!(error instanceof Error) || "code" in error === false) {
    return false;
  }
  const maybeCode = (error as Error & { code?: unknown }).code;
  if (maybeCode !== "MODULE_NOT_FOUND") {
    return false;
  }
  return error.message.includes(modulePath);
}

function findPackageRoot(startFilePath: string): string {
  let currentDir = path.dirname(startFilePath);
  while (true) {
    if (fs.existsSync(path.join(currentDir, "package.json"))) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to locate package root from ${startFilePath}`);
    }
    currentDir = parentDir;
  }
}

const packageRoot = findPackageRoot(currentFilePath);

function loadProviderBuilder<TFactory extends () => ImageGenerationProvider>(
  relativeModulePath: string,
  exportName: string,
): TFactory {
  const sourceModulePath = path.join(packageRoot, relativeModulePath);
  const distModulePath = path
    .join(packageRoot, "dist", relativeModulePath)
    .replace(/\.ts$/u, ".js");
  const modulePaths = runningFromDist
    ? [distModulePath, sourceModulePath.replace(/\.ts$/u, ".js"), sourceModulePath]
    : [sourceModulePath.replace(/\.ts$/u, ".js"), sourceModulePath, distModulePath];
  let lastError: unknown;
  for (const modulePath of modulePaths) {
    try {
      return require(modulePath)[exportName] as TFactory;
    } catch (error) {
      if (!isModuleNotFoundForPath(error, modulePath)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to load ${exportName}`);
}

// Keep provider builders sync for plugin authors while avoiding a heavyweight
// static import graph on the tiny root SDK surface and d.ts build.
export function buildFalImageGenerationProvider(): ImageGenerationProvider {
  return loadProviderBuilder<() => ImageGenerationProvider>(
    "extensions/fal/image-generation-provider.ts",
    "buildFalImageGenerationProvider",
  )();
}

export function buildGoogleImageGenerationProvider(): ImageGenerationProvider {
  return loadProviderBuilder<() => ImageGenerationProvider>(
    "extensions/google/image-generation-provider.ts",
    "buildGoogleImageGenerationProvider",
  )();
}

export function buildOpenAIImageGenerationProvider(): ImageGenerationProvider {
  return loadProviderBuilder<() => ImageGenerationProvider>(
    "extensions/openai/image-generation-provider.ts",
    "buildOpenAIImageGenerationProvider",
  )();
}
