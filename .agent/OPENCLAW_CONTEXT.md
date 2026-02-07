# OpenClaw Local Customizations

This document tracks customizations made to this fork compared to upstream `openclaw/openclaw`.

> [!IMPORTANT]
> Reference this file when updating from upstream to ensure these changes are preserved.

---

## Security Hardening

### Removed Features
- **SoulEvil persona**: Removed for safety/security reasons

### Modified Files
<!-- Add files you've modified for security here -->
- `docker-entrypoint.sh` - Custom security configurations
- `Dockerfile` - Hardened container setup

### Added Security Measures
<!-- Document any security additions -->
- TBD - Add your security measures here

## Memory & Intelligence Features
### Modified Files
- `docker-entrypoint.sh`
  - **Config Generation**: Modified `openclaw.json` generation blocks (lines ~67-85 and ~93-110) to enable `memoryFlush` and `sessionMemory` search by default.
  - **Deployment**: Added logic (lines ~248+) to deploy `WORKING.md` template to workspace if missing.

### New Files
- `WORKING.md`: Template for persistent task state across compactions. Located in root, copied to `/app/` in Docker.
- `IDENTITY.md`: Writable self-evolution file for personality, promoted patterns, and learned preferences. SOUL.md is read-only for security; IDENTITY.md is the agent's editable identity. Also contains the metacognition lens injection point (`<!-- LIVE_STATE_START/END -->` markers).

### Scripts
- `scripts/metacognition.py`: Self-evolving metacognitive engine (perceptions, curiosities, feedback loops). Injects into IDENTITY.md.
- `scripts/live_state.py`: Environment bindings for recording experiences.
- `scripts/check-open-loops.py`: Checks for unchecked tasks in markdown files.


---

## Critical Files (Do Not Overwrite)

Files that should always keep local version during updates:

| File | Reason |
|------|--------|
| `docker-compose.coolify.yml` | Coolify deployment configuration |
| `docker-entrypoint.sh` | Custom initialization logic |
| `.env.example` | Local environment template |

---

## Safe to Update

Files that can generally take upstream version:

- `README.md`
- `CHANGELOG.md`
- Documentation in `docs/`
- Dependencies in `package.json` (review carefully)

---

## Update History

| Date | Upstream Commit | Notes |
|------|-----------------|-------|
| 2026-02-04 | — | Token Economy dashboard implementation |
| TBD  | TBD | Initial fork |

---

## Orchestrator Pattern (Sub-Agent Delegation)

> **Date Added:** 2026-02-04
> **Status:** Config-only (no source code changes)

### Purpose
Enable the main agent to act as an orchestrator that delegates tasks to sub-agents using task-type-based model routing.

### Modified Files

| File | What Changed | Why |
|------|--------------|-----|
| `docker-entrypoint.sh` | Added `routing.rules` and `subagent` config blocks to `openclaw.json` generation (~lines 80-110 in both branches) | Inject routing configuration for task-type-based model selection |
| `docker-entrypoint.sh` | Added log directory creation logic at end of file (~lines 289-296) | Create `subagent-logs/` directory on container startup |

### Config Injected into `openclaw.json`

```json
"routing": {
  "rules": [
    { "match": { "taskType": "coding" }, "model": "codex/codex-1.5" },
    { "match": { "taskType": "search" }, "model": "google/gemini-2.5-flash" },
    { "match": { "taskType": "analysis" }, "model": "deepseek/deepseek-v3" },
    { "match": { "taskType": "default" }, "model": "kimi/k2.5" }
  ]
},
"subagent": {
  "useRouting": true,
  "defaultModel": "kimi/k2.5",
  "logToFile": true,
  "logPath": "subagent-logs/"
}
```

### New Files

| File | Purpose |
|------|---------|
| `SOUL_DELEGATION_SNIPPET.md` | Guidance snippet for SOUL.md on when/how to delegate tasks to sub-agents |

### ⚠️ Important Notes

1. **Config is aspirational**: The `routing` and `subagent` config keys are injected but **OpenClaw does not natively read them**. They serve as documentation/future-proofing.
2. **No source changes**: The actual TypeScript source (`src/agents/`) was **not modified**. Sub-agent spawning uses explicit `model` parameter specified by the agent.
3. **Log directory**: The `subagent-logs/` directory is created but file logging requires source modifications to implement.
4. **SOUL.md guidance**: The agent is expected to follow `SOUL_DELEGATION_SNIPPET.md` guidance to manually specify models when spawning.

### To Fully Enable (Future Work)

If automatic task-type routing and file logging are desired, these files would need modification:
- `src/agents/tools/sessions-spawn-tool.ts` — Add `taskType` param and routing logic
- `src/agents/subagent-registry.ts` — Store `taskType` in run records
- `src/agents/subagent-announce.ts` — Write markdown logs to `subagent-logs/`

---

## Dashboard Customizations (Token Economy)

> **Location:** `/Users/ash/Documents/MoltBotServers/dashboard/`

These changes are in the **dashboard** repo, not the OpenClaw source. Document here for completeness.

### New Files

| File | Purpose |
|------|---------|
| `src/lib/constants/presets.ts` | Token Economy preset definitions (Cost-Saving, Power modes) with model mappings |

### Modified Files

| File | What Changed | Why |
|------|--------------|-----|
| `src/lib/types/instance.ts` | Added `image` to `ModelRoutingConfig`; added `HeartbeatInterval` type | Support Image capability and configurable heartbeat |
| `src/components/instances/CreateInstanceWizard.tsx` | Preset selector UI (Step 2), routing visualization with 6 capabilities, `tokenEconomyPreset` in deploy payload | One-click model optimization for new instances |
| `src/app/dashboard/instances/[id]/components/InstanceSettings.tsx` | Token Economy preset card in settings tab | Switch presets on existing instances without redeploy |
| `src/app/api/instances/[id]/settings/route.ts` | Zod schema for `tokenEconomyPreset`, `heartbeatInterval`, `routing`; Coolify env var injection | Backend persistence and hot-reload support |

### Environment Variables Injected

| Variable | Description |
|----------|-------------|
| `OPENCLAW_ROUTING_CONFIG` | JSON-serialized routing config |
| `OPENCLAW_HEARTBEAT_INTERVAL` | Heartbeat frequency (e.g., `1h`, `10m`) |

### Preset Definitions

| Preset | Models | Cost Est |
|--------|--------|----------|
| Cost-Saving | Kimi K2.5, Minimax 2.1, DeepSeek V3, Gemini Flash, Haiku | ~$25-80/mo |
| Power | Claude Opus 4.5, Codex GPT 5.2, Haiku | ~$500-1000/mo |

---

## Notes

Add any other context about your customizations here that would help during updates.
