# Reel Farmer

Turns a long-form YouTube video into short-form vertical clips (TikTok/Shorts/Reels):
downloads it, transcribes it, asks DeepSeek which moments are worth clipping, then per
clip extracts, removes silence, generates karaoke-style captions, and composes a final
1080x1920 MP4. Runs entirely on your machine; the only network call is to DeepSeek for
clip identification (BYOK — bring your own API key).

## Prerequisites

Install these and make sure they're on `PATH`:

- [Bun](https://bun.sh)
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp)
- `ffmpeg` (with `ffprobe`)
- [`whisper-cli`](https://github.com/ggerganov/whisper.cpp) (whisper.cpp's CLI binary)
- A Whisper GGML model — `models/` already has `ggml-base.bin`, `ggml-small.bin`,
  `ggml-medium.bin`; point `WHISPER_MODEL` at whichever you want to use
- A DeepSeek API key ([platform.deepseek.com](https://platform.deepseek.com)) — used only
  for the `IDENTIFY_CLIPS` stage

## Setup

```bash
bun install
cp .env.example .env   # then fill in DEEPSEEK_API_KEY
```

## Quick start

Full-auto — download, transcribe, identify clips, and render all of them without
stopping for review:

```bash
bun run pipeline <youtube-url>
# output: ./output/<video-id>/*.mp4
```

With manual clip review (pick/trim/edit captions before rendering), run the web
dashboard instead:

```bash
bun run web
# open http://localhost:3001, paste a YouTube URL, wait for "awaiting selection",
# pick clips, hit Render
```

## CLI commands (`bun run src/index.ts <command>`)

| Command | Usage | What it does |
| --- | --- | --- |
| `pipeline` | `pipeline <youtube-url>` | Full-auto run through all 7 stages |
| `batch` | `batch <channel-url> -l N [--skip-existing]` | Runs `pipeline` for the channel's last N videos |
| `resume` | `resume <run-id>` | Resumes a run from its last completed stage |
| `status` | `status [run-id]` | Lists runs, or shows one run's detail + per-clip progress |
| `clean` | `clean <run-id> [--all]` | Deletes intermediate artifacts; `--all` also deletes final output + the run record |

`bun run pipeline` is a shortcut for `bun run src/index.ts pipeline`.

## Pipeline stages

Global (once per video): `DOWNLOAD` → `TRANSCRIBE` → `IDENTIFY_CLIPS`.
Per clip (parallelized up to `MAX_PARALLEL_CLIPS`): `EXTRACT_CLIPS` → `REMOVE_SILENCE` →
`GENERATE_CAPTIONS` → `COMPOSE_REEL`.

Every stage's completion is checkpointed in SQLite (`data/checkpoints.db`), so `resume`
(or re-running `pipeline`/the web dashboard) skips whatever already finished.

- **DOWNLOAD** — `yt-dlp` fetches the video + any existing subtitles.
- **TRANSCRIBE** — prefers YouTube's own subtitles (`PREFER_YOUTUBE_TRANSCRIPTS=true`);
  falls back to `whisper-cli` on the extracted audio.
- **IDENTIFY_CLIPS** — sends the transcript to DeepSeek, which returns candidate clips
  (title, hook line, start/end, viral score, tags); filtered to 15–120s and sorted by
  score.
- **EXTRACT_CLIPS** — `ffmpeg` cuts the clip's time range out of the source video.
- **REMOVE_SILENCE** — `ffmpeg` silencedetect + a cut list to drop dead air.
- **GENERATE_CAPTIONS** — re-transcribes the clip's own (desilenced) audio word-by-word
  with `whisper-cli`, aligns those timestamps to the original transcript's text where
  word counts match, groups words, and renders a transparent WebM caption overlay via
  Remotion (`@remotion/bundler` + `@remotion/renderer`, headless).
- **COMPOSE_REEL** — `ffmpeg` scales/crops the desilenced clip to 1080x1920 and overlays
  the caption WebM to produce the final MP4.

## Web dashboard (`src/web/`)

A Bun-served React app + JSON API (`bun run web`, default port `3001`, override with
`WEB_PORT`). Lets you start a run, watch it reach `awaiting_selection`, review/trim/add
custom clips (or paste a JSON array to import), select which to render, and edit a
rendered clip's captions (drag word boundaries, regenerate the overlay) without
re-running Whisper. No auth — it's meant for local, single-user use.

## Desktop app (`src-tauri/`)

`bun run desktop` opens the same dashboard in a native window (Tauri) instead of a
browser tab — it spawns `bun run web` itself and points the window at it, killing that
process when the window closes. `bun run desktop:build` produces an installer.
`bun`/`yt-dlp`/`ffmpeg`/`whisper-cli` still need to be on `PATH`; bundling the runtime and
its dependencies into a self-contained installer is a separate, not-yet-done step.

## Configuration (`.env`)

See `.env.example` for the full list with defaults. Only `DEEPSEEK_API_KEY` is required;
everything else has a sane default:

| Var | Default | Meaning |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | *(required)* | Your DeepSeek key, used for `IDENTIFY_CLIPS` |
| `MAX_PARALLEL_CLIPS` | `3` | Concurrent clip stages per run |
| `CLIP_SPEED` | `1.2` | Reserved for future playback-speed tuning |
| `SILENCE_THRESHOLD_DB` | `-30` | `ffmpeg silencedetect` noise floor |
| `SILENCE_MIN_DURATION` | `0.5` | Minimum silence length (s) to cut |
| `WHISPER_MODEL` | `./models/ggml-base.en.bin` | Path to a GGML model |
| `WHISPER_LANGUAGE` | `en` | Whisper language hint |
| `CAPTION_ANIMATE` | `true` | Karaoke word-highlight animation on/off |
| `CAPTION_OFFSET_MS` | `0` | Shift caption timing to correct sync drift |
| `WEB_PORT` | `3001` | Dashboard port |
| `PREFER_YOUTUBE_TRANSCRIPTS` | `true` | Use YouTube subtitles over Whisper when available |

## Data layout

- `data/checkpoints.db` — SQLite: run status, per-stage/per-clip progress
- `data/runs/<run-id>/` — intermediate artifacts (source video, transcript, per-clip
  working files); safe to delete with `clean`
- `output/<video-id>/*.mp4` — final rendered clips

## Testing

```bash
bun test          # unit tests — pure logic + web API, no external binaries required
bun run typecheck # tsc --noEmit
```

## Known limitations

DeepSeek is the only clip-identification provider (no fallback), the dashboard has no
auth (fine for local single-user use, not for exposing the port), and there's no
API cost/usage tracking yet. See `PRD.md` for the full gap list and roadmap.
