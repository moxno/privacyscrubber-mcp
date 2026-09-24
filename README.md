# @privacyscrubber/mcp-server

[![NPM Version](https://img.shields.io/npm/v/@privacyscrubber/mcp-server?color=blue)](https://www.npmjs.com/package/@privacyscrubber/mcp-server)
[![NPM Downloads](https://img.shields.io/npm/dm/@privacyscrubber/mcp-server?color=3b82f6)](https://www.npmjs.com/package/@privacyscrubber/mcp-server)
[![NPM SDK](https://img.shields.io/npm/v/@privacyscrubber/sdk?label=%40privacyscrubber%2Fsdk&color=10b981)](https://www.npmjs.com/package/@privacyscrubber/sdk)
[![Presidio Alternative](https://img.shields.io/badge/Presidio%20Alternative-Node.js%20%26%20TS-0078D4.svg)](https://www.npmjs.com/package/@privacyscrubber/sdk)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](https://www.npmjs.com/package/@privacyscrubber/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22058770.svg)](https://zenodo.org/records/22058770)
[![OSF DOI](https://img.shields.io/badge/OSF%20DOI-10.17605%2FOSF.IO%2F5BYJF-blue.svg)](https://osf.io/5byjf/)
[![SSRN](https://img.shields.io/badge/SSRN-7335581-darkred.svg)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7335581)
[![IETF Specification](https://img.shields.io/badge/IETF-ZTDS--Protocol-0284c7.svg)](https://datatracker.ietf.org/doc/draft-sibiryakov-ztds-protocol/)
[![smithery badge](https://smithery.ai/badge/privacyscrubber/pii-masking-mcp)](https://smithery.ai/servers/privacyscrubber/pii-masking-mcp)
[![Cursor Directory](https://img.shields.io/badge/Cursor%20Directory-Verified%20Plugin-000000.svg)](https://cursor.directory/plugins/privacyscrubber-mcp)
[![Glama.ai](https://glama.ai/mcp/servers/moxno/privacyscrubber-mcp/badge)](https://glama.ai/mcp/servers/moxno/privacyscrubber-mcp)
[![TensorBlock MCP Index](https://img.shields.io/badge/TensorBlock-Indexed%20MCP-FF6B6B.svg)](https://github.com/TensorBlock/awesome-mcp-servers)
[![There's An AI For That](https://img.shields.io/badge/There's_An_AI_For_That-Live-06b6d4.svg)](https://theresanaiforthat.com/ai/privacy-scrubber/)
[![Security: 100% Local](https://img.shields.io/badge/Security-100%25%20Local-emerald)](https://privacyscrubber.com)
[![Parity: 100% Core Match](https://img.shields.io/badge/Parity-100%25%20Core%20Match-blueviolet)](https://privacyscrubber.com)
[![Patent Pending](https://img.shields.io/badge/Patent-Pending%20(ILPO%20331905)-06b6d4.svg)](https://privacyscrubber.com/patents/)
[![GitHub Stars](https://img.shields.io/github/stars/moxno/privacyscrubber-mcp?style=social)](https://github.com/moxno/privacyscrubber-mcp)

**CISO-Approved Zero-Trust PII & Secrets Redaction MCP Server for Cursor, Windsurf, and Claude Desktop.**
Locally scrubs PII, secrets, credentials, and custom regex rules from files and text contexts before they reach remote LLM providers to prevent API leaks and ensure HIPAA/SOC 2 compliance at the developer endpoint.

---

## 🔒 Zero-Trust Data Flow

All sensitive parameters, identifiers, and variables are intercepted locally inside your machine's RAM. They are replaced by tokens (e.g. `[EMAIL_1]`) before being sent to the AI. Once the AI responds, the tokens are safely swapped back to original values in your local context.

```text
[Raw Input / Files] ──> [MCP sanitize_text] ──> [Masked Tokens] ──> [LLM API]
                               │                                       │
                        (In-Memory Map)                             (Result)
                               │                                       │
[Original Output] <─── [MCP reveal_text] <─────────────────────────────┘
```

---

## 🚀 Installation

### 1. Install via Smithery
To automatically configure and run with your preferred client, install using Smithery:
```bash
npx -y @smithery/cli install @privacyscrubber/mcp-server --write-to-clients
```

### 2. Instant Run with NPX
Run the server directly without local installation:
```bash
npx -y @privacyscrubber/mcp-server
```

### 3. Programmatic Node.js / TypeScript SDK (Lightweight Presidio Alternative)
Need direct, in-memory zero-trust PII sanitization in your backend microservice, Next.js app, or RAG vector pipeline rather than an MCP server? Use our official zero-dependency SDK:

```bash
npm install @privacyscrubber/sdk
```

```typescript
import OpenAI from 'openai';
import { wrapOpenAI } from '@privacyscrubber/sdk';

// Transparently masks PII before sending to LLM and rehydrates responses:
const openai = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

// Outbound prompt is sanitized in local RAM before leaving your machine:
// "Schedule a call with [NAME_1] at [EMAIL_1] regarding API key [AWS_KEY_1]."
const completion = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Schedule a call with Alice Smith at alice@acme.com with AKIAIOSFODNN7EXAMPLE.' }]
});

// Incoming LLM answer is automatically rehydrated with "Alice Smith (alice@acme.com)":
console.log(completion.choices[0].message.content);
```

#### ⚡ Why @privacyscrubber/sdk vs Microsoft Presidio?

Microsoft Presidio is the Python standard, but deploying it in a Node.js / TypeScript stack requires running heavy Python microservices, Docker containers, and 500MB+ spaCy NLP models with 35–120ms latency. `@privacyscrubber/sdk` runs **100% in-process with zero dependencies**:

| Feature / Metric | `@privacyscrubber/sdk` | Microsoft Presidio | AWS Comprehend / Google Cloud DLP |
| :--- | :--- | :--- | :--- |
| **Runtime & Dependencies** | **0 dependencies (~150KB)** | Python + Docker + spaCy (~500MB) | Heavy Cloud SDKs |
| **Execution Latency** | **Sub-millisecond in RAM (<1ms)** | 35–120ms HTTP/gRPC roundtrip | 180–400ms external cloud roundtrip |
| **Docker / Sidecar Needed** | **None (Pure in-process Node/WASM)** | Mandatory Docker container | VPC endpoints & IAM configurations |
| **Network Egress** | **0 Bytes (100% Air-gapped)** | Local internal network hop | Full unencrypted payload to cloud |
| **Data Loss & Reversibility** | **0 Loss (RAM-reversible via `restore()`)** | Manual token vault configuration | Irreversible masking / hashing |
| **OpenAI / LangChain 1-Liner** | **Built-in (`wrapOpenAI`, `wrapAiStream`)** | Complex custom pipeline glue | Custom proxy architecture |
| **DevOps Secrets Interception**| **Built-in (AWS, JWT, DB URIs, GitHub PAT)**| Custom regex recognizers needed | Cloud-specific classifiers |
| **Streaming Rehydration** | **Built-in (`wrapAiStream`, `TransformStream`)**| Buffering / chunk split failures | Not supported in real-time streams |

👉 [View @privacyscrubber/sdk on NPM](https://www.npmjs.com/package/@privacyscrubber/sdk) | Full documentation, Express middleware, LangChain transforms, and 25 compliance profiles.

#### 🛡️ Architecture & Security Deep-Dive (Zero-Trust vs Cloud DLP)

When AI IDEs (Cursor, Claude Desktop, Windsurf) connect to model providers, developer credentials, database connection strings, and internal customer PII are at continuous risk of prompt exfiltration. The `@privacyscrubber/mcp-server` enforces four immutable architectural guarantees:

1. **Stdio Air-Gapped Transport**:
   The MCP server communicates exclusively over local standard input/output (`stdio`) child processes spawned by your IDE. It opens **zero external listening ports** and initiates **zero remote network requests**.
2. **Volatile RAM-Only Token Map**:
   The mapping table between synthetic tokens (`[AWS_KEY_1]`, `[EMAIL_1]`) and raw cleartext is maintained exclusively in ephemeral node memory and is wiped the moment your IDE session closes.
3. **Deterministic AST Lookarounds vs Cloud Proxy Overhead**:
   Unlike cloud DLP gateways (Nightfall, Skyflow) that add 200–400ms latency and transmit unencrypted code to third parties, `@privacyscrubber/mcp-server` runs locally in <2ms with zero data egress.
4. **Permanent Standards & Academic Validation**:
   - **IETF Specification**: [draft-sibiryakov-ztds-protocol-01](https://datatracker.ietf.org/doc/draft-sibiryakov-ztds-protocol/) — Revision 01 · 2026-09-23 · 13 pages
   - **CERN / Zenodo Foundation**: [DOI 10.5281/zenodo.22058770](https://doi.org/10.5281/zenodo.22058770)
   - **Center for Open Science (OSF)**: [DOI 10.17605/OSF.IO/5BYJF](https://doi.org/10.17605/OSF.IO/5BYJF)
   - **Patent Pending**: Israel Patent Office Application `IL 331905` (WIPO DAS Code: `B17B`)

---

## ⚙️ Client Integrations

### Claude Desktop
Add this to your Claude Desktop config file:
*   **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
*   **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "privacyscrubber": {
      "command": "npx",
      "args": ["-y", "@privacyscrubber/mcp-server"],
      "env": {
        "PRIVACYSCRUBBER_KEY": "YOUR_OPTIONAL_PRO_LICENSE_KEY"
      }
    }
  }
}
```

### Cursor / Windsurf
1. Navigate to Settings -> Features -> MCP.
2. Add new MCP server:
    *   **Name:** `privacyscrubber`
    *   **Type:** `command`
    *   **Command:** `npx -y @privacyscrubber/mcp-server`
3. Optional: Set `PRIVACYSCRUBBER_KEY` as an environment variable in your system shell.

### Cline / Roo Code
Add to `cline_mcp_settings.json`:
```json
{
  "mcpServers": {
    "privacyscrubber": {
      "command": "npx",
      "args": ["-y", "@privacyscrubber/mcp-server"],
      "env": {
        "PRIVACYSCRUBBER_KEY": "YOUR_OPTIONAL_PRO_LICENSE_KEY"
      }
    }
  }
}
```

### Claude Code CLI
Add directly from your terminal:
```bash
claude mcp add privacyscrubber -- npx -y @privacyscrubber/mcp-server
```

---

## 🛠️ Provided Tools & JSON-RPC Specifications

### 1. `sanitize_text`
Redacts PII, secrets, API keys, and credentials from a text block and populates the volatile local replacement mapping.

*   **Arguments:**
    *   `text` (string, required): The raw content or logs to sanitize.
    *   `profile` (string, optional): Gated industry detection profile (e.g., 'General', 'Dev', 'Medical', 'Legal', 'Compliance'). Defaults to 'General'.
*   **JSON-RPC Call Example:**
    ```json
    {
      "method": "tools/call",
      "params": {
        "name": "sanitize_text",
        "arguments": {
          "text": "Contact me at dev-key-1234 or jane.doe@company.com",
          "profile": "General"
        }
      }
    }
    ```
*   **Response Example:**
    ```json
    {
      "content": [
        {
          "type": "text",
          "text": "Contact me at [SECRET_1] or [EMAIL_1]"
        }
      ]
    }
    ```

### 2. `reveal_text`
Detokenizes the AI response back to the original values locally.

*   **Arguments:**
    *   `text` (string, required): The response from the LLM containing tokenized placeholders.
*   **JSON-RPC Call Example:**
    ```json
    {
      "method": "tools/call",
      "params": {
        "name": "reveal_text",
        "arguments": {
          "text": "Please reach out to [EMAIL_1] regarding the update."
        }
      }
    }
    ```
*   **Response Example:**
    ```json
    {
      "content": [
        {
          "type": "text",
          "text": "Please reach out to jane.doe@company.com regarding the update."
        }
      ]
    }
    ```

### 3. `sanitize_file`
Reads a local file, extracts text, sanitizes it, and returns the redacted template for LLM analysis.
*   **Supported Formats:** Plain text (source code, logs, CSV, JSON, markdown) and Microsoft Word (`.docx`) documents.
*   **Arguments:**
    *   `filePath` (string, required): Absolute file path to read and sanitize.
    *   `profile` (string, optional): The industry detection profile.

### 4. `guard_exec` (Command Execution Firewall)
Safely executes terminal commands in an isolated child process, masking stdout/stderr PII, database credentials, and API keys in local RAM before passing them to the AI agent. Includes a CISO audit receipt in stderr.

*   **Arguments:**
    *   `command` (string, required): The shell command to execute (e.g. `cat .env`, `docker logs web`, `git diff`).
    *   `cwd` (string, optional): Working directory.
    *   `profile` (string, optional): Detection profile (defaults to `Dev`).
    *   `timeout_ms` (number, optional): Timeout in ms (defaults to `15000`).

### 5. `guard_read_file` (Credential-Masking File Reader)
Reads files (.env, configs, source code, database dumps) and tokenizes all passwords, JWTs, and PII in volatile memory, returning safe redacted content for AI reasoning.

*   **Arguments:**
    *   `file_path` (string, required): Path to file.
    *   `profile` (string, optional): Detection profile (defaults to `Dev`).
    *   `max_lines` (number, optional): Line cap for large files (defaults to `500`).

### 6. `guard_git_diff` (Pre-Commit & Diff Sanitizer)
Inspects staged (`--cached`) or unstaged repository diffs, redacting any newly introduced secrets or PII in local RAM before AI code review or commit message generation.

*   **Arguments:**
    *   `staged` (boolean, optional): If `true`, inspects staged changes (`git diff --cached`). Defaults to `false`.
    *   `cwd` (string, optional): Working directory.
    *   `profile` (string, optional): Detection profile (defaults to `Dev`).

### 7. `guard_apply_patch` (Safe Patch Applicator)
Reverses token placeholders (`[API_KEY_1]`, `[SECRET_1]`) in AI-generated code or text by looking up the local RAM session map, creating a `.bak` backup, and writing authentic cleartext directly to disk. The remote LLM never sees real secrets.

*   **Arguments:**
    *   `file_path` (string, required): Path to target file.
    *   `content` (string, required): Content containing tokens to restore on disk.
    *   `create_backup` (boolean, optional): Backup existing file before write (defaults to `true`).

### 8. `create_agent_rules` (1-Click Agent Rule Injection)
Automatically scaffolds CISO-grade Zero-Trust directives into `.cursorrules`, `.windsurfrules`, `CLAUDE.md`, `.github/copilot-instructions.md`, or `.clinerules`.

*   **Arguments:**
    *   `agent_types` (array, optional): `["all"]`, `["cursor"]`, `["windsurf"]`, `["claude_code"]`, `["copilot"]`, `["cline"]`. Defaults to `["all"]`.
    *   `workspace_dir` (string, optional): Workspace directory.

### 9. `check_status`

Returns a visual dashboard showing your current tier, session request count, active profiles, and upgrade instructions. Use it at any time to check your license status or get setup help.

*   **Arguments:** _(none required)_
*   **JSON-RPC Call Example:**
    ```json
    {
      "method": "tools/call",
      "params": { "name": "check_status", "arguments": {} }
    }
    ```
*   **Response Example (Free Tier):**
    ```
    ╔══════════════════════════════════════════════════╗
    ║       PrivacyScrubber MCP Server v2.2.4          ║
    ╠══════════════════════════════════════════════════╣
    ║  🔓 Tier: FREE                                   ║
    ║  📊 Session requests: 5                          ║
    ║  📁 Input size limit: 15,000 characters/request  ║
    ╠══════════════════════════════════════════════════╣
    ║  🏷️  Profiles: General only — PRO unlocks 25 more ║
    ║  📋 Custom rules: 🔒 Locked — requires PRO       ║
    ╠══════════════════════════════════════════════════╣
    ║  💳 Upgrade to PRO — $110 Lifetime               ║
    ║     https://privacyscrubber.com/pricing?utm_source=npm&utm_medium=readme&utm_campaign=mcp_server          ║
    ╠══════════════════════════════════════════════════╣
    ║  After purchase, add your key to MCP config:     ║
    ║  "PRIVACYSCRUBBER_KEY": "<your-key-here>"        ║
    ║  Full setup guide:                               ║
    ║  https://privacyscrubber.com/features/mcp/?utm_source=npm&utm_medium=readme&utm_campaign=mcp_server       ║
    ╚══════════════════════════════════════════════════╝
    ```

---

## 🛡️ Standalone CLI: `ps-guard`

PrivacyScrubber bundles `ps-guard` for Unix pipe, pre-commit, and agentic workflows:

```bash
# Pipe any output through RAM redaction
cat .env | npx ps-guard --profile dev

# Execute commands through the ZTDS safety wrapper
npx ps-guard -- npm test

# Review git diff with secrets redacted
npx ps-guard --diff --staged

# Generate rules for all AI IDEs (.cursorrules, .windsurfrules, CLAUDE.md, copilot, cline)
npx ps-guard --rules
```

---

## 🌐 Browser Extension & Web Client

Looking for real-time protection directly inside your web browser?
*   **Chrome Extension:** Get the [PrivacyScrubber Chrome Extension](https://chromewebstore.google.com/detail/privacyscrubber-%E2%80%94-pii-red/pimoejgefeilajmmbpghifdmhdlkgjol) to sanitize prompts directly inside ChatGPT, Claude, and Gemini in real-time.
*   **Web Sandbox:** Use the zero-server browser sanitization tools at [PrivacyScrubber Homepage](https://privacyscrubber.com/?utm_source=npm&utm_medium=readme&utm_campaign=mcp_server).

## 📄 License & Commercial Upgrade

By default, the server runs under the **Free Tier** (restricted to 15,000 characters per request and the basic `General` PII profile). To unlock 30 specialized engineering, medical, legal, and financial PII profiles, as well as team-wide custom rules, you can purchase a commercial license.

### Feature Comparison

| Feature | Free Tier | PRO Tier | TEAMS Tier |
| :--- | :--- | :--- | :--- |
| **Volatile Tokenization** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Standard PII Masking** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Max Character Length** | 15,000 chars | ♾️ Unlimited | ♾️ Unlimited |
| **Industry Profiles** | General Only | 30 Profiles | 30 Profiles |
| **Custom Regex Rules** | ❌ Locked | ♾️ Unlimited | ♾️ Unlimited |
| **Team Rules Sync (GPO)** | ❌ No | ❌ No | ✅ Yes (Shared Link) |
| **Licensing Cost** | $0 | **$110 Lifetime** | **$99/mo Flat Rate** |

👉 **[Acquire a PRO / TEAMS License Key at privacyscrubber.com/pricing](https://privacyscrubber.com/pricing?utm_source=npm&utm_medium=readme&utm_campaign=mcp_server)**

---

## 🔐 After Purchase: Activate PRO in Your MCP Client

After purchasing a PRO license at [privacyscrubber.com/pricing](https://privacyscrubber.com/pricing?utm_source=npm&utm_medium=readme&utm_campaign=mcp_server), you will receive a license key. Add it to your MCP client config as an environment variable: `PRIVACYSCRUBBER_KEY`.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "privacyscrubber": {
      "command": "npx",
      "args": ["-y", "@privacyscrubber/mcp-server"],
      "env": {
        "PRIVACYSCRUBBER_KEY": "YOUR_LICENSE_KEY_HERE"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Cursor

1. Go to **Settings → Features → MCP Servers**.
2. Find `privacyscrubber` and click **Edit**.
3. Add the environment variable: `PRIVACYSCRUBBER_KEY=YOUR_LICENSE_KEY_HERE`.
4. Restart Cursor.

Alternatively, export it system-wide so all tools pick it up:
```bash
# macOS / Linux — add to ~/.zshrc or ~/.bashrc
export PRIVACYSCRUBBER_KEY="YOUR_LICENSE_KEY_HERE"
```

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "privacyscrubber": {
      "command": "npx",
      "args": ["-y", "@privacyscrubber/mcp-server"],
      "env": {
        "PRIVACYSCRUBBER_KEY": "YOUR_LICENSE_KEY_HERE"
      }
    }
  }
}
```

### Verify Activation

After adding the key, ask your AI agent to call `check_status`:

```
Use the check_status tool from PrivacyScrubber MCP
```

---

## 🔗 Ecosystem & Production Architecture Guides

- 🌐 **Web App**: [https://privacyscrubber.com](https://privacyscrubber.com)
- 📦 **Node.js / TypeScript SDK**: [@privacyscrubber/sdk](https://www.npmjs.com/package/@privacyscrubber/sdk)
- 🧩 **Chrome Extension**: [Chrome Web Store](https://chromewebstore.google.com/detail/privacyscrubber-%E2%80%94-zero-tr/pimoejgefeilajmmbpghifdmhdlkgjol)
- 🛡️ **RAG & Vector Databases**: [Sanitizing PII Before Vector DB Ingestion (Pinecone, Chroma, Qdrant)](https://privacyscrubber.com/solutions/dev/rag-vector-database-pii-masking/)
- 🤖 **LangChain & LlamaIndex**: [In-Memory PII Middleware for AI Agent Pipelines](https://privacyscrubber.com/solutions/agents/langchain-llamaindex-pii-anonymizer/)
- ⚡ **AWS Comprehend Alternative**: [In-Memory Redaction Without Egress or Cloud Overhead](https://privacyscrubber.com/solutions/dev/aws-comprehend-pii-alternative/)

---

## 📚 Academic Foundations & Regulatory Verification

PrivacyScrubber and the Zero-Trust Data Sanitization (ZTDS) protocol are backed by published scientific, clinical, and legal treatises:

| Repository / Archive | DOI / Identifier | Focus Area | Regulatory & Compliance Scope |
|---|---|---|---|
| **IETF Standards Track** | [`draft-sibiryakov-ztds-protocol`](https://datatracker.ietf.org/doc/draft-sibiryakov-ztds-protocol/) | The ZTDS Protocol for Frontier AI Ingestion | Global AI Privacy, Zero-Egress Architecture |
| **Zenodo / CERN** | [`10.5281/zenodo.22058770`](https://zenodo.org/records/22058770) | Zero-Trust Data Sanitization (ZTDS) Protocol Foundation | Cross-Border AI Privacy, ISO 27001 A.8.11 |
| **OSF (Center for Open Science)** | [`10.17605/OSF.IO/5BYJF`](https://osf.io/5byjf/) | Empirical Latency Benchmark & Memory Profiling (<2ms RAM) | Performance vs Cloud DLP Proxies |
| **SSRN / Elsevier** | [`SSRN ID: 7335581`](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7335581) | Enterprise Generative AI Governance | EU AI Act, UK GDPR, US State Privacy |
| **medRxiv (Cold Spring Harbor)** | [`MEDRXIV/2026/361661`](https://submit.medrxiv.org/) | Multi-Center Clinical Trial De-Identification | HIPAA Safe Harbor Section 164.514(b) |
| **Law Archive / OSF** | [`LawArchive ID: 4wc86`](https://osf.io/preprints/lawarchive/4wc86/) | Preserving Attorney-Client Privilege in AI Workflows | ABA Model Rules & Legal Ethics |

### Citing PrivacyScrubber in Research & Audits
```bibtex
@software{sibiryakov2026privacyscrubber,
  author = {Sibiryakov, Ilya},
  title = {PrivacyScrubber: Zero-Trust Data Sanitization (ZTDS) Engine & MCP Server},
  year = {2026},
  publisher = {Zenodo},
  doi = {10.5281/zenodo.22058770},
  url = {https://github.com/moxno/privacyscrubber-mcp}
}
```

---

## 📄 License

MIT © [Ilya Sibiryakov](https://privacyscrubber.com) (BrandMeWeb)

---

## ⚖️ Intellectual Property & Virtual Patent Marking

The Zero-Trust Data Sanitization (ZTDS) architecture, in-memory deterministic tokenization, cryptographic session handoff, and stdio execution methods implemented in this package are proprietary technology of Ilya Sibiryakov (BrandMeWeb) and are protected under **Patent Pending** status:

- **Patent Office:** State of Israel Ministry of Justice, Patent Office (ILPO)
- **Application Number:** `331905` (Tracking ID: `94221`)
- **Filing / Priority Date:** September 14, 2026 (Paris Convention Art. 4 & 35 U.S.C. § 119 Priority)
- **Official Title:** *SYSTEM AND METHOD FOR CLIENT-SIDE ZERO-TRUST DATA SANITIZATION AND CRYPTOGRAPHIC SESSION HANDOFF IN ARTIFICIAL INTELLIGENCE WORKFLOWS*
- **Virtual Patent Marking:** [privacyscrubber.com/patents/](https://privacyscrubber.com/patents/) in accordance with 35 U.S.C. § 287(a).

### 🌐 Internet Engineering Task Force (IETF) Specification
- **Specification Title:** *The Zero-Trust Data Sanitization (ZTDS) Protocol for Frontier Artificial Intelligence Ingestion*
- **Standards Track:** IETF Internet Standard Track
- **IETF Datatracker:** [https://datatracker.ietf.org/doc/draft-sibiryakov-ztds-protocol/](https://datatracker.ietf.org/doc/draft-sibiryakov-ztds-protocol/)
- **Archive Plaintext:** [https://www.ietf.org/archive/id/draft-sibiryakov-ztds-protocol-01.txt](https://www.ietf.org/archive/id/draft-sibiryakov-ztds-protocol-01.txt)



