#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");

const ALLOWED_MANIFEST_KEYS = new Set([
  "$schema",
  "name",
  "displayName",
  "description",
  "version",
  "disabled",
  "logo",
  "suggestedPrompts",
  "skills",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);

function assertExecutable(filePath) {
  assert(fs.existsSync(filePath), `Missing file: ${filePath}`);
  const mode = fs.statSync(filePath).mode & 0o777;
  assert((mode & 0o111) === 0o111, `Expected executable bits (0755) on ${filePath}, got ${mode.toString(8)}`);
}

function validateManifest() {
  const manifestPath = path.join(REPO_ROOT, ".antigravity-plugin", "plugin.json");
  assert(fs.existsSync(manifestPath), "Missing .antigravity-plugin/plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  for (const key of Object.keys(manifest)) {
    assert(ALLOWED_MANIFEST_KEYS.has(key), `Unexpected top-level manifest key: ${key}`);
  }
  assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.name), `Invalid kebab-case plugin name: ${manifest.name}`);
  assert(
    !/^(antigravity|gemini|claude|cursor)/i.test(manifest.name) &&
      !/^(antigravity|gemini|claude|cursor)/i.test(manifest.displayName || ""),
    "Plugin name/displayName must not lead with Antigravity/Gemini/Claude/Cursor"
  );
  assert(typeof manifest.description === "string" && manifest.description.length > 20, "Missing plugin description");
  assert(typeof manifest.version === "string" && /^\d+\.\d+\.\d+/.test(manifest.version), "Missing valid SemVer version");
  assert(typeof manifest.repository === "string" && manifest.repository.startsWith("https://"), "repository must be string URL");
  assert(typeof manifest.homepage === "string" && manifest.homepage.startsWith("https://"), "homepage must be string URL");
  assert(Array.isArray(manifest.suggestedPrompts) && manifest.suggestedPrompts.length === 3, "suggestedPrompts must have 3 items");

  assert(typeof manifest.logo === "string" && !path.isAbsolute(manifest.logo), "logo must be a relative path");
  const logoPath = path.join(REPO_ROOT, manifest.logo);
  assert(fs.existsSync(logoPath), `Missing logo file: ${logoPath}`);
  const svgRaw = fs.readFileSync(logoPath, "utf8");
  assert(svgRaw.includes('viewBox="0 0 128 128"') && svgRaw.includes('width="128"') && svgRaw.includes('height="128"'), "logo SVG must be square 128x128");

  return manifest;
}

function validateComponents() {
  // Skill validation
  const skillPath = path.join(REPO_ROOT, "skills", "privacyscrubber-guard", "SKILL.md");
  assert(fs.existsSync(skillPath), `Missing ${skillPath}`);
  const skillRaw = fs.readFileSync(skillPath, "utf8");
  const fmMatch = skillRaw.match(/^---\n([\s\S]*?)\n---/);
  assert(fmMatch, "SKILL.md missing YAML frontmatter");
  assert(/\bname:\s*privacyscrubber-guard\b/.test(fmMatch[1]), "SKILL.md frontmatter name must match folder privacyscrubber-guard");
  assertExecutable(path.join(REPO_ROOT, "skills", "privacyscrubber-guard", "scripts", "activate-license.cjs"));

  // Rule validation (plain markdown, zero frontmatter)
  const rulePath = path.join(REPO_ROOT, "rules", "AGENTS.md");
  assert(fs.existsSync(rulePath), "Missing rules/AGENTS.md");
  const ruleRaw = fs.readFileSync(rulePath, "utf8");
  assert(!ruleRaw.startsWith("---\n"), "rules/AGENTS.md must be plain markdown without YAML frontmatter");

  // Agent validation
  const agentPath = path.join(REPO_ROOT, "agents", "ztds-compliance-auditor.md");
  assert(fs.existsSync(agentPath), "Missing agents/ztds-compliance-auditor.md");
  const agentRaw = fs.readFileSync(agentPath, "utf8");
  assert(/^---\n[\s\S]*\bname:\s*ztds-compliance-auditor\b[\s\S]*\n---/.test(agentRaw), "Invalid agent frontmatter");

  // MCP config validation
  const mcpPath = path.join(REPO_ROOT, "mcp_config.json");
  assert(fs.existsSync(mcpPath), "Missing mcp_config.json");
  const mcpCfg = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
  assert(mcpCfg.mcpServers && mcpCfg.mcpServers.guard, "mcp_config.json must define mcpServers.guard");
  const guard = mcpCfg.mcpServers.guard;
  assert.strictEqual(guard.command, "node");
  assert(Array.isArray(guard.args) && guard.args[0] === "${PLUGIN_ROOT}/scripts/antigravity-mcp-server.cjs", "guard args must use ${PLUGIN_ROOT}");
  assert(!guard.variables, "mcp_config.json must not declare blocking variables");
  assert(!guard.env || (!("PLUGIN_ROOT" in guard.env) && !("PLUGIN_DATA" in guard.env)), "env must not duplicate PLUGIN_ROOT/PLUGIN_DATA");

  // Hooks validation
  const hooksPath = path.join(REPO_ROOT, "hooks.json");
  assert(fs.existsSync(hooksPath), "Missing hooks.json");
  const hooksCfg = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  const gate = hooksCfg["privacyscrubber-ztds-gate"];
  assert(gate && Array.isArray(gate.PreToolUse) && gate.PreToolUse.length > 0, "hooks.json missing PreToolUse group");
  const hookCmd = gate.PreToolUse[0].hooks[0].command;
  assert(hookCmd.includes("./scripts/antigravity-hook.cjs") && !hookCmd.includes("${PLUGIN_ROOT}"), "hooks.json must use relative ./scripts/ path");

  assertExecutable(path.join(REPO_ROOT, "scripts", "antigravity-mcp-server.cjs"));
  assertExecutable(path.join(REPO_ROOT, "scripts", "antigravity-hook.cjs"));
  assertExecutable(path.join(REPO_ROOT, "scripts", "build-antigravity-bundle.cjs"));
}

function copyTree(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (entry === "node_modules" || entry === ".git") continue;
      copyTree(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, st.mode);
  }
}

function runHookCheck(pluginRoot, payload) {
  const res = spawnSync(process.execPath, ["./scripts/antigravity-hook.cjs"], {
    cwd: pluginRoot,
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  assert.strictEqual(res.status, 0, `Hook must always exit 0, got ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

function runColdRoomMcpTest(pluginRoot, pluginData) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, "scripts", "antigravity-mcp-server.cjs")], {
      cwd: os.tmpdir(),
      env: {
        ...process.env,
        PLUGIN_ROOT: pluginRoot,
        PLUGIN_DATA: pluginData,
        PRIVACYSCRUBBER_KEY: "",
        PRIVACYSCRUBBER_LICENSE_KEY: "",
        ZTDS_LICENSE: "",
        ZTDS_LICENSE_KEY: "",
        ZTDS_GUARD_LOCAL: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buf = "";
    let stderrBuf = "";
    const pending = new Map();

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Cold-room MCP test timed out. stderr=${stderrBuf}`));
    }, 15000);

    function send(id, method, params) {
      return new Promise((res, rej) => {
        pending.set(id, { res, rej });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    }

    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString("utf8");
    });

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && pending.has(msg.id)) {
          const { res, rej } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg.result);
        }
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    (async () => {
      const initRes = await send(1, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "cold-room-validator", version: "1.0.0" },
      });
      assert(initRes && initRes.serverInfo, "MCP initialize missing serverInfo");

      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

      const listRes = await send(2, "tools/list", {});
      const names = new Set((listRes.tools || []).map((t) => t.name));
      for (const reqTool of ["sanitize_text", "reveal_text", "audit_context", "guard_read_file", "guard_exec", "ztds_sanitize", "ztds_restore"]) {
        assert(names.has(reqTool), `Missing expected MCP tool in cold-room list: ${reqTool}`);
      }

      const scrubRes = await send(3, "tools/call", {
        name: "sanitize_text",
        arguments: { text: "Contact alice@acme.com immediately.", session_id: "coldroom" },
      });
      const scrubText = scrubRes.content.map((c) => c.text || "").join("\n");
      assert(!scrubText.includes("alice@acme.com"), "Cleartext email leaked in sanitize_text response");
      assert(scrubText.includes("[EMAIL_1]"), `Expected [EMAIL_1] token in sanitize_text output, got: ${scrubText}`);

      const tokenMatch = scrubText.match(/\[EMAIL_\d+\]/);
      assert(tokenMatch, "Could not parse surrogate token from sanitize_text response");
      const restoreRes = await send(4, "tools/call", {
        name: "reveal_text",
        arguments: { text: `Restored: ${tokenMatch[0]}`, session_id: "coldroom" },
      });
      const restoreText = restoreRes.content.map((c) => c.text || "").join("\n");
      assert(restoreText.includes("Restored: alice@acme.com"), `Expected restored email, got: ${restoreText}`);

      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve();
    })().catch((err) => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(err);
    });
  });
}

async function main() {
  validateManifest();
  validateComponents();
  console.log("[validate-antigravity] Manifest, paths, frontmatter, and permissions OK.");

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ps-agy-coldroom-"));
  const pluginRoot = path.join(tmpBase, "plugin");
  const pluginData = path.join(tmpBase, "plugin_data");
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.mkdirSync(pluginData, { recursive: true });

  const copyList = [
    ".antigravity-plugin",
    "assets",
    "skills",
    "rules",
    "agents",
    "mcp_config.json",
    "hooks.json",
    "package.json",
    "scrubber-core.cjs",
    "ps-license-manager.cjs",
    "ps-pii-engine.cjs",
    "scripts/antigravity-mcp-server.cjs",
    "scripts/antigravity-hook.cjs",
  ];

  try {
    for (const rel of copyList) {
      copyTree(path.join(REPO_ROOT, rel), path.join(pluginRoot, rel));
    }
    assert(!fs.existsSync(path.join(pluginRoot, "node_modules")), "Cold-room dir must not contain node_modules");

    const helpOut = execFileSync(process.execPath, [path.join(pluginRoot, "scripts", "antigravity-mcp-server.cjs"), "--help"], {
      encoding: "utf8",
    });
    assert(helpOut.includes("PrivacyScrubber MCP Server"), "Cold-room --help failed");

    const denyRead = runHookCheck(pluginRoot, {
      hookEventName: "PreToolUse",
      toolCall: { name: "read_file", args: { Path: "/repo/.env.production" } },
    });
    assert.strictEqual(denyRead.decision, "deny", "Hook must deny read_file on .env.production");

    const allowSafeRead = runHookCheck(pluginRoot, {
      hookEventName: "PreToolUse",
      toolCall: { name: "read_file", args: { Path: "/repo/.env.example" } },
    });
    assert.strictEqual(allowSafeRead.decision, "allow", "Hook must allow read_file on .env.example");

    const denyCmd = runHookCheck(pluginRoot, {
      hookEventName: "PreToolUse",
      toolCall: { name: "run_command", args: { CommandLine: "cat .env" } },
    });
    assert.strictEqual(denyCmd.decision, "deny", "Hook must deny run_command cat .env");

    const allowCmd = runHookCheck(pluginRoot, {
      hookEventName: "PreToolUse",
      toolCall: { name: "run_command", args: { CommandLine: "npm test" } },
    });
    assert.strictEqual(allowCmd.decision, "allow", "Hook must allow benign npm test");

    await runColdRoomMcpTest(pluginRoot, pluginData);
    console.log("[validate-antigravity] Cold-room no-node_modules MCP + PreToolUse hook E2E PASSED.");
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[validate-antigravity] FAILED:", err);
  process.exit(1);
});
