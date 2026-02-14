#!/bin/bash
set -e

# =============================================================================
# OpenClaw Entrypoint
# =============================================================================

# Runtime sudo toggle - allows disabling sudo without rebuilding
# When OPENCLAW_DISABLE_SUDO=true, remove node from sudoers
DISABLE_SUDO="${OPENCLAW_DISABLE_SUDO:-false}"
if [ "$DISABLE_SUDO" = "true" ] || [ "$DISABLE_SUDO" = "1" ]; then
  if [ -f /etc/sudoers.d/node ]; then
    echo "[entrypoint] Sudo access DISABLED (OPENCLAW_DISABLE_SUDO=true)"
    # This requires sudo to work once to remove itself - that's fine since we still have it at startup
    sudo rm -f /etc/sudoers.d/node 2>/dev/null || true
  fi
else
  echo "[entrypoint] Sudo access ENABLED"
fi

# Configuration directory
CONFIG_DIR="${OPENCLAW_STATE_DIR:-${MOLTBOT_STATE_DIR:-${CLAWDBOT_STATE_DIR:-/home/node/.clawdbot}}}"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"

# Get values from environment
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-${CLAWDBOT_GATEWAY_TOKEN:-}}"
GATEWAY_BIND="${OPENCLAW_BIND:-${CLAWDBOT_BIND:-custom}}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-${CLAWDBOT_GATEWAY_PORT:-${PORT:-18789}}}"


# Security: Disable mDNS/Bonjour broadcasting (prevents information disclosure)
export OPENCLAW_DISABLE_BONJOUR=1

# SaaS mode: disable device auth for Control UI (use token-only auth)
DISABLE_DEVICE_AUTH="${OPENCLAW_DISABLE_DEVICE_AUTH:-${MOLTBOT_DISABLE_DEVICE_AUTH:-false}}"

# Model configuration (set via dashboard setup wizard)
# Check OPENCLAW_ONBOARD_MODEL as fallback (set by onboarding flow)
DEFAULT_MODEL="${OPENCLAW_DEFAULT_MODEL:-${OPENCLAW_ONBOARD_MODEL:-${MOLTBOT_DEFAULT_MODEL:-}}}"
COMPLEX_MODEL="${OPENCLAW_COMPLEX_MODEL:-${DEFAULT_MODEL}}"
SUBAGENT_MODEL="${OPENCLAW_SUBAGENT_MODEL:-deepseek/deepseek-reasoner}"
HEARTBEAT_MODEL="${OPENCLAW_HEARTBEAT_MODEL:-${HEARTBEAT_MODEL:-}}"
HEARTBEAT_INTERVAL="${OPENCLAW_HEARTBEAT_INTERVAL:-15m}"
FALLBACK_MODELS_RAW="${OPENCLAW_FALLBACK_MODELS:-}"

# Capability-specific models for prompt-based routing
# These inject model names into SOUL_DELEGATION_SNIPPET.md so the agent
# uses sessions_spawn(model: "...") with the right model per task type
CODING_MODEL="${OPENCLAW_CODING_MODEL:-${DEFAULT_MODEL}}"
WRITING_MODEL="${OPENCLAW_WRITING_MODEL:-${DEFAULT_MODEL}}"
SEARCH_MODEL="${OPENCLAW_SEARCH_MODEL:-${DEFAULT_MODEL}}"
IMAGE_MODEL="${OPENCLAW_IMAGE_MODEL:-${DEFAULT_MODEL}}"

# Concurrency settings (configurable via dashboard)
MAX_CONCURRENT="${OPENCLAW_MAX_CONCURRENT:-4}"
SUBAGENT_MAX_CONCURRENT="${OPENCLAW_SUBAGENT_MAX_CONCURRENT:-8}"

# Human delay settings (natural response timing for messaging channels)
HUMAN_DELAY_ENABLED="${OPENCLAW_HUMAN_DELAY_ENABLED:-false}"
HUMAN_DELAY_MIN="${OPENCLAW_HUMAN_DELAY_MIN:-800}"
HUMAN_DELAY_MAX="${OPENCLAW_HUMAN_DELAY_MAX:-2500}"

# Agent workspace directory (where SOUL.md, WORKING.md, memory/ etc live)
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-${CLAWDBOT_WORKSPACE_DIR:-/home/node/workspace}}"

# AI Gateway URL (for credits mode - routes through Dashboard's gateway)
# When set, configures vercel-ai-gateway provider to use Dashboard as proxy
AI_GATEWAY_URL="${OPENCLAW_AI_GATEWAY_URL:-}"

# Build fallback model JSON array from comma-separated list
FALLBACK_JSON="[]"
if [ -n "$FALLBACK_MODELS_RAW" ]; then
  IFS=',' read -ra FALLBACK_LIST <<< "$FALLBACK_MODELS_RAW"
  FALLBACK_JSON="["
  first=1
  for item in "${FALLBACK_LIST[@]}"; do
    trimmed=$(echo "$item" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    if [ -n "$trimmed" ]; then
      if [ $first -eq 0 ]; then
        FALLBACK_JSON+=", "
      fi
      FALLBACK_JSON+="\"$trimmed\""
      first=0
    fi
  done
  FALLBACK_JSON+="]"
  if [ $first -eq 1 ]; then
    FALLBACK_JSON="[]"
  fi
fi

# Heartbeat model must be explicit; fall back to DEFAULT_MODEL if missing
if [ -z "$HEARTBEAT_MODEL" ]; then
  if [ -n "$DEFAULT_MODEL" ]; then
    echo "[entrypoint] WARNING: HEARTBEAT_MODEL not set; falling back to DEFAULT_MODEL"
    HEARTBEAT_MODEL="$DEFAULT_MODEL"
  else
    echo "[entrypoint] WARNING: HEARTBEAT_MODEL not set and DEFAULT_MODEL is empty"
  fi
fi

# Create config directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Only generate config if it doesn't exist OR if we're in SaaS mode
if [ ! -f "$CONFIG_FILE" ] || [ "$DISABLE_DEVICE_AUTH" = "true" ] || [ "$DISABLE_DEVICE_AUTH" = "1" ]; then
  echo "[entrypoint] Generating openclaw.json configuration..."
  
  # Build optional models.providers section for credits mode (vercel-ai-gateway routing)
  MODELS_SECTION=""
  if [ -n "$AI_GATEWAY_URL" ]; then
    echo "[entrypoint] Credits mode detected - configuring vercel-ai-gateway provider via: $AI_GATEWAY_URL"
    # Override baseUrl so requests route through the Dashboard's billing proxy
    # instead of directly to https://ai-gateway.vercel.sh.
    # The apiKey (gateway_token) is sent as x-api-key by the Anthropic SDK.
    # We keep the native anthropic-messages format — the proxy handles it transparently.
    MODELS_SECTION=",
  \"models\": {
    \"mode\": \"merge\",
    \"providers\": {
      \"vercel-ai-gateway\": {
        \"baseUrl\": \"${AI_GATEWAY_URL}/api/gateway\",
        \"apiKey\": \"${GATEWAY_TOKEN}\",
        \"models\": []
      }
    }
  }"
  fi
  
  # Build the configuration JSON
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
        "waitForBootSync": false
      },
      "limits": {
        "maxResults": 8,
        "maxSnippetChars": 700,
        "timeoutMs": 5000
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
        "experimental": { "sessionMemory": true },
        "sources": ["memory", "sessions"]
      },
      "subagents": {
        "model": "${SUBAGENT_MODEL}",
        "maxConcurrent": ${SUBAGENT_MAX_CONCURRENT}
      },
      "heartbeat": {
        "every": "${HEARTBEAT_INTERVAL}",
        "prompt": "Read HEARTBEAT.md and follow it. Check memory/self-review.md for recent patterns. If nothing needs attention, reply HEARTBEAT_OK.",
        "model": "${HEARTBEAT_MODEL}"
      },
      "maxConcurrent": ${MAX_CONCURRENT}
    }
  },
  "messages": {
    "queue": {
      "mode": "collect"
    }$(if [ "$HUMAN_DELAY_ENABLED" = "true" ] || [ "$HUMAN_DELAY_ENABLED" = "1" ]; then echo ",
    \"humanDelay\": {
      \"min\": ${HUMAN_DELAY_MIN},
      \"max\": ${HUMAN_DELAY_MAX}
    }"; fi)
  }
}
EOF
  if [ -n "$DEFAULT_MODEL" ]; then
    echo "[entrypoint] Default model: ${DEFAULT_MODEL}"
  else
    echo "[entrypoint] WARNING: OPENCLAW_DEFAULT_MODEL is empty"
  fi
  
  echo "[entrypoint] Configuration generated at $CONFIG_FILE"
  echo "[entrypoint] dangerouslyDisableDeviceAuth: true (SaaS mode)"
  
  # Security: Enforce strict permissions on the config directory and file
  echo "[entrypoint] Enforcing security permissions..."
  chmod 700 "$CONFIG_DIR"
  chmod 600 "$CONFIG_FILE"

else
  echo "[entrypoint] Using existing configuration at $CONFIG_FILE"
fi

# =============================================================================
# AUTO-ONBOARD: Run non-interactive onboard when OPENCLAW_AUTO_ONBOARD=true
# This allows the dashboard to pre-configure instances during deployment
# =============================================================================
AUTO_ONBOARD="${OPENCLAW_AUTO_ONBOARD:-false}"
ONBOARD_MARKER="$CONFIG_DIR/.onboard-complete"

if [ "$AUTO_ONBOARD" = "true" ] || [ "$AUTO_ONBOARD" = "1" ]; then
  # Only run onboard once (check for marker file)
  if [ ! -f "$ONBOARD_MARKER" ]; then
    echo "[entrypoint] Auto-onboard enabled, running non-interactive setup..."
    
    # Build the onboard command as an array to safely handle arguments
    # NOTE: openclaw.mjs is the CLI entry point - run it directly with node
    # (bin symlinks in node_modules/.bin only work for dependencies, not root package)
    OPENCLAW_SCRIPT="/app/openclaw.mjs"
    if [ ! -f "$OPENCLAW_SCRIPT" ]; then
      echo "[entrypoint] FATAL: openclaw.mjs not found at $OPENCLAW_SCRIPT"
      echo "[entrypoint] Listing /app contents:"
      ls -la /app/ | head -20
    else
      echo "[entrypoint] Using openclaw script: $OPENCLAW_SCRIPT"
    fi
    ONBOARD_CMD=("node" "$OPENCLAW_SCRIPT" "onboard" "--non-interactive" "--accept-risk" "--mode" "local" "--gateway-port" "${GATEWAY_PORT}" "--gateway-bind" "lan" "--skip-skills")
    
    # Add auth choice if specified
    AUTH_CHOICE="${OPENCLAW_ONBOARD_AUTH_CHOICE:-}"
    if [ -n "$AUTH_CHOICE" ]; then
      ONBOARD_CMD+=("--auth-choice" "$AUTH_CHOICE")
    fi
    
    # Add API keys based on auth choice - DO NOT LOG THESE VALUES
    if [ "$AUTH_CHOICE" = "ai-gateway-api-key" ] && [ -n "${AI_GATEWAY_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--ai-gateway-api-key" "$AI_GATEWAY_API_KEY")
    elif [ "$AUTH_CHOICE" = "apiKey" ] && [ -n "${ANTHROPIC_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--anthropic-api-key" "$ANTHROPIC_API_KEY")
    elif [ "$AUTH_CHOICE" = "openai-api-key" ] && [ -n "${OPENAI_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--openai-api-key" "$OPENAI_API_KEY")
    elif [ "$AUTH_CHOICE" = "gemini-api-key" ] && [ -n "${GEMINI_API_KEY:-${GOOGLE_API_KEY:-}}" ]; then
      ONBOARD_CMD+=("--gemini-api-key" "${GEMINI_API_KEY:-${GOOGLE_API_KEY}}")
    elif [ "$AUTH_CHOICE" = "xai-api-key" ] && [ -n "${XAI_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--xai-api-key" "$XAI_API_KEY")
    elif [ "$AUTH_CHOICE" = "moonshot-api-key" ] && [ -n "${MOONSHOT_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--moonshot-api-key" "$MOONSHOT_API_KEY")
    elif [ "$AUTH_CHOICE" = "zai-api-key" ] && [ -n "${ZAI_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--zai-api-key" "$ZAI_API_KEY")
    elif [ "$AUTH_CHOICE" = "venice-api-key" ] && [ -n "${VENICE_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--venice-api-key" "$VENICE_API_KEY")
    fi

    # Add model if specified (dashboard passes OPENCLAW_ONBOARD_MODEL, fallback to default)
    ONBOARD_MODEL="${OPENCLAW_ONBOARD_MODEL:-${OPENCLAW_DEFAULT_MODEL:-}}"
    # NOTE: "onboard" command doesn't support --model flag, so we set it AFTER onboarding

    
    # Run the onboard command
    # Print a safe version of the command for logging
    echo "[entrypoint] Running: openclaw onboard --non-interactive ... [auth-choice: ${AUTH_CHOICE}]"
    
    if "${ONBOARD_CMD[@]}"; then
      echo "[entrypoint] Auto-onboard completed successfully"
      touch "$ONBOARD_MARKER"
    else
      echo "[entrypoint] Auto-onboard command returned error code"
      # Check if config was generated anyway (likely failed on connection test)
      if [ -s "$CONFIG_FILE" ]; then
         echo "[entrypoint] Config file generated successfully ($CONFIG_FILE). Ignoring connection error."
         touch "$ONBOARD_MARKER"
      else
         echo "[entrypoint] Auto-onboard failed and no config generated. Manual setup required."
      fi
    fi

  else
    echo "[entrypoint] Auto-onboard already completed (marker exists)"
  fi

  # CRITICAL: Re-enforce ALL model settings from env vars after onboard.
  # The onboard process overwrites agents.defaults.model.primary with its own
  # default (anthropic/claude-opus-4.6). We must patch the config to restore
  # the preset models that the entrypoint originally set.
  if [ -s "$CONFIG_FILE" ]; then
    echo "[entrypoint] Re-enforcing preset model settings after onboard..."
    if command -v jq &> /dev/null; then
      JQ_FILTER='.'
      if [ -n "$DEFAULT_MODEL" ]; then
        JQ_FILTER="$JQ_FILTER | .agents.defaults.model.primary = \"$DEFAULT_MODEL\""
      fi
      if [ -n "$HEARTBEAT_MODEL" ]; then
        JQ_FILTER="$JQ_FILTER | .agents.defaults.heartbeat.model = \"$HEARTBEAT_MODEL\""
      fi
      if [ -n "$SUBAGENT_MODEL" ]; then
        JQ_FILTER="$JQ_FILTER | .agents.defaults.subagents.model = \"$SUBAGENT_MODEL\""
      fi
      if [ "$FALLBACK_JSON" != "[]" ]; then
        JQ_FILTER="$JQ_FILTER | .agents.defaults.model.fallbacks = $FALLBACK_JSON"
      fi
      jq "$JQ_FILTER" "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    else
      node -e "
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
    fi
    echo "[entrypoint] Preset models enforced: primary=${DEFAULT_MODEL:-<unset>} heartbeat=${HEARTBEAT_MODEL:-<unset>} subagent=${SUBAGENT_MODEL:-<unset>}"
  fi

  # CRITICAL: Re-apply gateway token AFTER onboard (onboard may overwrite it)
  # This ensures the token in the config matches what the dashboard expects
  if [ -n "$GATEWAY_TOKEN" ] && [ -s "$CONFIG_FILE" ]; then
    echo "[entrypoint] Enforcing gateway token from env..."
    # Use jq if available, otherwise use node for JSON manipulation
    if command -v jq &> /dev/null; then
      jq --arg token "$GATEWAY_TOKEN" '.gateway.auth.token = $token | .gateway.auth.mode = "token"' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    else
      # Fallback: use node to patch the config
      node -e "
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
        config.gateway = config.gateway || {};
        config.gateway.auth = config.gateway.auth || {};
        config.gateway.auth.mode = 'token';
        config.gateway.auth.token = '$GATEWAY_TOKEN';
        fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
      "
    fi
    echo "[entrypoint] Gateway token enforced"
  fi

  # CRITICAL: Enforce trustedProxies for Coolify/Traefik reverse proxy compatibility
  # This allows WebSocket connections from behind the proxy to work properly
  if [ -s "$CONFIG_FILE" ]; then
    echo "[entrypoint] Enforcing trustedProxies for reverse proxy compatibility..."
    if command -v jq &> /dev/null; then
      jq '.gateway.trustedProxies = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"]' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    else
      node -e "
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
        config.gateway = config.gateway || {};
        config.gateway.trustedProxies = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8'];
        fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
      "
    fi
    echo "[entrypoint] trustedProxies enforced"
  fi
fi

# Security: Ensure SOUL.md (Prompt Hardening) is present in the workspace
# This file is copied into the image at build time (/app/SOUL.md)
# WORKSPACE_DIR already set above (used in config generation and here for file deployment)

# Check if ACIP (Advanced Cognitive Inoculation Prompt) is enabled
# Defaults to true for security
ACIP_ENABLED="${OPENCLAW_ACIP_ENABLED:-true}"

if [ -f "/app/SOUL.md" ]; then
  mkdir -p "$WORKSPACE_DIR"
  echo "[entrypoint] Setting up security rules (SOUL.md)..."
  
  # Remove existing readonly file if it exists so we can update it
  if [ -f "$WORKSPACE_DIR/SOUL.md" ]; then
    rm -f "$WORKSPACE_DIR/SOUL.md"
  fi

  # Always start with SOUL.md as the base (operational instructions, delegation, routing, etc.)
  cp /app/SOUL.md "$WORKSPACE_DIR/SOUL.md"

  # Set strict read-only permissions for the SOUL file so it can't be easily modified by the agent itself
  chmod 444 "$WORKSPACE_DIR/SOUL.md"

  # Deploy ACIP_SECURITY.md as a standalone readable workspace reference file
  # The orchestrator's SOUL.md instructs it to inject ACIP into sub-agent tasks for external-facing work
  if [ "$ACIP_ENABLED" = "true" ] || [ "$ACIP_ENABLED" = "1" ]; then
      if [ -f "/app/ACIP_SECURITY.md" ]; then
          cp /app/ACIP_SECURITY.md "$WORKSPACE_DIR/ACIP_SECURITY.md"
          chmod 444 "$WORKSPACE_DIR/ACIP_SECURITY.md"
          echo "[entrypoint] Deployed ACIP_SECURITY.md as workspace reference (context-based injection)."
      else
          echo "[entrypoint] WARNING: ACIP_SECURITY.md not found in image. External sub-agents will lack security hardening."
      fi
  else
      echo "[entrypoint] ACIP Security disabled (OPENCLAW_ACIP_ENABLED=$ACIP_ENABLED). Skipping ACIP_SECURITY.md deployment."
  fi
fi

# Template-render model routing in SOUL.md
# SOUL.md contains {{TOKEN}} placeholders in the routing table — replace with actual model names
if [ -f "$WORKSPACE_DIR/SOUL.md" ]; then
  chmod 644 "$WORKSPACE_DIR/SOUL.md"
  sed -i \
    -e "s|{{PRIMARY_MODEL}}|${COMPLEX_MODEL:-not-configured}|g" \
    -e "s|{{SUBAGENT_MODEL}}|${SUBAGENT_MODEL:-not-configured}|g" \
    -e "s|{{CODING_MODEL}}|${CODING_MODEL:-${DEFAULT_MODEL:-not-configured}}|g" \
    -e "s|{{WRITING_MODEL}}|${WRITING_MODEL:-${DEFAULT_MODEL:-not-configured}}|g" \
    -e "s|{{SEARCH_MODEL}}|${SEARCH_MODEL:-${DEFAULT_MODEL:-not-configured}}|g" \
    -e "s|{{IMAGE_MODEL}}|${IMAGE_MODEL:-${DEFAULT_MODEL:-not-configured}}|g" \
    "$WORKSPACE_DIR/SOUL.md"
  chmod 444 "$WORKSPACE_DIR/SOUL.md"
  echo "[entrypoint] Model routing configured: coding=${CODING_MODEL:-default} writing=${WRITING_MODEL:-default} search=${SEARCH_MODEL:-default} image=${IMAGE_MODEL:-default}"
fi

# Deploy IDENTITY.md (writable self-evolution file) if it doesn't exist
# Unlike SOUL.md which is read-only for security, IDENTITY.md is meant to evolve
if [ -f "/app/IDENTITY.md" ]; then
  if [ ! -f "$WORKSPACE_DIR/IDENTITY.md" ]; then
    echo "[entrypoint] Creating IDENTITY.md template (writable self-evolution file)..."
    cp "/app/IDENTITY.md" "$WORKSPACE_DIR/IDENTITY.md"
    # IDENTITY.md should be writable (agent needs to update it for self-improvement)
    chmod 644 "$WORKSPACE_DIR/IDENTITY.md"
  else
    echo "[entrypoint] IDENTITY.md exists, skipping template copy to preserve evolved identity."
  fi
fi

# [MOLTBOT CUSTOMIZATION START] - Memory & task persistence
# Deploy WORKING.md template if it doesn't exist
if [ -f "/app/WORKING.md" ]; then
  # Only create if it doesn't exist (don't overwrite user's work)
  if [ ! -f "$WORKSPACE_DIR/WORKING.md" ]; then
    echo "[entrypoint] Creating WORKING.md template..."
    cp /app/WORKING.md "$WORKSPACE_DIR/WORKING.md"
    # WORKING.md should be writable (agent needs to update it)
    chmod 644 "$WORKSPACE_DIR/WORKING.md"
  fi
fi

# Create memory directory structure
MEMORY_DIR="$WORKSPACE_DIR/memory"
if [ ! -d "$MEMORY_DIR" ]; then
  echo "[entrypoint] Creating memory directory..."
  mkdir -p "$MEMORY_DIR"
fi

# Deploy self-review template if it doesn't exist
if [ -f "/app/templates/memory/self-review.md" ]; then
  if [ ! -f "$MEMORY_DIR/self-review.md" ]; then
    echo "[entrypoint] Creating memory/self-review.md template..."
    cp /app/templates/memory/self-review.md "$MEMORY_DIR/self-review.md"
    chmod 644 "$MEMORY_DIR/self-review.md"
  fi
fi

# Deploy open-loops template if it doesn't exist
if [ -f "/app/templates/memory/open-loops.md" ]; then
  if [ ! -f "$MEMORY_DIR/open-loops.md" ]; then
    echo "[entrypoint] Creating memory/open-loops.md template..."
    cp /app/templates/memory/open-loops.md "$MEMORY_DIR/open-loops.md"
    chmod 644 "$MEMORY_DIR/open-loops.md"
  fi
fi

# Deploy HEARTBEAT.md template if it doesn't exist
if [ -f "/app/HEARTBEAT.md" ]; then
  if [ ! -f "$WORKSPACE_DIR/HEARTBEAT.md" ]; then
    echo "[entrypoint] Creating HEARTBEAT.md template..."
    cp /app/HEARTBEAT.md "$WORKSPACE_DIR/HEARTBEAT.md"
    chmod 644 "$WORKSPACE_DIR/HEARTBEAT.md"
  fi
fi

# [MOLTBOT CUSTOMIZATION END]

# Create subagent log directory
SUBAGENT_LOG_DIR="$WORKSPACE_DIR/subagent-logs"
if [ ! -d "$SUBAGENT_LOG_DIR" ]; then
  mkdir -p "$SUBAGENT_LOG_DIR"
  chmod 755 "$SUBAGENT_LOG_DIR"
  echo "[entrypoint] Created subagent log directory"
fi

# =============================================================================
# RUN OPENCLAW DOCTOR: Auto-repair common issues before gateway start
# =============================================================================
OPENCLAW_DOCTOR_SCRIPT="/app/openclaw.mjs"
if [ -f "$OPENCLAW_DOCTOR_SCRIPT" ]; then
  echo "[entrypoint] Running openclaw doctor --fix..."
  if node "$OPENCLAW_DOCTOR_SCRIPT" doctor --fix 2>&1 | head -20; then
    echo "[entrypoint] openclaw doctor completed successfully"
  else
    echo "[entrypoint] WARNING: openclaw doctor returned errors (non-fatal, continuing)"
  fi
fi

# Execute the main command
exec "$@"
