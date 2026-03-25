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

# Fix Docker volume ownership — ensure config/workspace dirs exist and have
# correct permissions.  While the gateway now runs as root, the node user
# (uid 1000) may still own files from older deployments.
CONFIG_DIR="${OPENCLAW_STATE_DIR:-${MOLTBOT_STATE_DIR:-${CLAWDBOT_STATE_DIR:-/home/node/.clawdbot}}}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-${CLAWDBOT_WORKSPACE_DIR:-/home/node/workspace}}"
for dir in "$CONFIG_DIR" "$WORKSPACE_DIR" /home/node; do
  if [ -d "$dir" ] && [ "$(stat -c '%u' "$dir" 2>/dev/null || echo 0)" != "1000" ]; then
    chown -R node:node "$dir" 2>/dev/null || true
  fi
  mkdir -p "$dir" 2>/dev/null && chown node:node "$dir" 2>/dev/null || true
done

# Configuration directory
CONFIG_FILE="$CONFIG_DIR/openclaw.json"

# Get values from environment
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-${CLAWDBOT_GATEWAY_TOKEN:-}}"
GATEWAY_BIND="${OPENCLAW_BIND:-${CLAWDBOT_BIND:-lan}}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-${CLAWDBOT_GATEWAY_PORT:-${PORT:-18789}}}"


# Security: Disable mDNS/Bonjour broadcasting (prevents information disclosure)
export OPENCLAW_DISABLE_BONJOUR=1
# OPENCLAW_MANAGED_PLATFORM is injected by the dashboard's docker-compose template.
# When set to "1", enables SaaS-mode behaviors: auto-onboard, auto-approve device
# pairing, and disables device auth. Community (self-hosted) deployments that lack
# this env var get the normal setup flow with full security.

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

# Capability-specific models for prompt-based routing (used by self-hosted users
# who configure per-task-type model selection via OPERATIONS.md delegation tables)
CODING_MODEL="${OPENCLAW_CODING_MODEL:-${DEFAULT_MODEL}}"
WRITING_MODEL="${OPENCLAW_WRITING_MODEL:-${DEFAULT_MODEL}}"
SEARCH_MODEL="${OPENCLAW_SEARCH_MODEL:-${DEFAULT_MODEL}}"
IMAGE_MODEL="${OPENCLAW_IMAGE_MODEL:-${DEFAULT_MODEL}}"

# Concurrency settings (configurable via dashboard)
MAX_CONCURRENT="${OPENCLAW_MAX_CONCURRENT:-4}"
SUBAGENT_MAX_CONCURRENT="${OPENCLAW_SUBAGENT_MAX_CONCURRENT:-8}"

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
    "trustedProxies": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"],
    "controlUi": {
      "enabled": true,
      "dangerouslyDisableDeviceAuth": true,
      "dangerouslyAllowHostHeaderOriginFallback": true,
      "allowedOrigins": $(node -e "
        const origins = new Set(['http://localhost:3000']);
        const env = process.env.OPENCLAW_ALLOW_IFRAME_ORIGINS || '';
        for (const o of env.split(',').map(s => s.trim()).filter(Boolean)) origins.add(o);
        console.log(JSON.stringify([...origins]));
      " 2>/dev/null || echo '["http://localhost:3000"]')
    },
    "auth": {
      "mode": "token",
      "token": "${GATEWAY_TOKEN}"
    }
  },
  "logging": { "redactSensitive": "tools" }${MODELS_SECTION},
  "memory": {
    "backend": "builtin",
    "citations": "auto"
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
        "provider": "gemini",
        "model": "gemini-embedding-2-preview",
        "experimental": { "sessionMemory": true },
        "sources": ["memory", "sessions"]
      },
      "subagents": {
        "model": "${SUBAGENT_MODEL}",
        "maxConcurrent": ${SUBAGENT_MAX_CONCURRENT}
      },
      "heartbeat": {
        "every": "${HEARTBEAT_INTERVAL}",
        "prompt": "HEARTBEAT CHECK — You MUST complete ALL steps below. DO NOT SKIP ANY STEP.\n\nMANDATORY FILE READS (use the read tool for EACH of these, every single heartbeat):\n\nSTEP 1: READ ~/workspace/WORKING.md — In-progress task? Continue it. Stalled/blocked?\nSTEP 2: READ ~/workspace/memory/self-review.md — Check last 7 days for MISS tags. If match: counter-check protocol.\nSTEP 3: READ ~/workspace/HEARTBEAT.md — Scheduled tasks due? Errors? Urgent items?\n\nCRITICAL: Even if a file was empty last time, you MUST read it again. Files change between heartbeats. Skipping reads means missing information. You are REQUIRED to make 3 separate read calls before responding.\n\nSTEP 4: RESPONSE (only after steps 1-3): Nothing → HEARTBEAT_OK. User attention needed → brief message (one line max).\n\nNEVER message for: routine status, still running, low-priority completions.",
        "model": "${HEARTBEAT_MODEL}"
      },
      "maxConcurrent": ${MAX_CONCURRENT},
      "bootstrapTotalMaxChars": 155000
    }
  },
  "messages": {
    "queue": {
      "mode": "collect"
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
  
  # Security: Enforce strict permissions on the config directory and file.
  echo "[entrypoint] Enforcing security permissions..."
  chmod 700 "$CONFIG_DIR"
  chmod 600 "$CONFIG_FILE"

else
  echo "[entrypoint] Using existing configuration at $CONFIG_FILE"
fi

# =============================================================================
# AUTO-ONBOARD: Run non-interactive onboard when OPENCLAW_AUTO_ONBOARD=true
# This allows the dashboard to pre-configure instances during deployment.
# Only active in managed-platform mode — community users run normal setup.
# =============================================================================
if [ "${OPENCLAW_MANAGED_PLATFORM:-}" = "1" ]; then
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
  # the model settings the entrypoint originally set.
  if [ -s "$CONFIG_FILE" ]; then
    echo "[entrypoint] Re-enforcing model settings after onboard..."
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

  # CRITICAL: Enforce controlUi.allowedOrigins for non-loopback binds.
  # Without this, the gateway crashes with:
  #   'non-loopback Control UI requires gateway.controlUi.allowedOrigins'
  if [ -s "$CONFIG_FILE" ]; then
    echo "[entrypoint] Enforcing controlUi.allowedOrigins..."
    node -e "
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
      const gw = config.gateway = config.gateway || {};
      const cui = gw.controlUi = gw.controlUi || {};
      const origins = new Set(['http://localhost:3000']);
      const envOrigins = process.env.OPENCLAW_ALLOW_IFRAME_ORIGINS || '';
      for (const o of envOrigins.split(',').map(s => s.trim()).filter(Boolean)) {
        origins.add(o);
      }
      for (const o of (cui.allowedOrigins || [])) {
        origins.add(o);
      }
      cui.allowedOrigins = [...origins];
      fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
      console.log('[entrypoint] controlUi.allowedOrigins enforced: ' + JSON.stringify(cui.allowedOrigins));
    " 2>&1 || echo '[entrypoint] WARNING: controlUi enforcement failed (non-fatal)'
  fi
fi
fi  # end OPENCLAW_MANAGED_PLATFORM auto-onboard guard

# Security: Ensure SOUL.md (Prompt Hardening) is present in the workspace
# This file is copied into the image at build time (/app/SOUL.md)
# WORKSPACE_DIR already set above (used in config generation and here for file deployment)

# Check if ACIP (Advanced Cognitive Inoculation Prompt) is enabled
# Defaults to true for security
ACIP_ENABLED="${OPENCLAW_ACIP_ENABLED:-true}"

# Business mode: when OPENCLAW_BUSINESS_MODE_ENABLED=true (or OPENCLAW_BUSINESS_MODE=1),
# deploy the business guide template as SOUL.md instead of the standard version.
BUSINESS_MODE="${OPENCLAW_BUSINESS_MODE:-}"
BUSINESS_MODE_ENABLED="${OPENCLAW_BUSINESS_MODE_ENABLED:-}"
IS_BUSINESS_MODE=false
if [ "$BUSINESS_MODE" = "1" ] || [ "$BUSINESS_MODE_ENABLED" = "true" ] || [ "$BUSINESS_MODE_ENABLED" = "1" ]; then
  IS_BUSINESS_MODE=true
fi

# Resolve the SOUL.md source file based on mode
BUSINESS_TEMPLATE="/app/docs/reference/templates/openclaw-business-v1.md"
if [ "$IS_BUSINESS_MODE" = "true" ] && [ -f "$BUSINESS_TEMPLATE" ]; then
  SOUL_SOURCE="$BUSINESS_TEMPLATE"
  echo "[entrypoint] Business mode active — deploying business guide as SOUL.md"
elif [ -f "/app/SOUL.md" ]; then
  SOUL_SOURCE="/app/SOUL.md"
else
  SOUL_SOURCE=""
fi

if [ -n "$SOUL_SOURCE" ]; then
  mkdir -p "$WORKSPACE_DIR"
  echo "[entrypoint] Setting up SOUL.md from: $SOUL_SOURCE"
  
  # Remove existing readonly file if it exists so we can update it
  if [ -f "$WORKSPACE_DIR/SOUL.md" ]; then
    chmod 644 "$WORKSPACE_DIR/SOUL.md" 2>/dev/null || true
    rm -f "$WORKSPACE_DIR/SOUL.md"
  fi

  cp "$SOUL_SOURCE" "$WORKSPACE_DIR/SOUL.md"

  # Strip YAML frontmatter (---\n...\n--- block at start of file) if present
  if head -1 "$WORKSPACE_DIR/SOUL.md" | grep -q '^---$'; then
    awk 'BEGIN{skip=0; count=0} /^---$/{count++; if(count<=2){skip=1; next}} {if(count>=2){skip=0}; if(!skip) print}' \
      "$WORKSPACE_DIR/SOUL.md" > "$WORKSPACE_DIR/SOUL.md.tmp" && \
      mv "$WORKSPACE_DIR/SOUL.md.tmp" "$WORKSPACE_DIR/SOUL.md"
  fi

  # Set strict read-only permissions so the agent can't easily modify it
  chmod 444 "$WORKSPACE_DIR/SOUL.md"
fi

# Deploy ACIP_SECURITY.md (independent of which SOUL.md variant is used)
if [ "$ACIP_ENABLED" = "true" ] || [ "$ACIP_ENABLED" = "1" ]; then
  mkdir -p "$WORKSPACE_DIR"
  if [ -f "/app/ACIP_SECURITY.md" ]; then
    cp /app/ACIP_SECURITY.md "$WORKSPACE_DIR/ACIP_SECURITY.md"
    chmod 444 "$WORKSPACE_DIR/ACIP_SECURITY.md"
    echo "[entrypoint] Deployed ACIP_SECURITY.md as workspace reference."
  else
    echo "[entrypoint] WARNING: ACIP_SECURITY.md not found in image."
  fi
else
  echo "[entrypoint] ACIP Security disabled (OPENCLAW_ACIP_ENABLED=$ACIP_ENABLED)."
fi

# NOTE: {{TOKEN}} model routing sed replacements were removed.
# SOUL.md no longer contains model routing placeholders — operational content
# (delegation, model routing) lives in OPERATIONS.md, which is managed by
# ensureAgentWorkspace() and doesn't need entrypoint sed processing.

# NOTE: IDENTITY.md, WORKING.md, memory/, self-review.md, open-loops.md, and
# HEARTBEAT.md are NO LONGER deployed here. They are seeded by ensureAgentWorkspace()
# when the gateway starts. Deploying them here caused BOOTSTRAP.md to never be
# created on fresh deploys (the bootstrapper saw these files and assumed onboarding
# was already complete).
# SOUL.md and ACIP_SECURITY.md are still deployed here because they have special
# entrypoint-only handling (read-only permissions, model placeholder rendering).

# =============================================================================
# BOOTSTRAP.md SEEDING: Deploy the onboarding ritual for fresh workspaces
#
# ensureAgentWorkspace() should handle this, but the SOUL.md deployment above
# (required for security) confuses its brand-new workspace detection. Rather
# than fighting the detection logic, seed BOOTSTRAP.md here alongside SOUL.md.
#
# Guard: only seed if the workspace-state.json doesn't have setupCompletedAt
# (i.e., the identity setup ritual hasn't been completed yet).
# =============================================================================
WORKSPACE_STATE_FILE="$WORKSPACE_DIR/.openclaw/workspace-state.json"
BOOTSTRAP_TEMPLATE="/app/docs/reference/templates/BOOTSTRAP.md"
SETUP_COMPLETED="false"

# Check if setup was already completed (workspace-state.json has setupCompletedAt)
if [ -f "$WORKSPACE_STATE_FILE" ]; then
  if command -v jq &>/dev/null; then
    SETUP_COMPLETED_VAL=$(jq -r '.setupCompletedAt // empty' "$WORKSPACE_STATE_FILE" 2>/dev/null)
  else
    SETUP_COMPLETED_VAL=$(node -e "
      try {
        const s = require('fs').readFileSync('$WORKSPACE_STATE_FILE', 'utf8');
        const p = JSON.parse(s);
        if (p.setupCompletedAt) console.log(p.setupCompletedAt);
      } catch {}
    " 2>/dev/null)
  fi
  if [ -n "$SETUP_COMPLETED_VAL" ]; then
    SETUP_COMPLETED="true"
  fi
fi

if [ "$SETUP_COMPLETED" = "false" ] && [ ! -f "$WORKSPACE_DIR/BOOTSTRAP.md" ] && [ -f "$BOOTSTRAP_TEMPLATE" ]; then
  mkdir -p "$WORKSPACE_DIR"
  cp "$BOOTSTRAP_TEMPLATE" "$WORKSPACE_DIR/BOOTSTRAP.md"
  # Strip YAML frontmatter (same as SOUL.md handling)
  if head -1 "$WORKSPACE_DIR/BOOTSTRAP.md" | grep -q '^---$'; then
    awk 'BEGIN{skip=0; count=0} /^---$/{count++; if(count<=2){skip=1; next}} {if(count>=2){skip=0}; if(!skip) print}' \
      "$WORKSPACE_DIR/BOOTSTRAP.md" > "$WORKSPACE_DIR/BOOTSTRAP.md.tmp" && \
      mv "$WORKSPACE_DIR/BOOTSTRAP.md.tmp" "$WORKSPACE_DIR/BOOTSTRAP.md"
  fi
  echo "[entrypoint] Deployed BOOTSTRAP.md for fresh workspace (identity setup ritual)"
elif [ "$SETUP_COMPLETED" = "true" ]; then
  echo "[entrypoint] Setup already completed — skipping BOOTSTRAP.md deployment"
elif [ -f "$WORKSPACE_DIR/BOOTSTRAP.md" ]; then
  echo "[entrypoint] BOOTSTRAP.md already exists — skipping"
fi


# Create subagent log directory
SUBAGENT_LOG_DIR="$WORKSPACE_DIR/subagent-logs"
if [ ! -d "$SUBAGENT_LOG_DIR" ]; then
  mkdir -p "$SUBAGENT_LOG_DIR"
  chmod 755 "$SUBAGENT_LOG_DIR"
  echo "[entrypoint] Created subagent log directory"
fi

# =============================================================================
# BYTEROVER MEMORY: Install and configure ByteRover CLI when key is provided
# ByteRover provides local-first knowledge curation via `brv curate`/`brv query`.
# It runs as an Agent Skill (not a gateway plugin) — tools are injected into
# the agent's context rather than the gateway config.
# Powered by gemini-3.1-flash-lite-preview for cost-effective curation.
# Must run BEFORE openclaw doctor so the skill is on disk when doctor validates.
# =============================================================================
BYTEROVER_KEY="${BYTEROVER_GEMINI_KEY:-}"
# Expose the ByteRover Gemini key as GEMINI_API_KEY so the builtin memory
# backend's Gemini embedding provider can use it without custom config.
# Only set if not already provided (avoid overwriting an explicit key).
if [ -n "$BYTEROVER_KEY" ] && [ -z "${GEMINI_API_KEY:-}" ]; then
  export GEMINI_API_KEY="$BYTEROVER_KEY"
  echo "[entrypoint] GEMINI_API_KEY derived from BYTEROVER_GEMINI_KEY (for memory embeddings)"
fi
BYTEROVER_MARKER="$CONFIG_DIR/.byterover-configured"

if [ -n "$BYTEROVER_KEY" ]; then
  # CRITICAL: brv-server inherits PORT from the env and binds to it.
  # We must unset it here so it doesn't conflict with the OpenClaw gateway.
  (
    unset PORT
    # Install byterover-cli globally if not already present
    if ! command -v brv &>/dev/null; then
      echo "[entrypoint] ByteRover key detected — installing byterover-cli globally..."
      if npm install -g byterover-cli 2>&1 | tail -3; then
        echo "[entrypoint] byterover-cli installed: $(brv --version 2>&1 | head -1)"
      else
        echo "[entrypoint] WARNING: byterover-cli install failed (non-fatal — memory curation disabled)"
      fi
    else
      echo "[entrypoint] byterover-cli already available: $(brv --version 2>&1 | head -1)"
    fi

    # Configure ByteRover with Google Gemini provider (idempotent via marker)
    if command -v brv &>/dev/null && [ ! -f "$BYTEROVER_MARKER" ]; then
      echo "[entrypoint] Configuring ByteRover with Google Gemini (gemini-2.0-flash-lite)..."

      # brv providers connect: wires up Google Gemini as the LLM provider
      # --format json makes it fully non-interactive
      if brv providers connect google \
          --api-key "$BYTEROVER_KEY" \
          --model "gemini-2.0-flash-lite" \
          --format json 2>&1; then
        echo "[entrypoint] ByteRover connected to Google Gemini (gemini-2.0-flash-lite)"

        # Install the OpenClaw Agent Skill connector so brv query/curate are available
        if brv connectors install OpenClaw --format json 2>&1; then
          echo "[entrypoint] ByteRover OpenClaw connector installed as Agent Skill"
          touch "$BYTEROVER_MARKER"
        else
          echo "[entrypoint] WARNING: ByteRover OpenClaw connector install failed (non-fatal)"
        fi
      else
        echo "[entrypoint] WARNING: ByteRover provider connect failed (non-fatal)"
      fi

    elif [ -f "$BYTEROVER_MARKER" ]; then
      echo "[entrypoint] ByteRover already configured (marker exists)"
      # Re-enforce API key on each boot in case it changed
      if command -v brv &>/dev/null; then
        brv providers connect google \
          --api-key "$BYTEROVER_KEY" \
          --model "gemini-2.0-flash-lite" \
          --format json 2>&1 \
          || echo "[entrypoint] WARNING: ByteRover key re-enforcement failed (non-fatal)"
      fi
    fi
  )
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

# =============================================================================
# QMD MEMORY SIDECAR: Install qmd binary when OPENCLAW_QMD_ENABLED=true
# qmd is a local-first markdown search sidecar (BM25 + vectors + reranking).
# It is NOT bundled in the base image — must be installed via bun at runtime
# until a Dockerfile rebuild bakes it in permanently.
# Enabled by default. Set OPENCLAW_QMD_ENABLED=false to disable.
# =============================================================================
if [ "${OPENCLAW_QMD_ENABLED:-true}" = "true" ] || [ "${OPENCLAW_QMD_ENABLED:-true}" = "1" ]; then
  if command -v qmd &>/dev/null; then
    echo "[entrypoint] qmd already available: $(qmd --version 2>&1 | head -1)"
  else
    echo "[entrypoint] Installing qmd memory sidecar..."
    BUN_BIN="/root/.bun/bin/bun"
    if [ -f "$BUN_BIN" ]; then
      # Pinned to v2.0.1 — bun install -g from GitHub installs source (not compiled dist/).
      # In v2.0.0+ the CLI entrypoint is at src/cli/qmd.ts.
      # Search bun's global install location for src/cli/qmd.ts and create a bun-run shim.
      "$BUN_BIN" install --trust -g 'https://github.com/tobi/qmd#v2.0.1' 2>&1 | tail -3
      QMD_SRC=$(find /root/.bun/install/global /root/.bun -path "*/node_modules/@tobilu/qmd/src/cli/qmd.ts" 2>/dev/null | head -1)
      if [ -n "$QMD_SRC" ]; then
        printf '#!/bin/sh\nexec /root/.bun/bin/bun run %s "$@"\n' "$QMD_SRC" > /usr/local/bin/qmd
        chmod +x /usr/local/bin/qmd
        echo "[entrypoint] qmd installed: $(qmd --version 2>&1 | head -1)"
      else
        echo "[entrypoint] WARNING: qmd source not found after install — memory search will fall back to builtin"
      fi
    else
      echo "[entrypoint] WARNING: bun not found — cannot install qmd. Memory search will fall back to builtin."
    fi
  fi

  # PRE-WARM: run 'qmd status' to trigger any first-run llama.cpp compilation
  # BEFORE the gateway starts. This ensures the qmd binary is fully compiled
  # so that OpenClaw's ensureCollections() calls succeed without timing out.
  # On subsequent boots this is essentially free (sub-second).
  if command -v qmd &>/dev/null; then
    echo "[entrypoint] qmd pre-warm: triggering any first-run compilation (this may take a few minutes on first deploy)..."
    # CONFIG_DIR is already resolved at the top of the entrypoint with the correct
    # default (/home/node/.clawdbot). Use it directly rather than re-expanding
    # OPENCLAW_STATE_DIR here (which had a wrong /home/node/data fallback).
    # Mirror the exact env that QmdMemoryManager sets: XDG_CACHE_HOME + QMD_CONFIG_DIR.
    QMD_PREWARM_DIR="$CONFIG_DIR/agents/main/qmd"
    QMD_PREWARM_CACHE="$QMD_PREWARM_DIR/xdg-cache"
    QMD_PREWARM_CONFIG="$QMD_PREWARM_DIR/xdg-config"
    mkdir -p "$QMD_PREWARM_CACHE/qmd" "$QMD_PREWARM_CONFIG"
    XDG_CACHE_HOME="$QMD_PREWARM_CACHE" \
      XDG_CONFIG_HOME="$QMD_PREWARM_CONFIG" \
      QMD_CONFIG_DIR="$QMD_PREWARM_CONFIG" \
      NO_COLOR=1 \
      qmd status 2>&1 \
      | grep -Ev "cmake|clang|llama|ggml|xpack|CXX|C compiler|OpenMP|pthread|assembler|Detect" \
      | head -15 || true
    echo "[entrypoint] qmd pre-warm complete"

    # Background embed: create vector embeddings on first boot so semantic
    # search works immediately. qmd-manager.ts also runs embed on its own
    # interval, but without this, the first 5–60 minutes after deploy have
    # zero vectors (BM25-only fallback). Fire-and-forget so it doesn't
    # block gateway startup.
    (
      XDG_CACHE_HOME="$QMD_PREWARM_CACHE" \
        XDG_CONFIG_HOME="$QMD_PREWARM_CONFIG" \
        QMD_CONFIG_DIR="$QMD_PREWARM_CONFIG" \
        NO_COLOR=1 \
        qmd embed 2>&1 \
        | tail -3 || true
      echo "[entrypoint] qmd embed (background) complete"
    ) &
  fi

  # Apply Gemini embedding patch (uses API instead of slow local GGUF models)
  # Gated on GEMINI_API_KEY; disable with QMD_EMBED_PROVIDER=local
  if [ -n "${GEMINI_API_KEY:-}" ] && [ "${QMD_EMBED_PROVIDER:-}" != "local" ]; then
    PATCH_SCRIPT="/app/scripts/patch-qmd-gemini.sh"
    if [ -f "$PATCH_SCRIPT" ]; then
      bash "$PATCH_SCRIPT" 2>&1 || echo "[entrypoint] WARNING: QMD Gemini patch failed (non-fatal)"
    fi
  fi
fi

# =============================================================================
# BACKUP RESTORE: Apply a previously stored OpenClaw backup on first boot
#
# When MOLTBOT_RESTORE_BACKUP_KEY is set (e.g. after a user imports a backup
# from the dashboard), we download the archive from Supabase Storage and
# extract the config before the gateway starts. A marker file prevents the
# restore from running again on subsequent boots.
#
# IMPORTANT: This runs BEFORE enforce-config so that the restored config is
# properly normalized (model enforcement, gateway settings, doctor fixes).
# Cross-fork backups may have incompatible fields — enforce-config handles it.
#
# Remove MOLTBOT_RESTORE_BACKUP_KEY from the instance env vars after confirming
# the restore was successful to prevent accidental re-application.
# =============================================================================
if [ -n "${MOLTBOT_RESTORE_BACKUP_KEY:-}" ]; then
  RESTORE_SCRIPT="/home/node/scripts/restore-from-backup.sh"
  if [ -f "$RESTORE_SCRIPT" ]; then
    echo "[entrypoint] MOLTBOT_RESTORE_BACKUP_KEY set — running restore..."
    bash "$RESTORE_SCRIPT" 2>&1 || echo "[entrypoint] WARNING: restore failed (non-fatal, continuing with existing config)"
  else
    echo "[entrypoint] WARNING: restore-from-backup.sh not found at $RESTORE_SCRIPT — skipping"
  fi
fi

# =============================================================================
# ENFORCE CONFIG: Apply all enforcement settings on top of inline config
# This is the final configuration layer — model normalization, compaction,
# loop detection, memory search, gateway binding, and cron job seeding.
# Runs AFTER backup restore so restored configs get properly normalized.
# =============================================================================
ENFORCE_CONFIG_SCRIPT="/app/enforce-config.mjs"
if [ -f "$ENFORCE_CONFIG_SCRIPT" ] && [ -s "$CONFIG_FILE" ]; then
  echo "[entrypoint] Running enforce-config (all)..."
  # Export env vars that enforce-config.mjs reads via process.env.
  # Many OPENCLAW_* vars are already set by Docker, but the entrypoint
  # remaps some to shorter names that enforce-config.mjs expects.
  export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-${MOLTBOT_STATE_DIR:-${CLAWDBOT_STATE_DIR:-/home/node/.clawdbot}}}"
  export OPENCLAW_CONFIG_FILE="$CONFIG_FILE"
  export OPENCLAW_DATA_DIR="${OPENCLAW_DATA_DIR:-/home/node/data}"
  export OPENCLAW_SELF_REFLECTION="${OPENCLAW_SELF_REFLECTION:-normal}"
  export GATEWAY_TOKEN="${GATEWAY_TOKEN:-}"
  export GATEWAY_PORT="${GATEWAY_PORT:-18789}"
  export GATEWAY_BIND="${GATEWAY_BIND:-lan}"
  export AI_GATEWAY_URL="${AI_GATEWAY_URL:-}"
  export BAILIAN_API_KEY="${BAILIAN_API_KEY:-}"
  if node "$ENFORCE_CONFIG_SCRIPT" all 2>&1; then
    echo "[entrypoint] enforce-config completed"
  else
    echo "[entrypoint] WARNING: enforce-config failed (non-fatal, continuing)"
  fi
fi

# =============================================================================
# DEVICE SCOPE BASELINE MIGRATION: Backfill approvedScopes on existing paired
# device records that predate the upstream "fail closed without device scope
# baseline" security change (openclaw 2026.3.11 / v1.0.4).
#
# Before this change, paired device records had no approvedScopes field.
# After it, the gateway rejects any device missing approvedScopes with
# "device identity required" — breaking existing deployments on upgrade.
#
# Fix: idempotently add approvedScopes: ["operator.admin"] to any device
# record that is missing the field. Runs on every container start (safe —
# the jq filter is a no-op if the field already exists).
# =============================================================================
DEVICES_PAIRED_FILE="$CONFIG_DIR/devices/paired.json"
if [ -f "$DEVICES_PAIRED_FILE" ] && command -v jq &>/dev/null; then
  MIGRATED=$(jq '
    with_entries(
      .value |= if .approvedScopes == null then
        .approvedScopes = ["operator.admin"]
      else
        .
      end
    )
  ' "$DEVICES_PAIRED_FILE" 2>/dev/null)
  if [ -n "$MIGRATED" ]; then
    echo "$MIGRATED" > "$DEVICES_PAIRED_FILE.tmp" && mv "$DEVICES_PAIRED_FILE.tmp" "$DEVICES_PAIRED_FILE"
    echo "[entrypoint] device scope baseline migration applied (approvedScopes backfilled)"
  fi
elif [ -f "$DEVICES_PAIRED_FILE" ]; then
  # jq not available — fall back to node
  node -e "
    const fs = require('fs');
    const path = '$DEVICES_PAIRED_FILE';
    const devices = JSON.parse(fs.readFileSync(path, 'utf8'));
    let changed = false;
    for (const id of Object.keys(devices)) {
      if (!devices[id].approvedScopes) {
        devices[id].approvedScopes = ['operator.admin'];
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(path, JSON.stringify(devices, null, 2));
      console.log('[entrypoint] device scope baseline migration applied (node fallback)');
    }
  " 2>&1 || echo "[entrypoint] WARNING: device scope migration failed (non-fatal)"
fi

# =============================================================================
# AUTO-APPROVE DEVICE PAIRING: Background a loop that waits for the gateway
# to accept connections, then auto-approves the pending local device.
#
# Only active in managed-platform mode — community users go through normal
# device pairing flow for security.
#
# Why: The gateway requires device pairing for CLI RPC access (even with
# token auth enabled). Inside a container, no one is around to manually run
# `openclaw devices approve --latest`. This backgrounds the approval so it
# doesn't block the `exec` that starts the gateway.
#
# The loop polls for up to 15 seconds. If the gateway isn't ready by then,
# the device will remain pending (manual fallback via Control UI or SSH).
# =============================================================================
if [ "${OPENCLAW_MANAGED_PLATFORM:-}" = "1" ]; then
OPENCLAW_SCRIPT="/app/openclaw.mjs"
if [ -f "$OPENCLAW_SCRIPT" ]; then
  (
    sleep 2  # Give gateway a head start
    for i in $(seq 1 26); do
      if node "$OPENCLAW_SCRIPT" devices list >/dev/null 2>&1; then
        if node "$OPENCLAW_SCRIPT" devices approve --latest 2>/dev/null; then
          echo "[entrypoint] Auto-approved local device pairing"
        fi
        break
      fi
      sleep 0.5
    done
  ) &
  echo "[entrypoint] Device auto-approve scheduled (background)"
fi
fi  # end OPENCLAW_MANAGED_PLATFORM auto-approve guard

chown -R node:node "$CONFIG_DIR" "$WORKSPACE_DIR" 2>/dev/null || true
# Re-fix extensions ownership: the chown above sets everything to node:node,
# but the plugin scanner REQUIRES extensions to be owned by root (uid=0).
# Without this, it rejects them as "suspicious ownership (uid=1000)".
if [ -d "$CONFIG_DIR/extensions" ]; then
  chown -R root:root "$CONFIG_DIR/extensions" 2>/dev/null || true
fi


# =============================================================================
# WORKSPACE DOC CONVERTER: Background service that watches the workspace for
# non-markdown files (PDF, TXT, DOCX, ODT, CSV, EPUB) and auto-converts them
# to markdown so that QMD can index them alongside existing .md files.
#
# Runs on a 5-minute poll interval. Completely deterministic — no LLM involved.
# Set OPENCLAW_DOC_CONVERTER_ENABLED=false to disable.
# =============================================================================
DOC_CONVERTER_ENABLED="${OPENCLAW_DOC_CONVERTER_ENABLED:-true}"
DOC_CONVERTER_SCRIPT="/app/scripts/workspace-doc-converter.sh"

if [ "$DOC_CONVERTER_ENABLED" != "false" ] && [ "$DOC_CONVERTER_ENABLED" != "0" ]; then
  if [ -f "$DOC_CONVERTER_SCRIPT" ]; then
    mkdir -p "${WORKSPACE_DIR}/converter-log"
    bash "$DOC_CONVERTER_SCRIPT" \
      --interval 300 \
      >> "${WORKSPACE_DIR}/converter-log/converter.log" 2>&1 &
    echo "[entrypoint] workspace-doc-converter started (poll interval: 5m, PID: $!)"
  else
    echo "[entrypoint] WARNING: workspace-doc-converter.sh not found at $DOC_CONVERTER_SCRIPT — skipping"
  fi
fi

# =============================================================================
# BYTEROVER CURATE WATCHER: Background daemon that runs brv curate when key
# agent memory/identity files change (sha256 checksum diff).
# Watches: MEMORY.md, USER.md, IDENTITY.md, SOUL.md, diary/*.md
# Polls every 5 minutes — only calls brv (Gemini API) when content changes.
# Gated on BYTEROVER_GEMINI_KEY and brv availability.
# Set OPENCLAW_BRV_CURATE_DISABLED=true to suppress.
# =============================================================================
BRV_WATCHER_SCRIPT="/app/scripts/brv-curate-watcher.sh"

if [ -n "$BYTEROVER_KEY" ] && command -v brv &>/dev/null; then
  if [ -f "$BRV_WATCHER_SCRIPT" ]; then
    mkdir -p "${WORKSPACE_DIR}/converter-log"
    WORKSPACE_DIR="$WORKSPACE_DIR" \
    OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$CONFIG_DIR}" \
    bash "$BRV_WATCHER_SCRIPT" \
      --interval 300 \
      >> "${WORKSPACE_DIR}/converter-log/brv-curate.log" 2>&1 &
    echo "[entrypoint] brv-curate-watcher started (poll interval: 5m, PID: $!)"
  else
    echo "[entrypoint] WARNING: brv-curate-watcher.sh not found at $BRV_WATCHER_SCRIPT — skipping"
  fi
fi


# Execute the main command as root — no privilege drop.
# The agent already had passwordless sudo, so dropping to node was security theater.
# Running as root eliminates permission issues (npm global installs, file ownership)
# while Docker container isolation provides the real security boundary.
exec "$@"
