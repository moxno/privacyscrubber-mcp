# @privacyscrubber/mcp-server

[![NPM Version](https://img.shields.io/npm/v/@privacyscrubber/mcp-server?color=blue)](https://www.npmjs.com/package/@privacyscrubber/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Smithery Compatible](https://smithery.ai/badge/@privacyscrubber/mcp-server)](https://smithery.ai/server/@privacyscrubber/mcp-server)
[![Security: 100% Local](https://img.shields.io/badge/Security-100%25%20Local-emerald)](https://privacyscrubber.com)
[![Parity: 100% Core Match](https://img.shields.io/badge/Parity-100%25%20Core%20Match-blueviolet)](https://privacyscrubber.com)

**Zero-Trust Data Sanitization (ZTDS) Model Context Protocol (MCP) Server.**
Locally scrubs PII, secrets, credentials, and custom regex rules from files and text contexts before they reach remote LLM providers.

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

---

## 📄 License & Commercial Upgrade
Standard use is free under the **Free Tier** (limits to the `General` PII profile). To unlock 22+ specialized industry profiles (DevOps, Medical, Legal, Finance) and custom regex rules, acquire a commercial license at [privacyscrubber.com/pricing](https://privacyscrubber.com/pricing).
