#!/bin/bash
set -e

# Configuration directory
CONFIG_DIR="${MOLTBOT_STATE_DIR:-${CLAWDBOT_STATE_DIR:-/home/node/.clawdbot}}"
CONFIG_FILE="$CONFIG_DIR/moltbot.json"

# Get values from environment
GATEWAY_TOKEN="${CLAWDBOT_GATEWAY_TOKEN:-}"
GATEWAY_BIND="${CLAWDBOT_BIND:-lan}"
GATEWAY_PORT="${CLAWDBOT_GATEWAY_PORT:-${PORT:-18789}}"

# Explicitly set the config path so both the wizard and the gateway use the same file
export OPENCLAW_CONFIG_PATH="$CONFIG_FILE"
echo "[entrypoint] OPENCLAW_CONFIG_PATH set to $OPENCLAW_CONFIG_PATH"

# Security: Disable mDNS/Bonjour broadcasting (prevents information disclosure)
export OPENCLAW_DISABLE_BONJOUR=1

# SaaS mode: disable device auth for Control UI (use token-only auth)
DISABLE_DEVICE_AUTH="${MOLTBOT_DISABLE_DEVICE_AUTH:-false}"

# Model configuration (set via dashboard setup wizard)
DEFAULT_MODEL="${MOLTBOT_DEFAULT_MODEL:-}"

# Create config directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Only run onboarding if config doesn't exist OR if we're in SaaS mode (re-apply SaaS settings)
if [ ! -f "$CONFIG_FILE" ] || [ "$DISABLE_DEVICE_AUTH" = "true" ] || [ "$DISABLE_DEVICE_AUTH" = "1" ]; then
  echo "[entrypoint] Running OpenClaw onboarding..."

  # Build the onboarding command
  # We use --no-install-daemon because we are in Docker (the container IS the daemon)
  # We use --skip-skills by default to speed up boot, unless strictly needed
  # We use --auth-choice skip because we might set model later or let user configure it via UI
  ONBOARD_CMD=(
    "node" "dist/index.js" "onboard"
    "--non-interactive"
    "--mode" "local"
    "--gateway-port" "$GATEWAY_PORT"
    "--gateway-bind" "$GATEWAY_BIND"
    "--no-install-daemon"
    "--skip-skills"
    "--auth-choice" "skip"
    "--accept-risk"
  )

  # Run the onboarding wizard
  echo "[entrypoint] Executing: ${ONBOARD_CMD[*]}"
  "${ONBOARD_CMD[@]}"

  # Apply SaaS-specific overrides and Model config that the wizard might not expose fully via flags yet
  # or that we want to enforce post-onboarding.
  echo "[entrypoint] Applying SaaS configuration overrides..."
  
  node -e "
    const fs = require('fs');
    const path = '$CONFIG_FILE';
    const config = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : {};
    
    // Enforce SaaS settings
    if (!config.gateway) config.gateway = {};
    if (!config.gateway.controlUi) config.gateway.controlUi = {};
    if (!config.gateway.auth) config.gateway.auth = {};
    
    // SaaS mode: Disable device auth (pairing) for Control UI
    if ('$DISABLE_DEVICE_AUTH' === 'true' || '$DISABLE_DEVICE_AUTH' === '1') {
      config.gateway.controlUi.dangerouslyDisableDeviceAuth = true;
    }
    
    // Enforce Token Auth
    config.gateway.auth.mode = 'token';
    config.gateway.auth.token = '$GATEWAY_TOKEN';
    
    // Enforce Logging
    config.logging = { redactSensitive: 'tools' };
    
    // Set Default Model if provided
    if ('$DEFAULT_MODEL') {
      if (!config.agents) config.agents = {};
      if (!config.agents.defaults) config.agents.defaults = {};
      if (!config.agents.defaults.model) config.agents.defaults.model = {};
      config.agents.defaults.model.primary = '$DEFAULT_MODEL';
      console.log('Set default model to: $DEFAULT_MODEL');
    }
    
    fs.writeFileSync(path, JSON.stringify(config, null, 2));
    console.log('Updated configuration at ' + path);
  "

  echo "[entrypoint] Configuration update complete."
  
  # Security: Enforce strict permissions on the config directory and file
  echo "[entrypoint] Enforcing security permissions..."
  chmod 700 "$CONFIG_DIR"
  chmod 600 "$CONFIG_FILE"
  
  if [ -f "$CONFIG_DIR/credentials" ]; then
    echo "[entrypoint] Securing credentials file..."
    chmod 600 "$CONFIG_DIR/credentials"
  fi

else
  echo "[entrypoint] Using existing configuration at $CONFIG_FILE"
fi

# Security: Ensure SOUL.md (Prompt Hardening) is present in the workspace
# This file is copied into the image at build time (/app/SOUL.md)
WORKSPACE_DIR="${CLAWDBOT_WORKSPACE_DIR:-/home/node/clawd}"
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
