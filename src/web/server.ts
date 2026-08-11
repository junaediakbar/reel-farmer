#!/usr/bin/env bun
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config, dashboardAuthToken } from "../config";
import { log } from "../logger";
import { CheckpointManager } from "../pipeline/checkpoint";
import { finalClipPath, processSelectedClips, regenerateCaptionOverlay, runUntilSelection } from "../pipeline/orchestrator";
import { checkStatus, installAll } from "../modules/dependency-installer";
import type { CaptionGroup, CaptionStyle, ClipCandidate, TokenUsage } from "../pipeline/types";
import { serveVideoFile } from "./serveVideoFile";
import homepage from "./index.html";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

type MethodHandler = (req: Bun.BunRequest<string>) => Response | Promise<Response>;

/** Checks Authorization: Bearer <token> against DASHBOARD_AUTH_TOKEN. No token configured = no auth required (localhost dev default). */
function isAuthorized(req: Request): boolean {
  const token = dashboardAuthToken();
  if (!token) return true;
  return req.headers.get("Authorization") === `Bearer ${token}`;
}

/** Single auth checkpoint for every /api/* route (G2) — wraps each method handler once here rather than per-handler. */
function withAuth(routes: Record<string, unknown>): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {};
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
  return wrapped;
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
      "/api/videos": {
        GET: async () => json(await listExistingDownloads(checkpoint)),
      },

      "/api/runs": {
        GET: () => json(checkpoint.listRuns()),
        POST: async (req) => {
          const body = (await req.json().catch(() => ({}))) as { youtubeUrl?: string; existingVideoId?: string };

          if (body.existingVideoId) {
            const dl = (await listExistingDownloads(checkpoint)).find((v) => v.videoId === body.existingVideoId);
            if (!dl) return json({ error: "Unknown existingVideoId" }, { status: 404 });
            const { runId } = seedRunFromExistingDownload(checkpoint, dl);
            runUntilSelection(checkpoint, dl.videoPath, runId).catch((err) =>
              log("error", "background runUntilSelection failed", { runId, error: errMsg(err) }),
            );
            return json({ runId }, { status: 201 });
          }

          if (!body.youtubeUrl) return json({ error: "youtubeUrl or existingVideoId is required" }, { status: 400 });
          const runId = crypto.randomUUID();
          // Created synchronously so the client can poll /api/runs/:id immediately, no race with runUntilSelection's own creation.
          checkpoint.createRun(runId, "", body.youtubeUrl, null);
          runUntilSelection(checkpoint, body.youtubeUrl, runId).catch((err) =>
            log("error", "background runUntilSelection failed", { runId, error: errMsg(err) }),
          );
          return json({ runId }, { status: 201 });
        },
      },

      "/api/runs/:id": {
        GET: async (req) => {
          const run = checkpoint.getRun(req.params.id);
          if (!run) return json({ error: "not found" }, { status: 404 });
          const clipsPath = join(config.runsDir, run.id, "clips.json");
          const clips = existsSync(clipsPath) ? ((await Bun.file(clipsPath).json()) as ClipCandidate[]) : [];
          const identifyResult = checkpoint.getStageResult(run.id, "IDENTIFY_CLIPS");
          const tokenUsage = identifyResult?.resultJson
            ? ((JSON.parse(identifyResult.resultJson) as { tokenUsage: TokenUsage | null }).tokenUsage ?? null)
            : null;
          return json({ run, clips, clipProgress: checkpoint.getClipProgress(run.id), tokenUsage });
        },
        DELETE: (req) => {
          const run = checkpoint.getRun(req.params.id);
          if (!run) return json({ error: "not found" }, { status: 404 });
          checkpoint.deleteRun(run.id);
          const runDir = join(config.runsDir, run.id);
          if (existsSync(runDir)) rmSync(runDir, { recursive: true, force: true });
          if (run.videoId) {
            const outputDir = join(config.outputDir, run.videoId);
            if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
          }
          return json({ ok: true });
        },
      },

      "/api/runs/:id/progress": {
        GET: (req) => {
          const run = checkpoint.getRun(req.params.id);
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
          const run = checkpoint.getRun(req.params.id);
          if (!run) return json({ error: "not found" }, { status: 404 });
          const selectedClips = (await req.json()) as ClipCandidate[];
          processSelectedClips(checkpoint, run.id, selectedClips).catch((err) =>
            log("error", "background processSelectedClips failed", { runId: run.id, error: errMsg(err) }),
          );
          return json({ ok: true });
        },
      },

      "/api/runs/:id/video": {
        GET: async (req) => {
          const dl = await readDownloadResult(req.params.id);
          if (!dl) return new Response("Not found", { status: 404 });
          return serveVideoFile(dl.videoPath, req);
        },
      },

      "/api/runs/:id/clips/:clipId/captions": {
        GET: async (req) => {
          const path = join(config.runsDir, req.params.id, "clips", req.params.clipId, "captions.json");
          if (!existsSync(path)) return json({ error: "not found" }, { status: 404 });
          return json(await Bun.file(path).json());
        },
      },

      "/api/runs/:id/clips/:clipId/captions/regenerate": {
        POST: async (req) => {
          const body = (await req.json()) as { groups: CaptionGroup[]; style?: CaptionStyle };
          try {
            await regenerateCaptionOverlay(checkpoint, req.params.id, req.params.clipId, body.groups, body.style);
            return json({ ok: true });
          } catch (err) {
            log("error", "regenerate captions failed", { runId: req.params.id, clipId: req.params.clipId, error: errMsg(err) });
            return json({ error: errMsg(err) }, { status: 500 });
          }
        },
      },

      "/api/runs/:id/clips/:clipId": {
        DELETE: async (req) => {
          const { id: runId, clipId } = req.params;
          const clipDir = join(config.runsDir, runId, "clips", clipId);
          if (existsSync(clipDir)) rmSync(clipDir, { recursive: true, force: true });
          checkpoint.deleteClipProgress(runId, clipId);

          const run = checkpoint.getRun(runId);
          const clipsPath = join(config.runsDir, runId, "clips.json");
          if (run?.videoId && existsSync(clipsPath)) {
            const clips = (await Bun.file(clipsPath).json()) as ClipCandidate[];
            const clip = clips.find((c) => c.id === clipId);
            if (clip) {
              const outPath = finalClipPath(join(config.outputDir, run.videoId), clip);
              if (existsSync(outPath)) rmSync(outPath, { force: true });
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
