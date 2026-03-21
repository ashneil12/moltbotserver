---
title: "TOOLS.md Template"
summary: "Workspace template for TOOLS.md"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS.md - Local Notes

_Check this file BEFORE saying "I can't do that." You probably can._

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

## Video Transcripts & Downloads

**Never tell me you can't pull a video or transcript. Figure it out.**

### Transcripts (fast — try this first)

`yt-dlp` can fetch existing subtitles/captions directly — no download needed:

```bash
# Check what subtitles are available
yt-dlp --list-subs <url>

# Grab auto-generated subtitles (YouTube, TikTok, etc.)
yt-dlp --write-auto-sub --skip-download --sub-lang en -o "/tmp/%(title)s" <url>

# Grab manually uploaded subtitles
yt-dlp --write-sub --skip-download --sub-lang en -o "/tmp/%(title)s" <url>

# Strip timestamps from SRT → plain text
sed '/^[0-9]*$/d; /^$/d; /-->/d' /tmp/*.srt > /tmp/transcript.txt
```

### Full download (fallback — when no subtitles exist)

```bash
yt-dlp --list-formats <url>
yt-dlp -f "h264_540p_*" -o "/tmp/video.%(ext)s" <url>
ffmpeg -i /tmp/video.mp4 -vn -acodec libmp3lame /tmp/video.mp3
```

---

## System Updates (Signal Files)

A background process checks for new versions every 12h.

**Signal files:** `.update-available` (host writes) → `.update-ready` (you write after user consent) → `.update-applied` (host writes after restart).

1. Detect `.update-available` in workspace root
2. Inform user, get explicit consent
3. Run a backup right before applying
4. Create `.update-ready` with `apply_at: now`
5. After restart, read `.update-applied` and confirm to user

Downtime is ~15-30 seconds. Data, workspace, and memory persist.

---

## Plugin & Skill Safety

Plugins run in-process — a bad one takes you offline. **Always back up before installing:**

```bash
cp "$OPENCLAW_STATE_DIR/openclaw.json" "$OPENCLAW_STATE_DIR/openclaw.json.pre-plugin"
```

(Usually `/home/node/data/openclaw.json`.)

Never skip backup. Never install multiple at once. Prefer official plugins (`@openclaw/*`). Warn about third-party sources.

---

## Pre-installed CLI Tools

These are baked into the container — **do not say you can't use them.**

| Category      | Tools                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Media**     | `ffmpeg` (stream merging/conversion), `imagemagick` (`convert`, `mogrify`), `yt-dlp` (video/audio downloads)                                                                                   |
| **Documents** | `pandoc` (Markdown/HTML/DOCX/PDF conversion), `pdftotext` (PDF text extraction, via poppler-utils), `ghostscript` (`gs`, PDF manipulation), `wkhtmltopdf` (HTML→PDF rendering)                 |
| **Data**      | `jq` (JSON processing), `sqlite3` (local DB queries), `rg` (ripgrep — fast code/text search), `csvkit` (`csvcut`, `csvgrep`, `csvsql` — CSV manipulation), `xmlstarlet` (XML/XPath processing) |
| **Files**     | `zip`, `unzip`, `wget`, `rsync`, `tree`                                                                                                                                                        |
| **System**    | `htop`, `ps`, `top` (via procps)                                                                                                                                                               |
| **Runtime**   | `node`, `npm`, `pnpm`, `bun`, `python3`, `pip3`, `git`, `curl`                                                                                                                                 |
| **Agents**    | `scripts/provision-agent.sh` (deterministic agent creator), `node scripts/add-cron.mjs` (deterministic cron configurations)                                                                    |

---

Add whatever helps you do your job. This is your cheat sheet.
