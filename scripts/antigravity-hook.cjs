#!/usr/bin/env node
"use strict";

const path = require("path");

const SENSITIVE_FILE_RX =
  /(?:^|[\\/])(?:\.env(?:\.[a-zA-Z0-9_-]+)?|id_rsa|id_ed25519|id_ecdsa|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*credentials.*\.json|.*secret.*\.(?:json|ya?ml|env|txt)|\.npmrc|\.pypirc|\.netrc)$/i;
const SAFE_TEMPLATE_RX = /\.(?:example|sample|template|dist|schema)$/i;
const SAFE_LICENSE_RX = /(?:^|[\\/])\.privacyscrubber[\\/]license\.key$/i;
const SENSITIVE_CMD_RX =
  /(?:^|[;&|]\s*)(?:cat|head|tail|less|more|bat|sed|awk|grep)\s+[^\n|;&]*(?:\.env\b|id_rsa|id_ed25519|\.pem\b|\.key\b|credentials\.json|\bsecrets?\.)|(?:^|[;&|]\s*)(?:printenv|env\s*$|export\s+-p|aws\s+configure\s+get|gcloud\s+auth\s+print-access-token)/i;
const SAFE_CMD_TEMPLATE_RX = /\.(?:example|sample|template|dist|schema)\b/i;

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0);
}

function evaluatePayload(raw) {
  let payload = {};
  try {
    payload = raw && raw.trim() ? JSON.parse(raw) : {};
  } catch (_err) {
    respond({ decision: "allow" });
    return;
  }

  const toolCall = payload.toolCall && typeof payload.toolCall === "object" ? payload.toolCall : payload;
  const toolName = String(toolCall.name || payload.toolName || payload.tool_name || "");
  const args = toolCall.args && typeof toolCall.args === "object" ? toolCall.args : payload.toolInput || payload.tool_input || payload;

  const isReadTool = /^(?:read_file|view_file|Read|View|ReadFile)$/i.test(toolName);
  const isShellTool = /^(?:run_command|Bash|Execute|run_terminal_cmd)$/i.test(toolName);

  if (isReadTool) {
    const candidatePath = String(
      args.Path || args.AbsolutePath || args.file_path || args.path || args.target_file || ""
    ).trim();
    if (
      candidatePath &&
      SENSITIVE_FILE_RX.test(candidatePath) &&
      !SAFE_TEMPLATE_RX.test(candidatePath) &&
      !SAFE_LICENSE_RX.test(candidatePath)
    ) {
      const base = path.basename(candidatePath);
      respond({
        decision: "deny",
        reason: `Blocked by PrivacyScrubber ZTDS policy: Direct read of sensitive file '${base}' risks credential egress. Call 'mcp_privacyscrubber_guard_guard_read_file' (or 'sanitize_file') to tokenize secrets in local RAM first.`,
      });
      return;
    }
  }

  if (isShellTool) {
    const candidateCmd = String(args.CommandLine || args.command || args.cmd || "").trim();
    if (candidateCmd && SENSITIVE_CMD_RX.test(candidateCmd) && !SAFE_CMD_TEMPLATE_RX.test(candidateCmd)) {
      respond({
        decision: "deny",
        reason:
          "Blocked by PrivacyScrubber ZTDS policy: Command exposes raw credentials directly to model context. Call 'mcp_privacyscrubber_guard_guard_exec' so stdout/stderr are sanitized in local RAM.",
      });
      return;
    }
  }

  respond({ decision: "allow" });
}

if (!process.stdin.isTTY) {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
  });
  process.stdin.on("end", () => evaluatePayload(buf));
} else {
  evaluatePayload("{}");
}
