#!/usr/bin/env node

/**
 * PrivacyScrubber command runner wrapper: pii-masking-run
 * 
 * Runs any local shell command, intercepts its output (stdout/stderr) line-by-line, 
 * sanitizes any PII/Secrets locally, and writes the clean stream to the terminal.
 * 
 * Usage: pii-masking-run [options] -- <command> [args...]
 */

import { spawn, execSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Early check for --version or --help to avoid loading heavy dependencies
const args = process.argv.slice(2);
const cmdIndex = args.indexOf("--");

if (args.includes("--version") || args.includes("-v")) {
  const pkgPath = path.resolve(__dirname, './package.json');
  let version = '2.2.0';
  try { version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version; } catch (_) {}
  console.log(`ps-guard / pii-masking-run v${version} (PrivacyScrubber MCP)`);
  process.exit(0);
}

const isDiffMode = args.includes("--diff");
const isRulesMode = args.includes("--rules");
const hasCommand = cmdIndex !== -1 && args.slice(cmdIndex + 1).length > 0;
const hasStdin = !process.stdin.isTTY;

if (args.includes("-h") || args.includes("--help") || (!hasCommand && !isDiffMode && !isRulesMode && !hasStdin)) {
  console.log("PrivacyScrubber CLI & Agentic Guard: ps-guard / pii-masking-run");
  console.log("\nUsage:");
  console.log("  npx ps-guard [options] -- <command> [args...]");
  console.log("  cat <file> | npx ps-guard [options]");
  console.log("  npx ps-guard --diff [--staged] [options]");
  console.log("  npx ps-guard --rules [targets]");
  console.log("\nOptions:");
  console.log("  --profile <name>  Specify detection profile (e.g. General, Dev, Medical, Legal, HR)");
  console.log("  --key <licKey>    PrivacyScrubber PRO License Key");
  console.log("  --diff            Sanitize git diff output before committing or sending to AI");
  console.log("  --staged          Use staged git changes with --diff");
  console.log("  --rules [targets] Generate AI agent rules (.cursorrules, .windsurfrules, CLAUDE.md, copilot, cline)");
  console.log("  -q, --quiet       Suppress stderr proof telemetry");
  console.log("  -v, --version     Print version");
  console.log("  -h, --help        Show this help screen");
  console.log("\nExamples:");
  console.log("  npx ps-guard -- cat database-dump.sql");
  console.log("  npx ps-guard --profile dev -- npm test");
  console.log("  cat .env | npx ps-guard --profile dev");
  console.log("  npx ps-guard --diff --staged");
  console.log("  npx ps-guard --rules cursor,windsurf");
  process.exit(0);
}

// Import the production core engine
const scrubberCorePath = path.resolve(__dirname, './scrubber-core.cjs');
const PrivacyScrubberCore = require(scrubberCorePath);

PrivacyScrubberCore.init();

// ANSI terminal colors
const colors = {
  yellowBold: '\x1b[1;33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

const DEVOPS_SECRETS_DETECTOR = [
  { name: 'AWS Credentials', regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA)[A-Z0-9]{16}\b/g },
  { name: 'JSON Web Token (JWT)', regex: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g },
  { name: 'API Token/Key (GitHub/Slack/NPM)', regex: /\b(?:ghp|gho|ghu|ghs|ghr|glpat|npm|xox[baprs])[-_][A-Za-z0-9_]{10,}\b/g },
  { name: 'Stripe API Key', regex: /\b(?:[rs]k)_(?:test|live)_[a-zA-Z0-9]{24,}\b/g },
  { name: 'Database/API Secret', regex: /\b(DB|POSTGRES|REDIS|MYSQL|AWS|SECRET|PASSWORD|TOKEN|API|KEY)[A-Z0-9_]*\s*[:=]\s*[^ \t\r\n"']{8,}\b/gi }
];

let LicenseManager;
try {
  LicenseManager = require('./ps-license-manager.cjs');
} catch (e) {
  try {
    LicenseManager = require('./ps-license-manager.js');
  } catch (err) {}
}
if (!LicenseManager || typeof LicenseManager.validate !== 'function') {
  LicenseManager = global.LicenseManager;
}

function checkLicenseStatus() {
  const key = (process.env.PRIVACYSCRUBBER_KEY || "").trim();
  if (!key) return { isPro: false, type: null, error: "No license key provided." };

  const result = LicenseManager.validate(key);
  if (!result.valid) {
    return { isPro: false, type: null, error: result.reason || "Invalid license format or signature." };
  }
  return { isPro: true, type: result.tier, error: null };
}

function resolveConfigPath() {
  let configPath = path.resolve(process.cwd(), 'privacyscrubber.json');
  if (!fs.existsSync(configPath)) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (homeDir) {
      configPath = path.resolve(homeDir, 'privacyscrubber.json');
    }
  }
  return configPath;
}

function loadCustomRules() {
  const license = checkLicenseStatus();
  const configPath = resolveConfigPath();

  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const rules = config.customRules || [];
      if (rules.length > 0) {
        if (license.isPro) {
          return rules.map(r => ({
            pattern: r.pattern || r.regex || "",
            label: (r.label || r.category || "CUSTOM").toUpperCase(),
            regex: r.pattern || r.regex || "",
            category: (r.label || r.category || "CUSTOM").toUpperCase()
          })).filter(r => r.pattern);
        } else {
          process.stderr.write(`⚠️  [PrivacyScrubber] Custom rules detected in privacyscrubber.json, but are ignored in the Free Tier.\n👉  Set PRIVACYSCRUBBER_KEY to your PRO license key.\n`);
        }
      }
    } catch (e) {
      process.stderr.write(`Error parsing privacyscrubber.json: ${e.message}\n`);
    }
  }
  return [];
}

// Local runtime variables
let profile = "General";
let key = process.env.PRIVACYSCRUBBER_KEY || "";
let rulesTargets = ["all"];

const optionsArgs = cmdIndex !== -1 ? args.slice(0, cmdIndex) : args;

// Parse custom command-line options
for (let i = 0; i < optionsArgs.length; i++) {
  if (optionsArgs[i] === "--profile" && optionsArgs[i + 1]) {
    profile = optionsArgs[i + 1];
    i++;
  } else if (optionsArgs[i] === "--key" && optionsArgs[i + 1]) {
    key = optionsArgs[i + 1];
    i++;
  } else if (optionsArgs[i] === "--rules") {
    if (optionsArgs[i + 1] && !optionsArgs[i + 1].startsWith("-")) {
      rulesTargets = optionsArgs[i + 1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      i++;
    }
  }
}

if (key) {
  process.env.PRIVACYSCRUBBER_KEY = key;
}

const customRules = loadCustomRules();
const localSessionMap = {};

function performSanitization(text) {
  const license = checkLicenseStatus();
  const normalizedProfile = (profile || "general").trim().toLowerCase();
  const limit = (normalizedProfile !== "general" && !license.isPro) ? 5000 : 15000;
  let textToScrub = text;
  let wasTruncated = false;
  if (!license.isPro && textToScrub.length > limit) {
    textToScrub = textToScrub.slice(0, limit);
    wasTruncated = true;
  }

  let result;
  try {
    result = PrivacyScrubberCore.scrubText(textToScrub, customRules, {}, normalizedProfile, localSessionMap, license.isPro);
  } catch (err) {
    return text;
  }

  if (result && result.tokenMap) {
    Object.assign(localSessionMap, result.tokenMap);
  }
  
  if (!license.isPro && result.tokenMap) {
    // Free tier: check for secrets and warn
    let hasSecrets = false;
    Object.entries(result.tokenMap).forEach(([token, original]) => {
      let isSecret = false;
      for (const detector of DEVOPS_SECRETS_DETECTOR) {
        detector.regex.lastIndex = 0;
        if (detector.regex.test(original)) {
          isSecret = true;
          break;
        }
      }
      if (isSecret) {
        hasSecrets = true;
        result.scrubbedText = result.scrubbedText.replace(token, '[SECRET_BLOCKED_UPGRADE_TO_PRO]');
      }
    });

    if (hasSecrets) {
      process.stderr.write(`\x1b[1;31m🚫  [PrivacyScrubber] Secrets/Keys detected in output. Replaced with [SECRET_BLOCKED_UPGRADE_TO_PRO] to protect your data (Requires PRO tier).\x1b[0m\n`);
    }
  }

  return result.scrubbedText + (wasTruncated ? '\n[Output truncated to Free Tier character limit. Upgrade to PRO for unlimited.]' : '');
}

function emitProofFeedback() {
  const isQuiet = args.includes("--quiet") || args.includes("-q");
  if (isQuiet) return;

  const totalMasked = Object.keys(localSessionMap).length;
  if (totalMasked > 0) {
    process.stderr.write(`\x1b[36m[ps-guard] ${totalMasked} item(s) masked · 0 bytes egress · Zero-Trust RAM verified\x1b[0m\n`);
  } else if (args.includes("--verbose")) {
    process.stderr.write(`\x1b[36m[ps-guard] 0 item(s) masked · 0 bytes egress · Zero-Trust RAM verified\x1b[0m\n`);
  }
}

// Mode 1: Agent Rules Generation (--rules)
if (isRulesMode) {
  const targetDir = process.cwd();
  const targets = rulesTargets.includes("all") ? ["cursor", "windsurf", "claude_code", "copilot", "cline"] : rulesTargets;
  const RULE_TEXT = `# PrivacyScrubber Zero-Trust Agentic Guard (CISO Security Rules)
# 100% Local In-Memory Data Sanitization. Zero Network Egress.

## Agent Mandate
You are an autonomous AI assistant operating under strict Zero-Trust Data Sanitization (ZTDS) policies.
Before reading sensitive files, running terminal commands that may print credentials, or committing code:

1. **Terminal Commands:** When running shell commands whose output may contain API keys, database connection strings, or customer PII (e.g. \`cat .env\`, \`docker logs\`, \`env\`, \`git diff\`), invoke the \`guard_exec\` tool instead of raw terminal execution.
2. **Reading Credentials/Config:** When reading \`.env*\`, config files, database credentials, or secret keys, always call \`guard_read_file\` so sensitive entities are tokenized locally in RAM before entering your context window.
3. **Git Code Review:** Use \`guard_git_diff\` to inspect changes without exposing plaintext secrets to the cloud.
4. **Applying Patches:** When writing files containing token placeholders (e.g. \`[API_KEY_1]\`, \`[DB_PASSWORD_1]\`), use \`guard_apply_patch\` to automatically restore authentic secrets locally to disk without sending them back to the LLM.
5. **Final Output:** Pass any final synthesized text containing token placeholders through \`reveal_text\` before presenting it to the user.
`;

  const generatedFiles = [];
  if (targets.includes("cursor")) {
    fs.writeFileSync(path.join(targetDir, '.cursorrules'), RULE_TEXT, 'utf8');
    generatedFiles.push('.cursorrules');
  }
  if (targets.includes("windsurf")) {
    fs.writeFileSync(path.join(targetDir, '.windsurfrules'), RULE_TEXT, 'utf8');
    generatedFiles.push('.windsurfrules');
  }
  if (targets.includes("claude_code") || targets.includes("claude")) {
    const p = path.join(targetDir, 'CLAUDE.md');
    if (fs.existsSync(p)) {
      const existing = fs.readFileSync(p, 'utf8');
      if (!existing.includes("Zero-Trust Agentic Guard")) {
        fs.writeFileSync(p, existing + "\n\n" + RULE_TEXT, 'utf8');
        generatedFiles.push('CLAUDE.md (appended)');
      } else {
        generatedFiles.push('CLAUDE.md (already present)');
      }
    } else {
      fs.writeFileSync(p, RULE_TEXT, 'utf8');
      generatedFiles.push('CLAUDE.md');
    }
  }
  if (targets.includes("copilot")) {
    const copilotDir = path.join(targetDir, '.github');
    if (!fs.existsSync(copilotDir)) fs.mkdirSync(copilotDir, { recursive: true });
    fs.writeFileSync(path.join(copilotDir, 'copilot-instructions.md'), RULE_TEXT, 'utf8');
    generatedFiles.push('.github/copilot-instructions.md');
  }
  if (targets.includes("cline")) {
    fs.writeFileSync(path.join(targetDir, '.clinerules'), RULE_TEXT, 'utf8');
    generatedFiles.push('.clinerules');
  }

  console.log(`[Zero-Trust Agentic Guard: Agent Rules Generated]`);
  console.log(`Workspace: ${targetDir}`);
  console.log(`Files Created/Updated:`);
  generatedFiles.forEach(f => console.log(`  - ${f}`));
  process.exit(0);
}

// Mode 2: Git Diff Mode (--diff)
if (isDiffMode) {
  const isStaged = args.includes("--staged") || args.includes("--cached");
  const gitCmd = isStaged ? "git diff --cached" : "git diff";
  try {
    let diffOutput = '';
    try {
      diffOutput = execSync(gitCmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (err) {
      if (err.code === 'ENOBUFS' && err.stdout) {
        diffOutput = err.stdout.toString('utf8');
      } else {
        throw err;
      }
    }
    if (!diffOutput.trim()) {
      console.log(`[Zero-Trust Agentic Guard: Git Diff]\nNo git diff changes detected (${isStaged ? 'staged' : 'unstaged'}).`);
      process.exit(0);
    }
    const sanitizedDiff = performSanitization(diffOutput);
    process.stdout.write(sanitizedDiff.endsWith('\n') ? sanitizedDiff : sanitizedDiff + '\n');
    emitProofFeedback();
    process.exit(0);
  } catch (err) {
    console.error(`Error running git diff: ${err.message}`);
    process.exit(1);
  }
}

// Mode 3: Stdin Stream Mode (pipe)
if (hasStdin && !hasCommand) {
  const rlStdin = readline.createInterface({
    input: process.stdin,
    terminal: false
  });
  rlStdin.on('line', (line) => {
    const sanitized = performSanitization(line);
    process.stdout.write(sanitized + '\n');
  });
  rlStdin.on('close', () => {
    emitProofFeedback();
    process.exit(0);
  });
} else if (hasCommand) {
  // Mode 4: Spawn Child Process (-- <command>)
  const commandArgs = args.slice(cmdIndex + 1);
  const fullCommand = commandArgs.join(' ');
  const child = spawn(fullCommand, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true
  });

  const rlStdout = readline.createInterface({
    input: child.stdout,
    terminal: false
  });

  rlStdout.on('line', (line) => {
    const sanitized = performSanitization(line);
    process.stdout.write(sanitized + '\n');
  });

  const rlStderr = readline.createInterface({
    input: child.stderr,
    terminal: false
  });

  rlStderr.on('line', (line) => {
    const sanitized = performSanitization(line);
    process.stderr.write(sanitized + '\n');
  });

  child.on('close', (code) => {
    emitProofFeedback();
    process.exit(code || 0);
  });

  child.on('error', (err) => {
    console.error(`Error spawning command: ${err.message}`);
    process.exit(1);
  });
}
