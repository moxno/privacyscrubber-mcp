# Security Model & Trust Boundary Specification

This document details the architectural boundaries, threat model, operational assumptions, and security caveats of the **PrivacyScrubber Model Context Protocol (MCP) Server** and associated SDK/CLI tools.

---

## 1. Architectural Classification

PrivacyScrubber MCP is an **application-layer, defense-in-depth data sanitization engine and secure execution wrapper**. 

### What it IS:
- An in-process, deterministic PII and credential redactor executing inside the local Node.js runtime.
- An MCP tool provider communicating over standard input/output (`stdio`) JSON-RPC.
- An ephemeral, volatile memory (RAM-only) tokenizer that replaces sensitive entities with reversible placeholders (e.g. `[EMAIL_1]`, `[API_KEY_1]`).

### What it is NOT:
- **Not a mandatory network airlock:** It does not intercept socket-level TCP/UDP traffic or force outbound API requests through a transparent proxy.
- **Not a kernel-enforced sandbox:** In accordance with the Model Context Protocol specification, tool execution is delegated by the host application (e.g. Cursor, Claude Desktop, Windsurf, or autonomous agent frameworks). If a host model or user chooses to send un-sanitized prompts directly through another tool or channel, PrivacyScrubber cannot prevent that transmission.

---

## 2. Trust Boundaries & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ HOST MACHINE (Developer Workstation / Container)                            │
│                                                                             │
│  ┌───────────────────────┐                  ┌────────────────────────────┐  │
│  │ Host Client / Agent   │  JSON-RPC (stdio)│ PrivacyScrubber MCP Server │  │
│  │ (Cursor / Claude UI)  │ ◄──────────────► │ (Node.js Process)          │  │
│  └──────────┬────────────┘                  └─────────────┬──────────────┘  │
│             │                                             │                 │
│             │ 1. Raw Text / File Path                     │                 │
│             ▼                                             │                 │
│      [Agent Context] ◄────── 2. Redacted Tokens ──────────┤ (In-Memory RAM) │
│             │                                             │ [Session Map]   │
│             │ 3. API Dispatch                             │                 │
│             ▼                                             │                 │
│   ┌───────────────────┐                                   │                 │
│   │ Remote LLM API    │                                   │                 │
│   │ (OpenAI/Anthropic)│                                   │                 │
│   └─────────┬─────────┘                                   │                 │
│             │ 4. Response with Tokens                     │                 │
│             ▼                                             │                 │
│      [Agent Context] ────── 5. Unmask Request ───────────►│                 │
│             ▲ 6. Plaintext (or Disk Patch) ───────────────┘                 │
└─────────────┼───────────────────────────────────────────────────────────────┘
              ▼
   [Remote Trust Boundary] (Only Tokenized Data Crosses Wire)
```

---

## 3. Explicit Security Caveats & Threat Analysis

### Caveat 1: Reverse-Unmasking (De-Tokenization) Returns Plaintext
- **Mechanism:** The tools `detokenize_text`, `reveal_text`, and `guard_apply_patch` restore synthetic placeholders back to their original values using the active in-memory session map.
- **Risk Assessment:** De-tokenization reintroduces raw plaintext into the local calling context. If the host agent retains unmasked output in an ongoing chat history that is subsequent sent to a remote LLM, or if the agent logs intermediate unmasked states to unencrypted storage or third-party monitoring plugins, the initial redaction benefit is negated.
- **Operational Requirement:** Reverse-unmasking should strictly be invoked at the **terminal output boundary** (e.g. when writing the final localized patch to disk via `guard_apply_patch`, or presenting output directly to the human developer), never during intermediate multi-agent routing steps.

### Caveat 2: Host Execution & Filesystem Boundary Expansion
- **Mechanism:** To facilitate automated developer workflows, optional tools such as `guard_exec`, `guard_read_file`, and `guard_git_diff` run shell commands (`child_process.exec`/`spawn`) and read/modify filesystem paths.
- **Risk Assessment:** These tools operate under the privileges of the active OS user (UID/GID) running the MCP process. An autonomous agent instructed or prompted adversarially could attempt to read unauthorized local files or execute arbitrary shell commands.
- **Mitigation & Sandboxing Recommendations:**
  1. **Container Isolation:** In enterprise or automated CI/CD pipelines, execute the MCP server inside an isolated container (Docker, Podman) with non-root user privileges and restricted volume mounts.
  2. **Minimal Tool Scoping:** If an organization requires PII masking without shell execution capabilities, configure the MCP client to restrict exposed tools exclusively to pure sanitization helpers (`sanitize_text`, `detokenize_text`, `sanitize_file`).

### Caveat 3: Token Mapping Volatility & Multi-Session Scope
- **Mechanism:** Token-to-value maps (`sessionMap`) are stored strictly in volatile heap memory (`Map<string, string>`).
- **Security Posture:** 
  - Token mappings are never persisted to disk, local cookies, databases, or cloud backends.
  - Terminating or restarting the MCP process instantly and permanently purges all session mappings, rendering previously tokenized logs cryptographically irreversible.
  - Sessions are scoped to the running process lifecycle.

### Caveat 4: Detection Heuristics & Coverage Scope
- **Mechanism:** Detection relies on specialized multi-pass regex patterns, Luhn algorithm verification, IBAN check-digit validations, and 25 industry profiles (Medical, FinTech, Legal, DevOps secrets, etc.).
- **Boundary Reality:** While highly optimized for corporate PII and credentials, pattern-based redaction cannot guarantee 100% capture of obscure, unstructured, or deliberately obfuscated prose. It serves as an essential compliance and risk reduction layer, not a substitute for data classification policies.

---

## 4. Network Posture & Verification

- **Zero Network Egress:** The core PrivacyScrubber engine performs **zero** outbound HTTP/HTTPS/WebSocket requests. It requires no network connectivity to operate.
- **Offline / Airplane Mode Test:** Developers and security auditors can verify this property at any time:
  ```bash
  # 1. Sever network interfaces
  sudo ifconfig en0 down # macOS
  
  # 2. Run test suite locally
  npm test
  ```
  All tests execute and pass with 100% offline parity.
- **Zero Remote Licensing Telemetry:** PRO/TEAMS tier license validation is performed fully offline via local asymmetric RSA-4096 signature verification against hardcoded public keys. No remote validation pings or phone-home requests exist in the codebase.

---

## 5. Licensing & Open Source Integrity

The core PrivacyScrubber MCP server and CLI are released under the open-source **MIT License** (see [LICENSE](LICENSE)). All core redaction, CLI piping, file scanning, and basic profile capabilities are freely available under standard MIT permissions.
