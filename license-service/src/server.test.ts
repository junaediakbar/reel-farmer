import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LicenseDb } from "./db";
import { createServer } from "./server";

describe("license server /validate", () => {
  let dir: string;
  let db: LicenseDb;
  let server: ReturnType<typeof createServer>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "license-test-"));
    db = new LicenseDb(join(dir, "test.db"));
    server = createServer(db, 0);
  });

  afterEach(() => {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("active key returns valid:true", async () => {
    db.insert("RF-TEST-0001", "standard");
    const res = await fetch(`${server.url}validate`, {
      method: "POST",
      body: JSON.stringify({ licenseKey: "RF-TEST-0001" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true, plan: "standard" });
  });

  test("unknown key returns 401", async () => {
    const res = await fetch(`${server.url}validate`, {
      method: "POST",
      body: JSON.stringify({ licenseKey: "RF-NOPE" }),
    });
    expect(res.status).toBe(401);
  });

  test("revoked key returns 403", async () => {
    db.insert("RF-TEST-0002", "standard");
    db.revoke("RF-TEST-0002");
    const res = await fetch(`${server.url}validate`, {
      method: "POST",
      body: JSON.stringify({ licenseKey: "RF-TEST-0002" }),
    });
    expect(res.status).toBe(403);
  });

  test("missing licenseKey returns 400", async () => {
    const res = await fetch(`${server.url}validate`, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  test("health check", async () => {
    const res = await fetch(`${server.url}health`);
    expect(await res.json()).toEqual({ ok: true });
  });
});
