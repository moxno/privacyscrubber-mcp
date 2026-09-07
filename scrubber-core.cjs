/**
 * PrivacyScrubber Core Engine — Shared Module
 * Pure JavaScript, zero DOM dependencies.
 * Used by both the Chrome Extension and (via extraction) the main website.
 *
 * Zero-server rule: No fetch(), no XMLHttpRequest, no external calls.
 * Airplane Mode Verified: works with no network after load.
 */

// ─── Regex Rules ─────────────────────────────────────────────────────────────
(function() {
    if (typeof window !== 'undefined' && window.PrivacyScrubberCore && window.PrivacyScrubberCore.isInitialized) return;

    function getEngine() {
        if (typeof window !== 'undefined' && window.PrivacyScrubberEngine) return window.PrivacyScrubberEngine;
        if (typeof global !== 'undefined' && global.PrivacyScrubberEngine) return global.PrivacyScrubberEngine;
        if (typeof require === 'function') {
            try { return require('./ps-pii-engine.cjs'); } catch(e) {}
            try { return require('./ps-pii-engine.js'); } catch(e) {}
            try { return require('../chrome-extension/ps-pii-engine.js'); } catch(e) {}
        }
        return null;
    }

    /**
     * Runtime Initialization for dynamic rule synchronization.
     * @param {Object} config - { regexes, profiles, names }
     */
    function init(config) {
        if (!config) return;
        const engine = getEngine();
        if (engine) engine.init(config);
        if (typeof window !== 'undefined' && window.PrivacyScrubberCore) {
            window.PrivacyScrubberCore.isInitialized = true;
        }
    }

function stitchOrphanedNameLines(text, profile) {
    if (!text || !text.includes('\n')) return text;
    const prof = (profile || 'general').toLowerCase();
    if (prof === 'medical') {
        text = text.replace(/Patient Name:\s*\n+([A-Z][a-zA-Z]+\s[A-Z][a-zA-Z]+)/g, 'Patient Name: $1');
    } else if (prof === 'legal') {
        text = text.replace(/Defendant:\s*\n+([A-Z][a-zA-Z]+\s[A-Z][a-zA-Z]+)/g, 'Defendant: $1');
    }
    return text;
}

/**
 * Protect PII from plain text.
 *
 * @param {string} text - Raw input text
 * @param {Array<{label: string, pattern: string}>} [customRules=[]] - Optional PRO regex rules or exact text
 * @returns {{ scrubbedText: string, tokenMap: Object, count: number }}
 *   scrubbedText: text with PII replaced by tokens like [NAME_1]
 *   tokenMap: { "[NAME_1]": "John Doe", ... } — for data reveal
 *   count: total number of items protected
 *   uniqueUnmasked: Set of unmasked values
 */
function scrubText(text, customRules = [], tokenLabelMap = {}, profile = 'General', existingSessionMap = {}, isPro = false, ignoreList = null) {
    if (!text) return { scrubbedText: "", tokenMap: {}, count: 0, uniqueUnmasked: new Set(), trialMeta: null, executionMs: 0 };
    
    const executionStartMs = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
    // Stitch PDF-split name fragments across line breaks (all profiles)
    text = stitchOrphanedNameLines(text, profile);
    
    // Protect system prompt from being scrubbed or counted
    let extractedSystemPrompt = "";
    let textToProcess = text.replace(/[\u200b\u200c\u200d\ufeff]/g, '');

    const isSpecialized = profile && profile.toLowerCase() !== 'general';
    
    // SDK / Core Engine Limits Enforcer (Free Tier)
    if (!isPro) {
        const charLimit = isSpecialized ? 5000 : 15000;
        if (textToProcess.length > charLimit) {
            throw new Error(`PrivacyScrubber Free Tier limit exceeded (${charLimit.toLocaleString()} chars). Please upgrade to PRO or TEAMS.`);
        }
    }
    
    let trialMeta = null;
    
    // Split attached table labels/headers (e.g. Sarah MitchellEmail: -> Sarah Mitchell Email:)
    // Specifically matches a letter followed directly by field names and a colon
    textToProcess = textToProcess.replace(/([a-z])(Email|Phone|Mobile|Tel|Address|IP|ID|URL|SSN|Date):/g, '$1 $2:');
    
    const sysMarker = "[Privacy Scrubber Mode]";
    const oldMarker = "[SYSTEM INSTRUCTION: DATA PRIVACY MODE]";
    const ctxMarker = "[Context: identifiers";
    const newMarker = "[Privacy Note:";
    if (textToProcess.includes(sysMarker) || textToProcess.includes(oldMarker) || textToProcess.includes(ctxMarker) || textToProcess.includes(newMarker)) {
        const sysPromptRegex = /(?:\n*----------------------\s*|\n*---\s*)?(?:\[SYSTEM INSTRUCTION: DATA PRIVACY MODE\]|\[Privacy Scrubber Mode\]|\[Context: identifiers|\[Privacy Note:)[\s\S]*/;
        const match = textToProcess.match(sysPromptRegex);
        if (match) {
            extractedSystemPrompt = match[0].trim();
            textToProcess = textToProcess.replace(sysPromptRegex, '').trimEnd();
        }
    }
    const sessionMap = {};
    const counters = { NAME: 0, EMAIL: 0, PHONE: 0, ID: 0, FINANCIAL: 0, SECRET: 0, ADDRESS: 0, CUSTOM: 0, SSN: 0, DATE: 0, PHI: 0 };
    const customCounters = {};
    const plaintextToTokenAtlas = {};

    // Seed counters and atlas from existing session map to prevent overwrites
    if (existingSessionMap && typeof existingSessionMap === 'object') {
        Object.entries(existingSessionMap).forEach(([token, value]) => {
            const match = token.match(/^\[([A-Z_a-z0-9]+)_(\d+)\]$/);
            if (match) {
                const type = match[1];
                const idx = parseInt(match[2], 10);
                if (counters[type] !== undefined) {
                    counters[type] = Math.max(counters[type], idx);
                } else {
                    customCounters[type] = Math.max(customCounters[type] || 0, idx);
                }
            }
            plaintextToTokenAtlas[value.toLowerCase()] = token;
            plaintextToTokenAtlas[value] = token;
        });
    }

    
    // Default labels
    const labels = {
        NAME: 'NAME', EMAIL: 'EMAIL', PHONE: 'PHONE', ID: 'ID',
        FINANCIAL: 'FINANCIAL', SECRET: 'SECRET', ADDRESS: 'ADDRESS', CUSTOM: 'CUSTOM',
        SSN: 'SSN', DATE: 'DATE', PHI: 'PHI',
        ...tokenLabelMap
    };


    const PROFILE_ALIAS_MAP = (getEngine() && getEngine().PROFILE_ALIAS_MAP) ? getEngine().PROFILE_ALIAS_MAP : {};
    
    // Node.js local license key validation enforcement (ZTDS Compliance)
    if (!isPro && typeof process !== 'undefined' && process.env && typeof require === 'function' && profile && profile.toLowerCase() !== 'general') {
        try {
            const key = (process.env.PRIVACYSCRUBBER_KEY || "").trim();
            let isKeyPro = false;
            if (key) {
                const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw3f37srO402PU4++Baf8\nFG8LY4l/IA3NKLlBnYmNHRTjfI/O/w5PDZn1xPcUQevojA1J+A5moKcjXsJ5b21X\nhJoYSkE4vLpcVYOt1FhRwEHs1APDSyss0HixboLz2eW2XQf2NbwajWtNlyxvgczO\nKE6ClnLomtsaKywwqB4alzdYnnnFJttFPjwmgPSO7D9AgN9sYaVkXOaOFrIZ90Ng\nTRhSHUeL7ReltWlCHwz9xf5m2FrKtxr2VBlEoyPjsFzalHMey1EX+yXe81zM7IIi\nt1Z8agLzo7WIfNBAIWmRlerTplaFFZrQgdF5g/Y0n8IIMZOtadgoY8E855psDNZV\n7wIDAQAB\n-----END PUBLIC KEY-----`;
                const crypto = require('crypto');
                const [payloadBase64, signatureBase64] = key.split('.');
                if (payloadBase64 && signatureBase64) {
                    const verifier = crypto.createVerify('SHA256');
                    verifier.update(payloadBase64);
                    const isVerified = verifier.verify(PUBLIC_KEY, signatureBase64, 'base64');
                    if (isVerified) {
                        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
                        if (!payload.expires || payload.expires > Math.floor(Date.now() / 1000)) {
                            isKeyPro = true;
                            isPro = true;
                        }
                    }
                }
            }
            if (!isKeyPro && !isPro) {
                profile = 'General';
            }
        } catch (e) {
            if (!isPro) profile = 'General';
        }
    }

    const engine = getEngine();
    if (!engine) {
        return { scrubbedText: textToProcess, count: 0, tokenMap: {}, piiBreakdown: {}, uniqueUnmasked: new Set(), trialMeta: null, executionMs: 0 };
    }
    const detectResult = engine.detectMatches(textToProcess, profile, customRules, [], null);
    let filtered = detectResult.filteredMatches;
    textToProcess = detectResult.processedText;

    // Filter out items in ignoreList (False Positives restored by user)
    if (ignoreList && (ignoreList instanceof Set || Array.isArray(ignoreList))) {
        const ignoreSet = ignoreList instanceof Set ? ignoreList : new Set(ignoreList);
        filtered = filtered.filter(m => {
            if (!m || !m.value) return false;
            const val = m.value;
            const valLower = val.toLowerCase();
            const valTrim = val.trim();
            const valTrimLower = valTrim.toLowerCase();
            return !ignoreSet.has(val) && 
                   !ignoreSet.has(valLower) && 
                   !ignoreSet.has(valTrim) && 
                   !ignoreSet.has(valTrimLower);
        });
    }

    // Assign tokens in left-to-right order
    
    const uniqueUnmasked = new Set();

    filtered.forEach(m => {
        // Deduplication Check: Reuse tokens for identical values (case-insensitive for core types)
        const matchKey = m.type === 'CUSTOM' || m.type === 'ID' || m.type === 'SECRET' ? m.value : m.value.toLowerCase();
        
        uniqueUnmasked.add(matchKey);

        if (plaintextToTokenAtlas[matchKey]) {
            m.token = plaintextToTokenAtlas[matchKey];
            return;
        }

        // Generate unique token using custom labels if provided
        const label = m.customLabel || labels[m.type] || m.type;
        const isBuiltIn = counters[m.type] !== undefined;

        if (isBuiltIn && !m.customLabel) {
            // Built-in type (NAME, EMAIL, PHONE, etc.) — use seeded counters[] for collision prevention
            counters[m.type]++;
            m.token = `[${label}_${counters[m.type]}]`;
        } else {
            // Custom label (PRO rule) — use customCounters[]
            customCounters[label] = (customCounters[label] || 0) + 1;
            m.token = `[${label}_${customCounters[label]}]`;
        }
        
        plaintextToTokenAtlas[matchKey] = m.token;
        sessionMap[m.token] = m.value;
    });

    // Replace from start → end using string builder (preserves O(N) linear performance on large payloads)
    const leftToRight = [...filtered].sort((a, b) => a.start - b.start);
    let lastIdx = 0;
    const pieces = [];
    for (let i = 0; i < leftToRight.length; i++) {
        const m = leftToRight[i];
        if (m.start > lastIdx) {
            pieces.push(textToProcess.substring(lastIdx, m.start));
        }
        pieces.push(m.token);
        lastIdx = m.end;
    }
    if (lastIdx < textToProcess.length) {
        pieces.push(textToProcess.substring(lastIdx));
    }
    const result = pieces.join('');

    const piiBreakdown = {};
    Object.keys(sessionMap).forEach(k => {
        let t = k.split('_')[0].replace('[', '');
        piiBreakdown[t] = (piiBreakdown[t] || 0) + 1;
    });

    let finalScrubbed = result;
    if (extractedSystemPrompt) {
        if (extractedSystemPrompt.startsWith('----------------------')) {
            finalScrubbed = result + '\n\n' + extractedSystemPrompt;
        } else {
            finalScrubbed = result + '\n\n----------------------\n' + extractedSystemPrompt;
        }
    }

    const executionEndMs = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();

    return {
        scrubbedText: finalScrubbed,
        tokenMap: sessionMap,
        count: Object.keys(sessionMap).length,
        uniqueUnmasked: uniqueUnmasked,
        piiBreakdown: piiBreakdown,
        trialMeta: trialMeta,
        executionMs: Math.max(0, executionEndMs - executionStartMs)
    };
}

const LABEL_ALIASES = {
    NAME: ['NAME', 'NAMES', 'USERNAME', 'USER_NAME', 'CLIENTNAME', 'CLIENT_NAME', 'CANDIDATE_NAME', 'FULL_NAME', 'FIRSTNAME', 'FIRST_NAME', 'LASTNAME', 'LAST_NAME', 'SURNAME', 'ИМЯ', 'ИМЕНА', 'ПОЛЬЗОВАТЕЛЬ', 'ФИО', 'КЛИЕНТ', 'NOMBRE', 'NOMBRES', 'USUARIO', 'CLIENTE', 'NOM', 'NOMS', 'UTILISATEUR', 'NAME', 'NAMEN', 'BENUTZER', 'KUNDE', 'NOME', 'COGNOME', 'UTENTE', 'NAAM', 'GEBRUIKER', 'KLANT'],
    EMAIL: ['EMAIL', 'EMAILS', 'EMAILADDR', 'EMAIL_ADDR', 'EMAILADDRESS', 'EMAIL_ADDRESS', 'EMAIL_ADR', 'MAIL', 'MAILS', 'ПОЧТА', 'ЭЛ_ПОЧТА', 'АДРЕС_ПОЧТЫ', 'МЕЙЛ', 'МАЙЛ', 'CORREO', 'COURRIEL', 'CORREO_ELECTRONICO', 'MEL'],
    PHONE: ['PHONE', 'PHONES', 'PHONENUM', 'PHONE_NUM', 'PHONENUMBER', 'PHONE_NUMBER', 'TEL', 'TELS', 'TELEPHONE', 'TELEPHONES', 'MOBILE', 'CELL', 'ТЕЛЕФОН', 'ТЕЛЕФОНЫ', 'НОМЕР_ТЕЛЕФОНА', 'НОМЕР', 'MOVIL', 'PORTABLE', 'HANDY', 'TELEFONI', 'CELLULARE'],
    ID: ['ID', 'IDS', 'IDNUM', 'ID_NUM', 'IDNUMBER', 'ID_NUMBER', 'IDENTIFIER', 'IDENTIFIERS', 'PASSPORT', 'SSN', 'EIN', 'TAXID', 'TAX_ID', 'LICENSE', 'LICENSE_PLATE', 'ИД', 'ИДЕНТИФИКАТОР', 'ПАСПОРТ', 'СНИЛС', 'ИНН', 'IDENTIFICADOR', 'PASAPORTE', 'IDENTIFIANT', 'PASSEPORT', 'IDENTIFIKATOR', 'PASS', 'IDENTIFICATORE', 'PASSAPORTO'],
    FINANCIAL: ['FINANCIAL', 'FINANCIALS', 'MONEY', 'AMOUNT', 'PRICE', 'COST', 'CARD', 'CREDITCARD', 'DEBITCARD', 'ACCOUNT', 'IBAN', 'BIC', 'ДЕНЬГИ', 'СУММА', 'КАРТА', 'СЧЕТ', 'БАНК', 'DINERO', 'CANTIDAD', 'TARJETA', 'CUENTA', 'ARGENT', 'MONTANT', 'COMPTE', 'GELD', 'BETRAG', 'KONTO'],
    ADDRESS: ['ADDRESS', 'ADDRESSES', 'STREET', 'STREET_ADDRESS', 'CITY', 'STATE', 'ZIP', 'ZIPCODE', 'ZIP_CODE', 'COUNTRY', 'LOCATION', 'АДРЕС', 'АДРЕСА', 'УЛИЦА', 'ГОРОД', 'СТРАНА', 'DIRECCION', 'DIRECCIONES', 'CALLE', 'CIUDAD', 'PAIS', 'ADRESSE', 'ADRESSES', 'RUE', 'VILLE', 'STRASSE', 'STADT', 'LAND'],
    DATE: ['DATE', 'DATES', 'BIRTHDAY', 'DOB', 'ДАТА', 'ДАТЫ', 'ДЕНЬ_РОЖДЕНИЯ', 'FECHA', 'FECHAS', 'CUMPLEANOS', 'ANNIVERSAIRE', 'DATUM', 'DATEN', 'GEBURTSTAG'],
    PHI: ['PHI', 'MRN', 'NHS', 'HEALTH', 'MEDICAL', 'PATIENT', 'МЕД', 'ПАЦИЕНТ', 'PACIENTE'],
    SECRET: ['SECRET', 'SECRETS', 'KEY', 'KEYS', 'TOKEN', 'TOKENS', 'PASSWORD', 'PASSWORDS', 'AUTH', 'APIKEY', 'API_KEY', 'КЛЮЧ', 'КЛЮЧИ', 'ПАРОЛЬ', 'ПАРОЛИ', 'ТОКЕН', 'CLAVE', 'CONTRASENA', 'CLE', 'MOT_DE_PASSE', 'SCHLUESSEL', 'PASSWORT'],
    CUSTOM: ['CUSTOM', 'CUSTOMS', 'RULE', 'RULES', 'КАСТОМ', 'ПРАВИЛО']
};

function getLabelAliases(label) {
    const upper = label.toUpperCase();
    if (LABEL_ALIASES[upper]) {
        return LABEL_ALIASES[upper];
    }
    const aliases = new Set([label, upper, label.toLowerCase()]);
    aliases.add(label.replace(/_/g, ' '));
    aliases.add(label.replace(/_/g, '-'));
    aliases.add(label.replace(/ /g, '_'));
    aliases.add(label.replace(/-/g, '_'));
    return Array.from(aliases);
}

function formatToken(label, index, format = 'brackets') {
    const cleanLabel = String(label || 'PII').replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
    switch(format) {
        case 'xml': return `<${cleanLabel}_${index}>`;
        case 'mustache': return `{{${cleanLabel}_${index}}}`;
        case 'underscores': return `__${cleanLabel}_${index}__`;
        case 'brackets':
        default: return `[${cleanLabel}_${index}]`;
    }
}

function buildRestorationRegexAndRules(tokenMap) {
    const keys = Object.keys(tokenMap || {});
    if (keys.length === 0) {
        return { compositeRegex: null, looseRules: [] };
    }

    const sortedKeys = [...keys].sort((a, b) => {
        const innerA = a.replace(/^\[|<|\{\{|__|\]|>|\}\}|__/g, '');
        const innerB = b.replace(/^\[|<|\{\{|__|\]|>|\}\}|__/g, '');
        const matchA = innerA.match(/^([A-Za-z_0-9]+?)[-_]?(\d+)$/);
        const matchB = innerB.match(/^([A-Za-z_0-9]+?)[-_]?(\d+)$/);
        
        if (matchA && matchB) {
            const idxA = parseInt(matchA[2], 10);
            const idxB = parseInt(matchB[2], 10);
            const labelA = matchA[1];
            const labelB = matchB[1];
            
            if (idxA !== idxB) {
                return idxB - idxA;
            }
            if (labelA.length !== labelB.length) {
                return labelB.length - labelA.length;
            }
        }
        return b.length - a.length;
    });

    const looseRules = [];
    const regexParts = [];

    sortedKeys.forEach(k => {
        const inner = k.replace(/^\[|<|\{\{|__|\]|>|\}\}|__/g, '');
        const match = inner.match(/^([A-Za-z_0-9]+?)[-_]?(\d+)$/);
        if (match) {
            const label = match[1];
            const baseIndex = parseInt(match[2], 10);
            const aliases = getLabelAliases(label);
            
            const escapedAliases = aliases.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            const aliasesGroup = `(?:${escapedAliases.join('|')})`;
            
            const looseRegex = '(?:\\[?\\s*' + aliasesGroup + '[-_\\s]*0*' + baseIndex + '\\s*\\]?|<\\s*' + aliasesGroup + '[-_\\s]*0*' + baseIndex + '\\s*>|\\{\\{\\s*' + aliasesGroup + '[-_\\s]*0*' + baseIndex + '\\s*\\}\\}|__\\s*' + aliasesGroup + '[-_\\s]*0*' + baseIndex + '\\s*__)(?:\'s|’s|s|[а-яёА-ЯЁ]{1,3})?';
            looseRules.push({ patternStr: looseRegex, regex: new RegExp('^' + looseRegex + '$', 'i'), originalKey: k });
            regexParts.push(looseRegex);
        } else {
            const safe = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            looseRules.push({ patternStr: safe, regex: new RegExp('^' + safe + '$', 'i'), originalKey: k });
            regexParts.push(safe);
        }
    });

    const compositeRegex = new RegExp('(?<=^|[^a-zA-Z0-9_А-Яа-яЁё])(' + regexParts.join('|') + ')(?=$|[^a-zA-Z0-9_А-Яа-яЁё])', 'gi');

    return { compositeRegex, looseRules };
}

/**
 * Clean AI prompt prefix (e.g., "Claude responded:", "ChatGPT:") from the text.
 * 
 * @param {string} text
 * @returns {string}
 */
function isJsonPayload(str) {
    if (!str || typeof str !== "string") return false;
    const trimmed = str.trim();
    if (!((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")))) {
        return false;
    }
    try {
        JSON.parse(trimmed);
        return true;
    } catch (_) {
        return false;
    }
}

function cleanAIPromptPrefix(text) {
    if (!text) return "";
    let cleaned = text;
    // If text is a full valid JSON object or array, preserve structure
    if (!isJsonPayload(cleaned)) {
        // 1. Strip raw CSS / style blocks leaked from ChatGPT Canvas, web components or stylesheets
        cleaned = cleaned.replace(/^\s*(?:[.#][a-zA-Z0-9_-]+|\[[a-zA-Z0-9_#.:\-*>=,'"\s]+\]|:is\([^)]+\)|[a-zA-Z0-9_-]+)?\s*\{[^}]*?(?:\}\s*|\n\n+|$)/gi, "");
        cleaned = cleaned.replace(/^[;{} \t\r\n]+/, "");
        cleaned = cleaned.replace(/(?:^|\n)[a-zA-Z0-9_#.:\-*>[\]=\s,'"]+\{[^}]*(--[a-zA-Z0-9_-]+:|color-mix\(|var\()[^}]*\}/g, "");
    }
    // 2. Strip AI author prefixes and platform artifacts
    cleaned = cleaned.replace(/^\s*(?:Claude responded|Claude|ChatGPT|Gemini|Grok|DeepSeek|Kimi|Copilot|Assistant|User)\s*(?::|\bsaid\b|\bresponded\b|(?:\s*\n))\s*/i, "");
    cleaned = cleaned.replace(/^(?:Here (?:is|are) (?:the )?(?:redacted|scrubbed|sanitized|processed|clean|updated|modified) (?:text|output|version|data).*?[:\n]+|\*\*Scrubbed Text\*\*[:\n]+|### Scrubbed Text[:\n]+)/i, '');
    cleaned = cleaned.replace(/^\s*Edit\s*\n+/i, "");
    cleaned = cleaned.replace(/\s*\bEdit\s+in\s+a\s+page\b\s*$/i, "");
    // 3. Strip stray leading colons, semicolons, or separators left by stripped icons/artifact headers
    cleaned = cleaned.replace(/^[:;|\-\—\–]+(?=\n|$)/, "");
    cleaned = cleaned.replace(/^[:;]+\s*/, "");
    return cleaned.trim();
}

function buildFastTokenLookup(tokenMap) {
    const lookup = new Map();
    const customRegexParts = [];
    const keys = Object.keys(tokenMap || {});
    
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = tokenMap[k];
        lookup.set(k, v);
        lookup.set(k.toUpperCase(), v);
        
        const inner = k.replace(/^\[|<|\{\{|__|\]|>|\}\}|__/g, '');
        const match = inner.match(/^([A-Za-z_0-9]+?)[-_]?(\d+)$/);
        if (match) {
            const label = match[1];
            const baseIndex = parseInt(match[2], 10);
            const aliases = getLabelAliases(label);
            for (let a = 0; a < aliases.length; a++) {
                const u = aliases[a].toUpperCase();
                lookup.set(u + '_' + baseIndex, v);
                lookup.set(u + '-' + baseIndex, v);
                lookup.set(u + ' ' + baseIndex, v);
                lookup.set(u + baseIndex, v);
                lookup.set('[' + u + '_' + baseIndex + ']', v);
                lookup.set('<' + u + '_' + baseIndex + '>', v);
                lookup.set('{{' + u + '_' + baseIndex + '}}', v);
                lookup.set('__' + u + '_' + baseIndex + '__', v);
                lookup.set('[' + u + ' ' + baseIndex + ']', v);
                lookup.set('[' + u + '-' + baseIndex + ']', v);
            }
        } else {
            customRegexParts.push(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
    }
    
    let regexStr = '(?:\\[\\s*[A-Za-z0-9_\\-А-Яа-яЁё ]+\\s*\\]|<\\s*[A-Za-z0-9_\\-А-Яа-яЁё ]+\\s*>|\\{\\{\\s*[A-Za-z0-9_\\-А-Яа-яЁё ]+\\s*\\}\\}|__\\s*[A-Za-z0-9_\\-А-Яа-яЁё ]+\\s*__|(?<=^|[^a-zA-Z0-9_А-Яа-яЁё])[A-Za-z_А-Яа-яЁё]+[-_\\s]*\\d+)';
    if (customRegexParts.length > 0) {
        regexStr = '(?:' + regexStr + '|' + customRegexParts.join('|') + ')';
    }
    const tokenRegex = new RegExp(regexStr + '(?:\'s|’s|s|[а-яёА-ЯЁ]{1,3})?', 'gi');
    
    return { lookup, tokenRegex };
}

/**
 * Reverse-protect: replace tokens in AI response with originals from tokenMap.
 *
 * @param {string} aiResponse - Text containing tokens like [NAME_1]
 * @param {Object} tokenMap - { "[NAME_1]": "John Doe", ... }
 * @returns {{ restoredText: string, restoredCount: number }}
 */
function unscrubText(aiResponse, tokenMap) {
    let text = cleanAIPromptPrefix(aiResponse);
    let restoredCount = 0;
    
    if (!tokenMap || Object.keys(tokenMap).length === 0) {
        return { restoredText: text, restoredCount: 0 };
    }

    const keyCount = Object.keys(tokenMap).length;
    if (keyCount > 50) {
        const { lookup, tokenRegex } = buildFastTokenLookup(tokenMap);
        text = text.replace(tokenRegex, (match) => {
            if (lookup.has(match)) {
                restoredCount++;
                return lookup.get(match);
            }
            const upper = match.toUpperCase();
            if (lookup.has(upper)) {
                restoredCount++;
                return lookup.get(upper);
            }
            const possMatch = match.match(/^([\s\S]+?)('s|’s|s|[а-яёА-ЯЁ]{1,3})$/);
            if (possMatch) {
                const base = possMatch[1];
                const suffix = possMatch[2];
                if (lookup.has(base)) {
                    restoredCount++;
                    return lookup.get(base) + suffix;
                }
                if (lookup.has(base.toUpperCase())) {
                    restoredCount++;
                    return lookup.get(base.toUpperCase()) + suffix;
                }
            }
            return match;
        });
        return { restoredText: text, restoredCount };
    }

    const { compositeRegex, looseRules } = buildRestorationRegexAndRules(tokenMap);
    if (compositeRegex) {
        text = text.replace(compositeRegex, (match) => {
            restoredCount++;
            if (tokenMap[match]) {
                return tokenMap[match];
            }
            let origKey = match;
            for (let i = 0; i < looseRules.length; i++) {
                const rule = looseRules[i];
                if (rule.regex && rule.regex.test(match)) {
                    origKey = rule.originalKey;
                    break;
                }
            }
            return tokenMap[origKey] || match;
        });
    }
    
    return { restoredText: text, restoredCount };
}

/**
 * Reverse-protect with HTML highlighting: replace tokens in AI response with originals wrapped in span.
 *
 * @param {string} aiResponse - Text containing tokens like [NAME_1]
 * @param {Object} tokenMap - { "[NAME_1]": "John Doe", ... }
 * @returns {{ restoredHTML: string, restoredCount: number }}
 */
function unscrubTextAsHTML(aiResponse, tokenMap) {
    let restoredCount = 0;

    const cleanResponse = cleanAIPromptPrefix(aiResponse);
    // ALWAYS escape HTML first — even with empty tokenMap — to prevent XSS from AI-generated content
    let text = cleanResponse.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c] || c));
    
    if (!tokenMap || Object.keys(tokenMap).length === 0) {
        return { restoredHTML: text, restoredCount: 0 };
    }

    const keyCount = Object.keys(tokenMap).length;
    if (keyCount > 50) {
        const { lookup, tokenRegex } = buildFastTokenLookup(tokenMap);
        text = text.replace(tokenRegex, (match) => {
            let rawVal = null;
            if (lookup.has(match)) {
                rawVal = lookup.get(match);
            } else if (lookup.has(match.toUpperCase())) {
                rawVal = lookup.get(match.toUpperCase());
            } else {
                const possMatch = match.match(/^([\s\S]+?)('s|’s|s|[а-яёА-ЯЁ]{1,3})$/);
                if (possMatch) {
                    const base = possMatch[1];
                    const suffix = possMatch[2];
                    if (lookup.has(base)) rawVal = lookup.get(base) + suffix;
                    else if (lookup.has(base.toUpperCase())) rawVal = lookup.get(base.toUpperCase()) + suffix;
                }
            }
            if (rawVal !== null) {
                restoredCount++;
                const safeVal = rawVal.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c] || c));
                return `<span class="ps-restored-data" title="✓ Restored locally in-browser RAM (Never sent to AI)" style="border-bottom: 2px dashed #10b981; color: #10b981; background-color: rgba(16, 185, 129, 0.15); border-radius: 4px; padding: 1px 5px; margin: 0 1px; cursor: help; font-weight: 600; text-shadow: 0 0 5px rgba(16, 185, 129, 0.3);">${safeVal}</span>`;
            }
            return match;
        });
        return { restoredHTML: text, restoredCount };
    }

    const { compositeRegex, looseRules } = buildRestorationRegexAndRules(tokenMap);
    if (compositeRegex) {
        text = text.replace(compositeRegex, (match) => {
            restoredCount++;
            let origKey = match;
            for (let i = 0; i < looseRules.length; i++) {
                const rule = looseRules[i];
                if (rule.regex && rule.regex.test(match)) {
                    origKey = rule.originalKey;
                    break;
                }
            }
            const rawVal = tokenMap[origKey] || match;
            const safeVal = rawVal.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c] || c));
            return `<span class="ps-restored-data" title="✓ Restored locally in-browser RAM (Never sent to AI)" style="border-bottom: 2px dashed #10b981; color: #10b981; background-color: rgba(16, 185, 129, 0.15); border-radius: 4px; padding: 1px 5px; margin: 0 1px; cursor: help; font-weight: 600; text-shadow: 0 0 5px rgba(16, 185, 129, 0.3);">${safeVal}</span>`;
        });
    }
    
    return { restoredHTML: text, restoredCount };
}

// Expose standalone hydrateRegex for unit testing
function hydrateRegex(rule) {
    if (rule && typeof rule.regex === 'string' && rule.regex.startsWith('/')) {
        try {
            const lastSlash = rule.regex.lastIndexOf('/');
            const pattern = rule.regex.substring(1, lastSlash);
            const flags = rule.regex.substring(lastSlash + 1);
            return { ...rule, regex: new RegExp(pattern, flags) };
        } catch (e) {
            console.error('PS: Failed to hydrate regex:', rule.regex, e);
            return rule;
        }
    }
    return rule;
}

    function showTeamsPassphraseModal(onSaveCallback) {
        const existing = document.getElementById('ps-teams-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'ps-teams-modal';
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
            background: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(10px)',
            zIndex: '2147483647', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
        });

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(59,130,246,0.3)',
            borderRadius: '16px', padding: '24px', width: '380px', maxWidth: '90%',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 20px rgba(59,130,246,0.1)',
            color: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '16px',
            animation: 'ps-slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
        });

        if (!document.getElementById('ps-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'ps-modal-styles';
            style.textContent = `
                @keyframes ps-slide-up { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
                .ps-modal-input { width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 12px; border-radius: 8px; font-size: 14px; outline: none; transition: all 0.2s; }
                .ps-modal-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.2); }
                .ps-modal-btn { flex: 1; padding: 10px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s; }
                .ps-modal-btn.primary { background: linear-gradient(135deg, #06b6d4, #3b82f6); color: white; box-shadow: 0 4px 12px rgba(59,130,246,0.3); }
                .ps-modal-btn.primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
                .ps-modal-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; filter: none; }
                .ps-modal-btn.secondary { background: rgba(255,255,255,0.05); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1); }
                .ps-modal-btn.secondary:hover { background: rgba(255,255,255,0.1); }
            `;
            document.head.appendChild(style);
        }

        const header = document.createElement('div');
        Object.assign(header.style, { display: 'flex', alignItems: 'center', gap: '12px' });
        
        const headerIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        headerIcon.setAttribute("width", "24"); headerIcon.setAttribute("height", "24"); headerIcon.setAttribute("viewBox", "0 0 24 24");
        headerIcon.setAttribute("fill", "none"); headerIcon.setAttribute("stroke", "#06b6d4"); headerIcon.setAttribute("stroke-width", "2");
        const hp1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        hp1.setAttribute("d", "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2");
        headerIcon.appendChild(hp1);
        const hc1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        hc1.setAttribute("cx", "9"); hc1.setAttribute("cy", "7"); hc1.setAttribute("r", "4");
        headerIcon.appendChild(hc1);
        
        const title = document.createElement('h3');
        title.textContent = 'TEAMS Passphrase';
        Object.assign(title.style, { margin: '0', fontSize: '18px', fontWeight: '600' });
        
        header.appendChild(headerIcon);
        header.appendChild(title);

        const desc = document.createElement('p');
        desc.textContent = 'Secure Session Sharing requires a shared key. Set your team\'s passphrase to encrypt the data locally before sharing.';
        Object.assign(desc.style, { margin: '0', fontSize: '13px', color: '#94a3b8', lineHeight: '1.5' });

        const inputContainer = document.createElement('div');
        const passInput = document.createElement('input');
        passInput.type = 'password';
        passInput.id = 'ps-teams-pass-input';
        passInput.className = 'ps-modal-input';
        passInput.placeholder = 'Configure Passphrase (min 8 chars)';
        
        const strengthBar = document.createElement('div');
        strengthBar.id = 'ps-teams-strength-bar';
        Object.assign(strengthBar.style, { height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.05)', marginTop: '8px', overflow: 'hidden' });
        const strengthFill = document.createElement('div');
        strengthFill.id = 'ps-teams-strength-fill';
        Object.assign(strengthFill.style, { height: '100%', width: '0%', transition: 'all 0.3s' });
        strengthBar.appendChild(strengthFill);

        const strengthLabel = document.createElement('div');
        strengthLabel.id = 'ps-teams-strength-label';
        Object.assign(strengthLabel.style, { fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '4px', textAlign: 'center' });
        strengthLabel.textContent = '\u00A0';

        const errorMsg = document.createElement('div');
        errorMsg.id = 'ps-teams-error';
        Object.assign(errorMsg.style, { color: '#ef4444', fontSize: '12px', marginTop: '4px', display: 'none', textAlign: 'center' });
        errorMsg.textContent = 'Passphrase is too weak. Mix characters & letters.';

        inputContainer.appendChild(passInput);
        inputContainer.appendChild(strengthBar);
        inputContainer.appendChild(strengthLabel);
        inputContainer.appendChild(errorMsg);

        const btnGroup = document.createElement('div');
        Object.assign(btnGroup.style, { display: 'flex', gap: '10px', marginTop: '4px' });
        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'ps-teams-cancel';
        cancelBtn.className = 'ps-modal-btn secondary';
        cancelBtn.textContent = 'Cancel';
        const saveBtn = document.createElement('button');
        saveBtn.id = 'ps-teams-save';
        saveBtn.className = 'ps-modal-btn primary';
        saveBtn.disabled = true;
        saveBtn.textContent = 'Save & Encrypt';
        btnGroup.appendChild(cancelBtn);
        btnGroup.appendChild(saveBtn);

        // SECURITY: Opt-in persistence removed to strictly enforce ZTDS (no local storage for plaintext keys).

        const footer = document.createElement('div');
        Object.assign(footer.style, { textAlign: 'center', marginTop: '4px' });
        const learnLink = document.createElement('a');
        learnLink.href = 'https://privacyscrubber.com/teams';
        learnLink.target = '_blank';
        Object.assign(learnLink.style, { color: '#60a5fa', fontSize: '12px', textDecoration: 'none' });
        learnLink.textContent = 'Learn about TEAMS Cryptography →';
        footer.appendChild(learnLink);

        modal.appendChild(header);
        modal.appendChild(desc);
        modal.appendChild(inputContainer);
        modal.appendChild(btnGroup);
        modal.appendChild(footer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        passInput.focus();

        passInput.addEventListener('input', () => {
            const p = passInput.value;
            let score = 0;
            if (p.length >= 8) score++;
            if (p.length >= 14) score++;
            if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
            if (/[0-9]/.test(p)) score++;
            if (/[^A-Za-z0-9]/.test(p)) score++;
            score = Math.min(score, 4);

            const levels = [
                { pct: '0%', color: 'transparent', text: '' },
                { pct: '20%', color: '#ef4444', text: 'Weak' },
                { pct: '40%', color: '#fbbf24', text: 'Fair' },
                { pct: '60%', color: '#facc15', text: 'Good' },
                { pct: '80%', color: '#4ade80', text: 'Strong' },
                { pct: '100%', color: '#10b981', text: 'Great' },
            ];

            const level = (p.length === 0) ? levels[0] : levels[score];
            strengthFill.style.width = level.pct;
            strengthFill.style.background = level.color;
            strengthLabel.textContent = level.text || '\u00A0';
            strengthLabel.style.color = level.color;

            if (score >= 2) {
                saveBtn.disabled = false;
                errorMsg.style.display = 'none';
            } else {
                saveBtn.disabled = true;
                if (p.length > 0) errorMsg.style.display = 'block';
                else errorMsg.style.display = 'none';
            }
        });

        const close = () => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 200);
        };

        cancelBtn.addEventListener('click', close);
        saveBtn.addEventListener('click', () => {
            if (!saveBtn.disabled) {
                const val = passInput.value.trim();
                close();
                if (onSaveCallback) onSaveCallback({
                    passphrase: val,
                    shouldClearSession: false,
                    shouldSaveLocal: false
                });
            }
        });
        passInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !saveBtn.disabled) {
                saveBtn.click();
            } else if (e.key === 'Escape') {
                close();
            }
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
    }
    function showInPageToast(text, variant = 'success') {
        const existing = document.getElementById('ps-ext-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'ps-ext-toast';
        toast.textContent = text;

        const colors = {
            success: { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', color: '#10b981' },
            info: { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.35)', color: '#60a5fa' },
            warning: { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)', color: '#fbbf24' },
            error: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', color: '#ef4444' },
        };
        const { bg, border, color } = colors[variant] || colors.info;

        Object.assign(toast.style, {
            position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647',
            background: bg, border: `1px solid ${border}`, color,
            padding: '9px 18px', borderRadius: '12px', fontSize: '13px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontWeight: '500', boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(8px)', transition: 'opacity 0.3s ease', opacity: '1',
            textAlign: 'center'
        });

        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 350);
        }, 2500);
    }

    /**
     * Natively walks DOM to replace Tokens with Original text natively inside SPAs.
     * Guaranteed safe for React/Angular since we only manipulate target TextNodes.
     */
    
    /**
     * Natively walks DOM to replace Original Text with Tokens natively inside SPAs.
     * Guaranteed safe for React/Angular input fields via MutationObserver syncs.
     */
    function scrubDataInDOM(rootElement, customRules, globalTokenLabels, activeProfile, existingSessionMap, detectOnly = false, isPro = false) {
        if (!rootElement) return null;

        // ── TEXTAREA / INPUT fast path ────────────────────────────────────────
        // Native <textarea> and <input> store their content in .value — it is
        // NOT a child text node, so createTreeWalker finds nothing and always
        // returns count=0.  Handle them directly here.
        if (rootElement.tagName === 'TEXTAREA' || rootElement.tagName === 'INPUT') {
            const text = rootElement.value || '';
            if (!text.trim()) return { count: 0, tokenMap: existingSessionMap || {} };
            const result = scrubText(text, customRules, globalTokenLabels, activeProfile, existingSessionMap || {}, isPro);
            if (result.uniqueUnmasked.size > 0 && !detectOnly) {
                rootElement.value = result.scrubbedText;
                rootElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            }
            return { count: result.uniqueUnmasked.size, tokenMap: { ...(existingSessionMap || {}), ...result.tokenMap } };
        }
        // ─────────────────────────────────────────────────────────────────────

        // ── DETECT ONLY fast path ─────────────────────────────────────────────
        // If we only need to update the badge counter (no DOM mutation), evaluate
        // the full text string at once. This bypasses text node splitting issues
        // in ProseMirror/contenteditable and guarantees a 100% accurate count.
        if (detectOnly) {
            const fullText = rootElement.innerText || rootElement.textContent || '';
            if (!fullText.trim()) return { count: 0, tokenMap: existingSessionMap || {} };
            const fullResult = scrubText(fullText, customRules, globalTokenLabels, activeProfile, existingSessionMap || {}, isPro);
            return { count: fullResult.uniqueUnmasked.size, tokenMap: existingSessionMap || {} };
        }
        // ─────────────────────────────────────────────────────────────────────

        // ── ACTUAL DOM MUTATION (TreeWalker for AutoScrub) ────────────────────

        const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT, null, false);
        const nodesToProcess = [];
        let node;
        while(node = walker.nextNode()) {
            if (!node.nodeValue.trim()) continue;
            nodesToProcess.push(node);
        }

        let globalTokenMap = { ...existingSessionMap };
        let allUniqueUnmasked = new Set();
        
        nodesToProcess.forEach(node => {
            const originalText = node.nodeValue;
            const result = scrubText(originalText, customRules, globalTokenLabels, activeProfile, globalTokenMap, isPro);
            
            if (result.uniqueUnmasked.size > 0) {
                if (!detectOnly && result.scrubbedText !== originalText) {
                    node.nodeValue = result.scrubbedText;
                }
                if (result.count > 0) {
                    globalTokenMap = { ...globalTokenMap, ...result.tokenMap };
                }
                result.uniqueUnmasked.forEach(k => allUniqueUnmasked.add(k));
            }
        });
        
        // Force React/ProseMirror to notice the change
        if (allUniqueUnmasked.size > 0 && !detectOnly) {
            rootElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }

        return {
            count: allUniqueUnmasked.size,
            tokenMap: globalTokenMap
        };
    }

    const GLOBAL_ASSISTANT_SELECTORS = [
        // ChatGPT
        '[data-message-author-role="assistant"]',
        '[data-message-author-role="model"]',
        '[data-testid="chat-message-text"]',
        '[data-testid="assistant-message"]',
        '[data-is-streaming]',
        '.agent-turn',
        'div[role="article"].agent-turn',
        // Claude
        'model-response',
        '.font-claude-message',
        '.claude-artifact',
        '[data-testid="artifact-renderer"]',
        // Gemini
        '.model-response-text__content',
        '.response-content',
        'message-content[is-response]',
        // Grok (x.com)
        '[data-testid="messageblock"]',
        '[class*="GrokResponseMessage"]',
        // DeepSeek
        '.ds-markdown',
        // Copilot — NEW React UI (copilot.microsoft.com as of 2025)
        '[data-testid="ai-message"]',
        '[class*="AIMessageContent"]',
        '[class*="ResponseMessage"]',
        '[class*="CopilotMessage"]',
        '[class*="BotMessage"]',
        // Copilot — legacy cib-serp Shadow DOM + Adaptive Cards
        '.ac-textBlock',
        '.cib-message-text',
        '.cib-message',
        '[class*="bot-message"]',
        '[class*="copilot-message"]',
        // Qwen / Tongyi
        '.output-area',
        // Perplexity
        '[data-testid="answer"]',
        // Generic article-based message wrappers (used by many platforms)
        // Excluded from sidebar via nav/aside filter in gatherUniversalAIContext()
        'div[role="article"]',
        // Conservative generic fallbacks — nav/aside exclusion filter prevents sidebar matches
        '.prose',
        '.whitespace-pre-wrap',
        '.message-content:not([contenteditable])',
        '[class*="message-row"]',
        '[class*="assistant"]',
        '.markdown'
    ].join(', ');

    function revealDataInDOM(tokenMap) {
        if (!tokenMap || Object.keys(tokenMap).length === 0) {
            if (typeof showInPageToast === 'function') showInPageToast("No protected session data to reveal.", "info");
            return 0;
        }

        const existingRestoredSpans = document.querySelectorAll('.ps-restored-data');

        const { compositeRegex, looseRules } = buildRestorationRegexAndRules(tokenMap);
        if (!compositeRegex) {
            if (typeof showInPageToast === 'function') showInPageToast("No protected session data to reveal.", "info");
            return 0;
        }

        let restoredCount = 0;
        const nodesToReplace = [];

        const ASSISTANT_SELECTORS = GLOBAL_ASSISTANT_SELECTORS;

        function isPromptInput(el) {
            if (!el) return false;
            if (el.closest) {
                return !!el.closest('[data-ps-attached="true"]');
            }
            let parent = el;
            while (parent) {
                if (parent.dataset && parent.dataset.psAttached === 'true') {
                    return true;
                }
                parent = parent.parentNode || parent.host;
            }
            return false;
        }

        // Shadow-DOM-aware assistant container detection:
        // .closest() cannot cross shadow boundaries, so if it returns null
        // we check whether the node lives inside a ShadowRoot whose host
        // (or host ancestor) matches an AI response selector.
        function isInsideAssistant(el) {
            if (!el || !el.closest) return false;
            if (el.closest(ASSISTANT_SELECTORS)) return true;
            // Shadow DOM fallback
            const root = el.getRootNode ? el.getRootNode() : null;
            if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot && root.host) {
                // Check if the shadow host itself matches, or has an ancestor that does
                if (root.host.matches && root.host.matches(ASSISTANT_SELECTORS)) return true;
                if (root.host.closest && root.host.closest(ASSISTANT_SELECTORS)) return true;
            }
            return false;
        }

        function walkTextNodes(root) {
            if (!root) return;

            // Handle elements with shadow roots if the root itself has one
            if (root.shadowRoot) {
                walkTextNodes(root.shadowRoot);
            }

            // Standard node iteration
            let child = root.firstChild;
            while (child) {
                const next = child.nextSibling;
                if (child.nodeType === Node.TEXT_NODE) {
                    if (child.parentElement) {
                        const tag = child.parentElement.tagName;
                        if (!['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT'].includes(tag)) {
                            // Determine if node is inside an AI assistant response container.
                            // If so, ALWAYS process it — skip both inPromptInput and isInstructionNode checks.
                            const isAssistant = isInsideAssistant(child.parentElement);

                            let shouldSkip = false;
                            if (!isAssistant) {
                                // Ignore user input areas where user types prompts actively.
                                // Precise check via isPromptInput helper (looks for data-ps-attached attribute).
                                const inPromptInput = isPromptInput(child.parentElement);
                                if (inPromptInput) {
                                    shouldSkip = true;
                                } else {
                                    // Check if inside the instruction block itself.
                                    const parentTc = child.parentElement.textContent;
                                    if (parentTc && parentTc.length < 8000 && (parentTc.includes('[Privacy Scrubber Mode]') || parentTc.includes('[SYSTEM INSTRUCTION: DATA PRIVACY MODE]'))) {
                                        shouldSkip = true;
                                    }
                                }
                            }


                            if (!shouldSkip) {
                                compositeRegex.lastIndex = 0;
                                const hasMatch = compositeRegex.test(child.nodeValue);
                                if (hasMatch) {
                                    if (['PRE', 'CODE'].includes(tag) || (child.parentElement.closest && child.parentElement.closest('pre, code'))) {
                                        const { restoredText, restoredCount: count } = unscrubText(child.nodeValue, tokenMap);
                                        if (count > 0) {
                                            child.nodeValue = restoredText;
                                            restoredCount += count;
                                        }
                                    } else {
                                        nodesToReplace.push(child);
                                    }
                                }
                            }
                        }
                    }
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    const tag = child.tagName;
                    if (!['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT'].includes(tag)) {
                        if (tag === 'IFRAME') {
                            try {
                                const iframeDoc = child.contentDocument || child.contentWindow?.document;
                                if (iframeDoc && iframeDoc.body) {
                                    walkTextNodes(iframeDoc.body);
                                }
                            } catch (e) {
                                // ignore cross-origin
                            }
                        } else {
                            // Check if inside an AI assistant response — always walk those.
                            const isAssistantEl = isInsideAssistant(child);

                            let shouldSkipEl = false;
                            if (!isAssistantEl) {
                                const inPromptInput = isPromptInput(child);
                                if (inPromptInput) {
                                    shouldSkipEl = true;
                                }
                            }

                            if (!shouldSkipEl) {
                                walkTextNodes(child);
                                if (child.shadowRoot) {
                                    walkTextNodes(child.shadowRoot);
                                }
                            }
                        }
                    }
                }
                child = next;
            }
        }

        walkTextNodes(document.documentElement);

        // TOGGLE RE-MASK: If no unmasked tokens were found on screen, but there are already revealed .ps-restored-data spans, re-mask them back to tokens
        if (nodesToReplace.length === 0 && existingRestoredSpans.length > 0) {
            let remaskedCount = 0;
            existingRestoredSpans.forEach(span => {
                const origToken = span.getAttribute('data-original-token') || span.getAttribute('data-token');
                let tokenToRestore = origToken;
                if (!tokenToRestore) {
                    const currentVal = span.textContent;
                    for (const [t, v] of Object.entries(tokenMap)) {
                        if (v === currentVal) {
                            tokenToRestore = t;
                            break;
                        }
                    }
                }
                if (tokenToRestore && span.parentElement) {
                    const textNode = document.createTextNode(tokenToRestore);
                    try {
                        span.parentElement.replaceChild(textNode, span);
                        remaskedCount++;
                    } catch (_) {}
                }
            });
            if (remaskedCount > 0) {
                if (typeof showInPageToast === 'function') showInPageToast(`🔒 Re-masked in DOM. Original tokens restored.`, "info");
                document.querySelectorAll('.ps-toolbar-reveal, [id$="-reveal"]').forEach(b => {
                    b.setAttribute('title', 'Reveal Original Data (Decrypted Locally)');
                    b.classList.remove('ps-revealed-active');
                });
                return remaskedCount;
            }
        }

        nodesToReplace.forEach(node => {
            const text = node.nodeValue;
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match;
            
            compositeRegex.lastIndex = 0;
            while ((match = compositeRegex.exec(text)) !== null) {
                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
                }
                let origKey = match[0];
                for (const rule of looseRules) {
                    if (new RegExp('^' + rule.patternStr + '$', 'i').test(match[0])) {
                        origKey = rule.originalKey;
                        break;
                    }
                }
                const rawVal = tokenMap[origKey] || match[0];
                
                const span = document.createElement('span');
                span.className = 'ps-restored-data';
                span.setAttribute('data-original-token', origKey);
                span.title = `✓ Restored locally in-browser RAM (Never sent to AI) | Original: ${origKey}`;
                Object.assign(span.style, {
                    borderBottom: '2px dashed #10b981',
                    color: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    borderRadius: '4px',
                    padding: '1px 5px',
                    margin: '0 1px',
                    cursor: 'help',
                    fontWeight: '600',
                    position: 'relative',
                    display: 'inline-block',
                    zIndex: '1',
                    boxShadow: '0 0 8px rgba(16, 185, 129, 0.25)',
                    textShadow: '0 0 4px rgba(16, 185, 129, 0.4)'
                });
                span.textContent = rawVal;
                
                fragment.appendChild(span);
                restoredCount++;
                lastIndex = compositeRegex.lastIndex;
            }
            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
            }
            
            if (node.parentElement) {
                try {
                    node.parentElement.replaceChild(fragment, node);
                } catch (e) {
                    // Fail silently
                }
            }
        });

        if (restoredCount > 0) {
            if (typeof showInPageToast === 'function') showInPageToast(`✅ Decrypted Locally! Your data is now safe to copy.`, "success");
            document.querySelectorAll('.ps-toolbar-reveal, [id$="-reveal"]').forEach(b => {
                b.setAttribute('title', 'Hide / Re-mask Protected Data in DOM');
                b.classList.add('ps-revealed-active');
            });
        } else {
            if (typeof showInPageToast === 'function') showInPageToast("No active tokens found on the screen.", "info");
        }
        return restoredCount;
    }

    function gatherUniversalAIContext() {
        try {
            // Helper function to recursively find elements matching selectors across shadow DOMs and same-origin iframes
            function querySelectorAllRecursive(root, selector) {
                // Single depth-first traversal that crosses shadow DOM boundaries.
                // Does NOT use root.querySelectorAll() to avoid duplicating shadow DOM results.
                const results = [];
                if (!root) return results;

                function walk(node) {
                    if (!node) return;
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        try {
                            if (node.matches && node.matches(selector)) results.push(node);
                        } catch (e) {}
                        // Recurse into shadow DOM (depth-first before light children)
                        if (node.shadowRoot) walk(node.shadowRoot);
                        // Recurse into same-origin iframes
                        if (node.tagName === 'IFRAME') {
                            try {
                                const iframeDoc = node.contentDocument || node.contentWindow?.document;
                                if (iframeDoc) walk(iframeDoc);
                            } catch (e) {}
                            return; // children handled above
                        }
                    } else if (node.nodeType !== Node.DOCUMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
                        return; // text node, comment, etc
                    }
                    // Walk light DOM / document children
                    let child = node.firstChild;
                    while (child) { walk(child); child = child.nextSibling; }
                }

                walk(root);
                return results;
            }


            // 1. Gather Input Text
            const inputs = querySelectorAllRecursive(document, 'textarea, div[contenteditable="true"], div.ProseMirror');
            // Find the active visible input, ignoring our own injected toolbar
            const activeInput = inputs.find(el => ((el.offsetParent !== null && el.offsetHeight > 0) || (typeof window !== 'undefined' && !window.chrome?.runtime)) && !el.closest('.ps-toolbar-container'));
            const inputText = activeInput ? (activeInput.value || activeInput.innerText || activeInput.textContent || "") : "";

            // 2. Gather Output Text (Last AI Response)
            let outputText = "";
            
            // Universal selectors covering major AI models + Claude Artifacts
            const knownSelectors = GLOBAL_ASSISTANT_SELECTORS;

            const candidateNodes = querySelectorAllRecursive(document, knownSelectors);
            
            // Filter out nodes that obviously belong to the user or sidebar/navigation
            const validResponses = Array.from(candidateNodes).filter(el => {
                // If it is inside a shadow DOM, offsetParent might be null, check offsetHeight/getBoundingClientRect
                const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
                const isJSDOM = typeof window !== 'undefined' && !window.chrome?.runtime && el.offsetParent === null && el.offsetHeight === 0;
                const isVisible = isJSDOM || (el.offsetParent !== null && el.offsetHeight > 0) || (rect && rect.height > 0 && rect.width > 0);
                if (!isVisible) return false;
                
                // SIDEBAR/NAV EXCLUSION: exclude elements inside navigation or sidebar areas.
                // This prevents Kimi sidebar, Grok left panel, and similar from being captured.
                if (el.closest) {
                    if (el.closest('nav, aside, header')) return false;
                    if (el.closest('[role="navigation"], [role="complementary"], [role="banner"]')) return false;
                }

                // QWEN THINKING FILTER: exclude Qwen/DeepSeek "Thinking completed" reasoning blocks.
                // These are collapsible sections shown before the actual response.
                if (el.closest) {
                    if (el.closest('[class*="thinking"], [class*="reasoning"], [class*="Thinking"], [class*="chain-of-thought"]')) return false;
                    if (el.classList.contains('thinking') || el.classList.contains('reasoning')) return false;
                }
                // Also exclude by text heuristic: element whose ONLY content is the thinking header
                {
                    const rawText = (el.innerText || el.textContent || '').trim();
                    if (rawText.toLowerCase() === 'thinking completed' || rawText.toLowerCase() === 'thinking...') return false;
                }

                // KEY EXCLUSION: elements that contain the active textarea are page/chat wrappers,
                // never AI responses. This is the definitive fix for Kimi (and similar platforms)
                // where a large wrapper div matches a generic selector and includes the entire
                // sidebar + chat area + user input field.
                if (activeInput && el.contains(activeInput)) return false;

                // Exclude user messages that share generic classes like .message-content
                const role = el.getAttribute('data-message-author-role');
                if (role === 'user') return false;
                
                // Exclude explicit user classes
                if (el.closest) {
                    if (el.closest('.user-message') || el.classList.contains('user-message')) return false;
                    if (el.closest('[data-testid="user-message"]')) return false;
                    if (el.closest('[data-message-author-role="user"]')) return false;
                } else {
                    let parent = el.parentNode;
                    while (parent) {
                        if (parent.classList && (parent.classList.contains('user-message') || parent.getAttribute('data-testid') === 'user-message')) {
                            return false;
                        }
                        parent = parent.parentNode || parent.host;
                    }
                }

                return true;
            });

            function getCleanElementText(el) {
                if (!el) return "";
                try {
                    const clone = el.cloneNode(true);
                    clone.querySelectorAll('style, script, noscript, svg, link, template, [hidden]').forEach(s => s.remove());
                    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                    clone.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, pre, blockquote').forEach(b => {
                        b.insertAdjacentText('afterend', '\n');
                    });
                    const text = (clone.textContent || "").replace(/\n{3,}/g, '\n\n').trim();
                    if (/^\[data-conversation-component=[^\]]+\]\{/.test(text) || /^\{[ \t\r\n]*--[a-zA-Z0-9_-]+:/.test(text)) return "";
                    return text;
                } catch (_) {
                    return (el.textContent || "").trim();
                }
            }

            function extractCleanAssistantMessageText(turnEl) {
                if (!turnEl) return "";
                try {
                    const clone = turnEl.cloneNode(true);
                    // 1. Remove style, script, noscript, svg, link, template elements (prevents CSS leaks)
                    clone.querySelectorAll('style, script, noscript, svg, link, template, [hidden]').forEach(el => el.remove());

                    // 2. Remove reasoning / thought accordions
                    clone.querySelectorAll(
                        '[class*="thinking"], [class*="reasoning"], [class*="thought"], [data-testid*="thought"], [data-testid*="reasoning"], details, .thinking, .reasoning'
                    ).forEach(el => el.remove());
                    
                    // 3. Remove bottom toolbar action buttons and canvas headers
                    clone.querySelectorAll(
                        'button, [role="button"], [class*="toolbar"], [class*="actions"], [class*="feedback"], [data-testid*="action"], [class*="copy-button"], [class*="read-aloud"], .ps-token-chips-bar, [class*="canvas-header"], [data-testid*="artifact-header"]'
                    ).forEach(el => el.remove());
                    
                    // 4. Find top-level markdown / content blocks
                    const contentNodes = clone.querySelectorAll(
                        '.markdown, .prose, [class*="markdown"], [class*="prose"], .text-message, .ds-markdown, .font-claude-message, message-content, pre, table'
                    );
                    if (contentNodes.length > 0) {
                        const topNodes = Array.from(contentNodes).filter((node, _, list) =>
                            !list.some(parent => parent !== node && parent.contains(node))
                        );
                        const joined = topNodes.map(n => getCleanElementText(n)).filter(Boolean).join('\n\n');
                        if (joined) return cleanAIPromptPrefix(joined);
                    }
                    
                    const fullCleaned = getCleanElementText(clone);
                    if (fullCleaned) return cleanAIPromptPrefix(fullCleaned);
                } catch (_) {}
                return cleanAIPromptPrefix(turnEl.innerText || turnEl.textContent || "").trim();
            }

            if (validResponses.length > 0) {
                // Return the text of the very last valid response on the page.
                // De-ancestor: if element A contains element B (both matched), prefer B (more specific).
                const leafResponses = validResponses.filter((el, _, arr) =>
                    !arr.some(other => other !== el && el.contains(other))
                );
                const candidates = leafResponses.length > 0 ? leafResponses : validResponses;
                const lastLeaf = candidates[candidates.length - 1];

                const fullTurn = resolveFullAssistantTurnElement(lastLeaf, activeInput);
                outputText = extractCleanAssistantMessageText(fullTurn || lastLeaf);
            }

            
            if (!outputText.trim()) {
                // Fallback: look for any element containing tokens, excluding prompt inputs and nav/sidebar areas
                const allElements = querySelectorAllRecursive(document, 'div, p, span, li, td, input, textarea, [role="textbox"]');
                const tokenContainingElements = allElements.filter(el => {
                    // Exclude navigation/sidebar areas (same as primary filter)
                    if (el.closest && el.closest('nav, aside, header, [role="navigation"], [role="complementary"], [role="banner"]')) return false;
                    // Exclude page/chat wrappers that contain the active input
                    if (activeInput && el.contains(activeInput)) return false;
                    // Exclude prompt inputs (active ones with data-ps-attached attribute)
                    let parent = el;
                    while (parent) {
                        if (parent.dataset && parent.dataset.psAttached === 'true') return false;
                        parent = parent.parentNode || parent.host;
                    }
                    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) return false;
                    const text = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? (el.value || "") : (el.innerText || el.textContent || "");
                    return /\[[A-Z]+_[0-9]+\]/.test(text);
                });

                let bestEl = null;
                let maxTokens = 0;
                let bestTextLength = 0;

                for (const el of tokenContainingElements) {
                    const text = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? (el.value || "") : (el.innerText || el.textContent || "");
                    const matches = text.match(/\[[A-Z]+_[0-9]+\]/g) || [];
                    const uniqueTokens = new Set(matches).size;
                    if (uniqueTokens > maxTokens || (uniqueTokens === maxTokens && uniqueTokens > 0 && text.length > bestTextLength)) {
                        maxTokens = uniqueTokens;
                        bestTextLength = text.length;
                        bestEl = el;
                    }
                }
                if (bestEl) {
                    outputText = (bestEl.tagName === 'INPUT' || bestEl.tagName === 'TEXTAREA') ? (bestEl.value || "") : (bestEl.innerText || bestEl.textContent || "");
                }
            }
            
            return {
                inputText: inputText.trim(),
                outputText: cleanAIPromptPrefix(outputText).trim()
            };
        } catch (e) {
            console.error("[PrivacyScrubber] Universal Context gather failed:", e);
            return { inputText: "", outputText: "" };
        }
    }

    // Export to window for content scripts
    // Expose for OCR and advanced usage
    function getRules(profile) {
        const engine = getEngine();
        if (engine) {
            return engine.getActiveRules(profile);
        }
        return [];
    }

    /**
     * Show a right-click context menu for Profile Switching
     */
    function showProfileMenu(e, anchorElement, onProfileChange) {
        // Remove existing menu if any
        let existing = document.getElementById('ps-profile-menu');
        if (existing) {
            existing.remove();
            return; // Act as a toggle
        }

        const PROFILES = [
            { id: 'general', label: 'General' },
            { id: 'engineering', label: 'Engineering' },
            { id: 'finance', label: 'Finance' },
            { id: 'legal', label: 'Legal' },
            { id: 'medical', label: 'Healthcare' },
            { id: 'hr', label: 'HR' }
        ];

        chrome.storage.local.get(['ps_active_profile', 'ps_is_pro', 'ps_is_teams'], (data) => {
            const activeProfile = (data.ps_active_profile || 'general').toLowerCase();
            const isPro = data.ps_is_pro || data.ps_is_teams || false;

            const menu = document.createElement('div');
            menu.id = 'ps-profile-menu';
            menu.className = 'ps-profile-menu';

            // Positioning
            const rect = anchorElement.getBoundingClientRect();
            // Try to position it below and to the left of the button
            menu.style.top = (rect.bottom + window.scrollY + 5) + 'px';
            menu.style.left = (rect.right + window.scrollX - 150) + 'px';

            const header = document.createElement('div');
            header.className = 'ps-profile-menu-header';
            header.innerText = 'Detection Profile';
            menu.appendChild(header);

            PROFILES.forEach(p => {
                const item = document.createElement('div');
                item.className = 'ps-profile-menu-item';
                const isCurrentActive = p.id.toLowerCase() === activeProfile;
                if (isCurrentActive) item.classList.add('active');
                
                let labelText = p.label;
                item.innerText = labelText;

                if (!isPro && p.id !== 'general') {
                    item.style.opacity = '0.5';
                    item.style.cursor = 'not-allowed';
                    item.title = 'PRO Feature';
                    item.innerText = labelText + ' 🔒';
                } else if (isCurrentActive) {
                    item.innerText = labelText + ' ✓';
                }

                item.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    if (!isPro && p.id !== 'general') {
                        if (typeof showInPageToast === 'function') {
                            showInPageToast('Specialized Profiles require PRO upgrade.', 'warning');
                        }
                        menu.remove();
                        return;
                    }

                    chrome.storage.local.set({ ps_active_profile: p.id }, () => {
                        if (typeof showInPageToast === 'function') {
                            showInPageToast(`Profile Switched to ${p.label}`, 'success');
                        }
                        menu.remove();
                        
                        // Trigger immediate re-scrub if callback provided
                        if (typeof onProfileChange === 'function') {
                            onProfileChange(p.id);
                        }
                    });
                });

                menu.appendChild(item);
            });

            document.body.appendChild(menu);

            // Close on click outside
            const closeMenu = (ev) => {
                if (!menu.contains(ev.target) && ev.target !== anchorElement) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                    document.removeEventListener('contextmenu', closeMenu);
                }
            };

            setTimeout(() => {
                document.addEventListener('click', closeMenu);
                document.addEventListener('contextmenu', closeMenu);
            }, 50);
        });
    }

    /**
     * exportSessionToFile — Downloads the current session map as a JSON file
     */
    function exportSessionToFile(sessionMap, filename = 'ps-session', extraContext = null) {
        if (!sessionMap || Object.keys(sessionMap).length === 0) {
            if (window.showInPageToast) window.showInPageToast("No active session data to export.", "info");
            return;
        }
        try {
            const data = {
                version: "1.6.4",
                timestamp: new Date().toISOString(),
                sessionMap: sessionMap,
                context: extraContext
            };
            const jsonStr = JSON.stringify(data, null, 2);
            if (typeof downloadFile === 'function') {
                downloadFile(jsonStr, `${filename}-${Date.now()}.json`, 'application/json');
            } else {
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                if (typeof chrome !== 'undefined' && chrome.downloads) {
                    chrome.downloads.download({ url: url, filename: `${filename}-${Date.now()}.json` });
                } else {
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${filename}-${Date.now()}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }
            }
            if (window.showInPageToast) window.showInPageToast("✓ Session exported successfully", "success");
        } catch (e) {
            console.error("PrivacyScrubber Export Error:", e);
            if (window.showInPageToast) window.showInPageToast("❌ Export failed.", "error");
        }
    }

    function extractCleanAssistantMessageText(turnEl) {
        if (!turnEl) return "";
        try {
            const clone = turnEl.cloneNode(true);
            // 1. Remove style, script, noscript, svg, link, template elements (prevents CSS leaks)
            clone.querySelectorAll('style, script, noscript, svg, link, template, [hidden]').forEach(el => el.remove());

            // 2. Remove reasoning / thought accordions
            clone.querySelectorAll(
                '[class*="thinking"], [class*="reasoning"], [class*="thought"], [data-testid*="thought"], [data-testid*="reasoning"], details, .thinking, .reasoning'
            ).forEach(el => el.remove());
            
            // 3. Remove bottom toolbar action buttons and canvas headers
            clone.querySelectorAll(
                'button, [role="button"], [class*="toolbar"], [class*="actions"], [class*="feedback"], [data-testid*="action"], [class*="copy-button"], [class*="read-aloud"], .ps-token-chips-bar, [class*="canvas-header"], [data-testid*="artifact-header"]'
            ).forEach(el => el.remove());
            
            // 4. Find top-level markdown / content blocks
            const contentNodes = clone.querySelectorAll(
                '.markdown, .prose, [class*="markdown"], [class*="prose"], .text-message, .ds-markdown, .font-claude-message, message-content, pre, table'
            );
            function getClean(el) {
                if (!el) return "";
                try {
                    const c = el.cloneNode(true);
                    c.querySelectorAll('style, script, noscript, svg, link, template, [hidden]').forEach(s => s.remove());
                    c.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                    c.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, pre, blockquote').forEach(b => {
                        b.insertAdjacentText('afterend', '\n');
                    });
                    const text = (c.textContent || "").replace(/\n{3,}/g, '\n\n').trim();
                    if (/^\[data-conversation-component=[^\]]+\]\{/.test(text) || /^\{[ \t\r\n]*--[a-zA-Z0-9_-]+:/.test(text)) return "";
                    return text;
                } catch (_) {
                    return (el.textContent || "").trim();
                }
            }
            if (contentNodes.length > 0) {
                const topNodes = Array.from(contentNodes).filter((node, _, list) =>
                    !list.some(parent => parent !== node && parent.contains(node))
                );
                const joined = topNodes.map(n => getClean(n)).filter(Boolean).join('\n\n');
                if (joined) return cleanAIPromptPrefix(joined);
            }
            
            const fullCleaned = getClean(clone);
            if (fullCleaned) return cleanAIPromptPrefix(fullCleaned);
        } catch (_) {}
        return cleanAIPromptPrefix(turnEl.innerText || turnEl.textContent || "").trim();
    }

    function resolveFullAssistantTurnElement(leafOrContainer, textarea) {
        if (!leafOrContainer) return null;
        try {
            const turnContainer = leafOrContainer.closest ? leafOrContainer.closest(
                'article, [data-message-author-role="assistant"], [data-message-author-role="model"], [data-testid*="assistant-message"], [data-testid*="conversation-turn"], [class*="chat-message"], [class*="ds-message"], [class*="message-item"], [class*="response-container"], [class*="chat-turn"], [class*="agent-turn"], [class*="talk-bubble"], [class*="bot-message"], [class*="output-block"]'
            ) : null;

            if (turnContainer && (!textarea || !turnContainer.contains(textarea))) {
                const userMsgCount = turnContainer.querySelectorAll ? turnContainer.querySelectorAll('.user-message, [data-message-author-role="user"], [data-testid="user-message"]').length : 0;
                if (userMsgCount === 0) {
                    return turnContainer;
                }
            }
            
            if (leafOrContainer.parentElement) {
                const parent = leafOrContainer.parentElement;
                if (!parent.closest('nav, aside, header, [role="navigation"]') && (!textarea || !parent.contains(textarea))) {
                    const siblingContentNodes = parent.querySelectorAll ? parent.querySelectorAll('.ds-markdown, [class*="ds-markdown"], .markdown, .prose, pre, p, blockquote, ol, ul, div') : [];
                    if (siblingContentNodes.length > 1) {
                        return parent;
                    }
                }
            }
        } catch (_) {}
        return leafOrContainer;
    }

    const engine = getEngine();

    if (typeof window !== 'undefined') {
        window.PrivacyScrubberCore = { 
            init, 
            scrubText, 
            unscrubText: (text, sessionMap, opts) => {
                if (!engine) return null;
                const res = engine.unscrubText(text, sessionMap, opts);
                return res ? { restoredText: res.text, text: res.text, restoredCount: res.count, count: res.count } : null;
            }, 
            unscrubTextAsHTML: (text, sessionMap, opts) => {
                if (!engine) return null;
                const res = engine.unscrubTextAsHTML(text, sessionMap, opts);
                return res ? { restoredHTML: res.text, html: res.text, text: res.text, restoredCount: res.count, count: res.count } : null;
            }, 
            showTeamsPassphraseModal, 
            scrubDataInDOM, 
            revealDataInDOM, 
            gatherUniversalAIContext,
            resolveFullAssistantTurnElement,
            extractCleanAssistantMessageText,
            extractLLMAssistantText: extractCleanAssistantMessageText,
            exportSessionToFile,
            getRules,
            showProfileMenu,
            cleanAIPromptPrefix: (text) => engine ? engine.cleanAIPromptPrefix(text) : text,
            hydrateRegex: (rule) => engine ? engine.hydrateRegex(rule) : rule,
            isInitialized: false
        };
        window.showInPageToast = showInPageToast;

        // v1.4.4: Automatic re-hydration on boot from local storage cache
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['ps_rules_cache'], (data) => {
                if (data.ps_rules_cache) {
                    init(data.ps_rules_cache);
                }
            });
        }
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            init,
            scrubText,
            unscrubText: (text, sessionMap, opts) => {
                if (!engine) return null;
                const res = engine.unscrubText(text, sessionMap, opts);
                return res ? { restoredText: res.text, text: res.text, restoredCount: res.count, count: res.count } : null;
            },
            unscrubTextAsHTML: (text, sessionMap, opts) => {
                if (!engine) return null;
                const res = engine.unscrubTextAsHTML(text, sessionMap, opts);
                return res ? { restoredHTML: res.text, html: res.text, text: res.text, restoredCount: res.count, count: res.count } : null;
            },
            resolveFullAssistantTurnElement,
            extractCleanAssistantMessageText,
            extractLLMAssistantText: extractCleanAssistantMessageText,
            cleanAIPromptPrefix: (text) => engine ? engine.cleanAIPromptPrefix(text) : text,
            hydrateRegex: (rule) => engine ? engine.hydrateRegex(rule) : rule,
            getRules
        };
    }
})();

