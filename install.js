#!/usr/bin/env node

/**
 * PrivacyScrubber MCP Server Universal Auto-Configurator & Installer
 * Supports: Claude Desktop, Cursor (Global & Workspace), Windsurf, Cline / Roo-Code,
 * Claude Code CLI, VS Code Native MCP, Zed IDE, Google Antigravity, OpenAI Codex CLI
 * 
 * Safely merges 'privacyscrubber' into client configs without corrupting or deleting existing tools.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { execFileSync, spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __installFilename = fileURLToPath(import.meta.url);
const __installDirname = path.dirname(__installFilename);
const requireCjs = createRequire(import.meta.url);

function isGhCliAvailable() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch (_) {
    return false;
  }
}

async function promptGitHubStarIfInteractive() {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI || process.env.NODE_ENV === 'test' || process.env.PRIVACYSCRUBBER_TEST_MODE === '1') {
    return;
  }
  if (!isGhCliAvailable()) return;

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { rl.close(); } catch (_) {}
      const normalized = String(answer || '').trim().toLowerCase();
      if (normalized === 'y' || normalized === 'yes') {
        try {
          execFileSync('gh', ['repo', 'star', 'moxno/privacyscrubber-mcp'], { stdio: 'ignore', timeout: 4000 });
          console.log('   [GitHub] Thank you for starring moxno/privacyscrubber-mcp!');
        } catch (_) {
          console.log('   [GitHub] Star manually: https://github.com/moxno/privacyscrubber-mcp');
        }
      }
      resolve();
    };
    const timer = setTimeout(() => {
      process.stdout.write('\n');
      finish('skip');
    }, 4000);
    rl.question('   Star moxno/privacyscrubber-mcp on GitHub via gh CLI? [y/N] (auto-skips in 4s): ', (ans) => {
      finish(ans);
    });
  });
}

const MCP_CONFIG_SNIPPET = {
  command: "npx",
  args: ["-y", "@privacyscrubber/mcp-server"]
};

export function getSupportedTargets(customWorkspaceDir = null) {
  const home = os.homedir();
  const platform = process.platform;
  const targets = [];

  // 1. Claude Desktop
  let claudePath = '';
  if (platform === 'darwin') {
    claudePath = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (platform === 'win32') {
    claudePath = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  } else {
    claudePath = path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
  }
  targets.push({
    id: 'claude',
    name: 'Claude Desktop',
    path: claudePath,
    autoCreate: true
  });

  // 2. Cursor Global (~/.cursor/mcp.json)
  const cursorGlobalHome = path.join(home, '.cursor', 'mcp.json');
  targets.push({
    id: 'cursor',
    name: 'Cursor (Global ~/.cursor/mcp.json)',
    path: cursorGlobalHome,
    autoCreate: true
  });

  // 3. Cursor Global Storage (Application Support / AppData)
  let cursorStoragePath = '';
  if (platform === 'darwin') {
    cursorStoragePath = path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json');
  } else if (platform === 'win32') {
    cursorStoragePath = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json');
  } else {
    cursorStoragePath = path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json');
  }
  targets.push({
    id: 'cursor-storage',
    name: 'Cursor (App Storage)',
    path: cursorStoragePath,
    autoCreate: false
  });

  // 4. Cursor Workspace (if .cursor dir or project exists in cwd)
  const cwd = customWorkspaceDir || process.cwd();
  const cursorWorkspacePath = path.join(cwd, '.cursor', 'mcp.json');
  targets.push({
    id: 'cursor-workspace',
    name: `Cursor (Workspace: ${path.basename(cwd)}/.cursor/mcp.json)`,
    path: cursorWorkspacePath,
    autoCreate: fs.existsSync(path.join(cwd, '.cursor'))
  });

  // 5. Windsurf (~/.codeium/windsurf/mcp_config.json)
  const windsurfPath = path.join(
    platform === 'win32' ? (process.env.USERPROFILE || home) : home,
    '.codeium',
    'windsurf',
    'mcp_config.json'
  );
  targets.push({
    id: 'windsurf',
    name: 'Windsurf (Codeium)',
    path: windsurfPath,
    autoCreate: false
  });

  // 6. Cline (VS Code Extension)
  let clinePath = '';
  if (platform === 'darwin') {
    clinePath = path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  } else if (platform === 'win32') {
    clinePath = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  } else {
    clinePath = path.join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  }
  targets.push({
    id: 'cline',
    name: 'Cline (VS Code)',
    path: clinePath,
    serverKey: 'mcpServers',
    snippet: MCP_CONFIG_SNIPPET,
    autoCreate: false
  });

  // 7. Roo-Code (VS Code Extension)
  let rooPath = '';
  if (platform === 'darwin') {
    rooPath = path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
  } else if (platform === 'win32') {
    rooPath = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
  } else {
    rooPath = path.join(home, '.config', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
  }
  targets.push({
    id: 'roo',
    name: 'Roo-Code (VS Code)',
    path: rooPath,
    serverKey: 'mcpServers',
    snippet: MCP_CONFIG_SNIPPET,
    autoCreate: false
  });

  // 8. Claude Code CLI (~/.claude.json)
  const claudeCodeHome = path.join(home, '.claude.json');
  targets.push({
    id: 'claude-code',
    name: 'Claude Code CLI (~/.claude.json)',
    path: claudeCodeHome,
    serverKey: 'mcpServers',
    snippet: MCP_CONFIG_SNIPPET,
    autoCreate: false
  });

  // 9. Claude Code Project (.mcp.json in workspace)
  const claudeCodeProject = path.join(cwd, '.mcp.json');
  targets.push({
    id: 'claude-code-project',
    name: `Claude Code Project (${path.basename(cwd)}/.mcp.json)`,
    path: claudeCodeProject,
    serverKey: 'mcpServers',
    snippet: MCP_CONFIG_SNIPPET,
    autoCreate: fs.existsSync(claudeCodeProject)
  });

  // 10. VS Code Official Native MCP (.vscode/mcp.json)
  const vscodeNativePath = path.join(cwd, '.vscode', 'mcp.json');
  targets.push({
    id: 'vscode',
    name: `VS Code Native MCP (${path.basename(cwd)}/.vscode/mcp.json)`,
    path: vscodeNativePath,
    serverKey: 'servers',
    snippet: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@privacyscrubber/mcp-server"]
    },
    autoCreate: fs.existsSync(path.join(cwd, '.vscode'))
  });

  // 11. Zed IDE (settings.json)
  let zedPath = '';
  if (platform === 'win32') {
    zedPath = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Zed', 'settings.json');
  } else {
    zedPath = path.join(home, '.config', 'zed', 'settings.json');
  }
  targets.push({
    id: 'zed',
    name: 'Zed IDE (settings.json)',
    path: zedPath,
    serverKey: 'context_servers',
    snippet: {
      command: "npx",
      args: ["-y", "@privacyscrubber/mcp-server"]
    },
    autoCreate: false
  });

  // 12. Google Antigravity ZTDS Guard Plugin (~/.gemini/config/plugins/ztds-guard/mcp_config.json)
  targets.push({
    id: 'antigravity',
    name: 'Google Antigravity (ztds-guard)',
    path: path.join(home, '.gemini', 'config', 'plugins', 'ztds-guard', 'mcp_config.json'),
    serverKey: 'mcpServers',
    entryName: 'ztds',
    snippet: MCP_CONFIG_SNIPPET,
    autoCreate: false
  });

  // 13. OpenAI Codex CLI (~/.codex/config.toml)
  const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
  targets.push({
    id: 'codex',
    name: 'OpenAI Codex CLI (~/.codex/config.toml)',
    path: path.join(codexHome, 'config.toml'),
    format: 'toml',
    serverKey: 'mcp_servers',
    entryName: 'privacyscrubber',
    snippet: MCP_CONFIG_SNIPPET,
    autoCreate: false
  });

  return targets;
}

export function parseArgs(rawArgs = process.argv.slice(2)) {
  const options = {
    dryRun: false,
    remove: false,
    all: false,
    rules: false,
    hooks: false,
    targets: [],
    help: false
  };

  for (const arg of rawArgs) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--remove' || arg === '--uninstall') options.remove = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--rules') options.rules = true;
    else if (arg === '--hooks') options.hooks = true;
    else if (arg === '--claude') options.targets.push('claude');
    else if (arg === '--claude-code') options.targets.push('claude-code', 'claude-code-project');
    else if (arg === '--cursor') options.targets.push('cursor', 'cursor-storage', 'cursor-workspace');
    else if (arg === '--vscode') options.targets.push('vscode');
    else if (arg === '--zed') options.targets.push('zed');
    else if (arg === '--antigravity') options.targets.push('antigravity');
    else if (arg === '--codex') options.targets.push('codex');
    else if (arg === '--windsurf') options.targets.push('windsurf');
    else if (arg === '--cline') options.targets.push('cline', 'roo');
    else if (arg === '--workspace') {
      options.targets.push('cursor-workspace', 'claude-code-project', 'vscode');
      options.rules = true;
      options.hooks = true;
    }
    else if (arg === '--help' || arg === '-h') options.help = true;
  }

  return options;
}

export function safeMergeCodexTomlConfig(filePath, snippet = MCP_CONFIG_SNIPPET, remove = false, entryName = 'privacyscrubber') {
  const entry = entryName || 'privacyscrubber';
  const fileExisted = fs.existsSync(filePath);
  const existingContent = fileExisted ? fs.readFileSync(filePath, 'utf8') : '';

  const cmdStr = JSON.stringify((snippet && snippet.command) || 'npx');
  const argsArr = Array.isArray(snippet && snippet.args) ? snippet.args : ['-y', '@privacyscrubber/mcp-server'];
  const argsStr = `[${argsArr.map(a => JSON.stringify(String(a))).join(', ')}]`;
  const blockLines = [
    `[mcp_servers.${entry}]`,
    `command = ${cmdStr}`,
    `args = ${argsStr}`
  ];

  const lines = existingContent.length > 0 ? existingContent.replace(/\r\n/g, '\n').split('\n') : [];
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const headerRx = /^\s*\[\[?\s*([^\[\]]+?)\s*\]\]?\s*(?:#.*)?$/;
  const normalizeHeader = (raw) => raw.replace(/\s*\.\s*/g, '.').replace(/["']/g, '');
  const targetExact = `mcp_servers.${entry}`;
  const targetSubPrefix = `mcp_servers.${entry}.`;

  let inMultilineQuote = null;
  const sections = [];
  let current = { header: null, lines: [] };

  for (const line of lines) {
    let matchedHeader = null;
    if (!inMultilineQuote) {
      const m = line.match(headerRx);
      if (m) {
        matchedHeader = normalizeHeader(m[1]);
      }
    }
    const tripleDouble = (line.match(/"""/g) || []).length;
    const tripleSingle = (line.match(/'''/g) || []).length;
    if (inMultilineQuote === '"""' && tripleDouble % 2 === 1) inMultilineQuote = null;
    else if (inMultilineQuote === "'''" && tripleSingle % 2 === 1) inMultilineQuote = null;
    else if (!inMultilineQuote && tripleDouble % 2 === 1) inMultilineQuote = '"""';
    else if (!inMultilineQuote && tripleSingle % 2 === 1) inMultilineQuote = "'''";

    if (matchedHeader !== null) {
      sections.push(current);
      current = { header: matchedHeader, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  let finalSections = [];
  let modified = false;

  if (remove) {
    let removedAny = false;
    for (const sec of sections) {
      if (sec.header === targetExact || (sec.header && sec.header.startsWith(targetSubPrefix))) {
        removedAny = true;
        continue;
      }
      finalSections.push(sec);
    }
    if (!removedAny) {
      return { success: true, modified: false, message: `${entry} was not present` };
    }
    modified = true;
  } else {
    let replacedExact = false;
    for (const sec of sections) {
      if (sec.header === targetExact) {
        if (!replacedExact) {
          const hadTrailingBlank = sec.lines.length > 0 && sec.lines[sec.lines.length - 1].trim() === '';
          finalSections.push({ header: targetExact, lines: hadTrailingBlank ? [...blockLines, ''] : [...blockLines] });
          replacedExact = true;
        }
        modified = true;
        continue;
      }
      finalSections.push(sec);
    }
    if (!replacedExact) {
      const last = finalSections[finalSections.length - 1];
      if (last && last.lines.length > 0 && last.lines[last.lines.length - 1].trim() !== '') {
        last.lines.push('');
      }
      finalSections.push({ header: targetExact, lines: [...blockLines] });
      modified = true;
    }
  }

  let outLines = [];
  for (let i = 0; i < finalSections.length; i++) {
    const secLines = finalSections[i].lines;
    if (secLines.length === 0) continue;
    if (outLines.length > 0 && outLines[outLines.length - 1].trim() !== '' && secLines[0].trim() !== '') {
      outLines.push('');
    }
    outLines.push(...secLines);
  }

  // Trim leading/trailing blank lines and collapse consecutive blank lines
  const collapsed = [];
  for (const l of outLines) {
    if (l.trim() === '') {
      if (collapsed.length === 0 || collapsed[collapsed.length - 1].trim() === '') continue;
    }
    collapsed.push(l);
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') {
    collapsed.pop();
  }

  const updatedToml = collapsed.length > 0 ? collapsed.join('\n') + '\n' : '';
  const serverNames = new Set();
  for (const l of collapsed) {
    const m = l.match(headerRx);
    if (m) {
      const hdr = normalizeHeader(m[1]);
      const srvMatch = hdr.match(/^mcp_servers\.([^.\s]+)(?:\.|$)/);
      if (srvMatch) serverNames.add(srvMatch[1]);
    }
  }

  return {
    success: true,
    modified,
    fileExisted,
    updatedToml,
    serverCount: serverNames.size
  };
}

export function safeMergeMcpConfig(filePath, snippet = MCP_CONFIG_SNIPPET, remove = false, serverKey = 'mcpServers', entryName = 'privacyscrubber') {
  let existingContent = '';
  let configObj = {};
  const fileExisted = fs.existsSync(filePath);

  if (fileExisted) {
    existingContent = fs.readFileSync(filePath, 'utf8');
    if (existingContent.trim()) {
      try {
        configObj = JSON.parse(existingContent);
      } catch (e) {
        // Backup corrupt file before modifying
        const bakPath = `${filePath}.bak.${Date.now()}`;
        fs.writeFileSync(bakPath, existingContent, 'utf8');
        return {
          success: false,
          error: `Existing JSON was invalid (${e.message}). Created backup: ${bakPath}`
        };
      }
    }
  }

  if (typeof configObj !== 'object' || configObj === null || Array.isArray(configObj)) {
    configObj = {};
  }

  const key = serverKey || 'mcpServers';
  const entry = entryName || 'privacyscrubber';

  if (!configObj[key] || typeof configObj[key] !== 'object' || Array.isArray(configObj[key])) {
    configObj[key] = {};
  }

  if (remove) {
    if (configObj[key][entry]) {
      delete configObj[key][entry];
    } else {
      return { success: true, modified: false, message: `${entry} was not present` };
    }
  } else {
    configObj[key][entry] = snippet;
  }

  const updatedJson = JSON.stringify(configObj, null, 2) + '\n';
  return {
    success: true,
    modified: true,
    fileExisted,
    updatedJson,
    serverCount: Object.keys(configObj[key]).length
  };
}

export async function runInstaller(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);

  if (options.help) {
    console.log(`
PrivacyScrubber MCP Universal Auto-Configurator
Usage:
  npx @privacyscrubber/mcp-server init [options]
  npx @privacyscrubber/mcp-server doctor [--json]
  npx @privacyscrubber/mcp-server-install [options]

Options:
  --all           Configure all detected and standard client paths
  --cursor        Configure Cursor only (~/.cursor/mcp.json)
  --claude        Configure Claude Desktop only
  --claude-code   Configure Claude Code CLI (~/.claude.json / .mcp.json)
  --vscode        Configure VS Code Native MCP (.vscode/mcp.json)
  --zed           Configure Zed IDE (~/.config/zed/settings.json)
  --antigravity   Configure Google Antigravity ztds-guard (~/.gemini/config/plugins/ztds-guard/mcp_config.json)
  --codex         Configure OpenAI Codex CLI (~/.codex/config.toml)
  --windsurf      Configure Windsurf only
  --cline         Configure Cline / Roo-Code only
  --workspace     Configure workspace paths (.cursor, .mcp.json, .vscode) & agent rules
  --rules         Scaffold native AI agent rules (.cursor/rules/privacyscrubber.mdc, AGENTS.md)
  --dry-run       Preview configuration changes without writing files
  --remove        Remove PrivacyScrubber from all target client configurations
  -h, --help      Display this help guide
`);
    return { configured: 0 };
  }

  console.log('--------------------------------------------------');
  console.log('PrivacyScrubber MCP Universal Auto-Configurator');
  console.log('Zero-Trust Data Sanitization (ZTDS) for AI IDEs');
  console.log('--------------------------------------------------\n');

  if (options.dryRun) {
    console.log('[DRY-RUN MODE] No files will be modified on disk.\n');
  }
  if (options.remove) {
    console.log('[UNINSTALL MODE] Removing PrivacyScrubber MCP server from configs.\n');
  }

  const targets = getSupportedTargets();
  let configuredCount = 0;
  let detectedClients = 0;

  for (const target of targets) {
    const isFiltered = options.targets.length > 0 && !options.targets.includes(target.id);
    if (isFiltered) continue;

    const fileExists = fs.existsSync(target.path);
    const parentDirExists = fs.existsSync(path.dirname(target.path));
    const shouldProcess = fileExists || target.autoCreate || (options.all && parentDirExists);

    if (!shouldProcess && !options.targets.includes(target.id)) {
      continue;
    }

    detectedClients++;
    console.log(`[TARGET] ${target.name}`);
    console.log(`         Path: ${target.path}`);

    const targetSnippet = target.snippet || MCP_CONFIG_SNIPPET;
    const targetKey = target.serverKey || 'mcpServers';
    const targetEntry = target.entryName || 'privacyscrubber';
    const isTomlTarget = target.format === 'toml';
    const result = isTomlTarget
      ? safeMergeCodexTomlConfig(target.path, targetSnippet, options.remove, targetEntry)
      : safeMergeMcpConfig(target.path, targetSnippet, options.remove, targetKey, targetEntry);

    if (!result.success) {
      console.log(`         [ERROR]: ${result.error}\n`);
      continue;
    }

    if (result.modified === false) {
      console.log(`         [SKIP]: ${result.message}\n`);
      continue;
    }

    const updatedPayload = isTomlTarget ? result.updatedToml : result.updatedJson;

    if (!options.dryRun) {
      try {
        const dir = path.dirname(target.path);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(target.path, updatedPayload, 'utf8');
        console.log(`         [OK]: Successfully ${options.remove ? 'removed from' : 'written to'} config (${result.serverCount} total MCP servers).`);
        configuredCount++;
      } catch (err) {
        console.log(`         [ERROR]: Failed to write file: ${err.message}`);
      }
    } else {
      console.log(`         [DRY-RUN OK]: Would write valid configuration (${result.serverCount} servers).`);
      configuredCount++;
    }
    console.log('');
  }

  if (options.rules && !options.remove) {
    const cwd = process.cwd();
    const mdcPath = path.join(cwd, '.cursor', 'rules', 'privacyscrubber.mdc');
    const agentsMdPath = path.join(cwd, 'AGENTS.md');
    const ruleBody = [
      '# PrivacyScrubber Zero-Trust Agentic Guard (ZTDS)',
      '1. Never read `.env`, `*secret*`, `*credentials*`, `*.pem`, `*.key`, or database dumps with native `read_file` / `cat`. Call `guard_read_file` or `sanitize_file`.',
      '2. Route shell commands that may print credentials or PII through `guard_exec`, and inspect git diffs via `guard_git_diff`.',
      '3. Keep tokens like `[API_KEY_1]`, `[EMAIL_1]` intact during reasoning. Restore final answers via `reveal_text` or write to disk via `guard_apply_patch`.'
    ].join('\n');
    const mdcContent = `---\ndescription: PrivacyScrubber Zero-Trust Data Sanitization (ZTDS) — Mandatory PII & Secret Guard\nglobs: "**/*"\nalwaysApply: true\n---\n\n${ruleBody}\n`;

    if (options.dryRun) {
      console.log(`[DRY-RUN OK]: Would scaffold agent rules in ${mdcPath} and ${agentsMdPath}\n`);
    } else {
      try {
        fs.mkdirSync(path.dirname(mdcPath), { recursive: true });
        if (!fs.existsSync(mdcPath) || !fs.readFileSync(mdcPath, 'utf8').includes('PrivacyScrubber Zero-Trust Agentic Guard')) {
          fs.writeFileSync(mdcPath, mdcContent, 'utf8');
          console.log(`[RULES] Created ${mdcPath}`);
        }
        if (!fs.existsSync(agentsMdPath)) {
          fs.writeFileSync(agentsMdPath, ruleBody + '\n', 'utf8');
          console.log(`[RULES] Created ${agentsMdPath}`);
        } else {
          const existingAgents = fs.readFileSync(agentsMdPath, 'utf8');
          if (!existingAgents.includes('PrivacyScrubber Zero-Trust Agentic Guard')) {
            fs.writeFileSync(agentsMdPath, existingAgents.trimEnd() + '\n\n' + ruleBody + '\n', 'utf8');
            console.log(`[RULES] Updated ${agentsMdPath}`);
          }
        }
      } catch (_) {}
    }
  }

  if (options.hooks && !options.remove) {
    const cwd = process.cwd();
    const cursorHooksPath = path.join(cwd, '.cursor', 'hooks.json');
    const claudeSettingsPath = path.join(cwd, '.claude', 'settings.json');
    const hookCmd = 'npx -y @privacyscrubber/mcp-server --hook';

    if (options.dryRun) {
      console.log(`[DRY-RUN OK]: Would scaffold IDE lifecycle hooks in ${cursorHooksPath} and ${claudeSettingsPath}\n`);
    } else {
      try {
        fs.mkdirSync(path.dirname(cursorHooksPath), { recursive: true });
        let cursorHooks = { version: 1, hooks: {} };
        if (fs.existsSync(cursorHooksPath)) {
          try { cursorHooks = JSON.parse(fs.readFileSync(cursorHooksPath, 'utf8')); } catch (_) {}
        }
        if (!cursorHooks.hooks || typeof cursorHooks.hooks !== 'object') cursorHooks.hooks = {};
        for (const ev of ['beforeReadFile', 'beforeShellExecution']) {
          if (!Array.isArray(cursorHooks.hooks[ev])) cursorHooks.hooks[ev] = [];
          if (!cursorHooks.hooks[ev].some(h => h && h.command && h.command.includes('privacyscrubber'))) {
            cursorHooks.hooks[ev].push({ command: hookCmd });
          }
        }
        fs.writeFileSync(cursorHooksPath, JSON.stringify(cursorHooks, null, 2) + '\n', 'utf8');
        console.log(`[HOOKS] Configured ${cursorHooksPath}`);

        fs.mkdirSync(path.dirname(claudeSettingsPath), { recursive: true });
        let claudeSettings = {};
        if (fs.existsSync(claudeSettingsPath)) {
          try { claudeSettings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8')); } catch (_) {}
        }
        if (!claudeSettings.hooks || typeof claudeSettings.hooks !== 'object') claudeSettings.hooks = {};
        if (!Array.isArray(claudeSettings.hooks.PreToolUse)) claudeSettings.hooks.PreToolUse = [];
        const hasClaudeHook = claudeSettings.hooks.PreToolUse.some(entry =>
          Array.isArray(entry?.hooks) && entry.hooks.some(h => h && h.command && h.command.includes('privacyscrubber'))
        );
        if (!hasClaudeHook) {
          claudeSettings.hooks.PreToolUse.push({
            matcher: 'Read|Bash',
            hooks: [{ type: 'command', command: hookCmd }]
          });
        }
        fs.writeFileSync(claudeSettingsPath, JSON.stringify(claudeSettings, null, 2) + '\n', 'utf8');
        console.log(`[HOOKS] Configured ${claudeSettingsPath}`);
      } catch (_) {}
    }
  }

  console.log('--------------------------------------------------');
  if (configuredCount > 0) {
    console.log(`[SUMMARY] ${options.remove ? 'Cleaned' : 'Configured'} ${configuredCount} AI client(s) successfully.`);
    if (!options.remove) {
      console.log('Next step: Restart your AI IDE or Claude Desktop to activate PrivacyScrubber.');
      console.log('\x1b[36m💼 B2B 7-Day Free Trial (TEAMS $99/mo · SDK $299/mo): npx @privacyscrubber/mcp-server trial  |  https://privacyscrubber.com/pricing/?tier=teams&trial=true&utm_source=mcp_install\x1b[0m');
      console.log('\x1b[36m📋 Generate CISO Procurement Memo:   npx @privacyscrubber/mcp-server memo\x1b[0m');
      console.log('\x1b[33m⭐ Enjoying zero-trust privacy? Star the repo on GitHub: https://github.com/moxno/privacyscrubber-mcp\x1b[0m');
      console.log('\x1b[90m   One-click CLI: gh repo star moxno/privacyscrubber-mcp && gh repo star moxno/ztds.ai\x1b[0m');
      console.log('\x1b[90m   Feedback / Report missed entity: https://privacyscrubber.com/uninstall/?mode=feedback&src=mcp\x1b[0m');
      if (!options.dryRun) {
        await promptGitHubStarIfInteractive();
      }
    } else {
      console.log('\n[FEEDBACK] Why did you remove PrivacyScrubber MCP? (1-click instant log — no form typing):');
      console.log('  - Setup / IDE issue:      https://privacyscrubber.com/uninstall/?src=mcp&reason=setup');
      console.log('  - Detection / Accuracy:   https://privacyscrubber.com/uninstall/?src=mcp&reason=accuracy');
      console.log('  - Free limit / Pricing:   https://privacyscrubber.com/uninstall/?src=mcp&reason=limit');
      console.log('  - General feedback:       https://privacyscrubber.com/uninstall/?mode=feedback&src=mcp');
    }
  } else {
    console.log('[SUMMARY] No active client configurations were modified.');
    if (options.remove) {
      console.log('[FEEDBACK] Share why you uninstalled (1-click): https://privacyscrubber.com/uninstall/?src=mcp');
    } else {
      console.log('Tip: Run with --all or specify client directly (--cursor, --claude, --windsurf).');
      console.log('⭐ GitHub Repository: https://github.com/moxno/privacyscrubber-mcp');
    }
  }
  console.log('--------------------------------------------------\n');

  return { configured: configuredCount, detected: detectedClients };
}

function runDoctorHookCase(hookPath, payloadObj, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timer = null;
    let proc = null;

    const finish = (res) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (proc && !proc.killed) {
        try { proc.kill(); } catch (_) {}
      }
      resolve(res);
    };

    try {
      proc = spawn(process.execPath, [hookPath, '--hook'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' }
      });
    } catch (err) {
      return finish({ code: -1, stdout: '', stderr: err.message, parsed: null });
    }

    timer = setTimeout(() => {
      finish({ code: -1, stdout, stderr: 'Hook self-test timed out', parsed: null });
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => finish({ code: -1, stdout, stderr: err.message, parsed: null }));
    proc.on('close', (code) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch (_) {}
      finish({ code, stdout, stderr, parsed });
    });

    proc.stdin.write(JSON.stringify(payloadObj));
    proc.stdin.end();
  });
}

function runDoctorMcpRpcCheck(serverPath, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let buf = '';
    let stderr = '';
    let timer = null;
    let proc = null;
    let initResp = null;

    const finish = (res) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (proc && !proc.killed) {
        try { proc.kill(); } catch (_) {}
      }
      resolve(res);
    };

    try {
      proc = spawn(process.execPath, [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test', PRIVACYSCRUBBER_TEST_MODE: '1' }
      });
    } catch (err) {
      return finish({ ok: false, toolCount: 0, serverVersion: null, detail: err.message });
    }

    timer = setTimeout(() => {
      finish({ ok: false, toolCount: 0, serverVersion: null, detail: `MCP JSON-RPC check timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => finish({ ok: false, toolCount: 0, serverVersion: null, detail: err.message }));
    proc.on('close', (code) => {
      if (!settled) {
        finish({ ok: false, toolCount: 0, serverVersion: null, detail: `MCP server exited early (code ${code}): ${stderr.trim() || 'no output'}` });
      }
    });

    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line || !line.startsWith('{')) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1) {
            initResp = msg;
            proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
          } else if (msg.id === 2) {
            const tools = msg?.result?.tools;
            const serverVersion = initResp?.result?.serverInfo?.version || null;
            const hasInit = Boolean(initResp?.result?.serverInfo || initResp?.result?.protocolVersion);
            const hasTools = Array.isArray(tools) && tools.length > 0;
            finish({
              ok: hasInit && hasTools,
              toolCount: hasTools ? tools.length : 0,
              serverVersion,
              detail: hasInit && hasTools
                ? `initialize OK (v${serverVersion || 'unknown'}), tools/list returned ${tools.length} tool(s)`
                : 'Invalid initialize or tools/list response'
            });
          }
        } catch (_) {}
      }
    });

    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ps-doctor', version: '1.0' } }
    }) + '\n');
  });
}

export async function runDoctor(opts = {}) {
  let options = opts;
  if (Array.isArray(options)) {
    options = { json: options.includes('--json'), silent: options.includes('--silent') };
  } else if (!options || typeof options !== 'object') {
    options = {};
  }

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000;
  const serverPath = options.serverPath || path.join(__installDirname, 'index.js');
  const hookPath = options.hookPath || path.join(__installDirname, 'pii-masking-run.js');

  // 1. Node.js version check (>= 18)
  const nodeVersion = process.versions.node || '0.0.0';
  const nodeMajor = parseInt(nodeVersion.split('.')[0], 10) || 0;
  const nodeOk = nodeMajor >= 18;

  // 2. Core engine load & round-trip smoke check
  let engineOk = false;
  let engineDetail = '';
  try {
    const core = requireCjs(path.join(__installDirname, 'scrubber-core.cjs'));
    core.init();
    const probe = core.scrubText('Contact ops@acme.test', {}, {}, 'general', {}, false);
    const restored = core.unscrubText(probe.scrubbedText, probe.tokenMap);
    engineOk = Boolean(
      probe &&
      typeof probe.scrubbedText === 'string' &&
      !probe.scrubbedText.includes('ops@acme.test') &&
      restored &&
      typeof restored.restoredText === 'string' &&
      restored.restoredText.includes('ops@acme.test')
    );
    engineDetail = engineOk ? 'scrubber-core.cjs loaded and round-trip scrub/unscrub verified' : 'Core round-trip check failed';
  } catch (err) {
    engineDetail = `Failed to load scrubber-core.cjs: ${err.message}`;
  }

  // 3. Live MCP JSON-RPC initialize + tools/list
  const mcpCheck = await runDoctorMcpRpcCheck(serverPath, timeoutMs);

  // 4. --hook self-test (.env denied, .env.example allowed)
  const denyTarget = path.join(os.tmpdir(), 'ps-doctor-selftest', '.env');
  const allowTarget = path.join(os.tmpdir(), 'ps-doctor-selftest', '.env.example');
  const [denyCase, allowCase] = await Promise.all([
    runDoctorHookCase(hookPath, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: denyTarget } }, timeoutMs),
    runDoctorHookCase(hookPath, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: allowTarget } }, timeoutMs)
  ]);
  const envDenied = denyCase.code === 2 && (denyCase.parsed?.permission === 'deny' || denyCase.parsed?.hookSpecificOutput?.permissionDecision === 'deny');
  const exampleAllowed = allowCase.code === 0 && allowCase.parsed?.permission === 'allow';
  const hookOk = envDenied && exampleAllowed;
  const hookDetail = hookOk
    ? '.env denied (exit 2) and .env.example allowed (exit 0)'
    : `.env denied=${envDenied} (code=${denyCase.code}), .env.example allowed=${exampleAllowed} (code=${allowCase.code})`;

  // 5. License status
  const rawKey = (
    process.env.PRIVACYSCRUBBER_KEY ||
    process.env.PRIVACYSCRUBBER_LICENSE_KEY ||
    process.env.ZTDS_LICENSE ||
    process.env.ZTDS_LICENSE_KEY ||
    ''
  ).trim();
  let licenseValid = false;
  let licenseTier = 'FREE';
  let licenseStatus = 'free';
  let licenseDetail = 'Free Tier (15k General / 5k Specialized trial quota; set PRIVACYSCRUBBER_KEY for PRO/TEAMS/SDK)';
  if (rawKey) {
    try {
      let lm;
      try {
        lm = requireCjs(path.join(__installDirname, 'ps-license-manager.cjs'));
      } catch (_) {
        lm = requireCjs(path.join(__installDirname, 'ps-license-manager.js'));
      }
      const res = lm && typeof lm.validate === 'function' ? lm.validate(rawKey) : { valid: false, reason: 'LicenseManager unavailable' };
      if (res && res.valid) {
        licenseValid = true;
        licenseTier = res.tier || 'PRO';
        licenseStatus = 'active';
        licenseDetail = `Active ${licenseTier} license verified`;
      } else {
        licenseTier = 'INVALID';
        licenseStatus = 'warn';
        licenseDetail = (res && res.reason) || 'Configured license key is invalid or expired';
      }
    } catch (err) {
      licenseTier = 'UNKNOWN';
      licenseStatus = 'warn';
      licenseDetail = `License check error: ${err.message}`;
    }
  }

  // 6. Configured IDE targets
  const targets = getSupportedTargets(options.workspaceDir || null);
  const targetStatuses = [];
  let detectedCount = 0;
  let configuredCount = 0;

  for (const target of targets) {
    const exists = fs.existsSync(target.path);
    let configured = false;
    let parseError = null;
    if (exists) {
      detectedCount++;
      try {
        const raw = fs.readFileSync(target.path, 'utf8');
        if (target.format === 'toml') {
          const entry = target.entryName || 'privacyscrubber';
          const rx = new RegExp(`^\\s*\\[\\s*mcp_servers\\.${entry.replace(/[.*+?^${}()|[\\]\\\\]/g, '')}\\s*\\]`, 'm');
          configured = rx.test(raw);
        } else if (raw.trim()) {
          const parsed = JSON.parse(raw);
          const serverKey = target.serverKey || 'mcpServers';
          const entry = target.entryName || 'privacyscrubber';
          const bucket = parsed && typeof parsed === 'object' ? parsed[serverKey] : null;
          configured = Boolean(bucket && typeof bucket === 'object' && (bucket[entry] || bucket.privacyscrubber));
        }
      } catch (err) {
        parseError = err.message;
      }
    }
    if (configured) configuredCount++;
    targetStatuses.push({
      id: target.id,
      name: target.name,
      path: target.path,
      exists,
      configured,
      ...(parseError ? { error: parseError } : {})
    });
  }

  const report = {
    ok: Boolean(nodeOk && engineOk && mcpCheck.ok && hookOk),
    checks: {
      node: { ok: nodeOk, version: nodeVersion, required: '>=18.0.0' },
      coreEngine: { ok: engineOk, detail: engineDetail },
      mcpServer: mcpCheck,
      hookSelfTest: { ok: hookOk, envDenied, exampleAllowed, detail: hookDetail },
      license: { ok: true, valid: licenseValid, tier: licenseTier, configured: Boolean(rawKey), status: licenseStatus, detail: licenseDetail },
      ideTargets: { ok: true, configuredCount, detectedCount, targets: targetStatuses }
    },
    summary: {
      passed: [nodeOk, engineOk, mcpCheck.ok, hookOk, true, true].filter(Boolean).length,
      total: 6
    }
  };

  if (!options.silent) {
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('--------------------------------------------------');
      console.log('PrivacyScrubber MCP Doctor');
      console.log('--------------------------------------------------');
      console.log(`[${nodeOk ? 'PASS' : 'FAIL'}] Node.js runtime: v${nodeVersion} (requires >=18.0.0)`);
      console.log(`[${engineOk ? 'PASS' : 'FAIL'}] Core engine: ${engineDetail}`);
      console.log(`[${mcpCheck.ok ? 'PASS' : 'FAIL'}] Live MCP JSON-RPC: ${mcpCheck.detail}`);
      console.log(`[${hookOk ? 'PASS' : 'FAIL'}] --hook guard self-test: ${hookDetail}`);
      console.log(`[${licenseStatus === 'warn' ? 'WARN' : 'INFO'}] License: ${licenseDetail}`);
      console.log(`[INFO] IDE configs: ${configuredCount} configured (${detectedCount} detected of ${targetStatuses.length} supported targets)`);
      for (const t of targetStatuses) {
        if (t.configured || t.exists) {
          console.log(`       - ${t.id}: ${t.configured ? 'configured' : 'present (not configured)'} (${t.path})`);
        }
      }
      if (configuredCount === 0) {
        console.log('       Tip: Run `npx @privacyscrubber/mcp-server init --all` to configure detected IDEs.');
      }
      console.log('--------------------------------------------------');
      console.log(`Result: ${report.ok ? 'HEALTHY' : 'ISSUES DETECTED'} (${report.summary.passed}/${report.summary.total} checks)`);
    }
  }

  return report;
}

// Auto-run when executed as entry script
const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
  process.argv[1].endsWith('install.js') ||
  process.argv[1].endsWith('privacyscrubber-mcp-install')
);

if (isMain) {
  const cliArgs = process.argv.slice(2);
  if (cliArgs[0] === 'doctor' || cliArgs.includes('--doctor')) {
    runDoctor({ json: cliArgs.includes('--json') })
      .then((report) => {
        process.exit(report && report.ok ? 0 : 1);
      })
      .catch((err) => {
        console.error('Fatal doctor error:', err);
        process.exit(1);
      });
  } else {
    runInstaller().catch(err => {
      console.error('Fatal installer error:', err);
      process.exit(1);
    });
  }
}
