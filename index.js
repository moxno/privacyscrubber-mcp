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

// Import the production core engine with 100% parity
const scrubberCorePath = path.resolve(__dirname, './scrubber-core.cjs');
const PrivacyScrubberCore = require(scrubberCorePath);

// Initialize core engine
PrivacyScrubberCore.init();

// Volatile in-memory token map
const sessionMap = {};

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

// Create the MCP server
const server = new Server(
  {
    name: "privacyscrubber/pii-masking-mcp",
    version: "1.6.6",
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
      }
    ]
  };
});

// Handle tool execution calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "sanitize_text") {
      const { text, profile = "General" } = args;
      const targetProfile = profile.trim();

      // Check tier gating for advanced profiles
      const isAdvanced = targetProfile.toLowerCase() !== "general";
      const license = checkLicenseStatus();
      let finalProfile = targetProfile;

      if (isAdvanced && !license.isPro) {
        const reason = license.error ? ` (${license.error})` : "";
        process.stderr.write(`⚠️ [PrivacyScrubber] Advanced profile '${targetProfile}' is locked in the FREE tier. Falling back to 'General' profile.${reason}\nGet a PRO key at: https://privacyscrubber.com/pricing\n`);
        finalProfile = "General";
      }

      const processedText = truncateIfFree(text, license.isPro);
      const sanitized = performSanitization(processedText, finalProfile);
      return {
        content: [
          {
            type: "text",
            text: sanitized
          }
        ]
      };
    }

    if (name === "reveal_text") {
      const { text } = args;
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

          if (isAdvanced && !license.isPro) {
            const reason = license.error ? ` (${license.error})` : "";
            process.stderr.write(`⚠️ [PrivacyScrubber] Advanced profile '${targetProfile}' is locked in the FREE tier. Falling back to 'General' profile.${reason}\nGet a PRO key at: https://privacyscrubber.com/pricing\n`);
            finalProfile = "General";
          }

          const processedContent = truncateIfFree(content, license.isPro);
          const sanitized = performSanitization(processedContent, finalProfile);
          return {
            content: [
              {
                type: "text",
                text: sanitized
              }
            ]
          };
        } catch (docxError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: Failed to parse DOCX file: ${docxError.message}`
              }
            ]
          };
        }
      }

      const buffer = fs.readFileSync(resolvedPath);
      
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
              text: `Error: Binary file format detected. The local MCP server only supports plain text files (e.g., source code, logs, CSV, markdown, JSON). To sanitize complex formats like PDF or DOCX, please use the web interface at: https://privacyscrubber.com/`
            }
          ]
        };
      }

      const content = buffer.toString("utf8");
      const targetProfile = profile.trim();
      const isAdvanced = targetProfile.toLowerCase() !== "general";
      const license = checkLicenseStatus();

      let finalProfile = targetProfile;

      if (isAdvanced && !license.isPro) {
        const reason = license.error ? ` (${license.error})` : "";
        process.stderr.write(`⚠️ [PrivacyScrubber] Advanced profile '${targetProfile}' is locked in the FREE tier. Falling back to 'General' profile.${reason}\nGet a PRO key at: https://privacyscrubber.com/pricing\n`);
        finalProfile = "General";
      }

      const processedContent = truncateIfFree(content, license.isPro);
      const sanitized = performSanitization(processedContent, finalProfile);
      return {
        content: [
          {
            type: "text",
            text: sanitized
          }
        ]
      };
    }

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Unknown tool: ${name}`
        }
      ]
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing tool: ${error.message}`
        }
      ]
    };
  }
});

function loadCustomRules() {
  const license = checkLicenseStatus();
  
  let configPath = path.resolve(process.cwd(), 'privacyscrubber.json');

  if (!fs.existsSync(configPath)) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (homeDir) {
      configPath = path.resolve(homeDir, 'privacyscrubber.json');
    }
  }

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
          process.stderr.write("⚠️ [PrivacyScrubber] Custom rules detected in privacyscrubber.json, but are ignored in the Free Tier. Set PRIVACYSCRUBBER_KEY to your PRO license key.\n");
        }
      }
    } catch (e) {
      process.stderr.write(`Error parsing privacyscrubber.json: ${e.message}\n`);
    }
  }
  return [];
}

// Run helper
function performSanitization(text, profile) {
  const customRules = loadCustomRules();
  const result = PrivacyScrubberCore.scrubText(text, customRules, {}, profile, sessionMap);
  
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
    process.stderr.write(`⚠️ [PrivacyScrubber] Input truncated to ${MAX_FREE_CHARS} characters (Free Tier Limit). Set PRIVACYSCRUBBER_KEY to your PRO license key for unlimited size.\n`);
    return text.substring(0, MAX_FREE_CHARS);
  }
  return text;
}

// Start the server transport
const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  console.error("Failed to connect MCP server transport:", error);
  process.exit(1);
});

// Mark script executable on launch
try {
  fs.chmodSync(__filename, '755');
} catch (e) {
  // Silent fail if filesystem is read-only
}
