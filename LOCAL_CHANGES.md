# Local Fork Divergence

This file is a lightweight note, not the authoritative source of fork policy.

For the active maintenance model, use:

- `FORK_STRATEGY.md`
- `FORK_INVARIANTS.md`

This file may lag behind the full branch delta.

---

## Active Local Changes

### 1. Workspace Auto-Indexing + `workspace_search` Tool

**Commits:** `eefcc55fb`, `7e370b644`
**Risk on upstream merge:** MEDIUM — upstream may add conflicting memory/QMD features

**Files changed:**
| File | Change |
|---|---|
| `src/memory/types.ts` | Added `"workspace"` to `MemorySource` union |
| `src/memory/manager-sync-ops.ts` | Added `"workspace"` to source guards in `resolveConfiguredSourcesForMeta` + `normalizeMetaSources` |
| `src/memory/qmd-manager.ts` | `bootstrapCollections` maps `kind=workspace` → `source=workspace`; `ensureCollectionPath` type includes `"workspace"` |
| `src/memory/backend-config.ts` | Added `"workspace"` to `ResolvedQmdCollection.kind`; added `resolveDefaultWorkspaceCollection()` + `resolveWorkspacePaths()` |
| `src/memory/backend-config.test.ts` | 3 new test cases for workspace collection resolution |
| `src/config/types.memory.ts` | Added `workspacePaths?: MemoryQmdIndexPath[]` to `MemoryQmdConfig` |
| `src/agents/tools/workspace-search-tool.ts` | **NEW FILE** — `createWorkspaceSearchTool()`, business-mode only |
| `src/agents/tool-catalog.ts` | Registered `workspace_search` in memory section |
| `src/plugins/runtime/runtime-tools.ts` | Exported `createWorkspaceSearchTool` |
| `src/plugins/runtime/types-core.ts` | Added `createWorkspaceSearchTool` to `PluginRuntimeCore.tools` |
| `src/agents/system-prompt.ts` | Updated `buildMemorySection` + both business-mode KB instructions |

**What to watch on upstream sync:**

- Any upstream changes to `MemorySource` type — we added `"workspace"`, check for conflicts
- Any upstream changes to `ResolvedQmdCollection` — we extended `kind`
- Any upstream changes to `qmd-manager.ts` `bootstrapCollections` or `ensureCollectionPath`
- Any upstream changes to `backend-config.ts` `resolveMemoryBackendConfig`
- Any upstream changes to `system-prompt.ts` `buildMemorySection` or business-mode sections
- Any upstream changes to `PluginRuntimeCore.tools` interface

**How it works:**

- QMD auto-registers `workspace-<agentId>` collection pointing at workspace root on boot
- `workspace_search` filters results by `source === "workspace"`, so personal memory is excluded
- Only active when `OPENCLAW_BUSINESS_MODE_ENABLED=true` (or `OPENCLAW_BUSINESS_MODE=1`) + QMD backend
- `memory_search` unchanged — still covers personal memory layer only

---

### 2. Dockerfile QMD Find Path Fix

**Commit:** `fb2a7a108`
**Risk on upstream merge:** LOW — upstream may update the Dockerfile QMD install step

**Files changed:**
| File | Change |
|---|---|
| `Dockerfile` | Changed `find /root/.bun/install/global /root/.bun` to `find / -not -path "/proc/*" -not -path "/sys/*"` in QMD source detection |

**What to watch on upstream sync:**

- If upstream updates the QMD install step in Dockerfile, check if their path search is correct
- Our broader `find /` is safe but slightly slower at build time — upstream may have a better fix

---

### 3. Bootstrap Injection Scope Fix

**Commit:** earlier (see conversation `aa68fe74`)
**Risk on upstream merge:** MEDIUM

**Files changed:**

- `src/agents/pi-embedded-runner/run/attempt.ts` — bootstrap only injected on truly new workspaces

---

### 4. OCS Warning Suppression

**Commit:** earlier (see conversation `762ce5f6`)
**Risk on upstream merge:** LOW

**Files changed:**

- `src/gateway/server-startup-log.ts` — suppress certain warnings when `OPENCLAW_MANAGED_PLATFORM=1`
- `src/gateway/server-runtime-state.ts` — same condition

---

### 5. Bootstrap Template: IDENTITY.md instead of SOUL.md

**Commit:** `0eaaa7111`
**Risk on upstream merge:** LOW — isolated to docs/templates

**Files changed:**

- `docs/reference/templates/AGENTS.md` — references `IDENTITY.md` instead of `SOUL.md`
- Bootstrap skill uses `IDENTITY.md`

---

## Upstream Sync Checklist

When running `/sync-upstream` or `/update-openclaw`, verify these files after merge:

```
src/memory/types.ts                          → check MemorySource union
src/memory/qmd-manager.ts                    → check bootstrapCollections + ensureCollectionPath
src/memory/backend-config.ts                 → check resolveMemoryBackendConfig + collection kinds
src/agents/tools/workspace-search-tool.ts    → new file, won't conflict but verify still needed
src/agents/tool-catalog.ts                   → check memory section still has workspace_search
src/plugins/runtime/types-core.ts            → check PluginRuntimeCore.tools interface
src/agents/system-prompt.ts                  → check buildMemorySection + business-mode KB sections
Dockerfile                                   → check QMD install step
```
