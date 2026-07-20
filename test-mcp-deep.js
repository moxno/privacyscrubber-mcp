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

    // 8.1. Test all 23 PII profiles and their parameters (DLP quality verification)
    console.log("\n---> Running DLP quality verification across all 23 profiles...");
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
      {
        profile: 'Pharma',
        input: "Subject ID SUBJ9012. Protocol ID IND-902. Lot Number LOT-8912.",
        excludes: ['SUBJ9012', 'IND-902', 'LOT-8912']
      },
      {
        profile: 'Legal',
        input: "Case reference CASE-8912 and docket CV-26-8912.",
        excludes: ['CASE-8912', 'CV-26-8912']
      },
      {
        profile: 'Compliance',
        input: "Audit report GDPR-AUDIT-2026 and DSAR-8912.",
        excludes: ['GDPR-AUDIT-2026', 'DSAR-8912']
      },
      {
        profile: 'CCPA',
        input: "CCPA Driver License: DL-902192. Account ID: ACC902100.",
        excludes: ['DL-902192', 'ACC902100']
      },
      {
        profile: 'Finance',
        input: "Card Number: 4111-2222-3333-4444 Routing: PORTFOLIO-12345.",
        excludes: ['4111-2222-3333-4444', 'PORTFOLIO-12345']
      },
      {
        profile: 'Bizops',
        input: "Deal: DEAL-1234. Signed NDA-9021.",
        excludes: ['DEAL-1234', 'NDA-9021']
      },
      {
        profile: 'Sales',
        input: "Opportunity OPPORTUNITY-12345. Current ARR $250K.",
        excludes: ['OPPORTUNITY-12345', '$250K']
      },
      {
        profile: 'WealthMgmt',
        input: "Routing: 021000021. Net Worth: $14M.",
        excludes: ['021000021', '$14M']
      },
      {
        profile: 'Insurance',
        input: "Claim #POL992109. VIN: 1FTFW1EF5GFA12345.",
        excludes: ['POL992109', '1FTFW1EF5GFA12345']
      },
      {
        profile: 'Accounting',
        input: "EIN: 12-3456789. Tax Refund: $82450.",
        excludes: ['12-3456789', '$82450']
      },
      {
        profile: 'HR',
        input: "EEID 12345. DOB: 11/12/1993.",
        excludes: ['12345', '11/12/1993']
      },
      {
        profile: 'Security',
        input: "Vulnerability CVE-2026-9901 on IP 172.16.254.1.",
        excludes: ['CVE-2026-9901', '172.16.254.1']
      },
      {
        profile: 'Marketing',
        input: "Lead: LEAD-90210. Campaign: CAMPAIGN-1234567890.",
        excludes: ['LEAD-90210', 'CAMPAIGN-1234567890']
      },
      {
        profile: 'Support',
        input: "Ticket TICKET-12345. Zendesk: ZENDESK-9021.",
        excludes: ['TICKET-12345', 'ZENDESK-9021']
      },
      {
        profile: 'RealEstate',
        input: "MLS 902100. GATE CODE 1234.",
        excludes: ['902100', '1234']
      },
      {
        profile: 'Agents',
        input: "Vector VECTOR-90210210.",
        excludes: ['VECTOR-90210210']
      },
      {
        profile: 'Academic',
        input: "Student STUDENT-89120. Policy: FERPA-90210.",
        excludes: ['STUDENT-89120', 'FERPA-90210']
      },
      {
        profile: 'Creative',
        input: "This draft DRAFT-8912 is EMBARGOED.",
        excludes: ['DRAFT-8912', 'EMBARGOED']
      },
      {
        profile: 'Tech',
        input: "Instance INSTANCE-ID-a092f1b0a92. Config: KUBECONFIG-PROD12.",
        excludes: ['INSTANCE-ID-a092f1b0a92', 'KUBECONFIG-PROD12']
      },
      {
        profile: 'Personal',
        input: "PASSWORD: greenmonster. MOM: +1-312-555-0182.",
        excludes: ['greenmonster', '+1-312-555-0182']
      }
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
    console.log("✅ DLP quality verification across all 23 profiles completed successfully.");

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

    // ── pii-masking-run CLI regression tests ──────────────────────────────
    console.log("\n---> Running pii-masking-run CLI regression tests...");
    const cliScript = path.resolve(__dirname, 'pii-masking-run.js');

    async function runCli(args, stdinData = null) {
      return new Promise((resolve, reject) => {
        const proc = spawn('node', [cliScript, ...args], { env: { ...process.env } });
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

    console.log("\n🎉 All deep integration, hardening, and CLI tests passed successfully!");
    // ─────────────────────────────────────────────────────────────────────
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
