---
name: privacyscrubber-guard
description: >-
  Zero-Trust Data Sanitization (ZTDS) firewall and PII/secret masking skill for Google Antigravity.
  Use when sanitizing customer PII, PHI, or credentials in local RAM, inspecting sensitive files
  or diffs safely, restoring masked tokens locally, or generating GDPR/HIPAA/SOC 2 SHA-256 audit receipts.
license: SEE LICENSE IN LICENSE
---

# PrivacyScrubber Guard — Google Antigravity Skill

Enforces in-RAM Zero-Trust Data Sanitization (ZTDS) with zero external network egress before prompts, repository files, diffs, or command outputs reach remote LLM providers.

## 1. Core Local-RAM Workflow

1. **Pre-Flight Risk Scan (`audit_context`):** Non-destructively classify PII, PHI, API secrets, and triggered regulatory frameworks (GDPR Art. 32, HIPAA Safe Harbor, SOC 2, PCI-DSS) before model transmission.
2. **Mask Sensitive Data (`sanitize_text` / `ztds_sanitize`):** Tokenize raw identifiers into deterministic surrogates (`[EMAIL_1]`, `[OPENAI_KEY_1]`, `[SSN_1]`) stored solely in volatile process memory.
3. **Protected Reads, Commands & Patches (`guard_read_file`, `guard_exec`, `guard_git_diff`, `guard_apply_patch`):** Read `.env`/credential files or inspect shell output safely in RAM without exposing cleartext secrets to model context, and hydrate patches locally on disk.
4. **Restore Locally (`reveal_text` / `stream_reveal_text` / `ztds_restore`):** Re-hydrate surrogate tokens inside the final local response or output file when cleartext is required locally.
5. **Attestation & Memory Purge (`generate_compliance_report`, `export_audit_log`, `guard_session_reset`):** Generate deterministic SHA-256 compliance receipts (zero plaintext PII) and wipe volatile session maps on task completion.

## 2. Offline B2B License Activation (No Restart Config Prompt)

The community baseline runs immediately on install (up to 15,000 chars on general PII and 5,000 chars trial quota across 30 specialized industry profiles). To unlock unlimited throughput across all 30 regulated verticals (`Medical`, `Finance`, `Legal`, `Compliance`, `HR`, `Security`, etc.), activate a commercial or evaluation key locally:

```bash
node skills/privacyscrubber-guard/scripts/activate-license.cjs "<PRIVACYSCRUBBER_KEY>"
```

This validates the cryptographic Ed25519 signature offline and stores the key with `0600` permissions in `${PLUGIN_DATA}/license.key` and `~/.privacyscrubber/license.key`.

- **TEAMS (\$99/mo flat, unlimited seats) & 7-Day B2B Trial:** `https://privacyscrubber.com/pricing/?tier=teams&trial=true`
- **Developer SDK (\$299/mo flat, <1ms headless Node.js/WASM):** `https://privacyscrubber.com/sdk/`
- **SOLO PRO (\$15/mo or \$110 Lifetime):** `https://privacyscrubber.com/pricing/?tier=pro`
- **CISO / VP Procurement Brief:** Run `generate_procurement_memo` MCP tool for an executive ROI and Statutory Risk Minimization packet.
