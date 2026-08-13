import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../logger";
import { runCommand, runCommandOrThrow } from "../util/exec";

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
  language?: string | null;
}

/** Downloads video + metadata via yt-dlp, then best-effort subtitles as a separate call. */
export async function downloadVideo(runDir: string, videoUrl: string): Promise<DownloadResult> {
  mkdirSync(runDir, { recursive: true });

  await runCommandOrThrow([
    "yt-dlp",
    "--write-info-json",
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

  // Subtitles are optional — TRANSCRIBE falls back to Whisper when there's no .vtt — and YouTube
  // rate-limits (429) or withholds them independently of the video stream itself. Fetching them
  // in the same yt-dlp call as the video meant a subtitle-only failure aborted an otherwise-
  // successful video download, so this runs as its own best-effort, non-throwing step.
  // Requests the video's own spoken language (from its metadata), not a hardcoded "en" — YouTube's
  // auto-captions otherwise resolve "en" to an auto-*translated* English track for non-English
  // audio, silently overriding Whisper's correct-language transcription for that content.
  const subLang = info.language || "en";
  const subs = await runCommand([
    "yt-dlp",
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    `${subLang}.*,${subLang}`,
    "--sub-format",
    "vtt",
    "-o",
    join(runDir, "source.%(ext)s"),
    videoUrl,
  ]);
  if (subs.exitCode !== 0) {
    log("warn", "yt-dlp subtitle fetch failed, continuing without subtitles (Whisper will be used)", {
      exitCode: subs.exitCode,
      stderr: subs.stderr.slice(0, 500),
    });
  }

  const subtitleFiles = readdirSync(runDir);

  const videoFile = files.find((f) => f.startsWith("source.") && (f.endsWith(".mp4") || f.endsWith(".webm") || f.endsWith(".mkv")));
  if (!videoFile) throw new Error(`yt-dlp did not produce a video file in ${runDir}`);

  const subtitleFile = subtitleFiles.find((f) => f.endsWith(".vtt"));

  return {
    videoId: info.id,
    title: info.title,
    durationSec: info.duration,
    videoPath: join(runDir, videoFile),
    subtitlePath: subtitleFile ? join(runDir, subtitleFile) : null,
  };
}
