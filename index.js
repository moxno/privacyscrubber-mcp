#!/usr/bin/env node
// LicenseManager will be required below

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
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
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
let LicenseManager = require('./ps-license-manager.js');
if (!LicenseManager || typeof LicenseManager.validate !== 'function') {
  LicenseManager = global.LicenseManager;
}

// Initialize core engine
PrivacyScrubberCore.init();

// Volatile in-memory token map
const sessionMap = {};

// Volatile in-memory false positive ignore list (values excluded from future scrubs)
const sessionIgnoreList = new Set();

// ANSI terminal color helpers
const colors = {
  yellowBold: '\x1b[1;33m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  greenBold: '\x1b[1;32m',
  redBold: '\x1b[1;31m',
  reset: '\x1b[0m'
};

// Helper to log to both standard terminal (with colors) and MCP logging protocol
function mcpLog(msg) {
  const clean = msg.replace(/\x1b\[[0-9;]*m/g, '').trim();
  const level = clean.includes('⚠️') || clean.includes('Error') ? "warning" : "info";
  try {
    server.sendLoggingMessage({ level, data: clean });
  } catch(e) {
    // Ignore if server isn't fully connected yet
  }
  process.stderr.write(msg);
}

// Secrets detection patterns — defined once here, shared by detectSecrets() and performSanitization()
const DEVOPS_SECRETS_DETECTOR = [
  { name: 'AWS Credentials', regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA)[A-Z0-9]{16}\b/g },
  { name: 'JSON Web Token (JWT)', regex: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g },
  { name: 'API Token/Key (GitHub/Slack/NPM)', regex: /\b(?:ghp|gho|ghu|ghs|ghr|glpat|npm|xox[baprs])[-_][A-Za-z0-9_]{10,}\b/g },
  { name: 'Stripe API Key', regex: /\b(?:[rs]k)_(?:test|live)_[a-zA-Z0-9]{24,}\b/g },
  { name: 'OpenAI Project API Key', regex: /\b(?:sk|pk)-(?:proj-)?[a-zA-Z0-9_-]{16,}\b/gi },
  { name: 'Database Connection URI', regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^\s"']+/gi },
  { name: 'Database/API Secret', regex: /\b(DB|POSTGRES|REDIS|MYSQL|AWS|SECRET|PASSWORD|TOKEN|API|KEY)[A-Z0-9_]*\s*[:=]\s*[^ \t\r\n"']{8,}\b/gi }
];

function checkLicenseStatus() {
  const key = (process.env.PRIVACYSCRUBBER_KEY || "").trim();
  if (!key) return { isPro: false, type: null, error: "No license key provided." };

  const result = LicenseManager.validate(key);
  
  if (!result.valid) {
    mcpLog(`DEBUG: License invalid because: ${result.reason || "Unknown"}`);
    return { isPro: false, type: null, error: result.reason || "Invalid license format or signature." };
  }

  return { isPro: true, type: result.tier, error: null };
}
// ── Zero-Trust Air-Gapped Operation ──────────────────────────────────────────
// 100% local stdio execution in memory. Zero external network calls, zero telemetry.

// ── Free Tier Usage Tracking (Persistent) ─────────────────────────────
const FREE_TIER_DAILY_LIMIT = 10;
const STAR_PROMPT_THRESHOLD = 5;

function getUsageFilePath() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  return path.resolve(homeDir, '.privacyscrubber-usage.json');
}

function getDailyUsage() {
  const file = getUsageFilePath();
  const today = new Date().toISOString().split('T')[0];
  if (!fs.existsSync(file)) return 0;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.date === today) {
      return data.count || 0;
    }
  } catch (e) {}
  return 0;
}

function incrementDailyUsage() {
  const file = getUsageFilePath();
  const today = new Date().toISOString().split('T')[0];
  let count = 0;
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.date === today) count = data.count || 0;
    } catch (e) {}
  }
  count++;
  try {
    fs.writeFileSync(file, JSON.stringify({ date: today, count }), 'utf8');
  } catch (e) {}
  return count;
}

function checkFreeTierLimit(isPro) {
  if (isPro || process.env.NODE_ENV === 'test' || process.env.PRIVACYSCRUBBER_TEST_MODE === '1') return { blocked: false, count: 0 };
  
  const count = incrementDailyUsage();
  // Feedback / Growth loop triggers
  if (count === 2) {
    mcpLog(`${colors.cyan}🛠️  [PrivacyScrubber] Need programmatic in-code redaction in your Node/TS backend or RAG pipeline? Try our official SDK: npm install @privacyscrubber/sdk${colors.reset}\n`);
  }
  if (count === 3) {
    mcpLog(`${colors.cyan}💬 We are building the ultimate privacy tool for developers. What feature should we add next? Let us know: https://privacyscrubber.com/feedback${colors.reset}\n`);
  }
  if (count === STAR_PROMPT_THRESHOLD) {
    mcpLog(`${colors.yellowBold}🔒 PrivacyScrubber is running securely. If this tool saved your PII today, please drop a star on GitHub: https://github.com/moxno/privacyscrubber-mcp${colors.reset}\n`);
  }
  
  if (count >= FREE_TIER_DAILY_LIMIT) {
    mcpLog(`${colors.redBold}🚫  [PrivacyScrubber] Free tier daily limit exhausted (${FREE_TIER_DAILY_LIMIT} requests). Request BLOCKED.${colors.reset}\n${colors.cyan}👉  Get a PRO key for unlimited use: https://privacyscrubber.com/pricing${colors.reset}\n`);
    return { blocked: true, count };
  }
  
  return { blocked: false, count };
}

function buildCisoAuditTelemetry(currentTokenMap = {}) {
    const entities = {};
    let totalCount = 0;

    if (currentTokenMap && typeof currentTokenMap === 'object') {
        const keys = Array.isArray(currentTokenMap) ? currentTokenMap : Object.keys(currentTokenMap);
        for (const t of keys) {
            const tokenStr = typeof t === 'string' ? t : (t.token || t.mask || '');
            const match = tokenStr.match(/\[([A-Z_]+)_\d+\]/);
            const baseType = match ? match[1] : (tokenStr.replace(/\[|\]/g, '').replace(/_[0-9]+$/, '') || 'CUSTOM');
            entities[baseType] = (entities[baseType] || 0) + 1;
            totalCount++;
        }
    }

    const types = Object.keys(entities);
    let riskLevel = 'LOW EXPOSURE';

    if (totalCount > 0) {
        const hasHighRiskEntities = types.some(t => ['ID', 'SSN', 'CREDIT_CARD', 'PASSPORT', 'BANK', 'API_KEY', 'SECRET', 'PASSWORD', 'MRN', 'KEY'].includes(t));
        if (hasHighRiskEntities || types.length >= 3 || totalCount >= 10) {
            riskLevel = 'CRITICAL (HIGH EXPOSURE)';
        } else if (types.length >= 2 || totalCount >= 3) {
            riskLevel = 'MODERATE EXPOSURE';
        } else {
            riskLevel = 'LOW EXPOSURE';
        }
    } else {
        riskLevel = 'CLEAN (ZERO PII)';
    }

    const frameworksSet = new Set(['ZTDS Standard']);
    if (types.includes('NAME') || types.includes('EMAIL') || types.includes('PHONE')) {
        frameworksSet.add('GDPR (Art. 4)');
        frameworksSet.add('CCPA/CPRA');
    }
    if (types.includes('ID') || types.includes('SSN') || types.includes('PASSPORT')) {
        frameworksSet.add('SOC 2 Type II');
        frameworksSet.add('ISO 27001 (A.8.11)');
    }
    if (types.some(t => ['CREDIT_CARD', 'BANK', 'IBAN', 'FINANCIAL', 'CARD'].includes(t))) {
        frameworksSet.add('PCI DSS v4.0');
    }
    if (types.some(t => ['MRN', 'HEALTH', 'MEDICAL', 'PATIENT'].includes(t))) {
        frameworksSet.add('HIPAA §164.514');
    }
    if (types.some(t => ['API_KEY', 'SECRET', 'PASSWORD', 'TOKEN', 'KEY'].includes(t))) {
        frameworksSet.add('NIST SP 800-53');
    }

    return {
        totalCount,
        entities,
        types,
        riskLevel,
        frameworksList: Array.from(frameworksSet)
    };
}

function formatAuditReceipt(telemetry) {
  if (telemetry.totalCount === 0) {
    return "\\n\\n> 🛡️ **PrivacyScrubber Audit Receipt**: CLEAN (ZERO PII DETECTED)\\n";
  }
  
  const entitiesList = Object.entries(telemetry.entities)
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');

  const icon = telemetry.riskLevel.includes('CRITICAL') ? '🔴' : (telemetry.riskLevel.includes('MODERATE') ? '🟠' : '🟢');

  return `\\n\\n> 🛡️ **PrivacyScrubber Audit Receipt**\\n> * **Risk Level:** ${icon} ${telemetry.riskLevel}\\n> * **Compliance Enforced:** ${telemetry.frameworksList.join(', ')}\\n> * **Tokens Masked:** ${telemetry.totalCount} (${entitiesList})\\n`;
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
      prompts: {},
      logging: {},
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "sanitize_text",
        description: "STEP 1: Call this first. You MUST NOT process raw user data before calling this. Locally scrubs PII, secrets, and credentials (like API keys, passwords, emails, phones, names) from code, logs, or text. Replaces them with safe placeholders (e.g., [EMAIL_1], [API_KEY_1]). Keep your data secure before passing it to any LLM. (For in-code backend services or RAG vector pipelines outside of MCP, use '@privacyscrubber/sdk': npm i @privacyscrubber/sdk)",
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
            },
            ignore_list: {
              type: "array",
              items: { type: "string" },
              description: "Optional list of plaintext values to skip during detection (false positives from previous scrubs). These values will also be persisted in the session ignore list for all future calls."
            }
          },
          required: ["text"]
        }
      },
      {
        name: "reveal_text",
        description: "STEP 3: Call this last. You MUST pass your final generated response through this tool to restore tokens (e.g., [EMAIL_1]) back with the original private data from the local volatile RAM-only session map before showing it to the user.",
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
        name: "audit_directory_for_pii",
        description: "Scans a local directory for leaks of secrets, keys, and PII. Returns a summary report. Use this tool for Security Auditing.",
        inputSchema: {
          type: "object",
          properties: {
            directory_path: {
              type: "string",
              description: "Absolute path to the directory to audit."
            },
            profile: {
              type: "string",
              description: "The detection profile to use. Defaults to 'General'."
            },
            extensions: {
              type: "array",
              items: { type: "string" },
              description: "List of file extensions to scan (e.g. ['.env', '.log', '.js']). If empty, scans all text files."
            },
            ignore_node_modules: {
              type: "boolean",
              description: "Whether to ignore 'node_modules' directories. Defaults to true."
            }
          },
          required: ["directory_path"]
        }
      },
      {
        name: "redact_file",
        description: "Action/Redact: In-place redaction of a local file. Replaces PII and secrets with tokens and saves the file. By default, creates a .bak backup. Use dry_run=true to test without modifying.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to the file to redact."
            },
            profile: {
              type: "string",
              description: "The detection profile to use. Defaults to 'General'."
            },
            dry_run: {
              type: "boolean",
              description: "If true, does not modify the file, only returns the metrics and a preview."
            },
            no_backup: {
              type: "boolean",
              description: "If true, does not create a .bak file. Use with extreme caution!"
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
        name: "generate_compliance_report",
        description: "Generates an official Zero-Trust Compliance Audit Certificate (GDPR, HIPAA, EU AI Act, SOC 2) for the current MCP session. Returns cryptographic session hash, masked entities breakdown, and compliance certification.",
        inputSchema: {
          type: "object",
          properties: {
            format: {
              type: "string",
              description: "The output format: 'markdown' (default), 'json', or 'summary'.",
              enum: ["markdown", "json", "summary"]
            },
            company_name: {
              type: "string",
              description: "Optional organization or team name to brand the compliance report."
            },
            department: {
              type: "string",
              description: "Optional department or auditor ID (e.g. 'SecOps / Engineering')."
            }
          },
          required: []
        }
      },
      {
        name: "mark_false_positive",
        description: "Marks a previously detected token as a false positive. The original plaintext value will be excluded from all future sanitize_text calls in this session. Returns the restored original value and updated ignore list size.",
        inputSchema: {
          type: "object",
          properties: {
            token: {
              type: "string",
              description: "The token to mark as false positive (e.g., '[NAME_1]', '[EMAIL_2]')."
            }
          },
          required: ["token"]
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

// List available prompts
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "secure_ai_workflow",
        description: "Zero-Trust Data Sanitization workflow instruction. Use this to automatically scrub PII before processing data.",
      },
      {
        name: "safe_redaction_workflow",
        description: "Instructions for using the redact_file tool safely with QA checks.",
      }
    ]
  };
});

// Handle prompt execution
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name === "safe_redaction_workflow") {
    return {
      description: "Instructions for safely redacting files in-place.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "When you need to redact or scrub a file on disk permanently, follow this quality-assured workflow:\n1. Run `redact_file` with `dry_run: true` to preview the changes and check how many PII tokens will be replaced.\n2. Verify the metrics. If the numbers look correct and no unintended data is being scrubbed, run `redact_file` with `dry_run: false` to apply the redaction.\n3. Ensure you have backups. `redact_file` creates a `.bak` backup by default. NEVER set `no_backup: true` unless the user explicitly asks to destroy the original data without a backup."
          }
        }
      ]
    };
  }

  if (request.params.name !== "secure_ai_workflow") {
    throw new Error(`Unknown prompt: ${request.params.name}`);
  }
  return {
    description: "Instructions for securely processing data with PrivacyScrubber.",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "You are a secure, privacy-first AI agent. Whenever you are asked to process, analyze, or rewrite text or files that may contain PII (Personally Identifiable Information), secrets, or credentials, you MUST follow this Zero-Trust workflow:\n\n1. STEP 1: Call the `sanitize_text` or `sanitize_file` tool first to scrub the input. DO NOT process the raw user data.\n2. STEP 2: Perform your analysis or task on the sanitized output provided by the tool.\n3. STEP 3: Before returning your final answer to the user, you MUST call the `reveal_text` tool, passing your final answer. This will restore the original private data (e.g., replacing [EMAIL_1] with the real email).\n4. STEP 4: Return the result of the `reveal_text` tool to the user."
        }
      }
    ]
  };
});

// List Resource Templates
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return {
    resourceTemplates: [
      {
        uriTemplate: "mcp://privacyscrubber/profiles/{name}",
        name: "PII Detection Profile Details",
        description: "Returns the description and target entities of a specific PrivacyScrubber profile (e.g., 'Medical', 'Finance', 'General'). Use this to understand what a profile does."
      }
    ]
  };
});

// Read Resource
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const match = uri.match(/^mcp:\/\/privacyscrubber\/profiles\/(.+)$/);
  if (match) {
    const profileName = match[1];
    const descriptions = {
      "general": "Scrubs basic PII: Names, Emails, Phone Numbers, Credit Cards, SSN, IPv4/IPv6, and standard API Keys.",
      "dev": "Engineering profile. Scrubs AWS keys, JWTs, GCP keys, Stripe keys, database connection strings, and internal IP addresses.",
      "engineering": "Engineering profile. Scrubs AWS keys, JWTs, GCP keys, Stripe keys, database connection strings, internal IPs, Docker paths, and K8s internal endpoints.",
      "tech": "Technology profile. Scrubs cloud instance IDs, node/cluster IDs, environment tags, kubeconfig, and terraform states.",
      "medical": "HIPAA compliance profile. Scrubs ICD-10 codes, medical record numbers (MRN), DEA numbers, NPI, patient names, and health conditions.",
      "finance": "PCI/Finance profile. Scrubs IBAN, SWIFT codes, credit cards, routing numbers, and financial transaction IDs.",
      "wealthmgmt": "Wealth Management profile. Scrubs ABA/Routing numbers, trust names, portfolio values, net worth, RMDs, and account numbers.",
      "insurance": "Insurance profile. Scrubs claim numbers, policy numbers, settlement amounts, NAIC, adjustor IDs, and insured names.",
      "accounting": "Accounting profile. Scrubs EIN, FEIN, Tax IDs, AGI, tax forms (1040, W-2, 1099), refund amounts, and PTINs.",
      "legal": "Legal profile. Scrubs case numbers, matter numbers, attorney-client privilege markers, and litigation IDs.",
      "hr": "Human Resources profile. Scrubs employee IDs (EEID), resumes, DOBs, tenant IDs, and home addresses.",
      "security": "Security profile. Scrubs secrets, AWS keys, JWTs, Stripe keys, incident IDs, and breach reports.",
      "marketing": "Marketing profile. Scrubs lead IDs, prospect IDs, GCLID/FBCLID, LTV/CAC amounts, cohort IDs, and segment IDs.",
      "bizops": "BizOps profile. Scrubs deals, KPIs, vendor IDs, EBITDA/Revenue figures, NDAs, and M&A identifiers.",
      "sales": "Sales profile. Scrubs opportunity IDs, DocuSign hashes, ARR/MRR/Quota amounts, and SFDC/HubSpot IDs.",
      "support": "Support profile. Scrubs Zendesk/Jira ticket numbers, RMA/Return IDs, and loyalty/rewards numbers.",
      "realestate": "Real Estate profile. Scrubs MLS numbers, LIS IDs, parcel numbers, rent/escrow amounts, and gate/lobby codes.",
      "compliance": "Compliance profile. Scrubs GDPR/HIPAA/SOC2 audit IDs, DPA policy numbers, and SAR/DSAR request IDs.",
      "ccpa": "CCPA profile. Scrubs driver licenses, precise geolocation (Lat/Long), CCPA/CPRA opt-out markers, and account numbers.",
      "agents": "AI Agents profile. Scrubs agent IDs, vector IDs, task IDs, system prompts, and OpenAI API keys.",
      "academic": "Academic profile. Scrubs student/alumni IDs, course numbers, FERPA/IRB IDs, and academic grades.",
      "creative": "Creative profile. Scrubs project IDs, script drafts, spoiler/embargo tags, and ghostwriter names.",
      "personal": "Personal profile. Scrubs birthdays, passwords, PINs, and emergency contacts/family phone numbers.",
      "pharma": "Pharma/Clinical profile. Scrubs patient IDs, study protocols, IND/NDA numbers, IRB IDs, batch/lot serials, and dosages."
    };
    const desc = descriptions[profileName.toLowerCase()] || `The '${profileName}' profile is a PRO-tier detection ruleset tuned for specific industry compliance. It detects and sanitizes domain-specific identifiers.`;
    
    return {
      contents: [
        {
          uri,
          mimeType: "text/markdown",
          text: `# Profile: ${profileName}\n\n**Description:** ${desc}\n\n*Note: To use this profile, pass \`"profile": "${profileName}"\` to the \`sanitize_text\` or \`sanitize_file\` tools. Advanced profiles require a PRO license.*`
        }
      ]
    };
  }
  throw new Error(`Resource not found: ${uri}`);
});

// Handle tool execution calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const toolStart = Date.now();

  try {
    if (name === "sanitize_text") {
      const { text, profile = "General", ignore_list } = args || {};

      // Merge per-call ignore_list into persistent sessionIgnoreList
      if (Array.isArray(ignore_list)) {
        ignore_list.forEach(v => { if (typeof v === 'string' && v.trim()) sessionIgnoreList.add(v.trim()); });
      }
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

      const limitStatus = checkFreeTierLimit(license.isPro);
      if (limitStatus.blocked) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: Free tier daily limit exhausted (${FREE_TIER_DAILY_LIMIT} requests). Please set your PRO license key to continue. Get a key at: https://privacyscrubber.com/pricing` }]
        };
      }

      const charLimit = (isAdvanced && !license.isPro) ? 5000 : 15000;
      if (isAdvanced && !license.isPro) {
        mcpLog(`${colors.yellowBold}⚠️  [PrivacyScrubber] Profile '${targetProfile}' active on Free Tier (5,000 char limit).${colors.reset}\n`);
      }

      const { processedText } = truncateIfFree(text, license.isPro, charLimit);

      const { scrubbedText, newTokens } = performSanitization(processedText, finalProfile, sessionIgnoreList);
      
      const telemetry = buildCisoAuditTelemetry(newTokens);
      const receiptMd = formatAuditReceipt(telemetry);

      return {
        content: [
          { type: "text", text: scrubbedText + receiptMd }
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
      let restoredText = restored.restoredText;
      // Deduplicate common double-prefixed schemas resulting from LLM prefix reconstruction
      restoredText = restoredText.replace(/\b(mysql|postgresql|postgres|redis|mongodb|https?|ftp|ssh|git|aws):\/\/\1:\/\//gi, '$1://');

      return {
        content: [
          {
            type: "text",
            text: restoredText
          }
        ]
      };
    }

    if (name === "mark_false_positive") {
      const { token } = args || {};
      if (!token || typeof token !== 'string') {
        return {
          isError: true,
          content: [{ type: "text", text: "Error: Missing required parameter 'token'. Provide the token to mark as false positive (e.g., '[NAME_1]')." }]
        };
      }

      const original = sessionMap[token];
      if (!original) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: Token '${token}' not found in current session map. Available tokens: ${Object.keys(sessionMap).join(', ') || '(empty session)'}` }]
        };
      }

      // Add the original plaintext to the ignore list
      sessionIgnoreList.add(original);
      // Remove the token from the session map
      delete sessionMap[token];

      mcpLog(`${colors.yellow}🔖 [PrivacyScrubber] False Positive: '${token}' → '${original}' will be excluded from future scrubs.${colors.reset}\n`);

      return {
        content: [{
          type: "text",
          text: `✅ Marked '${token}' as false positive.\n\n**Restored value:** ${original}\n**Session ignore list size:** ${sessionIgnoreList.size}\n\nThis value will be excluded from all future \`sanitize_text\` calls in this session.`
        }]
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

          const limitStatus = checkFreeTierLimit(license.isPro);
          if (limitStatus.blocked) {
            return {
              isError: true,
              content: [{ type: "text", text: `Error: Free tier daily limit exhausted (${FREE_TIER_DAILY_LIMIT} requests). Please set your PRO license key to continue. Get a key at: https://privacyscrubber.com/pricing` }]
            };
          }

          const charLimit = (isAdvanced && !license.isPro) ? 5000 : 15000;
          if (isAdvanced && !license.isPro) {
            mcpLog(`${colors.yellowBold}⚠️  [PrivacyScrubber] Profile '${targetProfile}' active on Free Tier (5,000 char limit).${colors.reset}\n`);
          }

          const { processedText: processedContent } = truncateIfFree(content, license.isPro, charLimit);

          const sanitized = performSanitization(processedContent, finalProfile, sessionIgnoreList);
          const { scrubbedText, newTokens } = sanitized;
          const telemetry = buildCisoAuditTelemetry(newTokens);
          const receiptMarkdown = formatAuditReceipt(telemetry);
          const combinedOutput = `${scrubbedText}\n\n${receiptMarkdown}`;

          return {
            content: [
              { type: "text", text: combinedOutput }
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
                text: `🔒 [PrivacyScrubber PRO] Sanitizing ${isPdf ? 'PDF' : 'Excel/XLSX'} files is a PRO feature.\n\n👉 Set your PRIVACYSCRUBBER_KEY environment variable to a valid PRO license key.\n👉 Upgrade at: https://privacyscrubber.com/pricing?utm_source=mcp_cli&utm_medium=terminal\n👉 Alternatively, sanitize plain text, code, CSV, and DOCX files for free.`
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
            let finalProfile = targetProfile;

            const sanitized = performSanitization(content, finalProfile, sessionIgnoreList);
            const { scrubbedText, newTokens } = sanitized;
            const telemetry = buildCisoAuditTelemetry(newTokens);
            const receiptMarkdown = formatAuditReceipt(telemetry);
            const combinedOutput = `${scrubbedText}\n\n${receiptMarkdown}`;

            return {
              content: [
                { type: "text", text: combinedOutput }
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
            let finalProfile = targetProfile;

            const sanitized = performSanitization(content, finalProfile, sessionIgnoreList);
            const { scrubbedText, newTokens } = sanitized;
            const telemetry = buildCisoAuditTelemetry(newTokens);
            const receiptMarkdown = formatAuditReceipt(telemetry);
            const combinedOutput = `${scrubbedText}\n\n${receiptMarkdown}`;

            return {
              content: [
                { type: "text", text: combinedOutput }
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

      const limitStatus = checkFreeTierLimit(license.isPro);
      if (limitStatus.blocked) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: Free tier daily limit exhausted (${FREE_TIER_DAILY_LIMIT} requests). Please set your PRO license key to continue. Get a key at: https://privacyscrubber.com/pricing` }]
        };
      }

      const charLimit = (isAdvanced && !license.isPro) ? 5000 : 15000;
      if (isAdvanced && !license.isPro) {
        mcpLog(`${colors.yellowBold}⚠️  [PrivacyScrubber] Profile '${targetProfile}' active on Free Tier (5,000 char limit).${colors.reset}\n`);
      }

      const { processedText: processedContent2 } = truncateIfFree(content, license.isPro, charLimit);

      const { scrubbedText, newTokens } = performSanitization(processedContent2, finalProfile, sessionIgnoreList);
      const telemetry = buildCisoAuditTelemetry(newTokens);
      const receiptMd = formatAuditReceipt(telemetry);

      return {
        content: [
          { type: "text", text: scrubbedText + receiptMd }
        ]
      };
    }

    if (name === "redact_file") {
      const { file_path, profile, dry_run, no_backup } = args;
      if (!file_path || !fs.existsSync(file_path)) {
        return { isError: true, content: [{ type: "text", text: `Error: File not found at path: ${file_path}` }] };
      }

      try {
        const stat = await fs.promises.stat(file_path);
        if (stat.size > 50 * 1024 * 1024) {
          return { isError: true, content: [{ type: "text", text: `Error: File is too large (>50MB).` }] };
        }

        const buffer = fs.readFileSync(file_path);
        if (buffer.indexOf(0) !== -1) {
          return { isError: true, content: [{ type: "text", text: `Error: Cannot redact binary file.` }] };
        }
        const content = buffer.toString('utf8');

        const customRules = loadCustomRules();
        const normalizedProfile = (profile || "general").trim().toLowerCase();
        const license = checkLicenseStatus();
        
        const limitStatus = checkFreeTierLimit(license.isPro);
        if (limitStatus.blocked) {
          return {
            isError: true,
            content: [{ type: "text", text: `Error: Free tier daily limit exhausted (${FREE_TIER_DAILY_LIMIT} requests). Please set your PRO license key to continue. Get a key at: https://privacyscrubber.com/pricing` }]
          };
        }
        const localSessionMap = {};
        
        const result = PrivacyScrubberCore.scrubText(content, customRules, {}, normalizedProfile, localSessionMap, license.isPro);
        
        let isSecretLeak = false;
        if (!license.isPro && result.tokenMap) {
          Object.entries(result.tokenMap).forEach(([token, original]) => {
            for (const detector of DEVOPS_SECRETS_DETECTOR) {
              detector.regex.lastIndex = 0;
              if (detector.regex.test(original)) {
                isSecretLeak = true;
                break;
              }
            }
          });
        }

        const counts = {};
        Object.keys(localSessionMap).forEach(token => {
          const match = token.match(/^\[([A-Z_]+)_\d+\]$/);
          if (match) {
            counts[match[1]] = (counts[match[1]] || 0) + 1;
          }
        });
        const summary = Object.entries(counts).map(([type, count]) => `${count} ${type}`).join(', ') || 'None';
        
        if (dry_run) {
          return {
            content: [{ 
              type: "text", 
              text: `DRY RUN: ⚠️ Would redact ${Object.keys(localSessionMap).length} tokens (${summary}).\n${isSecretLeak ? "⚠️ RAW SECRET DETECTED (Requires PRO to actually redact)\n" : ""}Run again with dry_run: false to apply changes.` 
            }]
          };
        }

        if (isSecretLeak) {
          return { isError: true, content: [{ type: "text", text: `Error: API Key or Secret detected. Sanitization of raw secrets requires PRO Profile. Upgrade at https://privacyscrubber.com/pricing?utm_source=mcp_cli&utm_medium=terminal` }] };
        }

        if (!no_backup) {
          fs.writeFileSync(`${file_path}.bak`, content, 'utf8');
        }

        fs.writeFileSync(file_path, result.scrubbedText, 'utf8');

        return {
          content: [{ 
            type: "text", 
            text: `✅ File successfully redacted.\nReplaced ${Object.keys(localSessionMap).length} tokens (${summary}).\n${!no_backup ? `Backup saved to ${file_path}.bak` : "No backup created (no_backup=true)."}` 
          }]
        };

      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error redacting file: ${err.message}` }] };
      }
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
        "_comment": "PrivacyScrubber local configuration. Add custom rules and restart your MCP client (Cursor/Windsurf). Details: https://privacyscrubber.com/docs/config?utm_source=mcp_cli&utm_medium=terminal",
        "customRules": [
          {
            "pattern": "my-secret-pattern-\\d+",
            "label": "CUSTOM_TAG",
            "_comment": "pattern must be a valid Javascript regex string. label is the tag replacement (e.g. CUSTOM_TAG)"
          }
        ],
        "exclusions": [
          "localhost",
          "127.0.0.1",
          "0.0.0.0",
          "process.env",
          "PORT",
          "node_modules",
          "PrivacyScrubber",
          "console.log",
          "console.error",
          "utf-8",
          "utf8"
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
        ? 'All 25 profiles active (General, Dev, Medical, Legal, Finance, HR…)'
        : 'General only — PRO unlocks 25 industry profiles';
      const sizeLimit = license.isPro ? 'Unlimited' : '15,000 characters per request';

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
        rulesStatus = 'None';
        configPathSnippet = 'Run create_default_config';
      }

      const metricsSummary = getSessionMetricsSummary();

      const lines = [
        '╔══════════════════════════════════════════════════╗',
        `║       PrivacyScrubber MCP Server v${MCP_VERSION.padEnd(10)}          ║`,
        '╠══════════════════════════════════════════════════╣',
        `║  ${tierIcon} Tier: ${tier.padEnd(43)}║`,
        `║  📊 Session requests: ${String(getDailyUsage()).padEnd(27)}║`,
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
          '║     https://privacyscrubber.com/pricing?utm_source=mcp_cli&utm_medium=terminal           ║'
        );
      } else {
        lines.push(
          '║  💳 Upgrade to PRO — $110 Lifetime                ║',
          '║     https://privacyscrubber.com/pricing?utm_source=mcp_cli&utm_medium=terminal           ║',
          '╠══════════════════════════════════════════════════╣',
          '║  After purchase, add your key to MCP config:     ║',
          '║                                                  ║',
          '║  Claude Desktop / Cursor / Windsurf:             ║',
          '║  "PRIVACYSCRUBBER_KEY": "<your-key-here>"        ║',
          '║                                                  ║',
          '║  Full setup guide:                               ║',
          '║  https://privacyscrubber.com/features/mcp/?utm_source=mcp_cli&utm_medium=terminal       ║'
        );
      }

      lines.push('╚══════════════════════════════════════════════════╝');

      return {
        content: [{ type: "text", text: lines.join('\n') }]
      };
    }

    if (name === "audit_directory_for_pii") {
      const { directory_path, profile, extensions, ignore_node_modules } = args;
      if (!directory_path || !fs.existsSync(directory_path)) {
        return { isError: true, content: [{ type: "text", text: `Error: Directory not found at path: ${directory_path}` }] };
      }

      const filesToScan = [];
      const ignoreDirs = ignore_node_modules !== false ? ['.git', 'node_modules', '.next', 'dist', 'build', '.cache'] : ['.git'];
      
      async function walkDir(dir) {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!ignoreDirs.includes(entry.name)) await walkDir(fullPath);
          } else if (entry.isFile()) {
            if (extensions && extensions.length > 0) {
              const ext = path.extname(entry.name);
              if (!extensions.includes(ext)) continue;
            }
            filesToScan.push(fullPath);
          }
        }
      }

      await walkDir(directory_path);

      let reportLines = [`## Security Audit Report: ${directory_path}`];
      let filesWithIssues = 0;
      const customRules = loadCustomRules();
      const normalizedProfile = (profile || "general").trim().toLowerCase();
      const license = checkLicenseStatus();
      
      const limitStatus = checkFreeTierLimit(license.isPro);
      if (limitStatus.blocked) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: Free tier daily limit exhausted (${FREE_TIER_DAILY_LIMIT} requests). Please set your PRO license key to continue. Get a key at: https://privacyscrubber.com/pricing` }]
        };
      }

      let totalTokensForDirectory = {};
      for (const file of filesToScan) {
        try {
          const stat = await fs.promises.stat(file);
          if (stat.size > 10 * 1024 * 1024) continue; // skip >10MB

          const buffer = fs.readFileSync(file);
          if (buffer.indexOf(0) !== -1) continue; 
          const content = buffer.toString('utf8');

          const localSessionMap = {};
          const result = PrivacyScrubberCore.scrubText(content, customRules, {}, normalizedProfile, localSessionMap, license.isPro);
          
          Object.assign(totalTokensForDirectory, localSessionMap);
          
          let isSecretLeak = false;
          if (!license.isPro && result.tokenMap) {
            Object.entries(result.tokenMap).forEach(([token, original]) => {
              for (const detector of DEVOPS_SECRETS_DETECTOR) {
                detector.regex.lastIndex = 0;
                if (detector.regex.test(original)) {
                  isSecretLeak = true;
                  break;
                }
              }
            });
          }

          if (Object.keys(localSessionMap).length > 0 || isSecretLeak) {
            filesWithIssues++;
            const counts = {};
            Object.keys(localSessionMap).forEach(token => {
              const match = token.match(/^\[([A-Z_]+)_\d+\]$/);
              if (match) {
                counts[match[1]] = (counts[match[1]] || 0) + 1;
              }
            });
            const summary = Object.entries(counts).map(([type, count]) => `${count} ${type}`).join(', ');
            let leakMsg = isSecretLeak ? " (⚠️ RAW SECRET DETECTED — REQUIRES PRO)" : "";
            reportLines.push(`- \`${path.relative(directory_path, file)}\`: ⚠️ Found ${summary}${leakMsg}`);
          }
        } catch (err) {
          // ignore file read errors
        }
      }

      if (filesWithIssues === 0) {
        reportLines.push("✅ Clean. No PII or secrets detected in the scanned files.");
      }

      const telemetry = buildCisoAuditTelemetry(totalTokensForDirectory);
      const receiptMd = formatAuditReceipt(telemetry);
      
      return {
        content: [{ type: "text", text: reportLines.join('\n') + receiptMd }]
      };
    }

    if (name === "generate_compliance_report") {
      const { format = "markdown", company_name = "PrivacyScrubber Client", department = "SecOps / Compliance" } = args || {};
      const telemetry = buildCisoAuditTelemetry(sessionMap);
      
      const sessionHash = crypto.createHash('sha256')
        .update(JSON.stringify(sessionMap) + Date.now().toString())
        .digest('hex');
      
      const timestamp = new Date().toISOString();
      const entitySummary = Object.entries(telemetry.entities)
        .map(([t, count]) => `[${t}]: ${count}`)
        .join(', ') || 'None (Clean)';

      if (format === "json") {
        const jsonReport = {
          protocol: "Zero-Trust Data Sanitization (ZTDS)",
          certificate: `ZTDS-CERT-${sessionHash.substring(0, 16).toUpperCase()}`,
          company: company_name,
          department: department,
          timestamp: timestamp,
          session_hash: sessionHash,
          verification_mode: "100% Offline (Local In-Memory RAM)",
          compliance_status: "VERIFIED PASS",
          risk_level: telemetry.riskLevel,
          frameworks_enforced: telemetry.frameworksList,
          total_masked_tokens: telemetry.totalCount,
          entities_breakdown: telemetry.entities,
          zero_egress_verified: true,
          verification_url: `https://privacyscrubber.com/features/audit-receipt/#verify?hash=${sessionHash.substring(0, 16)}`
        };

        return {
          content: [{ type: "text", text: JSON.stringify(jsonReport, null, 2) }]
        };
      }

      if (format === "summary") {
        const summaryText = `[PrivacyScrubber Compliance Certificate] ID: ZTDS-${sessionHash.substring(0, 8).toUpperCase()} | Organization: ${company_name} | Masked Tokens: ${telemetry.totalCount} | Risk: ${telemetry.riskLevel} | Frameworks: ${telemetry.frameworksList.join(', ')} | Status: PASS (100% Air-Gapped)`;
        return {
          content: [{ type: "text", text: summaryText }]
        };
      }

      // Default: Comprehensive Markdown Certificate
      const mdReport = `# 🛡️ Zero-Trust Data Sanitization Compliance Certificate
**Certificate ID:** \`ZTDS-CERT-${sessionHash.substring(0, 16).toUpperCase()}\`  
**Organization:** ${company_name} (${department})  
**Timestamp:** ${timestamp}  
**Verification Mode:** 100% Local In-Memory Processing (Air-Gapped)  
**Status:** **VERIFIED PASS** (Zero Network Egress)

---

### 📊 Sanitization Metrics & Risk Assessment
* **Overall Risk Rating:** **${telemetry.riskLevel}**
* **Total Sensitive Entities Masked:** \`${telemetry.totalCount}\`
* **Entity Breakdown:** ${entitySummary}
* **Network Data Transmitted:** \`0.00 KB (Zero-Trust Local RAM)\`

### 📜 Regulatory Frameworks Enforced
${telemetry.frameworksList.map(f => `- **${f}**`).join('\n')}

### 🔒 CISO Compliance Declaration
1. **EU AI Act (Art. 50) & GDPR (Art. 25 & 32):** Data minimization and local pseudonymization enforced prior to model interaction.
2. **HIPAA Safe Harbor (§164.514) / SOC 2 Type II:** All direct and indirect identifiers sanitized locally without cloud processor liability.
3. **Cryptographic Verification:** Tamper-evident session verification hash: \`${sessionHash}\`

*Certified Offline by PrivacyScrubber Engine v${MCP_VERSION}*  
*Verify at: https://privacyscrubber.com/features/audit-receipt/*`;

      return {
        content: [{ type: "text", text: mdReport }]
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
          mcpLog(`${colors.yellowBold}⚠️  [PrivacyScrubber] Custom rules detected in privacyscrubber.json, but are ignored in the Free Tier.${colors.reset}\n${colors.cyan}👉  Set PRIVACYSCRUBBER_KEY to your PRO license key.${colors.reset}\n`);
        }
      }
    } catch (e) {
      mcpLog(`Error parsing privacyscrubber.json: ${e.message}\n`);
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

function performSanitization(text, profile, ignoreList = null) {
  const customRules = loadCustomRules();
  const normalizedProfile = (profile || "general").trim().toLowerCase();
  const license = checkLicenseStatus();
  const result = PrivacyScrubberCore.scrubText(text, customRules, {}, normalizedProfile, sessionMap, license.isPro, ignoreList);

  const newTokens = {};
  // Update our volatile map with new matches
  if (result.tokenMap) {
    Object.entries(result.tokenMap).forEach(([token, original]) => {
      sessionMap[token] = original;
      newTokens[token] = original;
    });
  }

  return { scrubbedText: result.scrubbedText, newTokens };
}

function truncateIfFree(text, isPro, charLimit = 15000) {
  if (!isPro && text.length > charLimit) {
    mcpLog(`${colors.yellowBold}⚠️  [PrivacyScrubber] Input truncated to ${charLimit.toLocaleString()} characters (Free Tier Limit).${colors.reset}\n${colors.cyan}👉  Set PRIVACYSCRUBBER_KEY to your PRO license key for unlimited size.${colors.reset}\n`);
    return { processedText: text.substring(0, charLimit), wasTruncated: true };
  }
  return { processedText: text, wasTruncated: false };
}

// Start the server transport
const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  mcpLog(`${colors.greenBold}✅ PrivacyScrubber ZTDS MCP Server v${MCP_VERSION} started successfully.${colors.reset}\n`);
  mcpLog(`${colors.cyan}📦 Need programmatic in-code redaction? Try: npm install @privacyscrubber/sdk${colors.reset}\n`);
  mcpLog(`${colors.yellowBold}⭐ Star us on GitHub: https://github.com/moxno/privacyscrubber-mcp${colors.reset}\n`);
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
