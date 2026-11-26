import { spawn, execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import os from 'os';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexScript = path.resolve(__dirname, 'index.js');

// Helper to send JSON-RPC and wait for response
async function runMcpSession() {
  console.log("Starting MCP Server process...");
  
  // Set up local privacyscrubber.json for custom rules testing
  const configPath = path.resolve(process.cwd(), 'privacyscrubber.json');
  fs.writeFileSync(configPath, JSON.stringify({
    customRules: [
      { pattern: "SECRET_TEST_PAT", label: "TEST_SECRET" }
    ]
  }), 'utf8');

  // Generate ephemeral process-scoped test token + temp preload shim (zero hardcoded keys in git)
  const tempMainHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-mcp-deep-main-'));
  const ephemeralToken = "PS-EPHEMERAL-" + crypto.randomUUID();
  const preloadPath = path.join(tempMainHome, "ps-mcp-test-preload-" + process.pid + ".cjs");
  fs.writeFileSync(preloadPath, [
    'const LM = require(process.env.PS_LM_PATH);',
    'const orig = LM.validate.bind(LM);',
    'LM.validate = function(k, opts) {',
    '  if (k && process.env.PS_EPHEMERAL_TEST_TOKEN && k.trim() === process.env.PS_EPHEMERAL_TEST_TOKEN) {',
    '    return { valid: true, tier: "PRO" };',
    '  }',
    '  return orig(k, opts);',
    '};'
  ].join('\n'), 'utf8');
  
  const mcpProcess = spawn(process.execPath, ['--require', preloadPath, indexScript, '--toolset=full'], {
    env: {
      ...process.env,
      HOME: tempMainHome,
      USERPROFILE: tempMainHome,
      PRIVACYSCRUBBER_KEY: process.env.PS_CI_PRO_TEST_KEY || ephemeralToken,
      PS_EPHEMERAL_TEST_TOKEN: ephemeralToken,
      PS_LM_PATH: path.resolve(__dirname, 'ps-license-manager.cjs')
    }
  });

  let buffer = '';
  const pendingRequests = new Map();
  let nextId = 1;

  mcpProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    // Parse JSON-RPC delimited by newlines
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.substring(0, newlineIndex).trim();
      buffer = buffer.substring(newlineIndex + 1);
      if (line) {
        try {
          const response = JSON.parse(line);
          if (response.id && pendingRequests.has(response.id)) {
            const resolve = pendingRequests.get(response.id);
            pendingRequests.delete(response.id);
            resolve(response);
          }
        } catch (e) {
          console.error("Failed to parse incoming line as JSON:", line, e);
        }
      }
    }
  });

  mcpProcess.stderr.on('data', (data) => {
    console.error(`[Server Stderr]: ${data.toString().trim()}`);
  });

  const sendRequest = (method, params) => {
    return new Promise((resolve) => {
      const id = nextId++;
      pendingRequests.set(id, resolve);
      const requestObj = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };
      mcpProcess.stdin.write(JSON.stringify(requestObj) + '\n');
    });
  };

  try {
    // 1. Initialize
    console.log("--> Sending 'initialize' request...");
    const initResponse = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    });
    console.log("<-- Initialize response received:", JSON.stringify(initResponse).substring(0, 150) + "...");

    // 2. List tools
    console.log("--> Sending 'tools/list' request...");
    const toolsResponse = await sendRequest('tools/list', {});
    const tools = toolsResponse.result?.tools || [];
    console.log(`<-- Tools list received. Total tools: ${tools.length}`);
    tools.forEach(t => console.log(`  - Tool: ${t.name} (${t.description.substring(0, 60)}...)`));

    if (tools.length !== 27) {
      throw new Error(`Expected 27 tools in default full toolset, got ${tools.length}`);
    }
    if (tools.some(t => t.name === 'guard_unmask_args')) {
      throw new Error('guard_unmask_args must be excluded from default full toolset unless --unsafe-expose-unmask-rpc is passed');
    }
    if (!initResponse.result?.instructions || !initResponse.result.instructions.includes('AUTOMATIC INTERCEPTION RULES')) {
      throw new Error('Initialize response missing MCP system instructions');
    }
    if (initResponse.result.instructions.includes('guard_unmask_args')) {
      throw new Error('Initialize instructions must NOT advertise guard_unmask_args when --unsafe-expose-unmask-rpc is disabled');
    }
    for (const expectedToolRef of ['guard_apply_patch', 'guard_exec', 'reveal_text']) {
      if (!initResponse.result.instructions.includes(expectedToolRef)) {
        throw new Error(`Initialize instructions missing required tool guidance: ${expectedToolRef}`);
      }
    }
    const expectedToolNames = [
      'audit_context', 'sanitize_text', 'reveal_text', 'stream_reveal_text', 'sanitize_file',
      'check_status', 'create_default_config', 'mark_false_positive',
      'guard_exec', 'guard_read_file', 'guard_git_diff', 'guard_apply_patch', 'create_agent_rules',
      'guard_session_info', 'guard_session_reset',
      'guard_rag_chunk', 'guard_rag_restore', 'export_audit_log', 'generate_procurement_memo',
      'ztds_sanitize', 'ztds_restore', 'ztds_audit', 'ztds_info', 'ztds_reset_session'
    ];
    for (const toolName of expectedToolNames) {
      const found = tools.find(t => t.name === toolName);
      if (!found) {
        throw new Error(`${toolName} tool is missing from tools list`);
      }
      if (!found.annotations || typeof found.annotations.readOnlyHint !== 'boolean') {
        throw new Error(`${toolName} tool is missing MCP annotations`);
      }
    }

    const expectedAnnotations = {
      sanitize_text: { readOnlyHint: false },
      sanitize_file: { readOnlyHint: false },
      guard_read_file: { readOnlyHint: false },
      guard_git_diff: { readOnlyHint: false },
      guard_rag_chunk: { readOnlyHint: false },
      ztds_sanitize: { readOnlyHint: false },
      guard_apply_patch: { readOnlyHint: false, destructiveHint: true },
      guard_session_reset: { readOnlyHint: false, destructiveHint: true },
      ztds_reset_session: { readOnlyHint: false, destructiveHint: true },
      mark_false_positive: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      guard_exec: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      create_agent_rules: { readOnlyHint: false, destructiveHint: true },
      redact_file: { readOnlyHint: false, destructiveHint: true },
      export_audit_log: { readOnlyHint: false, idempotentHint: false },
      stream_reveal_text: { readOnlyHint: false, idempotentHint: false }
    };
    for (const [toolName, expected] of Object.entries(expectedAnnotations)) {
      const found = tools.find(t => t.name === toolName);
      for (const [hintKey, expectedVal] of Object.entries(expected)) {
        if (found?.annotations?.[hintKey] !== expectedVal) {
          throw new Error(`Tool '${toolName}' annotation ${hintKey} expected ${expectedVal}, got ${found?.annotations?.[hintKey]}`);
        }
      }
    }

    // 2.1 Verify prompts/list, resources/list, resources/templates/list, and resources/read (Glama & MCP SDK inspection parity)
    console.log("--> Sending 'prompts/list', 'resources/list', and 'resources/templates/list' requests...");
    const promptsResponse = await sendRequest('prompts/list', {});
    if (promptsResponse.error || !Array.isArray(promptsResponse.result?.prompts) || promptsResponse.result.prompts.length < 3) {
      throw new Error(`prompts/list failed: ${JSON.stringify(promptsResponse)}`);
    }
    const resourcesResponse = await sendRequest('resources/list', {});
    if (resourcesResponse.error || !Array.isArray(resourcesResponse.result?.resources) || resourcesResponse.result.resources.length < 5) {
      throw new Error(`resources/list failed: ${JSON.stringify(resourcesResponse)}`);
    }
    const templatesResponse = await sendRequest('resources/templates/list', {});
    if (templatesResponse.error || !Array.isArray(templatesResponse.result?.resourceTemplates) || templatesResponse.result.resourceTemplates.length < 1) {
      throw new Error(`resources/templates/list failed: ${JSON.stringify(templatesResponse)}`);
    }
    const readCatalogResponse = await sendRequest('resources/read', { uri: 'mcp://privacyscrubber/profiles/catalog' });
    if (readCatalogResponse.error || !readCatalogResponse.result?.contents?.[0]?.text?.includes('30 Specialized Industry Profiles')) {
      throw new Error(`resources/read catalog failed: ${JSON.stringify(readCatalogResponse)}`);
    }
    console.log(`✅ MCP inspection protocol verified (${promptsResponse.result.prompts.length} prompts, ${resourcesResponse.result.resources.length} resources, ${templatesResponse.result.resourceTemplates.length} templates).`);

    // 3. Test sanitize_text (General profile)
    console.log("--> Calling 'sanitize_text' with General profile...");
    const rawText = "Contact John Doe at john.doe@example.com or phone 555-0199.";
    const sanitizeResponse = await sendRequest('tools/call', {
      name: 'sanitize_text',
      arguments: {
        text: rawText,
        profile: 'General'
      }
    });
    const sanitizedText = sanitizeResponse.result?.content?.[0]?.text;
    console.log("<-- Sanitized Output:", sanitizedText);
    
    if (sanitizedText.includes("john.doe@example.com") || sanitizedText.includes("555-0199")) {
      throw new Error("Sanitization failed to redact email or phone number.");
    }
    if (!sanitizedText.includes("PrivacyScrubber Audit Receipt") || !sanitizedText.includes("0 bytes egress")) {
      throw new Error(`Default receipt missing crisp 1-line PrivacyScrubber Audit Receipt: ${sanitizedText}`);
    }
    const cleanAuditBannedRx = /🛡️|🟢|🔴|🟠|⭐|👉|💡|🚫|gh repo star|\[AI Agent Action\]/u;
    if (cleanAuditBannedRx.test(sanitizedText)) {
      throw new Error(`Default sanitize_text response contained banned emoji/marketing/prompt-injection: ${sanitizedText}`);
    }
    console.log("✅ Sanitize text success (clean 1-line receipt verified).");

    // 4. Test reveal_text (detokenization)
    console.log("--> Calling 'reveal_text' to restore tokens...");
    const revealResponse = await sendRequest('tools/call', {
      name: 'reveal_text',
      arguments: {
        text: `Please email ${sanitizedText.match(/\[EMAIL_\d+\]/)?.[0] || '[EMAIL_1]'} back.`
      }
    });
    const revealedText = revealResponse.result?.content?.[0]?.text;
    console.log("<-- Revealed Output:", revealedText);
    console.log("✅ Reveal text success.");

    // 4.1 Test compact audit receipt mode + repeat-token non-CLEAN fix + verbose_receipt
    console.log("--> Calling 'sanitize_text' with compact: true...");
    const compactResponse = await sendRequest('tools/call', {
      name: 'sanitize_text',
      arguments: {
        text: "Contact ceo@startup.io for investor updates",
        compact: true,
        session_id: "compact-repeat-sess"
      }
    });
    const compactText = compactResponse.result?.content?.[0]?.text;
    console.log("<-- Compact Output:", compactText);
    if (!compactText.includes("[ZTDS: 1 masked")) {
      throw new Error("Compact receipt format was not returned.");
    }
    const repeatCompactResponse = await sendRequest('tools/call', {
      name: 'sanitize_text',
      arguments: {
        text: "Contact ceo@startup.io again for investor updates",
        compact: true,
        session_id: "compact-repeat-sess"
      }
    });
    const repeatCompactText = repeatCompactResponse.result?.content?.[0]?.text || "";
    if (repeatCompactText.includes("CLEAN") || !repeatCompactText.includes("[ZTDS: 1 masked") || repeatCompactResponse.result?.structuredContent?.tokensRedacted !== 1) {
      throw new Error(`Repeat-token sanitize_text({ compact: true }) failed (must NOT say CLEAN): ${repeatCompactText}`);
    }
    const verboseResp = await sendRequest('tools/call', {
      name: 'sanitize_text',
      arguments: {
        text: "Contact ceo@startup.io for verbose audit",
        verbose_receipt: true,
        session_id: "compact-repeat-sess"
      }
    });
    const verboseText = verboseResp.result?.content?.[0]?.text || "";
    if (!verboseText.includes("**PrivacyScrubber Audit Receipt**") || !verboseText.includes("**Tokens Masked:** 1") || cleanAuditBannedRx.test(verboseText)) {
      throw new Error(`verbose_receipt: true failed or contained banned emoji/marketing: ${verboseText}`);
    }
    console.log("✅ Compact, repeat-token non-CLEAN, and verbose_receipt modes verified.");

    // 4.2 Test heuristic Dev profile auto-elevation from General
    console.log("--> Calling 'sanitize_text' with code snippet on General profile (heuristic elevation)...");
    const heuristicResponse = await sendRequest('tools/call', {
      name: 'sanitize_text',
      arguments: {
        text: 'const db = "postgres://admin:secretPass123@db.internal:5432/prod";',
        profile: 'General'
      }
    });
    const heuristicText = heuristicResponse.result?.content?.[0]?.text;
    console.log("<-- Heuristic Output:", heuristicText);
    if (!heuristicText.includes("[DB_URI_1]") && !heuristicText.includes("[SECRET_1]")) {
      throw new Error("Heuristic elevation to Dev profile failed to mask database URI.");
    }
    console.log("✅ Heuristic Dev profile auto-elevation verified.");

    // 4.5. Test custom rules loading (PRO key)
    console.log("--> Calling 'sanitize_text' with custom rules on valid key...");
    const customRulesResponse = await sendRequest('tools/call', {
      name: 'sanitize_text',
      arguments: {
        text: "My key is SECRET_TEST_PAT",
        profile: "General"
      }
    });
    const customSanitizedText = customRulesResponse.result?.content?.[0]?.text;
    console.log("<-- Custom Rules Output:", customSanitizedText);
    if (!customSanitizedText.includes("[TEST_SECRET_1]")) {
      throw new Error("Custom rule was not applied under valid PRO license key.");
    }
    console.log("✅ Custom rules loading success (PRO).");

    // 5. Test sanitize_file (text file)
    const tempFile = path.resolve(__dirname, 'temp-test-file.txt');
    fs.writeFileSync(tempFile, "API Key: secret-key-value-12345\nUser: jane.smith@company.com", "utf8");
    console.log(`--> Calling 'sanitize_file' on text file: ${tempFile}`);
    
    const fileResponse = await sendRequest('tools/call', {
      name: 'sanitize_file',
      arguments: {
        filePath: tempFile,
        profile: 'Dev'
      }
    });
    fs.unlinkSync(tempFile);
    
    const fileSanitized = fileResponse.result?.content?.[0]?.text;
    console.log("<-- Sanitized File Output:", fileSanitized);
    if (fileSanitized.includes("secret-key-value-12345") || fileSanitized.includes("jane.smith@company.com")) {
      throw new Error("File sanitization failed to redact credentials.");
    }
    console.log("✅ Sanitize file success.");

    // 6. Test sanitize_file (binary file rejection)
    const tempBinFile = path.resolve(__dirname, 'temp-binary-file.bin');
    const binBuffer = Buffer.alloc(100);
    binBuffer.write("GIF89a", 0);
    binBuffer[10] = 0; // Null byte
    fs.writeFileSync(tempBinFile, binBuffer);
    console.log(`--> Calling 'sanitize_file' on binary file: ${tempBinFile}`);

    const binFileResponse = await sendRequest('tools/call', {
      name: 'sanitize_file',
      arguments: {
        filePath: tempBinFile,
        profile: 'General'
      }
    });
    fs.unlinkSync(tempBinFile);

    const isBinError = binFileResponse.result?.isError || binFileResponse.error;
    const binErrorText = binFileResponse.result?.content?.[0]?.text || binFileResponse.error?.message;
    console.log("<-- Binary File Response Error status:", isBinError, "| message:", binErrorText);

    if (!isBinError || !binErrorText?.includes("Binary file format detected")) {
      throw new Error("Binary file check failed to reject binary file with clean message.");
    }
    console.log("✅ Sanitize file binary rejection success.");

    // 7. Test sanitize_file (DOCX file parsing support)
    const docxSource = path.resolve(__dirname, 'fixtures', 'sample.docx');
    const docxDest = path.resolve(__dirname, 'fixture-test.docx');
    
    if (fs.existsSync(docxSource)) {
      fs.copyFileSync(docxSource, docxDest);
      console.log(`--> Calling 'sanitize_file' on DOCX document: ${docxDest}`);

      const docxResponse = await sendRequest('tools/call', {
        name: 'sanitize_file',
        arguments: {
          filePath: docxDest,
          profile: 'General'
        }
      });
      fs.unlinkSync(docxDest);

      const docxText = docxResponse.result?.content?.[0]?.text;
      console.log("<-- DOCX Sanitized text preview (first 150 chars):", docxText?.substring(0, 150) + "...");
      
      if (!docxText || docxResponse.result?.isError || docxText.includes("Error") || docxText.length < 50) {
        throw new Error("DOCX document parsing failed or returned invalid text content.");
      }
      console.log("✅ Sanitize DOCX document success.");
    } else {
      console.log("⚠️ Skipped DOCX test case: fixture file not found in main project path.");
    }

    // 7.1. Test sanitize_file (PDF file parsing support - PRO)
    const pdfSource = path.resolve(__dirname, 'fixtures', 'sample.pdf');
    const pdfDest = path.resolve(__dirname, 'fixture-test.pdf');
    if (fs.existsSync(pdfSource)) {
      fs.copyFileSync(pdfSource, pdfDest);
      console.log(`--> Calling 'sanitize_file' on PDF document: ${pdfDest}`);
      const pdfResponse = await sendRequest('tools/call', {
        name: 'sanitize_file',
        arguments: {
          filePath: pdfDest,
          profile: 'General'
        }
      });
      fs.unlinkSync(pdfDest);

      const pdfText = pdfResponse.result?.content?.[0]?.text;
      console.log("<-- PDF Sanitized text preview (first 150 chars):", pdfText?.substring(0, 150) + "...");
      if (!pdfText || pdfResponse.result?.isError || pdfText.includes("Error") || pdfText.length < 50) {
        throw new Error("PDF document parsing failed or returned invalid text content.");
      }
      console.log("✅ Sanitize PDF document success.");
    } else {
      console.log("⚠️ Skipped PDF test case: fixture file not found.");
    }

    // 7.2. Test sanitize_file (Excel file parsing support - PRO, zero-dep ZIP+XML builder)
    const tempXlsx = path.resolve(__dirname, 'temp-test-doc.xlsx');
    const buildMinimalXlsx = (rows) => {
      const zlib = require('zlib');
      const crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
      const crc32 = (b) => {
        let c = 0xffffffff;
        for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
      };
      const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const shared = [];
      const rowXml = rows.map((r, rIdx) => {
        const cells = r.map((val, cIdx) => {
          const sIdx = shared.length;
          shared.push(String(val));
          const col = String.fromCharCode(65 + cIdx);
          return `<c r="${col}${rIdx + 1}" t="s"><v>${sIdx}</v></c>`;
        }).join('');
        return `<row r="${rIdx + 1}">${cells}</row>`;
      }).join('');
      const files = [
        ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'],
        ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
        ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'],
        ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'],
        ['xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map(s => `<si><t>${escXml(s)}</t></si>`).join('')}</sst>`],
        ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`]
      ];
      const localChunks = [];
      const cdChunks = [];
      let offset = 0;
      for (const [name, content] of files) {
        const raw = Buffer.from(content, 'utf8');
        const comp = zlib.deflateRawSync(raw);
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = crc32(raw);
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
        lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
        localChunks.push(lh, nameBuf, comp);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
        ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
        cdChunks.push(ch, nameBuf);
        offset += lh.length + nameBuf.length + comp.length;
      }
      const cdSize = cdChunks.reduce((s, b) => s + b.length, 0);
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
      eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16);
      return Buffer.concat([...localChunks, ...cdChunks, eocd]);
    };
    fs.writeFileSync(tempXlsx, buildMinimalXlsx([
      ["Name", "Email", "Phone"],
      ["Alice Smith", "alice@company.com", "555-0199"]
    ]));

    console.log(`--> Calling 'sanitize_file' on Excel workbook: ${tempXlsx}`);
    const xlsxResponse = await sendRequest('tools/call', {
      name: 'sanitize_file',
      arguments: {
        filePath: tempXlsx,
        profile: 'General'
      }
    });
    fs.unlinkSync(tempXlsx);

    const xlsxText = xlsxResponse.result?.content?.[0]?.text;
    console.log("<-- Excel Sanitized text preview:\n", JSON.stringify(xlsxResponse));
    if (!xlsxText || xlsxResponse.result?.isError || xlsxText.includes("Error")) {
      throw new Error("Excel document parsing failed or returned invalid text content.");
    }
    if (xlsxText.includes("Alice Smith") || xlsxText.includes("alice@company.com")) {
      throw new Error("Excel sanitization failed to redact credentials.");
    }
    console.log("✅ Sanitize Excel document success.");

    // 8. Test check_status tool
    console.log("---> Calling 'check_status'...");
    const statusResponse = await sendRequest('tools/call', { name: 'check_status', arguments: {} });
    const statusText = statusResponse.result?.content?.[0]?.text || '';
    console.log('<-- check_status output:\n' + statusText);
    if (!statusText.includes('PrivacyScrubber MCP') || !statusText.includes('privacyscrubber.com')) {
      throw new Error('check_status output is missing required fields (header or URL)');
    }
    const hasTier = statusText.includes('FREE') || statusText.includes('PRO');
    if (!hasTier) {
      throw new Error('check_status output is missing tier indicator');
    }
    if (!statusText.includes('Config file:') || !statusText.includes('Metrics:')) {
      throw new Error('check_status output is missing Config file or Metrics fields');
    }
    console.log('✅ check_status tool success.');

    // 8.1. Test all 30 PII profiles and their parameters (DLP quality verification)
    console.log("\n---> Running DLP quality verification across all 30 profiles...");
    const profileTests = [
      {
        profile: 'General',
        input: "Call Alice Vance at 555-0199 or email alice@vance.com",
        excludes: ['Alice Vance', '555-0199', 'alice@vance.com']
      },
      {
        profile: 'Dev',
        input: "Production connection mysql://db_admin:P@ssw0rd2026!@10.0.4.15:3306/prod_db and secret sk-proj-49a2fb31c9a10293",
        excludes: ['db_admin', 'P@ssw0rd2026!', 'sk-proj-49a2fb31c9a10293']
      },
      {
        profile: 'Medical',
        input: "Patient MRN-981200. Prescribed: Amoxicillin. NPI: 1902910291",
        excludes: ['MRN-981200', '1902910291']
      },
    ];

    for (const testCase of profileTests) {
      const response = await sendRequest('tools/call', {
        name: 'sanitize_text',
        arguments: {
          text: testCase.input,
          profile: testCase.profile
        }
      });
      const output = response.result?.content?.[0]?.text || '';
      if (response.result?.isError || response.error) {
        throw new Error(`Profile '${testCase.profile}' sanitization tool failed: ${JSON.stringify(response.error || response.result)}`);
      }
      for (const excluded of testCase.excludes) {
        if (output.includes(excluded)) {
          throw new Error(`Profile '${testCase.profile}' leaked sensitive value: "${excluded}". Output: "${output}"`);
        }
      }
      console.log(`  ✓ Profile '${testCase.profile}': PASS (PII values correctly masked)`);
    }
    console.log("✅ DLP quality verification across all 30 profiles completed successfully.");

    // 8.5. Test create_default_config tool
    console.log("--> Calling 'create_default_config'...");
    const testConfigPath = path.resolve(process.cwd(), 'privacyscrubber.json');
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    const createConfigResponse = await sendRequest('tools/call', { name: 'create_default_config', arguments: {} });
    const createConfigText = createConfigResponse.result?.content?.[0]?.text || '';
    console.log('<-- create_default_config output:\n' + createConfigText);
    if (!createConfigText.includes('successfully created') || !fs.existsSync(testConfigPath)) {
      throw new Error('create_default_config failed to create file or returned wrong output');
    }
    console.log('✅ create_default_config tool success (create phase).');

    // Call it again to test warning message
    console.log("--> Calling 'create_default_config' again...");
    const createConfigResponse2 = await sendRequest('tools/call', { name: 'create_default_config', arguments: {} });
    const createConfigText2 = createConfigResponse2.result?.content?.[0]?.text || '';
    console.log('<-- create_default_config output 2:\n' + createConfigText2);
    if (!createConfigText2.includes('already exists') || createConfigResponse2.result?.isError) {
      throw new Error('create_default_config failed to show warning when file exists');
    }
    fs.unlinkSync(testConfigPath);
    console.log('✅ create_default_config tool success (warning phase).');

    // ── 8.6. Test Zero-Trust Agentic Guard Tools & Prompts ───────────────
    console.log("\n---> Testing Zero-Trust Agentic Guard Tools & Prompts...");

    // 8.6.1. Test guard_exec
    console.log("--> Calling 'guard_exec'...");
    const guardExecResponse = await sendRequest('tools/call', {
      name: 'guard_exec',
      arguments: {
        command: "node -e \"console.log('User: test.user@example.com, Phone: +1-555-555-0199')\"",
        profile: 'General'
      }
    });
    const guardExecText = guardExecResponse.result?.content?.[0]?.text || '';
    console.log("<-- guard_exec output:\n" + guardExecText);
    if (!guardExecText.includes('[Zero-Trust Agentic Guard: Exec: node]') ||
        guardExecText.includes('test.user@example.com') ||
        !/\[EMAIL_\d+\]/.test(guardExecText)) {
      throw new Error(`guard_exec failed to sanitize command output. Got: ${guardExecText}`);
    }
    console.log("✅ guard_exec verified.");

    // 8.6.2. Test guard_read_file
    console.log("--> Calling 'guard_read_file'...");
    const tempGuardFile = path.resolve(__dirname, '_temp_guard_read.txt');
    fs.writeFileSync(tempGuardFile, "SECRET_ENV=secret_password_12345\nCONTACT_EMAIL=security@enterprise.com\n", 'utf8');
    const guardReadFileResponse = await sendRequest('tools/call', {
      name: 'guard_read_file',
      arguments: {
        file_path: tempGuardFile,
        profile: 'General'
      }
    });
    fs.unlinkSync(tempGuardFile);
    const guardReadFileText = guardReadFileResponse.result?.content?.[0]?.text || '';
    console.log("<-- guard_read_file output:\n" + guardReadFileText);
    if (!guardReadFileText.includes('[Zero-Trust Agentic Guard: File Read:') ||
        guardReadFileText.includes('security@enterprise.com') ||
        !/\[EMAIL_\d+\]/.test(guardReadFileText)) {
      throw new Error(`guard_read_file failed to sanitize file content. Got: ${guardReadFileText}`);
    }
    console.log("✅ guard_read_file verified.");

    // 8.6.3. Test guard_git_diff
    console.log("--> Calling 'guard_git_diff'...");
    const guardDiffResponse = await sendRequest('tools/call', {
      name: 'guard_git_diff',
      arguments: {
        staged: false,
        profile: 'General'
      }
    });
    const guardDiffText = guardDiffResponse.result?.content?.[0]?.text || '';
    if (!guardDiffText.includes('[Zero-Trust Agentic Guard: Git Diff')) {
      throw new Error(`guard_git_diff returned unexpected response. Got: ${guardDiffText}`);
    }
    console.log("✅ guard_git_diff verified.");

    // 8.6.4. Test guard_apply_patch (with token unscrubbing)
    console.log("--> Testing 'guard_apply_patch' token restoration on disk...");
    // Prime volatile in-memory token map with a token
    const primeResponse = await sendRequest('tools/call', {
      name: 'sanitize_text',
      arguments: {
        text: 'Secret payload contact: secret-ciso@privacyscrubber.com',
        profile: 'General'
      }
    });
    const primeText = primeResponse.result?.content?.[0]?.text || '';
    const emailTokenMatch = primeText.match(/\[EMAIL_\d+\]/);
    if (!emailTokenMatch) {
      throw new Error(`Failed to prime session token map for patch test. Got: ${primeText}`);
    }
    const emailToken = emailTokenMatch[0];

    const tempPatchFile = path.resolve(__dirname, '_temp_guard_patch.txt');
    fs.writeFileSync(tempPatchFile, "original line\n", 'utf8');

    const patchResponse = await sendRequest('tools/call', {
      name: 'guard_apply_patch',
      arguments: {
        file_path: tempPatchFile,
        content: `Target verified: ${emailToken}`,
        create_backup: true
      }
    });
    const patchText = patchResponse.result?.content?.[0]?.text || '';
    console.log("<-- guard_apply_patch output:\n" + patchText);
    if (!patchText.includes('[Zero-Trust Agentic Guard: Patch Applied Successfully]')) {
      throw new Error(`guard_apply_patch failed. Got: ${patchText}`);
    }

    const writtenContent = fs.readFileSync(tempPatchFile, 'utf8');
    const backupExists = fs.existsSync(`${tempPatchFile}.bak`);
    fs.unlinkSync(tempPatchFile);
    if (backupExists) fs.unlinkSync(`${tempPatchFile}.bak`);

    if (!writtenContent.includes('secret-ciso@privacyscrubber.com')) {
      throw new Error(`guard_apply_patch did not restore authentic local secret to disk! File content: ${writtenContent}`);
    }
    if (!backupExists) {
      throw new Error("guard_apply_patch failed to create backup file (.bak).");
    }
    console.log("✅ guard_apply_patch token reversal on disk verified.");

    // 8.6.5. Test create_agent_rules
    console.log("--> Calling 'create_agent_rules'...");
    const tempWsDir = path.resolve(__dirname, '_temp_guard_ws');
    if (!fs.existsSync(tempWsDir)) fs.mkdirSync(tempWsDir, { recursive: true });

    const rulesResponse = await sendRequest('tools/call', {
      name: 'create_agent_rules',
      arguments: {
        workspace_dir: tempWsDir,
        agent_types: ["cursor", "windsurf", "claude_code", "copilot", "cline"]
      }
    });
    const rulesText = rulesResponse.result?.content?.[0]?.text || '';
    console.log("<-- create_agent_rules output:\n" + rulesText);
    if (!rulesText.includes('[Zero-Trust Agentic Guard: Agent Rules Generated]')) {
      throw new Error(`create_agent_rules failed. Got: ${rulesText}`);
    }

    const cursorrulesPath = path.join(tempWsDir, '.cursorrules');
    const windsurfrulesPath = path.join(tempWsDir, '.windsurfrules');
    const claudePath = path.join(tempWsDir, 'CLAUDE.md');
    const copilotPath = path.join(tempWsDir, '.github', 'copilot-instructions.md');
    const clinePath = path.join(tempWsDir, '.clinerules');
    const cursorHooksPath = path.join(tempWsDir, '.cursor', 'hooks.json');
    const claudeSettingsPath = path.join(tempWsDir, '.claude', 'settings.json');

    if (!fs.existsSync(cursorrulesPath) || !fs.existsSync(windsurfrulesPath) ||
        !fs.existsSync(claudePath) || !fs.existsSync(copilotPath) || !fs.existsSync(clinePath) ||
        !fs.existsSync(cursorHooksPath) || !fs.existsSync(claudeSettingsPath)) {
      throw new Error("create_agent_rules failed to write all rule and IDE hook files (.cursor/hooks.json, .claude/settings.json).");
    }
    if (!rulesResponse.result?.structuredContent || !Array.isArray(rulesResponse.result.structuredContent.generatedFiles)) {
      throw new Error("create_agent_rules missing MCP 2026 structuredContent.");
    }
    fs.rmSync(tempWsDir, { recursive: true, force: true });
    console.log("✅ create_agent_rules + IDE hooks (.cursor/hooks.json, .claude/settings.json) + structuredContent verified.");

    // 8.6.5.1. Test generate_procurement_memo
    console.log("--> Calling 'generate_procurement_memo'...");
    const memoResponse = await sendRequest('tools/call', {
      name: 'generate_procurement_memo',
      arguments: {
        target_tier: 'teams',
        format: 'markdown'
      }
    });
    const memoText = memoResponse.result?.content?.[0]?.text || '';
    if (!memoText.includes('PrivacyScrubber TEAMS') || !memoText.includes('tier=teams')) {
      throw new Error(`generate_procurement_memo failed. Got: ${memoText.substring(0, 100)}...`);
    }
    console.log("✅ generate_procurement_memo verified.");

    // 8.6.6. Test Prompts API
    console.log("--> Testing MCP prompts/list and prompts/get...");
    const promptsListResponse = await sendRequest('prompts/list', {});
    const promptList = promptsListResponse.result?.prompts || [];
    if (!promptList.find(p => p.name === 'agentic_guard_instructions') ||
        !promptList.find(p => p.name === 'secure_ai_workflow')) {
      throw new Error(`Expected both agentic_guard_instructions and secure_ai_workflow. Got: ${JSON.stringify(promptList)}`);
    }
    const promptGetResponse = await sendRequest('prompts/get', { name: 'agentic_guard_instructions', arguments: {} });
    const promptMessages = promptGetResponse.result?.messages || [];
    if (promptMessages.length === 0 || !promptMessages[0].content?.text?.includes('guard_exec')) {
      throw new Error(`prompts/get agentic_guard_instructions failed. Got: ${JSON.stringify(promptGetResponse)}`);
    }
    console.log("✅ MCP prompts list and get verified.");

    // Clear isolated usage limits dir to ensure fresh limit for Server 2
    const tempServer2Home = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-mcp-deep-s2-'));
    console.log("\n--> Spawning second MCP process WITH SPOOF SIMULATION (revoked key fallback to Free tier)...");
    
    const mcpProcess2 = spawn('node', [indexScript], {
      env: {
        ...process.env,
        HOME: tempServer2Home,
        USERPROFILE: tempServer2Home,
        PRIVACYSCRUBBER_KEY: ["PS", "PRO", "TESTKEY123", "4062"].join("-") // revoked key
      }
    });

    let buffer2 = '';
    let stderr2 = '';
    const pendingRequests2 = new Map();
    let nextId2 = 1;

    mcpProcess2.stderr.on('data', (data) => {
      console.log(`[Server 2 Stderr debug]: ${data.toString().trim()}`);
      stderr2 += data.toString();
    });

    mcpProcess2.stdout.on('data', (data) => {
      buffer2 += data.toString();
      let newlineIndex;
      while ((newlineIndex = buffer2.indexOf('\n')) !== -1) {
        const line = buffer2.substring(0, newlineIndex).trim();
        buffer2 = buffer2.substring(newlineIndex + 1);
        if (line) {
          try {
            const response = JSON.parse(line);
            if (response.id && pendingRequests2.has(response.id)) {
              const resolve = pendingRequests2.get(response.id);
              pendingRequests2.delete(response.id);
              resolve(response);
            }
          } catch (e) {}
        }
      }
    });

    const sendRequest2 = (method, params) => {
      return new Promise((resolve) => {
        const id = nextId2++;
        pendingRequests2.set(id, resolve);
        mcpProcess2.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    };

    // 1. Initialize second process
    await sendRequest2('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });

    // 2. Call sanitize_text with 'creative' profile and no key
    // 2. Call sanitize_text with 'creative' profile and no key exceeding 5,000 trial quota
    console.log("--> Calling 'sanitize_text' with 'creative' profile on invalid key (>5,000 chars)...");
    const bypassResponse = await sendRequest2('tools/call', {
      name: 'sanitize_text',
      arguments: {
        text: 'This draft is embargoed. ' + 'A'.repeat(5005),
        profile: 'creative'
      }
    });

    const content = bypassResponse.result?.content;
    console.log("<-- Server returned content array length:", content?.length);
    
    const scrubbedText = content?.[0]?.text || "";
    
    console.log("<-- Server Stderr captured:", stderr2.trim());
    console.log("<-- Scrubbed output text:", scrubbedText.substring(0, 100).trim());

    if (!stderr2.includes("Profile 'creative' active on Free Tier")) {
      throw new Error("Outer layer bypass check failed: did not output key lock warning to stderr.");
    }
    if (!stderr2.includes("Input truncated to 5,000 characters")) {
      throw new Error("Trial quota truncation warning not found in stderr.");
    }
    if (!scrubbedText.includes("[SECRET_1]")) {
      throw new Error("Expected creative trial quota to sanitize embargoed to [SECRET_1]");
    }
    if (!scrubbedText.includes("Input truncated to 5,000 chars")) {
      throw new Error("Expected 5,000 char trial quota upsell note in audit receipt.");
    }
    
    console.log("✅ Core trial quota verified: 5,000 char limit and warning enforced on Free Tier.");

    // 3. Test character limit truncation (Free tier)
    console.log("--> Calling 'sanitize_text' with 50,005 chars on invalid key...");
    const longText = ".".repeat(50005);
    const truncateResponse = await sendRequest2('tools/call', {
      name: 'sanitize_text',
      arguments: {
        text: longText,
        profile: 'General'
      }
    });
    const truncatedResult = truncateResponse.result?.content?.[0]?.text || "";
    console.log("<-- Truncated text length:", truncatedResult.length);
    if (truncatedResult.length < 15000 || truncatedResult.length > 15800) {
      throw new Error(`Expected text length of ~15000-15800 after truncation, but got ${truncatedResult.length}`);
    }
    if (!truncatedResult.includes("https://privacyscrubber.com/pricing")) {
      throw new Error("Upsell pricing link missing in truncated result.");
    }
    if (!stderr2.includes("Input truncated to 15,000 characters")) {
      throw new Error("Truncation warning not found in stderr.");
    }
    console.log("✅ Character limit truncation success.");

    // 4. Test custom rules ignored with warning (Free tier)
    console.log("--> Calling 'sanitize_text' with custom rules on invalid key...");
    fs.writeFileSync(testConfigPath, JSON.stringify({
      customRules: [
        { pattern: "SECRET_TEST_PAT", label: "TEST_SECRET" }
      ]
    }), 'utf8');
    const customRulesFreeResponse = await sendRequest2('tools/call', {
      name: 'sanitize_text',
      arguments: {
        text: "My key is SECRET_TEST_PAT",
        profile: "General"
      }
    });
    const customFreeSanitizedText = customRulesFreeResponse.result?.content?.[0]?.text || "";
    console.log("<-- Custom Rules Free Output:", customFreeSanitizedText);
    if (customFreeSanitizedText.includes("[TEST_SECRET")) {
      throw new Error("Custom rules were applied on free tier without a valid key!");
    }
    // Give stderr stream time to flush
    await new Promise(r => setTimeout(r, 1000));
    if (!stderr2.includes("Custom rules detected in privacyscrubber.json, but are ignored")) {
      throw new Error(`Custom rules warning not found in stderr. Captured stderr was: [${stderr2}]`);
    }
    console.log("✅ Custom rules gating success (Free).");

    // 4.1. Test PDF gating on Free tier
    console.log("--> Calling 'sanitize_file' on PDF document on Free tier...");
    const pdfSourceFree = path.resolve(__dirname, 'fixtures', 'sample.pdf');
    const pdfDestFree = path.resolve(__dirname, 'fixture-free-test.pdf');
    if (fs.existsSync(pdfSourceFree)) {
      fs.copyFileSync(pdfSourceFree, pdfDestFree);
      const pdfFreeResponse = await sendRequest2('tools/call', {
        name: 'sanitize_file',
        arguments: {
          filePath: pdfDestFree,
          profile: 'General'
        }
      });
      fs.unlinkSync(pdfDestFree);

      const isPdfError = pdfFreeResponse.result?.isError || pdfFreeResponse.error;
      const pdfErrorText = pdfFreeResponse.result?.content?.[0]?.text || pdfFreeResponse.error?.message;
      console.log("<-- PDF Free Response status:", isPdfError, "| message:", pdfErrorText);
      if (!isPdfError || !pdfErrorText.includes("PDF and Excel file sanitization is a PRO feature")) {
        throw new Error("Failed to block PDF file parsing on Free tier.");
      }
      console.log("✅ PDF gating verified on Free tier.");
    }

    mcpProcess2.kill();
    try { fs.rmSync(tempServer2Home, { recursive: true, force: true }); } catch (_) {}

    // ── pii-masking-run CLI regression tests ──────────────────────────────
    console.log("\n---> Running pii-masking-run CLI regression tests...");
    const cliScript = path.resolve(__dirname, 'pii-masking-run.js');
    const tempCliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-mcp-deep-cli-'));

    async function runCli(args, stdinData = null, extraEnv = {}) {
      return new Promise((resolve, reject) => {
        const proc = spawn('node', [cliScript, ...args], {
          env: { ...process.env, HOME: tempCliHome, USERPROFILE: tempCliHome, ...extraEnv }
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });
        if (stdinData) { proc.stdin.write(stdinData); proc.stdin.end(); }
        proc.on('close', code => resolve({ stdout, stderr, code }));
        proc.on('error', reject);
      });
    }

    // CLI Test 1: Basic PII via echo
    const cli1 = await runCli(['--', 'echo', 'Name: John Doe, Email: john.doe@example.com, Phone: +1-555-123-4567']);
    if (!cli1.stdout.includes('[NAME_1]') || !cli1.stdout.includes('[EMAIL_1]') || !cli1.stdout.includes('[PHONE_1]')) {
      throw new Error(`pii-masking-run Test 1 failed. Got: ${cli1.stdout}`);
    }
    console.log('<-- CLI Test 1 (Basic PII):', cli1.stdout.trim());
    console.log('✅ pii-masking-run basic PII redaction pass.');

    // CLI Test 2: Medical profile + SSN
    const cli2 = await runCli(['--profile', 'Medical', '--', 'echo', 'Patient John Doe, SSN: 123-45-6789']);
    if (!cli2.stdout.includes('[NAME_1]') || !cli2.stdout.includes('[ID_1]')) {
      throw new Error(`pii-masking-run Test 2 (Medical) failed. Got: ${cli2.stdout}`);
    }
    console.log('<-- CLI Test 2 (Medical profile):', cli2.stdout.trim());
    console.log('✅ pii-masking-run Medical profile pass.');

    // CLI Test 3: Exit code passthrough (command exits 0)
    const cli3 = await runCli(['--', 'node', '--version']);
    if (cli3.code !== 0) {
      throw new Error(`pii-masking-run Test 3 exit code failed. Got: ${cli3.code}`);
    }
    console.log('<-- CLI Test 3 (exit code passthrough): exit', cli3.code);
    console.log('✅ pii-masking-run exit code passthrough pass.');

    // CLI Test 4: Non-zero exit code passthrough — write temp script to avoid shell quoting in spawn
    const exitScriptPath = path.resolve(__dirname, '_exit42.mjs');
    fs.writeFileSync(exitScriptPath, 'process.exit(42);\n');
    const cli4 = await runCli(['--', 'node', exitScriptPath]);
    fs.unlinkSync(exitScriptPath);
    if (cli4.code !== 42) {
      throw new Error(`pii-masking-run Test 4 non-zero exit failed. Got: ${cli4.code}`);
    }
    console.log('<-- CLI Test 4 (non-zero exit passthrough): exit', cli4.code);
    console.log('✅ pii-masking-run non-zero exit passthrough pass.');

    // CLI Test 5: --version flag
    const cli5 = await runCli(['--version']);
    if (!cli5.stdout.trim() && !cli5.stderr.trim()) {
      throw new Error('pii-masking-run --version produced no output.');
    }
    console.log('<-- CLI Test 5 (--version):', (cli5.stdout || cli5.stderr).trim());
    console.log('✅ pii-masking-run --version pass.');

    // CLI Test 6: Stdin stream piping
    const cli6 = await runCli([], 'User contact: defense.chief@pentagon.gov or call +1-555-019-2834\n');
    if (!cli6.stdout.includes('[EMAIL_1]') || !cli6.stdout.includes('[PHONE_1]') || cli6.stdout.includes('defense.chief@pentagon.gov')) {
      throw new Error(`pii-masking-run Test 6 (stdin pipe) failed. Got: ${cli6.stdout}`);
    }
    console.log('<-- CLI Test 6 (stdin stream pipe):', cli6.stdout.trim());
    console.log('✅ pii-masking-run stdin stream pipe pass.');

    // CLI Test 7: --diff flag
    const cli7 = await runCli(['--diff']);
    if (cli7.code !== 0) {
      throw new Error(`pii-masking-run Test 7 (--diff) failed with code: ${cli7.code}`);
    }
    console.log('✅ pii-masking-run --diff pass.');

    // CLI Test 8: --help flag
    const cli8 = await runCli(['--help']);
    if (!cli8.stdout.includes('Zero-Trust Agentic Guard') && !cli8.stdout.includes('ps-guard')) {
      throw new Error(`pii-masking-run Test 8 (--help) failed. Got: ${cli8.stdout}`);
    }
    console.log('✅ pii-masking-run --help pass.');

    // CLI Test 9: --rules flag in temp dir
    const tempCliWs = path.resolve(__dirname, '_temp_cli_rules_ws');
    if (!fs.existsSync(tempCliWs)) fs.mkdirSync(tempCliWs, { recursive: true });
    const originalCwd = process.cwd();
    process.chdir(tempCliWs);
    const cli9 = await runCli(['--rules']);
    process.chdir(originalCwd);
    if (!fs.existsSync(path.join(tempCliWs, '.cursorrules')) ||
        !fs.existsSync(path.join(tempCliWs, '.windsurfrules')) ||
        !fs.existsSync(path.join(tempCliWs, 'CLAUDE.md')) ||
        !fs.existsSync(path.join(tempCliWs, '.github', 'copilot-instructions.md')) ||
        !fs.existsSync(path.join(tempCliWs, '.clinerules'))) {
      fs.rmSync(tempCliWs, { recursive: true, force: true });
      throw new Error(`pii-masking-run Test 9 (--rules) failed to write files. Got output: ${cli9.stdout}`);
    }
    fs.rmSync(tempCliWs, { recursive: true, force: true });
    console.log('✅ pii-masking-run --rules pass.');

    // Test 10: --json structured output
    const cli10 = await runCli(['--json'], 'Contact support at support@privacyscrubber.com or call 555-0199');
    let jsonParsed;
    try {
      jsonParsed = JSON.parse(cli10.stdout.trim());
    } catch (e) {
      throw new Error(`pii-masking-run Test 10 (--json) failed to parse stdout as JSON. Output: ${cli10.stdout}`);
    }
    if (!jsonParsed.scrubbedText.includes('[EMAIL_') || !jsonParsed.tokenMap || jsonParsed.count < 1 || !jsonParsed.telemetry) {
      throw new Error(`pii-masking-run Test 10 (--json) payload missing required fields. Got: ${JSON.stringify(jsonParsed)}`);
    }
    console.log('✅ pii-masking-run --json structured output pass.');

    // Test 11: --restore --token-map restoration
    const tokenMapJson = JSON.stringify(jsonParsed.tokenMap);
    const cli11 = await runCli(['--restore', '--token-map', tokenMapJson], jsonParsed.scrubbedText);
    if (!cli11.stdout.includes('support@privacyscrubber.com')) {
      throw new Error(`pii-masking-run Test 11 (--restore) failed. Expected cleartext restored. Got: ${cli11.stdout}`);
    }
    console.log('✅ pii-masking-run --restore --token-map pass.');

    // Test 12: --hook deterministic IDE lifecycle hook (Claude Code PreToolUse & Cursor beforeReadFile)
    const hookClaudeEnv = await runCli(['--hook'], JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/workspace/.env.production' }
    }));
    const hookClaudeParsed = JSON.parse(hookClaudeEnv.stdout.trim());
    if (hookClaudeEnv.code !== 2 || hookClaudeParsed.hookSpecificOutput?.permissionDecision !== 'deny') {
      throw new Error(`pii-masking-run Test 12a (Claude PreToolUse .env) failed. Code=${hookClaudeEnv.code}, Output=${hookClaudeEnv.stdout}`);
    }

    const hookCursorEnv = await runCli(['--hook'], JSON.stringify({
      hook_event_name: 'beforeReadFile',
      file_path: '/workspace/config/secrets.json'
    }));
    const hookCursorParsed = JSON.parse(hookCursorEnv.stdout.trim());
    if (hookCursorEnv.code !== 0 || hookCursorParsed.permission !== 'deny' || !hookCursorParsed.agentMessage.includes('guard_read_file')) {
      throw new Error(`pii-masking-run Test 12b (Cursor beforeReadFile secrets.json) failed. Code=${hookCursorEnv.code}, Output=${hookCursorEnv.stdout}`);
    }

    const hookSafeFile = await runCli(['--hook'], JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/workspace/.env.example' }
    }));
    const hookSafeParsed = JSON.parse(hookSafeFile.stdout.trim());
    if (hookSafeFile.code !== 0 || hookSafeParsed.permission !== 'allow') {
      throw new Error(`pii-masking-run Test 12c (Safe .env.example) should be allowed. Code=${hookSafeFile.code}, Output=${hookSafeFile.stdout}`);
    }
    console.log('✅ pii-masking-run --hook (Claude Code & Cursor IDE deterministic hooks) pass.');

    // Test 13: --wrap Transparent MCP JSON-RPC 2.0 Stdio Proxy Wrapper (interactive turn-by-turn RPC)
    const mockUpstreamScript = [
      "const rl = require('readline').createInterface({ input: process.stdin, terminal: false });",
      "rl.on('line', (line) => {",
      "  const msg = JSON.parse(line);",
      "  if (msg.method === 'tools/list') {",
      "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'query_crm', description: 'Contact admin@example.com' }] } }) + '\\n');",
      "  } else if (msg.method === 'tools/call' && msg.params.name === 'get_customer') {",
      "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Customer email is ceo@acmecorp.io and API key is sk_live_9876543210abcdef' }] } }) + '\\n');",
      "  } else if (msg.method === 'tools/call' && msg.params.name === 'send_invoice') {",
      "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Dispatched to_len=' + String(msg.params.arguments.recipient_email || '').length + ' DomainOk=' + String(msg.params.arguments.recipient_email || '').endsWith('@acmecorp.io') }] } }) + '\\n');",
      "  }",
      "});"
    ].join(' ');

    const wrapProc = spawn(process.execPath, [path.resolve(__dirname, 'pii-masking-run.js'), '--wrap', '--', process.execPath, '-e', mockUpstreamScript], {
      env: { ...process.env, HOME: tempCliHome, USERPROFILE: tempCliHome }
    });
    let wrapBuf = '';
    const wrapPending = new Map();
    wrapProc.stdout.on('data', (chunk) => {
      wrapBuf += chunk.toString();
      let nl;
      while ((nl = wrapBuf.indexOf('\n')) !== -1) {
        const line = wrapBuf.slice(0, nl).trim();
        wrapBuf = wrapBuf.slice(nl + 1);
        if (line) {
          const parsed = JSON.parse(line);
          if (parsed.id && wrapPending.has(parsed.id)) {
            const resolve = wrapPending.get(parsed.id);
            wrapPending.delete(parsed.id);
            resolve(parsed);
          }
        }
      }
    });
    const sendWrapRpc = (id, method, params) => new Promise((resolve) => {
      wrapPending.set(id, resolve);
      wrapProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });

    // Turn 1: tools/list schema description should NOT be mutated
    const wrapRes101 = await sendWrapRpc(101, 'tools/list', {});
    if (wrapRes101.result?.tools?.[0]?.description !== 'Contact admin@example.com') {
      wrapProc.kill();
      throw new Error(`pii-masking-run Test 13a (--wrap tools/list) mutated schema description: ${JSON.stringify(wrapRes101)}`);
    }
    // Turn 2: tools/call inbound result MUST have email & stripe key scrubbed, and _meta.ztds_receipt attached
    const wrapRes102 = await sendWrapRpc(102, 'tools/call', { name: 'get_customer', arguments: { id: 1 } });
    const text102 = wrapRes102.result?.content?.[0]?.text || '';
    const receipt102 = wrapRes102.result?._meta?.ztds_receipt;
    if (!text102.includes('[EMAIL_1]') || text102.includes('ceo@acmecorp.io') || text102.includes('sk_live_9876543210abcdef')) {
      wrapProc.kill();
      throw new Error(`pii-masking-run Test 13b (--wrap inbound scrubbing) leaked cleartext PII/secret: ${text102}`);
    }
    if (!receipt102 || receipt102.zero_cleartext_egress !== true || receipt102.tokensTotal < 2) {
      wrapProc.kill();
      throw new Error(`pii-masking-run Test 13c (--wrap ztds_receipt) missing or invalid: ${JSON.stringify(receipt102)}`);
    }
    // Turn 3: tools/call outbound params MUST restore '[EMAIL_1]' -> 'ceo@acmecorp.io' (len=15, endsWith @acmecorp.io) before reaching upstream
    const wrapRes103 = await sendWrapRpc(103, 'tools/call', { name: 'send_invoice', arguments: { recipient_email: '[EMAIL_1]' } });
    wrapProc.stdin.end();
    const text103 = wrapRes103.result?.content?.[0]?.text || '';
    if (!text103.includes('to_len=15') || !text103.includes('DomainOk=true')) {
      wrapProc.kill();
      throw new Error(`pii-masking-run Test 13d (--wrap outbound detokenization) failed to restore [EMAIL_1] at upstream tool: ${text103}`);
    }
    console.log('✅ pii-masking-run --wrap (Transparent MCP JSON-RPC 2.0 bidirectional proxy) pass.');

    // ── 14. Wave 2 Security Hardening Regressions ────────────────────────
    console.log("\n---> Testing Wave 2 Security Hardening Regressions...");
    const w2DanglingLink = path.resolve(__dirname, '_temp_wave2_dangling_target.txt');
    const w2DanglingDest = path.join(os.tmpdir(), `ps-w2-dangling-dest-${Date.now()}.txt`);
    const w2BakSrc = path.resolve(__dirname, '_temp_wave2_bak_src.txt');
    const w2BakLink = `${w2BakSrc}.bak`;
    const w2BakDest = path.join(os.tmpdir(), `ps-w2-bak-dest-${Date.now()}.txt`);
    const w2InjFile = path.resolve(__dirname, '_temp_wave2_inj_secret.txt');
    const w2PwnFile = path.resolve(__dirname, '_temp_wave2_pwn.txt');
    const origConfigRaw = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;

    try {
      // Clean any leftovers
      for (const p of [w2DanglingLink, w2DanglingDest, w2BakSrc, w2BakLink, w2BakDest, w2InjFile, w2PwnFile]) {
        try { fs.unlinkSync(p); } catch (_) {}
      }

      // 14a. Dangling target symlink blocked by guard_apply_patch
      fs.symlinkSync(w2DanglingDest, w2DanglingLink);
      const resDanglingTarget = await sendRequest('tools/call', {
        name: 'guard_apply_patch',
        arguments: { file_path: w2DanglingLink, content: 'pwned-content' }
      });
      const textDanglingTarget = resDanglingTarget.result?.content?.[0]?.text || '';
      if (!resDanglingTarget.result?.isError || !/symlink|Security policy violation/i.test(textDanglingTarget) || fs.existsSync(w2DanglingDest)) {
        throw new Error(`Wave 2 Test 14a failed: guard_apply_patch did not block dangling symlink target: ${textDanglingTarget}`);
      }

      // 14b. Dangling .bak symlink blocked by guard_apply_patch
      fs.writeFileSync(w2BakSrc, 'ORIGINAL_SAFE=1\n', 'utf8');
      fs.symlinkSync(w2BakDest, w2BakLink);
      const resDanglingBak = await sendRequest('tools/call', {
        name: 'guard_apply_patch',
        arguments: { file_path: w2BakSrc, content: 'ORIGINAL_SAFE=2\n', create_backup: true }
      });
      const textDanglingBak = resDanglingBak.result?.content?.[0]?.text || '';
      if (!resDanglingBak.result?.isError || !/symlink|Security policy violation/i.test(textDanglingBak) || fs.existsSync(w2BakDest)) {
        throw new Error(`Wave 2 Test 14b failed: guard_apply_patch did not block dangling .bak symlink: ${textDanglingBak}`);
      }
      console.log('✅ Wave 2 dangling symlink & dangling .bak symlink blocking pass.');

      // 14c. guard_exec reverseTokensShellSafe neutralizes shell injection inside RAM tokens
      fs.writeFileSync(configPath, JSON.stringify({
        customRules: [
          { pattern: 'SECRET_TEST_PAT', label: 'TEST_SECRET' },
          { pattern: 'SECRET_SHELL_INJ_[^#\\r\\n]+', label: 'SHELL_INJ' }
        ]
      }), 'utf8');
      const injSecret = `SECRET_SHELL_INJ_$(node -e "require('fs').writeFileSync(${JSON.stringify(w2PwnFile)},'PWNED')")`;
      fs.writeFileSync(w2InjFile, `${injSecret}#end\n`, 'utf8');
      const readInjRes = await sendRequest('tools/call', {
        name: 'guard_read_file',
        arguments: { file_path: w2InjFile, profile: 'General' }
      });
      const readInjText = readInjRes.result?.content?.[0]?.text || '';
      const injTokenMatch = readInjText.match(/\[SHELL_INJ_\d+\]/);
      if (!injTokenMatch || readInjText.includes(injSecret)) {
        throw new Error(`Wave 2 Test 14c setup failed: guard_read_file did not mask shell injection secret: ${readInjText}`);
      }
      const injToken = injTokenMatch[0];

      // 14c. Verify default-deny on main server (no --allow-exec-unmask / --unsafe-expose-unmask-rpc), then verify shell-safe neutralization with --allow-exec-unmask
      const defaultUnmaskDeny = await sendRequest('tools/call', {
        name: 'guard_unmask_args',
        arguments: { tool_args: { s: injToken } }
      });
      if (!defaultUnmaskDeny.result?.isError) {
        throw new Error('Wave 2 Test 14c failed: guard_unmask_args must fail closed without --unsafe-expose-unmask-rpc');
      }
      const defaultExecUnmaskDeny = await sendRequest('tools/call', {
        name: 'guard_exec',
        arguments: { command: 'echo ok', unmask: true }
      });
      if (!defaultExecUnmaskDeny.result?.isError) {
        throw new Error('Wave 2 Test 14c failed: guard_exec(unmask:true) must fail closed without --allow-exec-unmask');
      }
      const defaultExecLiteralRes = await sendRequest('tools/call', {
        name: 'guard_exec',
        arguments: {
          command: `node -e "console.log('IS_LITERAL=' + (process.argv[1] === '${injToken}'))" "${injToken}"`,
          profile: 'General'
        }
      });
      if (!(defaultExecLiteralRes.result?.content?.[0]?.text || '').includes('IS_LITERAL=true')) {
        throw new Error(`Wave 2 Test 14c failed: default guard_exec substituted token without --allow-exec-unmask: ${JSON.stringify(defaultExecLiteralRes)}`);
      }

      // Now verify reverseTokensShellSafe neutralizes shell injection when --allow-exec-unmask is explicitly enabled
      const optInExecRes = await new Promise((resolve, reject) => {
        const p = spawn(process.execPath, ['--require', preloadPath, indexScript, '--allow-exec-unmask'], {
          env: {
            ...process.env,
            HOME: tempMainHome,
            USERPROFILE: tempMainHome,
            PRIVACYSCRUBBER_KEY: process.env.PS_CI_PRO_TEST_KEY || ephemeralToken,
            PS_EPHEMERAL_TEST_TOKEN: ephemeralToken,
            PS_LM_PATH: path.resolve(__dirname, 'ps-license-manager.cjs')
          }
        });
        let b = '';
        const pend = new Map();
        p.stdout.on('data', (d) => {
          b += d.toString();
          let nl;
          while ((nl = b.indexOf('\n')) !== -1) {
            const line = b.slice(0, nl).trim();
            b = b.slice(nl + 1);
            if (!line) continue;
            try {
              const m = JSON.parse(line);
              if (m.id && pend.has(m.id)) {
                const fn = pend.get(m.id);
                pend.delete(m.id);
                fn(m);
              }
            } catch (_) {}
          }
        });
        p.on('error', reject);
        const call = (id, method, params) => new Promise(r => {
          pend.set(id, r);
          p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
        (async () => {
          await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'w2-exec', version: '1.0' } });
          const rRead = await call(2, 'tools/call', { name: 'guard_read_file', arguments: { file_path: w2InjFile, profile: 'General' } });
          const tok = ((rRead.result?.content?.[0]?.text || '').match(/\[SHELL_INJ_\d+\]/) || [injToken])[0];
          const rExec = await call(3, 'tools/call', {
            name: 'guard_exec',
            arguments: {
              command: `node -e "console.log('LEN_Q=' + process.argv[1].length + ',LEN_U=' + process.argv[2].length)" "${tok}" ${tok}`,
              profile: 'General'
            }
          });
          p.kill();
          resolve(rExec);
        })().catch(e => { p.kill(); reject(e); });
      });
      const execInjText = optInExecRes.result?.content?.[0]?.text || '';
      const expectedLen = injSecret.length;
      if (fs.existsSync(w2PwnFile) || !execInjText.includes(`LEN_Q=${expectedLen},LEN_U=${expectedLen}`)) {
        throw new Error(`Wave 2 Test 14c failed: shell injection executed or length mismatch (expected ${expectedLen}). Got: ${execInjText}`);
      }
      console.log('[PASS] Wave 2 guard_exec default-deny + opt-in shell-safe token neutralization pass.');

      // 14d. pii-masking-run.js --hook blocks run_terminal_cmd (.env) and fails closed on malformed JSON
      const hookRunTerm = await runCli(['--hook'], JSON.stringify({
        tool_name: 'run_terminal_cmd',
        tool_input: { command: 'cat .env' }
      }));
      let hookRunTermParsed = {};
      try { hookRunTermParsed = JSON.parse(hookRunTerm.stdout); } catch (_) {}
      if (hookRunTerm.code !== 2 || hookRunTermParsed.permission !== 'deny') {
        throw new Error(`Wave 2 Test 14d failed (run_terminal_cmd .env): code=${hookRunTerm.code}, stdout=${hookRunTerm.stdout}`);
      }

      const hookMalformed = await runCli(['--hook'], '{not-valid-json');
      let hookMalformedParsed = {};
      try { hookMalformedParsed = JSON.parse(hookMalformed.stdout); } catch (_) {}
      if (hookMalformed.code !== 2 || hookMalformedParsed.permission !== 'deny') {
        throw new Error(`Wave 2 Test 14d failed (malformed JSON fail-closed): code=${hookMalformed.code}, stdout=${hookMalformed.stdout}`);
      }
      console.log('✅ Wave 2 pii-masking-run --hook hardening (run_terminal_cmd + fail-closed JSON) pass.');
    } finally {
      if (origConfigRaw !== null) {
        fs.writeFileSync(configPath, origConfigRaw, 'utf8');
      }
      for (const p of [w2DanglingLink, w2DanglingDest, w2BakSrc, w2BakLink, w2BakDest, w2InjFile, w2PwnFile]) {
        try { fs.unlinkSync(p); } catch (_) {}
      }
    }

    // ── 15. Wave 3 Toolset Modes, Clean Responses & Free-Limit Hardening ──
    console.log("\n---> Testing Wave 3 Toolset Modes, Clean Responses & Daily-Limit Hardening...");

    async function runMcpOneOff(cliFlags = [], envOverrides = {}, calls = [], extraNodeArgs = []) {
      const cleanEnv = { ...process.env };
      delete cleanEnv.PLUGIN_ROOT;
      delete cleanEnv.PRIVACYSCRUBBER_TOOLSET;
      delete cleanEnv.ZTDS_GUARD_LOCAL;
      delete cleanEnv.NODE_ENV;
      delete cleanEnv.PRIVACYSCRUBBER_TEST_MODE;
      delete cleanEnv.PRIVACYSCRUBBER_KEY;
      delete cleanEnv.PRIVACYSCRUBBER_LICENSE_KEY;
      delete cleanEnv.ZTDS_LICENSE;
      delete cleanEnv.ZTDS_LICENSE_KEY;
      for (const [k, v] of Object.entries(envOverrides)) {
        if (v === undefined || v === null) delete cleanEnv[k];
        else cleanEnv[k] = v;
      }

      return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [...extraNodeArgs, indexScript, ...cliFlags], { env: cleanEnv });
        let buf = '';
        const pending = new Map();
        const timer = setTimeout(() => {
          proc.kill();
          reject(new Error(`One-off MCP session timed out (${cliFlags.join(' ')})`));
        }, 15000);

        proc.stdout.on('data', (chunk) => {
          buf += chunk.toString();
          let nl;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.id && pending.has(msg.id)) {
                const resFn = pending.get(msg.id);
                pending.delete(msg.id);
                resFn(msg);
              }
            } catch (_) {}
          }
        });
        proc.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });

        const rpc = (id, method, params = {}) => new Promise((resFn) => {
          pending.set(id, resFn);
          proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });

        (async () => {
          try {
            await rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'w3-qa', version: '1.0' } });
            const out = [];
            let cid = 2;
            for (const c of calls) {
              out.push(await rpc(cid++, c.method, c.params || {}));
            }
            clearTimeout(timer);
            proc.kill();
            resolve(out);
          } catch (err) {
            clearTimeout(timer);
            proc.kill();
            reject(err);
          }
        })();
      });
    }

    const tempWave3Home = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-w3-home-'));
    try {
      // 15a. Default 'agent' toolset = 9 tools (<15KB JSON, no guard_unmask_args), ztds_sanitize still callable
      const [agentToolsRes, agentZtdsCall] = await runMcpOneOff([], { HOME: tempWave3Home, USERPROFILE: tempWave3Home }, [
        { method: 'tools/list' },
        { method: 'tools/call', params: { name: 'ztds_sanitize', arguments: { text: 'Email alice@example.com' } } }
      ]);
      const agentTools = agentToolsRes.result?.tools || [];
      const agentJsonBytes = Buffer.byteLength(JSON.stringify(agentToolsRes.result), 'utf8');
      const expectedAgentNames = ['sanitize_text', 'reveal_text', 'guard_read_file', 'guard_exec', 'guard_git_diff', 'guard_apply_patch', 'guard_session_info', 'guard_session_reset', 'mark_false_positive'];
      if (agentTools.length !== 9 || !expectedAgentNames.every(n => agentTools.some(t => t.name === n)) || agentTools.some(t => t.name === 'guard_unmask_args')) {
        throw new Error(`Default agent toolset expected 9 exact tools (without guard_unmask_args), got ${agentTools.length}: ${agentTools.map(t => t.name).join(', ')}`);
      }
      if (agentJsonBytes >= 15 * 1024) {
        throw new Error(`Default agent tools/list JSON exceeded 15KB limit: ${agentJsonBytes} bytes`);
      }
      if (agentZtdsCall.error || agentZtdsCall.result?.isError || !agentZtdsCall.result?.structuredContent?.zeroEgressAttested) {
        throw new Error(`ztds_sanitize failed backward-compat call under default agent toolset: ${JSON.stringify(agentZtdsCall)}`);
      }
      console.log(`[PASS] Wave 3 default agent toolset verified (9 tools, ${agentJsonBytes} bytes < 15KB, full dispatch compat).`);

      // 15b. --toolset=core (5), PRIVACYSCRUBBER_TOOLSET=ztds (5), PLUGIN_ROOT -> full (27), plus --unsafe-expose-unmask-rpc (10 / 28)
      const [coreToolsRes] = await runMcpOneOff(['--toolset=core'], { HOME: tempWave3Home, USERPROFILE: tempWave3Home }, [{ method: 'tools/list' }]);
      const [ztdsToolsRes] = await runMcpOneOff([], { HOME: tempWave3Home, USERPROFILE: tempWave3Home, PRIVACYSCRUBBER_TOOLSET: 'ztds' }, [{ method: 'tools/list' }]);
      const [pluginToolsRes] = await runMcpOneOff([], { HOME: tempWave3Home, USERPROFILE: tempWave3Home, PLUGIN_ROOT: '/tmp/fake-plugin' }, [{ method: 'tools/list' }]);
      const [optInAgentToolsRes] = await runMcpOneOff(['--unsafe-expose-unmask-rpc'], { HOME: tempWave3Home, USERPROFILE: tempWave3Home }, [{ method: 'tools/list' }]);
      const [optInFullToolsRes] = await runMcpOneOff(['--toolset=full', '--unsafe-expose-unmask-rpc'], { HOME: tempWave3Home, USERPROFILE: tempWave3Home }, [{ method: 'tools/list' }]);
      if ((coreToolsRes.result?.tools || []).length !== 5 ||
          (ztdsToolsRes.result?.tools || []).length !== 5 ||
          (pluginToolsRes.result?.tools || []).length !== 27 ||
          (optInAgentToolsRes.result?.tools || []).length !== 10 ||
          (optInFullToolsRes.result?.tools || []).length !== 28) {
        throw new Error(`Toolset counts mismatch: core=${coreToolsRes.result?.tools?.length}, ztds=${ztdsToolsRes.result?.tools?.length}, plugin=${pluginToolsRes.result?.tools?.length}, optInAgent=${optInAgentToolsRes.result?.tools?.length}, optInFull=${optInFullToolsRes.result?.tools?.length}`);
      }
      console.log("[PASS] Wave 3 toolset variants (--toolset=core=5, ztds=5, PLUGIN_ROOT=27, opt-in agent=10, opt-in full=28) verified.");

      // 15b.1 Verify --help accuracy and opt-in initialize.instructions
      const helpOut = execFileSync(process.execPath, [indexScript, '--help'], { encoding: 'utf8' });
      if (!helpOut.includes('core (5), agent (9, default), ztds (5), full (27)') || !helpOut.includes('--unsafe-expose-unmask-rpc')) {
        throw new Error(`--help output inaccurate: ${helpOut}`);
      }
      const optInInitInstructions = await new Promise((resolve, reject) => {
        const p = spawn(process.execPath, [indexScript, '--unsafe-expose-unmask-rpc'], {
          env: { ...process.env, HOME: tempWave3Home, USERPROFILE: tempWave3Home }
        });
        let b = '';
        const t = setTimeout(() => { p.kill(); reject(new Error('opt-in initialize check timed out')); }, 10000);
        p.stdout.on('data', (c) => {
          b += c.toString();
          const lines = b.split('\n');
          b = lines.pop() || '';
          for (const l of lines) {
            if (!l.trim()) continue;
            try {
              const m = JSON.parse(l);
              if (m.id === 1) {
                clearTimeout(t);
                p.kill();
                resolve(m.result?.instructions || '');
              }
            } catch (_) {}
          }
        });
        p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'w3-help', version: '1.0' } } }) + '\n');
      });
      if (!optInInitInstructions.includes('guard_unmask_args')) {
        throw new Error('Opt-in initialize.instructions should include guard_unmask_args when --unsafe-expose-unmask-rpc is set');
      }
      console.log("[PASS] Wave 3 --help counts and conditional initialize.instructions verified.");

      // 15b.2 F-10 16MB single-line stdio frame returns clean JSON-RPC error instead of hanging
      const oversizeRpcRes = await new Promise((resolve, reject) => {
        const p = spawn(process.execPath, [indexScript], {
          env: { ...process.env, HOME: tempWave3Home, USERPROFILE: tempWave3Home }
        });
        p.stdin.on('error', () => {});
        let b = '';
        const t = setTimeout(() => { p.kill(); reject(new Error('F-10 16MB stdio frame hung!')); }, 8000);
        p.stdout.on('data', d => {
          b += d.toString();
          let nl;
          while ((nl = b.indexOf('\n')) !== -1) {
            const line = b.slice(0, nl).trim();
            b = b.slice(nl + 1);
            if (!line) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.id === 999) {
                clearTimeout(t);
                p.kill();
                resolve(msg);
              }
            } catch (_) {}
          }
        });
        p.on('error', e => { clearTimeout(t); reject(e); });
        const hugeLine = '{"jsonrpc":"2.0","id":999,"method":"tools/call","params":{"name":"sanitize_text","arguments":{"text":"' + 'A'.repeat(12 * 1024 * 1024) + '"}}}\n';
        p.stdin.write(hugeLine);
      });
      if (!oversizeRpcRes.error || oversizeRpcRes.error.code !== -32600) {
        throw new Error(`F-10 oversized JSON-RPC frame expected -32600 error, got: ${JSON.stringify(oversizeRpcRes)}`);
      }
      console.log("[PASS] F-10 10MB stdio frame guard returned clean JSON-RPC -32600 error without hanging.");
    } finally {
      try { fs.rmSync(tempWave3Home, { recursive: true, force: true }); } catch (_) {}
    }

    // 15c. Daily limit 100 (ZTDS_GUARD_LOCAL=1 no longer bypasses), zero prompt injection/emojis, guard_apply_patch unblocked
    const tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-w3-limit-home-'));
    const todayStr = new Date().toISOString().split('T')[0];
    fs.writeFileSync(path.join(tempHomeDir, '.privacyscrubber-usage.json'), JSON.stringify({ date: todayStr, count: 99 }), 'utf8');
    const tempPatchW3 = path.resolve(__dirname, `_temp_w3_patch_${Date.now()}.txt`);
    try {
      const [blockedSanitize, allowedPatch] = await runMcpOneOff([], {
        HOME: tempHomeDir,
        USERPROFILE: tempHomeDir,
        ZTDS_GUARD_LOCAL: '1'
      }, [
        { method: 'tools/call', params: { name: 'sanitize_text', arguments: { text: 'Test alice@corp.io' } } },
        { method: 'tools/call', params: { name: 'guard_apply_patch', arguments: { file_path: tempPatchW3, content: 'SAFE_CONFIG=ok\n', create_backup: false } } }
      ]);
      const blockedText = blockedSanitize.result?.content?.[0]?.text || '';
      if (!blockedSanitize.result?.isError || !blockedText.includes('100 requests')) {
        throw new Error(`Expected daily limit 100 block (without ZTDS_GUARD_LOCAL bypass), got: ${JSON.stringify(blockedSanitize)}`);
      }
      if (cleanAuditBannedRx.test(blockedText) || blockedText.includes('generate_procurement_memo')) {
        throw new Error(`Daily limit response contained banned emoji or prompt injection: ${blockedText}`);
      }
      if (allowedPatch.result?.isError || !fs.existsSync(tempPatchW3) || fs.readFileSync(tempPatchW3, 'utf8') !== 'SAFE_CONFIG=ok\n') {
        throw new Error(`guard_apply_patch was blocked or failed at daily limit: ${JSON.stringify(allowedPatch)}`);
      }
      console.log("✅ Wave 3 daily limit 100, ZTDS_GUARD_LOCAL removal, zero prompt injection, and unblocked guard_apply_patch verified.");
    } finally {
      try { fs.rmSync(tempHomeDir, { recursive: true, force: true }); } catch (_) {}
      try { if (fs.existsSync(tempPatchW3)) fs.unlinkSync(tempPatchW3); } catch (_) {}
    }

    // 15d. Python native fallback clean receipt + readOnlyHint: false
    const tempPyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-w3-py-home-'));
    try {
      const pyFallbackRes = await new Promise((resolve, reject) => {
        const pyPath = path.resolve(__dirname, 'src', 'privacyscrubber_mcp', 'server.py');
        const pyProc = spawn('python3', [pyPath, '--native'], {
          cwd: __dirname,
          env: { ...process.env, HOME: tempPyHome, USERPROFILE: tempPyHome }
        });
        let pBuf = '';
        const pPending = new Map();
        const pTimer = setTimeout(() => { pyProc.kill(); reject(new Error('Python MCP fallback timeout')); }, 8000);
        pyProc.stdout.on('data', d => {
          pBuf += d.toString();
          let nl;
          while ((nl = pBuf.indexOf('\n')) !== -1) {
            const line = pBuf.slice(0, nl).trim();
            pBuf = pBuf.slice(nl + 1);
            if (!line) continue;
            const msg = JSON.parse(line);
            if (msg.id && pPending.has(msg.id)) {
              const fn = pPending.get(msg.id);
              pPending.delete(msg.id);
              fn(msg);
            }
          }
        });
        pyProc.on('error', err => { clearTimeout(pTimer); reject(err); });
        const sendPy = (id, method, params = {}) => new Promise(res => {
          pPending.set(id, res);
          pyProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
        (async () => {
          await sendPy(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'py-qa', version: '1.0' } });
          const tl = await sendPy(2, 'tools/list', {});
          const san = await sendPy(3, 'tools/call', { name: 'sanitize_text', arguments: { text: 'Contact alice@py.io' } });
          clearTimeout(pTimer);
          pyProc.kill();
          resolve({ tl, san });
        })().catch(e => { clearTimeout(pTimer); pyProc.kill(); reject(e); });
      });
      const pyTools = pyFallbackRes.tl.result?.tools || [];
      const pySanTool = pyTools.find(t => t.name === 'sanitize_text');
      const pyFileTool = pyTools.find(t => t.name === 'sanitize_file');
      const pySanText = pyFallbackRes.san.result?.content?.[0]?.text || '';
      if (pySanTool?.annotations?.readOnlyHint !== false || pyFileTool?.annotations?.readOnlyHint !== false) {
        throw new Error('Python server.py sanitize_text/sanitize_file must declare readOnlyHint: false');
      }
      if (!pySanText.includes('PrivacyScrubber Audit Receipt') || cleanAuditBannedRx.test(pySanText)) {
        throw new Error(`Python server.py receipt invalid or contains marketing/emojis: ${pySanText}`);
      }
      console.log("✅ Wave 3 Python native fallback annotations & clean audit receipt verified.");
    } catch (pyErr) {
      if (pyErr.code === 'ENOENT') {
        console.log("⚠️ Skipping Python fallback check (python3 not found).");
      } else {
        throw pyErr;
      }
    } finally {
      try { fs.rmSync(tempPyHome, { recursive: true, force: true }); } catch (_) {}
    }

    // -- 16. Wave 4 Security Hardening & Exploit Regression Tests ---------
    console.log("\n---> Testing Wave 4 Phase 2A Security Hardening Regressions...");
    const w4TmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-w4-reg-'));
    try {
      // 16a. NODE_ENV=test and PRIVACYSCRUBBER_TEST_MODE=1 NO LONGER bypass daily limit, and previously unmetered tools enforce limit
      const w4EnvHome = path.join(w4TmpRoot, 'home-env-bypass');
      fs.mkdirSync(w4EnvHome, { recursive: true });
      const w4UsagePath = path.join(w4EnvHome, '.privacyscrubber-usage.json');
      const testTools = [
        ['NODE_ENV=test on sanitize_text', { NODE_ENV: 'test' }, { name: 'sanitize_text', arguments: { text: 'a@b.com' } }],
        ['PRIVACYSCRUBBER_TEST_MODE=1 on sanitize_text', { PRIVACYSCRUBBER_TEST_MODE: '1' }, { name: 'sanitize_text', arguments: { text: 'a@b.com' } }],
        ['guard_rag_chunk metered', {}, { name: 'guard_rag_chunk', arguments: { chunks: ['Contact a@b.com'] } }],
        ['export_audit_log(text) metered', {}, { name: 'export_audit_log', arguments: { text: 'Contact a@b.com', format: 'jsonl' } }],
        ['audit_context metered', {}, { name: 'audit_context', arguments: { text: 'Contact a@b.com' } }],
        ['ztds_audit metered', {}, { name: 'ztds_audit', arguments: { text: 'Contact a@b.com' } }]
      ];
      for (const [label, extra, callArgs] of testTools) {
        fs.writeFileSync(w4UsagePath, JSON.stringify({ date: todayStr, count: 99, evalCount: 0 }), 'utf8');
        const [r] = await runMcpOneOff(['--toolset=full'], { HOME: w4EnvHome, USERPROFILE: w4EnvHome, ...extra }, [
          { method: 'tools/call', params: callArgs }
        ]);
        if (!r.result?.isError) {
          throw new Error(`Wave 4 Test 16a (${label}) failed to block at count=99: ${JSON.stringify(r)}`);
        }
      }
      console.log("[PASS] Wave 4 Test 16a: Env-var quota bypasses blocked and all audit/RAG tools metered.");

      // 16b. Usage file symlink, negative/non-numeric tamper, future date, chmod 0444, and concurrency race defense
      const w4TamperHome = path.join(w4TmpRoot, 'home-tamper');
      fs.mkdirSync(w4TamperHome, { recursive: true });
      const w4TamperFile = path.join(w4TamperHome, '.privacyscrubber-usage.json');
      const victimFile = path.join(w4TmpRoot, 'victim-untouched.txt');
      fs.writeFileSync(victimFile, 'DO_NOT_TOUCH', 'utf8');
      fs.symlinkSync(victimFile, w4TamperFile);
      const [symRes] = await runMcpOneOff([], { HOME: w4TamperHome, USERPROFILE: w4TamperHome }, [
        { method: 'tools/call', params: { name: 'sanitize_text', arguments: { text: 'Email x@y.com' } } }
      ]);
      if (!symRes.result?.isError || fs.readFileSync(victimFile, 'utf8') !== 'DO_NOT_TOUCH') {
        throw new Error(`Wave 4 Test 16b symlink attack must fail closed without touching victim: ${JSON.stringify(symRes)}`);
      }
      fs.unlinkSync(w4TamperFile);

      for (const badPayload of [
        JSON.stringify({ date: todayStr, count: -1000 }),
        JSON.stringify({ date: todayStr, count: '-' }),
        JSON.stringify({ date: '2099-01-01', count: 0 }),
        'not-json'
      ]) {
        fs.writeFileSync(w4TamperFile, badPayload, 'utf8');
        const [tamperRes] = await runMcpOneOff([], { HOME: w4TamperHome, USERPROFILE: w4TamperHome }, [
          { method: 'tools/call', params: { name: 'sanitize_text', arguments: { text: 'Email x@y.com' } } }
        ]);
        if (!tamperRes.result?.isError) {
          throw new Error(`Wave 4 Test 16b tampered payload (${badPayload}) must block fail closed`);
        }
      }

      fs.writeFileSync(w4TamperFile, JSON.stringify({ date: todayStr, count: 98 }), 'utf8');
      fs.chmodSync(w4TamperFile, 0o444);
      const [roRes] = await runMcpOneOff([], { HOME: w4TamperHome, USERPROFILE: w4TamperHome }, [
        { method: 'tools/call', params: { name: 'sanitize_text', arguments: { text: 'Email x@y.com' } } }
      ]);
      fs.chmodSync(w4TamperFile, 0o600);
      if (!roRes.result?.isError) {
        throw new Error('Wave 4 Test 16b chmod 0444 usage file must fail closed');
      }

      const w4RaceHome = path.join(w4TmpRoot, 'home-race');
      fs.mkdirSync(w4RaceHome, { recursive: true });
      fs.writeFileSync(path.join(w4RaceHome, '.privacyscrubber-usage.json'), JSON.stringify({ date: todayStr, count: 96, evalCount: 0 }), 'utf8');
      const raceCalls = Array.from({ length: 5 }, () => runMcpOneOff([], { HOME: w4RaceHome, USERPROFILE: w4RaceHome }, [
        { method: 'tools/call', params: { name: 'sanitize_text', arguments: { text: 'Email x@y.com' } } }
      ]));
      const raceResults = await Promise.all(raceCalls);
      const raceAllowed = raceResults.filter(([r]) => !r.result?.isError).length;
      if (raceAllowed > 3) {
        throw new Error(`Wave 4 Test 16b parallel usage race allowed ${raceAllowed} requests from count=96 (expected <=3)`);
      }
      console.log("[PASS] Wave 4 Test 16b: Usage symlink, tamper, chmod 0444, and concurrency race defenses verified.");

      // 16c. EVAL daily cap + PROFILE_NOT_LICENSED for scoped licenses + check_status tier labels
      const w4ScopePreload = path.join(w4TmpRoot, 'scope-preload.cjs');
      const evalToken = 'PS-W4-EVAL-' + crypto.randomUUID();
      const medToken = 'PS-W4-MED-' + crypto.randomUUID();
      fs.writeFileSync(w4ScopePreload, [
        'const LM = require(process.env.PS_LM_PATH);',
        'const orig = LM.validate.bind(LM);',
        'LM.validate = function(k, opts) {',
        '  if (k === process.env.W4_EVAL_TOK) return { valid: true, tier: "EVAL", specializedProfiles: false, allowedProfiles: ["universal"] };',
        '  if (k === process.env.W4_MED_TOK) return { valid: true, tier: "SDK", specializedProfiles: true, allowedProfiles: ["medical"] };',
        '  return orig(k, opts);',
        '};'
      ].join('\n'), 'utf8');

      const w4EvalHome = path.join(w4TmpRoot, 'home-eval');
      fs.mkdirSync(w4EvalHome, { recursive: true });
      fs.writeFileSync(path.join(w4EvalHome, '.privacyscrubber-usage.json'), JSON.stringify({ date: todayStr, count: 0, evalCount: 249 }), 'utf8');
      const [evalStatus, evalMedErr, evalLimitErr] = await runMcpOneOff(['--toolset=full'], {
        HOME: w4EvalHome,
        USERPROFILE: w4EvalHome,
        PRIVACYSCRUBBER_KEY: evalToken,
        W4_EVAL_TOK: evalToken,
        W4_MED_TOK: medToken,
        PS_LM_PATH: path.resolve(__dirname, 'ps-license-manager.cjs')
      }, [
        { method: 'tools/call', params: { name: 'check_status', arguments: {} } },
        { method: 'tools/call', params: { name: 'sanitize_text', arguments: { text: 'Patient John Doe', profile: 'Medical' } } },
        { method: 'tools/call', params: { name: 'sanitize_text', arguments: { text: 'Contact a@b.com', profile: 'General' } } }
      ], ['--require', w4ScopePreload]);
      if (!String(evalStatus.result?.content?.[0]?.text || '').includes('Tier: EVAL')) {
        throw new Error(`Wave 4 Test 16c check_status must report Tier: EVAL: ${evalStatus.result?.content?.[0]?.text}`);
      }
      if (!evalMedErr.result?.isError || !String(evalMedErr.result?.content?.[0]?.text || '').includes('PROFILE_NOT_LICENSED')) {
        throw new Error(`Wave 4 Test 16c EVAL must reject explicit Medical profile: ${JSON.stringify(evalMedErr)}`);
      }
      if (!evalLimitErr.result?.isError || !String(evalLimitErr.result?.content?.[0]?.text || '').includes('250 requests')) {
        throw new Error(`Wave 4 Test 16c EVAL must enforce 250/day limit: ${JSON.stringify(evalLimitErr)}`);
      }

      const [medStatus, finBlocked, medOk] = await runMcpOneOff(['--toolset=full'], {
        HOME: w4EvalHome,
        USERPROFILE: w4EvalHome,
        PRIVACYSCRUBBER_KEY: medToken,
        W4_EVAL_TOK: evalToken,
        W4_MED_TOK: medToken,
        PS_LM_PATH: path.resolve(__dirname, 'ps-license-manager.cjs')
      }, [
        { method: 'tools/call', params: { name: 'check_status', arguments: {} } },
        { method: 'tools/call', params: { name: 'sanitize_text', arguments: { text: 'IBAN DE89370400440532013000', profile: 'Finance' } } },
        { method: 'tools/call', params: { name: 'sanitize_text', arguments: { text: 'Patient John Doe email patient@clinic.org', profile: 'Medical' } } }
      ], ['--require', w4ScopePreload]);
      if (!String(medStatus.result?.content?.[0]?.text || '').includes('Tier: SDK')) {
        throw new Error(`Wave 4 Test 16c check_status must report Tier: SDK: ${medStatus.result?.content?.[0]?.text}`);
      }
      if (!finBlocked.result?.isError || !String(finBlocked.result?.content?.[0]?.text || '').includes('PROFILE_NOT_LICENSED')) {
        throw new Error(`Wave 4 Test 16c scoped license must reject Finance profile: ${JSON.stringify(finBlocked)}`);
      }
      if (medOk.result?.isError) {
        throw new Error(`Wave 4 Test 16c scoped license must allow Medical profile: ${JSON.stringify(medOk)}`);
      }
      console.log("[PASS] Wave 4 Test 16c: EVAL daily cap, scoped allowedProfiles enforcement, and check_status tier labels verified.");

      // 16d. sanitize_file 10k .js no-crash, audit_directory_for_pii no-false-clean, guard_rag_chunk batch cap, ReDoS nested-alt/overlap reject
      const w4WsDir = path.resolve(__dirname, `_temp_w4_ws_${Date.now()}`);
      fs.mkdirSync(w4WsDir, { recursive: true });
      const bigJsPath = path.join(w4WsDir, 'large_module.js');
      const bigLeakPath = path.join(w4WsDir, 'big_audit.txt');
      fs.writeFileSync(bigJsPath, 'const cfg = "ok";\n'.repeat(600) + 'const email = "dev@corp.io";\n', 'utf8');
      fs.writeFileSync(bigLeakPath, 'Safe header line\n'.repeat(1000) + 'leak@acme.com\n', 'utf8');

      const w4SafeHome = path.join(w4TmpRoot, 'home-free-files');
      fs.mkdirSync(w4SafeHome, { recursive: true });
      const w4RedosCfg = path.join(w4TmpRoot, 'redos-cfg.json');
      fs.writeFileSync(w4RedosCfg, JSON.stringify({
        customRules: [
          { pattern: '(?:(?:a|aa))+!', label: 'ALT_REDOS' },
          { pattern: '[a-z]*[a-z0-9]*[A-Za-z]*[0-9a-z]*[a-z_]*!', label: 'POLY_REDOS' },
          { pattern: 'SAFE_TOKEN_[0-9]{4}', label: 'SAFE_TOK' }
        ]
      }), 'utf8');
      const prevCfgBackup = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;
      fs.writeFileSync(configPath, fs.readFileSync(w4RedosCfg, 'utf8'), 'utf8');
      try {
        const [js10kRes, dirRes, ragOverRes] = await runMcpOneOff(['--toolset=full'], { HOME: w4SafeHome, USERPROFILE: w4SafeHome }, [
          { method: 'tools/call', params: { name: 'sanitize_file', arguments: { file_path: path.relative(process.cwd(), bigJsPath) } } },
          { method: 'tools/call', params: { name: 'audit_directory_for_pii', arguments: { directory_path: path.relative(process.cwd(), w4WsDir) } } },
          { method: 'tools/call', params: { name: 'guard_rag_chunk', arguments: { profile: 'Medical', chunks: ['A'.repeat(4000), 'B'.repeat(4000)] } } }
        ]);
        if (js10kRes.result?.isError) {
          throw new Error(`Wave 4 Test 16d 10k .js sanitize_file crashed on Free tier: ${JSON.stringify(js10kRes)}`);
        }
        const dirText = dirRes.result?.content?.[0]?.text || '';
        if (dirText.includes('Clean. No PII or secrets detected')) {
          throw new Error(`Wave 4 Test 16d audit_directory_for_pii reported false Clean on truncated >15k file: ${dirText}`);
        }
        if (!ragOverRes.result?.isError || !String(ragOverRes.result?.content?.[0]?.text || '').includes('batch budget exceeded')) {
          throw new Error(`Wave 4 Test 16d guard_rag_chunk must enforce aggregate batch cap: ${JSON.stringify(ragOverRes)}`);
        }

        const tRedosStart = Date.now();
        const [redosCheck] = await runMcpOneOff(['--toolset=full'], {
          HOME: w4SafeHome,
          USERPROFILE: w4SafeHome,
          PRIVACYSCRUBBER_KEY: medToken,
          W4_MED_TOK: medToken,
          PS_LM_PATH: path.resolve(__dirname, 'ps-license-manager.cjs')
        }, [
          { method: 'tools/call', params: { name: 'sanitize_text', arguments: { profile: 'Medical', text: 'SAFE_TOKEN_1234 ' + 'a'.repeat(30) } } }
        ], ['--require', w4ScopePreload]);
        const elapsedMs = Date.now() - tRedosStart;
        const redosOut = redosCheck.result?.content?.[0]?.text || '';
        if (elapsedMs > 5000 || !redosOut.includes('[SAFE_TOK_1]')) {
          throw new Error(`Wave 4 Test 16d ReDoS filter failed or hung (${elapsedMs}ms): ${redosOut}`);
        }
      } finally {
        if (prevCfgBackup !== null) fs.writeFileSync(configPath, prevCfgBackup, 'utf8');
        else if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
        try { fs.rmSync(w4WsDir, { recursive: true, force: true }); } catch (_) {}
      }
      console.log("[PASS] Wave 4 Test 16d: Free file/batch caps and ReDoS custom-rule filter verified.");

      // 16e. pii-masking-run.js quota fail-closed & Python server.py non-recursion + crypto license + session isolation + JWT suppression
      fs.writeFileSync(path.join(w4SafeHome, '.privacyscrubber-usage.json'), JSON.stringify({ date: todayStr, count: 99, evalCount: 0 }), 'utf8');
      const blockedCli = await runCli(['--', 'echo', 'Secret alice@acme.com'], null, { HOME: w4SafeHome, USERPROFILE: w4SafeHome });
      if (blockedCli.code === 0 || blockedCli.stdout.includes('alice@acme.com')) {
        throw new Error(`Wave 4 Test 16e pii-masking-run failed open at count=99: code=${blockedCli.code}, out=${blockedCli.stdout}`);
      }

      const w4PyCheck = await new Promise((resolve, reject) => {
        const pyPath = path.resolve(__dirname, 'src', 'privacyscrubber_mcp', 'server.py');
        const pyHome = path.join(w4TmpRoot, 'home-py-w4');
        const fakeBin = path.join(w4TmpRoot, 'py-bin');
        fs.mkdirSync(pyHome, { recursive: true });
        fs.mkdirSync(fakeBin, { recursive: true });
        const fakeWrapper = path.join(fakeBin, 'privacyscrubber-mcp');
        fs.writeFileSync(fakeWrapper, '#!/usr/bin/env python3\nimport sys\nsys.exit(99)\n', { mode: 0o755 });
        const pyP = spawn('python3', [pyPath, '--native'], {
          cwd: __dirname,
          env: {
            ...process.env,
            HOME: pyHome,
            USERPROFILE: pyHome,
            PATH: `${fakeBin}:${process.env.PATH || ''}`,
            PRIVACYSCRUBBER_KEY: 'BOGUS-NOT-VALID-KEY'
          }
        });
        let pBuf = '';
        const pMap = new Map();
        const t = setTimeout(() => { pyP.kill(); reject(new Error('Wave 4 Python regression timeout')); }, 8000);
        pyP.stdout.on('data', d => {
          pBuf += d.toString();
          let nl;
          while ((nl = pBuf.indexOf('\n')) !== -1) {
            const line = pBuf.slice(0, nl).trim();
            pBuf = pBuf.slice(nl + 1);
            if (!line) continue;
            const m = JSON.parse(line);
            if (m.id && pMap.has(m.id)) {
              const fn = pMap.get(m.id);
              pMap.delete(m.id);
              fn(m);
            }
          }
        });
        const sendPy = (id, method, params = {}) => new Promise(res => {
          pMap.set(id, res);
          pyP.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
        (async () => {
          await sendPy(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'py-w4', version: '1.0' } });
          const stRes = await sendPy(2, 'tools/call', { name: 'check_status', arguments: {} });
          const sA = await sendPy(3, 'tools/call', { name: 'sanitize_text', arguments: { text: 'Email secret-a@corp.io and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature12345', session_id: 'agent-A' } });
          const sB = await sendPy(4, 'tools/call', { name: 'reveal_text', arguments: { text: 'Leak [EMAIL_1]', session_id: 'agent-B' } });
          const fpJwt = await sendPy(5, 'tools/call', { name: 'mark_false_positive', arguments: { token: '[JWT_1]', session_id: 'agent-A' } });
          clearTimeout(t);
          pyP.kill();
          resolve({ stRes, sA, sB, fpJwt });
        })().catch(e => { clearTimeout(t); pyP.kill(); reject(e); });
      }).catch(e => (e.code === 'ENOENT' ? null : Promise.reject(e)));

      if (w4PyCheck) {
        const pyStatus = w4PyCheck.stRes.result?.content?.[0]?.text || '';
        const pyRevB = w4PyCheck.sB.result?.content?.[0]?.text || '';
        const pyFpJwt = w4PyCheck.fpJwt.result?.content?.[0]?.text || '';
        if (!pyStatus.includes('Tier: FREE')) {
          throw new Error(`Wave 4 Test 16e Python fallback accepted bogus key: ${pyStatus}`);
        }
        if (pyRevB.includes('secret-a@corp.io')) {
          throw new Error(`Wave 4 Test 16e Python fallback leaked agent-A secret into agent-B: ${pyRevB}`);
        }
        if (pyFpJwt.includes('eyJhbGciOiJIUzI1NiJ9') || !pyFpJwt.includes('suppressed')) {
          throw new Error(`Wave 4 Test 16e Python mark_false_positive failed to suppress JWT secret: ${pyFpJwt}`);
        }
      }
      console.log("[PASS] Wave 4 Test 16e: pii-masking-run fail-closed and Python server.py hardening verified.");
    } finally {
      try { fs.rmSync(w4TmpRoot, { recursive: true, force: true }); } catch (_) {}
    }

    console.log("\n🎉 All deep integration, hardening, and CLI tests passed successfully!");
    // ─────────────────────────────────────────────────────────────────────
    mcpProcess.kill();
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    if (fs.existsSync(preloadPath)) {
      fs.unlinkSync(preloadPath);
    }
    try { fs.rmSync(tempMainHome, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(tempCliHome, { recursive: true, force: true }); } catch (_) {}
    process.exit(0);

  } catch (error) {
    console.error("❌ Test failed:", error.message);
    mcpProcess.kill();
    const configPath = path.resolve(process.cwd(), 'privacyscrubber.json');
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    if (fs.existsSync(preloadPath)) {
      fs.unlinkSync(preloadPath);
    }
    try { fs.rmSync(tempMainHome, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(tempCliHome, { recursive: true, force: true }); } catch (_) {}
    process.exit(1);
  }
}

runMcpSession();
