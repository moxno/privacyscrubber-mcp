# Curated Awesome Lists PR Submission Manifest

## Strategic Value
Curated GitHub Awesome lists provide permanent high-authority backlinks, organic developer discoverability, and direct npm install traffic from backend engineers.

---

## 1. punkpeye/awesome-mcp-servers (93k+ Stars)
- **Repo**: [https://github.com/punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)
- **Status**: PrivacyScrubber is already listed under `## Security`.
- **Action**: Submit an update PR to feature both MCP server and the headless SDK.
- **File to Edit**: `README.md`
- **Target Line**: Locate `- [privacyscrubber-mcp](https://github.com/moxno/privacyscrubber-mcp)...`
- **Replace With**:
```markdown
- [privacyscrubber-mcp](https://github.com/moxno/privacyscrubber-mcp) - Zero-Trust Data Sanitization (ZTDS) stdio server for AI IDEs (Cursor, Claude) and headless Node.js/TypeScript SDK (@privacyscrubber/sdk) for sub-millisecond in-memory PII/secrets redaction.
```
- **PR Title**: `docs(security): update privacyscrubber-mcp description with SDK support`
- **PR Description**:
```markdown
Updated description for `privacyscrubber-mcp` to mention companion headless Node.js SDK (`@privacyscrubber/sdk`) for in-memory PII and secrets redaction with zero external dependencies.
```

---

## 2. modelcontextprotocol/servers (Anthropic Official Registry)
- **Repo**: [https://github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- **Target**: Community / External Servers listing or directory.
- **PR Title**: `Add PrivacyScrubber MCP Server (Zero-Trust Data Sanitization)`
- **Entry**:
```markdown
- **[PrivacyScrubber](https://github.com/moxno/privacyscrubber-mcp)**: Zero-trust, air-gapped data sanitization MCP server over stdio. Strips PII, secrets, and internal identifiers before LLM ingestion.
```
- **PR Description**:
```markdown
Adding PrivacyScrubber MCP server.
Features:
- Runs locally over stdio (zero network ports, zero data egress).
- Provides `scrub_text` and `reveal_text` tools for safe LLM interaction in Cursor and Claude Desktop.
- Zero dependencies, lightweight Node.js implementation.
```

---

## 3. sindresorhus/awesome-nodejs (54k+ Stars)
- **Repo**: [https://github.com/sindresorhus/awesome-nodejs](https://github.com/sindresorhus/awesome-nodejs)
- **Target Section**: `## Security`
- **Entry to Insert**:
```markdown
- [@privacyscrubber/sdk](https://github.com/moxno/privacyscrubber-mcp) - Zero-dependency in-memory PII and secrets redaction SDK for Node.js, Next.js, and OpenAI (<1ms latency, zero network egress).
```
- **PR Title**: `Add @privacyscrubber/sdk to Security`
- **PR Description**:
```markdown
Submitting `@privacyscrubber/sdk` under Security.
It is an in-memory, zero-dependency Node.js/TypeScript SDK for sanitizing PII and secrets (AWS keys, JWTs, emails, phones, SSNs) prior to cloud LLM or vector DB ingestion.
- Zero network egress (air-gapped certified)
- Sub-millisecond latency (<1ms per 10k chars)
- 1-line transparent OpenAI SDK wrapper (`wrapOpenAI`)
- Supports Node.js 18+, Bun, Deno, and modern browser Web Workers.
```

---

## 4. kyrolabs/awesome-langchain (16k+ Stars)
- **Repo**: [https://github.com/kyrolabs/awesome-langchain](https://github.com/kyrolabs/awesome-langchain)
- **Target Section**: `## Tools / Services` or `## Security`
- **Entry to Insert**:
```markdown
- [PrivacyScrubber SDK](https://github.com/moxno/privacyscrubber-mcp) - Zero-trust in-memory PII redaction and detokenization middleware for LangChain and LlamaIndex.
```
- **PR Title**: `Add PrivacyScrubber SDK to Tools / Security`
- **PR Description**:
```markdown
Adding PrivacyScrubber SDK to Tools / Security.
LangChain TypeScript developers require stripping PII and credentials before chaining prompts to third-party LLMs and vector stores without adding external container latency.
The SDK executes in <1ms in local memory with zero dependencies.
```

---

## 5. e2b-dev/awesome-ai-agents (11k+ Stars)
- **Repo**: [https://github.com/e2b-dev/awesome-ai-agents](https://github.com/e2b-dev/awesome-ai-agents)
- **Target Section**: `## Guardrails & Security`
- **Entry to Insert**:
```markdown
- [@privacyscrubber/sdk](https://github.com/moxno/privacyscrubber-mcp) - In-memory zero-trust PII sanitization and multi-turn state preservation middleware for autonomous AI agents.
```
- **PR Title**: `Add @privacyscrubber/sdk to Guardrails & Security`

---

## 6. Execution Command Flow for Submitting PRs

For any of the repositories above:
```bash
# 1. Fork target repository via GitHub UI to your account (moxno)
# 2. Clone your fork locally
git clone https://github.com/moxno/<awesome-repo>.git /tmp/<awesome-repo>
cd /tmp/<awesome-repo>

# 3. Create a feature branch
git checkout -b add-privacyscrubber-sdk

# 4. Make the edit in README.md (alphabetically within the category)
# 5. Commit and push
git add README.md
git commit -m "docs: add @privacyscrubber/sdk under <Section>"
git push -u origin add-privacyscrubber-sdk

# 6. Open PR via GitHub CLI or web UI:
gh pr create --title "Add @privacyscrubber/sdk to <Section>" --body-file /path/to/pr_body.txt
```
