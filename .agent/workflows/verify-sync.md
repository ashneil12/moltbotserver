---
description: Post-sync verification gate — run after every build/push to catch regressions early
---

# Verify Upstream Sync

Run this workflow **after conflict resolution, before `git push`** to catch regressions from upstream changes. This is the missing link between `/update-openclaw` Phase 5 and Phase 6.

> [!IMPORTANT]
> All 4 gates must pass before pushing. A failure in any gate means the sync introduced a regression.

// turbo-all

---

## Gate 1 — Conflict Marker Sweep

Scan for leftover `<<<<<<<` markers that slipped through conflict resolution.

```bash
cd /Users/ash/Documents/MoltBotServers/moltbotserver-source
echo "=== Gate 1: Conflict Marker Sweep ==="
CONFLICTS=$(grep -rl '<<<<<<< HEAD' --include='*.ts' --include='*.json' --include='*.md' --include='*.sh' --include='*.yml' --include='*.mjs' -r . | grep -v node_modules | grep -v .git || true)
if [ -n "$CONFLICTS" ]; then
  echo "❌ FAIL — Leftover conflict markers found in:"
  echo "$CONFLICTS"
  exit 1
else
  echo "✅ PASS — No conflict markers found"
fi
```

---

## Gate 2 — Local Patch Verification

Verify all critical local modifications survived the rebase. These grep checks come from `LOCAL_PATCHES.md` and the Post-Sync Checklist in `OPENCLAW_CONTEXT.md`.

```bash
cd /Users/ash/Documents/MoltBotServers/moltbotserver-source
echo "=== Gate 2: Local Patch Verification ==="
FAIL=0

check() {
  local desc="$1" cmd="$2" expect="$3"
  result=$(eval "$cmd" 2>/dev/null || echo "0")
  if [ "$result" -ge "$expect" ] 2>/dev/null; then
    echo "  ✅ $desc"
  else
    echo "  ❌ $desc (expected ≥$expect, got $result)"
    FAIL=1
  fi
}

check_exists() {
  local desc="$1" path="$2"
  if [ -e "$path" ]; then
    echo "  ✅ $desc"
  else
    echo "  ❌ $desc ($path missing)"
    FAIL=1
  fi
}

check_match() {
  local desc="$1" cmd="$2" expect="$3"
  result=$(eval "$cmd" 2>/dev/null || echo "")
  if echo "$result" | grep -q "$expect"; then
    echo "  ✅ $desc"
  else
    echo "  ❌ $desc (expected to find '$expect')"
    FAIL=1
  fi
}

check_not_match() {
  local desc="$1" cmd="$2" bad="$3"
  result=$(eval "$cmd" 2>/dev/null || echo "")
  if echo "$result" | grep -q "$bad"; then
    echo "  ❌ $desc (found '$bad' — this was removed by the fix)"
    FAIL=1
  else
    echo "  ✅ $desc"
  fi
}

echo ""
echo "--- Bootstrap Ritual Fix (CRITICAL — reverted by upstream syncs twice) ---"
# The isBrandNewWorkspace check was replaced with isFirstEnsureRun in commit b6b9e12cc8.
# Upstreams syncs have reverted this twice. These checks lock in the fix.
check "isFirstEnsureRun present in workspace.ts" "grep -c 'isFirstEnsureRun' src/agents/workspace.ts" 2
check "stateFileExists check present" "grep -c 'stateFileExists' src/agents/workspace.ts" 1
check_not_match "isBrandNewWorkspace removed from workspace.ts" "grep -c 'isBrandNewWorkspace' src/agents/workspace.ts" "[^0]"
check_not_match "hasUserContent heuristic removed" "grep 'hasUserContent' src/agents/workspace.ts" "hasUserContent"
check "BOOTSTRAP.md entrypoint seeding present" "grep -c 'BOOTSTRAP_TEMPLATE' docker-entrypoint.sh" 1
check "Entrypoint bootstrap guard present" "grep -c 'SETUP_COMPLETED' docker-entrypoint.sh" 1
check "Bootstrap regression test file exists" "test -f src/agents/workspace.bootstrap-entrypoint.test.ts && echo 1 || echo 0" 1

echo ""
echo "--- Critical Browser Patches (LOCAL_PATCHES.md) ---"
check "CDP Host header fix" "grep -c 'httpRequestWithHostOverride' src/browser/cdp.helpers.ts" 1
check "fetchChromeVersion fix" "grep -c 'fetchJson<ChromeVersion>' src/browser/chrome.ts" 1
check_exists "CDP proxy script" "scripts/cdp-host-proxy.py"
check "sandbox-browser entrypoint CDP" "grep -c 'CDP_PROXY_SCRIPT' scripts/sandbox-browser-entrypoint.sh" 1
check "Dockerfile.sandbox-browser CDP" "grep -c 'cdp-host-proxy' Dockerfile.sandbox-browser" 1
check "Sandbox browser wiring" "grep -c 'handleSandboxBrowserRequest' src/gateway/server-http.ts" 1
check "Browser tool agent routing" "grep -c 'agentId.*resolveSessionAgentId' src/agents/openclaw-tools.ts" 1
check "Parallel profile listing" "grep -c 'Promise.all' src/browser/server-context.ts" 1
check_match "Browser profiles timeout" "grep 'timeoutMs: 5000' src/browser/client.ts" "5000"
check "Browser startup sweep" "grep -c 'sweepStaleBrowserContainers' src/gateway/server-startup.ts" 1
check "Docker image digest utils" "grep -c 'readDockerImageId' src/agents/sandbox/docker.ts" 1
check "Auto-download wiring" "grep -c 'setDownloadWorkspaceForCdp' src/browser/control-service.ts" 1

echo ""
echo "--- Security (AgentGuard) ---"
check "Secret redaction in reply" "grep -c 'redactSecrets' src/auto-reply/reply/normalize-reply.ts" 1
check "SECRET_PATTERNS defined" "grep -c 'SECRET_PATTERNS' src/security/data-classification.ts" 1
check "Precomputed globalRegex" "grep -c 'globalRegex' src/security/data-classification.ts" 2
check "Security event journal" "grep -c 'logSecurityEvent' src/security/security-event-journal.ts" 1
check "Journal wired in reply" "grep -c 'logSecurityEvent' src/auto-reply/reply/normalize-reply.ts" 1
check "OC deployment audit" "grep -c 'collectSearxngExposureFindings' src/security/audit-extra.sync.ts" 1
check "Gateway CORS audit" "grep -c 'collectGatewayBindCorsFindings' src/security/audit-extra.sync.ts" 1
check "Audit pipeline wired" "grep -c 'OC Deployment' src/security/audit.ts" 1
check "Workspace context scanning" "grep -c 'scanAndLog' src/agents/workspace.ts" 1
check "Content scanner source tag" "grep -c 'workspace_context' src/security/external-content.ts" 1

echo ""
echo "--- Memory & Search ---"
check "Workspace memory source" "grep -c '\"workspace\"' src/memory/types.ts" 1
check "Workspace collection resolver" "grep -c 'resolveDefaultWorkspaceCollection' src/memory/backend-config.ts" 1
check "QMD retry logic" "grep -c 'addCollectionWithRetry' src/memory/qmd-manager.ts" 1
check "QMD empty workspace warning" "grep -c 'warnIfWorkspaceCollectionsEmpty' src/memory/qmd-manager.ts" 1
check "workspace_search tool" "grep -c 'workspace documents' src/agents/tool-catalog.ts" 1
check "SQL tool registration" "grep -c 'createSqlQueryTool' src/agents/openclaw-tools.ts" 1
check "Source-aware boost" "grep -c 'applySourceBoostToResults' src/memory/hybrid.ts" 1
check "SearXNG search provider" "grep -c 'runSearxngSearch' src/agents/tools/web-search.ts" 1
check "SearXNG engine resolver" "grep -c 'resolveSearxngEngines' src/agents/tools/web-search.ts" 1
check "Cache key immutability" "grep -c 'slice().toSorted()' src/agents/tools/web-search.ts" 1
check "Scrapling fallback" "grep -c 'fetchScraplingContent' src/agents/tools/web-fetch.ts" 1

echo ""
echo "--- Session Stability ---"
check "Session health sentinel" "grep -c 'onRunSuccess\|onRunError' src/auto-reply/reply/agent-runner.ts" 2
check "Ephemeral path guard" "grep -c 'isEphemeralPath' src/infra/ephemeral-path.ts" 1
check "Session freshness guard" "grep -c 'validateSessionPathFreshness' src/auto-reply/reply/session-freshness.ts" 1
check "Session createdAt field" "grep -c 'createdAt' src/config/sessions/types.ts" 1
check "Stale refresh trigger" "grep -c 'shouldForceRefresh' src/auto-reply/reply/session-updates.ts" 1
check "Typing TTL callback" "grep -c 'onTtlExpired' src/auto-reply/reply/typing.ts" 1

echo ""
echo "--- Cron & Reflection ---"
check "NEXT_WAKE parser" "grep -c 'parseNextWakeDuration' src/cron/service/timer.ts" 1
check "Evidence counters" "grep -c 'parseEvidenceCounters' src/cron/diary-archive.ts" 1
check "Problematic rules flagging" "grep -c 'flagProblematicRules' src/cron/isolated-agent/reflection-artifacts.ts" 1
check "Reflection change-log" "grep -c 'appendReflectionChangeLog' src/cron/isolated-agent/reflection-artifacts.ts" 1
check "Skill-evolution cron" "grep -c 'skill-evolution' enforce-config.mjs" 1
check "Progressive disclosure" "grep -c 'progressiveDisclosure' src/config/types.skills.ts" 1
check "Skill view tool" "grep -c 'createSkillViewTool' src/agents/openclaw-tools.ts" 1

echo ""
echo "--- Infrastructure ---"
check "Managed platform in entrypoint" "grep -c 'OPENCLAW_MANAGED_PLATFORM' docker-entrypoint.sh" 3
check "Managed platform in enforce" "grep -c 'OPENCLAW_MANAGED_PLATFORM' enforce-config.mjs" 2
check "Full tool profile enforcement" "grep -c 'tools.profile = \"full\"' enforce-config.mjs" 1
check "LCM pre-bake" "grep -c 'lossless-claw' Dockerfile" 1
check "LCM slot assignment" "grep -c 'contextEngine' enforce-config.mjs" 1
check "Agent CLI tooling" "grep -c 'yt-dlp' Dockerfile" 1
check_match "Heartbeat default" "grep 'DEFAULT_HEARTBEAT_EVERY' src/auto-reply/heartbeat.ts" '"1h"'
check "Telegram media timeout" "grep -c 'TELEGRAM_DOWNLOAD_IDLE_TIMEOUT_MS' extensions/telegram/src/bot/delivery.resolve-media.ts" 1
check "Per-agent OAuth isolation" "grep -c 'agentDir' src/agents/auth-profiles/oauth.ts" 5
check "QMD pre-warm" "grep -c 'qmd pre-warm' docker-entrypoint.sh" 1
check "Workspace doc converter" "grep -c 'workspace-doc-converter' docker-entrypoint.sh" 1
check_exists "Doc converter script" "scripts/workspace-doc-converter.sh"
check_exists "Scrapling Dockerfile" "Dockerfile.scrapling"
check_exists "Scrapling server" "scripts/scrapling-server.py"

echo ""
echo "--- Agent Behavior ---"
check "Operating Discipline step 5" "grep -c 'Document' src/agents/system-prompt.ts" 2
check "Autonomous Problem-Solving" "grep -c 'Autonomous Problem-Solving' src/agents/system-prompt.ts" 1
check "Exhaust Before Escalating" "grep -c 'Exhaust Before Escalating' SOUL.md" 1
check "IDENTITY.md path.resolve fix" "grep -c 'path.resolve' src/agents/system-prompt.ts" 1

echo ""
echo "--- Blacksmith Runner Check ---"
BH=$(grep -rl 'blacksmith' .github/workflows/ 2>/dev/null || true)
if [ -n "$BH" ]; then
  echo "  ❌ Blacksmith runners found — replace with ubuntu-latest/windows-latest:"
  echo "  $BH"
  FAIL=1
else
  echo "  ✅ No Blacksmith runners"
fi

echo ""
echo "--- soul-evil Check ---"
SE=$(find . -path ./node_modules -prune -o -name '*soul-evil*' -print 2>/dev/null | head -5)
if [ -n "$SE" ]; then
  echo "  ❌ soul-evil artifacts found — run scorched earth cleanup:"
  echo "  $SE"
  FAIL=1
else
  echo "  ✅ No soul-evil artifacts"
fi

echo ""
if [ "$FAIL" -eq 1 ]; then
  echo "❌ Gate 2 FAILED — local patches missing. Do NOT push."
  exit 1
else
  echo "✅ Gate 2 PASSED — all local patches verified"
fi
```

---

## Gate 3 — TypeScript Build

```bash
cd /Users/ash/Documents/MoltBotServers/moltbotserver-source
echo "=== Gate 3: TypeScript Build ==="
npm install && npm run build
if [ $? -eq 0 ]; then
  echo "✅ Gate 3 PASSED — build succeeded"
else
  echo "❌ Gate 3 FAILED — build errors. Do NOT push."
  exit 1
fi
```

---

## Gate 4 — Custom Test Suites

Run all MoltBot-specific tests (~570+ tests covering security, memory, sessions, browser, sentinel, cron).

```bash
cd /Users/ash/Documents/MoltBotServers/moltbotserver-source
echo "=== Gate 4: Custom Test Suites ==="
npx vitest run \
  src/agents/workspace.bootstrap-entrypoint.test.ts \
  src/agents/workspace.test.ts \
  src/security/content-scanner.test.ts \
  src/security/data-classification.test.ts \
  src/security/scan-and-log.test.ts \
  src/logging/event-log.test.ts \
  src/memory/source-boost.test.ts \
  src/logging/diagnostics-toolkit.test.ts \
  src/logging/health-sentinel.test.ts \
  src/logging/health-sentinel-phase2.test.ts \
  src/logging/health-sentinel-phase3.test.ts \
  src/logging/health-sentinel-sidecars.test.ts \
  src/agents/tools/sql-tool.test.ts \
  src/agents/tools/session-search-tool.test.ts \
  src/agents/tools/skill-manage-tool.test.ts \
  src/agents/tools/browser-tool.agent-routing.test.ts \
  src/auto-reply/reply/session-health.test.ts \
  src/auto-reply/reply/session-search.test.ts \
  src/auto-reply/reply/session-context-summary.test.ts \
  src/auto-reply/reply/session-freshness.test.ts \
  src/auto-reply/reply/noise-patterns.test.ts \
  src/auto-reply/reply/trajectory-compressor.test.ts \
  src/auto-reply/reply/tool-stats.test.ts \
  src/auto-reply/reply/typing.test.ts \
  src/infra/ephemeral-path.test.ts \
  src/infra/atomic-file.test.ts \
  src/agents/sandbox/browser-sweep.test.ts \
  src/browser/download-workspace-registry.test.ts \
  src/browser/control-service.test.ts \
  src/memory/knowledge-index.test.ts \
  src/cron/service/timer.next-wake.test.ts \
  src/config/config.web-search-provider.test.ts \
  src/agents/models-config.providers.sansa.test.ts \
  src/browser/chrome.test.ts \
  src/cron/pre-reset-flush.test.ts \
  src/infra/heartbeat-runner.returns-default-unset.test.ts \
  src/browser/server-context.test.ts \
  src/auto-reply/reply/session-updates.test.ts
```

If any test fails, investigate whether upstream changed an API signature or behavior that our code depends on.

> [!IMPORTANT]
> `workspace.bootstrap-entrypoint.test.ts` is the bootstrap ritual regression suite. If it fails after a sync, the `isFirstEnsureRun` fix in `workspace.ts` was reverted. Re-apply from `OPENCLAW_CHANGELOG.md` ("fix: BOOTSTRAP.md not seeded on fresh deploy").

---

## Summary Gate

After all 4 gates pass:

```bash
echo ""
echo "========================================"
echo "  ALL GATES PASSED — Safe to push"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. git push origin main --force-with-lease"
echo "  2. Deploy and run /smoke-test"
```

---

## When to Use

- **After every `/update-openclaw`** — run between Phase 5 (Execute Update) and Phase 6 (Finalize)
- **After every `/sync-upstream`** — run before the `git push` step
- **After manual conflict resolution** — any time you've rebased or merged upstream

## Context Files

- **Patch reference**: `moltbotserver-source/LOCAL_PATCHES.md` — files with critical local modifications
- **Full sync reference**: `moltbotserver-source/OPENCLAW_CONTEXT.md` — all modified files and what to preserve
- **Change history**: `moltbotserver-source/OPENCLAW_CHANGELOG.md` — detailed history of all custom modifications
