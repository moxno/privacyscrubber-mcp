import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexScript = path.resolve(__dirname, 'index.js');

// Helper to send JSON-RPC and wait for response
async function runMcpSession() {
  console.log("Starting MCP Server process...");
  
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

    if (tools.length !== 3) {
      throw new Error(`Expected 3 tools, got ${tools.length}`);
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

    console.log("\n--> Spawning second MCP process WITH SPOOF SIMULATION (invalid key)...");
    
    // Spawn with empty key (invalid/free)
    const mcpProcess2 = spawn('node', [indexScript], {
      env: {
        ...process.env,
        PRIVACYSCRUBBER_KEY: "" // empty key
      }
    });

    let buffer2 = '';
    const pendingRequests2 = new Map();
    let nextId2 = 1;

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
    
    // We expect 2 text segments: the warning message and the sanitized text (General fallback)
    const warningText = content?.[0]?.text || "";
    const scrubbedText = content?.[1]?.text || content?.[0]?.text || "";
    
    console.log("<-- Warning text:", warningText.trim().substring(0, 100) + "...");
    console.log("<-- Scrubbed output text:", scrubbedText.trim());

    if (!warningText.includes("Advanced profile 'creative' is locked")) {
      throw new Error("Outer layer bypass check failed: did not output key lock warning.");
    }
    
    if (!scrubbedText.includes("EMBARGOED")) {
      throw new Error("Core hardening failed: EMBARGOED was sanitized using creative rules on an invalid key!");
    }
    
    console.log("✅ Core hardening verified: advanced rules successfully blocked on invalid key.");
    mcpProcess2.kill();

    console.log("\n🎉 All deep integration and hardening tests passed successfully!");
    mcpProcess.kill();
    process.exit(0);

  } catch (error) {
    console.error("❌ Test failed:", error.message);
    mcpProcess.kill();
    process.exit(1);
  }
}

runMcpSession();
