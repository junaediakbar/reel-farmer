/** Shared subprocess runner for the yt-dlp/ffmpeg/whisper-cli wrappers. */
import { isManagedBinary, resolveBinary } from "./bin-paths";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Swaps a managed binary's bare name for its downloaded copy, if one was installed. */
function resolveCmd(cmd: string[]): string[] {
  const [bin, ...rest] = cmd;
  if (bin && isManagedBinary(bin)) return [resolveBinary(bin), ...rest];
  return cmd;
}

export async function runCommand(cmd: string[], opts: { cwd?: string } = {}): Promise<CommandResult> {
  const proc = Bun.spawn(resolveCmd(cmd), { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

export async function runCommandOrThrow(cmd: string[], opts: { cwd?: string } = {}): Promise<CommandResult> {
  const result = await runCommand(cmd, opts);
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${cmd[0]}, exit ${result.exitCode}): ${result.stderr.slice(0, 2000)}`);
  }
  return result;
}
