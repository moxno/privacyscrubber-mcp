#!/usr/bin/env node

/**
 * PrivacyScrubber MCP Server Universal Auto-Configurator & Installer
 * Supports: Claude Desktop, Cursor (Global & Workspace), Windsurf, Cline / Roo-Code
 * 
 * Safely merges 'privacyscrubber' into mcpServers without corrupting or deleting existing tools.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

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
    autoCreate: false
  });

  return targets;
}

export function parseArgs(rawArgs = process.argv.slice(2)) {
  const options = {
    dryRun: false,
    remove: false,
    all: false,
    targets: [],
    help: false
  };

  for (const arg of rawArgs) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--remove' || arg === '--uninstall') options.remove = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--claude') options.targets.push('claude');
    else if (arg === '--cursor') options.targets.push('cursor', 'cursor-storage', 'cursor-workspace');
    else if (arg === '--windsurf') options.targets.push('windsurf');
    else if (arg === '--cline') options.targets.push('cline', 'roo');
    else if (arg === '--workspace') options.targets.push('cursor-workspace');
    else if (arg === '--help' || arg === '-h') options.help = true;
  }

  return options;
}

export function safeMergeMcpConfig(filePath, snippet = MCP_CONFIG_SNIPPET, remove = false) {
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

  if (!configObj.mcpServers || typeof configObj.mcpServers !== 'object' || Array.isArray(configObj.mcpServers)) {
    configObj.mcpServers = {};
  }

  if (remove) {
    if (configObj.mcpServers['privacyscrubber']) {
      delete configObj.mcpServers['privacyscrubber'];
    } else {
      return { success: true, modified: false, message: 'privacyscrubber was not present' };
    }
  } else {
    configObj.mcpServers['privacyscrubber'] = snippet;
  }

  const updatedJson = JSON.stringify(configObj, null, 2) + '\n';
  return {
    success: true,
    modified: true,
    fileExisted,
    updatedJson,
    serverCount: Object.keys(configObj.mcpServers).length
  };
}

export async function runInstaller(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);

  if (options.help) {
    console.log(`
PrivacyScrubber MCP Auto-Configurator
Usage:
  npx @privacyscrubber/mcp-server init [options]
  npx @privacyscrubber/mcp-server-install [options]

Options:
  --all           Configure all detected and standard client paths
  --cursor        Configure Cursor only (~/.cursor/mcp.json)
  --claude        Configure Claude Desktop only
  --windsurf      Configure Windsurf only
  --cline         Configure Cline / Roo-Code only
  --workspace     Configure current project .cursor/mcp.json
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

    const result = safeMergeMcpConfig(target.path, MCP_CONFIG_SNIPPET, options.remove);

    if (!result.success) {
      console.log(`         [ERROR]: ${result.error}\n`);
      continue;
    }

    if (result.modified === false) {
      console.log(`         [SKIP]: ${result.message}\n`);
      continue;
    }

    if (!options.dryRun) {
      try {
        const dir = path.dirname(target.path);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(target.path, result.updatedJson, 'utf8');
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

  console.log('--------------------------------------------------');
  if (configuredCount > 0) {
    console.log(`[SUMMARY] ${options.remove ? 'Cleaned' : 'Configured'} ${configuredCount} AI client(s) successfully.`);
    if (!options.remove) {
      console.log('Next step: Restart your AI IDE or Claude Desktop to activate PrivacyScrubber.');
      console.log('\x1b[33m⭐ Enjoying zero-trust privacy? Star the repo on GitHub: https://github.com/moxno/privacyscrubber-mcp\x1b[0m');
      console.log('\x1b[90m   One-click CLI: gh repo star moxno/privacyscrubber-mcp\x1b[0m');
    }
  } else {
    console.log('[SUMMARY] No active client configurations were modified.');
    console.log('Tip: Run with --all or specify client directly (--cursor, --claude, --windsurf).');
    console.log('⭐ GitHub Repository: https://github.com/moxno/privacyscrubber-mcp');
  }
  console.log('--------------------------------------------------\n');

  return { configured: configuredCount, detected: detectedClients };
}

// Auto-run when executed as entry script
const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
  process.argv[1].endsWith('install.js') ||
  process.argv[1].endsWith('privacyscrubber-mcp-install')
);

if (isMain) {
  runInstaller().catch(err => {
    console.error('Fatal installer error:', err);
    process.exit(1);
  });
}
