/**
 * Re-export barrel for security audit collector functions.
 *
 * Maintains backward compatibility with existing imports from audit-extra.
 * Implementation split into:
 * - audit-extra.sync.ts: Config-based checks (no I/O)
 * - audit-extra.async.ts: Filesystem/plugin checks (async I/O)
 */

// Sync collectors
export {
  collectAttackSurfaceSummaryFindings,
  collectExposureMatrixFindings,
  collectGatewayHttpNoAuthFindings,
  collectGatewayHttpSessionKeyOverrideFindings,
  collectHooksHardeningFindings,
<<<<<<< HEAD
  collectLikelyMultiUserSetupFindings,
  collectMinimalProfileOverrideFindings,
  collectModelHygieneFindings,
  collectNodeDangerousAllowCommandFindings,
  collectNodeDenyCommandPatternFindings,
  collectSandboxDangerousConfigFindings,
=======
  collectMinimalProfileOverrideFindings,
  collectModelHygieneFindings,
  collectNodeDenyCommandPatternFindings,
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)
  collectSandboxDockerNoopFindings,
  collectSecretsInConfigFindings,
  collectSmallModelRiskFindings,
  collectSyncedFolderFindings,
  type SecurityAuditFinding,
} from "./audit-extra.sync.js";

// Async collectors
export {
  collectSandboxBrowserHashLabelFindings,
  collectIncludeFilePermFindings,
  collectInstalledSkillsCodeSafetyFindings,
  collectPluginsCodeSafetyFindings,
  collectPluginsTrustFindings,
  collectStateDeepFilesystemFindings,
  readConfigSnapshotForAudit,
} from "./audit-extra.async.js";
