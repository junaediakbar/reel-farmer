import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runCommandOrThrow } from "../util/exec";

export interface DownloadResult {
  videoId: string;
  title: string;
  durationSec: number;
  videoPath: string;
  subtitlePath: string | null;
}

interface YtDlpInfo {
  id: string;
  title: string;
  duration: number;
}

/** Downloads video + metadata + subtitles (if available) into runDir via a single yt-dlp invocation. */
export async function downloadVideo(runDir: string, videoUrl: string): Promise<DownloadResult> {
  mkdirSync(runDir, { recursive: true });

  await runCommandOrThrow([
    "yt-dlp",
    "--write-info-json",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    "en.*,en",
    "--sub-format",
    "vtt",
    "-f",
    "bv*+ba/b",
    "--merge-output-format",
    "mp4",
    "-o",
    join(runDir, "source.%(ext)s"),
    videoUrl,
  ]);

  const files = readdirSync(runDir);

  const infoFile = files.find((f) => f.endsWith(".info.json"));
  if (!infoFile) throw new Error(`yt-dlp did not produce an info.json in ${runDir}`);
  const info = (await Bun.file(join(runDir, infoFile)).json()) as YtDlpInfo;

  const videoFile = files.find((f) => f.startsWith("source.") && (f.endsWith(".mp4") || f.endsWith(".webm") || f.endsWith(".mkv")));
  if (!videoFile) throw new Error(`yt-dlp did not produce a video file in ${runDir}`);

  const subtitleFile = files.find((f) => f.endsWith(".vtt"));

  return {
    videoId: info.id,
    title: info.title,
    durationSec: info.duration,
    videoPath: join(runDir, videoFile),
    subtitlePath: subtitleFile ? join(runDir, subtitleFile) : null,
  };
}
