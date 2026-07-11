# Security Policy (SECURITY.md)

PrivacyScrubber is built with a zero-server, client-side first architecture. We take data privacy and vulnerability management extremely seriously.

---

## 🔒 Security Posture & Guarantees

The PrivacyScrubber MCP server operates under a strict **Zero-Trust Data Sanitization (ZTDS)** design:
1.  **100% Offline / Local Redaction:** All PII extraction, pattern matching, and tokenization logic run locally inside your system's Node.js runtime process memory (volatile RAM).
2.  **No Telemetry & No Remote Logs:** The server contains zero network request code for telemetry, prompts transmission, or log collection.
3.  **Strict Gating Audits:** Cryptographic key checks (for PRO/TEAMS licenses) are validated locally on-device using a signed RSA public key signature verification. No license verification calls are made to any remote databases.

### Verification (Airplane Mode Test)
You can verify the zero-network posture at any time:
1.  Disconnect your machine's internet access (Wi-Fi/Ethernet).
2.  Launch the MCP server locally using Cursor, Windsurf, or Claude Desktop.
3.  Execute file sanitization and detokenization. All tools remain 100% operational offline.

---

## 🐛 Reporting a Vulnerability

If you discover a potential security vulnerability (e.g. regex engine backtracking denial of service, memory leaks, or local file access overflows), please do not report it in the public GitHub Issues tracker. 

Instead, report it privately through our coordinated disclosure channel:
- **Email:** `security@privacyscrubber.com`
- **Response SLA:** Our team reviews all reports within **24 hours** and will provide a status update and remediation timeline.

Thank you for helping keep the developer ecosystem secure!
