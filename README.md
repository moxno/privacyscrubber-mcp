# @privacyscrubber/mcp-server

[![NPM Version](https://img.shields.io/npm/v/@privacyscrubber/mcp-server?color=blue)](https://www.npmjs.com/package/@privacyscrubber/mcp-server)
[![NPM Downloads](https://img.shields.io/npm/dm/@privacyscrubber/mcp-server?color=3b82f6)](https://www.npmjs.com/package/@privacyscrubber/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![smithery badge](https://smithery.ai/badge/privacyscrubber/pii-masking-mcp)](https://smithery.ai/servers/privacyscrubber/pii-masking-mcp)
[![Security: 100% Local](https://img.shields.io/badge/Security-100%25%20Local-emerald)](https://privacyscrubber.com)
[![Parity: 100% Core Match](https://img.shields.io/badge/Parity-100%25%20Core%20Match-blueviolet)](https://privacyscrubber.com)

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

---

## 🌐 Browser Extension & Web Client

Looking for real-time protection directly inside your web browser?
*   **Chrome Extension:** Get the [PrivacyScrubber Chrome Extension](https://chromewebstore.google.com/detail/privacyscrubber-%E2%80%94-pii-red/pimoejgefeilajmmbpghifdmhdlkgjol) to sanitize prompts directly inside ChatGPT, Claude, and Gemini in real-time.
*   **Web Sandbox:** Use the zero-server browser sanitization tools at [PrivacyScrubber Homepage](https://privacyscrubber.com/).

## 📄 License & Commercial Upgrade

By default, the server runs under the **Free Tier** (restricted to 50,000 characters per request and the basic `General` PII profile). To unlock advanced engineering, medical, legal, and financial PII profiles, as well as team-wide custom rules, you can purchase a commercial license.

### Feature Comparison

| Feature | Free Tier | PRO Tier | TEAMS Tier |
| :--- | :--- | :--- | :--- |
| **Volatile Tokenization** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Standard PII Masking** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Max Character Length** | 50,000 chars | ♾️ Unlimited | ♾️ Unlimited |
| **Industry Profiles** | General Only | 22+ Profiles | 22+ Profiles |
| **Custom Regex Rules** | ❌ Locked | ♾️ Unlimited | ♾️ Unlimited |
| **Team Rules Sync (GPO)** | ❌ No | ❌ No | ✅ Yes (Shared Link) |
| **Licensing Cost** | $0 | **$110 Lifetime** | **$99/mo Flat Rate** |

👉 **[Acquire a PRO / TEAMS License Key at privacyscrubber.com/pricing](https://privacyscrubber.com/pricing)**

---

### 4. `check_status`

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
    ║       PrivacyScrubber MCP Server v1.6.6          ║
    ╠══════════════════════════════════════════════════╣
    ║  🔓 Tier: FREE                                   ║
    ║  📊 Session requests: 5                          ║
    ║  📁 Input size limit: 50,000 characters per request║
    ╠══════════════════════════════════════════════════╣
    ║  🏷️  Profiles: General only — PRO unlocks 22 more  ║
    ║  📋 Custom rules: 🔒 Locked — requires PRO       ║
    ╠══════════════════════════════════════════════════╣
    ║  💳 Upgrade to PRO — $110 Lifetime               ║
    ║     https://privacyscrubber.com/pricing          ║
    ╠══════════════════════════════════════════════════╣
    ║  After purchase, add your key to MCP config:     ║
    ║  "PRIVACYSCRUBBER_KEY": "<your-key-here>"        ║
    ║  Full setup guide:                               ║
    ║  https://privacyscrubber.com/features/mcp/       ║
    ╚══════════════════════════════════════════════════╝
    ```

---

## 🔐 After Purchase: Activate PRO in Your MCP Client

After purchasing a PRO license at [privacyscrubber.com/pricing](https://privacyscrubber.com/pricing), you will receive a license key. Add it to your MCP client config as an environment variable: `PRIVACYSCRUBBER_KEY`.

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

The dashboard should show **Tier: PRO** and all profiles unlocked.

