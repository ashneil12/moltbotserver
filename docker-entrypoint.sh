#!/bin/bash
set -e

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
DEFAULT_MODEL="${OPENCLAW_DEFAULT_MODEL:-${MOLTBOT_DEFAULT_MODEL:-}}"

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
