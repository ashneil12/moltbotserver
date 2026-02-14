<<<<<<< HEAD
import path from "node:path";
=======
import fs from "node:fs";
import path from "node:path";
import type { ExecAllowlistEntry } from "./exec-approvals.js";
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
import {
  DEFAULT_SAFE_BINS,
  analyzeShellCommand,
  isWindowsPlatform,
  matchAllowlist,
  resolveAllowlistCandidatePath,
<<<<<<< HEAD
  resolveCommandResolutionFromArgv,
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  splitCommandChain,
  type ExecCommandAnalysis,
  type CommandResolution,
  type ExecCommandSegment,
} from "./exec-approvals-analysis.js";
<<<<<<< HEAD
import type { ExecAllowlistEntry } from "./exec-approvals.js";
import {
  SAFE_BIN_PROFILES,
  type SafeBinProfile,
  validateSafeBinArgv,
} from "./exec-safe-bin-policy.js";
import { isTrustedSafeBinPath } from "./exec-safe-bin-trust.js";
import {
  extractShellWrapperInlineCommand,
  isDispatchWrapperExecutable,
  isShellWrapperExecutable,
  unwrapKnownShellMultiplexerInvocation,
  unwrapKnownDispatchWrapperInvocation,
} from "./exec-wrapper-resolution.js";

function hasShellLineContinuation(command: string): boolean {
  return /\\(?:\r\n|\n|\r)/.test(command);
=======

function isPathLikeToken(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed === "-") {
    return false;
  }
  if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("~")) {
    return true;
  }
  if (trimmed.startsWith("/")) {
    return true;
  }
  return /^[A-Za-z]:[\\/]/.test(trimmed);
}

function defaultFileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
}

export function normalizeSafeBins(entries?: string[]): Set<string> {
  if (!Array.isArray(entries)) {
    return new Set();
  }
  const normalized = entries
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return new Set(normalized);
}

export function resolveSafeBins(entries?: string[] | null): Set<string> {
  if (entries === undefined) {
    return normalizeSafeBins(DEFAULT_SAFE_BINS);
  }
  return normalizeSafeBins(entries ?? []);
}

export function isSafeBinUsage(params: {
  argv: string[];
  resolution: CommandResolution | null;
  safeBins: Set<string>;
<<<<<<< HEAD
  platform?: string | null;
  trustedSafeBinDirs?: ReadonlySet<string>;
  safeBinProfiles?: Readonly<Record<string, SafeBinProfile>>;
  isTrustedSafeBinPathFn?: typeof isTrustedSafeBinPath;
}): boolean {
  // Windows host exec uses PowerShell, which has different parsing/expansion rules.
  // Keep safeBins conservative there (require explicit allowlist entries).
  if (isWindowsPlatform(params.platform ?? process.platform)) {
    return false;
  }
=======
  cwd?: string;
  fileExists?: (filePath: string) => boolean;
}): boolean {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  if (params.safeBins.size === 0) {
    return false;
  }
  const resolution = params.resolution;
  const execName = resolution?.executableName?.toLowerCase();
  if (!execName) {
    return false;
  }
<<<<<<< HEAD
  const matchesSafeBin = params.safeBins.has(execName);
=======
  const matchesSafeBin =
    params.safeBins.has(execName) ||
    (process.platform === "win32" && params.safeBins.has(path.parse(execName).name));
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  if (!matchesSafeBin) {
    return false;
  }
  if (!resolution?.resolvedPath) {
    return false;
  }
<<<<<<< HEAD
  const isTrustedPath = params.isTrustedSafeBinPathFn ?? isTrustedSafeBinPath;
  if (
    !isTrustedPath({
      resolvedPath: resolution.resolvedPath,
      trustedDirs: params.trustedSafeBinDirs,
    })
  ) {
    return false;
  }
  const argv = params.argv.slice(1);
  const safeBinProfiles = params.safeBinProfiles ?? SAFE_BIN_PROFILES;
  const profile = safeBinProfiles[execName];
  if (!profile) {
    return false;
  }
  return validateSafeBinArgv(argv, profile);
}

function isPathScopedExecutableToken(token: string): boolean {
  return token.includes("/") || token.includes("\\");
=======
  const cwd = params.cwd ?? process.cwd();
  const exists = params.fileExists ?? defaultFileExists;
  const argv = params.argv.slice(1);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) {
      continue;
    }
    if (token === "-") {
      continue;
    }
    if (token.startsWith("-")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex > 0) {
        const value = token.slice(eqIndex + 1);
        if (value && (isPathLikeToken(value) || exists(path.resolve(cwd, value)))) {
          return false;
        }
      }
      continue;
    }
    if (isPathLikeToken(token)) {
      return false;
    }
    if (exists(path.resolve(cwd, token))) {
      return false;
    }
  }
  return true;
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
}

export type ExecAllowlistEvaluation = {
  allowlistSatisfied: boolean;
  allowlistMatches: ExecAllowlistEntry[];
<<<<<<< HEAD
  segmentSatisfiedBy: ExecSegmentSatisfiedBy[];
};

export type ExecSegmentSatisfiedBy = "allowlist" | "safeBins" | "skills" | null;
export type SkillBinTrustEntry = {
  name: string;
  resolvedPath: string;
};

function normalizeSkillBinName(value: string | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function normalizeSkillBinResolvedPath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const resolved = path.resolve(trimmed);
  if (process.platform === "win32") {
    return resolved.replace(/\\/g, "/").toLowerCase();
  }
  return resolved;
}

function buildSkillBinTrustIndex(
  entries: readonly SkillBinTrustEntry[] | undefined,
): Map<string, Set<string>> {
  const trustByName = new Map<string, Set<string>>();
  if (!entries || entries.length === 0) {
    return trustByName;
  }
  for (const entry of entries) {
    const name = normalizeSkillBinName(entry.name);
    const resolvedPath = normalizeSkillBinResolvedPath(entry.resolvedPath);
    if (!name || !resolvedPath) {
      continue;
    }
    const paths = trustByName.get(name) ?? new Set<string>();
    paths.add(resolvedPath);
    trustByName.set(name, paths);
  }
  return trustByName;
}

function isSkillAutoAllowedSegment(params: {
  segment: ExecCommandSegment;
  allowSkills: boolean;
  skillBinTrust: ReadonlyMap<string, ReadonlySet<string>>;
}): boolean {
  if (!params.allowSkills) {
    return false;
  }
  const resolution = params.segment.resolution;
  if (!resolution?.resolvedPath) {
    return false;
  }
  const rawExecutable = resolution.rawExecutable?.trim() ?? "";
  if (!rawExecutable || isPathScopedExecutableToken(rawExecutable)) {
    return false;
  }
  const executableName = normalizeSkillBinName(resolution.executableName);
  const resolvedPath = normalizeSkillBinResolvedPath(resolution.resolvedPath);
  if (!executableName || !resolvedPath) {
    return false;
  }
  return Boolean(params.skillBinTrust.get(executableName)?.has(resolvedPath));
}

=======
};

>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
function evaluateSegments(
  segments: ExecCommandSegment[],
  params: {
    allowlist: ExecAllowlistEntry[];
    safeBins: Set<string>;
<<<<<<< HEAD
    safeBinProfiles?: Readonly<Record<string, SafeBinProfile>>;
    cwd?: string;
    platform?: string | null;
    trustedSafeBinDirs?: ReadonlySet<string>;
    skillBins?: readonly SkillBinTrustEntry[];
    autoAllowSkills?: boolean;
  },
): {
  satisfied: boolean;
  matches: ExecAllowlistEntry[];
  segmentSatisfiedBy: ExecSegmentSatisfiedBy[];
} {
  const matches: ExecAllowlistEntry[] = [];
  const skillBinTrust = buildSkillBinTrustIndex(params.skillBins);
  const allowSkills = params.autoAllowSkills === true && skillBinTrust.size > 0;
  const segmentSatisfiedBy: ExecSegmentSatisfiedBy[] = [];

  const satisfied = segments.every((segment) => {
    if (segment.resolution?.policyBlocked === true) {
      segmentSatisfiedBy.push(null);
      return false;
    }
    const effectiveArgv =
      segment.resolution?.effectiveArgv && segment.resolution.effectiveArgv.length > 0
        ? segment.resolution.effectiveArgv
        : segment.argv;
=======
    cwd?: string;
    skillBins?: Set<string>;
    autoAllowSkills?: boolean;
  },
): { satisfied: boolean; matches: ExecAllowlistEntry[] } {
  const matches: ExecAllowlistEntry[] = [];
  const allowSkills = params.autoAllowSkills === true && (params.skillBins?.size ?? 0) > 0;

  const satisfied = segments.every((segment) => {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    const candidatePath = resolveAllowlistCandidatePath(segment.resolution, params.cwd);
    const candidateResolution =
      candidatePath && segment.resolution
        ? { ...segment.resolution, resolvedPath: candidatePath }
        : segment.resolution;
    const match = matchAllowlist(params.allowlist, candidateResolution);
    if (match) {
      matches.push(match);
    }
    const safe = isSafeBinUsage({
<<<<<<< HEAD
      argv: effectiveArgv,
      resolution: segment.resolution,
      safeBins: params.safeBins,
      safeBinProfiles: params.safeBinProfiles,
      platform: params.platform,
      trustedSafeBinDirs: params.trustedSafeBinDirs,
    });
    const skillAllow = isSkillAutoAllowedSegment({
      segment,
      allowSkills,
      skillBinTrust,
    });
    const by: ExecSegmentSatisfiedBy = match
      ? "allowlist"
      : safe
        ? "safeBins"
        : skillAllow
          ? "skills"
          : null;
    segmentSatisfiedBy.push(by);
    return Boolean(by);
  });

  return { satisfied, matches, segmentSatisfiedBy };
}

function resolveAnalysisSegmentGroups(analysis: ExecCommandAnalysis): ExecCommandSegment[][] {
  if (analysis.chains) {
    return analysis.chains;
  }
  return [analysis.segments];
=======
      argv: segment.argv,
      resolution: segment.resolution,
      safeBins: params.safeBins,
      cwd: params.cwd,
    });
    const skillAllow =
      allowSkills && segment.resolution?.executableName
        ? params.skillBins?.has(segment.resolution.executableName)
        : false;
    return Boolean(match || safe || skillAllow);
  });

  return { satisfied, matches };
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
}

export function evaluateExecAllowlist(params: {
  analysis: ExecCommandAnalysis;
  allowlist: ExecAllowlistEntry[];
  safeBins: Set<string>;
<<<<<<< HEAD
  safeBinProfiles?: Readonly<Record<string, SafeBinProfile>>;
  cwd?: string;
  platform?: string | null;
  trustedSafeBinDirs?: ReadonlySet<string>;
  skillBins?: readonly SkillBinTrustEntry[];
  autoAllowSkills?: boolean;
}): ExecAllowlistEvaluation {
  const allowlistMatches: ExecAllowlistEntry[] = [];
  const segmentSatisfiedBy: ExecSegmentSatisfiedBy[] = [];
  if (!params.analysis.ok || params.analysis.segments.length === 0) {
    return { allowlistSatisfied: false, allowlistMatches, segmentSatisfiedBy };
  }

  const hasChains = Boolean(params.analysis.chains);
  for (const group of resolveAnalysisSegmentGroups(params.analysis)) {
    const result = evaluateSegments(group, {
      allowlist: params.allowlist,
      safeBins: params.safeBins,
      safeBinProfiles: params.safeBinProfiles,
      cwd: params.cwd,
      platform: params.platform,
      trustedSafeBinDirs: params.trustedSafeBinDirs,
      skillBins: params.skillBins,
      autoAllowSkills: params.autoAllowSkills,
    });
    if (!result.satisfied) {
      if (!hasChains) {
        return {
          allowlistSatisfied: false,
          allowlistMatches: result.matches,
          segmentSatisfiedBy: result.segmentSatisfiedBy,
        };
      }
      return { allowlistSatisfied: false, allowlistMatches: [], segmentSatisfiedBy: [] };
    }
    allowlistMatches.push(...result.matches);
    segmentSatisfiedBy.push(...result.segmentSatisfiedBy);
  }
  return { allowlistSatisfied: true, allowlistMatches, segmentSatisfiedBy };
=======
  cwd?: string;
  skillBins?: Set<string>;
  autoAllowSkills?: boolean;
}): ExecAllowlistEvaluation {
  const allowlistMatches: ExecAllowlistEntry[] = [];
  if (!params.analysis.ok || params.analysis.segments.length === 0) {
    return { allowlistSatisfied: false, allowlistMatches };
  }

  // If the analysis contains chains, evaluate each chain part separately
  if (params.analysis.chains) {
    for (const chainSegments of params.analysis.chains) {
      const result = evaluateSegments(chainSegments, {
        allowlist: params.allowlist,
        safeBins: params.safeBins,
        cwd: params.cwd,
        skillBins: params.skillBins,
        autoAllowSkills: params.autoAllowSkills,
      });
      if (!result.satisfied) {
        return { allowlistSatisfied: false, allowlistMatches: [] };
      }
      allowlistMatches.push(...result.matches);
    }
    return { allowlistSatisfied: true, allowlistMatches };
  }

  // No chains, evaluate all segments together
  const result = evaluateSegments(params.analysis.segments, {
    allowlist: params.allowlist,
    safeBins: params.safeBins,
    cwd: params.cwd,
    skillBins: params.skillBins,
    autoAllowSkills: params.autoAllowSkills,
  });
  return { allowlistSatisfied: result.satisfied, allowlistMatches: result.matches };
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
}

export type ExecAllowlistAnalysis = {
  analysisOk: boolean;
  allowlistSatisfied: boolean;
  allowlistMatches: ExecAllowlistEntry[];
  segments: ExecCommandSegment[];
<<<<<<< HEAD
  segmentSatisfiedBy: ExecSegmentSatisfiedBy[];
};

function hasSegmentExecutableMatch(
  segment: ExecCommandSegment,
  predicate: (token: string) => boolean,
): boolean {
  const candidates = [
    segment.resolution?.executableName,
    segment.resolution?.rawExecutable,
    segment.argv[0],
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      continue;
    }
    if (predicate(trimmed)) {
      return true;
    }
  }
  return false;
}

function isShellWrapperSegment(segment: ExecCommandSegment): boolean {
  return hasSegmentExecutableMatch(segment, isShellWrapperExecutable);
}

function isDispatchWrapperSegment(segment: ExecCommandSegment): boolean {
  return hasSegmentExecutableMatch(segment, isDispatchWrapperExecutable);
}

function collectAllowAlwaysPatterns(params: {
  segment: ExecCommandSegment;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string | null;
  depth: number;
  out: Set<string>;
}) {
  if (params.depth >= 3) {
    return;
  }

  if (isDispatchWrapperSegment(params.segment)) {
    const dispatchUnwrap = unwrapKnownDispatchWrapperInvocation(params.segment.argv);
    if (dispatchUnwrap.kind !== "unwrapped" || dispatchUnwrap.argv.length === 0) {
      return;
    }
    collectAllowAlwaysPatterns({
      segment: {
        raw: dispatchUnwrap.argv.join(" "),
        argv: dispatchUnwrap.argv,
        resolution: resolveCommandResolutionFromArgv(dispatchUnwrap.argv, params.cwd, params.env),
      },
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
      depth: params.depth + 1,
      out: params.out,
    });
    return;
  }

  const shellMultiplexerUnwrap = unwrapKnownShellMultiplexerInvocation(params.segment.argv);
  if (shellMultiplexerUnwrap.kind === "blocked") {
    return;
  }
  if (shellMultiplexerUnwrap.kind === "unwrapped") {
    collectAllowAlwaysPatterns({
      segment: {
        raw: shellMultiplexerUnwrap.argv.join(" "),
        argv: shellMultiplexerUnwrap.argv,
        resolution: resolveCommandResolutionFromArgv(
          shellMultiplexerUnwrap.argv,
          params.cwd,
          params.env,
        ),
      },
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
      depth: params.depth + 1,
      out: params.out,
    });
    return;
  }

  const candidatePath = resolveAllowlistCandidatePath(params.segment.resolution, params.cwd);
  if (!candidatePath) {
    return;
  }
  if (!isShellWrapperSegment(params.segment)) {
    params.out.add(candidatePath);
    return;
  }
  const inlineCommand = extractShellWrapperInlineCommand(params.segment.argv);
  if (!inlineCommand) {
    return;
  }
  const nested = analyzeShellCommand({
    command: inlineCommand,
    cwd: params.cwd,
    env: params.env,
    platform: params.platform,
  });
  if (!nested.ok) {
    return;
  }
  for (const nestedSegment of nested.segments) {
    collectAllowAlwaysPatterns({
      segment: nestedSegment,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
      depth: params.depth + 1,
      out: params.out,
    });
  }
}

/**
 * Derive persisted allowlist patterns for an "allow always" decision.
 * When a command is wrapped in a shell (for example `zsh -lc "<cmd>"`),
 * persist the inner executable(s) rather than the shell binary.
 */
export function resolveAllowAlwaysPatterns(params: {
  segments: ExecCommandSegment[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string | null;
}): string[] {
  const patterns = new Set<string>();
  for (const segment of params.segments) {
    collectAllowAlwaysPatterns({
      segment,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
      depth: 0,
      out: patterns,
    });
  }
  return Array.from(patterns);
}

=======
};

>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
/**
 * Evaluates allowlist for shell commands (including &&, ||, ;) and returns analysis metadata.
 */
export function evaluateShellAllowlist(params: {
  command: string;
  allowlist: ExecAllowlistEntry[];
  safeBins: Set<string>;
<<<<<<< HEAD
  safeBinProfiles?: Readonly<Record<string, SafeBinProfile>>;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  trustedSafeBinDirs?: ReadonlySet<string>;
  skillBins?: readonly SkillBinTrustEntry[];
  autoAllowSkills?: boolean;
  platform?: string | null;
}): ExecAllowlistAnalysis {
  const analysisFailure = (): ExecAllowlistAnalysis => ({
    analysisOk: false,
    allowlistSatisfied: false,
    allowlistMatches: [],
    segments: [],
    segmentSatisfiedBy: [],
  });

  // Keep allowlist analysis conservative: line-continuation semantics are shell-dependent
  // and can rewrite token boundaries at runtime.
  if (hasShellLineContinuation(params.command)) {
    return analysisFailure();
  }

=======
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  skillBins?: Set<string>;
  autoAllowSkills?: boolean;
  platform?: string | null;
}): ExecAllowlistAnalysis {
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  const chainParts = isWindowsPlatform(params.platform) ? null : splitCommandChain(params.command);
  if (!chainParts) {
    const analysis = analyzeShellCommand({
      command: params.command,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
    });
    if (!analysis.ok) {
<<<<<<< HEAD
      return analysisFailure();
=======
      return {
        analysisOk: false,
        allowlistSatisfied: false,
        allowlistMatches: [],
        segments: [],
      };
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    }
    const evaluation = evaluateExecAllowlist({
      analysis,
      allowlist: params.allowlist,
      safeBins: params.safeBins,
<<<<<<< HEAD
      safeBinProfiles: params.safeBinProfiles,
      cwd: params.cwd,
      platform: params.platform,
      trustedSafeBinDirs: params.trustedSafeBinDirs,
=======
      cwd: params.cwd,
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      skillBins: params.skillBins,
      autoAllowSkills: params.autoAllowSkills,
    });
    return {
      analysisOk: true,
      allowlistSatisfied: evaluation.allowlistSatisfied,
      allowlistMatches: evaluation.allowlistMatches,
      segments: analysis.segments,
<<<<<<< HEAD
      segmentSatisfiedBy: evaluation.segmentSatisfiedBy,
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    };
  }

  const allowlistMatches: ExecAllowlistEntry[] = [];
  const segments: ExecCommandSegment[] = [];
<<<<<<< HEAD
  const segmentSatisfiedBy: ExecSegmentSatisfiedBy[] = [];
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

  for (const part of chainParts) {
    const analysis = analyzeShellCommand({
      command: part,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
    });
    if (!analysis.ok) {
<<<<<<< HEAD
      return analysisFailure();
=======
      return {
        analysisOk: false,
        allowlistSatisfied: false,
        allowlistMatches: [],
        segments: [],
      };
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    }

    segments.push(...analysis.segments);
    const evaluation = evaluateExecAllowlist({
      analysis,
      allowlist: params.allowlist,
      safeBins: params.safeBins,
<<<<<<< HEAD
      safeBinProfiles: params.safeBinProfiles,
      cwd: params.cwd,
      platform: params.platform,
      trustedSafeBinDirs: params.trustedSafeBinDirs,
=======
      cwd: params.cwd,
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      skillBins: params.skillBins,
      autoAllowSkills: params.autoAllowSkills,
    });
    allowlistMatches.push(...evaluation.allowlistMatches);
<<<<<<< HEAD
    segmentSatisfiedBy.push(...evaluation.segmentSatisfiedBy);
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
    if (!evaluation.allowlistSatisfied) {
      return {
        analysisOk: true,
        allowlistSatisfied: false,
        allowlistMatches,
        segments,
<<<<<<< HEAD
        segmentSatisfiedBy,
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
      };
    }
  }

  return {
    analysisOk: true,
    allowlistSatisfied: true,
    allowlistMatches,
    segments,
<<<<<<< HEAD
    segmentSatisfiedBy,
=======
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  };
}
