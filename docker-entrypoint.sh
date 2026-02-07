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
GATEWAY_BIND="${OPENCLAW_BIND:-${CLAWDBOT_BIND:-lan}}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-${CLAWDBOT_GATEWAY_PORT:-${PORT:-18789}}}"


# Security: Disable mDNS/Bonjour broadcasting (prevents information disclosure)
export OPENCLAW_DISABLE_BONJOUR=1

# SaaS mode: disable device auth for Control UI (use token-only auth)
DISABLE_DEVICE_AUTH="${OPENCLAW_DISABLE_DEVICE_AUTH:-${MOLTBOT_DISABLE_DEVICE_AUTH:-false}}"

# Model configuration (set via dashboard setup wizard)
# Check OPENCLAW_ONBOARD_MODEL as fallback (set by onboarding flow)
DEFAULT_MODEL="${OPENCLAW_DEFAULT_MODEL:-${OPENCLAW_ONBOARD_MODEL:-${MOLTBOT_DEFAULT_MODEL:-}}}"
SUBAGENT_MODEL="${OPENCLAW_SUBAGENT_MODEL:-deepseek/deepseek-reasoner}"
HEARTBEAT_MODEL="${OPENCLAW_HEARTBEAT_MODEL:-${HEARTBEAT_MODEL:-}}"
HEARTBEAT_INTERVAL="${OPENCLAW_HEARTBEAT_INTERVAL:-15m}"
FALLBACK_MODELS_RAW="${OPENCLAW_FALLBACK_MODELS:-}"

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
    # Note: apiKey is sent as Authorization: Bearer header by OpenClaw
    # The models array is required - we define a catch-all pattern
    MODELS_SECTION=",
  \"models\": {
    \"mode\": \"merge\",
    \"providers\": {
      \"vercel-ai-gateway\": {
        \"baseUrl\": \"${AI_GATEWAY_URL}/api/gateway\",
        \"apiKey\": \"${GATEWAY_TOKEN}\",
        \"api\": \"openai-completions\",
        \"models\": [
          { \"id\": \"*\", \"name\": \"All Models (via Gateway)\" }
        ]
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
  "agents": {
    "defaults": {
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
      "memorySearch": {
        "experimental": { "sessionMemory": true },
        "sources": ["memory", "sessions"]
      },
      "subagents": {
        "model": "${SUBAGENT_MODEL}"
      },
      "heartbeat": {
        "every": "${HEARTBEAT_INTERVAL}",
        "prompt": "Read HEARTBEAT.md and follow it. Check memory/self-review.md for recent patterns. If nothing needs attention, reply HEARTBEAT_OK.",
        "model": "${HEARTBEAT_MODEL}"
      }
    }
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
    if [ "$AUTH_CHOICE" = "gateway-token" ]; then
        # Gateway mode uses standard OpenAI client pointing to dashboard gateway
        # No specific provider key needed here as it uses the gateway token
        echo "[entrypoint] Using Gateway Token auth mode"
    elif [ "$AUTH_CHOICE" = "ai-gateway-api-key" ] && [ -n "${AI_GATEWAY_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--ai-gateway-api-key" "$AI_GATEWAY_API_KEY")
    elif [ "$AUTH_CHOICE" = "apiKey" ] && [ -n "${ANTHROPIC_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--anthropic-api-key" "$ANTHROPIC_API_KEY")
    elif [ "$AUTH_CHOICE" = "openai-api-key" ] && [ -n "${OPENAI_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--openai-api-key" "$OPENAI_API_KEY")
    elif [ "$AUTH_CHOICE" = "gemini-api-key" ] && [ -n "${GEMINI_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--gemini-api-key" "$GEMINI_API_KEY")
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

  # Enforce model compliance on every boot (fresh or restart) if env var is set
  if [ -n "$ONBOARD_MODEL" ] && [ -s "$CONFIG_FILE" ]; then
    echo "[entrypoint] Enforcing model from env: $ONBOARD_MODEL"
    node "$OPENCLAW_SCRIPT" models set "$ONBOARD_MODEL" || echo "[entrypoint] WARNING: Failed to set default model"
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
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-${CLAWDBOT_WORKSPACE_DIR:-/home/node/clawd}}"

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

  if [ "$ACIP_ENABLED" = "true" ] || [ "$ACIP_ENABLED" = "1" ]; then
      echo "[entrypoint] ACIP Security enabled. Using bundled ACIP v1.3 rules..."
      # Use bundled ACIP security rules (no network fetch required)
      if [ -f "/app/ACIP_SECURITY.md" ]; then
          cp /app/ACIP_SECURITY.md "$WORKSPACE_DIR/SOUL.md"
          echo "[entrypoint] Successfully deployed ACIP v1.3 security rules."
      else
          echo "[entrypoint] WARNING: ACIP_SECURITY.md not found. Falling back to built-in SOUL.md."
          cp /app/SOUL.md "$WORKSPACE_DIR/SOUL.md"
      fi
  else
      echo "[entrypoint] ACIP Security disabled (OPENCLAW_ACIP_ENABLED=$ACIP_ENABLED). Using default rules."
      cp /app/SOUL.md "$WORKSPACE_DIR/SOUL.md"
  fi
  
  # Set strict read-only permissions for the SOUL file so it can't be easily modified by the agent itself
  chmod 444 "$WORKSPACE_DIR/SOUL.md"
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

# Execute the main command
exec "$@"
