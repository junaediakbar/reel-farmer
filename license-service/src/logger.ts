type Level = "info" | "warn" | "error";

// Duplicated from src/logger.ts rather than imported — this service deploys independently
// of the desktop app, so it must not depend on the app's package tree.
/** Structured JSON logs, per project logging standard. */
export function log(level: Level, message: string, fields: Record<string, unknown> = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    service: "license-service",
    level,
    message,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
