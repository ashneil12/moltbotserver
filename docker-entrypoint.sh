#!/bin/bash
set -e

# Configuration directory
CONFIG_DIR="${MOLTBOT_STATE_DIR:-${CLAWDBOT_STATE_DIR:-/home/node/.clawdbot}}"
CONFIG_FILE="$CONFIG_DIR/moltbot.json"

# Get values from environment
GATEWAY_TOKEN="${CLAWDBOT_GATEWAY_TOKEN:-}"
GATEWAY_BIND="${CLAWDBOT_BIND:-lan}"
GATEWAY_PORT="${CLAWDBOT_GATEWAY_PORT:-${PORT:-18789}}"

# SaaS mode: disable device auth for Control UI (use token-only auth)
DISABLE_DEVICE_AUTH="${MOLTBOT_DISABLE_DEVICE_AUTH:-false}"

# Create config directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Only generate config if it doesn't exist OR if we're in SaaS mode
if [ ! -f "$CONFIG_FILE" ] || [ "$DISABLE_DEVICE_AUTH" = "true" ] || [ "$DISABLE_DEVICE_AUTH" = "1" ]; then
  echo "[entrypoint] Generating moltbot.json configuration..."
  
  # Build the configuration JSON
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
  }
}
EOF
  
  echo "[entrypoint] Configuration generated at $CONFIG_FILE"
  echo "[entrypoint] dangerouslyDisableDeviceAuth: true (SaaS mode)"
else
  echo "[entrypoint] Using existing configuration at $CONFIG_FILE"
fi

# Execute the main command
exec "$@"
