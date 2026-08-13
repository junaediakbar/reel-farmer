#!/usr/bin/env bun
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join, sep } from "node:path";
import {
  activeAiProvider,
  aiModelHistory,
  aiModelStatus,
  config,
  dashboardAuthToken,
  deepSeekApiKeyStatus,
  nvidiaApiKeyStatus,
  saveAiModel,
  saveDeepSeekApiKey,
  saveNvidiaApiKey,
  setActiveAiProvider,
  type AiProvider,
} from "../config";
import { log } from "../logger";
import { CheckpointManager } from "../pipeline/checkpoint";
import {
  finalClipPath,
  finalThumbnailPath,
  processSelectedClips,
  regenerateCaptionOverlay,
  retranscribeCaptionOverlay,
  runUntilSelection,
} from "../pipeline/orchestrator";
import { checkStatus, installAll } from "../modules/dependency-installer";
import { activateLicense, checkLicense } from "../modules/license";
import { listAiModels } from "../modules/clip-identifier";
import {
  CLIP_STAGES,
  GLOBAL_STAGES,
  type CaptionGroup,
  type CaptionStyle,
  type ClipCandidate,
  type ClipProgress,
  type GlobalStage,
  type PreProductionOptions,
  type RunOptions,
  type TokenUsage,
} from "../pipeline/types";
import { serveVideoFile } from "./serveVideoFile";
import homepage from "./index.html";

/** MIME → stored extension allowlist for Pre-Production asset uploads (watermark/thumbnail images). */
const ASSET_IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

/** GET/POST pair for one provider's analysis model — Settings UI reads the current choice (plus recently-used models) and saves a new one. */
function modelRoute(provider: AiProvider): Record<string, MethodHandler> {
  return {
    GET: () => json({ ...aiModelStatus(provider), history: aiModelHistory(provider) }),
    POST: async (req) => {
      const body = (await req.json().catch(() => ({}))) as { model?: string };
      const model = body.model?.trim();
      if (!model) return json({ error: "model is required" }, { status: 400 });
      saveAiModel(provider, model);
      return json({ ok: true });
    },
  };
}

/** GET of one provider's /models list for the Settings dropdown — empty list + error message (not a 500) when the key is missing/invalid so the UI can explain. */
function modelsRoute(provider: AiProvider): Record<string, MethodHandler> {
  return {
    GET: async () => {
      try {
        return json({ models: await listAiModels(provider) });
      } catch (err) {
        return json({ models: [], error: errMsg(err) });
      }
    },
  };
}

type MethodHandler = (req: Bun.BunRequest<string>) => Response | Promise<Response>;

/** Checks Authorization: Bearer <token> against DASHBOARD_AUTH_TOKEN. No token configured = no auth required (localhost dev default). */
function isAuthorized(req: Request): boolean {
  const token = dashboardAuthToken();
  if (!token) return true;
  return req.headers.get("Authorization") === `Bearer ${token}`;
}

/** Single auth checkpoint for every /api/* route (G2) — wraps each method handler once here rather than per-handler. */
type RouteValue = Bun.HTMLBundle | Partial<Record<string, MethodHandler>>;

function withAuth<T extends Record<string, RouteValue>>(routes: T): T {
  const wrapped: Record<string, RouteValue> = {};
  for (const [path, entry] of Object.entries(routes)) {
    if (!path.startsWith("/api/") || typeof entry !== "object" || entry === null) {
      wrapped[path] = entry;
      continue;
    }
    const methods: Record<string, MethodHandler> = {};
    for (const [method, handler] of Object.entries(entry as Record<string, MethodHandler>)) {
      methods[method] = (req) => (isAuthorized(req) ? handler(req) : json({ error: "unauthorized" }, { status: 401 }));
    }
    wrapped[path] = methods;
  }
  return wrapped as T;
}

interface DownloadResult {
  videoId: string;
  title: string;
  durationSec: number;
  videoPath: string;
  subtitlePath: string | null;
}

async function readDownloadResult(runId: string): Promise<DownloadResult | null> {
  const path = join(config.runsDir, runId, "download-result.json");
  if (!existsSync(path)) return null;
  return (await Bun.file(path).json()) as DownloadResult;
}

/** Dedup by videoId, most-recent run first (`listRuns` is already DESC by created_at) — backs "reuse a video I already downloaded". */
async function listExistingDownloads(checkpoint: CheckpointManager): Promise<DownloadResult[]> {
  const seen = new Map<string, DownloadResult>();
  for (const run of checkpoint.listRuns()) {
    if (!run.videoId || seen.has(run.videoId)) continue;
    const dl = await readDownloadResult(run.id);
    if (dl) seen.set(run.videoId, dl);
  }
  return [...seen.values()];
}

interface RenderedClip {
  runId: string;
  clipId: string;
  runTitle: string | null;
  title: string;
  viralScore: number;
  tags: string[];
  durationSec: number;
  renderedAt: string;
}

/** Every clip whose 4 render stages (`CLIP_STAGES`) are all completed, across every run — backs the Library page. */
async function listRenderedClips(checkpoint: CheckpointManager): Promise<RenderedClip[]> {
  const results: RenderedClip[] = [];
  for (const run of checkpoint.listRuns()) {
    const clipsPath = join(config.runsDir, run.id, "clips.json");
    if (!existsSync(clipsPath)) continue;
    const clips = (await Bun.file(clipsPath).json()) as ClipCandidate[];

    const stagesByClip = new Map<string, ClipProgress[]>();
    for (const p of checkpoint.getClipProgress(run.id)) {
      const list = stagesByClip.get(p.clipId) ?? [];
      list.push(p);
      stagesByClip.set(p.clipId, list);
    }

    for (const clip of clips) {
      const stages = stagesByClip.get(clip.id) ?? [];
      if (stages.length !== CLIP_STAGES.length || !stages.every((s) => s.status === "completed")) continue;
      const renderedAt = stages.reduce((latest, s) => (s.completedAt && s.completedAt > latest ? s.completedAt : latest), "");
      results.push({
        runId: run.id,
        clipId: clip.id,
        runTitle: run.title,
        title: clip.title,
        viralScore: clip.viralScore,
        tags: clip.tags,
        durationSec: Math.round(clip.endSec - clip.startSec),
        renderedAt,
      });
    }
  }
  return results.sort((a, b) => b.renderedAt.localeCompare(a.renderedAt));
}

/** Seeds a new run's DOWNLOAD stage as already-complete from a previously downloaded video, so `runUntilSelection` skips straight to TRANSCRIBE. */
function seedRunFromExistingDownload(checkpoint: CheckpointManager, dl: DownloadResult): { runId: string; runDir: string } {
  const runId = crypto.randomUUID();
  const runDir = join(config.runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  checkpoint.createRun(runId, dl.videoId, dl.videoPath, dl.title);
  Bun.write(join(runDir, "download-result.json"), JSON.stringify(dl));
  checkpoint.startStage(runId, "DOWNLOAD");
  checkpoint.completeStage(runId, "DOWNLOAD", JSON.stringify(dl));
  return { runId, runDir };
}

export function createServer(checkpoint: CheckpointManager = new CheckpointManager(), port: number = config.webPort) {
  return Bun.serve({
    port,
    routes: withAuth({
      "/": homepage,
      // Client-side routes (App.tsx's `parseRoute`) — served the same SPA shell so direct nav/refresh doesn't 404.
      "/runs": homepage,
      "/runs/new": homepage,
      "/runs/:id": homepage,
      "/runs/:id/clips/:clipId/captions": homepage,
      "/library": homepage,
      "/settings": homepage,
      "/api/deps/status": {
        GET: async () => json(await checkStatus()),
      },

      "/api/deps/install": {
        POST: async () => {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              try {
                await installAll((p) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(p)}\n\n`)));
              } finally {
                controller.close();
              }
            },
          });
          return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
        },
      },
      "/api/license/status": {
        GET: async () => json(await checkLicense()),
      },
      "/api/license/activate": {
        POST: async (req) => {
          const body = (await req.json().catch(() => ({}))) as { licenseKey?: string };
          if (!body.licenseKey) return json({ error: "licenseKey is required" }, { status: 400 });
          try {
            return json(await activateLicense(body.licenseKey));
          } catch (err) {
            return json({ error: errMsg(err) }, { status: 400 });
          }
        },
      },
      "/api/settings/deepseek-key": {
        GET: () => json(deepSeekApiKeyStatus()),
        POST: async (req) => {
          const body = (await req.json().catch(() => ({}))) as { deepseekApiKey?: string };
          if (!body.deepseekApiKey) return json({ error: "deepseekApiKey is required" }, { status: 400 });
          saveDeepSeekApiKey(body.deepseekApiKey);
          return json({ ok: true });
        },
      },
      "/api/settings/nvidia-key": {
        GET: () => json(nvidiaApiKeyStatus()),
        POST: async (req) => {
          const body = (await req.json().catch(() => ({}))) as { nvidiaApiKey?: string };
          if (!body.nvidiaApiKey) return json({ error: "nvidiaApiKey is required" }, { status: 400 });
          saveNvidiaApiKey(body.nvidiaApiKey);
          return json({ ok: true });
        },
      },
      "/api/settings/ai-provider": {
        GET: () => json({ provider: activeAiProvider() }),
        POST: async (req) => {
          const body = (await req.json().catch(() => ({}))) as { provider?: string };
          if (body.provider !== "deepseek" && body.provider !== "nvidia") {
            return json({ error: "provider must be 'deepseek' or 'nvidia'" }, { status: 400 });
          }
          setActiveAiProvider(body.provider);
          return json({ ok: true });
        },
      },
      "/api/settings/deepseek-model": modelRoute("deepseek"),
      "/api/settings/nvidia-model": modelRoute("nvidia"),
      "/api/settings/deepseek-models": modelsRoute("deepseek"),
      "/api/settings/nvidia-models": modelsRoute("nvidia"),
      "/api/videos": {
        GET: async () => json(await listExistingDownloads(checkpoint)),
      },
      "/api/clips": {
        GET: async () => json(await listRenderedClips(checkpoint)),
      },

      "/api/runs": {
        GET: () => json(checkpoint.listRuns()),
        POST: async (req) => {
          const body = (await req.json().catch(() => ({}))) as {
            youtubeUrl?: string;
            existingVideoId?: string;
            options?: RunOptions;
          };
          const options = body.options ?? {};

          if (body.existingVideoId) {
            const dl = (await listExistingDownloads(checkpoint)).find((v) => v.videoId === body.existingVideoId);
            if (!dl) return json({ error: "Unknown existingVideoId" }, { status: 404 });
            const { runId } = seedRunFromExistingDownload(checkpoint, dl);
            runUntilSelection(checkpoint, dl.videoPath, runId, options).catch((err) =>
              log("error", "background runUntilSelection failed", { runId, error: errMsg(err) }),
            );
            return json({ runId }, { status: 201 });
          }

          if (!body.youtubeUrl) return json({ error: "youtubeUrl or existingVideoId is required" }, { status: 400 });
          const runId = crypto.randomUUID();
          // Created synchronously so the client can poll /api/runs/:id immediately, no race with runUntilSelection's own creation.
          checkpoint.createRun(runId, "", body.youtubeUrl, null);
          runUntilSelection(checkpoint, body.youtubeUrl, runId, options).catch((err) =>
            log("error", "background runUntilSelection failed", { runId, error: errMsg(err) }),
          );
          return json({ runId }, { status: 201 });
        },
      },

      "/api/runs/:id": {
        GET: async (req) => {
          const run = checkpoint.getRun(req.params.id!);
          if (!run) return json({ error: "not found" }, { status: 404 });
          const clipsPath = join(config.runsDir, run.id, "clips.json");
          const clips = existsSync(clipsPath) ? ((await Bun.file(clipsPath).json()) as ClipCandidate[]) : [];
          const identifyResult = checkpoint.getStageResult(run.id, "IDENTIFY_CLIPS");
          const tokenUsage = identifyResult?.resultJson
            ? ((JSON.parse(identifyResult.resultJson) as { tokenUsage: TokenUsage | null }).tokenUsage ?? null)
            : null;
          return json({ run, clips, clipProgress: checkpoint.getClipProgress(run.id), tokenUsage });
        },
        DELETE: async (req) => {
          const run = checkpoint.getRun(req.params.id!);
          if (!run) return json({ error: "not found" }, { status: 404 });
          const runDir = join(config.runsDir, run.id);

          // outputDir is keyed by videoId, not runId — a video downloaded once can back multiple
          // runs (existingVideoId), so only remove this run's own rendered files, never the whole dir.
          if (run.videoId) {
            const clipsPath = join(runDir, "clips.json");
            if (existsSync(clipsPath)) {
              const clips = (await Bun.file(clipsPath).json()) as ClipCandidate[];
              const outputDir = join(config.outputDir, run.videoId);
              for (const clip of clips) {
                const outPath = finalClipPath(outputDir, clip);
                if (existsSync(outPath)) rmSync(outPath, { force: true });
                const thumbPath = finalThumbnailPath(outputDir, clip);
                if (existsSync(thumbPath)) rmSync(thumbPath, { force: true });
              }
            }
          }

          checkpoint.deleteRun(run.id);
          if (existsSync(runDir)) rmSync(runDir, { recursive: true, force: true });
          return json({ ok: true });
        },
      },

      "/api/runs/:id/retry": {
        POST: async (req) => {
          const run = checkpoint.getRun(req.params.id!);
          if (!run) return json({ error: "not found" }, { status: 404 });
          if (run.status !== "failed") return json({ error: "run is not failed" }, { status: 400 });

          // A run fails either during DOWNLOAD/TRANSCRIBE/IDENTIFY_CLIPS (before clip selection exists)
          // or during EXTRACT_CLIPS..COMPOSE_REEL (after clips.json was written by /select) — each phase
          // needs its own resume call, or retry would silently skip clip rendering.
          const failedDuringClipPhase = run.currentStage !== null && !GLOBAL_STAGES.includes(run.currentStage as GlobalStage);
          if (failedDuringClipPhase) {
            const clipsPath = join(config.runsDir, run.id, "clips.json");
            if (!existsSync(clipsPath)) return json({ error: "no selected clips to resume" }, { status: 400 });
            const selectedClips = (await Bun.file(clipsPath).json()) as ClipCandidate[];
            processSelectedClips(checkpoint, run.id, selectedClips).catch((err) =>
              log("error", "background processSelectedClips failed", { runId: run.id, error: errMsg(err) }),
            );
          } else {
            runUntilSelection(checkpoint, run.videoUrl, run.id).catch((err) =>
              log("error", "background runUntilSelection failed", { runId: run.id, error: errMsg(err) }),
            );
          }
          return json({ ok: true });
        },
      },

      "/api/runs/:id/progress": {
        GET: (req) => {
          const run = checkpoint.getRun(req.params.id!);
          if (!run) return json({ error: "not found" }, { status: 404 });
          return json({
            status: run.status,
            currentStage: run.currentStage,
            errorMessage: run.errorMessage,
            clips: checkpoint.getClipProgress(run.id),
          });
        },
      },

      "/api/runs/:id/select": {
        POST: async (req) => {
          const run = checkpoint.getRun(req.params.id!);
          if (!run) return json({ error: "not found" }, { status: 404 });
          const body = (await req.json()) as {
            clips: ClipCandidate[];
            style?: CaptionStyle;
            preProduction?: PreProductionOptions;
          };
          if (!Array.isArray(body.clips) || body.clips.length === 0) {
            return json({ error: "clips must be a non-empty array" }, { status: 400 });
          }
          processSelectedClips(checkpoint, run.id, body.clips, body.style, body.preProduction).catch((err) =>
            log("error", "background processSelectedClips failed", { runId: run.id, error: errMsg(err) }),
          );
          return json({ ok: true });
        },
      },

      // Pre-Production asset upload (watermark/ending-watermark/thumbnail images) — the server mints
      // the stored filename so a client can never point compose at an arbitrary path (G: never trust
      // a client-supplied path into ffmpeg or a file read).
      "/api/runs/:id/assets": {
        POST: async (req) => {
          const run = checkpoint.getRun(req.params.id!);
          if (!run) return json({ error: "not found" }, { status: 404 });
          const form = await req.formData().catch(() => null);
          const file = form?.get("file");
          if (!(file instanceof Blob)) return json({ error: "file is required" }, { status: 400 });
          const ext = ASSET_IMAGE_EXT[file.type];
          if (!ext) return json({ error: "file must be PNG, JPEG, or WebP" }, { status: 400 });
          const assetsDir = join(config.runsDir, run.id, "assets");
          mkdirSync(assetsDir, { recursive: true });
          const asset = `${crypto.randomUUID()}.${ext}`;
          await Bun.write(join(assetsDir, asset), file);
          return json({ asset }, { status: 201 });
        },
      },

      "/api/runs/:id/assets/:name": {
        GET: (req) => {
          const assetsDir = join(config.runsDir, req.params.id!, "assets");
          const path = join(assetsDir, basename(req.params.name!));
          if (!path.startsWith(assetsDir + sep) || !existsSync(path)) return new Response("Not found", { status: 404 });
          return new Response(Bun.file(path));
        },
      },

      "/api/runs/:id/video": {
        GET: async (req) => {
          const dl = await readDownloadResult(req.params.id!);
          if (!dl) return new Response("Not found", { status: 404 });
          return serveVideoFile(dl.videoPath, req);
        },
      },

      "/api/runs/:id/clips/:clipId/video": {
        GET: async (req) => {
          const dl = await readDownloadResult(req.params.id!);
          if (!dl) return new Response("Not found", { status: 404 });
          const clipsPath = join(config.runsDir, req.params.id!, "clips.json");
          if (!existsSync(clipsPath)) return new Response("Not found", { status: 404 });
          const clips = (await Bun.file(clipsPath).json()) as ClipCandidate[];
          const clip = clips.find((c) => c.id === req.params.clipId!);
          if (!clip) return new Response("Not found", { status: 404 });
          const path = finalClipPath(join(config.outputDir, dl.videoId), clip);
          if (!existsSync(path)) return new Response("Not found", { status: 404 });
          return serveVideoFile(path, req);
        },
      },

      "/api/runs/:id/clips/:clipId/thumbnail": {
        GET: async (req) => {
          const dl = await readDownloadResult(req.params.id!);
          if (!dl) return new Response("Not found", { status: 404 });
          const clipsPath = join(config.runsDir, req.params.id!, "clips.json");
          if (!existsSync(clipsPath)) return new Response("Not found", { status: 404 });
          const clips = (await Bun.file(clipsPath).json()) as ClipCandidate[];
          const clip = clips.find((c) => c.id === req.params.clipId!);
          if (!clip) return new Response("Not found", { status: 404 });
          const path = finalThumbnailPath(join(config.outputDir, dl.videoId), clip);
          if (!existsSync(path)) return new Response("Not found", { status: 404 });
          return new Response(Bun.file(path));
        },
      },

      // Pre-caption footage (post REMOVE_SILENCE, before COMPOSE_REEL) — lets the caption editor
      // preview a style live without the old burned-in overlay showing underneath it.
      "/api/runs/:id/clips/:clipId/desilenced": {
        GET: async (req) => {
          const path = join(config.runsDir, req.params.id!, "clips", req.params.clipId!, "desilenced.mp4");
          if (!existsSync(path)) return new Response("Not found", { status: 404 });
          return serveVideoFile(path, req);
        },
      },

      "/api/runs/:id/clips/:clipId/captions": {
        GET: async (req) => {
          const path = join(config.runsDir, req.params.id!, "clips", req.params.clipId!, "captions.json");
          if (!existsSync(path)) return json({ error: "not found" }, { status: 404 });
          return json(await Bun.file(path).json());
        },
      },

      "/api/runs/:id/clips/:clipId/captions/regenerate": {
        POST: async (req) => {
          const body = (await req.json()) as { groups: CaptionGroup[]; style?: CaptionStyle };
          try {
            await regenerateCaptionOverlay(checkpoint, req.params.id!, req.params.clipId!, body.groups, body.style);
            return json({ ok: true });
          } catch (err) {
            log("error", "regenerate captions failed", { runId: req.params.id!, clipId: req.params.clipId!, error: errMsg(err) });
            return json({ error: errMsg(err) }, { status: 500 });
          }
        },
      },

      "/api/runs/:id/clips/:clipId/captions/retranscribe": {
        POST: async (req) => {
          const body = (await req.json()) as { language: string; style?: CaptionStyle };
          try {
            await retranscribeCaptionOverlay(checkpoint, req.params.id!, req.params.clipId!, body.language, body.style);
            return json({ ok: true });
          } catch (err) {
            log("error", "retranscribe captions failed", { runId: req.params.id!, clipId: req.params.clipId!, error: errMsg(err) });
            return json({ error: errMsg(err) }, { status: 500 });
          }
        },
      },

      "/api/runs/:id/clips/:clipId": {
        DELETE: async (req) => {
          const { id: runId, clipId } = req.params;
          const purge = new URL(req.url).searchParams.has("purge");
          const clipDir = join(config.runsDir, runId!, "clips", clipId!);
          if (existsSync(clipDir)) rmSync(clipDir, { recursive: true, force: true });
          checkpoint.deleteClipProgress(runId!, clipId!);

          const run = checkpoint.getRun(runId!);
          const clipsPath = join(config.runsDir, runId!, "clips.json");
          if (run?.videoId && existsSync(clipsPath)) {
            const clips = (await Bun.file(clipsPath).json()) as ClipCandidate[];
            const clip = clips.find((c) => c.id === clipId!);
            if (clip) {
              const outputDir = join(config.outputDir, run.videoId);
              const outPath = finalClipPath(outputDir, clip);
              if (existsSync(outPath)) rmSync(outPath, { force: true });
              const thumbPath = finalThumbnailPath(outputDir, clip);
              if (existsSync(thumbPath)) rmSync(thumbPath, { force: true });
            }
            // "Remove" (not just "delete render") also drops the candidate itself, AI-identified
            // or custom, so it stops reappearing in the review UI on refresh — a real backend
            // delete, not just local frontend state (G: previously "Remove" never told the server).
            if (purge) {
              await Bun.write(clipsPath, JSON.stringify(clips.filter((c) => c.id !== clipId)));
            }
          }
          return json({ ok: true });
        },
      },
    }),
  });
}

if (import.meta.main) {
  const server = createServer();
  log("info", "web server listening", { port: server.port });
}
