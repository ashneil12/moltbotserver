#!/bin/bash
set -e

# =============================================================================
# OpenClaw Entrypoint
# =============================================================================

# -----------------------------------------------------------------------------
# Logging Helpers
# -----------------------------------------------------------------------------
log_info() { echo "[entrypoint] INFO: $*"; }
log_warn() { echo "[entrypoint] WARN: $*"; }
log_error() { echo "[entrypoint] ERROR: $*"; }

# -----------------------------------------------------------------------------
# Configuration & Environment
# -----------------------------------------------------------------------------
CONFIG_DIR="${OPENCLAW_STATE_DIR:-${MOLTBOT_STATE_DIR:-${CLAWDBOT_STATE_DIR:-/home/node/.clawdbot}}}"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-${CLAWDBOT_WORKSPACE_DIR:-/home/node/workspace}}"
MEMORY_DIR="$WORKSPACE_DIR/memory"
SUBAGENT_LOG_DIR="$WORKSPACE_DIR/subagent-logs"

# Gateway & Network
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-${CLAWDBOT_GATEWAY_TOKEN:-}}"
GATEWAY_BIND="${OPENCLAW_BIND:-${CLAWDBOT_BIND:-custom}}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-${CLAWDBOT_GATEWAY_PORT:-${PORT:-18789}}}"
AI_GATEWAY_URL="${OPENCLAW_AI_GATEWAY_URL:-}"

# Auth & Security
DISABLE_DEVICE_AUTH="${OPENCLAW_DISABLE_DEVICE_AUTH:-${MOLTBOT_DISABLE_DEVICE_AUTH:-false}}"
ACIP_ENABLED="${OPENCLAW_ACIP_ENABLED:-true}"
export OPENCLAW_DISABLE_BONJOUR=1

# Models
DEFAULT_MODEL="${OPENCLAW_DEFAULT_MODEL:-${OPENCLAW_ONBOARD_MODEL:-${MOLTBOT_DEFAULT_MODEL:-}}}"
COMPLEX_MODEL="${OPENCLAW_COMPLEX_MODEL:-${DEFAULT_MODEL}}"
SUBAGENT_MODEL="${OPENCLAW_SUBAGENT_MODEL:-deepseek/deepseek-reasoner}"
HEARTBEAT_MODEL="${OPENCLAW_HEARTBEAT_MODEL:-${HEARTBEAT_MODEL:-}}"
HEARTBEAT_INTERVAL="${OPENCLAW_HEARTBEAT_INTERVAL:-15m}"
FALLBACK_MODELS_RAW="${OPENCLAW_FALLBACK_MODELS:-}"

CODING_MODEL="${OPENCLAW_CODING_MODEL:-${DEFAULT_MODEL}}"
WRITING_MODEL="${OPENCLAW_WRITING_MODEL:-${DEFAULT_MODEL}}"
SEARCH_MODEL="${OPENCLAW_SEARCH_MODEL:-${DEFAULT_MODEL}}"
IMAGE_MODEL="${OPENCLAW_IMAGE_MODEL:-${DEFAULT_MODEL}}"

# Concurrency & Delays
MAX_CONCURRENT="${OPENCLAW_MAX_CONCURRENT:-4}"
SUBAGENT_MAX_CONCURRENT="${OPENCLAW_SUBAGENT_MAX_CONCURRENT:-8}"
HUMAN_DELAY_ENABLED="${OPENCLAW_HUMAN_DELAY_ENABLED:-false}"
HUMAN_DELAY_MIN="${OPENCLAW_HUMAN_DELAY_MIN:-800}"
HUMAN_DELAY_MAX="${OPENCLAW_HUMAN_DELAY_MAX:-2500}"




prepare_fallback_json() {
  FALLBACK_JSON="[]"
  if [ -n "$FALLBACK_MODELS_RAW" ]; then
    IFS=',' read -ra FALLBACK_LIST <<< "$FALLBACK_MODELS_RAW"
    FALLBACK_JSON="["
    first=1
    for item in "${FALLBACK_LIST[@]}"; do
      trimmed=$(echo "$item" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
      if [ -n "$trimmed" ]; then
        if [ $first -eq 0 ]; then FALLBACK_JSON+=", "; fi
        FALLBACK_JSON+="\"$trimmed\""
        first=0
      fi
    done
    FALLBACK_JSON+="]"
    if [ $first -eq 1 ]; then FALLBACK_JSON="[]"; fi
  fi
}

check_heartbeat_model() {
  if [ -z "$HEARTBEAT_MODEL" ]; then
    if [ -n "$DEFAULT_MODEL" ]; then
      log_warn "HEARTBEAT_MODEL not set; falling back to DEFAULT_MODEL"
      HEARTBEAT_MODEL="$DEFAULT_MODEL"
    else
      log_warn "HEARTBEAT_MODEL not set and DEFAULT_MODEL is empty"
    fi
  fi
}

generate_config() {
  mkdir -p "$CONFIG_DIR"

  if [ ! -f "$CONFIG_FILE" ] || [ "$DISABLE_DEVICE_AUTH" = "true" ] || [ "$DISABLE_DEVICE_AUTH" = "1" ]; then
    log_info "Generating openclaw.json configuration..."
    
    MODELS_SECTION=""
    # Note: In BYOK mode, instances connect directly to providers using
    # the user's own API key (e.g. MINIMAX_API_KEY). No gateway proxy needed.

    HUMAN_DELAY_SECTION=""
    if [ "$HUMAN_DELAY_ENABLED" = "true" ] || [ "$HUMAN_DELAY_ENABLED" = "1" ]; then
      HUMAN_DELAY_SECTION=",
      \"humanDelay\": {
        \"min\": ${HUMAN_DELAY_MIN},
        \"max\": ${HUMAN_DELAY_MAX}
      }"
    fi

    BROWSER_SECTION=""
    if [ "${OPENCLAW_BROWSER_ENABLED:-}" = "true" ] || [ "${OPENCLAW_BROWSER_ENABLED:-}" = "1" ]; then
      BROWSER_CDP_HOST="${OPENCLAW_BROWSER_CDP_HOST:-browser}"
      BROWSER_CDP_PORT="${OPENCLAW_BROWSER_CDP_PORT:-9222}"
      log_info "Browser sidecar enabled — CDP at ${BROWSER_CDP_HOST}:${BROWSER_CDP_PORT}"
      BROWSER_SECTION=',
      "browser": {
        "enabled": true,
        "headless": false,
        "noSandbox": true,
        "attachOnly": true,
        "evaluateEnabled": true,
        "defaultProfile": "openclaw",
        "profiles": {
          "openclaw": {
            "cdpUrl": "http://'"${BROWSER_CDP_HOST}"':'"${BROWSER_CDP_PORT}"'",
            "color": "#FF4500"
          }
        }
      }'
    fi

    # Memory search uses local embeddings or the provider's key directly.
    MEMORY_SEARCH_REMOTE=""

    cat > "$CONFIG_FILE" << EOF
{
  "gateway": {
    "mode": "local",
    "port": ${GATEWAY_PORT},
    "bind": "${GATEWAY_BIND}",
    "customBindHost": "0.0.0.0",
    "trustedProxies": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"],
    "controlUi": {
      "enabled": true,
      "dangerouslyDisableDeviceAuth": true
    },
    "auth": {
      "mode": "token",
      "token": "${GATEWAY_TOKEN}"
    }
  },
  "logging": { "redactSensitive": "tools" }${MODELS_SECTION},
  "memory": {
    "backend": "qmd",
    "citations": "auto",
    "qmd": {
      "includeDefaultMemory": true,
      "update": {
        "interval": "5m",
        "onBoot": true,
        "waitForBootSync": false,
        "commandTimeoutMs": 120000,
        "updateTimeoutMs": 300000,
        "embedTimeoutMs": 300000
      },
      "limits": {
        "maxResults": 8,
        "maxSnippetChars": 700,
        "timeoutMs": 120000
      }
    }
  },
  "agents": {
    "defaults": {
      "workspace": "${WORKSPACE_DIR}",
      "model": {
        "primary": "${DEFAULT_MODEL}",
        "fallbacks": ${FALLBACK_JSON}
      },
      "compaction": {
        "memoryFlush": {
          "enabled": true,
          "softThresholdTokens": 4000,
          "systemPrompt": "Session nearing compaction. Write any important context to WORKING.md and memory files now.",
          "prompt": "Before context compaction, update WORKING.md with current task state and write any lasting notes to memory/YYYY-MM-DD.md. Reply with NO_REPLY if nothing to store."
        }
      },
      "contextPruning": {
        "mode": "cache-ttl",
        "ttl": "30m",
        "keepLastAssistants": 3
      },
      "memorySearch": {
        ${MEMORY_SEARCH_REMOTE}
        "experimental": { "sessionMemory": true },
        "sources": ["memory", "sessions"]
      },
      "subagents": {
        "model": "${SUBAGENT_MODEL}",
        "maxConcurrent": ${SUBAGENT_MAX_CONCURRENT}
      },
      "heartbeat": {
        "every": "${HEARTBEAT_INTERVAL}",
        "prompt": "HEARTBEAT CHECK — You MUST complete ALL steps below. DO NOT SKIP ANY STEP.\n\nMANDATORY FILE READS (use the read tool for EACH of these, every single heartbeat):\n\nSTEP 1: READ ~/workspace/WORKING.md — In-progress task? Continue it. Stalled/blocked?\nSTEP 2: READ ~/workspace/memory/self-review.md — Check last 7 days for MISS tags. If match: counter-check protocol.\nSTEP 3: READ ~/workspace/HEARTBEAT.md — Scheduled tasks due? Errors? Urgent items?\n\nCRITICAL: Even if a file was empty last time, you MUST read it again. Files change between heartbeats. Skipping reads means missing information. You are REQUIRED to make 3 separate read calls before responding.\n\nSTEP 4: CHECK for .update-available file\nSTEP 5: RESPONSE (only after steps 1-4): Nothing → HEARTBEAT_OK. User attention needed → brief message (one line max).\n\nNEVER message for: routine status, still running, low-priority completions.",
        "model": "${HEARTBEAT_MODEL}"
      },
      "maxConcurrent": ${MAX_CONCURRENT}
    }
  },
  "messages": {
    "queue": {
      "mode": "collect"
    }${HUMAN_DELAY_SECTION}
  }${BROWSER_SECTION}
}
EOF
    log_info "Configuration generated at $CONFIG_FILE"
    
    log_info "Enforcing security permissions..."
    chmod 700 "$CONFIG_DIR"
    chmod 600 "$CONFIG_FILE"
  else
    log_info "Using existing configuration at $CONFIG_FILE"
  fi
}

run_auto_onboard() {
  AUTO_ONBOARD="${OPENCLAW_AUTO_ONBOARD:-false}"
  ONBOARD_MARKER="$CONFIG_DIR/.onboard-complete"

  if [ "$AUTO_ONBOARD" != "true" ] && [ "$AUTO_ONBOARD" != "1" ]; then return 0; fi
  if [ -f "$ONBOARD_MARKER" ]; then
    log_info "Auto-onboard already completed (marker exists)"
    return 0
  fi

  log_info "Auto-onboard enabled, running non-interactive setup..."
  OPENCLAW_SCRIPT="/app/openclaw.mjs"
  
  if [ ! -f "$OPENCLAW_SCRIPT" ]; then
    log_error "FATAL: openclaw.mjs not found at $OPENCLAW_SCRIPT"
    ls -la /app/ | head -20
    return 1
  fi

  ONBOARD_CMD=("node" "$OPENCLAW_SCRIPT" "onboard" "--non-interactive" "--accept-risk" "--mode" "local" "--gateway-port" "${GATEWAY_PORT}" "--gateway-bind" "lan" "--skip-skills")
  
  AUTH_CHOICE="${OPENCLAW_ONBOARD_AUTH_CHOICE:-}"
  if [ -n "$AUTH_CHOICE" ]; then
    ONBOARD_CMD+=("--auth-choice" "$AUTH_CHOICE")
    
    # Add API keys
    case "$AUTH_CHOICE" in
      ai-gateway-api-key) [ -n "${AI_GATEWAY_API_KEY}" ] && ONBOARD_CMD+=("--ai-gateway-api-key" "$AI_GATEWAY_API_KEY") ;;
      apiKey) [ -n "${ANTHROPIC_API_KEY}" ] && ONBOARD_CMD+=("--anthropic-api-key" "$ANTHROPIC_API_KEY") ;;
      openai-api-key) [ -n "${OPENAI_API_KEY}" ] && ONBOARD_CMD+=("--openai-api-key" "$OPENAI_API_KEY") ;;
      gemini-api-key) [ -n "${GEMINI_API_KEY:-${GOOGLE_API_KEY}}" ] && ONBOARD_CMD+=("--gemini-api-key" "${GEMINI_API_KEY:-${GOOGLE_API_KEY}}") ;;
      xai-api-key) [ -n "${XAI_API_KEY}" ] && ONBOARD_CMD+=("--xai-api-key" "$XAI_API_KEY") ;;
      moonshot-api-key) [ -n "${MOONSHOT_API_KEY}" ] && ONBOARD_CMD+=("--moonshot-api-key" "$MOONSHOT_API_KEY") ;;
      zai-api-key) [ -n "${ZAI_API_KEY}" ] && ONBOARD_CMD+=("--zai-api-key" "$ZAI_API_KEY") ;;
      venice-api-key) [ -n "${VENICE_API_KEY}" ] && ONBOARD_CMD+=("--venice-api-key" "$VENICE_API_KEY") ;;
    esac
  fi

  log_info "Running onboard command... [auth-choice: ${AUTH_CHOICE}]"
  
  if "${ONBOARD_CMD[@]}"; then
    log_info "Auto-onboard completed successfully"
    touch "$ONBOARD_MARKER"
  else
    log_info "Auto-onboard command returned error code"
    if [ -s "$CONFIG_FILE" ]; then
       log_info "Config file generated successfully despite error. Ignoring."
       touch "$ONBOARD_MARKER"
    else
       log_error "Auto-onboard failed and no config generated."
    fi
  fi
}

patch_config_json() {
  local filter="$1"
  local node_script="$2"
  
  if command -v jq &> /dev/null; then
    jq "$filter" "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
  else
    node -e "$node_script"
  fi
}

enforce_model_settings() {
  if [ ! -s "$CONFIG_FILE" ]; then return; fi
  
  log_info "Re-enforcing model settings..."
  
  local jq_filter='.'
  [ -n "$DEFAULT_MODEL" ] && jq_filter="$jq_filter | .agents.defaults.model.primary = \"$DEFAULT_MODEL\""
  [ -n "$HEARTBEAT_MODEL" ] && jq_filter="$jq_filter | .agents.defaults.heartbeat.model = \"$HEARTBEAT_MODEL\""
  [ -n "$SUBAGENT_MODEL" ] && jq_filter="$jq_filter | .agents.defaults.subagents.model = \"$SUBAGENT_MODEL\""
  [ "$FALLBACK_JSON" != "[]" ] && jq_filter="$jq_filter | .agents.defaults.model.fallbacks = $FALLBACK_JSON"
  
  local node_script="
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};
    config.agents.defaults.model = config.agents.defaults.model || {};
    if ('$DEFAULT_MODEL') config.agents.defaults.model.primary = '$DEFAULT_MODEL';
    if ('$HEARTBEAT_MODEL') {
      config.agents.defaults.heartbeat = config.agents.defaults.heartbeat || {};
      config.agents.defaults.heartbeat.model = '$HEARTBEAT_MODEL';
    }
    if ('$SUBAGENT_MODEL') {
      config.agents.defaults.subagents = config.agents.defaults.subagents || {};
      config.agents.defaults.subagents.model = '$SUBAGENT_MODEL';
    }
    const fallbacks = $FALLBACK_JSON;
    if (fallbacks.length > 0) config.agents.defaults.model.fallbacks = fallbacks;
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
  "
  
  patch_config_json "$jq_filter" "$node_script"
}

enforce_gateway_token() {
  if [ -z "$GATEWAY_TOKEN" ] || [ ! -s "$CONFIG_FILE" ]; then return; fi
  
  log_info "Enforcing gateway token..."
  local jq_filter=".gateway.auth.token = \"$GATEWAY_TOKEN\" | .gateway.auth.mode = \"token\""
  local node_script="
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
    config.gateway = config.gateway || {};
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.mode = 'token';
    config.gateway.auth.token = '$GATEWAY_TOKEN';
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
  "
  patch_config_json "$jq_filter" "$node_script"
}

enforce_trusted_proxies() {
  if [ ! -s "$CONFIG_FILE" ]; then return; fi
  
  log_info "Enforcing trustedProxies..."
  local jq_filter='.gateway.trustedProxies = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"]'
  local node_script="
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
    config.gateway = config.gateway || {};
    config.gateway.trustedProxies = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8'];
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
  "
  patch_config_json "$jq_filter" "$node_script"
}

setup_security_files() {
  # SOUL.md
  if [ -f "/app/SOUL.md" ]; then
    mkdir -p "$WORKSPACE_DIR"
    log_info "Setting up security rules (SOUL.md)..."
    rm -f "$WORKSPACE_DIR/SOUL.md"
    cp /app/SOUL.md "$WORKSPACE_DIR/SOUL.md"
    
    # Template replacement
    sed -i \
      -e "s|{{PRIMARY_MODEL}}|${COMPLEX_MODEL:-not-configured}|g" \
      -e "s|{{SUBAGENT_MODEL}}|${SUBAGENT_MODEL:-not-configured}|g" \
      -e "s|{{CODING_MODEL}}|${CODING_MODEL:-${DEFAULT_MODEL:-not-configured}}|g" \
      -e "s|{{WRITING_MODEL}}|${WRITING_MODEL:-${DEFAULT_MODEL:-not-configured}}|g" \
      -e "s|{{SEARCH_MODEL}}|${SEARCH_MODEL:-${DEFAULT_MODEL:-not-configured}}|g" \
      -e "s|{{IMAGE_MODEL}}|${IMAGE_MODEL:-${DEFAULT_MODEL:-not-configured}}|g" \
      "$WORKSPACE_DIR/SOUL.md"
      
    chmod 444 "$WORKSPACE_DIR/SOUL.md"
    log_info "Model routing configured in SOUL.md"
  fi

  # ACIP
  if [ "$ACIP_ENABLED" = "true" ] || [ "$ACIP_ENABLED" = "1" ]; then
    if [ -f "/app/ACIP_SECURITY.md" ]; then
      rm -f "$WORKSPACE_DIR/ACIP_SECURITY.md"
      cp /app/ACIP_SECURITY.md "$WORKSPACE_DIR/ACIP_SECURITY.md"
      chmod 444 "$WORKSPACE_DIR/ACIP_SECURITY.md"
      log_info "Deployed ACIP_SECURITY.md"
    else
      log_warn "ACIP_SECURITY.md not found in image."
    fi
  fi

  # Writable files
  for file in IDENTITY.md WORKING.md HEARTBEAT.md; do
    if [ -f "/app/$file" ] && [ ! -f "$WORKSPACE_DIR/$file" ]; then
      log_info "Creating $file template..."
      cp "/app/$file" "$WORKSPACE_DIR/$file"
      chmod 644 "$WORKSPACE_DIR/$file"
    fi
  done
  
  # Memory templates
  mkdir -p "$MEMORY_DIR"
  for file in self-review.md open-loops.md; do
    if [ -f "/app/templates/memory/$file" ] && [ ! -f "$MEMORY_DIR/$file" ]; then
      log_info "Creating memory/$file template..."
      cp "/app/templates/memory/$file" "$MEMORY_DIR/$file"
      chmod 644 "$MEMORY_DIR/$file"
    fi
  done
  
  # Subagent logs
  if [ ! -d "$SUBAGENT_LOG_DIR" ]; then
    mkdir -p "$SUBAGENT_LOG_DIR"
    chmod 755 "$SUBAGENT_LOG_DIR"
  fi
}

seed_bootstrap_file() {
  # Mirror ensureAgentWorkspace's isBrandNewWorkspace check:
  # only seed BOOTSTRAP.md when NO core workspace files exist yet.
  # This MUST run BEFORE setup_security_files() which creates SOUL.md/IDENTITY.md
  # and would make isBrandNewWorkspace return false.
  for f in AGENTS.md SOUL.md TOOLS.md IDENTITY.md USER.md; do
    if [ -f "$WORKSPACE_DIR/$f" ]; then return 0; fi
  done
  if [ -f "/app/BOOTSTRAP.md" ]; then
    mkdir -p "$WORKSPACE_DIR"
    cp "/app/BOOTSTRAP.md" "$WORKSPACE_DIR/BOOTSTRAP.md"
    chmod 644 "$WORKSPACE_DIR/BOOTSTRAP.md"
    log_info "Seeded BOOTSTRAP.md for new workspace"
  fi
}

run_doctor() {
  local script="/app/openclaw.mjs"
  if [ -f "$script" ]; then
    log_info "Running openclaw doctor --fix..."
    local doctor_output exit_code=0
    doctor_output=$(node "$script" doctor --fix 2>&1) || exit_code=$?
    # Log last 30 lines (full output can be very verbose)
    echo "$doctor_output" | tail -30
    if [ $exit_code -eq 0 ]; then
      log_info "openclaw doctor completed successfully"
    else
      log_warn "openclaw doctor returned exit code $exit_code (non-fatal)"
    fi
  fi
}

sanitize_config() {
  # Prevent crash loops from stale plugin entries in openclaw.json.
  # If plugins.entries references plugins that aren't installed in this image,
  # the gateway will refuse to start (config-guard.ts exits with code 1).
  # This function removes those entries before the gateway sees the config.
  if [ ! -s "$CONFIG_FILE" ]; then return; fi

  node -e "
    const fs = require('fs');
    const configPath = '$CONFIG_FILE';

    let config;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[entrypoint] WARN: Could not parse config for sanitization:', e.message);
      process.exit(0); // non-fatal
    }

    const entries = config?.plugins?.entries;
    if (!entries || typeof entries !== 'object' || Object.keys(entries).length === 0) {
      process.exit(0); // nothing to sanitize
    }

    // Discover installed plugins using OpenClaw's own discovery
    let knownIds;
    try {
      const { discoverOpenClawPlugins } = require('./dist/plugins/discovery.js');
      const workspaceDir = config?.agents?.defaults?.workspace || '/home/node/workspace';
      const extraPaths = config?.plugins?.load?.paths || [];
      const result = discoverOpenClawPlugins({ workspaceDir, extraPaths });

      // Build set of known plugin IDs from candidates
      knownIds = new Set();
      for (const candidate of result.candidates) {
        knownIds.add(candidate.idHint);
      }
    } catch (e) {
      // Fallback: if discovery fails, check for manifest files directly
      console.error('[entrypoint] WARN: Plugin discovery failed, using filesystem fallback:', e.message);
      knownIds = new Set();
      const pluginDirs = ['/app/dist/plugins', '/app/plugins'];
      for (const dir of pluginDirs) {
        try {
          if (fs.existsSync(dir)) {
            for (const item of fs.readdirSync(dir)) {
              const manifestPath = require('path').join(dir, item, 'manifest.json');
              if (fs.existsSync(manifestPath)) {
                try {
                  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                  if (manifest.id) knownIds.add(manifest.id);
                } catch {}
              }
            }
          }
        } catch {}
      }
    }

    // Remove unknown plugin entries
    const removed = [];
    for (const pluginId of Object.keys(entries)) {
      if (!knownIds.has(pluginId)) {
        removed.push(pluginId);
        delete entries[pluginId];
      }
    }

    if (removed.length === 0) {
      process.exit(0);
    }

    // Write sanitized config back
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    for (const id of removed) {
      console.log('[entrypoint] WARN: Removed unknown plugin entry: ' + id + ' (not installed in this image)');
    }
  " 2>&1 || log_warn "Config sanitization script encountered an error (non-fatal)"
}

# scrub_secrets() removed — no longer needed in BYOK mode.
# Instances use the user's own API key directly; no gateway proxy secrets to scrub.

seed_cron_jobs() {
  local enforcer="/app/enforce-config.mjs"
  if [ ! -f "$enforcer" ]; then
    log_warn "enforce-config.mjs not found — skipping cron seed"
    return 0
  fi
  log_info "Seeding default cron jobs (if needed)..."
  node "$enforcer" cron-seed 2>&1 || log_warn "Cron seed returned error (non-fatal)"
}

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------

prepare_fallback_json
check_heartbeat_model
generate_config
seed_bootstrap_file
run_auto_onboard

# Post-onboard enforcements (critical if onboard overwrites config)
enforce_model_settings
enforce_gateway_token
enforce_trusted_proxies

setup_security_files
run_doctor
sanitize_config
seed_cron_jobs

# Execute Command
exec "$@"
