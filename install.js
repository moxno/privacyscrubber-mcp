#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';

console.log('🛡️ PrivacyScrubber MCP Server 1-Click Installer');
console.log('================================================\n');

const mcpConfig = {
  command: "npx",
  args: ["-y", "@privacyscrubber/mcp-server"]
};

let claudeConfigPath = '';
if (process.platform === 'darwin') {
  claudeConfigPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
} else if (process.platform === 'win32') {
  claudeConfigPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
} else {
  // Linux fallback, though Claude Desktop is not officially supported on Linux yet, we check common paths
  claudeConfigPath = path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

// 1. Configure Claude Desktop
let installedClaude = false;
try {
  let configDir = path.dirname(claudeConfigPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let config = {};
  if (fs.existsSync(claudeConfigPath)) {
    const rawData = fs.readFileSync(claudeConfigPath, 'utf8');
    if (rawData.trim() !== '') {
      config = JSON.parse(rawData);
    }
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  config.mcpServers['privacyscrubber'] = mcpConfig;

  fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2), 'utf8');
  console.log(`✅ [Claude Desktop] Successfully injected PrivacyScrubber MCP into:`);
  console.log(`   ${claudeConfigPath}`);
  installedClaude = true;
} catch (e) {
  console.log(`⚠️ [Claude Desktop] Could not configure automatically: ${e.message}`);
}

console.log('\n---');
console.log('\n🔵 [Cursor / Windsurf Users]');
console.log('To install PrivacyScrubber in Cursor or Windsurf:');
console.log('1. Open Settings -> Features -> MCP Servers (or type "MCP" in settings).');
console.log('2. Click "+ Add New MCP Server".');
console.log('3. Set Name: privacyscrubber');
console.log('4. Set Type: command');
console.log('5. Set Command: npx -y @privacyscrubber/mcp-server');
console.log('\n🚀 Installation complete! Restart your IDE or Claude Desktop to start redacting PII locally.');
