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
DISABLE_SUDO="${OPENCLAW_DISABLE_SUDO:-false}"
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

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

check_sudo() {
  if [ "$DISABLE_SUDO" = "true" ] || [ "$DISABLE_SUDO" = "1" ]; then
    if [ -f /etc/sudoers.d/node ]; then
      log_info "Sudo access DISABLED (OPENCLAW_DISABLE_SUDO=true)"
      sudo rm -f /etc/sudoers.d/node 2>/dev/null || true
    fi
  else
    log_info "Sudo access ENABLED"
  fi
}

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
    if [ -n "$AI_GATEWAY_URL" ]; then
      log_info "Credits mode detected - configuring moltbot-gateway via: $AI_GATEWAY_URL"
      MODELS_SECTION=",
      \"models\": {
        \"mode\": \"merge\",
        \"providers\": {
          \"moltbot-gateway\": {
            \"baseUrl\": \"${AI_GATEWAY_URL}/api/gateway\",
            \"apiKey\": \"${GATEWAY_TOKEN}\",
            \"models\": []
          }
        }
      }"
    fi

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

    # In credits mode, route builtin memory search embeddings through the
    # gateway embedding proxy so the fallback works without direct API keys.
    MEMORY_SEARCH_REMOTE=""
    if [ -n "$AI_GATEWAY_URL" ]; then
      MEMORY_SEARCH_REMOTE="
        \"provider\": \"openai\",
        \"model\": \"voyage/voyage-3.5\",
        \"fallback\": \"none\",
        \"remote\": {
          \"baseUrl\": \"${AI_GATEWAY_URL}/api/gateway\",
          \"apiKey\": \"${GATEWAY_TOKEN}\"
        },"
    fi

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
        "prompt": "HEARTBEAT CHECK — Quick scan, silent unless action needed.\n\n1. CHECK WORKING.md — In-progress task? Stalled/blocked?\n2. CHECK memory/self-review.md (last 7 days) — MISS tags matching current context? If yes: counter-check protocol.\n3. CHECK HEARTBEAT.md — Scheduled tasks due? Errors? Urgent items?\n4. RESPONSE: Nothing → HEARTBEAT_OK. User attention needed → brief message (one line max).\n\nNEVER message for: routine status, still running, low-priority completions.",
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
    if node "$script" doctor --fix 2>&1 | head -20; then
      log_info "openclaw doctor completed successfully"
    else
      log_warn "openclaw doctor returned errors (non-fatal)"
    fi
  fi
}

scrub_secrets() {
  if [ ! -s "$CONFIG_FILE" ]; then return; fi
  
  # Only scrub when running in gateway/credits mode (gateway URL is set)
  if [ -z "$AI_GATEWAY_URL" ]; then return; fi
  
  log_info "Scrubbing sensitive environment variables (gateway mode)..."
  
  # Inject a placeholder minimax provider config so resolveApiKeyForProvider
  # finds a "key" during media understanding auto-detection.
  # The actual API call is proxied through the gateway (real key stays server-side).
  # Must include baseUrl + models to satisfy OpenClaw's schema validator.
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE','utf8'));
    cfg.models = cfg.models || {};
    cfg.models.providers = cfg.models.providers || {};
    const mm = cfg.models.providers.minimax || {};
    mm.apiKey = 'gateway-proxied';
    // Schema requires baseUrl (string) and models (array)
    if (!mm.baseUrl) mm.baseUrl = 'https://api.minimax.io/anthropic';
    if (!Array.isArray(mm.models)) mm.models = [];
    cfg.models.providers.minimax = mm;
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2));
  "
  
  # Scrub all sensitive env vars BEFORE exec replaces this process.
  # After exec, /proc/<pid>/environ will be clean.
  unset MINIMAX_API_KEY 2>/dev/null || true
  unset DEEPSEEK_API_KEY 2>/dev/null || true
  unset MOLTBOT_CRON_SECRET 2>/dev/null || true
  
  # Re-enforce config file permissions (only the node user should read it)
  chmod 600 "$CONFIG_FILE"
  
  log_info "Secrets scrubbed — API keys removed from environment"
}

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------

check_sudo
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

# Scrub secrets from env AFTER all config is generated but BEFORE exec.
# This ensures /proc/1/environ is clean for the Node process.
scrub_secrets

# Execute Command
exec "$@"
