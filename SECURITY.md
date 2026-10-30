# Security Policy (SECURITY.md)

PrivacyScrubber is built with a zero-server, client-side first architecture. We take data privacy, vulnerability management, and transparent trust boundaries extremely seriously.

For an in-depth breakdown of our architectural boundaries, threat model, reverse-unmasking caveats, and host execution scope, please consult our official [Security Model & Trust Boundary Specification](SECURITY_MODEL.md).

---

## 🔒 Security Posture & Guarantees

The PrivacyScrubber MCP server operates under a strict **Zero-Trust Data Sanitization (ZTDS)** design:
1. **100% Offline / Local Redaction:** All PII extraction, pattern matching, and tokenization logic run locally inside your system's Node.js runtime process memory (volatile RAM).
2. **No Telemetry & No Remote Logs:** The server core contains zero network request code for telemetry, prompts transmission, or log collection.
3. **Local Asymmetric License Validation:** Cryptographic key checks (for PRO/TEAMS licenses) are validated locally on-device using a signed RSA public key signature verification. No license verification calls are made to any remote databases.
4. **Transparent Trust Boundaries:** See [SECURITY_MODEL.md](SECURITY_MODEL.md) for full operational constraints, de-tokenization risks, and host execution privilege models.

### Verification (Airplane Mode Test)
You can verify the zero-network posture at any time:
1. Disconnect your machine's internet access (Wi-Fi/Ethernet).
2. Launch the MCP server locally using Cursor, Windsurf, or Claude Desktop.
3. Execute file sanitization and detokenization. All tools remain 100% operational offline.

---

## 🐛 Reporting a Vulnerability

If you discover a potential security vulnerability (e.g. regex engine backtracking denial of service, memory leaks, or local file access overflows), please do not report it in the public GitHub Issues tracker. 

Instead, report it privately through our coordinated disclosure channel:
- **Email:** `support@privacyscrubber.com` (or `security@privacyscrubber.com`)
- **Response SLA:** Our team reviews all reports within **24 hours** and will provide a status update and remediation timeline.

## Security Advisories & Acknowledgments

Plaintext acknowledgment of external contributors for defense-in-depth hardening and coordinated disclosure (consolidated by root cause, zero external links):

- `PS-VDP-2026-10-001` / `002` (Oct 2026, `v2.4.4`) — Local entitlement validation, custom-rule regex guard, and MCP workspace path-boundary hardening (reported by Vishal Vijay Pawar).
- `PS-VDP-2026-10-003` (Oct 2026, `v2.4.4`) — MCP patch workspace path-boundary hardening (reported by Sudarshan Manjuba Dhanvai).

Thank you for helping keep the developer ecosystem secure!
