#!/usr/bin/env bun
import { config } from "./config";
import { LicenseDb } from "./db";
import { log } from "./logger";

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

/** Never log a full license key — it's a bearer credential, same masking as the app's API-key previews. */
function maskKey(key: string): string {
  return key.length > 4 ? `${key.slice(0, 3)}…${key.slice(-4)}` : "***";
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const hits = new Map<string, { count: number; windowStart: number }>();

// ponytail: per-key in-memory limiter, single process — resets on restart and doesn't stop
// IP-based key enumeration. Add a reverse-proxy (Caddy) rate limit too if that becomes a real threat.
function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    hits.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

export function createServer(db: LicenseDb = new LicenseDb(config.dbPath), port: number = config.port) {
  return Bun.serve({
    port,
    routes: {
      "/health": {
        GET: () => json({ ok: true }),
      },
      "/validate": {
        POST: async (req) => {
          const body = (await req.json().catch(() => null)) as { licenseKey?: string } | null;
          const key = body?.licenseKey;
          if (!key) return json({ error: "licenseKey is required" }, { status: 400 });

          if (rateLimited(key)) {
            log("warn", "validate rate limited", { key: maskKey(key) });
            return json({ valid: false, reason: "too many requests" }, { status: 429 });
          }

          const license = db.find(key);
          if (!license) {
            log("info", "validate: unknown key", { key: maskKey(key) });
            return json({ valid: false, reason: "unknown license key" }, { status: 401 });
          }
          if (license.status === "revoked") {
            log("info", "validate: revoked key", { key: maskKey(key) });
            return json({ valid: false, reason: "license key revoked" }, { status: 403 });
          }

          db.touch(key);
          log("info", "validate: ok", { key: maskKey(key), plan: license.plan });
          return json({ valid: true, plan: license.plan });
        },
      },
    },
  });
}

if (import.meta.main) {
  const server = createServer();
  log("info", "license server listening", { port: server.port });
}
