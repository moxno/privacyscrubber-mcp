# Contributing to PrivacyScrubber MCP Server

We welcome contributions to the PrivacyScrubber Model Context Protocol (MCP) server integration, client configurations, and testing suites.

---

## 🛠️ Development Setup

To set up a local development environment:

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/moxno/privacyscrubber-mcp.git
    cd privacyscrubber-mcp
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Run the Server Locally:**
    You can spin up the server transport using:
    ```bash
    node index.js
    ```
    *Note: The server uses StdIO transport, so it will sit waiting for JSON-RPC input on standard streams.*

---

## 🧪 Testing Your Changes

Before submitting a Pull Request, ensure that all integration and cryptographic verification tests pass cleanly.

### 1. Cryptographic Signature Assertions
Verify that local license key validations and RSA signatures parse correctly:
```bash
node test-mcp.js
```

### 2. End-to-End JSON-RPC Subprocess Suite
Run the full simulation test which spawns the server, registers protocol versions, lists capabilities, processes files (TXT and DOCX), and asserts binary file rejections:
```bash
node test-mcp-deep.js
```

---

## 🔒 Regex Rules & PII Detection Core
The core detection engine and regex rules are bundled inside `scrubber-core.cjs` which maintains parity with the PrivacyScrubber Chrome Extension and web application. 

If you notice a false positive or an uncaught entity type (e.g. name matching edge cases), please report it directly through the main project issues or email us at `support@privacyscrubber.com` so we can sync the ruleset across all platforms.
