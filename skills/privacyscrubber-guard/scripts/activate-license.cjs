#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function loadLicenseManager() {
  const candidates = [
    path.join(REPO_ROOT, "ps-license-manager.cjs"),
    path.join(REPO_ROOT, "ps-license-manager.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return require(p);
    }
  }
  return null;
}

function writeKeyFile(targetPath, key) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(targetPath, key + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(targetPath, 0o600);
  } catch (_e) {}
}

function main() {
  const rawArg = (process.argv[2] || process.env.PRIVACYSCRUBBER_KEY || "").trim();
  if (!rawArg || rawArg === "-h" || rawArg === "--help") {
    console.error("Usage: node scripts/activate-license.cjs <PRIVACYSCRUBBER_LICENSE_KEY>");
    process.exit(rawArg ? 0 : 1);
  }

  const LicenseManager = loadLicenseManager();
  if (LicenseManager && typeof LicenseManager.validate === "function") {
    const check = LicenseManager.validate(rawArg);
    if (!check || !check.valid) {
      console.error(`[PrivacyScrubber] Invalid license key: ${(check && check.reason) || "signature check failed"}`);
      process.exit(1);
    }
    console.log(`[PrivacyScrubber] Verified Ed25519 license offline (tier: ${check.tier || "PRO"}).`);
  }

  const targets = [path.join(os.homedir(), ".privacyscrubber", "license.key")];
  if (process.env.PLUGIN_DATA) {
    targets.unshift(path.join(process.env.PLUGIN_DATA, "license.key"));
  }

  for (const target of targets) {
    writeKeyFile(target, rawArg);
  }

  console.log(`[PrivacyScrubber] Saved license locally (${targets.length} location(s), mode 0600).`);
  console.log("[PrivacyScrubber] Zero external verification calls were made. Restart or reload MCP server if already running.");
}

main();
