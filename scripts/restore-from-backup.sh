#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# restore-from-backup.sh — Download and extract an OpenClaw backup archive
#
# Called by docker-entrypoint.sh when MOLTBOT_RESTORE_BACKUP_KEY is set.
# Downloads the specified archive from Supabase Storage, reads the manifest
# to discover what's inside (config, state, credentials, workspace), and
# extracts each asset to the correct destination path.
#
# Archive asset kinds (from BackupAssetKind in backup-shared.ts):
#   "config"      — the active openclaw.json config file
#   "state"       — the full state dir (~/.clawdbot)
#   "credentials" — OAuth / credential files (e.g. oauth-credentials)
#   "workspace"   — the agent workspace (SOUL.md, memory/, etc.)
#
# Required env vars (injected by dashboard at provision time):
#   MOLTBOT_RESTORE_BACKUP_KEY      — storage key e.g. {instance_id}/{ts}.tar.gz
#   MOLTBOT_SUPABASE_URL            — Supabase project URL
#   MOLTBOT_SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
#
# Optional:
#   OPENCLAW_STATE_DIR              — default /home/node/.clawdbot
#   OPENCLAW_WORKSPACE_DIR          — default /home/node/workspace
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RESTORE_KEY="${MOLTBOT_RESTORE_BACKUP_KEY:-}"
SUPABASE_URL="${MOLTBOT_SUPABASE_URL:-}"
SUPABASE_KEY="${MOLTBOT_SUPABASE_SERVICE_ROLE_KEY:-}"
BUCKET="openclaw-backups"
STATE_DIR="${OPENCLAW_STATE_DIR:-${MOLTBOT_STATE_DIR:-${CLAWDBOT_STATE_DIR:-/home/node/.clawdbot}}}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-${CLAWDBOT_WORKSPACE_DIR:-/home/node/workspace}}"
RESTORE_MARKER="${MOLTBOT_RESTORE_MARKER:-${STATE_DIR}/.restore-complete}"

# ── Guards ────────────────────────────────────────────────────────────────────
if [ -z "$RESTORE_KEY" ]; then
  echo "[restore] No MOLTBOT_RESTORE_BACKUP_KEY — skipping restore"
  exit 0
fi

# Sanitize RESTORE_KEY — reject path traversal or unexpected characters.
# Valid keys look like: {instance_id}/{timestamp}.tar.gz
if echo "$RESTORE_KEY" | grep -qE '\.\.[\/]|[;&|]'; then
  echo "[restore] ❌ RESTORE_KEY contains suspicious characters — aborting"
  exit 1
fi

if [ -f "$RESTORE_MARKER" ]; then
  echo "[restore] Restore already completed (marker: $RESTORE_MARKER) — skipping"
  exit 0
fi

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ]; then
  echo "[restore] ❌ Missing MOLTBOT_SUPABASE_URL or MOLTBOT_SUPABASE_SERVICE_ROLE_KEY"
  exit 1
fi

echo "[restore] 📥 Starting restore from: $RESTORE_KEY"

# ── Download archive ──────────────────────────────────────────────────────────
TMPDIR_BASE="${TMPDIR:-/tmp}"
WORKDIR=$(mktemp -d "${TMPDIR_BASE}/openclaw-restore-XXXXXX")
ARCHIVE_PATH="${WORKDIR}/restore.tar.gz"
EXTRACT_DIR="${WORKDIR}/extracted"
mkdir -p "$EXTRACT_DIR"
trap 'rm -rf "$WORKDIR"' EXIT

echo "[restore] ⬇️  Downloading from Supabase Storage..."
HTTP_STATUS=$(curl -s -o "$ARCHIVE_PATH" -w "%{http_code}" \
  "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${RESTORE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}")

if [ "$HTTP_STATUS" != "200" ]; then
  echo "[restore] ❌ Download failed (HTTP $HTTP_STATUS)"
  exit 1
fi
echo "[restore] ✅ Downloaded $(wc -c < "$ARCHIVE_PATH") bytes"

# ── Basic integrity check ─────────────────────────────────────────────────────
if ! tar -tzf "$ARCHIVE_PATH" > /dev/null 2>&1; then
  echo "[restore] ❌ Archive is corrupted or not a valid .tar.gz"
  exit 1
fi

# ── Extract the entire archive to a working directory ────────────────────────
# We extract everything first, then map each asset to its destination using
# the path mapping encoded in the archive structure. This is safer than
# extracting directly into system directories.
echo "[restore] 📂 Extracting archive..."
tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"

# ── Find and read manifest.json ───────────────────────────────────────────────
MANIFEST_FILE=$(find "$EXTRACT_DIR" -name "manifest.json" -maxdepth 2 | head -1)
if [ -z "$MANIFEST_FILE" ] || [ ! -f "$MANIFEST_FILE" ]; then
  echo "[restore] ❌ No manifest.json found in archive"
  exit 1
fi

SCHEMA_VERSION=$(python3 -c "
import sys, json
m = json.load(open('$MANIFEST_FILE'))
print(m.get('schemaVersion', 'unknown'))
" 2>/dev/null || echo "unknown")

if [ "$SCHEMA_VERSION" != "1" ]; then
  echo "[restore] ❌ Unsupported manifest schemaVersion: $SCHEMA_VERSION (expected 1)"
  exit 1
fi

echo "[restore] ✅ Manifest OK (schemaVersion=$SCHEMA_VERSION)"

# ── Read the archive root from the manifest ───────────────────────────────────
ARCHIVE_ROOT=$(python3 -c "
import sys, json
m = json.load(open('$MANIFEST_FILE'))
print(m.get('archiveRoot', ''))
" 2>/dev/null || echo "")

if [ -z "$ARCHIVE_ROOT" ]; then
  echo "[restore] ❌ Could not determine archiveRoot from manifest"
  exit 1
fi

PAYLOAD_ROOT="${EXTRACT_DIR}/${ARCHIVE_ROOT}/payload"
echo "[restore] 📦 Payload root: $PAYLOAD_ROOT"

# ── Process each asset ────────────────────────────────────────────────────────
# Asset archive paths use an encoded form of the original source path:
#   posix:   {archiveRoot}/payload/posix/{encoded-unix-path}
#   windows: {archiveRoot}/payload/windows/{drive}/{encoded-win-path}
#
# For restore we use the sourcePath from the manifest (the original location)
# along with each asset's kind to determine where to write.
#
# "config"      → STATE_DIR/openclaw.json    (always — it's the gateway config)
# "state"       → STATE_DIR/               (merge — don't wipe existing data)
# "credentials" → STATE_DIR/oauth-          (preserve credentials sub-paths)
# "workspace"   → WORKSPACE_DIR/           (merge — workspace files)

# (asset stats are tracked inside the Python block below)

python3 - <<PYEOF
import json, os, shutil, sys

manifest = json.load(open('$MANIFEST_FILE'))
assets = manifest.get('assets', [])
state_dir = '$STATE_DIR'
workspace_dir = '$WORKSPACE_DIR'
payload_root = '$PAYLOAD_ROOT'
archive_root = '$ARCHIVE_ROOT'

def encode_path(source_path):
    """Replicate encodeAbsolutePathForBackupArchive from backup-shared.ts"""
    normalized = source_path.replace('\\\\', '/')
    if normalized.startswith('/'):
        return 'posix/' + normalized.lstrip('/')
    # Windows drive letter
    import re
    m = re.match(r'^([A-Za-z]):/(.*)$', normalized)
    if m:
        return 'windows/' + m.group(1).upper() + '/' + m.group(2)
    return 'relative/' + normalized

results = []

for asset in assets:
    kind = asset.get('kind', '')
    source_path = asset.get('sourcePath', '')
    archive_path = asset.get('archivePath', '')

    # The archive_path from the manifest is the full path inside the tar
    # e.g. "20241201-openclaw-backup/payload/posix/home/node/.clawdbot/openclaw.json"
    # Strip the {archiveRoot}/payload/ prefix to get the payload-relative path
    prefix = archive_root + '/payload/'
    if archive_path.startswith(prefix):
        relative_payload = archive_path[len(prefix):]
    else:
        relative_payload = encode_path(source_path)

    full_source_in_extract = os.path.join(payload_root, relative_payload)

    if kind == 'config':
        # Always restore to STATE_DIR/openclaw.json
        dest = os.path.join(state_dir, 'openclaw.json')
        results.append(('config', full_source_in_extract, dest, source_path))

    elif kind == 'state':
        # The state dir is a directory tree. We strip the original state dir
        # prefix from the relative_payload to get the sub-path, then reconstruct.
        # relative_payload example: posix/home/node/.clawdbot/sessions/...
        # We map the entire payload subtree to STATE_DIR
        results.append(('state-dir', full_source_in_extract, state_dir, source_path))

    elif kind == 'credentials':
        # OAuth/credentials — restore preserving the relative structure
        results.append(('credentials', full_source_in_extract, state_dir, source_path))

    elif kind == 'workspace':
        # Workspace files — restore to WORKSPACE_DIR
        results.append(('workspace-dir', full_source_in_extract, workspace_dir, source_path))

    else:
        print(f'[restore] ⚠️  Unknown asset kind: {kind!r} (source: {source_path}), skipping')
        continue

restored = 0
skipped = 0

for (kind, src, dest, orig_src) in results:
    if kind == 'config':
        # Single file copy
        if os.path.isfile(src):
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if os.path.exists(dest):
                shutil.copy2(dest, dest + '.pre-restore')
                print(f'[restore] 📦 Backed up existing {os.path.basename(dest)}')
            shutil.copy2(src, dest)
            os.chmod(dest, 0o600)
            print(f'[restore] ✅ config → {dest}')
            restored += 1
        else:
            print(f'[restore] ⚠️  Config file not found in archive at: {src}')
    else:
        # Directory merge: copy files from extracted path into destination dir,
        # preserving relative structure. We treat the archive payload path as
        # the root of the asset tree and rsync-style copy into destination.
        if os.path.isdir(src):
            os.makedirs(dest, exist_ok=True)
            for root_dir, dirs, files in os.walk(src):
                rel = os.path.relpath(root_dir, src)
                target_dir = os.path.join(dest, rel) if rel != '.' else dest
                os.makedirs(target_dir, exist_ok=True)
                for fname in files:
                    src_file = os.path.join(root_dir, fname)
                    dst_file = os.path.join(target_dir, fname)
                    shutil.copy2(src_file, dst_file)
            print(f'[restore] ✅ {kind} → {dest}')
            restored += 1
        elif os.path.isfile(src):
            # Single file within a "directory" asset — copy directly into dest dir
            dest_file = os.path.join(dest, os.path.basename(src))
            os.makedirs(dest, exist_ok=True)
            shutil.copy2(src, dest_file)
            print(f'[restore] ✅ {kind} (file) → {dest_file}')
            restored += 1
        else:
            print(f'[restore] ⚠️  Asset source not found: {src} (kind={kind})')
            skipped += 1

print(f'[restore] 📊 Assets: {restored} restored, {skipped} skipped')

PYEOF

RESTORE_EXIT=$?
if [ "$RESTORE_EXIT" -ne 0 ]; then
  echo "[restore] ❌ Asset restoration failed (exit $RESTORE_EXIT)"
  exit 1
fi

# ── Fix file permissions ──────────────────────────────────────────────────────
echo "[restore] 🔒 Fixing permissions..."
chmod 700 "$STATE_DIR" 2>/dev/null || true
find "$STATE_DIR" -maxdepth 1 -name "*.json" -exec chmod 600 {} \; 2>/dev/null || true
if [ -d "$WORKSPACE_DIR" ]; then
  chown -R node:node "$WORKSPACE_DIR" 2>/dev/null || true
fi
chown -R node:node "$STATE_DIR" 2>/dev/null || true
# Extensions must be root-owned (OpenClaw scanner requirement)
if [ -d "$STATE_DIR/extensions" ]; then
  chown -R root:root "$STATE_DIR/extensions" 2>/dev/null || true
fi

# ── Post-restore config validation ────────────────────────────────────────────
# If the restored openclaw.json is not valid JSON, the gateway will refuse to
# start. Catch this early and rename the bad file so the entrypoint generates
# a default config. Schema validation happens downstream via enforce-config /
# openclaw doctor / loadConfig() — we only check JSON syntax here.
CONFIG_FILE="${STATE_DIR}/openclaw.json"
if [ -f "$CONFIG_FILE" ]; then
  if python3 -c "import json; json.load(open('${CONFIG_FILE}'))" 2>/dev/null; then
    echo "[restore] ✅ Restored openclaw.json is valid JSON"
  else
    echo "[restore] ⚠️  Restored openclaw.json is not valid JSON — renaming to .pre-restore-invalid"
    echo "[restore]     The entrypoint will generate a default config instead."
    mv "$CONFIG_FILE" "${CONFIG_FILE}.pre-restore-invalid"
  fi
fi

# ── Write restore marker ──────────────────────────────────────────────────────
touch "$RESTORE_MARKER"
chmod 600 "$RESTORE_MARKER"
echo "[restore] 🎉 Restore complete. Next container boot will use restored config."
echo "[restore] 📌 Marker: $RESTORE_MARKER"
echo "[restore] ⚠️  Clear MOLTBOT_RESTORE_BACKUP_KEY from instance env after confirming restore succeeded."

