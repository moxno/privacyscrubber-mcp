import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

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

  // Set license key to valid PRO key for advanced test
  const validKey = "eyJ0eXBlIjoicHJvIiwiZXhwaXJlcyI6MjA5OTA2MjE3NCwiaXNzdWVkQXQiOjE3ODM3MDIxNzQsIm5vbmNlIjoiMmI4MTllN2ZmM2ZmOTFmYiJ9.ZmhaKDGf9vG0nTH0nyOy3EInsuUmzjBOk9IOyiqzt6Y5s3UG+2yRExuKBoeXWymbpJt3NIJNM9sVxxl+lcop5wqbi2LNtPY4MuwBRA7pO4nn3Bes5R0lxLbEYVE8Iiw3zbfK4uVYQ53BJ7El6JCeFKPJ5WbKUsPLsjb1Lr2iQzW3ODOMaM5jKdgAGcNpuWQ373D7SW7I03Jec9kvP5hL7j3u4DV8ZzuQFzy2Nh+uMH54suydg2sNIpxrRQyxpGv7rZjTO1KT+xzzqnjqX4Pein0e6GrC5E4JUEggADtXPFMKW5SEiWzeeirB5RUPMO/F927S5fFuOYHAfuar2FqErA==";
  
  const mcpProcess = spawn('node', [indexScript], {
    env: {
      ...process.env,
      PRIVACYSCRUBBER_KEY: validKey
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

    if (tools.length !== 5) {
      throw new Error(`Expected 5 tools, got ${tools.length}`);
    }
    if (!tools.find(t => t.name === 'check_status')) {
      throw new Error('check_status tool is missing from tools list');
    }
    if (!tools.find(t => t.name === 'create_default_config')) {
      throw new Error('create_default_config tool is missing from tools list');
    }

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
    console.log("✅ Sanitize text success.");

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
    if (!revealedText.includes("john.doe@example.com")) {
      throw new Error("Reveal failed to restore the original email.");
    }
    console.log("✅ Reveal text success.");

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
    const docxSource = path.resolve(__dirname, '../PrivacyScrubber/outreach-campaigns/guest-posts/Techbullion_GuestPost.docx');
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
    const pdfSource = '/Users/ilya/Desktop/PrivacyScrubber/PrivacyScrubber_Zero_Trust_Data_Sanitization.pdf';
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

    // 7.2. Test sanitize_file (Excel file parsing support - PRO)
    // We dynamically generate xlsx using require to ensure we have a valid format
    const xlsx = require('xlsx');
    const tempXlsx = path.resolve(__dirname, 'temp-test-doc.xlsx');
    const ws = xlsx.utils.aoa_to_sheet([
      ["Name", "Email", "Phone"],
      ["Alice Smith", "alice@company.com", "555-0199"]
    ]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
    xlsx.writeFile(wb, tempXlsx);

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
    console.log("<-- Excel Sanitized text preview:\n", xlsxText);
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

    console.log("\n--> Spawning second MCP process WITH SPOOF SIMULATION (invalid key)...");
    
    const mcpProcess2 = spawn('node', [indexScript], {
      env: {
        ...process.env,
        PRIVACYSCRUBBER_KEY: "" // empty key
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
    console.log("--> Calling 'sanitize_text' with 'creative' profile on invalid key...");
    const bypassResponse = await sendRequest2('tools/call', {
      name: 'sanitize_text',
      arguments: {
        text: 'This draft is EMBARGOED',
        profile: 'creative'
      }
    });

    const content = bypassResponse.result?.content;
    console.log("<-- Server returned content array length:", content?.length);
    
    const scrubbedText = content?.[0]?.text || "";
    
    console.log("<-- Server Stderr captured:", stderr2.trim());
    console.log("<-- Scrubbed output text:", scrubbedText.trim());

    if (!stderr2.includes("Advanced profile 'creative' is locked")) {
      throw new Error("Outer layer bypass check failed: did not output key lock warning to stderr.");
    }
    
    if (!scrubbedText.includes("EMBARGOED")) {
      throw new Error("Core hardening failed: EMBARGOED was sanitized using creative rules on an invalid key!");
    }
    
    console.log("✅ Core hardening verified: advanced rules successfully blocked on invalid key.");

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
    if (truncatedResult.length !== 50000) {
      throw new Error(`Expected text length of 50000 after truncation, but got ${truncatedResult.length}`);
    }
    if (!stderr2.includes("Input truncated to 50000 characters")) {
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
    const pdfSourceFree = '/Users/ilya/Desktop/PrivacyScrubber/PrivacyScrubber_Zero_Trust_Data_Sanitization.pdf';
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

    console.log("\n🎉 All deep integration and hardening tests passed successfully!");
    mcpProcess.kill();
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    process.exit(0);

  } catch (error) {
    console.error("❌ Test failed:", error.message);
    mcpProcess.kill();
    const configPath = path.resolve(process.cwd(), 'privacyscrubber.json');
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    process.exit(1);
  }
}

runMcpSession();
