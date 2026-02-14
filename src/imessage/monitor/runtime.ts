<<<<<<< HEAD
import { createNonExitingRuntime, type RuntimeEnv } from "../../runtime.js";
import { normalizeStringEntries } from "../../shared/string-normalization.js";
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
import type { MonitorIMessageOpts } from "./types.js";
import { createNonExitingRuntime, type RuntimeEnv } from "../../runtime.js";

export function resolveRuntime(opts: MonitorIMessageOpts): RuntimeEnv {
  return opts.runtime ?? createNonExitingRuntime();
}

export function normalizeAllowList(list?: Array<string | number>) {
  return normalizeStringEntries(list);
}
