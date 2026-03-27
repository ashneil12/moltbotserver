export const MODELS_JSON_WRITE_LOCKS = new Map<string, Promise<void>>();

export const MODELS_JSON_READY_CACHE = new Map<
  string,
  Promise<{ fingerprint: string; result: { agentDir: string; wrote: boolean } }>
>();

export function resetModelsJsonReadyCacheForTest(): void {
  MODELS_JSON_READY_CACHE.clear();
}

export function resetModelsJsonStateForTest(): void {
  MODELS_JSON_READY_CACHE.clear();
  MODELS_JSON_WRITE_LOCKS.clear();
}
