#!/bin/bash
set -e

echo "=== MoltBot Security Audit ==="

# 1. Check User
CURRENT_USER=$(whoami)
echo "[CHECK] Process User: $CURRENT_USER"
if [ "$CURRENT_USER" = "root" ]; then
  echo "[FAIL] Process is running as root!"
  exit 1
else
  echo "[PASS] Process is running as non-root user."
fi

# 2. Check Network Binding (requires netstat or lsof)
# We will check if the gateway port (18789) is bound to 0.0.0.0 or *
# Note: In some containers netstat/lsof might not be available, so we try to check /proc/net/tcp if possible
# or just rely on the config check if tools are missing.

if command -v netstat >/dev/null 2>&1; then
  echo "[CHECK] Checking network binding with netstat..."
  BINDING=$(netstat -tuln | grep :18789 | awk '{print $4}')
  if [[ "$BINDING" == *"0.0.0.0"* ]] || [[ "$BINDING" == *":::"* ]]; then
    echo "[FAIL] Gateway bound to all interfaces ($BINDING)"
    exit 1
  elif [[ "$BINDING" == *"127.0.0.1"* ]] || [[ "$BINDING" == *"localhost"* ]]; then
     echo "[PASS] Gateway bound to loopback ($BINDING)"
  else
     echo "[WARN] Could not determine binding from: $BINDING"
  fi
else
  echo "[WARN] netstat not found, skipping network binding verification inside container."
fi


# 3. Check File Permissions
CONFIG_DIR="${MOLTBOT_STATE_DIR:-${CLAWDBOT_STATE_DIR:-$HOME/.clawdbot}}"
echo "[CHECK] Checking permissions for $CONFIG_DIR"

if [ -d "$CONFIG_DIR" ]; then
  DIR_PERMS=$(stat -c "%a" "$CONFIG_DIR" 2>/dev/null || stat -f "%Lp" "$CONFIG_DIR" 2>/dev/null)
  if [ "$DIR_PERMS" != "700" ]; then
     echo "[WARN] Config directory permissions are $DIR_PERMS (expected 700)"
  else
     echo "[PASS] Config directory permissions are 700"
  fi
  
  if [ -f "$CONFIG_DIR/moltbot.json" ]; then
      FILE_PERMS=$(stat -c "%a" "$CONFIG_DIR/moltbot.json" 2>/dev/null || stat -f "%Lp" "$CONFIG_DIR/moltbot.json" 2>/dev/null)
      if [ "$FILE_PERMS" != "600" ]; then
        echo "[WARN] Config file permissions are $FILE_PERMS (expected 600)"
      else
        echo "[PASS] Config file permissions are 600"
      fi
  fi
else
  echo "[WARN] Config directory not found at $CONFIG_DIR"
fi

echo "=== Audit Complete ==="
exit 0
