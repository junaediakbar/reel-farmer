import { useAtom } from "jotai";
import { useNavigate } from "react-router";
import { runsAtom } from "./atoms";
import { CLIP_STAGES, GLOBAL_STAGES, type PipelineRun } from "../pipeline/types";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The source video is downloaded (and safe to preview) once a run moves past the DOWNLOAD stage. */
function hasSourceVideo(run: PipelineRun): boolean {
  return run.status !== "pending" && run.currentStage !== "DOWNLOAD";
}

const STAGE_ORDER = [...GLOBAL_STAGES, ...CLIP_STAGES];

/** Rough completion percentage for a running run, from its position in the fixed stage order — no per-clip granularity. */
function runProgressPct(run: PipelineRun): number {
  if (!run.currentStage) return 0;
  const idx = STAGE_ORDER.indexOf(run.currentStage);
  return idx === -1 ? 0 : Math.round(((idx + 1) / STAGE_ORDER.length) * 100);
}

const STATUS_VARIANT: Record<PipelineRun["status"], "success" | "error" | "running" | "neutral"> = {
  completed: "success",
  failed: "error",
  running: "running",
  awaiting_selection: "running",
  pending: "neutral",
};

export function RunsPage() {
  const [runs, setRuns] = useAtom(runsAtom);
  const navigate = useNavigate();

  async function refresh() {
    const res = await fetch("/api/runs");
    setRuns(await res.json());
  }

  async function deleteRun(id: string) {
    await fetch(`/api/runs/${id}`, { method: "DELETE" });
    refresh();
  }

  async function retryRun(id: string) {
    await fetch(`/api/runs/${id}/retry`, { method: "POST" });
    refresh();
  }

  const completedRuns = runs.filter((r) => r.status === "completed").length;
  const runningRuns = runs.filter((r) => r.status === "running").length;
  const failedRuns = runs.filter((r) => r.status === "failed").length;
  const awaitingRuns = runs.filter((r) => r.status === "awaiting_selection").length;
  const successRate = runs.length > 0 ? Math.round((completedRuns / runs.length) * 100) : 0;

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-10 flex h-20 items-center justify-between bg-surface/70 px-6 backdrop-blur-xl">
        <h2 className="text-headline-lg text-primary">Runs</h2>
        <div className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant">
            <span className="material-symbols-outlined">notifications</span>
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant">
            <span className="material-symbols-outlined">mail</span>
          </span>
        </div>
      </header>

      <div className="relative mx-auto flex w-full max-w-[1160px] flex-col gap-stack-md px-6 pb-24">
        <span className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary/[0.12] blur-3xl" />
        <span className="pointer-events-none absolute -bottom-16 -left-10 h-52 w-52 rounded-full bg-secondary/10 blur-3xl" />

        <p className="text-body-lg text-on-surface-variant">Turn a long video into ready-to-post vertical clips.</p>

        <section className="grid grid-cols-1 gap-gutter sm:grid-cols-3">
          <div className="glass-panel flex flex-col gap-2 rounded-2xl p-6">
            <div className="flex items-center justify-between text-on-surface-variant">
              <span className="text-label-md">Total Runs</span>
              <span className="material-symbols-outlined text-primary">play_circle</span>
            </div>
            <div className="text-display-lg text-on-surface">{runs.length}</div>
            <div className={`text-label-sm ${failedRuns > 0 ? "text-error" : "text-primary"}`}>
              {failedRuns > 0 ? `${failedRuns} failed` : "All clear"}
            </div>
          </div>
          <div className="glass-panel flex flex-col gap-2 rounded-2xl p-6">
            <div className="flex items-center justify-between text-on-surface-variant">
              <span className="text-label-md">Completed</span>
              <span className="material-symbols-outlined text-secondary">check_circle</span>
            </div>
            <div className="text-display-lg text-on-surface">{completedRuns}</div>
            <div className="text-label-sm text-secondary">{successRate}% success rate</div>
          </div>
          <div className="glass-panel flex flex-col gap-2 rounded-2xl p-6">
            <div className="flex items-center justify-between text-on-surface-variant">
              <span className="text-label-md">Running</span>
              <span className="material-symbols-outlined text-tertiary">sync</span>
            </div>
            <div className="text-display-lg text-on-surface">{runningRuns}</div>
            <div className="text-label-sm text-tertiary">{awaitingRuns} awaiting selection</div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => navigate("/runs/new")}
            className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-outline-variant bg-surface-container-low font-semibold text-primary transition-colors hover:border-primary hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-3xl">add_circle</span>
            Start New Run
          </button>
          {runs.map((run) => (
            <article
              key={run.id}
              onClick={() => navigate(`/runs/${run.id}`)}
              className="soft-shadow group flex cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl bg-surface-container-lowest transition-transform hover:-translate-y-1"
            >
              <div className="relative aspect-video bg-surface-container-low">
                {hasSourceVideo(run) ? (
                  <video src={`/api/runs/${run.id}/video`} muted preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-outline">
                    <span className="material-symbols-outlined text-3xl">hourglass_empty</span>
                  </div>
                )}
                {hasSourceVideo(run) && run.status !== "running" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="material-symbols-outlined icon-fill text-4xl text-white">play_circle</span>
                  </div>
                )}
                {run.status === "running" && (
                  <div className="absolute bottom-2 left-2 right-2 h-1.5 overflow-hidden rounded-full bg-white/50">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${runProgressPct(run)}%` }} />
                  </div>
                )}
                <Badge variant={STATUS_VARIANT[run.status]} className="absolute right-2 top-2">
                  {run.status.replace("_", " ")}
                </Badge>
              </div>
              <div className="flex flex-col gap-2 px-4 pb-4">
                <h3 className="truncate text-label-md text-on-surface">{run.title ?? run.videoUrl}</h3>
                <p className="text-label-sm text-on-surface-variant">
                  {timeAgo(run.createdAt)}
                  {run.status === "running" && run.currentStage ? ` · ${run.currentStage}` : ""}
                </p>
                {run.errorMessage && <p className="text-sm text-error">{run.errorMessage}</p>}
                <div className="flex gap-2">
                  {run.status === "failed" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        retryRun(run.id);
                      }}
                    >
                      <span className="material-symbols-outlined text-[16px]">refresh</span>
                      Retry
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteRun(run.id);
                    }}
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                    Delete
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
