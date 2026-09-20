#!/usr/bin/env node

/**
 * PrivacyScrubber & ZTDS Automated IP Leak Barrier (Pre-Commit / Pre-Push Guard)
 * 
 * Physically prevents un-obfuscated commercial rules, proprietary taxonomies, 
 * or sensitive license salts from being committed or pushed to any repository.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🛡️ [IP Guard] Scanning repository for Intellectual Property leaks...');

const FORBIDDEN_SIGNATURES = [
    // Triggers on raw PROFILE_RULES assignment with cleartext rule objects (type+regex readable).
    // Obfuscated files show PROFILE_RULES={'general':[],'legal':[{'type':_0x...}]} — keys visible but regex values hidden.
    // We allow the obfuscated form: value objects must contain _0x vars. Flag only cleartext { type: 'NAME', regex: ... }.
    { pattern: /PROFILE_RULES\s*=\s*\{[^}]{0,200}type\s*:\s*'[A-Z]/, name: 'Raw Commercial Profile Taxonomies (PROFILE_RULES with cleartext type)' },
    { pattern: /"ZTDS_SALT_2026_!@#"/, name: 'Plaintext License Validation Salt' },
    { pattern: /'ZTDS_SALT_2026_!@#'/, name: 'Plaintext License Validation Salt' },
    { pattern: /isContextName:\s*true/, name: 'Raw Contextual Lookaround Rule Definitions' }
];

// Whitelisted files where definitions are legitimately maintained
const WHITELIST = [
    'src/core/pii-engine-core.js',
    'scripts/sync-pii-engine.js',
    'scripts/ip-guard.cjs',
    'scripts/ps-license-manager.js',
    'api/paddle-webhook.js',
    'api/upgrade-key.js',
    'api/send-welcome-email.js',
    'api/request-pilot.js',
    'tests/unit-micro.js',
    'tests/run-e2e-audit.js',
    'tests/test-license-settings.js',
    '.agents/AGENTS.md',
    '.agent/learnings.md'
];

function isWhitelisted(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return WHITELIST.some(allowed => normalized.endsWith(allowed));
}

let violations = [];

try {
    // Get staged files from git
    const stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf8' })
        .split('\n')
        .map(f => f.trim())
        .filter(Boolean);

    // If nothing staged, check modified files
    const targetFiles = stagedFiles.length > 0 
        ? stagedFiles 
        : execSync('git diff --name-only', { encoding: 'utf8' })
            .split('\n')
            .map(f => f.trim())
            .filter(Boolean);

    for (const relPath of targetFiles) {
        if (!fs.existsSync(relPath)) continue;
        if (isWhitelisted(relPath)) continue;
        if (relPath.endsWith('.png') || relPath.endsWith('.jpg') || relPath.endsWith('.webp') || relPath.endsWith('.mp4') || relPath.endsWith('.pdf')) continue;

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
    console.error('❌ [IP Guard] Failed to inspect git status:', err.message);
    process.exit(1);
}

if (violations.length > 0) {
    console.error('\n🚨 =========================================================');
    console.error('🚨 CRITICAL ERROR: INTELLECTUAL PROPERTY LEAK DETECTED!');
    console.error('🚨 The following files contain un-obfuscated proprietary code:');
    violations.forEach(v => {
        console.error(`   ❌ ${v.file} -> Found: ${v.signature}`);
    });
    console.error('\n🚨 COMMIT / PUSH BLOCKED PHYSICALLY BY IP-GUARD.');
    console.error('🚨 You must run the build pipeline (e.g. build-mcp.js or build-sdk.js)');
    console.error('🚨 to obfuscate these files before committing.');
    console.error('🚨 =========================================================\n');
    process.exit(1);
}

console.log('✅ [IP Guard] 0 leaks detected. Intellectual Property is protected.\n');
process.exit(0);
