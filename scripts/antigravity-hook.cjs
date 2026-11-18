#!/usr/bin/env node
"use strict";

const path = require("path");

const MAX_STDIN_BYTES = 1024 * 1024;

const SENSITIVE_FILE_RX =
  /(?:^|\/)(?:\.env(?:\.[a-zA-Z0-9._-]+)?|id_rsa(?:\.[a-z0-9]+)?|id_ed25519(?:\.[a-z0-9]+)?|id_ecdsa(?:\.[a-z0-9]+)?|id_dsa(?:\.[a-z0-9]+)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*\.jks|.*\.keystore|.*\.kdbx|\.aws\/credentials|\.aws\/config|\.kube\/config|\.docker\/config\.json|\.git-credentials|\.npmrc|\.pypirc|\.netrc|application_default_credentials\.json|.*service[-_]?account.*\.json|.*credentials.*\.json|terraform\.tfstate(?:\.backup)?|.*\.tfvars(?:\.json)?|.*secret.*\.(?:json|ya?ml|env|txt|toml)|license\.key)$/i;

const SAFE_TEMPLATE_RX = /\.(?:example|sample|template|dist|schema)(?:\.json)?$/i;

const SHELL_READER_CMD_RX =
  /(?:^|[;&|`(]\s*)(?:env\s+|sudo\s+|timeout\s+\S+\s+)?(?:cat|head|tail|less|more|bat|nl|tac|rev|od|xxd|hexdump|strings|base64|base32|openssl|gpg|sed|awk|grep|egrep|fgrep|rg|ripgrep|jq|yq|cp|mv|scp|rsync|tar|zip|curl|wget)\b[^\n|;&`)]*(?:(?:^|[\s"'=/])\.env(?:\.[a-zA-Z0-9_-]+)?\b|id_rsa|id_ed25519|id_ecdsa|\.pem\b|\.key\b|\.p12\b|\.pfx\b|\.aws\/credentials|\.kube\/config|\.docker\/config\.json|\.git-credentials|\.npmrc|\.pypirc|\.netrc|credentials\.json|terraform\.tfstate|\.tfvars\b|license\.key|\bsecrets?\.(?:json|ya?ml|env|txt|toml)\b)/i;

const SHELL_ENV_DUMP_RX =
  /(?:^|[;&|`(]\s*)(?:printenv|env\s*(?:$|[|;&])|export\s+-p|aws\s+configure\s+(?:get|export-credentials)|gcloud\s+auth\s+print-access-token|gh\s+auth\s+token|(?:source|\.)\s+[^\n|;&]*\.env\b)|<\s*[^\s|;&]*\.env\b/i;

const SHELL_GIT_BLOB_RX = /\bgit\s+(?:show|cat-file|grep)\b[^\n|;&]*\.env\b/i;

const SHELL_INLINE_INTERP_RX =
  /(?:^|[;&|`(]\s*)(?:python3?|node|ruby|perl|php|sh|bash|zsh)\b[^\n|;&]*(?:\.env\b|id_rsa|id_ed25519|id_ecdsa|\.pem\b|\.aws\/credentials|\.kube\/config|\.git-credentials|terraform\.tfstate|license\.key)/i;

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0);
}

function normalizeCandidatePath(rawPath) {
  const slashNorm = String(rawPath || "").trim().replace(/\\/g, "/");
  if (!slashNorm) return "";
  return path.posix.normalize(slashNorm);
}

function isSensitiveFile(rawPath) {
  const norm = normalizeCandidatePath(rawPath);
  if (!norm) return false;
  return SENSITIVE_FILE_RX.test(norm) && !SAFE_TEMPLATE_RX.test(norm);
}

function hasOnlySafeTemplateRefs(cmd) {
  const matches = cmd.match(/[^\s"'`;|&()]*(?:\.env[^\s"'`;|&()]*|\.tfvars[^\s"'`;|&()]*)/gi);
  if (!matches || matches.length === 0) return false;
  if (/(?:id_rsa|id_ed25519|id_ecdsa|\.pem\b|\.key\b|\.p12\b|\.pfx\b|\.aws\/|\.kube\/|\.docker\/config\.json|\.git-credentials|\.npmrc|\.pypirc|\.netrc|credentials\.json|terraform\.tfstate|license\.key|secrets?\.)/i.test(cmd)) {
    return false;
  }
  return matches.every((token) => SAFE_TEMPLATE_RX.test(token));
}

function evaluatePayload(raw) {
  if (Buffer.byteLength(raw || "", "utf8") > MAX_STDIN_BYTES) {
    respond({
      decision: "deny",
      reason: "Blocked by PrivacyScrubber ZTDS policy: Oversized PreToolUse payload.",
    });
    return;
  }

  let payload = {};
  if (raw && raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch (_err) {
      respond({
        decision: "deny",
        reason: "Blocked by PrivacyScrubber ZTDS policy: Malformed PreToolUse JSON payload.",
      });
      return;
    }
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    respond({
      decision: "deny",
      reason: "Blocked by PrivacyScrubber ZTDS policy: Invalid PreToolUse JSON structure.",
    });
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
    if (isSensitiveFile(candidatePath)) {
      const base = path.posix.basename(normalizeCandidatePath(candidatePath));
      respond({
        decision: "deny",
        reason: `Blocked by PrivacyScrubber ZTDS policy: Direct read of sensitive file '${base}' risks credential egress. Call 'mcp_privacyscrubber_guard_guard_read_file' (or 'sanitize_file') to tokenize secrets in local RAM first.`,
      });
      return;
    }
  }

  if (isShellTool) {
    const candidateCmd = String(args.CommandLine || args.command || args.cmd || "").trim();
    if (
      candidateCmd &&
      (SHELL_READER_CMD_RX.test(candidateCmd) ||
        SHELL_ENV_DUMP_RX.test(candidateCmd) ||
        SHELL_GIT_BLOB_RX.test(candidateCmd) ||
        SHELL_INLINE_INTERP_RX.test(candidateCmd)) &&
      !hasOnlySafeTemplateRefs(candidateCmd)
    ) {
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
  let totalBytes = 0;
  let exceeded = false;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    totalBytes += Buffer.byteLength(chunk, "utf8");
    if (totalBytes > MAX_STDIN_BYTES) {
      exceeded = true;
      return;
    }
    buf += chunk;
  });
  process.stdin.on("end", () => {
    if (exceeded) {
      respond({
        decision: "deny",
        reason: "Blocked by PrivacyScrubber ZTDS policy: Oversized PreToolUse payload.",
      });
      return;
    }
    evaluatePayload(buf);
  });
} else {
  evaluatePayload("{}");
}
