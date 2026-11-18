# PrivacyScrubber MCP Client Configuration Templates

Zero-egress, in-memory PII and secret sanitization configurations for desktop IDEs and coding agents. All communication runs over local `stdio` pipes with zero external network egress.

## Included Templates

| Client | Target Config Path | Template File |
| :--- | :--- | :--- |
| **Cursor** | `~/.cursor/mcp.json` or `.cursor/mcp.json` | [`cursor-mcp.json`](./cursor-mcp.json) |
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) / `%APPDATA%\Claude\claude_desktop_config.json` (Windows) | [`claude-desktop-config.json`](./claude-desktop-config.json) |
| **Claude Code** | `.mcp.json` or `~/.claude.json` (`claude mcp add privacyscrubber -- npx -y @privacyscrubber/mcp-server`) | [`claude-code-settings.json`](./claude-code-settings.json) |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` | [`windsurf-mcp.json`](./windsurf-mcp.json) |

## Optional Environment Variables

- `PRIVACYSCRUBBER_KEY`: Optional offline Ed25519 license key (`PS-PRO-...` or `PS-TEAMS-...`). Leave empty for the built-in Free tier (`15,000` chars/call General profile; `5,000` chars/call trial on all 30 industry profiles).
- `ZTDS_PROFILES`: Optional comma-separated sector profile default (for example `general,devops`, `medical`, `finance`, `legal`, `security`, or `auto`).

## Auto-Configuration CLI

Automatically detect and configure all installed clients on your machine:

```bash
npx -y @privacyscrubber/mcp-server install --all
```

## Production & Backend Scaling

| Deployment Tier | Scope | Pricing | Activation |
| :--- | :--- | :--- | :--- |
| **PRO** | Single-seat unlimited throughput across all 30 specialized industry profiles | `$15/mo` or `$110` Lifetime | [Get PRO License](https://privacyscrubber.com/pricing/) |
| **TEAMS** | Unlimited corporate seats, centralized rules governance, and cryptographic session handoff | `$99/mo` flat | [Deploy TEAMS](https://privacyscrubber.com/pricing/?tier=TEAMS) |
| **Developer SDK** | Headless Node.js / WASM library (`@privacyscrubber/sdk`) for backend microservices and RAG pipelines | `$299/mo` or `$2,990/yr` | [Explore SDK](https://privacyscrubber.com/sdk/) |
| **Enterprise / Air-Gapped** | On-premise deployment, 7-day corporate evaluation key, and Net 30 procurement | Custom | [Pricing & Licensing](https://privacyscrubber.com/pricing/) |
