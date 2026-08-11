#!/usr/bin/env bun
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { config } from "./config";
import { log } from "./logger";
import { CheckpointManager } from "./pipeline/checkpoint";
import { runPipeline } from "./pipeline/orchestrator";
import { runCommandOrThrow } from "./util/exec";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function cmdPipeline(args: string[]) {
  const [url] = args;
  if (!url) fail("Usage: pipeline <youtube-url>");
  const checkpoint = new CheckpointManager();
  try {
    await runPipeline(checkpoint, url);
  } finally {
    checkpoint.close();
  }
}

async function cmdResume(args: string[]) {
  const [runId] = args;
  if (!runId) fail("Usage: resume <run-id>");
  const checkpoint = new CheckpointManager();
  try {
    const run = checkpoint.getRun(runId);
    if (!run) fail(`No run found with id ${runId}`);
    await runPipeline(checkpoint, run.videoUrl, runId);
  } finally {
    checkpoint.close();
  }
}

async function cmdStatus(args: string[]) {
  const checkpoint = new CheckpointManager();
  try {
    const [runId] = args;
    if (runId) {
      const run = checkpoint.getRun(runId);
      if (!run) fail(`No run found with id ${runId}`);
      console.log(JSON.stringify(run, null, 2));
      const identifyResult = checkpoint.getStageResult(runId, "IDENTIFY_CLIPS");
      const tokenUsage = identifyResult?.resultJson ? JSON.parse(identifyResult.resultJson).tokenUsage : null;
      if (tokenUsage) console.log(`DeepSeek tokens used: ${tokenUsage.totalTokens}`);
      const clips = checkpoint.getClipProgress(runId);
      if (clips.length > 0) console.log(JSON.stringify(clips, null, 2));
      return;
    }
    const runs = checkpoint.listRuns();
    if (runs.length === 0) {
      console.log("No runs yet.");
      return;
    }
    for (const run of runs) {
      console.log(`${run.id}  ${run.status.padEnd(18)} ${run.currentStage ?? "-"}  ${run.title ?? run.videoUrl}`);
    }
  } finally {
    checkpoint.close();
  }
}

async function cmdClean(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: { all: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  const [runId] = positionals;
  if (!runId) fail("Usage: clean <run-id> [--all]");
  const checkpoint = new CheckpointManager();
  try {
    const run = checkpoint.getRun(runId);
    if (!run) fail(`No run found with id ${runId}`);

    const runDir = join(config.runsDir, runId);
    if (existsSync(runDir)) rmSync(runDir, { recursive: true, force: true });

    if (values.all) {
      const outputDir = join(config.outputDir, run.videoId);
      if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
      checkpoint.deleteRun(runId);
      console.log(`Cleaned intermediate + final output for ${runId}`);
    } else {
      console.log(`Cleaned intermediate artifacts for ${runId} (final output kept — use --all to remove it too)`);
    }
  } finally {
    checkpoint.close();
  }
}

interface ChannelVideo {
  id: string;
  url: string;
}

async function listChannelVideos(channelUrl: string, limit: number): Promise<ChannelVideo[]> {
  const result = await runCommandOrThrow([
    "yt-dlp",
    "--flat-playlist",
    "--playlist-end",
    String(limit),
    "--print",
    "%(id)s",
    channelUrl,
  ]);
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((id) => ({ id, url: `https://www.youtube.com/watch?v=${id}` }));
}

async function cmdBatch(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      limit: { type: "string", short: "l", default: "10" },
      "skip-existing": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const [channelUrl] = positionals;
  if (!channelUrl) fail("Usage: batch <channel-url> -l N [--skip-existing]");
  const limit = Number(values.limit);

  const videos = await listChannelVideos(channelUrl, limit);
  const checkpoint = new CheckpointManager();
  try {
    const existingVideoIds = new Set(
      checkpoint
        .listRuns()
        .filter((r) => r.status === "completed")
        .map((r) => r.videoId),
    );
    for (const video of videos) {
      if (values["skip-existing"] && existingVideoIds.has(video.id)) {
        log("info", "batch: skip existing video", { videoId: video.id });
        continue;
      }
      try {
        await runPipeline(checkpoint, video.url);
      } catch (err) {
        log("error", "batch: video failed, continuing to next", {
          videoId: video.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    checkpoint.close();
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "pipeline":
      return cmdPipeline(rest);
    case "batch":
      return cmdBatch(rest);
    case "resume":
      return cmdResume(rest);
    case "status":
      return cmdStatus(rest);
    case "clean":
      return cmdClean(rest);
    default:
      console.log("Usage: bun run src/index.ts <pipeline|batch|resume|status|clean> ...");
      if (command) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
