import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { activateLicense, callLicenseServer, checkLicense } from "./license";

let testDir: string;
let originalLicenseCachePath: string;
let originalLicenseServerUrl: string | undefined;

beforeEach(() => {
  originalLicenseCachePath = config.licenseCachePath;
  originalLicenseServerUrl = process.env.LICENSE_SERVER_URL;
  testDir = mkdtempSync(join(tmpdir(), "reel-farmer-license-test-"));
  config.licenseCachePath = join(testDir, "license.json");
});

afterEach(() => {
  config.licenseCachePath = originalLicenseCachePath;
  if (originalLicenseServerUrl === undefined) delete process.env.LICENSE_SERVER_URL;
  else process.env.LICENSE_SERVER_URL = originalLicenseServerUrl;
  rmSync(testDir, { recursive: true, force: true });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("checkLicense", () => {
  test("is a no-op pass when LICENSE_SERVER_URL is unset", async () => {
    delete process.env.LICENSE_SERVER_URL;
    expect(await checkLicense()).toEqual({ valid: true, mode: "disabled" });
  });

  test("returns invalid when no license key has been cached", async () => {
    process.env.LICENSE_SERVER_URL = "https://license.example.com";
    const status = await checkLicense();
    expect(status).toEqual({ valid: false, mode: "invalid", message: "no license key configured" });
  });

  test("returns live and refreshes the cache on a successful server response", async () => {
    process.env.LICENSE_SERVER_URL = "https://license.example.com";
    writeFileSync(config.licenseCachePath, JSON.stringify({ licenseKey: "k1", lastValidatedAt: new Date(0).toISOString() }));
    const fetchImpl = (async () => jsonResponse({ valid: true, plan: "pro" })) as unknown as typeof fetch;

    const status = await checkLicense({ fetchImpl });
    expect(status).toEqual({ valid: true, mode: "live" });
  });

  test("retries with backoff on transport failure, then succeeds", async () => {
    process.env.LICENSE_SERVER_URL = "https://license.example.com";
    writeFileSync(config.licenseCachePath, JSON.stringify({ licenseKey: "k1", lastValidatedAt: new Date(0).toISOString() }));
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls < 3) throw new Error("network blip");
      return jsonResponse({ valid: true });
    }) as unknown as typeof fetch;

    const status = await checkLicense({ fetchImpl, baseDelayMs: 1 });
    expect(calls).toBe(3);
    expect(status).toEqual({ valid: true, mode: "live" });
  });

  test("fast-fails on an explicit 401 rejection, with no retry and no grace period", async () => {
    process.env.LICENSE_SERVER_URL = "https://license.example.com";
    writeFileSync(
      config.licenseCachePath,
      JSON.stringify({ licenseKey: "k1", lastValidatedAt: new Date().toISOString() }), // fresh cache, would pass grace if applied
    );
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(null, { status: 401 });
    }) as unknown as typeof fetch;

    const status = await checkLicense({ fetchImpl, baseDelayMs: 1 });
    expect(calls).toBe(1);
    expect(status).toEqual({ valid: false, mode: "invalid", message: "license key is not valid" });
  });

  test("falls back to a grace period when unreachable and cache is recent", async () => {
    process.env.LICENSE_SERVER_URL = "https://license.example.com";
    const recentlyValidated = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    writeFileSync(config.licenseCachePath, JSON.stringify({ licenseKey: "k1", lastValidatedAt: recentlyValidated }));
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const status = await checkLicense({ fetchImpl, baseDelayMs: 1 });
    expect(status.valid).toBe(true);
    expect(status.mode).toBe("grace");
    expect(status.daysRemaining).toBeGreaterThan(0);
  });

  test("returns invalid when unreachable and the grace period has expired", async () => {
    process.env.LICENSE_SERVER_URL = "https://license.example.com";
    const staleValidation = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
    writeFileSync(config.licenseCachePath, JSON.stringify({ licenseKey: "k1", lastValidatedAt: staleValidation }));
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const status = await checkLicense({ fetchImpl, baseDelayMs: 1 });
    expect(status).toEqual({ valid: false, mode: "invalid", message: "cannot reach license server and grace period expired" });
  });
});

describe("activateLicense", () => {
  test("persists the license to cache on success", async () => {
    process.env.LICENSE_SERVER_URL = "https://license.example.com";
    const fetchImpl = (async () => jsonResponse({ valid: true, plan: "pro" })) as unknown as typeof fetch;

    const status = await activateLicense("new-key", { fetchImpl });
    expect(status).toEqual({ valid: true, mode: "live" });

    const cache = JSON.parse(await Bun.file(config.licenseCachePath).text());
    expect(cache.licenseKey).toBe("new-key");
    expect(cache.plan).toBe("pro");
  });

  test("throws and does not write the cache when the server rejects the key", async () => {
    process.env.LICENSE_SERVER_URL = "https://license.example.com";
    const fetchImpl = (async () => jsonResponse({ valid: false, reason: "unknown key" })) as unknown as typeof fetch;

    await expect(activateLicense("bad-key", { fetchImpl })).rejects.toThrow(/unknown key/);
    expect(await Bun.file(config.licenseCachePath).exists()).toBe(false);
  });
});

describe("callLicenseServer", () => {
  test("throws when LICENSE_SERVER_URL is unset", async () => {
    delete process.env.LICENSE_SERVER_URL;
    await expect(callLicenseServer("k1")).rejects.toThrow(/LICENSE_SERVER_URL/);
  });
});
