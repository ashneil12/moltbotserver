---
title: "TOOLS.md Template"
summary: "Workspace template for TOOLS.md"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS.md - Local Notes

*Check this file BEFORE saying "I can't do that." You probably can.*

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

## TikTok / Social Video Transcription

**Never tell me you can't pull a video. Figure it out.**

1. `yt-dlp --list-formats <url>`
2. `yt-dlp -f "h264_540p_*" -o "/tmp/video.%(ext)s" <url>`
3. `ffmpeg -i /tmp/video.mp4 -vn -acodec libmp3lame /tmp/video.mp3`
4. `transcribe.sh /tmp/video.mp3 --out /tmp/transcript.txt`

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

Add whatever helps you do your job. This is your cheat sheet.
