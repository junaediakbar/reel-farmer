type Level = "info" | "warn" | "error";

/** Structured JSON logs with run_id as correlation ID, per project logging standard. */
export function log(
  level: Level,
  message: string,
  fields: { runId?: string; stage?: string; [key: string]: unknown } = {},
) {
  const entry = {
    timestamp: new Date().toISOString(),
    service: "reel-farmer",
    level,
    message,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
