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

VERSION = "2.3.2"

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
            scrubbed = pat.sub(lambda m, et=entity_type: replacer(m, et), scrubbed)

        return scrubbed, tokens_created

    def reveal(self, text: str, custom_map: dict = None) -> str:
        if not text:
            return ""
        active_map = custom_map if custom_map is not None else self.session_map
        if not active_map:
            return text
        result = text
        for tok, original in sorted(active_map.items(), key=lambda x: len(x[0]), reverse=True):
            result = result.replace(tok, original)
        return result


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
                        }
                    ]
                }
            }
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif method == "tools/call":
            tool_name = params.get("name")
            tool_args = params.get("arguments", {})

            if tool_name == "sanitize_text":
                raw_text = tool_args.get("text", "")
                scrubbed, tokens = engine.sanitize(raw_text)
                res = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": scrubbed}]
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
                    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
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
                    f"PrivacyScrubber MCP Server (Python Native Fallback v{VERSION})\n"
                    f"Architecture: 100% In-Memory RAM | Zero-Network Air-Gapped\n"
                    f"Active RAM Tokens in Session: {len(engine.session_map)}\n"
                    f"Commercial Licensing: https://privacyscrubber.com/pricing\n"
                )
                res = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": status_text}]
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

    npx_bin = shutil.which("npx")
    if npx_bin and not force_native:
        cmd = [npx_bin, "-y", "@privacyscrubber/mcp-server"] + args
        try:
            if hasattr(os, "execvp"):
                os.execvp(npx_bin, cmd)
            else:
                proc = subprocess.run(cmd)
                sys.exit(proc.returncode)
        except Exception:
            run_native_mcp_loop()
    else:
        run_native_mcp_loop()


if __name__ == "__main__":
    main()
