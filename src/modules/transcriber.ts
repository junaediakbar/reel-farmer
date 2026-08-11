import { join } from "node:path";
import { config, requireWhisperModel } from "../config";
import type { Transcript, TranscriptSegment, WordTimestamp } from "../pipeline/types";
import { runCommandOrThrow } from "../util/exec";

const VTT_CUE_RE =
  /(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})/;

function parseVttTimestamp(ts: string): number {
  const parts = ts.split(":");
  const [h, m, s] =
    parts.length === 3 ? [Number(parts[0]), Number(parts[1]), Number(parts[2])] : [0, Number(parts[0]), Number(parts[1])];
  return h * 3600 + m * 60 + s;
}

/** Parses a WebVTT file (from yt-dlp) into transcript segments, stripping cue-tag markup used in auto-captions. */
export function parseVtt(content: string): TranscriptSegment[] {
  const lines = content.split(/\r?\n/);
  const segments: TranscriptSegment[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const match = VTT_CUE_RE.exec(line);
    if (match) {
      const start = parseVttTimestamp(match[1]!);
      const end = parseVttTimestamp(match[2]!);
      i++;
      const textLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim() !== "") {
        textLines.push((lines[i] ?? "").replace(/<[^>]+>/g, ""));
        i++;
      }
      const text = textLines.join(" ").trim();
      if (text) segments.push({ text, start, end });
    } else {
      i++;
    }
  }
  return dedupeAdjacent(segments);
}

/** Auto-generated YouTube VTT repeats near-identical rolling-caption lines; collapse consecutive duplicates. */
function dedupeAdjacent(segments: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (prev && prev.text === seg.text) {
      prev.end = seg.end;
      continue;
    }
    out.push(seg);
  }
  return out;
}

export async function extractAudioWav(videoPath: string, outWavPath: string): Promise<void> {
  await runCommandOrThrow(["ffmpeg", "-y", "-i", videoPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outWavPath]);
}

interface WhisperJson {
  transcription: Array<{
    offsets: { from: number; to: number };
    text: string;
  }>;
}

async function runWhisperCli(audioPath: string, outBase: string, extraArgs: string[]): Promise<WhisperJson> {
  const model = requireWhisperModel();
  await runCommandOrThrow([
    "whisper-cli",
    "-m",
    model,
    "-f",
    audioPath,
    "-l",
    config.whisperLanguage,
    "-oj",
    "-of",
    outBase,
    ...extraArgs,
  ]);
  return (await Bun.file(`${outBase}.json`).json()) as WhisperJson;
}

/** Segment-level transcript — used as the TRANSCRIBE stage fallback when no YouTube captions exist. */
export async function transcribeWithWhisper(audioPath: string, outBase: string): Promise<TranscriptSegment[]> {
  const json = await runWhisperCli(audioPath, outBase, []);
  return json.transcription.map((seg) => ({
    text: seg.text.trim(),
    start: seg.offsets.from / 1000,
    end: seg.offsets.to / 1000,
  }));
}

/** Word-level timestamps (`-ml 1 -sow`) — used by GENERATE_CAPTIONS regardless of how TRANSCRIBE got its text. */
export async function transcribeWordsWithWhisper(audioPath: string, outBase: string): Promise<WordTimestamp[]> {
  const json = await runWhisperCli(audioPath, outBase, ["-ml", "1", "-sow"]);
  return json.transcription
    .map((seg) => ({
      word: seg.text.trim(),
      start: seg.offsets.from / 1000,
      end: seg.offsets.to / 1000,
    }))
    .filter((w) => w.word.length > 0);
}

/** TRANSCRIBE stage entry point: YouTube captions when available and preferred, else Whisper on the full video's audio. */
export async function getTranscript(
  runDir: string,
  videoPath: string,
  subtitlePath: string | null,
): Promise<Transcript> {
  if (config.preferYouTubeTranscripts && subtitlePath) {
    const content = await Bun.file(subtitlePath).text();
    const segments = parseVtt(content);
    if (segments.length > 0) return { source: "youtube", segments };
  }

  const audioPath = join(runDir, "audio.wav");
  await extractAudioWav(videoPath, audioPath);
  const segments = await transcribeWithWhisper(audioPath, join(runDir, "transcript"));
  return { source: "whisper", segments };
}
