# @privacyscrubber/mcp-server

**Zero-Trust Data Sanitization (ZTDS) Model Context Protocol (MCP) Server.**
Locally scrubs PII, secrets, credentials, and custom patterns from files and text contexts before sending them to LLMs.

---

## 🔒 Security & Privacy Guarantees

*   **100% Offline / Local Execution:** All PII detection, regex matching, and tokenization happen entirely inside your local machine's RAM. No prompt context or file data is ever sent to any remote servers.
*   **Volatile In-Memory Mapping:** The token replacement map (`sessionMap`) is kept in volatile RAM only. It is never persisted to disk, cookies, or database storage.
*   **Support for Reverse-Scrubbing (Reveal):** Replaces tokens in LLM responses back with original values securely inside your local context.

---

## 🚀 Installation & Usage

### 1. Instant Run with NPX
You can run the MCP server directly using `npx`:
```bash
npx @privacyscrubber/mcp-server
```

---

## ⚙️ Client Integrations

### Claude Desktop
Add the server configuration to your Claude Desktop config file:
*   **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
*   **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "privacyscrubber": {
      "command": "npx",
      "args": ["-y", "@privacyscrubber/mcp-server"],
      "env": {
        "PRIVACYSCRUBBER_KEY": "YOUR_OPTIONAL_PRO_OR_TEAMS_KEY"
      }
    }
  }
}
```

### Cursor / Windsurf
1. Open settings (Settings -> Features -> MCP).
2. Add new MCP server:
    *   **Name:** `privacyscrubber`
    *   **Type:** `command`
    *   **Command:** `npx -y @privacyscrubber/mcp-server`
3. If you have a PRO key, add `PRIVACYSCRUBBER_KEY` as an environment variable in your system shell or configure it locally.

---

## 🛠️ Provided Tools

1.  `sanitize_text` — Sanitizes a raw string using the selected detection profile.
2.  `reveal_text` — Detokenizes a response containing PII tokens back to the original text.
3.  `sanitize_file` — Reads a local file, sanitizes its contents, and outputs the safe version. Supports plain text files (source code, logs, CSV, JSON, markdown) and Microsoft Word `.docx` documents (up to 10MB).

---

## 🌐 Chrome Extension & Web Client

Looking for real-time protection directly inside your web browser?
*   **Chrome Extension:** Get the [PrivacyScrubber Chrome Extension](https://chromewebstore.google.com/detail/privacyscrubber-%E2%80%94-pii-red/pimoejgefeilajmmbpghifdmhdlkgjol) to sanitize prompts directly inside ChatGPT, Claude, and Gemini in real-time.
*   **Web Sandbox:** Use the zero-server browser sanitization tools at [PrivacyScrubber Homepage](https://privacyscrubber.com/).

---

## 📄 License & Commercial Key
Standard use includes the **Free Tier** (limits to the `General` PII profile). To unlock 22+ specialized industry profiles (DevOps, Medical, Legal, Finance) and custom regex rules, acquire a license at [privacyscrubber.com/pricing](https://privacyscrubber.com/pricing).
