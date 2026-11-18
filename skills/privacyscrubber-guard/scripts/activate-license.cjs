#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const MAX_KEY_LENGTH = 2048;

function loadLicenseManager() {
  const candidates = [
    path.join(REPO_ROOT, "ps-license-manager.cjs"),
    path.join(REPO_ROOT, "ps-license-manager.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink() || !st.isFile()) {
        throw new Error(`Refusing to load non-regular license verifier at ${p}`);
      }
      return require(p);
    }
  }
  return null;
}

function assertNoSymlinkPath(targetPath) {
  const parentDir = path.dirname(targetPath);
  fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
  const parentStat = fs.lstatSync(parentDir);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error(`Security block: parent directory '${parentDir}' must not be a symlink.`);
  }
  if (fs.existsSync(targetPath)) {
    const fileStat = fs.lstatSync(targetPath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new Error(`Security block: destination '${targetPath}' must not be a symlink.`);
    }
  }
}

function writeKeyFile(targetPath, key) {
  assertNoSymlinkPath(targetPath);
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, key + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    fs.chmodSync(tmpPath, 0o600);
  } catch (_e) {}
  fs.renameSync(tmpPath, targetPath);
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

  if (rawArg.length > MAX_KEY_LENGTH || /[\r\n\0]/.test(rawArg)) {
    console.error(`[PrivacyScrubber] Invalid license key: exceeds ${MAX_KEY_LENGTH} chars or contains control characters.`);
    process.exit(1);
  }

  let LicenseManager;
  try {
    LicenseManager = loadLicenseManager();
  } catch (err) {
    console.error(`[PrivacyScrubber] ${err.message}`);
    process.exit(1);
  }
  if (!LicenseManager || typeof LicenseManager.validate !== "function") {
    console.error("[PrivacyScrubber] Offline cryptographic verifier unavailable; refusing unverified key write.");
    process.exit(1);
  }

  const check = LicenseManager.validate(rawArg);
  if (!check || !check.valid) {
    console.error(`[PrivacyScrubber] Invalid license key: ${(check && check.reason) || "signature check failed"}`);
    process.exit(1);
  }
  console.log(`[PrivacyScrubber] Verified Ed25519 license offline (tier: ${check.tier || "PRO"}).`);

  const targets = [path.join(os.homedir(), ".privacyscrubber", "license.key")];
  if (process.env.PLUGIN_DATA) {
    targets.unshift(path.join(process.env.PLUGIN_DATA, "license.key"));
  }

  for (const target of targets) {
    try {
      writeKeyFile(target, rawArg);
    } catch (err) {
      console.error(`[PrivacyScrubber] ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`[PrivacyScrubber] Saved license locally (${targets.length} location(s), mode 0600).`);
  console.log("[PrivacyScrubber] Zero external verification calls were made. Restart or reload MCP server if already running.");
}

main();
