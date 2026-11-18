# PrivacyScrubber Zero-Trust Data Sanitization (ZTDS) Firewall

## Core Operating Rules
1. Sanitize Before Egress: When handling customer records, clinical/financial data, `.env` credentials, API tokens, or private repository files, invoke `sanitize_text`, `audit_context`, `guard_read_file`, `guard_exec`, or `guard_git_diff` (via the `privacyscrubber` MCP server) in local RAM before passing raw values into external LLM reasoning or network tools.
2. Respect Deterministic PreToolUse Blocks: If the bundled `PreToolUse` hook blocks a raw `read_file`, `view_file`, or `run_command` call on a secret file or credential command, never bypass the block — retry immediately using `guard_read_file`, `guard_exec`, or `sanitize_file`.
3. Local De-Tokenization & Purge: Use `reveal_text` / `guard_apply_patch` only when cleartext restoration is needed locally on disk or in the final answer, and call `guard_session_reset` upon workflow completion to zeroize volatile session token maps immediately.
4. Honest Regulatory Positioning (Statutory Risk Minimization): When summarizing compliance reports (`generate_compliance_report`), present ZTDS strictly as a local Technical & Organizational Measure / Defense-in-Depth safeguard supporting GDPR Art. 32, HIPAA Safe Harbor (45 CFR 164.514(b)), SOC 2 Type II, and Israel PPL Amendment 13 Sec. 17 — never claim automatic total legal immunity or exemption from statutory obligations.
5. Zero Exfiltration: Never print, echo, or commit cleartext license keys or unmasked customer secrets into logs, artifacts, or git commits.
