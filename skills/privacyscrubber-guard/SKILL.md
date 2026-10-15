---
name: privacyscrubber-guard
description: Pre-ingestion zero-trust PII, secret, and regulated data sanitization skill for AI coding agents (Claude Code, Cursor, Codex, Gemini CLI, Windsurf) via @privacyscrubber/mcp-server. Intercepts files, shell commands, and prompts in local RAM with 30 specialized industry profiles and SHA-256 compliance receipts.
metadata:
  author: moxno
  version: "2.3.8"
  mcp_server: "npx -y @privacyscrubber/mcp-server"
---

# PrivacyScrubber Guard — Agent Skill

Enforces local in-RAM PII and secret sanitization before AI agents read files, run terminal commands, apply patches, or send context to external LLM APIs.

## Quick Setup

```bash
claude mcp add privacyscrubber -- npx -y @privacyscrubber/mcp-server
```

Or via Python (`uvx`):

```bash
claude mcp add privacyscrubber -- uvx privacyscrubber-mcp
```

## Core Agent Workflow

1. **Sanitize Text & Prompts (`scrub_text`):** Mask PII, API keys, HIPAA PHI, PCI-DSS PAN/IBAN, and corporate secrets into deterministic surrogate tokens (`[EMAIL_1]`, `[OPENAI_KEY_1]`, `[SSN_1]`) in local RAM.
2. **Guard File Reads & Shell Commands (`guard_read_file`, `guard_exec`, `guard_apply_patch`):** Automatically redact sensitive literals from local files and command outputs before they enter the agent context window.
3. **Restore Cleartext Locally (`reveal_text`):** Re-hydrate surrogate tokens from volatile session memory into final local outputs without exposing cleartext to external LLM providers.
4. **Compliance Attestation (`generate_audit_receipt`):** Emit a deterministic SHA-256 compliance receipt mapping detected entities to GDPR, HIPAA, SOC 2, PCI-DSS, and NIST frameworks.
