#!/bin/bash
set -e

# Configuration directory
CONFIG_DIR="${MOLTBOT_STATE_DIR:-${CLAWDBOT_STATE_DIR:-/home/node/.clawdbot}}"
CONFIG_FILE="$CONFIG_DIR/moltbot.json"

# Get values from environment
GATEWAY_TOKEN="${CLAWDBOT_GATEWAY_TOKEN:-}"
GATEWAY_BIND="${CLAWDBOT_BIND:-lan}"
GATEWAY_PORT="${CLAWDBOT_GATEWAY_PORT:-${PORT:-18789}}"

# Security: Disable mDNS/Bonjour broadcasting (prevents information disclosure)
export OPENCLAW_DISABLE_BONJOUR=1

# SaaS mode: disable device auth for Control UI (use token-only auth)
DISABLE_DEVICE_AUTH="${MOLTBOT_DISABLE_DEVICE_AUTH:-false}"

# Model configuration (set via dashboard setup wizard)
DEFAULT_MODEL="${MOLTBOT_DEFAULT_MODEL:-}"

# Create config directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Only generate config if it doesn't exist OR if we're in SaaS mode
if [ ! -f "$CONFIG_FILE" ] || [ "$DISABLE_DEVICE_AUTH" = "true" ] || [ "$DISABLE_DEVICE_AUTH" = "1" ]; then
  echo "[entrypoint] Generating moltbot.json configuration..."
  
  # Build the configuration JSON
  # Note: We build this dynamically to only include model if set
  if [ -n "$DEFAULT_MODEL" ]; then
    cat > "$CONFIG_FILE" << EOF
{
  "gateway": {
    "mode": "local",
    "port": ${GATEWAY_PORT},
    "bind": "${GATEWAY_BIND}",
    "discovery": { "mdns": { "mode": "off" } },
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
    "discovery": { "mdns": { "mode": "off" } },
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
else
  echo "[entrypoint] Using existing configuration at $CONFIG_FILE"
fi

# Execute the main command
exec "$@"
