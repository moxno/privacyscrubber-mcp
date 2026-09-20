#!/usr/bin/env node

/**
 * Public Repository IP Leak Barrier (Pre-Commit / Pre-Push Guard)
 * 
 * Specifically configured for public repos like privacyscrubber-mcp.
 * Zero un-obfuscated commercial rules or license salts are permitted to enter this repo.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🛡️ [Public IP Guard] Scanning staged files for Intellectual Property leaks...');

const FORBIDDEN_SIGNATURES = [
    { pattern: /PROFILE_RULES\s*=\s*\{/, name: 'Raw Commercial Profile Taxonomies (PROFILE_RULES)' },
    { pattern: /"ZTDS_SALT_2026_!@#"/, name: 'Plaintext License Validation Salt' },
    { pattern: /'ZTDS_SALT_2026_!@#'/, name: 'Plaintext License Validation Salt' },
    { pattern: /isContextName:\s*true/, name: 'Raw Contextual Lookaround Rule Definitions' },
    { pattern: /sum\s*%\s*9999/, name: 'Plaintext License Checksum Formula' }
];

const WHITELIST = [
    'scripts/ip-guard.cjs',
    'README.md',
    'SECURITY_MODEL.md',
    'SECURITY.md',
    'LICENSE.md'
];

function isWhitelisted(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return WHITELIST.some(allowed => normalized.endsWith(allowed));
}

let violations = [];

try {
    const stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf8' })
        .split('\n')
        .map(f => f.trim())
        .filter(Boolean);

    const targetFiles = stagedFiles.length > 0 
        ? stagedFiles 
        : execSync('git diff --name-only', { encoding: 'utf8' })
            .split('\n')
            .map(f => f.trim())
            .filter(Boolean);

    for (const relPath of targetFiles) {
        if (!fs.existsSync(relPath)) continue;
        if (isWhitelisted(relPath)) continue;
        if (relPath.endsWith('.png') || relPath.endsWith('.jpg') || relPath.endsWith('.webp') || relPath.endsWith('.mp4') || relPath.endsWith('.pdf') || relPath.endsWith('.mcpb')) continue;

        const content = fs.readFileSync(relPath, 'utf8');

        for (const sig of FORBIDDEN_SIGNATURES) {
            if (sig.pattern.test(content)) {
                violations.push({
                    file: relPath,
                    signature: sig.name
                });
            }
        }
    }
} catch (err) {
    console.error('❌ [Public IP Guard] Failed to inspect git status:', err.message);
    process.exit(1);
}

if (violations.length > 0) {
    console.error('\n🚨 =========================================================');
    console.error('🚨 CRITICAL ERROR: INTELLECTUAL PROPERTY LEAK DETECTED IN PUBLIC REPO!');
    console.error('🚨 The following files contain un-obfuscated proprietary code:');
    violations.forEach(v => {
        console.error(`   ❌ ${v.file} -> Found: ${v.signature}`);
    });
    console.error('\n🚨 COMMIT / PUSH BLOCKED PHYSICALLY BY PUBLIC IP-GUARD.');
    console.error('🚨 You must run "node scripts/build-mcp.js" in the main repo');
    console.error('🚨 to build and obfuscate files before syncing to this public repository.');
    console.error('🚨 =========================================================\n');
    process.exit(1);
}

console.log('✅ [Public IP Guard] 0 leaks detected. Public repository is safe.\n');
process.exit(0);
