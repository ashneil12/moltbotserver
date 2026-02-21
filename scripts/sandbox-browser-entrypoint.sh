#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:1
export HOME=/tmp/openclaw-home
export XDG_CONFIG_HOME="${HOME}/.config"
export XDG_CACHE_HOME="${HOME}/.cache"

CDP_PORT="${OPENCLAW_BROWSER_CDP_PORT:-${CLAWDBOT_BROWSER_CDP_PORT:-9222}}"
VNC_PORT="${OPENCLAW_BROWSER_VNC_PORT:-${CLAWDBOT_BROWSER_VNC_PORT:-5900}}"
NOVNC_PORT="${OPENCLAW_BROWSER_NOVNC_PORT:-${CLAWDBOT_BROWSER_NOVNC_PORT:-6080}}"
ENABLE_NOVNC="${OPENCLAW_BROWSER_ENABLE_NOVNC:-${CLAWDBOT_BROWSER_ENABLE_NOVNC:-1}}"
HEADLESS="${OPENCLAW_BROWSER_HEADLESS:-${CLAWDBOT_BROWSER_HEADLESS:-0}}"
PROXY="${OPENCLAW_BROWSER_PROXY:-}"
RESOLUTION="${OPENCLAW_BROWSER_RESOLUTION:-1280x800x24}"

# noVNC web root (prefer GitHub release, fall back to Debian package)
if [[ -d /opt/novnc ]]; then
  NOVNC_WEB=/opt/novnc
else
  NOVNC_WEB=/usr/share/novnc
fi

mkdir -p "${HOME}" "${HOME}/.chrome" "${XDG_CONFIG_HOME}" "${XDG_CACHE_HOME}"

# Clean up stale Chromium profile locks from previous container runs.
# The persistent volume retains Singleton{Lock,Cookie,Socket} tied to the old
# container hostname, which causes Chromium to refuse to start in a new container.
rm -f "${HOME}/.chrome/SingletonLock" \
      "${HOME}/.chrome/SingletonCookie" \
      "${HOME}/.chrome/SingletonSocket"

# Clean up stale lock files from previous runs (prevents Xvfb restart failures)
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1

Xvfb :1 -screen 0 "${RESOLUTION}" -ac -nolisten tcp &

if [[ "${HEADLESS}" == "1" ]]; then
  CHROME_ARGS=(
    "--headless=new"
    "--disable-gpu"
  )
else
  CHROME_ARGS=()
fi

if [[ "${CDP_PORT}" -ge 65535 ]]; then
  CHROME_CDP_PORT="$((CDP_PORT - 1))"
else
  CHROME_CDP_PORT="$((CDP_PORT + 1))"
fi

CHROME_ARGS+=(
  "--remote-debugging-address=0.0.0.0"
  "--remote-debugging-port=${CHROME_CDP_PORT}"
  "--remote-allow-origins=*"
  "--user-data-dir=${HOME}/.chrome"
  "--no-first-run"
  "--no-default-browser-check"
  "--disable-dev-shm-usage"
  "--disable-background-networking"
  "--disable-features=TranslateUI"
  "--disable-breakpad"
  "--disable-crash-reporter"
  "--metrics-recording-only"
  "--no-sandbox"
  "--test-type"
  # ── Performance: reduce CPU/memory for automated browsing ──
  "--disable-gpu-compositing"
  "--disable-smooth-scrolling"
  "--disable-default-apps"
  "--disable-background-timer-throttling"
  "--disable-backgrounding-occluded-windows"
  "--disable-renderer-backgrounding"
  "--animation-duration-scale=0"
  "--password-store=basic"
)

# Proxy support (e.g., socks5://proxy:1080 or http://proxy:8080)
if [[ -n "${PROXY}" ]]; then
  CHROME_ARGS+=("--proxy-server=${PROXY}")
fi

chromium "${CHROME_ARGS[@]}" about:blank &

# Wait for Chromium CDP to be ready (up to 10 seconds)
echo "[browser] waiting for Chromium CDP on port ${CHROME_CDP_PORT}..."
for i in $(seq 1 100); do
  if curl -sS --max-time 1 "http://127.0.0.1:${CHROME_CDP_PORT}/json/version" >/dev/null 2>&1; then
    echo "[browser] Chromium CDP ready after $((i * 100))ms"
    break
  fi
  sleep 0.1
done

# Expose CDP on all interfaces via socat (gateway connects from another container).
# Note: Chrome 107+ rejects HTTP requests with non-IP/non-localhost Host headers,
# but --remote-allow-origins=* handles WebSocket connections. The gateway-side code
# handles the HTTP health-check gracefully for remote profiles.
socat \
  TCP-LISTEN:"${CDP_PORT}",fork,reuseaddr,bind=0.0.0.0 \
  TCP:127.0.0.1:"${CHROME_CDP_PORT}" &

# Verify socat is forwarding correctly
sleep 0.5
if curl -sS --max-time 2 "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
  echo "[browser] CDP proxy ready on 0.0.0.0:${CDP_PORT}"
else
  echo "[browser] WARNING: CDP proxy not responding on port ${CDP_PORT}"
fi

if [[ "${ENABLE_NOVNC}" == "1" && "${HEADLESS}" != "1" ]]; then
  x11vnc -display :1 -rfbport "${VNC_PORT}" -shared -forever -nopw -localhost &
  websockify --web "${NOVNC_WEB}" "${NOVNC_PORT}" "localhost:${VNC_PORT}" &
  echo "[browser] noVNC ready on port ${NOVNC_PORT} (serving from ${NOVNC_WEB})"
fi

echo "[browser] all services started"
wait -n
