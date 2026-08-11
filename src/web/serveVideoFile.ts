import { extname } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

/** Streams a local file with HTTP Range support (206 Partial Content) — Bun doesn't do this for `Response` bodies automatically. */
export async function serveVideoFile(path: string, req: Request): Promise<Response> {
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });

  const size = file.size;
  const contentType = MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");
  if (!range) {
    return new Response(file, { headers: { "Content-Type": contentType, "Accept-Ranges": "bytes" } });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return new Response("Invalid Range", { status: 416 });

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
    return new Response("Invalid Range", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
    },
  });
}
