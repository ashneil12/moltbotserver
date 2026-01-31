#!/bin/bash
set -e

# =============================================================================
# DEBUG: Print environment info for troubleshooting
# =============================================================================
echo "[entrypoint] === DEBUG INFO ==="
echo "[entrypoint] PATH=$PATH"
echo "[entrypoint] PWD=$(pwd)"
echo "[entrypoint] USER=$(whoami)"
echo "[entrypoint] HOME=$HOME"
if [ -d /app/node_modules/.bin ]; then
  echo "[entrypoint] /app/node_modules/.bin exists"
  echo "[entrypoint] Contents: $(ls /app/node_modules/.bin | head -10)..."
  if [ -f /app/node_modules/.bin/openclaw ]; then
    echo "[entrypoint] openclaw binary found at /app/node_modules/.bin/openclaw"
  else
    echo "[entrypoint] WARNING: openclaw NOT found in /app/node_modules/.bin"
  fi
else
  echo "[entrypoint] WARNING: /app/node_modules/.bin does NOT exist"
fi
echo "[entrypoint] which openclaw: $(which openclaw 2>/dev/null || echo 'not in PATH')"
echo "[entrypoint] === END DEBUG ==="

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

# Create config directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Only generate config if it doesn't exist OR if we're in SaaS mode
if [ ! -f "$CONFIG_FILE" ] || [ "$DISABLE_DEVICE_AUTH" = "true" ] || [ "$DISABLE_DEVICE_AUTH" = "1" ]; then
  echo "[entrypoint] Generating openclaw.json configuration..."
  
  # Build the configuration JSON
  # Note: We build this dynamically to only include model if set
  if [ -n "$DEFAULT_MODEL" ]; then
    cat > "$CONFIG_FILE" << EOF
{
  "gateway": {
    "mode": "local",
    "port": ${GATEWAY_PORT},
    "bind": "${GATEWAY_BIND}",
    "trustedProxies": ["10.0.0.0/8", "172.16.0.0/12"],
    "controlUi": {
      "enabled": true,
      "dangerouslyDisableDeviceAuth": true
    },
    "auth": {
      "mode": "token",
      "token": "${GATEWAY_TOKEN}"
    }
  },
  "logging": { "redactSensitive": "tools" },
  "agents": {
    "defaults": {
      "model": {
        "primary": "${DEFAULT_MODEL}"
      }
    }
  }
}
EOF
    echo "[entrypoint] Default model: ${DEFAULT_MODEL}"
  else
    cat > "$CONFIG_FILE" << EOF
{
  "gateway": {
    "mode": "local",
    "port": ${GATEWAY_PORT},
    "bind": "${GATEWAY_BIND}",
    "trustedProxies": ["10.0.0.0/8", "172.16.0.0/12"],
    "controlUi": {
      "enabled": true,
      "dangerouslyDisableDeviceAuth": true
    },
    "auth": {
      "mode": "token",
      "token": "${GATEWAY_TOKEN}"
    }
  },
  "logging": { "redactSensitive": "tools" }
}
EOF
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
    elif [ "$AUTH_CHOICE" = "gemini-api-key" ] && [ -n "${GEMINI_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--gemini-api-key" "$GEMINI_API_KEY")
    elif [ "$AUTH_CHOICE" = "xai-api-key" ] && [ -n "${XAI_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--xai-api-key" "$XAI_API_KEY")
    elif [ "$AUTH_CHOICE" = "moonshot-api-key" ] && [ -n "${MOONSHOT_API_KEY:-}" ]; then
      ONBOARD_CMD+=("--moonshot-api-key" "$MOONSHOT_API_KEY")
    fi
    
    # Run the onboard command
    # Print a safe version of the command for logging
    echo "[entrypoint] Running: openclaw onboard --non-interactive ... [auth-choice: ${AUTH_CHOICE}]"
    
    if "${ONBOARD_CMD[@]}"; then
      echo "[entrypoint] Auto-onboard completed successfully"
      touch "$ONBOARD_MARKER"
    else
      echo "[entrypoint] Auto-onboard failed, continuing with manual setup required"
    fi
  else
    echo "[entrypoint] Auto-onboard already completed (marker exists)"
  fi
fi

# Security: Ensure SOUL.md (Prompt Hardening) is present in the workspace
# This file is copied into the image at build time (/app/SOUL.md)
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-${CLAWDBOT_WORKSPACE_DIR:-/home/node/clawd}}"
if [ -f "/app/SOUL.md" ]; then
  mkdir -p "$WORKSPACE_DIR"
  echo "[entrypoint] Copying security rules (SOUL.md) to workspace..."
  
  # Remove existing readonly file if it exists so we can update it
  if [ -f "$WORKSPACE_DIR/SOUL.md" ]; then
    rm -f "$WORKSPACE_DIR/SOUL.md"
  fi
  
  cp /app/SOUL.md "$WORKSPACE_DIR/SOUL.md"
  # Set strict read-only permissions for the SOUL file so it can't be easily modified by the agent itself
  chmod 444 "$WORKSPACE_DIR/SOUL.md"
fi

# Execute the main command
exec "$@"
