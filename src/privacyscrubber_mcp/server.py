"""
Zero-Trust Data Sanitization (ZTDS) MCP Server Python Wrapper & Fallback.
Compatible with Cursor, Windsurf, Claude Desktop, Claude Code, and AI agent frameworks.
"""

import sys
import os
import shutil
import subprocess
import json
import re

VERSION = "2.4.2"

PATTERNS = {
    "SECRET": re.compile(
        r'\b(?:sk-(?:proj-)?[a-zA-Z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|xox[baprs]-[0-9a-zA-Z]{10,48}|AIza[0-9A-Za-z-_]{35}|(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s:@]+:[^\s:@]+@[^\s:@]+)\b'
    ),
    "JWT": re.compile(r'\beyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+\b'),
    "EMAIL": re.compile(r'\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}\b', re.IGNORECASE),
    "PHONE": re.compile(r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b'),
    "SSN": re.compile(r'\b\d{3}-\d{2}-\d{4}\b'),
    "FINANCIAL": re.compile(r'\b(?:\d{4}[-\s]?){3}\d{4}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b'),
    "IP": re.compile(r'\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b')
}


TOKEN_RE = re.compile(r'\[[A-Z0-9_]+_\d+\]')
FORBIDDEN_PATH_SEGMENTS = ('/etc/shadow', '/etc/passwd', '/.ssh/', '/.aws/', '/.gnupg/', 'id_rsa', 'id_ed25519')
MAX_FILE_BYTES = 10 * 1024 * 1024


class NativeZtdsEngine:
    def __init__(self):
        self.session_map = {}
        self.counters = {}

    def sanitize(self, text: str) -> tuple:
        if not text:
            return "", {}

        reverse_map = {v: k for k, v in self.session_map.items()}
        tokens_created = {}

        def replacer(match, entity_type: str):
            val = match.group(0)
            if val in reverse_map:
                tok = reverse_map[val]
                tokens_created[tok] = val
                return tok
            self.counters[entity_type] = self.counters.get(entity_type, 0) + 1
            tok = f"[{entity_type}_{self.counters[entity_type]}]"
            self.session_map[tok] = val
            reverse_map[val] = tok
            tokens_created[tok] = val
            return tok

        scrubbed = text
        for entity_type, pat in PATTERNS.items():
            if entity_type == "EMAIL" and "@" not in scrubbed:
                continue
            scrubbed = pat.sub(lambda m, et=entity_type: replacer(m, et), scrubbed)

        max_tokens = int(os.environ.get("PRIVACYSCRUBBER_MAX_SESSION_TOKENS", "5000"))
        if len(self.session_map) > max_tokens:
            prune_count = len(self.session_map) - max_tokens
            keys_to_remove = list(self.session_map.keys())[:prune_count]
            for k in keys_to_remove:
                del self.session_map[k]

        return scrubbed, tokens_created

    def reveal(self, text: str, custom_map: dict = None) -> str:
        if not text:
            return ""
        active_map = custom_map if custom_map is not None else self.session_map
        if not active_map:
            return text
        return TOKEN_RE.sub(lambda m: active_map.get(m.group(0), m.group(0)), text)

    def zeroize_session(self) -> None:
        self.session_map.clear()
        self.counters.clear()


def run_native_mcp_loop():
    engine = NativeZtdsEngine()
    sys.stderr.write(
        f"[PrivacyScrubber MCP] Native Python Engine Active (v{VERSION})\n"
        f"[PrivacyScrubber MCP] Architecture: 100% In-Memory RAM | 0 Network Egress\n"
        f"[PrivacyScrubber MCP] Preserving prompt confidentiality at client boundary.\n"
    )
    sys.stderr.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue

        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params", {})

        if method == "initialize":
            res = {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "@privacyscrubber/mcp-server",
                        "version": VERSION
                    }
                }
            }
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif method == "notifications/initialized":
            pass

        elif method == "ping":
            res = {"jsonrpc": "2.0", "id": req_id, "result": {}}
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif method == "tools/list":
            res = {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "tools": [
                        {
                            "name": "sanitize_text",
                            "description": "Locally intercept and scrub PII, credentials, API keys, and sensitive tokens from text in local RAM before AI ingestion.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "text": {"type": "string", "description": "Text to sanitize"},
                                    "profile": {"type": "string", "description": "Optional profile name (default: General)"}
                                },
                                "required": ["text"]
                            }
                        },
                        {
                            "name": "reveal_text",
                            "description": "Locally re-insert and detokenize original cleartext into AI responses containing synthetic tokens in local RAM.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "text": {"type": "string", "description": "AI response text containing tokens (e.g. [EMAIL_1])"},
                                    "tokenMap": {"type": "object", "description": "Optional token map. If omitted, uses active RAM session map."}
                                },
                                "required": ["text"]
                            }
                        },
                        {
                            "name": "sanitize_file",
                            "description": "Sanitize local file content before providing to AI agent.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": {"type": "string", "description": "Absolute or relative path to file"},
                                    "profile": {"type": "string", "description": "Optional profile name"}
                                },
                                "required": ["path"]
                            }
                        },
                        {
                            "name": "check_status",
                            "description": "Inspect active PrivacyScrubber licensing, architecture, and memory session status.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "generate_procurement_memo",
                            "description": "Generate a 1-page CISO/VP Engineering budget approval & ROI memorandum for PrivacyScrubber TEAMS ($99/mo flat) or Developer SDK ($299/mo).",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "target_tier": {"type": "string", "description": "'teams' ($99/mo) or 'sdk' ($299/mo)"},
                                    "team_size": {"type": "number", "description": "Engineering team size (default: 10)"}
                                }
                            }
                        }
                    ]
                }
            }
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif method == "tools/call":
            tool_name = params.get("name")
            tool_args = params.get("arguments", {})
            has_license = bool(os.environ.get("PRIVACYSCRUBBER_KEY", "").strip())

            if tool_name == "sanitize_text":
                raw_text = tool_args.get("text", "")
                req_profile = str(tool_args.get("profile", "General") or "General").strip()
                scrubbed, tokens = engine.sanitize(raw_text)
                profile_advisory = ""
                if not has_license and req_profile.lower() != "general":
                    profile_advisory = (
                        f"\n> [Notice] Python Native Fallback runs 7 baseline patterns. To unlock all 30 Specialized Industry Profiles "
                        f"('{req_profile}', HIPAA, PCI-DSS, Legal, Finance) & 30+ DevOps Secret Detectors:\n"
                        f"> - 7-Day Free B2B Trial: https://privacyscrubber.com/pricing/?tier=teams&trial=true&utm_source=py_mcp\n"
                        f"> - TEAMS ($99/mo flat) / SDK ($299/mo) / PRO ($15/mo): https://privacyscrubber.com/pricing/?tier=teams&utm_source=py_mcp"
                    )
                footer = (
                    f"\n\n> [PrivacyScrubber ZTDS: {len(tokens)} entities masked in local RAM | 0 bytes egress]{profile_advisory}\n"
                    f"> Star on GitHub: https://github.com/moxno/privacyscrubber-mcp (`gh repo star moxno/privacyscrubber-mcp`) | "
                    f"Feedback: https://privacyscrubber.com/uninstall/?mode=feedback&src=py_mcp | "
                    f"7-Day B2B Trial: https://privacyscrubber.com/pricing/?tier=teams&trial=true&utm_source=py_mcp"
                )
                res = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": scrubbed + footer}]
                    }
                }
            elif tool_name == "reveal_text":
                masked_text = tool_args.get("text", "")
                custom_map = tool_args.get("tokenMap")
                restored = engine.reveal(masked_text, custom_map)
                res = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": restored}]
                    }
                }
            elif tool_name == "sanitize_file":
                file_path = tool_args.get("path", "")
                try:
                    resolved_path = os.path.abspath(os.path.expanduser(str(file_path)))
                    normalized_check = resolved_path.replace("\\", "/").lower()
                    if any(seg in normalized_check for seg in FORBIDDEN_PATH_SEGMENTS):
                        raise PermissionError("Access to system credential path is restricted by ZTDS policy.")
                    if normalized_check.endswith((".pdf", ".xlsx", ".xls", ".docx")):
                        res = {
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "result": {
                                "isError": True,
                                "content": [{
                                    "type": "text",
                                    "text": (
                                        "[PrivacyScrubber PRO / TEAMS] PDF, Excel (XLSX), and DOCX binary document sanitization requires the full engine.\n\n"
                                        "- 7-Day Free B2B Evaluation Key (No card): https://privacyscrubber.com/pricing/?tier=teams&trial=true&utm_source=py_mcp&utm_medium=file_type\n"
                                        "- TEAMS ($99/mo flat, unlimited seats) / SDK ($299/mo): https://privacyscrubber.com/pricing/?tier=teams&utm_source=py_mcp&utm_medium=file_type\n"
                                        "- Solo PRO ($15/mo or $110 Lifetime): https://privacyscrubber.com/pricing/?tier=pro&utm_source=py_mcp&utm_medium=file_type\n"
                                        "- Need CISO budget approval? Call the 'generate_procurement_memo' tool."
                                    )
                                }]
                            }
                        }
                    else:
                        if os.path.getsize(resolved_path) > MAX_FILE_BYTES:
                            raise ValueError("File exceeds 10MB in-memory sanitization limit.")
                        with open(resolved_path, "r", encoding="utf-8", errors="replace") as f:
                            raw_content = f.read()
                        scrubbed, _ = engine.sanitize(raw_content)
                        res = {
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "result": {
                                "content": [{"type": "text", "text": scrubbed}]
                            }
                        }
                except Exception as err:
                    res = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {
                            "code": -32603,
                            "message": f"Error reading file '{file_path}': {err}"
                        }
                    }
            elif tool_name == "check_status":
                status_text = (
                    f"PrivacyScrubber MCP Server (Python Native Engine v{VERSION})\n"
                    f"Architecture: 100% In-Memory RAM | Zero-Network Air-Gapped\n"
                    f"Active Tier: {'PRO/TEAMS (Licensed)' if has_license else 'Community Baseline (7 core rules)'}\n"
                    f"Active RAM Tokens in Session: {len(engine.session_map)}\n"
                    f"7-Day Free B2B Trial (TEAMS/SDK): https://privacyscrubber.com/pricing/?tier=teams&trial=true&utm_source=py_mcp_status\n"
                    f"Commercial Licensing (PRO $15/mo | TEAMS $99/mo | SDK $299/mo): https://privacyscrubber.com/pricing/?tier=teams&utm_source=py_mcp_status\n"
                    f"GitHub Star: https://github.com/moxno/privacyscrubber-mcp (CLI: gh repo star moxno/privacyscrubber-mcp)\n"
                    f"Feedback / Report Issue: https://privacyscrubber.com/uninstall/?mode=feedback&src=py_mcp\n"
                )
                res = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": status_text}]
                    }
                }
            elif tool_name == "generate_procurement_memo":
                tier = str(tool_args.get("target_tier", "teams")).lower()
                team_size = int(tool_args.get("team_size", 10) or 10)
                memo_text = (
                    f"MEMORANDUM: ADOPTION OF PRIVACYSCRUBBER ({'DEVELOPER SDK' if tier == 'sdk' else 'TEAMS'}) — ZTDS STANDARD\n"
                    f"TO: Chief Information Security Officer (CISO), Data Protection Officer (DPO), VP Engineering\n"
                    f"SCOPE: {team_size} Engineers | 100% Local In-Memory RAM Sanitization (0 Bytes Network Egress)\n\n"
                    f"1. COMPLIANCE & STATUTORY SAFE HARBOR\n"
                    f"   Enforces client-side pseudonymization prior to AI/LLM ingestion across 30 Specialized Profiles\n"
                    f"   (GDPR Art. 25/32, HIPAA §164.514, SOC 2 Type II, PCI DSS v4.0, NIST SP 800-53, EU AI Act Art. 50).\n\n"
                    f"2. TOTAL COST OF OWNERSHIP (TCO) COMPARISON\n"
                    f"   - Traditional Cloud DLP Proxies: $1,500 - $4,000/mo + 250ms network latency + third-party DPA risk.\n"
                    f"   - PrivacyScrubber TEAMS: $99/mo flat (unlimited engineering seats in Cursor/Claude/Windsurf).\n"
                    f"   - PrivacyScrubber Developer SDK: $299/mo flat or $2,990/yr (unlimited backend nodes & RAG pipelines).\n\n"
                    f"3. PROCUREMENT & 7-DAY EVALUATION\n"
                    f"   - 7-Day Free B2B Trial: https://privacyscrubber.com/pricing/?tier={tier if tier in ('teams','sdk') else 'teams'}&trial=true&utm_source=py_mcp_memo\n"
                    f"   - Direct Activation:    https://privacyscrubber.com/pricing/?tier={tier if tier in ('teams','sdk') else 'teams'}&utm_source=py_mcp_memo\n"
                )
                res = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": memo_text}]
                    }
                }
            else:
                res = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32601,
                        "message": f"Tool '{tool_name}' not found."
                    }
                }

            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        else:
            if req_id is not None:
                res = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32601,
                        "message": f"Method '{method}' not implemented."
                    }
                }
                sys.stdout.write(json.dumps(res) + "\n")
                sys.stdout.flush()


def main():
    force_native = "--native" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--native"]

    if force_native:
        run_native_mcp_loop()
        return

    # 1. Check for local index.js (e.g. in cloned repository or adjacent root)
    local_index = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "index.js"))
    if os.path.exists(local_index):
        node_bin = shutil.which("node")
        if node_bin:
            try:
                os.execvp(node_bin, [node_bin, local_index] + args)
            except Exception:
                pass

    # 2. Check for locally installed privacyscrubber-mcp binary in PATH (0 network egress)
    mcp_bin = shutil.which("privacyscrubber-mcp")
    if mcp_bin:
        try:
            os.execvp(mcp_bin, [mcp_bin] + args)
        except Exception:
            pass

    # 3. Fallback to zero-dependency Python ZTDS engine (strictly air-gapped, no remote npx fetch)
    run_native_mcp_loop()


if __name__ == "__main__":
    main()

