import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexScript = path.resolve(__dirname, 'index.js');
const validKey = "eyJ0eXBlIjoicHJvIiwiZXhwaXJlcyI6MjA5OTA2MjE3NCwiaXNzdWVkQXQiOjE3ODM3MDIxNzQsIm5vbmNlIjoiMmI4MTllN2ZmM2ZmOTFmYiJ9.ZmhaKDGf9vG0nTH0nyOy3EInsuUmzjBOk9IOyiqzt6Y5s3UG+2yRExuKBoeXWymbpJt3NIJNM9sVxxl+lcop5wqbi2LNtPY4MuwBRA7pO4nn3Bes5R0lxLbEYVE8Iiw3zbfK4uVYQ53BJ7El6JCeFKPJ5WbKUsPLsjb1Lr2iQzW3ODOMaM5jKdgAGcNpuWQ373D7SW7I03Jec9kvP5hL7j3u4DV8ZzuQFzy2Nh+uMH54suydg2sNIpxrRQyxpGv7rZjTO1KT+xzzqnjqX4Pein0e6GrC5E4JUEggADtXPFMKW5SEiWzeeirB5RUPMO/F927S5fFuOYHAfuar2FqErA==";

async function runTest() {
  console.log("Starting MCP Custom Rules Integration Test...");

  // 1. Start Server WITH PRO key and Custom Rules JSON
  console.log("\n--- TEST CASE 1: PRO Tier with Custom Rules ---");
  const mcpProcess1 = spawn('node', [indexScript], {
    env: {
      ...process.env,
      PRIVACYSCRUBBER_KEY: validKey,
      PRIVACYSCRUBBER_RULES_JSON: JSON.stringify([
        { label: "MY_PROJECT", pattern: "Project-Apollo" },
        { label: "CONFIDENTIAL_CODE", pattern: "sk-special-[a-z0-9]+" }
      ])
    }
  });

  const sendRequest = (proc, method, params) => {
    return new Promise((resolve) => {
      let buffer = '';
      const onData = (data) => {
        buffer += data.toString();
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex !== -1) {
          const line = buffer.substring(0, newlineIndex).trim();
          proc.stdout.off('data', onData);
          try {
            resolve(JSON.parse(line));
          } catch (e) {
            resolve({ error: e.message });
          }
        }
      };
      proc.stdout.on('data', onData);
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n');
    });
  };

  // Initialize
  await sendRequest(mcpProcess1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });

  // Call sanitize_text with custom rules matches
  const text1 = "The codebase for Project-Apollo is located on server. Key is sk-special-987241.";
  const res1 = await sendRequest(mcpProcess1, 'tools/call', {
    name: 'sanitize_text',
    arguments: { text: text1, profile: 'General' }
  });

  const output1 = res1.result?.content?.[0]?.text || '';
  console.log("Raw Input:  ", text1);
  console.log("Scrubbed:   ", output1);

  mcpProcess1.kill();

  if (!output1.includes("[MY_PROJECT_1]") || !output1.includes("[CONFIDENTIAL_CODE_1]")) {
    console.error("❌ Test Case 1 failed: custom rules were not applied on PRO tier!");
    process.exit(1);
  }
  console.log("✅ Test Case 1 passed: custom rules successfully loaded and applied.");

  // 2. Start Server WITH FREE tier and Custom Rules JSON (should NOT apply custom rules)
  console.log("\n--- TEST CASE 2: Free Tier with Custom Rules ---");
  const mcpProcess2 = spawn('node', [indexScript], {
    env: {
      ...process.env,
      PRIVACYSCRUBBER_KEY: "", // Free tier
      PRIVACYSCRUBBER_RULES_JSON: JSON.stringify([
        { label: "MY_PROJECT", pattern: "Project-Apollo" },
        { label: "CONFIDENTIAL_CODE", pattern: "sk-special-[a-z0-9]+" }
      ])
    }
  });

  await sendRequest(mcpProcess2, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });

  const res2 = await sendRequest(mcpProcess2, 'tools/call', {
    name: 'sanitize_text',
    arguments: { text: text1, profile: 'General' }
  });

  const output2 = res2.result?.content?.[0]?.text || '';
  console.log("Raw Input:  ", text1);
  console.log("Scrubbed:   ", output2);

  mcpProcess2.kill();

  if (output2.includes("[MY_PROJECT_1]") || output2.includes("[CONFIDENTIAL_CODE_1]")) {
    console.error("❌ Test Case 2 failed: custom rules were applied on Free tier!");
    process.exit(1);
  }
  console.log("✅ Test Case 2 passed: custom rules were successfully ignored on Free tier.");

  console.log("\n🎉 All Custom Rules verification tests passed!");
  process.exit(0);
}

runTest();
