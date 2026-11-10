# Saligue AI Studio — Saligue's own image AI

Draws clothes realistically on a shopper's photo with open models running on a server you own, so there is no
daily limit and no third-party AI company in the middle:

- **Leffa** (MIT licence, Meta 2025) — redraws one garment on a person ("Wear this item").
- **Stable Diffusion XL Inpainting** (OpenRAIL++) — redraws the clothing area from a text description
  ("Dress me as I describe"), keeping the face, hair, hands and background.

Body keypoints come from **MediaPipe Pose** (Apache-2.0) instead of OpenPose. Saligue uses this server **first**
for every realistic look once it is connected.

## What you need

A server with an **NVIDIA GPU, 16 GB or more** (24 GB recommended) and Ubuntu 22.04 or 24.04 —
for example a Hetzner **GEX44** (Dedicated → GPU). Each look takes about 10–20 seconds.

## Install (about 30 minutes)

On the GPU server, as root:

```bash
git clone <your Saligue repository> saligue && cd saligue/ai-server
SALIGUE_SERVER_IP=78.47.151.100 bash install.sh
```

If the script installs the NVIDIA driver, it asks you to `reboot`; run it again afterwards.
`SALIGUE_SERVER_IP` makes the firewall accept only your Saligue server.

At the end it prints an **address** and a **secret key**. Paste them in Saligue →
**Me → Platform settings → Own AI server** (or run `node server/admin.mjs aiserver <address> <key>` on the Saligue
server). Until then Saligue uses the paid model, then the free public demos.

## What the app can ask for

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /api/health` | — | GPU, `ready`, `busy`, `waiting`, the presets, and what has been learned. **No key needed** (monitoring). |
| `POST /api/tryon` | `{person, garment, category, variant, quality, description}` | `{image, seconds, quality, category, engine}` |
| `POST /api/dress` | `{person, prompt, negative, coverage, quality}` | `{image, seconds, quality}` |
| `POST /api/feedback` | `{category, kept, engine, reason}` | `{ok, category, stats, tuning}` |

Every `/api/` route except the health check needs the secret key in `X-Saligue-Key`; without it the answer is 403,
so only Saligue can spend your GPU. `coverage` is `full` (may cover arms and legs) or `clothes` (only where clothes
already are). `description` on `/api/tryon` is the item's own words, kept for logging and future prompts.

## Quality: fast, high, ultra

The app sends `quality`; anything unknown means `high`. The same setting also changes how quickly a look comes back,
which is what makes a slow connection usable.

| Quality | Steps | Follows the garment | Follows a description | When |
| --- | --- | --- | --- | --- |
| `fast` | 22 | 2.2 | 6.0 | a quick look on a slow connection |
| `high` | `STEPS` (32) | 2.5 | 7.0 | the Fitting Room's default |
| `ultra` | 46 | 2.8 | 7.6 | a shopper who asked for the best |

**Every look is checked before it is returned.** The server measures how much of the clothing area really changed;
below `MIN_CHANGE` the garment barely went on, so the look is drawn once more with another seed and the better of
the two is returned. That alone removes most "the clothes did not change" results.

**One look at a time.** The GPU queue runs one job, reports `busy`, `waiting` and the current `job`, and gives the
graphics memory back after every job so Leffa and SDXL can take turns on one card. A request waits up to `MAX_WAIT`
seconds for its turn, then answers 503 "the AI is busy" instead of hanging.

## What it learns

Only counters, never training, so nothing can be learned that cannot be read and corrected:

- `POST /api/feedback` records what a shopper did with a look it drew — kept it or threw it away — per part of the
  body. Saligue sends this itself whenever a shopper keeps or refuses a look made by this server.
- Those counters nudge the guidance for that part of the body a little (0.9–1.1 × the preset): the direction that
  produced looks people kept is followed slightly more strongly next time.
- The counters live in `LEARN_FILE` (`studio-learning.json` next to `server.py`) and are shown by `/api/health`.
  **Delete the file to start learning from nothing again.** A corrupt file means "nothing learned yet", never a crash.

## Settings

`/etc/saligue-ai.env`, then `systemctl restart saligue-ai`.

| Setting | Default | What it does |
| --- | --- | --- |
| `SALIGUE_AI_KEY` | — | the secret key Saligue must send. **Required.** |
| `STEPS` | `32` | steps for the `high` preset (the other presets are fixed) |
| `MAX_WAIT` | `600` | seconds a look may wait for the GPU before it is told the AI is busy |
| `MIN_CHANGE` | `0.015` | share of the clothing area that must change for a look to count |
| `LEARN_FILE` | `studio-learning.json` | where kept and refused looks are counted |
| `PRELOAD` | `1` | load Leffa at start (the first look is then not slow) |
| `PRELOAD_SDXL` | `0` | load SDXL at start too: about a minute and ~7 GB more |
| `STUDIO_PAGE` | `0` | serve the browser test page at `/studio` (no key, so off by default) |
| `HOST` / `PORT` | `127.0.0.1` / `7860` | where it listens; keep it behind Caddy, not open to the internet |
| `LEFFA_DIR` / `LEFFA_CKPTS` | `./Leffa` / `./Leffa/ckpts` | where Leffa and its weights are installed |
| `SDXL_INPAINT` | `diffusers/stable-diffusion-xl-1.0-inpainting-0.1` | the inpainting model for "Dress me" |

## Day to day

- Status: `systemctl status saligue-ai` · logs: `journalctl -u saligue-ai -f`
- Health: `https://<address>/api/health` (GPU, whether the models are loaded, the queue, what has been learned)
- Test page: `STUDIO_PAGE=1`, then open `https://<address>/studio` and try a real photo
- Screenshots, not photos: nothing is stored. Shoppers' photos are used only to make the look and are never written
  to disk by this server; the app sends the ones already trimmed to 1024 px.
