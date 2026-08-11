# AGENTS.md

Guidance for coding agents working in this repo. See `README.md` for the product-level
overview and `PRD.md` for roadmap/gaps — this file is about how to work in the code.

## Commands

```bash
bun install
bun run pipeline <youtube-url>  # full-auto CLI pipeline
bun run web                     # dashboard at :3001 (WEB_PORT)
bun test                        # bun:test — run before and after any change
bun run typecheck               # tsc --noEmit
```

No lint script exists yet. `bun test` and `bun run typecheck` are the whole safety net —
run both before considering a change done.

Running `pipeline`/`web` against real videos needs `yt-dlp`, `ffmpeg`, `whisper-cli` on
`PATH` and `DEEPSEEK_API_KEY` set — but `bun test` does not: tests inject a fake `fetch`
(see `clip-identifier.test.ts`) or mock the module boundary (see `server.test.ts`), never
hitting real network/binaries.

## Architecture

`src/pipeline/orchestrator.ts` drives 7 stages (3 global, 4 per-clip) defined in
`src/pipeline/types.ts`; each stage's own logic lives in `src/modules/*.ts` as a plain
async function. `src/pipeline/checkpoint.ts` (SQLite) records per-stage/per-clip status so
any run can resume from its last completed stage — `initRun`/`runGlobalStages` in the
orchestrator check `resumable.completedGlobalStages`/`resumable.clips` before redoing work.
`src/index.ts` (CLI) and `src/web/server.ts` (dashboard API) are two entry points onto the
same orchestrator functions; don't duplicate stage logic in either.

## Conventions

- **Pure logic separate from I/O.** Stage modules export small pure functions (parsing,
  filtering, validation) alongside the async function that does the actual network/`exec`
  call — e.g. `clip-identifier.ts` exports `parseClipCandidates`/`filterAndSortCandidates`
  separately from `callDeepSeek`. This is what makes them testable without mocking
  `fetch`/`ffmpeg` for every case. Web components follow the same split: pure transforms
  (`applyWordResize` in `CaptionEditor.tsx`, `parseImportedClips` in `RunDetail.tsx`) are
  exported and tested directly rather than through rendered DOM — there's no
  jsdom/testing-library in this repo, so don't add one for a pure-function test.
- **Structured JSON logs only**, via `log()` in `src/logger.ts` — `{ timestamp, service,
  level, message, ...fields }`, always pass `runId` when inside a run.
- **BYOK error messages.** Anything that can fail because of the user's own DeepSeek key
  (bad key, quota, malformed response) should throw a message that says so explicitly —
  see `friendlyDeepSeekError` in `clip-identifier.ts`. Don't let a raw JSON-parse or fetch
  error bubble up unexplained.
- **`ponytail:` comments** mark a deliberate simplification with a known ceiling and an
  upgrade path (e.g. `caption-generator.ts`'s positional-only word alignment). Leave them
  in place; don't "fix" them without the ceiling actually being hit.
- **No new dependencies for what stdlib/an installed dep already does.** Check
  `package.json` before reaching for something new.

## Testing patterns already in use

- `bun:test` (`describe`/`test`/`expect`/`mock`), colocated `*.test.ts` next to the file
  under test.
- Fake `fetch` injected via an options param (`callDeepSeek(prompt, { fetchImpl })`) rather
  than mocking global fetch.
- `mock.module("../pipeline/orchestrator", () => ({ ... }))` to isolate the web server from
  the real pipeline in `server.test.ts`.
- `new CheckpointManager(":memory:")` for a throwaway SQLite DB per test — never point tests
  at `data/checkpoints.db`.

## Gotchas

- `config.ts`'s `requireDeepSeekApiKey`/`requireWhisperModel` are called lazily at the point
  of use, not at module load — so `status`/`clean` (and most tests) work without a key or a
  model file present. Don't hoist those calls to import time.
- `data/`, `output/`, `models/`, `.env` are gitignored — don't assume they're empty or
  present; code that touches them should handle "doesn't exist yet".
