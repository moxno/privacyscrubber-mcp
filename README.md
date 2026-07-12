# PrivacyScrubber MCP Server v1.0.2

Zero-Trust Data Sanitization (ZTDS) Model Context Protocol (MCP) server for local PII and secrets masking.

## What's New in v1.0.2
- **Robust Configuration Parsing**: Protected Smithery integration hooks from undefined configuration objects, ensuring reliable initialization across all MCP clients (Claude Desktop, Cursor, Windsurf).
- **Microsoft Word (.docx) Support**: Enhanced the `sanitize_file` tool to parse and redact sensitive information from Word documents locally.
- **Unified Branding & Metadata**: Corrected repository fields and aligned server identity across NPM, Smithery, and Glama registries.
- **Enhanced Scanner Discovery**: Implemented static `server-card.json` configurations to support automated registry scanning.

## Key Features & Security Guarantees
- **100% Local Processing**: All regex scanning, PII tokenization, and reverse-scrubbing occur directly in your machine's RAM.
- **Airplane Mode Verified**: Fully operational without an internet connection after the initial download.
- **Zero Server Logs**: No data, credentials, or prompts are sent to external APIs or remote databases.

## Quick Start
Run the server instantly without local installation:
```bash
npx -y @privacyscrubber/mcp-server
```

## Client Integration Examples

### Claude Desktop
Add to your `claude_desktop_config.json`:
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
Add a new command-type MCP server:
- **Name**: `privacyscrubber`
- **Command**: `npx -y @privacyscrubber/mcp-server`

## Useful Links
- **Official Website**: https://privacyscrubber.com
- **Chrome Web Store Extension**: https://chromewebstore.google.com/detail/privacyscrubber-%E2%80%94-pii-red/pimoejgefeilajmmbpghifdmhdlkgjol
- **MCP Documentation**: https://privacyscrubber.com/pii-mcp/
- **Pricing & Licensing**: https://privacyscrubber.com/pricing/
- **GitHub Repository**: https://github.com/moxno/privacyscrubber-mcp
