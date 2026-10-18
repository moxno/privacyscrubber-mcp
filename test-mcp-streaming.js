/**
 * PrivacyScrubber MCP Server — Real-Time Streaming & Token-Split Guard Test Suite
 * Conforms to ZTDS RFC v1.0 and IETF draft-sibiryakov-ztds-protocol-02.
 */

import assert from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_PATH = path.resolve(__dirname, 'index.js');

console.log('🧪 Starting PrivacyScrubber MCP Streaming & Token-Split Guard Verification Suite...\n');

class JsonRpcMcpClient {
  constructor(serverPath, env = {}) {
    this.serverPath = serverPath;
    this.env = { ...process.env, ...env };
    this.proc = null;
    this.msgId = 0;
    this.pendingRequests = new Map();
    this.buffer = '';
    this.stderrOutput = '';
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(process.execPath, [this.serverPath], {
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.proc.stdout.on('data', (chunk) => {
        this.buffer += chunk.toString('utf8');
        this.drainBuffer();
      });

      this.proc.stderr.on('data', (chunk) => {
        this.stderrOutput += chunk.toString('utf8');
      });

      this.proc.on('error', (err) => {
        reject(err);
      });

      this.proc.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          for (const [id, { reject: pReject }] of this.pendingRequests.entries()) {
            pReject(new Error(`MCP server exited unexpectedly with code ${code}`));
          }
          this.pendingRequests.clear();
        }
      });

      // Send initialize request
      this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-streaming-client', version: '1.0.0' }
      }).then((res) => {
        resolve(res);
      }).catch(reject);
    });
  }

  drainBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // Keep trailing incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const { resolve, reject } = this.pendingRequests.get(msg.id);
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      } catch (_) {
        // Not a JSON-RPC message, ignore
      }
    }
  }

  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pendingRequests.set(id, { resolve, reject });
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      }) + '\n';
      this.proc.stdin.write(payload);
    });
  }

  async callTool(name, args = {}) {
    const res = await this.request('tools/call', { name, arguments: args });
    return res;
  }

  stop() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
    }
  }
}

async function runStreamingSuite() {
  const client = new JsonRpcMcpClient(MCP_SERVER_PATH, {
    PRIVACYSCRUBBER_KEY: 'test-pro-key'
  });

  try {
    console.log('--> Spawning MCP Server over Stdio JSON-RPC transport...');
    const initResult = await client.start();
    assert.ok(initResult, 'Server must return initialize result');
    console.log('✅ Connected to MCP Server via stdio.\n');

    // 1. Verify Tool Registration
    console.log('--> [Test 1] Checking tool registration in tools/list...');
    const toolList = await client.request('tools/list', {});
    const tools = toolList.tools || [];
    const streamTool = tools.find(t => t.name === 'stream_reveal_text');
    const revealTool = tools.find(t => t.name === 'reveal_text');

    assert.ok(streamTool, 'stream_reveal_text must be registered in tools/list');
    assert.ok(revealTool, 'reveal_text must be registered in tools/list');
    assert.ok(revealTool.inputSchema.properties.stream, 'reveal_text must support "stream" parameter');
    assert.ok(revealTool.inputSchema.properties.flush, 'reveal_text must support "flush" parameter');
    console.log('✅ Test 1 Passed: Both stream_reveal_text and reveal_text(stream) registered with complete schemas.\n');

    // 2. Establish Session Tokens via sanitize_text
    console.log('--> [Test 2] Establishing session tokens with sanitize_text...');
    const sanitizeResult = await client.callTool('sanitize_text', {
      text: 'Patient Alice Brown, email alice.brown@mayo.clinic, phone +1-555-0199, SSN 000-12-3456.',
      profile: 'General',
      session_id: 'stream-session-1'
    });

    const sanitizedText = sanitizeResult.content[0].text;
    assert.ok(sanitizedText.includes('[EMAIL_1]'), 'Sanitized text must contain [EMAIL_1]');
    assert.ok(sanitizedText.includes('[PHONE_1]'), 'Sanitized text must contain [PHONE_1]');
    assert.ok(!sanitizedText.includes('alice.brown@mayo.clinic'), 'Raw email must not remain in output');
    console.log('✅ Test 2 Passed: Tokens populated in RAM session.\n');

    // 3. Token split across 2 chunks via stream_reveal_text
    console.log('--> [Test 3] Token split across 2 chunks via stream_reveal_text...');
    const chunk1 = 'Contact confirmed for [NAME_1] at [EM';
    const chunk2 = 'AIL_1] via secure portal.';

    const r1 = await client.callTool('stream_reveal_text', {
      chunk: chunk1,
      flush: false,
      session_id: 'stream-session-1'
    });

    const r2 = await client.callTool('stream_reveal_text', {
      chunk: chunk2,
      flush: true,
      session_id: 'stream-session-1'
    });

    const out1 = r1.content[0].text;
    const out2 = r2.content[0].text;

    assert.strictEqual(out1, 'Contact confirmed for Alice Brown at ');
    assert.strictEqual(out2, 'alice.brown@mayo.clinic via secure portal.');
    assert.strictEqual(out1 + out2, 'Contact confirmed for Alice Brown at alice.brown@mayo.clinic via secure portal.');
    console.log('✅ Test 3 Passed: Split token [EM + AIL_1] buffered and restored across 2 chunks without corruption.\n');

    // 4. Token split across 3 chunks via stream_reveal_text
    console.log('--> [Test 4] Token split across 3 chunks via stream_reveal_text...');
    const c1 = 'Call hotline at [';
    const c2 = 'PHONE_';
    const c3 = '1] today.';

    const res1 = await client.callTool('stream_reveal_text', { chunk: c1, flush: false, session_id: 'stream-session-1' });
    const res2 = await client.callTool('stream_reveal_text', { chunk: c2, flush: false, session_id: 'stream-session-1' });
    const res3 = await client.callTool('stream_reveal_text', { chunk: c3, flush: true, session_id: 'stream-session-1' });

    assert.strictEqual(res1.content[0].text, 'Call hotline at ');
    assert.strictEqual(res2.content[0].text, '');
    assert.strictEqual(res3.content[0].text, '+1-555-0199 today.');
    assert.strictEqual(res1.content[0].text + res2.content[0].text + res3.content[0].text, 'Call hotline at +1-555-0199 today.');
    console.log('✅ Test 4 Passed: 3-chunk fragmented token buffered and restored seamlessly.\n');

    // 5. reveal_text in streaming mode (stream: true)
    console.log('--> [Test 5] Testing reveal_text with stream: true and flush parameter...');
    const s1 = await client.callTool('reveal_text', {
      text: 'Verified SSN is [',
      stream: true,
      flush: false,
      session_id: 'stream-session-1'
    });
    const s2 = await client.callTool('reveal_text', {
      text: 'ID_1] on file.',
      stream: true,
      flush: true,
      session_id: 'stream-session-1'
    });

    assert.strictEqual(s1.content[0].text, 'Verified SSN is ');
    assert.strictEqual(s2.content[0].text, '000-12-3456 on file.');
    console.log('✅ Test 5 Passed: reveal_text with stream: true correctly activates StreamingDetokenizer.\n');

    // 6. 1-Character Extreme Streaming Split Test
    console.log('--> [Test 6] 1-character extreme streaming chunks over stdio...');
    const streamSentence = 'Notification sent to [EMAIL_1] successfully.';
    let charStreamOutput = '';

    for (let i = 0; i < streamSentence.length; i++) {
      const isLast = i === streamSentence.length - 1;
      const step = await client.callTool('stream_reveal_text', {
        chunk: streamSentence[i],
        flush: isLast,
        session_id: 'stream-session-1'
      });
      charStreamOutput += step.content[0].text;
    }

    assert.strictEqual(charStreamOutput, 'Notification sent to alice.brown@mayo.clinic successfully.');
    console.log('✅ Test 6 Passed: 1-character stream chunks reconstructed with 100% bit-for-bit fidelity.\n');

    // 7. Non-token brackets preserved without corruption
    console.log('--> [Test 7] Preserving non-token brackets (e.g. array indexing or citation)...');
    const b1 = await client.callTool('stream_reveal_text', { chunk: 'Lookup matrix[', flush: false, session_id: 'stream-session-1' });
    const b2 = await client.callTool('stream_reveal_text', { chunk: '42] is ready.', flush: true, session_id: 'stream-session-1' });
    assert.strictEqual(b1.content[0].text + b2.content[0].text, 'Lookup matrix[42] is ready.');
    console.log('✅ Test 7 Passed: Non-token bracketed syntax preserved without corruption.\n');

    // 8. Multi-Agent Session Isolation for Concurrent Streams
    console.log('--> [Test 8] Multi-agent streaming isolation between session A and session B...');
    await client.callTool('sanitize_text', {
      text: 'User Alpha: alpha@company.org',
      session_id: 'agent-A'
    });
    await client.callTool('sanitize_text', {
      text: 'User Beta: beta@partner.net',
      session_id: 'agent-B'
    });

    const streamA1 = await client.callTool('stream_reveal_text', { chunk: 'Alpha is [EM', flush: false, session_id: 'agent-A' });
    const streamB1 = await client.callTool('stream_reveal_text', { chunk: 'Beta is [EM', flush: false, session_id: 'agent-B' });
    const streamA2 = await client.callTool('stream_reveal_text', { chunk: 'AIL_1]', flush: true, session_id: 'agent-A' });
    const streamB2 = await client.callTool('stream_reveal_text', { chunk: 'AIL_1]', flush: true, session_id: 'agent-B' });

    assert.strictEqual(streamA1.content[0].text + streamA2.content[0].text, 'Alpha is alpha@company.org');
    assert.strictEqual(streamB1.content[0].text + streamB2.content[0].text, 'Beta is beta@partner.net');
    console.log('✅ Test 8 Passed: Concurrent streaming sessions execute with zero cross-talk.\n');

    // 9. Diagnostics in guard_session_info
    console.log('--> [Test 9] Diagnostics via guard_session_info...');
    const infoRes = await client.callTool('guard_session_info', { session_id: 'stream-session-1' });
    const infoText = infoRes.content[0].text;
    assert.ok(infoText.includes('Stream Buffer:'), 'Session info must display Stream Buffer bytes');
    console.log('✅ Test 9 Passed: Stream buffer metrics displayed in diagnostics.\n');

    // 10. Purge and Zeroization via guard_session_reset
    console.log('--> [Test 10] Zeroization via guard_session_reset...');
    await client.callTool('guard_session_reset', { session_id: 'stream-session-1' });
    const resetInfo = await client.callTool('guard_session_info', { session_id: 'stream-session-1' });
    assert.ok(resetInfo.content[0].text.includes('does not exist or has expired'), 'Reset session must be purged from RAM');
    console.log('✅ Test 10 Passed: Stream detokenizer and session maps purged from memory.\n');

    console.log('🎉 All 10 Stdio MCP Streaming & Token-Split Guard tests PASSED successfully!');
  } finally {
    client.stop();
  }
}

runStreamingSuite().catch((err) => {
  console.error('\n❌ Streaming test suite failed:', err);
  process.exit(1);
});
