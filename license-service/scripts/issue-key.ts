#!/usr/bin/env bun
// Manual key issuance for a single-operator setup — run this on the VPS after a sale.
// Usage: bun run issue-key [--plan standard]
import { randomBytes } from "node:crypto";
import { config } from "../src/config";
import { LicenseDb } from "../src/db";

function generateKey(): string {
  const hex = randomBytes(10).toString("hex").toUpperCase();
  return `RF-${hex.match(/.{1,4}/g)!.join("-")}`;
}

const planIndex = process.argv.indexOf("--plan");
const plan = planIndex !== -1 ? process.argv[planIndex + 1] : "standard";

const db = new LicenseDb(config.dbPath);
const key = generateKey();
db.insert(key, plan!);
console.log(key);
