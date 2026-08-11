import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config";
import {
  CLIP_STAGES,
  GLOBAL_STAGES,
  type ClipProgress,
  type ClipStage,
  type GlobalStage,
  type PipelineRun,
  type RunStatus,
  type StageName,
  type StageResult,
  type StageStatus,
} from "./types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  video_url TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  current_stage TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS stage_results (
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  result_json TEXT,
  error_message TEXT,
  PRIMARY KEY (run_id, stage)
);

CREATE TABLE IF NOT EXISTS clip_progress (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  clip_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  output_path TEXT,
  error_message TEXT,
  UNIQUE (run_id, clip_id, stage)
);
`;

export interface ResumableState {
  completedGlobalStages: Set<GlobalStage>;
  /** clip_id -> set of completed per-clip stages */
  clips: Map<string, Set<ClipStage>>;
}

export class CheckpointManager {
  private db: Database;

  constructor(dbPath: string = config.checkpointDbPath) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  createRun(runId: string, videoId: string, videoUrl: string, title: string | null): PipelineRun {
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO pipeline_runs (id, video_id, video_url, title, status, current_stage, created_at, updated_at, error_message)
         VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?, NULL)`,
      )
      .run(runId, videoId, videoUrl, title, now, now);
    return this.getRun(runId)!;
  }

  getRun(runId: string): PipelineRun | null {
    const row = this.db.query("SELECT * FROM pipeline_runs WHERE id = ?").get(runId) as
      | Record<string, unknown>
      | null;
    return row ? rowToRun(row) : null;
  }

  listRuns(): PipelineRun[] {
    const rows = this.db.query("SELECT * FROM pipeline_runs ORDER BY created_at DESC").all() as Record<
      string,
      unknown
    >[];
    return rows.map(rowToRun);
  }

  updateRunStatus(runId: string, status: RunStatus, currentStage: StageName | null, errorMessage: string | null = null) {
    this.db
      .query(
        `UPDATE pipeline_runs SET status = ?, current_stage = ?, error_message = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, currentStage, errorMessage, new Date().toISOString(), runId);
  }

  /** DOWNLOAD only learns the real video_id/title after yt-dlp runs; patches the placeholder row. */
  setRunVideoInfo(runId: string, videoId: string, title: string) {
    this.db
      .query(`UPDATE pipeline_runs SET video_id = ?, title = ?, updated_at = ? WHERE id = ?`)
      .run(videoId, title, new Date().toISOString(), runId);
  }

  deleteRun(runId: string) {
    this.db.query("DELETE FROM pipeline_runs WHERE id = ?").run(runId);
    this.db.query("DELETE FROM stage_results WHERE run_id = ?").run(runId);
    this.db.query("DELETE FROM clip_progress WHERE run_id = ?").run(runId);
  }

  // --- stage_results (global stages) ---

  startStage(runId: string, stage: StageName) {
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO stage_results (run_id, stage, status, started_at, completed_at, result_json, error_message)
         VALUES (?, ?, 'running', ?, NULL, NULL, NULL)
         ON CONFLICT (run_id, stage) DO UPDATE SET status = 'running', started_at = ?, completed_at = NULL, error_message = NULL`,
      )
      .run(runId, stage, now, now);
  }

  completeStage(runId: string, stage: StageName, resultJson: string | null = null) {
    this.db
      .query(
        `UPDATE stage_results SET status = 'completed', completed_at = ?, result_json = ? WHERE run_id = ? AND stage = ?`,
      )
      .run(new Date().toISOString(), resultJson, runId, stage);
  }

  failStage(runId: string, stage: StageName, errorMessage: string) {
    this.db
      .query(`UPDATE stage_results SET status = 'failed', completed_at = ?, error_message = ? WHERE run_id = ? AND stage = ?`)
      .run(new Date().toISOString(), errorMessage, runId, stage);
  }

  getStageResult(runId: string, stage: StageName): StageResult | null {
    const row = this.db.query("SELECT * FROM stage_results WHERE run_id = ? AND stage = ?").get(runId, stage) as
      | Record<string, unknown>
      | null;
    return row ? rowToStageResult(row) : null;
  }

  // --- clip_progress (per-clip stages) ---

  startClipStage(runId: string, clipId: string, stage: ClipStage) {
    const id = `${runId}:${clipId}:${stage}`;
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO clip_progress (id, run_id, clip_id, stage, status, started_at, completed_at, output_path, error_message)
         VALUES (?, ?, ?, ?, 'running', ?, NULL, NULL, NULL)
         ON CONFLICT (run_id, clip_id, stage) DO UPDATE SET status = 'running', started_at = ?, completed_at = NULL, error_message = NULL`,
      )
      .run(id, runId, clipId, stage, now, now);
  }

  /** Used when deleting one rendered clip (not the whole run) so it re-appears as un-rendered rather than stuck showing stale progress. */
  deleteClipProgress(runId: string, clipId: string) {
    this.db.query("DELETE FROM clip_progress WHERE run_id = ? AND clip_id = ?").run(runId, clipId);
  }

  completeClipStage(runId: string, clipId: string, stage: ClipStage, outputPath: string | null = null) {
    this.db
      .query(
        `UPDATE clip_progress SET status = 'completed', completed_at = ?, output_path = ? WHERE run_id = ? AND clip_id = ? AND stage = ?`,
      )
      .run(new Date().toISOString(), outputPath, runId, clipId, stage);
  }

  failClipStage(runId: string, clipId: string, stage: ClipStage, errorMessage: string) {
    this.db
      .query(
        `UPDATE clip_progress SET status = 'failed', completed_at = ?, error_message = ? WHERE run_id = ? AND clip_id = ? AND stage = ?`,
      )
      .run(new Date().toISOString(), errorMessage, runId, clipId, stage);
  }

  getClipProgress(runId: string): ClipProgress[] {
    const rows = this.db.query("SELECT * FROM clip_progress WHERE run_id = ?").all(runId) as Record<
      string,
      unknown
    >[];
    return rows.map(rowToClipProgress);
  }

  /** Skip-set for `resume`: completed global stages, and per-clip stages already done. */
  getResumableState(runId: string): ResumableState {
    const completedGlobalStages = new Set<GlobalStage>();
    for (const stage of GLOBAL_STAGES) {
      const result = this.getStageResult(runId, stage);
      if (result?.status === "completed") completedGlobalStages.add(stage);
    }

    const clips = new Map<string, Set<ClipStage>>();
    for (const progress of this.getClipProgress(runId)) {
      if (progress.status !== "completed") continue;
      if (!CLIP_STAGES.includes(progress.stage)) continue;
      const set = clips.get(progress.clipId) ?? new Set<ClipStage>();
      set.add(progress.stage);
      clips.set(progress.clipId, set);
    }

    return { completedGlobalStages, clips };
  }
}

function rowToRun(row: Record<string, unknown>): PipelineRun {
  return {
    id: row.id as string,
    videoId: row.video_id as string,
    videoUrl: row.video_url as string,
    title: (row.title as string) ?? null,
    status: row.status as RunStatus,
    currentStage: (row.current_stage as StageName) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    errorMessage: (row.error_message as string) ?? null,
  };
}

function rowToStageResult(row: Record<string, unknown>): StageResult {
  return {
    runId: row.run_id as string,
    stage: row.stage as StageName,
    status: row.status as StageStatus,
    startedAt: (row.started_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    resultJson: (row.result_json as string) ?? null,
    errorMessage: (row.error_message as string) ?? null,
  };
}

function rowToClipProgress(row: Record<string, unknown>): ClipProgress {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    clipId: row.clip_id as string,
    stage: row.stage as ClipStage,
    status: row.status as StageStatus,
    startedAt: (row.started_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    outputPath: (row.output_path as string) ?? null,
    errorMessage: (row.error_message as string) ?? null,
  };
}
