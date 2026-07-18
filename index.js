#!/usr/bin/env node

/**
 * PrivacyScrubber MCP Server
 * Zero-Trust Data Sanitization (ZTDS) for AI IDEs (Cursor, Windsurf) and Claude Desktop.
 * 
 * Runs 100% locally. In-memory volatile token mapping. Zero server logs.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import crypto from 'crypto';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Version is sourced from mcp-server/package.json.
// build.js syncs mcp-server/package.json from root package.json on every build.
// Never hardcode the version — bump package.json at root instead.
const MCP_VERSION = require('./package.json').version;

// Import the production core engine with 100% parity
const scrubberCorePath = path.resolve(__dirname, './scrubber-core.cjs');
const PrivacyScrubberCore = require(scrubberCorePath);

// Initialize core engine
PrivacyScrubberCore.init();

// Volatile in-memory token map
const sessionMap = {};

// ANSI terminal color helpers
const colors = {
  yellowBold: '\x1b[1;33m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  greenBold: '\x1b[1;32m',
  redBold: '\x1b[1;31m',
  reset: '\x1b[0m'
};

// Secrets detection patterns — defined once here, shared by detectSecrets() and performSanitization()
const DEVOPS_SECRETS_DETECTOR = [
  { name: 'AWS Credentials', regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA)[A-Z0-9]{16}\b/g },
  { name: 'JSON Web Token (JWT)', regex: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g },
  { name: 'API Token/Key (GitHub/Slack/NPM)', regex: /\b(?:ghp|gho|ghu|ghs|ghr|glpat|npm|xox[baprs])[-_][A-Za-z0-9_]{10,}\b/g },
  { name: 'Stripe API Key', regex: /\b(?:[rs]k)_(?:test|live)_[a-zA-Z0-9]{24,}\b/g },
  { name: 'Database/API Secret', regex: /\b(DB|POSTGRES|REDIS|MYSQL|AWS|SECRET|PASSWORD|TOKEN|API|KEY)[A-Z0-9_]*\s*[:=]\s*[^ \t\r\n"']{8,}\b/gi }
];

// Hardcoded public key for offline cryptographic verification
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw3f37srO402PU4++Baf8
FG8LY4l/IA3NKLlBnYmNHRTjfI/O/w5PDZn1xPcUQevojA1J+A5moKcjXsJ5b21X
hJoYSkE4vLpcVYOt1FhRwEHs1APDSyss0HixboLz2eW2XQf2NbwajWtNlyxvgczO
KE6ClnLomtsaKywwqB4alzdYnnnFJttFPjwmgPSO7D9AgN9sYaVkXOaOFrIZ90Ng
TRhSHUeL7ReltWlCHwz9xf5m2FrKtxr2VBlEoyPjsFzalHMey1EX+yXe81zM7IIi
t1Z8agLzo7WIfNBAIWmRlerTplaFFZrQgdF5g/Y0n8IIMZOtadgoY8E855psDNZV
7wIDAQAB
-----END PUBLIC KEY-----`;

function checkLicenseStatus() {
  const key = (process.env.PRIVACYSCRUBBER_KEY || "").trim();
  if (!key) return { isPro: false, type: null, error: "No license key provided." };

  try {
    const [payloadBase64, signatureBase64] = key.split('.');
    if (!payloadBase64 || !signatureBase64) {
      return { isPro: false, type: null, error: "Invalid license key structure." };
    }

    const verifier = crypto.createVerify('SHA256');
    verifier.update(payloadBase64);
    const isVerified = verifier.verify(PUBLIC_KEY, signatureBase64, 'base64');
    
    if (!isVerified) {
      return { isPro: false, type: null, error: "Signature verification failed." };
    }

    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    
    // Expiration check
    if (payload.expires && payload.expires < Math.floor(Date.now() / 1000)) {
      return { 
        isPro: false, 
        type: payload.type, 
        error: `License expired on ${new Date(payload.expires * 1000).toLocaleDateString()}` 
      };
    }

    return { isPro: true, type: payload.type, error: null };
  } catch (e) {
    return { isPro: false, type: null, error: "Error parsing license: " + e.message };
  }
}

// ── Session request counter (volatile in-memory) ─────────────────────────────
let sessionRequestCount = 0;
const UPSELL_EVERY_N = 10; // show upsell nudge every N free-tier requests

// Build a clean upsell content block visible to the agent / user
function buildUpsellBlock(reason) {
  const count = sessionRequestCount;
  let lines = [
    '─────────────────────────────────────────────',
    '⚡ PrivacyScrubber PRO — Upgrade your AI setup',
    '─────────────────────────────────────────────',
  ];
  if (reason) lines.push(`ℹ️  ${reason}`);
  lines.push(
    `📊 Free session requests: ${count}`,
    '🔒 PRO unlocks: 22 industry profiles (Dev, Medical, Legal…)',
    '         + Custom regex rules (privacyscrubber.json)',
    '         + Unlimited input size',
    '',
    '💳 PRO Lifetime: $110  →  https://privacyscrubber.com/pricing',
    '',
    'After purchase, add your key to your MCP config:',
    '  "PRIVACYSCRUBBER_KEY": "<your-key-here>"',
    '─────────────────────────────────────────────'
  );
  return { type: 'text', text: lines.join('\n') };
}

// Decide if we should attach a soft periodic nudge (every N requests, free tier)
function shouldNudge(isPro) {
  return !isPro && sessionRequestCount > 0 && sessionRequestCount % UPSELL_EVERY_N === 0;
}

// Create the MCP server
const server = new Server(
  {
    name: "privacyscrubber/pii-masking-mcp",
    version: MCP_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "sanitize_text",
        description: "Locally scrubs PII, secrets, and credentials (like API keys, passwords, emails, phones, names) from code, logs, or text. Replaces them with safe placeholders (e.g., [EMAIL_1], [API_KEY_1]). Keep your data secure before passing it to any LLM.",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The raw text, code, or logs to sanitize."
            },
            profile: {
              type: "string",
              description: "The detection profile to use. Available: 'General' (Free), or PRO profiles: 'Dev' (Engineering/Code), 'Medical', 'Pharma', 'Legal', 'Compliance', 'CCPA', 'Finance', 'Bizops', 'Sales', 'WealthMgmt', 'Insurance', 'Accounting', 'HR', 'Security', 'Marketing', 'Support', 'RealEstate', 'Agents', 'Academic', 'Creative', 'Tech', 'Personal'. Defaults to 'General'."
            }
          },
          required: ["text"]
        }
      },
      {
        name: "reveal_text",
        description: "Replaces masked tokens (e.g., [EMAIL_1], [API_KEY_1]) in the LLM's response back with the original private data from the local volatile RAM-only session map.",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The AI generated response containing placeholders to restore."
            }
          },
          required: ["text"]
        }
      },
      {
        name: "sanitize_file",
        description: "Reads a local file, sanitizes its contents using the selected profile, and outputs the safe version for AI analysis. Securely keeps original identifiers in memory.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to the file to sanitize."
            },
            profile: {
              type: "string",
              description: "The detection profile to use. Available: 'General' (Free), or PRO profiles: 'Dev' (Engineering/Code), 'Medical', 'Pharma', 'Legal', 'Compliance', 'CCPA', 'Finance', 'Bizops', 'Sales', 'WealthMgmt', 'Insurance', 'Accounting', 'HR', 'Security', 'Marketing', 'Support', 'RealEstate', 'Agents', 'Academic', 'Creative', 'Tech', 'Personal'. Defaults to 'General'."
            }
          },
          required: ["file_path"]
        }
      },
      {
        name: "create_default_config",
        description: "Creates a default 'privacyscrubber.json' configuration file in the active workspace root directory if one does not exist. Includes template structures for custom regex rules and exclusion bypass patterns.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "check_status",
        description: "Returns the current PrivacyScrubber MCP tier, session usage, available profiles, and PRO upgrade instructions. Call this to see your license status or get setup help.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      }
    ]
  };
});

// Handle tool execution calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "sanitize_text") {
      const { text, profile = "General" } = args || {};
      if (text === undefined || text === null) {
        return {
          isError: true,
          content: [{ type: "text", text: "Error: Missing required parameter 'text'. Provide the string to sanitize." }]
        };
      }
      if (typeof text !== "string") {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: Parameter 'text' must be a string, got '${typeof text}'. Stringify objects before passing.` }]
        };
      }
      const targetProfile = (profile || "General").trim();

      // Check tier gating for advanced profiles
      const isAdvanced = targetProfile.toLowerCase() !== "general";
      const license = checkLicenseStatus();
      let finalProfile = targetProfile;
      const extraBlocks = [];

      sessionRequestCount++;

      if (isAdvanced && !license.isPro) {
        const reason = license.error ? ` (${license.error})` : "";
        process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] Advanced profile '${targetProfile}' is locked in the FREE tier. Falling back to 'General' profile.${reason}${colors.reset}\n${colors.cyan}👉  Get a PRO key at: https://privacyscrubber.com/pricing${colors.reset}\n`);
        finalProfile = "General";
        extraBlocks.push(buildUpsellBlock(`Profile '${targetProfile}' requires PRO. Using 'General' as fallback.`));
      }

      const { processedText, wasTruncated } = truncateIfFree(text, license.isPro);
      if (wasTruncated) {
        extraBlocks.push(buildUpsellBlock(`Input was truncated to 50,000 characters (Free Tier limit).`));
      }

      if (!license.isPro) {
        const detected = detectSecrets(processedText);
        if (detected.length > 0) {
          process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] API Key / Secret (${detected.join(', ')}) detected! Sanitization skipped (Requires PRO Profile).${colors.reset}\n${colors.cyan}👉  Upgrade at: https://privacyscrubber.com/pricing${colors.reset}\n`);
          extraBlocks.push(buildUpsellBlock(`API Key / Secret (${detected.join(', ')}) detected! Sanitization skipped (Requires PRO Profile).`));
        }
      }

      const sanitized = performSanitization(processedText, finalProfile);

      // Periodic soft nudge every N free-tier requests (no trigger event needed)
      if (!license.isPro && extraBlocks.length === 0 && sessionRequestCount % UPSELL_EVERY_N === 0) {
        extraBlocks.push(buildUpsellBlock(null));
      }

      return {
        content: [
          { type: "text", text: sanitized },
          ...extraBlocks
        ]
      };
    }

    if (name === "reveal_text") {
      const { text } = args || {};
      if (text === undefined || text === null) {
        return {
          isError: true,
          content: [{ type: "text", text: "Error: Missing required parameter 'text'. Provide the AI response containing placeholders to restore." }]
        };
      }
      if (typeof text !== "string") {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: Parameter 'text' must be a string, got '${typeof text}'.` }]
        };
      }

      // Warn early if session has no tokens — reveal would be a no-op
      if (Object.keys(sessionMap).length === 0) {
        return {
          content: [{
            type: "text",
            text: `⚠️  Session map is empty — no tokens to restore. Call 'sanitize_text' or 'sanitize_file' first to build the token map, then pass the AI's response here.`
          }]
        };
      }

      const restored = PrivacyScrubberCore.unscrubText(text, sessionMap);
      return {
        content: [
          {
            type: "text",
            text: restored.restoredText
          }
        ]
      };
    }

    if (name === "sanitize_file") {
      const rawPath = args.file_path || args.filePath;
      if (!rawPath) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Error: Missing required parameter 'file_path'."
            }
          ]
        };
      }
      const { profile = "General" } = args;
      const filePath = rawPath;
      
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error: File not found at '${filePath}'`
            }
          ]
        };
      }

      const stats = fs.statSync(resolvedPath);
      if (!stats.isFile()) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error: Path '${filePath}' is not a regular file.`
            }
          ]
        };
      }

      // Limit file size to 10MB to prevent Out of Memory DoS
      const MAX_SIZE = 10 * 1024 * 1024;
      if (stats.size > MAX_SIZE) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error: File is too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Maximum allowed size is 10MB.`
            }
          ]
        };
      }

      if (resolvedPath.toLowerCase().endsWith(".docx")) {
        try {
          const mammoth = require('mammoth');
          const result = await mammoth.extractRawText({ path: resolvedPath });
          const content = result.value;
          const targetProfile = profile.trim();
          const isAdvanced = targetProfile.toLowerCase() !== "general";
          const license = checkLicenseStatus();

          let finalProfile = targetProfile;
          const extraBlocks = [];

          sessionRequestCount++;

          if (isAdvanced && !license.isPro) {
            const reason = license.error ? ` (${license.error})` : "";
            process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] Advanced profile '${targetProfile}' is locked in the FREE tier. Falling back to 'General' profile.${reason}${colors.reset}\n${colors.cyan}👉  Get a PRO key at: https://privacyscrubber.com/pricing${colors.reset}\n`);
            finalProfile = "General";
            extraBlocks.push(buildUpsellBlock(`Profile '${targetProfile}' requires PRO. Using 'General' as fallback.`));
          }

          const { processedText: processedContent, wasTruncated } = truncateIfFree(content, license.isPro);
          if (wasTruncated) extraBlocks.push(buildUpsellBlock(`File content was truncated to 50,000 characters (Free Tier limit).`));

          if (!license.isPro) {
            const detected = detectSecrets(processedContent);
            if (detected.length > 0) {
              process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] API Key / Secret (${detected.join(', ')}) detected! Sanitization skipped (Requires PRO Profile).${colors.reset}\n${colors.cyan}👉  Upgrade at: https://privacyscrubber.com/pricing${colors.reset}\n`);
              extraBlocks.push(buildUpsellBlock(`API Key / Secret (${detected.join(', ')}) detected! Sanitization skipped (Requires PRO Profile).`));
            }
          }

          const sanitized = performSanitization(processedContent, finalProfile);

          if (!license.isPro && extraBlocks.length === 0 && sessionRequestCount % UPSELL_EVERY_N === 0) {
            extraBlocks.push(buildUpsellBlock(null));
          }

          return {
            content: [
              { type: "text", text: sanitized },
              ...extraBlocks
            ]
          };
        } catch (docxError) {
          return {
            isError: true,
            content: [{ type: "text", text: `Error: Failed to parse DOCX file: ${docxError.message}` }]
          };
        }
      }

      const buffer = fs.readFileSync(resolvedPath);

      const isPdf = resolvedPath.toLowerCase().endsWith(".pdf");
      const isExcel = resolvedPath.toLowerCase().endsWith(".xlsx") || resolvedPath.toLowerCase().endsWith(".xls");

      if (isPdf || isExcel) {
        const license = checkLicenseStatus();
        if (!license.isPro) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: PDF and Excel file sanitization is a PRO feature. Set PRIVACYSCRUBBER_KEY to your PRO license key to unlock local document parsing. Get a key at: https://privacyscrubber.com/pricing`
              }
            ]
          };
        }

        if (isPdf) {
          try {
            const pdf = require('pdf-parse');
            const data = await pdf(buffer);
            const content = data.text;
            const targetProfile = profile.trim();
            const isAdvanced = targetProfile.toLowerCase() !== "general";

            let finalProfile = targetProfile;
            const extraBlocks = [];

            sessionRequestCount++;

            if (isAdvanced && !license.isPro) {
              const reason = license.error ? ` (${license.error})` : "";
              process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] Advanced profile '${targetProfile}' is locked in the FREE tier. Falling back to 'General' profile.${reason}${colors.reset}\n${colors.cyan}👉  Get a PRO key at: https://privacyscrubber.com/pricing${colors.reset}\n`);
              finalProfile = "General";
              extraBlocks.push(buildUpsellBlock(`Profile '${targetProfile}' requires PRO. Using 'General' as fallback.`));
            }

            const { processedText: processedContent, wasTruncated } = truncateIfFree(content, license.isPro);
            if (wasTruncated) extraBlocks.push(buildUpsellBlock(`File content was truncated to 50,000 characters (Free Tier limit).`));

            if (!license.isPro) {
              const detected = detectSecrets(processedContent);
              if (detected.length > 0) {
                process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] API Key / Secret (${detected.join(', ')}) detected! Sanitization skipped (Requires PRO Profile).${colors.reset}\n${colors.cyan}👉  Upgrade at: https://privacyscrubber.com/pricing${colors.reset}\n`);
                extraBlocks.push(buildUpsellBlock(`API Key / Secret (${detected.join(', ')}) detected! Sanitization skipped (Requires PRO Profile).`));
              }
            }

            const sanitized = performSanitization(processedContent, finalProfile);

            if (!license.isPro && extraBlocks.length === 0 && sessionRequestCount % UPSELL_EVERY_N === 0) {
              extraBlocks.push(buildUpsellBlock(null));
            }

            return {
              content: [
                { type: "text", text: sanitized },
                ...extraBlocks
              ]
            };
          } catch (pdfError) {
            return {
              isError: true,
              content: [{ type: "text", text: `Error: Failed to parse PDF file: ${pdfError.message}` }]
            };
          }
        }

        if (isExcel) {
          try {
            const XLSX = require('xlsx');
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            let content = '';
            workbook.SheetNames.forEach(sheetName => {
              const worksheet = workbook.Sheets[sheetName];
              content += `--- Sheet: ${sheetName} ---\n`;
              content += XLSX.utils.sheet_to_csv(worksheet) + '\n';
            });

            const targetProfile = profile.trim();
            const isAdvanced = targetProfile.toLowerCase() !== "general";

            let finalProfile = targetProfile;
            const extraBlocks = [];

            sessionRequestCount++;

            if (isAdvanced && !license.isPro) {
              const reason = license.error ? ` (${license.error})` : "";
              process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] Advanced profile '${targetProfile}' is locked in the FREE tier. Falling back to 'General' profile.${reason}${colors.reset}\n${colors.cyan}👉  Get a PRO key at: https://privacyscrubber.com/pricing${colors.reset}\n`);
              finalProfile = "General";
              extraBlocks.push(buildUpsellBlock(`Profile '${targetProfile}' requires PRO. Using 'General' as fallback.`));
            }

            const { processedText: processedContent, wasTruncated } = truncateIfFree(content, license.isPro);
            if (wasTruncated) extraBlocks.push(buildUpsellBlock(`File content was truncated to 50,000 characters (Free Tier limit).`));

            if (!license.isPro) {
              const detected = detectSecrets(processedContent);
              if (detected.length > 0) {
                process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] API Key / Secret (${detected.join(', ')}) detected! Sanitization skipped (Requires PRO Profile).${colors.reset}\n${colors.cyan}👉  Upgrade at: https://privacyscrubber.com/pricing${colors.reset}\n`);
                extraBlocks.push(buildUpsellBlock(`API Key / Secret (${detected.join(', ')}) detected! Sanitization skipped (Requires PRO Profile).`));
              }
            }

            const sanitized = performSanitization(processedContent, finalProfile);

            if (!license.isPro && extraBlocks.length === 0 && sessionRequestCount % UPSELL_EVERY_N === 0) {
              extraBlocks.push(buildUpsellBlock(null));
            }

            return {
              content: [
                { type: "text", text: sanitized },
                ...extraBlocks
              ]
            };
          } catch (xlsxError) {
            return {
              isError: true,
              content: [{ type: "text", text: `Error: Failed to parse Excel file: ${xlsxError.message}` }]
            };
          }
        }
      }

      // Check for null bytes in the first 8KB to detect binary files
      let isBinary = false;
      const checkLen = Math.min(buffer.length, 8000);
      for (let i = 0; i < checkLen; i++) {
        if (buffer[i] === 0) {
          isBinary = true;
          break;
        }
      }

      if (isBinary) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error: Binary file format detected. The local MCP server only supports plain text files (e.g., source code, logs, CSV, markdown, JSON) and premium document formats (PDF, DOCX, XLSX). To sanitize PDF or Excel files, please upgrade to PRO or use the web interface.`
            }
          ]
        };
      }

      const content = buffer.toString("utf8");
      const targetProfile = profile.trim();
      const isAdvanced = targetProfile.toLowerCase() !== "general";
      const license = checkLicenseStatus();

      let finalProfile = targetProfile;
      const extraBlocks = [];

      sessionRequestCount++;

      if (isAdvanced && !license.isPro) {
        const reason = license.error ? ` (${license.error})` : "";
        process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] Advanced profile '${targetProfile}' is locked in the FREE tier. Falling back to 'General' profile.${reason}${colors.reset}\n${colors.cyan}👉  Get a PRO key at: https://privacyscrubber.com/pricing${colors.reset}\n`);
        finalProfile = "General";
        extraBlocks.push(buildUpsellBlock(`Profile '${targetProfile}' requires PRO. Using 'General' as fallback.`));
      }

      const { processedText: processedContent2, wasTruncated: wasTruncated2 } = truncateIfFree(content, license.isPro);
      if (wasTruncated2) extraBlocks.push(buildUpsellBlock(`File content was truncated to 50,000 characters (Free Tier limit).`));

      if (!license.isPro) {
        const detected = detectSecrets(processedContent2);
        if (detected.length > 0) {
          process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] API Key / Secret (${detected.join(', ')}) detected! Sanitization skipped (Requires PRO Profile).${colors.reset}\n${colors.cyan}👉  Upgrade at: https://privacyscrubber.com/pricing${colors.reset}\n`);
          extraBlocks.push(buildUpsellBlock(`API Key / Secret (${detected.join(', ')}) detected! Sanitization skipped (Requires PRO Profile).`));
        }
      }

      const sanitized = performSanitization(processedContent2, finalProfile);

      if (!license.isPro && extraBlocks.length === 0 && sessionRequestCount % UPSELL_EVERY_N === 0) {
        extraBlocks.push(buildUpsellBlock(null));
      }

      return {
        content: [
          { type: "text", text: sanitized },
          ...extraBlocks
        ]
      };
    }

    if (name === "create_default_config") {
      const configPath = path.resolve(process.cwd(), 'privacyscrubber.json');
      if (fs.existsSync(configPath)) {
        return {
          content: [{
            type: "text",
            text: `ℹ️  Configuration file 'privacyscrubber.json' already exists in the active workspace root directory:\n   ${configPath}\nNo changes were made.`
          }]
        };
      }

      const defaultTemplate = {
        "_comment": "PrivacyScrubber local configuration. Add custom rules and restart your MCP client (Cursor/Windsurf). Details: https://privacyscrubber.com/docs/config",
        "customRules": [
          {
            "pattern": "my-secret-pattern-\\d+",
            "label": "CUSTOM_TAG",
            "_comment": "pattern must be a valid Javascript regex string. label is the tag replacement (e.g. CUSTOM_TAG)"
          }
        ]
      };

      try {
        fs.writeFileSync(configPath, JSON.stringify(defaultTemplate, null, 2) + '\n', 'utf8');
        return {
          content: [{
            type: "text",
            text: `✅ Configuration file 'privacyscrubber.json' successfully created in your workspace root:\n   ${configPath}\n\nRestart your MCP client (e.g. Cursor or Claude Desktop) to load the config rules.`
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Error: Failed to write configuration file: ${err.message}`
          }]
        };
      }
    }

    if (name === "check_status") {
      const license = checkLicenseStatus();
      const tier = license.isPro ? 'PRO' : 'FREE';
      const tierIcon = license.isPro ? '✅' : '🔓';
      const profileList = license.isPro
        ? 'All 23 profiles active (General, Dev, Medical, Legal, Finance, HR…)'
        : 'General only — PRO unlocks 22 industry profiles';
      const sizeLimit = license.isPro ? 'Unlimited' : '50,000 characters per request';

      const configPath = resolveConfigPath();
      let rulesStatus = '';
      let configPathSnippet = 'Not found';

      if (fs.existsSync(configPath)) {
        const localPath = path.resolve(process.cwd(), 'privacyscrubber.json');
        if (configPath === localPath) {
          configPathSnippet = './privacyscrubber.json';
        } else {
          configPathSnippet = '~/privacyscrubber.json';
        }

        if (license.isPro) {
          const rulesCount = loadCustomRules().length;
          rulesStatus = `✅ Active (${rulesCount} rule${rulesCount !== 1 ? 's' : ''})`;
        } else {
          rulesStatus = '🔒 Ignored (requires PRO)';
        }
      } else {
        rulesStatus = 'Not found';
      }

      const metricsSummary = getSessionMetricsSummary();

      const lines = [
        '╔══════════════════════════════════════════════════╗',
        `║       PrivacyScrubber MCP Server v${MCP_VERSION.padEnd(10)}          ║`,
        '╠══════════════════════════════════════════════════╣',
        `║  ${tierIcon} Tier: ${tier.padEnd(43)}║`,
        `║  📊 Session requests: ${String(sessionRequestCount).padEnd(27)}║`,
        `║  📁 Input size limit: ${sizeLimit.padEnd(27)}║`,
        '╠══════════════════════════════════════════════════╣',
        `║  🏷️  Profiles: ${profileList.substring(0,35).padEnd(35)}║`,
        `║  📋 Custom rules: ${rulesStatus.padEnd(31)}║`,
        `║  ⚙️  Config file: ${configPathSnippet.padEnd(31)}║`,
        `║  📈 Metrics: ${metricsSummary.substring(0,36).padEnd(36)}║`,
        '╠══════════════════════════════════════════════════╣',
      ];

      if (license.isPro) {
        lines.push(
          '║  ✅ PRO is active. All features unlocked.         ║',
          '║     To regenerate your key or manage billing:     ║',
          '║     https://privacyscrubber.com/pricing           ║'
        );
      } else {
        lines.push(
          '║  💳 Upgrade to PRO — $110 Lifetime                ║',
          '║     https://privacyscrubber.com/pricing           ║',
          '╠══════════════════════════════════════════════════╣',
          '║  After purchase, add your key to MCP config:     ║',
          '║                                                  ║',
          '║  Claude Desktop / Cursor / Windsurf:             ║',
          '║  "PRIVACYSCRUBBER_KEY": "<your-key-here>"        ║',
          '║                                                  ║',
          '║  Full setup guide:                               ║',
          '║  https://privacyscrubber.com/features/mcp/       ║'
        );
      }

      lines.push('╚══════════════════════════════════════════════════╝');

      return {
        content: [{ type: "text", text: lines.join('\n') }]
      };
    }

    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error executing tool: ${error.message}` }]
    };
  }
});

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

function getSessionMetricsSummary() {
  const counts = {};
  Object.keys(sessionMap).forEach(token => {
    const match = token.match(/^\[([A-Z_]+)_\d+\]$/);
    if (match) {
      const type = match[1];
      counts[type] = (counts[type] || 0) + 1;
    }
  });
  
  if (Object.keys(counts).length === 0) {
    return '0 entities masked';
  }
  
  const parts = [];
  if (counts.NAME) parts.push(`${counts.NAME} Name${counts.NAME > 1 ? 's' : ''}`);
  if (counts.EMAIL) parts.push(`${counts.EMAIL} Email${counts.EMAIL > 1 ? 's' : ''}`);
  if (counts.PHONE) parts.push(`${counts.PHONE} Phone${counts.PHONE > 1 ? 's' : ''}`);
  if (counts.ID) parts.push(`${counts.ID} ID${counts.ID > 1 ? 's' : ''}`);
  if (counts.CUSTOM) parts.push(`${counts.CUSTOM} Custom${counts.CUSTOM > 1 ? 's' : ''}`);
  
  Object.entries(counts).forEach(([type, count]) => {
    if (!['NAME', 'EMAIL', 'PHONE', 'ID', 'CUSTOM'].includes(type)) {
      parts.push(`${count} ${type}${count > 1 ? 's' : ''}`);
    }
  });
  
  return parts.join(', ');
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
          process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] Custom rules detected in privacyscrubber.json, but are ignored in the Free Tier.${colors.reset}\n${colors.cyan}👉  Set PRIVACYSCRUBBER_KEY to your PRO license key.${colors.reset}\n`);
        }
      }
    } catch (e) {
      process.stderr.write(`Error parsing privacyscrubber.json: ${e.message}\n`);
    }
  }
  return [];
}

// Secrets scanner — uses the module-level DEVOPS_SECRETS_DETECTOR constant
function detectSecrets(text) {
  const detected = [];
  DEVOPS_SECRETS_DETECTOR.forEach(detector => {
    // Reset lastIndex before every test — global regex retains state across calls
    detector.regex.lastIndex = 0;
    if (detector.regex.test(text)) {
      detected.push(detector.name);
    }
  });
  return detected;
}

function performSanitization(text, profile) {
  const customRules = loadCustomRules();
  const result = PrivacyScrubberCore.scrubText(text, customRules, {}, profile, sessionMap);
  
  const license = checkLicenseStatus();
  if (!license.isPro && result.tokenMap) {
    // Re-scan each masked token's original value against the shared detector.
    // If it was a raw secret, restore it in the output and remove from sessionMap
    // so it is never accidentally revealed by reveal_text.
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
        result.scrubbedText = result.scrubbedText.replace(token, original);
        delete result.tokenMap[token];
      }
    });
  }

  // Update our volatile map with new matches
  if (result.tokenMap) {
    Object.entries(result.tokenMap).forEach(([token, original]) => {
      sessionMap[token] = original;
    });
  }

  return result.scrubbedText;
}

function truncateIfFree(text, isPro) {
  const MAX_FREE_CHARS = 50000;
  if (!isPro && text.length > MAX_FREE_CHARS) {
    process.stderr.write(`${colors.yellowBold}⚠️  [PrivacyScrubber] Input truncated to ${MAX_FREE_CHARS} characters (Free Tier Limit).${colors.reset}\n${colors.cyan}👉  Set PRIVACYSCRUBBER_KEY to your PRO license key for unlimited size.${colors.reset}\n`);
    return { processedText: text.substring(0, MAX_FREE_CHARS), wasTruncated: true };
  }
  return { processedText: text, wasTruncated: false };
}

// Start the server transport
const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  process.stderr.write(`${colors.greenBold}✅ PrivacyScrubber ZTDS MCP Server started successfully.${colors.reset}\n`);
  process.stderr.write(`${colors.cyan}⭐ Star us on GitHub: https://github.com/moxno/privacyscrubber-mcp${colors.reset}\n`);
}).catch((error) => {
  console.error("Failed to connect MCP server transport:", error);
  process.exit(1);
});

// Mark script executable on launch
try {
  fs.chmodSync(__filename, '755');
} catch (e) {
  // Silent fail if filesystem is read-only
}
