#!/usr/bin/env node
"use strict";

/**
 * PrivacyScrubber Public Repository IP & Security Hygiene Guard
 * Verifies obfuscated core engines, minified/watermarked Antigravity runtime,
 * and zero leakage of private repository references, developer paths, test keys, or salts.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const assert = require("assert");
const OBFUSCATED_ENGINES = [
  "ps-pii-engine.cjs",
  "ps-license-manager.cjs",
  "scrubber-core.cjs",
];
const ANTIGRAVITY_RUNTIME = "scripts/antigravity-mcp-server.cjs";
const EXPECTED_WATERMARK = "PS_CANARY_AGY_WM_9F4C2E7A1B8D";
const FORBIDDEN_SALT_SHA256 = "af4301c0f8b52504c37d952edf2cd098f1db66a21cbc10b45e1928d0d5efee7c";

const FORBIDDEN_PATTERNS = [
  { pattern: /moxno\/PrivacyScrubber(?![-a-z0-9])/i, name: "Private upstream repository URL reference" },
  { pattern: /\/Users\/[a-zA-Z0-9_-]+/, name: "Local developer filesystem path (/Users/...)" },
  { pattern: /\bPS-(?:PRO|TEAMS|SDK|ENTERPRISE)-[A-Z0-9]{6,12}-\d{4}\b/, name: "Static license key literal" },
  { pattern: /\blook(?:around|ahead|behind)\b/i, name: "Internal regex heuristic terminology" },
  { pattern: /IL\s*331905|14\/09\/2026|\bB17B\b/i, name: "Internal unpublished patent metadata" },
  { pattern: /ZTDS[_]SALT[_]/, name: "Legacy salt identifier prefix" },
];

const TEXT_ALLOW_EXT_RX = /\.(?:js|cjs|mjs|ts|py|md|json|yml|yaml|toml|cff|svg|txt)$/i;

function resolveTargetFiles(scanAll) {
  if (scanAll) {
    return execSync("git ls-files", { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  }
  const staged = execSync("git diff --cached --name-only", { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  if (staged.length > 0) return staged;
  return execSync("git diff --name-only", { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

function hasForbiddenLiteralDigest(content) {
  const stringLiterals = content.matchAll(/(["'])([^"'\\\r\n]{6,64})\1/g);
  for (const m of stringLiterals) {
    const digest = crypto.createHash("sha256").update(m[2]).digest("hex");
    if (digest === FORBIDDEN_SALT_SHA256) return true;
  }
  return false;
}

function main() {
  const scanAll = process.argv.includes("--all");
  const violations = [];

  for (const engineRel of OBFUSCATED_ENGINES) {
    const abs = path.join(REPO_ROOT, engineRel);
    if (!fs.existsSync(abs)) {
      violations.push({ file: engineRel, issue: "Missing required obfuscated engine artifact" });
      continue;
    }
    const content = fs.readFileSync(abs, "utf8");
    const lineCount = content.split("\n").length;
    if (!content.includes("_0x") || lineCount > 25) {
      violations.push({ file: engineRel, issue: `Unobfuscated or unminified engine detected (lines=${lineCount})` });
    }
  }

  const runtimeAbs = path.join(REPO_ROOT, ANTIGRAVITY_RUNTIME);
  if (!fs.existsSync(runtimeAbs)) {
    violations.push({ file: ANTIGRAVITY_RUNTIME, issue: "Missing compiled Antigravity MCP runtime bundle" });
  } else {
    const runtimeSrc = fs.readFileSync(runtimeAbs, "utf8");
    const runtimeLines = runtimeSrc.split("\n").length;
    if (!runtimeSrc.includes(EXPECTED_WATERMARK) || runtimeSrc.length > 460 * 1024 || runtimeSrc.length / runtimeLines < 300) {
      violations.push({
        file: ANTIGRAVITY_RUNTIME,
        issue: `Runtime bundle missing integrity watermark or minification (size=${runtimeSrc.length}, lines=${runtimeLines})`,
      });
    }
  }

  const skipTextScan = new Set(["package-lock.json", ANTIGRAVITY_RUNTIME, ...OBFUSCATED_ENGINES]);
  const targetFiles = resolveTargetFiles(scanAll);

  for (const relPath of targetFiles) {
    const norm = relPath.replace(/\\/g, "/");
    if (skipTextScan.has(norm)) continue;
    if (!TEXT_ALLOW_EXT_RX.test(norm) && path.basename(norm) !== "LICENSE") continue;
    const abs = path.join(REPO_ROOT, norm);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;

    const content = fs.readFileSync(abs, "utf8");
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.pattern.test(content)) {
        violations.push({ file: norm, issue: rule.name });
      }
    }
    if (hasForbiddenLiteralDigest(content)) {
      violations.push({ file: norm, issue: "Prohibited secret digest match in string literal" });
    }
  }

  if (violations.length > 0) {
    console.error("[IP Guard] FAILED — detected repository hygiene or IP protection violations:");
    for (const v of violations) {
      console.error(`  - ${v.file}: ${v.issue}`);
    }
    process.exit(1);
  }

  // Runtime IP & cryptographic license-gate assertions
  const savedKeys = {
    PRIVACYSCRUBBER_KEY: process.env.PRIVACYSCRUBBER_KEY,
    PRIVACYSCRUBBER_LICENSE_KEY: process.env.PRIVACYSCRUBBER_LICENSE_KEY,
    ZTDS_LICENSE: process.env.ZTDS_LICENSE,
    ZTDS_LICENSE_KEY: process.env.ZTDS_LICENSE_KEY,
  };
  delete process.env.PRIVACYSCRUBBER_KEY;
  delete process.env.PRIVACYSCRUBBER_LICENSE_KEY;
  delete process.env.ZTDS_LICENSE;
  delete process.env.ZTDS_LICENSE_KEY;
  try {
    const lm = require(path.join(REPO_ROOT, "ps-license-manager.cjs"));
    assert.strictEqual(typeof lm.generateKey, "undefined", "LicenseManager.generateKey must be stripped from public repo");

    const eng = require(path.join(REPO_ROOT, "ps-pii-engine.cjs"));
    assert.strictEqual(eng.PROFILE_RULES, undefined, "engine.PROFILE_RULES must be undefined");
    assert.strictEqual(eng.REGEX_RULES, undefined, "engine.REGEX_RULES must be undefined");
    assert.strictEqual(eng.getActiveRules, undefined, "engine.getActiveRules must be undefined");
    assert.strictEqual(eng.getRulesMap, undefined, "engine.getRulesMap must be undefined");

    const sc = require(path.join(REPO_ROOT, "scrubber-core.cjs"));
    sc.init();
    assert.strictEqual(sc.getRules, undefined, "scrubberCore.getRules must be undefined");
    assert.throws(
      () => sc.scrubText("A".repeat(16000), [], {}, "General", {}, true),
      /Free Tier limit exceeded/i,
      "Boolean isPro=true must not bypass Free Tier limit in hardened scrubber-core.cjs"
    );
  } finally {
    for (const [k, v] of Object.entries(savedKeys)) {
      if (v !== undefined) process.env[k] = v;
    }
  }

  console.log(
    `[IP Guard] PASS (${scanAll ? "full repository" : "changed files"}): obfuscation, runtime license gates, bundle minification, watermark, and hygiene verified.`
  );
}

main();
