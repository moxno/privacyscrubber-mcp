#!/usr/bin/env node

/**
 * PrivacyScrubber command runner wrapper: pii-masking-run
 * 
 * Runs any local shell command, intercepts its output (stdout/stderr) line-by-line, 
 * sanitizes any PII/Secrets locally, and writes the clean stream to the terminal.
 * 
 * Usage: pii-masking-run [options] -- <command> [args...]
 */

import { spawn } from 'child_process';
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
  let version = '1.7.0';
  try { version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version; } catch (_) {}
  console.log(`pii-masking-run v${version} (PrivacyScrubber MCP)`);
  process.exit(0);
}

if (cmdIndex === -1 || args.includes("-h") || args.includes("--help")) {
  console.log("PrivacyScrubber CLI Command Runner: pii-masking-run");
  console.log("\nUsage:");
  console.log("  npx pii-masking-run [options] -- <command> [args...]");
  console.log("\nOptions:");
  console.log("  --profile <name>  Specify detection profile (e.g. General, Medical, Legal, Dev, HR)");
  console.log("  --key <licKey>    PrivacyScrubber PRO License Key");
  console.log("  -v, --version     Print version");
  console.log("  -h, --help        Show this help screen");
  console.log("\nExamples:");
  console.log("  npx pii-masking-run -- cat database-dump.sql");
  console.log("  npx pii-masking-run --profile dev -- npm test");
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

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAy1jZ9X4rO5C9U0qK57V1
hJoYSkE4vLpcVYOt1FhRwEHs1APDSyss0HixboLz2eW2XQf2NbwajWtNlyxvgczO
KE6ClnLomtsaKywwqB4alzdYnnnFJttFPjwmgPSO7D9AgN9sYaVkXOaOFrIZ90Ng
TRhSHUeL7ReltWlCHwz9xf5m2FrKtxr2VBlEoyPjsFzalHMey1EX+yXe81zM7IIi
t1Z8agLzo7WIfNBAIWmRlerTplaFFZrQgdF5g/Y0n8IIMZOtadgoY8E855psDNZV
7wIDAQAB
-----END PUBLIC KEY-----`;

function checkLicenseStatus() {
  const key = (process.env.PRIVACYSCRUBBER_KEY || "").trim();
  if (!key) return { isPro: false, error: "No license key provided." };

  try {
    const [payloadBase64, signatureBase64] = key.split('.');
    const verifier = crypto.createVerify('SHA256');
    verifier.update(payloadBase64);
    const isVerified = verifier.verify(PUBLIC_KEY, signatureBase64, 'base64');
    
    if (!isVerified) return { isPro: false, error: "Signature verification failed." };

    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    if (payload.expires && payload.expires < Math.floor(Date.now() / 1000)) {
      return { 
        isPro: false, 
        error: `License expired on ${new Date(payload.expires * 1000).toLocaleDateString()}` 
      };
    }
    return { isPro: true, error: null };
  } catch (e) {
    return { isPro: false, error: "Error parsing license: " + e.message };
  }
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

const optionsArgs = args.slice(0, cmdIndex);
const commandArgs = args.slice(cmdIndex + 1);

if (commandArgs.length === 0) {
  console.error("Error: No command specified after '--'.");
  process.exit(1);
}

// Parse custom command-line options
for (let i = 0; i < optionsArgs.length; i++) {
  if (optionsArgs[i] === "--profile" && optionsArgs[i + 1]) {
    profile = optionsArgs[i + 1];
    i++;
  } else if (optionsArgs[i] === "--key" && optionsArgs[i + 1]) {
    key = optionsArgs[i + 1];
    i++;
  }
}

if (key) {
  process.env.PRIVACYSCRUBBER_KEY = key;
}

const customRules = loadCustomRules();
const localSessionMap = {};

function performSanitization(text) {
  const normalizedProfile = (profile || "general").trim().toLowerCase();
  const result = PrivacyScrubberCore.scrubText(text, customRules, {}, normalizedProfile, localSessionMap);
  const license = checkLicenseStatus();
  
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
        result.scrubbedText = result.scrubbedText.replace(token, original);
      }
    });

    if (hasSecrets) {
      process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] Secrets/Keys detected in output. Redaction skipped (Requires PRO tier).${colors.reset}\n`);
    }
  }

  return result.scrubbedText;
}

// Spawn child process capturing output
const child = spawn(commandArgs[0], commandArgs.slice(1), {
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
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error(`Error spawning command: ${err.message}`);
  process.exit(1);
});
