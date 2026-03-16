---
name: clawscan
description: Scan workspaces, installed skills, dependencies, and configurations for security vulnerabilities. Use when auditing skill code safety, checking npm dependencies for known CVEs, reviewing installed plugins for malicious patterns, running periodic security sweeps, or investigating security advisories. Covers static analysis, dependency audit, and configuration hardening.
---

# ClawScan

## Overview

Comprehensive security scanning for OpenClaw workspaces, skills, plugins, and dependencies. Uses built-in static analysis and the `openclaw security audit` CLI — no external tools required for core scanning.

## Core rules

- Always scan newly installed skills before enabling them.
- Run `openclaw security audit` after any configuration change.
- Do not skip large files during skill scanning — they may contain obfuscated payloads.
- Report all CRITICAL findings immediately, even if they might be false positives.
- Never auto-remediate CRITICAL findings without human review.

## Scanning capabilities

### 1) Skill code scanner

Scans JavaScript/TypeScript files in skill directories for dangerous patterns.

**Detection rules:**

| Rule ID                  | Severity | What it catches                                  |
| ------------------------ | -------- | ------------------------------------------------ |
| `dangerous-exec`         | CRITICAL | `child_process` exec/spawn calls                 |
| `dynamic-code-execution` | CRITICAL | `eval()`, `new Function()`                       |
| `crypto-mining`          | CRITICAL | Stratum URLs, CoinHive, XMRig references         |
| `suspicious-network`     | WARN     | WebSocket connections to non-standard ports      |
| `potential-exfiltration` | WARN     | File reads combined with network sends           |
| `obfuscated-code`        | WARN     | Hex-encoded strings, large base64 payloads       |
| `env-harvesting`         | CRITICAL | `process.env` access combined with network sends |

**Usage:**

```bash
# Scan a specific skill directory
# (programmatic — use from within an agent session)
```

```ts
import { scanDirectoryWithSummary } from "./security/skill-scanner.js";

const result = await scanDirectoryWithSummary("/path/to/skill", {
  maxFiles: 500, // default
  maxFileBytes: 1048576, // 1MB default
});

console.log(`Scanned ${result.scannedFiles} files`);
console.log(`Critical: ${result.critical}, Warn: ${result.warn}, Info: ${result.info}`);

for (const finding of result.findings) {
  console.log(`[${finding.severity}] ${finding.file}:${finding.line} — ${finding.message}`);
  console.log(`  Evidence: ${finding.evidence}`);
}
```

### 2) Configuration security audit

Uses the built-in comprehensive security audit system.

```bash
# Quick audit (no network probing)
openclaw security audit

# Deep audit (probes gateway connectivity, browser control, etc.)
openclaw security audit --deep

# Machine-readable output
openclaw security audit --json

# Auto-fix safe defaults (file permissions, etc.)
openclaw security audit --fix
```

**What it checks:**

- Gateway bind address + auth configuration
- Control UI origin allowlisting
- Browser control authentication
- Filesystem permissions (state dir, config file)
- Tailscale exposure mode
- Tool trust policy (safe bins, elevated exec)
- Channel security (DM policy, rate limiting)
- Installed skills code safety
- Plugin trust and code safety
- Sandbox configuration
- Model hygiene (small model risks)

### 3) Dependency audit

For workspaces with npm dependencies:

```bash
# Check for known CVEs in dependencies
npm audit

# Auto-fix safe updates
npm audit fix

# Detailed report
npm audit --json
```

For Python workspaces:

```bash
# Using pip-audit (if installed)
pip-audit

# Using safety (if installed)
safety check
```

## Workflow

### Full security sweep

Follow this order for a comprehensive scan:

#### Step 1: Run OpenClaw security audit

```bash
openclaw security audit --deep
```

Review all CRITICAL and WARN findings. Fix CRITICAL findings before proceeding.

#### Step 2: Scan installed skills

```ts
import { scanDirectoryWithSummary } from "./security/skill-scanner.js";
import path from "node:path";

// Scan all skills in the workspace
const skillsDir = path.join(workspaceDir, "skills");
const result = await scanDirectoryWithSummary(skillsDir);

if (result.critical > 0) {
  // STOP: review critical findings before continuing
}
```

Or scan from the CLI by reviewing the skill directories:

```bash
# List all skills
ls -la skills/

# Check each skill for suspicious patterns
grep -r "eval\|exec\|spawn\|child_process" skills/ --include="*.ts" --include="*.js"
grep -r "process\.env.*fetch\|process\.env.*http" skills/ --include="*.ts" --include="*.js"
```

#### Step 3: Check dependencies

```bash
# npm audit for Node.js projects
npm audit 2>/dev/null || echo "No package-lock.json found"

# Check for outdated packages with known issues
npm outdated 2>/dev/null || true
```

#### Step 4: Review workspace context files

Verify that workspace context files (SOUL.md, OPERATIONS.md, IDENTITY.md) haven't been tampered with:

```bash
# Check for suspicious patterns in workspace docs
grep -ri "ignore.*previous.*instructions\|system.*override\|<|im_start|>" \
  SOUL.md OPERATIONS.md IDENTITY.md MEMORY.md 2>/dev/null || echo "Clean"
```

#### Step 5: Generate report

Compile findings into a summary:

```
## Security Scan Report — [timestamp]

### OpenClaw Audit
- Critical: X findings
- Warn: Y findings
- Info: Z findings

### Skill Code Safety
- Scanned: N files across M skills
- Critical: X, Warn: Y, Info: Z

### Dependencies
- npm audit: X vulnerabilities (H high, M moderate, L low)

### Workspace Integrity
- Context files: [clean/suspicious]

### Recommendations
1. [prioritized remediation steps]
```

## Periodic scanning

### Schedule via OpenClaw cron

After initial scan, offer to schedule periodic sweeps:

```bash
# Check if a scan job already exists
openclaw cron list

# Add periodic security scan (weekly, Sunday 11 PM)
openclaw cron add --name "clawscan:weekly" --schedule "0 23 * * 0" \
  --prompt "Run a full ClawScan security sweep. Report findings and flag any new CRITICAL issues."
```

### Integration with healthcheck skill

The `healthcheck` skill focuses on host-level security (firewall, SSH, OS updates). ClawScan complements it by covering application-level security (skills, plugins, config, dependencies).

Recommended combined schedule:

| Job                          | Cadence              | Focus                            |
| ---------------------------- | -------------------- | -------------------------------- |
| `healthcheck:security-audit` | Weekly               | Host hardening + OpenClaw config |
| `clawscan:weekly`            | Weekly               | Skills, plugins, deps, workspace |
| `openclaw security audit`    | After config changes | Config validation                |

## Handling findings

### CRITICAL findings

1. **Isolate** — disable the affected skill/plugin immediately.
2. **Investigate** — review the flagged code in context. Is it legitimate or malicious?
3. **Report** — notify the owner with evidence (file, line, pattern).
4. **Remediate** — remove malicious code or replace with a safe alternative.
5. **Verify** — re-scan to confirm the finding is resolved.

### WARN findings

1. **Review** — check if the pattern is a false positive (e.g., a legitimate WebSocket connection).
2. **Document** — if legitimate, add a comment explaining why the pattern is acceptable.
3. **Monitor** — keep the finding in scan reports for tracking.

### False positive management

The skill scanner uses context-aware rules (e.g., `dangerous-exec` only fires when `child_process` is also imported). If you encounter false positives:

- Check if the pattern has a `requiresContext` guard that should filter it.
- For legitimate uses, document the justification instead of suppressing the scanner.
- Never add blanket exclusions — they hide real issues.
