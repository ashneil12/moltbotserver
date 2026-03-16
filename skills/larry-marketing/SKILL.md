---
name: larry-marketing
description: Automate TikTok + Instagram slideshow marketing — generate AI images, add text overlays, post to multiple platforms, track analytics, and iterate based on data. Use when the user wants to market an app, product, or brand on TikTok/Instagram using AI-generated slideshows, or mentions "TikTok marketing," "slideshow automation," or "content pipeline."
homepage: https://github.com/Upload-Post/upload-post-larry-marketing-skill
metadata:
  {
    "openclaw":
      {
        "emoji": "🎬",
        "requires": { "bins": ["node"] },
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "canvas",
              "bins": [],
              "label": "Install node-canvas (npm)",
            },
          ],
      },
  }
---

# TikTok & Instagram Slideshow Marketing

Automate your entire slideshow marketing pipeline: **generate → overlay → post → track → iterate.**

**Credit**: Adapted from the [Larry Marketing Skill](https://github.com/Upload-Post/upload-post-larry-marketing-skill) by Oliver Henry. The original methodology generated 7M+ views and $1.5K MRR from an AI agent running on a gaming PC.

## When to use

- User wants to market an app, product, or service on TikTok/Instagram
- Any mention of "TikTok marketing," "slideshow marketing," or "content automation"
- User wants AI-generated visual content posted to social platforms
- User needs a data-driven marketing feedback loop

## Prerequisites

### Required

- **Node.js** (v18+) — all scripts run on Node
- **node-canvas** (`npm install canvas`) — for text overlays on slides

### Image Generation (pick one)

- **OpenAI** — `gpt-image-1.5` (recommended, best for realistic photo-style)
- **Stability AI** — Stable Diffusion XL+
- **Replicate** — any open-source model (Flux, SDXL, etc.)
- **Local** — bring your own images, skip generation

### Posting API (pick one)

- **Upload-Post** ([upload-post.com](https://upload-post.com)) — recommended, multi-platform in one API call (TikTok, Instagram, YouTube, LinkedIn, X, Threads, Pinterest, Reddit, Bluesky)
- **Postiz** — open-source alternative, self-hostable
- **Buffer API** — popular scheduling tool with API access
- **Direct platform APIs** — TikTok Content Posting API, Instagram Graph API (requires app review)

### Conversion Tracking (optional but powerful)

- **RevenueCat** — for mobile apps, closes the views → revenue attribution loop
- **Stripe** — for SaaS/web products
- **Google Analytics** — for website traffic attribution
- Without conversion tracking, you can only optimize for views (vanity metrics)

---

## Onboarding (First Run)

### Phase 0: Platform Account Warmup (CRITICAL)

If the account is new or barely used, it MUST be warmed up before posting automated content. TikTok and Instagram flag accounts that go from zero to automated content immediately.

**TikTok warmup (7-14 days):**

- Scroll the For You page naturally, 30-60 min/day
- Like sparingly (~1 in 10 videos), follow niche accounts
- Leave a few genuine comments per session
- Maybe post 1-2 casual, non-promotional videos
- **Signal that warmup is complete**: For You page is dominated by niche content

**Instagram warmup (3-7 days):**

- Engage with Reels and posts in the target niche
- Follow relevant accounts, leave genuine comments
- Post a few stories or casual posts

Tell the user: _"Accounts that skip warmup get 80-90% less reach on their first posts. Do the warmup."_

If the account is already active and established, skip to Phase 1.

### Phase 1: Get to Know the Product (Conversational)

Don't interrogate — have a casual conversation. Ask naturally:

- What's the app/product? What does it do?
- Who's the ideal user?
- What pain point does it solve?
- What makes it different from alternatives?
- App Store / website link
- Any existing brand vibe or content style?
- What monetization model? (subscriptions, one-time, freemium)

Store everything in `tiktok-marketing/app-profile.json`.

### Phase 2: Competitor Research (Requires Browser)

Ask permission, then:

1. Search TikTok for the product's niche
2. Find 3-5 competitor accounts
3. Analyze top-performing content: hooks, slide format, views, posting frequency, CTAs, trending sounds
4. Check App Store / website for competitor positioning
5. Compile findings into `tiktok-marketing/competitor-research.json`:

```json
{
  "researchDate": "2026-03-15",
  "competitors": [
    {
      "name": "CompetitorApp",
      "handle": "@competitor",
      "followers": 50000,
      "topHooks": ["hook 1", "hook 2"],
      "avgViews": 15000,
      "bestVideo": { "views": 500000, "hook": "..." },
      "format": "before-after slideshows",
      "postingFrequency": "daily",
      "cta": "link in bio",
      "notes": "Strong at X, weak at Y"
    }
  ],
  "nicheInsights": {
    "trendingSounds": [],
    "commonFormats": [],
    "gapOpportunities": "What competitors AREN'T doing",
    "avoidPatterns": "What's clearly not working"
  }
}
```

Share findings conversationally with the user before proceeding.

### Phase 3: Content Strategy

Based on competitor research and product profile:

1. Define 3-5 hook categories to test (person+conflict, POV, listicle, tutorial, before/after)
2. Define CTA variants to A/B test
3. Set posting schedule (3x/day recommended)
4. Choose cross-posting platforms
5. Store in `tiktok-marketing/strategy.json`

### Phase 4: Set Up Daily Analytics Cron

Create a daily cron job that:

1. Pulls platform analytics (followers, impressions, reach)
2. Pulls posting history (per-post performance)
3. Pulls conversion data (if tracking is connected)
4. Cross-references to find what drives revenue, not just views
5. Generates `tiktok-marketing/reports/YYYY-MM-DD.md`
6. Messages the user with a summary + suggested hooks for today

---

## Core Workflow

### 1. Generate Slideshow Images

Create 6 portrait slides (1024×1536 or 9:16 equivalent):

**Critical rules for all providers:**

- ALWAYS portrait aspect ratio — fills the TikTok/Instagram screen
- Include "iPhone photo" and "realistic lighting" in prompts
- ALL 6 slides share the EXACT same base description (only style/feature varies)
- Lock key elements across slides (architecture, face shape, camera angle)

**Slide structure:**
| Slide | Purpose | Example |
|-------|---------|---------|
| 1 | Hook — stop the scroll | The "before" or setup shot |
| 2-3 | Build tension | Show the problem or process |
| 4-5 | Reveal / transformation | The "after" or result |
| 6 | CTA | App name + call to action |

**Timeout warning:** Generating 6 images takes 3-9 minutes. Set exec timeout to ≥600 seconds.

### 2. Add Text Overlays

Use `node-canvas` to render text directly onto slides:

**Text rendering specs:**

- Dynamic font sizing: ≤5 words → 7.5% width, ≤12 words → 6.5%, 12+ → 5.0%
- White fill + thick black outline (15% of font size) — readable on ANY background
- Position text block centered at ~28% from top
- Max text width: 75% of slide width
- Auto-wraps lines exceeding max width

**Text content rules:**

- **REACTIONS not labels** — "Wait... this is actually nice??" not "Modern minimalist"
- **4-6 words per line** — short lines scannable at a glance
- **3-4 lines per slide** ideal
- **No emoji** — canvas can't render them reliably
- **Safe zones:** No text in bottom 20% (platform controls) or top 10% (status bar)
- **Use manual `\n` breaks** for control over line rhythm

**Good example:**

```json
[
  "I showed my landlord\nwhat AI thinks our\nkitchen should look like",
  "She said you can't\nchange anything\nchallenge accepted",
  "So I downloaded\nthis app and\ntook one photo",
  "Wait... is this\nactually the same\nkitchen??",
  "Okay I'm literally\nobsessed with\nthis one",
  "[App] showed me\nwhat's possible\nlink in bio"
]
```

**Reference overlay code:**

```javascript
const { createCanvas, loadImage } = require("canvas");
const fs = require("fs");

async function addOverlay(imagePath, text, outputPath) {
  const img = await loadImage(imagePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const wordCount = text.split(/\s+/).length;
  let fontSizePercent;
  if (wordCount <= 5) fontSizePercent = 0.075;
  else if (wordCount <= 12) fontSizePercent = 0.065;
  else fontSizePercent = 0.05;

  const fontSize = Math.round(img.width * fontSizePercent);
  const outlineWidth = Math.round(fontSize * 0.15);
  const maxWidth = img.width * 0.75;
  const lineHeight = fontSize * 1.3;

  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // Word wrap
  const lines = [];
  for (const ml of text.split("\n")) {
    const words = ml.trim().split(/\s+/);
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  const totalHeight = lines.length * lineHeight;
  const startY = img.height * 0.28 - totalHeight / 2;
  const x = img.width / 2;

  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineHeight;
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = outlineWidth;
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.strokeText(lines[i], x, y);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(lines[i], x, y);
  }

  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
}
```

### 3. Post to Platforms

Post the completed slideshow to configured platforms. Use whichever posting API the user has set up.

**TikTok-specific:** Post as photo carousel. TikTok slideshows benefit enormously from trending sounds — post as draft, then the user adds trending audio from TikTok's sound library before publishing. Posts without music get buried.

**Instagram:** Carousels work great as-is without music.

**Caption rules:** Long storytelling captions get 3x more views. Structure:

1. Hook line
2. Problem / relatable moment
3. Discovery ("then I found...")
4. What it does
5. Result
6. Max 5 hashtags

### 4. Track Analytics

Pull analytics daily from your posting platform + conversion tracking system.

**Cross-reference two data sources:**

1. Platform analytics → impressions, views, reach, followers
2. Conversion tracking → downloads, signups, revenue, subscribers

---

## The Feedback Loop (This Is What Makes It Work)

### Diagnostic Framework

Two axes: **views** (are people seeing it?) and **conversions** (are people paying?).

| Scenario                                    | Signal            | Action                                                                                                                                    |
| ------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢 High views + High conversions            | **SCALE IT**      | Make 3 variations of the winning hook. Cross-post everywhere. Don't change the CTA.                                                       |
| 🟡 High views + Low conversions             | **FIX THE CTA**   | Hook is working. Rotate CTAs: "link in bio" → "search on App Store" → "free to try." Check if landing page matches the slideshow promise. |
| 🟡 Low views + High conversions             | **FIX THE HOOKS** | Content converts but nobody sees it. Test radically different hooks. Try different posting times and slide 1 images. Keep CTA identical.  |
| 🔴 Low views + Low conversions              | **FULL RESET**    | Neither hook nor conversion is working. Try a different format. Research what's trending right now. Consider a different audience angle.  |
| 🔴 High views + High downloads + Low paying | **APP ISSUE**     | Marketing is working! The app onboarding, paywall, or pricing needs fixing. Pause posting and fix the app experience.                     |

### Hook Evolution

Track in `tiktok-marketing/hook-performance.json`:

```json
{
  "hooks": [
    {
      "text": "My boyfriend said our flat looks like a catalogue",
      "date": "2026-03-15",
      "views": null,
      "conversions": 4,
      "cta": "Download [App] — link in bio",
      "lastChecked": "2026-03-16"
    }
  ],
  "ctas": [
    {
      "text": "Download [App] — link in bio",
      "timesUsed": 5,
      "totalConversions": 8,
      "conversionRate": 0.067
    }
  ],
  "rules": {
    "doubleDown": ["person-conflict-ai"],
    "testing": ["listicle", "pov-format"],
    "dropped": ["self-complaint", "price-comparison"]
  }
}
```

**Decision rules:**

- Growing impressions + conversions → **DOUBLE DOWN** — make 3 variations immediately
- Steady impressions → Good — keep in rotation
- Declining impressions → Try 1 more variation
- Consistently low → **DROP** — try something radically different

### CTA Testing

When views are good but conversions are low, cycle through:

- "Download [App] — link in bio"
- "[App] is free to try — link in bio"
- "I used [App] for this — link in bio"
- "Search [App] on the App Store"
- No explicit CTA (just app name visible on slide 6)

Track which CTAs convert best per hook category.

---

## Proven Hook Formulas

### Tier 1: Person + Conflict → AI → Changed Mind (BEST)

- "My boyfriend said our flat looks like a catalogue"
- "My roommate thinks you can't change a rental"
- "My mom said AI can't design a kitchen"

### Tier 2: Relatable Budget Pain

- "When you want a $50K renovation but have a $50 budget"
- "POV: you're obsessed with interior design but broke"

### Tier 3: POV / Listicle

- "POV: you downloaded [App] at 2am and now you can't stop"
- "3 rooms [App] completely transformed"

---

## Posting Schedule

Optimal times (adjust for audience timezone):

- **7:30 AM** — catch early scrollers
- **4:30 PM** — afternoon break
- **9:00 PM** — evening wind-down

3x/day minimum. Consistency beats sporadic viral hits. 100 posts beats 1 viral.

## Cross-Posting

Same slides, different algorithms, more surface area. Recommended:

- **Instagram** — especially strong for beauty/lifestyle/home
- **YouTube Shorts** — long-tail discovery
- **Threads** — lightweight engagement driver
- **LinkedIn** — for B2B/professional apps
- **Pinterest** — strong for visual/home/design niches

---

## Common Mistakes

| Mistake                          | Fix                                                |
| -------------------------------- | -------------------------------------------------- |
| Landscape images (1536×1024)     | Use portrait (1024×1536)                           |
| Font too small (5% width)        | Use 6.5% of width                                  |
| Text at bottom of slide          | Position at 28% from top                           |
| Different rooms/scenes per slide | Lock architecture in EVERY prompt                  |
| Labels instead of reactions      | "Wait this is nice??" not "Modern style"           |
| Only tracking views              | Track conversions — views without revenue = vanity |
| Same hooks forever               | Iterate based on data, test new formats weekly     |
| No cross-posting                 | Post everywhere simultaneously                     |
| Skipping the warmup              | 7-14 days TikTok warmup prevents bot flagging      |

## File Structure

```
tiktok-marketing/
├── app-profile.json           # Product info from Phase 1
├── competitor-research.json   # Research from Phase 2
├── strategy.json              # Content strategy from Phase 3
├── config.json                # API keys, posting config
├── hook-performance.json      # Hook + CTA tracking
├── posts/
│   └── YYYY-MM-DD-HHmm/      # Per-post directory
│       ├── slide1.png ... slide6.png
│       ├── slide1-overlay.png ... slide6-overlay.png
│       ├── prompts.json
│       ├── texts.json
│       └── meta.json          # Post metadata + tracking IDs
└── reports/
    └── YYYY-MM-DD.md          # Daily analytics reports
```
