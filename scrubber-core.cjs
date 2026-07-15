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

    // --- START DEFAULT RULES ---
    let REGEX_RULES = [
        { type: 'EMAIL', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
        { type: 'FINANCIAL', regex: /\$[0-9,.]+\b/g },
        { type: 'FINANCIAL', regex: /\b[A-Z]{4}(?:AD|AE|AF|AG|AI|AL|AM|AO|AQ|AR|AS|AT|AU|AW|AX|AZ|BA|BB|BD|BE|BF|BG|BH|BI|BJ|BL|BM|BN|BO|BQ|BR|BS|BT|BV|BW|BY|BZ|CA|CC|CD|CF|CG|CH|CI|CK|CL|CM|CN|CO|CR|CU|CV|CW|CX|CY|CZ|DE|DJ|DK|DM|DO|DZ|EC|EE|EG|EH|ER|ES|ET|FI|FJ|FK|FM|FO|FR|GA|GB|GD|GE|GF|GG|GH|GI|GL|GM|GN|GP|GQ|GR|GS|GT|GU|GW|GY|HK|HM|HN|HR|HT|HU|ID|IE|IL|IM|IN|IO|IQ|IR|IS|IT|JE|JM|JO|JP|KE|KG|KH|KI|KM|KN|KP|KR|KW|KY|KZ|LA|LB|LC|LI|LK|LR|LS|LT|LU|LV|LY|MA|MC|MD|ME|MF|MG|MH|MK|ML|MM|MN|MO|MP|MQ|MR|MS|MT|MU|MV|MW|MX|MY|MZ|NA|NC|NE|NF|NG|NI|NL|NO|NP|NR|NU|NZ|OM|PA|PE|PF|PG|PH|PK|PL|PM|PN|PR|PS|PT|PW|PY|QA|RE|RO|RS|RU|RW|SA|SB|SC|SD|SE|SG|SH|SI|SJ|SK|SL|SM|SN|SO|SR|SS|ST|SV|SX|SY|SZ|TC|TD|TF|TG|TJ|TK|TL|TM|TN|TO|TR|TT|TV|TW|TZ|UA|UG|UM|US|UY|UZ|VA|VC|VE|VG|VI|VN|VU|WF|WS|YE|YT|ZA|ZM|ZW)[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?\b/g },
        { type: 'FINANCIAL', regex: /\b\d{9}\b/g },
        { type: 'FINANCIAL', regex: /\b[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{4}[0-9]{7}[a-zA-Z0-9]{0,16}\b/g },
        { type: 'FINANCIAL', regex: /\bPORTFOLIO[-_][A-Z0-9]{5,}\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:\d[ -]?){13,19}\b/g },
        { type: 'FINANCIAL', regex: /\b(?:1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,39}\b/g },
        { type: 'FINANCIAL', regex: /\b0x[a-fA-F0-9]{40}\b/g },
        { type: 'LEGAL', regex: /\bCASE[-_][A-Z0-9]{4,}\b/gi },
        { type: 'LEGAL', regex: /\bMATTER[-_][A-Z0-9]{4,}\b/gi },
        { type: 'LEGAL', regex: /\b[A-Z]{2,4}[- ]?\d{2}[- ]?\d{4,}\b/g },
        { type: 'PRIVILEGE', regex: /ATTORNEY[- ]CLIENT[- ]PRIVILEGE/gi },
        { type: 'ID', regex: /\bEEID[ -]?\d{4,}\b/gi },
        { type: 'ID', regex: /\bRESUME[-_]?[A-Z0-9]{4,}\b/gi },
        { type: 'ID', regex: /\bLEAD[-_][A-Z0-9]{5,}\b/gi },
        { type: 'ID', regex: /\bCAMPAIGN[-_][A-Z0-9]{4,}\b/gi },
        { type: 'ID', regex: /\bDEAL[-_][A-Z0-9]{4,}\b/gi },
        { type: 'ID', regex: /\bENTITY[-_][0-9]{4,}\b/gi },
        { type: 'ID', regex: /\bOPPORTUNITY[-_][A-Z0-9]{5,}\b/gi },
        { type: 'ID', regex: /\bPROSPECT[-_][A-Z0-9]{5,}\b/gi },
        { type: 'ID', regex: /\bTICKET[-_][A-Z0-9]{5,}\b/gi },
        { type: 'ID', regex: /\bZENDESK[-_][0-9]{4,}\b/gi },
        { type: 'ID', regex: /\bEMP[-_]\d{3,}\b/gi },
        { type: 'ID', regex: /\bLIS[-]?\d{6,}\b/gi },
        { type: 'ID', regex: /\bPARCEL[-]?\d{5,}\b/gi },
        { type: 'ID', regex: /\bAGENT[-_][A-Z0-9]{4,}\b/gi },
        { type: 'ID', regex: /\bTASK[-_][A-Z0-9]{5,}\b/gi },
        { type: 'ID', regex: /\bSTUDENT[-_][0-9]{5,}\b/gi },
        { type: 'ID', regex: /\bCOURSE[-_][A-Z0-9]{4,}\b/gi },
        { type: 'ID', regex: /\bINSTANCE[-_]ID[-_][a-z0-9-]{10,}\b/gi },
        { type: 'ID', regex: /\bENV[-_][A-Z0-9]{3,}\b/gi },
        { type: 'PRIVACY', regex: /\bTENANT[-_]ID[-_][0-9]{4,}\b/gi },
        { type: 'ADDRESS', regex: /\b\d{1,6}\s+[A-Z][a-zA-Z0-9.-]*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place|Terrace|Pkwy|Parkway|Sq|Square)\b/gi },
        { type: 'LOCATION', regex: /\b[A-Z][a-zA-Z\s.-]{2,25},\s*[A-Z]{2}\b/g },
        { type: 'PHI', regex: /\bMRN[ -]?\d{6,}\b/gi },
        { type: 'PHI', regex: /\b[A-TV-Z]\d{2}[. ]?\d[A-Z0-9]?\b/g },
        { type: 'PHI', regex: /\b[A-Z]{2,3}\d{6,8}\b/g },
        { type: 'PHI', regex: /\bNHS[ -]?\d{3}[ -]?\d{3}[ -]?\d{4}\b/gi },
        { type: 'COPYRIGHT', regex: /\bPROJECT[-_][A-Z0-9]{5,}\b/gi },
        { type: 'COPYRIGHT', regex: /\b(DRAFT|ASSET|SCRIPT)[-_][0-9]{4,}\b/gi },
        { type: 'PRIVACY', regex: /\b(GDPR|HIPAA|CCPA|SOC2)[-_]AUDIT[-_]\d{4}\b/gi },
        { type: 'PRIVACY', regex: /\bPOLICY[-_][A-Z0-9]{5,}\b/gi },
        { type: 'PRIVACY', regex: /\bGRADE[S]?[:\s]*[A-DF][+-]?\b/gi },
        { type: 'PRIVACY', regex: /\b(DOB|BIRTHDAY)[:\s]*[0-9./-]{6,10}\b/gi },
        { type: 'PRIVACY', regex: /\b(PASSWORD|PWD|SECRET)[:\s]*[\S]{4,}\b/gi },
        { type: 'ID', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
        { type: 'ID', regex: /(?:\/|[A-Za-z]:\\)[\w\-. ]+(?:[\/\\][\w\-. ]+)+/g },
        { type: 'ID', regex: /\b[A-CEGHJ-PR-TW-Z]{1}[A-CEGHJ-NPR-TW-Z]{1}[0-9]{6}[A-DFM]{1}\b/gi },
        { type: 'ID', regex: /\b[A-Z]{2}[0-9]{6,12}\b/gi },
        { type: 'ID', regex: /[A-Z0-9<]{30,44}/gi },
        { type: 'IP', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
        { type: 'IP', regex: /\b(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}\b/g },
        { type: 'ID', regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g },
        { type: 'ID', regex: /(?:\B\/|\b[a-zA-Z]:\\)(?:[\w.-]+[\/\\]?)+\b/g },
        { type: 'ID', regex: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::\d{2})?)?\b/g },
        { type: 'ID', regex: /\b\d{4}-\d{2}-\d{2}\b/g },
        { type: 'ID', regex: /\b\d{2}\/\d{2}\/\d{4}\b/g },
        { type: 'PHONE', regex: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
        { type: 'PHONE', regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g },
        { type: 'PHONE', regex: /\+?[1-9]\d{1,3}[\s.-]\(?\d{1,4}\)?[\s.-]\d{2,4}[\s.-]\d{4}/g },
        { type: 'PHONE', regex: /(?:\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}\b/g },
        { type: 'PHONE', regex: /\b(?:\d{3}[-.\s]??\d{4}|\(\d{3}\)\s??\d{3}[-.\s]??\d{4}|\d{3}[-.\s]??\d{3}[-.\s]??\d{4})\b/g },
        { type: 'LOCATION', regex: /\b-?\d{1,3}\.\d{4,6}[° ]?[NSns],\s*-?\d{1,3}\.\d{4,6}[° ]?[EWew]\b/g },
        { type: 'LOCATION', regex: /\b(LATITUDE|LONGITUDE)[:\s]-?\d{1,3}\.\d{4,10}\b/gi },
        { type: 'ID', regex: /\bDL[ -]?\d{6,12}\b/gi },
        { type: 'ID', regex: /\bDRIVER[S]?\s+LICENSE[ -]?\d{6,15}\b/gi },
        { type: 'NAME', regex: /(?<=^|[^\p{L}\p{N}_])\p{Lu}[\p{Ll}'-]*(?:\p{Lu}[\p{Ll}'-]*)?\p{L}(?:[ \t\xA0]+(?:\p{Lu}[\p{Ll}'-]{1,}(?:\p{Lu}[\p{Ll}'-]*)?\p{L}|\p{Lu}\.?|van|von|de|di|da|la|le|del|du|der|van[ \t\xA0]+de)){0,1}[ \t\xA0]+\p{Lu}[\p{Ll}'-]*(?:\p{Lu}[\p{Ll}'-]*)?\p{L}(?:'s)?(?=[^\p{L}\p{N}_]|$)/gu },
        { type: 'NAME', regex: /(?<=^|[^\p{L}\p{N}_])\p{Lu}{3,}(?:[\p{Lu}'-]*\p{Lu})?(?:[ \t\xA0]+\p{Lu}{3,}(?:[\p{Lu}'-]*\p{Lu})?){1,2}(?:'s)?(?=[^\p{L}\p{N}_]|$)/gu },
        { type: 'NAME', regex: /(?<=^|[^\p{L}\p{N}_])\p{Lu}{2,}(?:[\p{Lu}'-]*\p{Lu})?(?:[ \t\xA0]+\p{Lu}\.)+[ \t\xA0]+\p{Lu}{2,}(?:[\p{Lu}'-]*\p{Lu})?(?:'s)?(?=[^\p{L}\p{N}_]|$)/gu },
        { type: 'NAME', regex: /(?<=^|[^\p{L}\p{N}_])(?:Mr|Mrs|Ms|Dr|Prof|Hon|Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Hon\.)[ \t\xA0]+\p{Lu}[\p{Ll}'-]*(?:\p{Lu}[\p{Ll}'-]*)?\p{L}(?=[^\p{L}\p{N}_]|$)/gu },
        // Context-anchored name: fires on explicit markers regardless of profile (low false-positive)
        { type: 'NAME', isContextName: true, regex: /(?:(?:my|your|his|her|their|our)\s+(?:full\s+)?name\s+is|I(?:'m| am)\s+(?:called\s+)?|this\s+is\s+|(?:from|by|contact|sender|recipient|patient|client|author|owner|user|employee|staff|agent|operator|submitted\s+by|written\s+by|prepared\s+by|signed\s+by|approved\s+by|reviewed\s+by)\s*[:—]?\s*)(\p{Lu}[\p{Ll}'-]+(?:[ \t\xA0]+(?:\p{Lu}\.[ \t\xA0]+)?[\p{Lu}][\p{Ll}'-]+){1,3})/giu }
    ];

    let PROFILE_RULES = {
        'general': [

        ],
        'legal': [
            { type: 'LEGAL', regex: /\bCASE[-_][A-Z0-9]{4,}\b/gi },
            { type: 'LEGAL', regex: /\bMATTER[-_][A-Z0-9]{4,}\b/gi },
            { type: 'LEGAL', regex: /\b[A-Z]{2,4}[- ]?\d{2}[- ]?\d{4,}\b/g },
            { type: 'PRIVILEGE', regex: /ATTORNEY[- ]CLIENT[- ]PRIVILEGE/gi }
        ],
        'hr': [
            { type: 'ID', regex: /\bEEID[ -]?\d{4,}\b/gi },
            { type: 'ID', regex: /\bEMP[-_]\d{3,}\b/gi },
            { type: 'ID', regex: /\bRESUME[-_]?[A-Z0-9]{4,}\b/gi },
            { type: 'PRIVACY', regex: /\b(DOB|BIRTHDAY)[:\s]*[0-9./-]{6,10}\b/gi },
            { type: 'ADDRESS', regex: /\b\d{1,6}\s+[A-Z][a-zA-Z0-9.-]*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place|Terrace|Pkwy|Parkway|Sq|Square)\b/gi }
        ],
        'finance': [
            { type: 'FINANCIAL', regex: /\b[A-Z]{4}(?:AD|AE|AF|AG|AI|AL|AM|AO|AQ|AR|AS|AT|AU|AW|AX|AZ|BA|BB|BD|BE|BF|BG|BH|BI|BJ|BL|BM|BN|BO|BQ|BR|BS|BT|BV|BW|BY|BZ|CA|CC|CD|CF|CG|CH|CI|CK|CL|CM|CN|CO|CR|CU|CV|CW|CX|CY|CZ|DE|DJ|DK|DM|DO|DZ|EC|EE|EG|EH|ER|ES|ET|FI|FJ|FK|FM|FO|FR|GA|GB|GD|GE|GF|GG|GH|GI|GL|GM|GN|GP|GQ|GR|GS|GT|GU|GW|GY|HK|HM|HN|HR|HT|HU|ID|IE|IL|IM|IN|IO|IQ|IR|IS|IT|JE|JM|JO|JP|KE|KG|KH|KI|KM|KN|KP|KR|KW|KY|KZ|LA|LB|LC|LI|LK|LR|LS|LT|LU|LV|LY|MA|MC|MD|ME|MF|MG|MH|MK|ML|MM|MN|MO|MP|MQ|MR|MS|MT|MU|MV|MW|MX|MY|MZ|NA|NC|NE|NF|NG|NI|NL|NO|NP|NR|NU|NZ|OM|PA|PE|PF|PG|PH|PK|PL|PM|PN|PR|PS|PT|PW|PY|QA|RE|RO|RS|RU|RW|SA|SB|SC|SD|SE|SG|SH|SI|SJ|SK|SL|SM|SN|SO|SR|SS|ST|SV|SX|SY|SZ|TC|TD|TF|TG|TJ|TK|TL|TM|TN|TO|TR|TT|TV|TW|TZ|UA|UG|UM|US|UY|UZ|VA|VC|VE|VG|VI|VN|VU|WF|WS|YE|YT|ZA|ZM|ZW)[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?\b/g },
            { type: 'FINANCIAL', regex: /\b[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{4}[0-9]{7}[a-zA-Z0-9]{0,16}\b/g },
            { type: 'FINANCIAL', regex: /\bPORTFOLIO[-_][A-Z0-9]{5,}\b/gi }
        ],
        'medical': [
            { type: 'PHI', regex: /\bMRN[ -]?\d{6,}\b/gi },
            { type: 'PHI', regex: /\b[A-TV-Z]\d{2}[. ]?\d[A-Z0-9]?\b/g },
            { type: 'PHI', regex: /\b[A-Z]{2,3}\d{6,8}\b/g },
            { type: 'PHI', regex: /\bNHS[ -]?\d{3}[ -]?\d{3}[ -]?\d{4}\b/gi }
        ],
        'security': [
            { type: 'SECRET', regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA)[A-Z0-9]{16}\b/g },
            { type: 'SECRET', regex: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g },
            { type: 'SECRET', regex: /\b(?:ghp|gho|ghu|ghs|ghr|glpat|npm|xox[baprs])[-_][A-Za-z0-9_]{10,}\b/g },
            { type: 'SECRET', regex: /\b(?:[rs]k)_(?:test|live)_[a-zA-Z0-9]{24,}\b/g },
            { type: 'SECRET', regex: /\b(sk|pk|secret|key|token|auth)(?:[-_][a-zA-Z0-9_-]{5,}|(?=[a-zA-Z0-9_-]{5,}\b)(?=[a-zA-Z_-]*[0-9])[a-zA-Z0-9_-]{5,})\b/gi },
            { type: 'SECRET', regex: /\b[a-fA-F0-9]{32,64}\b/g },
            { type: 'SECRET', regex: /\bCVE-\d{4}-\d{4,}\b/gi },
            { type: 'SECRET', regex: /\b(MD5|SHA1|SHA256)[:\s][a-f0-9]{32,64}\b/gi },
            { type: 'SECRET', regex: /\b(DB|POSTGRES|REDIS|MYSQL|AWS|SECRET|PASSWORD|TOKEN|API|KEY)[A-Z0-9_]*\s*[:=]\s*[^\s"']+\b/gi },
            { type: 'SECRET', regex: /\b(?:INCIDENT|BREACH)[-_: ]?ID[-_: ]?[0-9]{4,10}\b/gi }
        ],
        'marketing': [
            { type: 'ID', regex: /\b(?:LEAD|PROSPECT)[-_: ]*[A-Z0-9_-]*[0-9][A-Z0-9_-]*\b/gi },
            { type: 'ID', regex: /\b(?:CAMPAIGN|CLID|GCLID|FBCLID)[-_:=]*[A-Za-z0-9_-]{10,}\b/gi },
            { type: 'FINANCIAL', regex: /(?<=\b(?:LTV|CAC)[\s:]*)\$[0-9,.]+\b/gi },
            { type: 'ID', regex: /\b(?:SEGMENT|COHORT)[-_: ]*[0-9]{4,8}\b/gi }
        ],
        'bizops': [
            { type: 'ID', regex: /\b(?:DEAL|KPI|METRIC)[-_: ]?[A-Z0-9]{4,}\b/gi },
            { type: 'ID', regex: /\b(?:ENTITY|VENDOR|PARTNER)[-_: ]?[0-9]{4,10}\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:REVENUE|EBITDA|PROFIT|MARGIN)[-_: ]?\$?[0-9,.]+[KM]?\b/gi },
            { type: 'SECRET', regex: /\b(?:NDA|M&A|MERGER)[-_: ]?[A-Z0-9]{4,}\b/gi }
        ],
        'sales': [
            { type: 'ID', regex: /\bOPPORTUNITY[-_: ]?[A-Z0-9]{5,}\b/gi },
            { type: 'ID', regex: /\b(?:DOCUSIGN|CONTRACT)[-_: ]?[0-9A-F]{8,32}\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:ARR|MRR|QUOTA)[\s:]?\$?[0-9,.]+[KM]?\b/gi },
            { type: 'ID', regex: /\b(?:SFDC|HUBSPOT)[-_: ]?[0-9A-Z]{15,18}\b/gi }
        ],
        'support': [
            { type: 'ID', regex: /\bTICKET[-_:# ]?[A-Z0-9]{5,10}\b/gi },
            { type: 'ID', regex: /\b(?:ZENDESK|INTERCOM|JIRA)[-_:# ]?[0-9]{4,10}\b/gi },
            { type: 'ID', regex: /\b(?:REFUND|RETURN|RMA)[-_:# ]?[A-Z0-9]{6,12}\b/gi },
            { type: 'ID', regex: /\b(?:LOYALTY|REWARDS)[-_:# ]?\d{8,12}\b/gi }
        ],
        'realestate': [
            { type: 'ID', regex: /\b(?:MLS|LIS)[- ]?\d{6,10}\b/gi },
            { type: 'ID', regex: /\bPARCEL[- ]?\d{5,15}\b/gi },
            { type: 'ID', regex: /\bTENANT[-_]ID[-_][0-9]{4,}\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:RENT|LEASE|ESCROW)[\s:]?\$[0-9,]{3,}\b/gi },
            { type: 'SECRET', regex: /\b(?:GATE|DOOR|LOBBY)[-_ ](?:CODE|PIN)[\s:]?\d{4,6}\b/gi }
        ],
        'compliance': [
            { type: 'SECRET', regex: /\b(?:GDPR|HIPAA|CCPA|SOC2|ISO27001)[-_: ]?AUDIT[-_: ]?\d{4}\b/gi },
            { type: 'SECRET', regex: /\b(?:DPA|POLICY)[-_: ]?[A-Z0-9]{5,15}\b/gi },
            { type: 'ID', regex: /\b(?:SAR|DSAR)[-_: ]?\d{4,10}\b/gi }
        ],
        'ccpa': [
            { type: 'ID', regex: /\bDL[ -]?\d{6,12}\b/gi },
            { type: 'LOCATION', regex: /\b-?\d{1,3}\.\d{4,6}[° ]?[NSns],\s*-?\d{1,3}\.\d{4,6}[° ]?[EWew]\b/g },
            { type: 'PRIVACY', regex: /\b(?:CCPA|CPRA)[-_: ]?OPT[-_ ]OUT\b/gi },
            { type: 'ID', regex: /\bACCOUNT[ -]?(?:ID|NUM|NUMBER)[:\s][A-Z0-9]{6,20}\b/gi }
        ],
        'engineering': [
            { type: 'SECRET', regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA)[A-Z0-9]{16}\b/g },
            { type: 'SECRET', regex: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g },
            { type: 'SECRET', regex: /\b(?:ghp|gho|ghu|ghs|ghr|glpat|npm|xox[baprs])[-_][A-Za-z0-9_]{10,}\b/g },
            { type: 'SECRET', regex: /\b(?:[rs]k)_(?:test|live)_[a-zA-Z0-9]{24,}\b/g },
            { type: 'SECRET', regex: /\b(sk|pk|secret|key|token|auth)(?:[-_][a-zA-Z0-9_-]{5,}|(?=[a-zA-Z0-9_-]{5,}\b)(?=[a-zA-Z_-]*[0-9])[a-zA-Z0-9_-]{5,})\b/gi },
            { type: 'SECRET', regex: /\b[a-fA-F0-9]{32,64}\b/g },
            { type: 'SECRET', regex: /\bCVE-\d{4}-\d{4,}\b/gi },
            { type: 'SECRET', regex: /\b(MD5|SHA1|SHA256)[:\s][a-f0-9]{32,64}\b/gi },
            { type: 'SECRET', regex: /\b(DB|POSTGRES|REDIS|MYSQL|AWS|SECRET|PASSWORD|TOKEN|API|KEY)[A-Z0-9_]*\s*[:=]\s*[^\s"']+\b/gi },
            { type: 'SECRET', regex: /\b(DB|POSTGRES|REDIS|MYSQL|AWS|SECRET|PASSWORD|TOKEN|API|KEY)[A-Z0-9_]*\s*[:=]\s*["']?[A-Za-z0-9_-]{10,}["']?\b/gi },
            { type: 'ID', regex: /\b[a-z0-9._-]+\/[a-z0-9._-]+:[a-z0-9._-]+\b/g },
            { type: 'ID', regex: /\b[a-fA-F0-9]{40}\b/g },
            { type: 'ID', regex: /\b[a-z0-9](?:[-a-z0-9]*[a-z0-9])?\.svc\.cluster\.local\b/g }
        ],
        'agents': [
            { type: 'ID', regex: /\b(?:AGENT|VECTOR|EMBEDDING)[-_: ]?[A-Z0-9]{8,}\b/gi },
            { type: 'ID', regex: /\bTASK[-_: ]?[A-Z0-9]{5,15}\b/gi },
            { type: 'SECRET', regex: /\b(?:SYS_PROMPT|SYSTEM_PROMPT|OPENAI_API_KEY)[-_: ]?[A-Za-z0-9_-]{10,}\b/gi }
        ],
        'academic': [
            { type: 'ID', regex: /\b(?:STUDENT|ALUMNI)[-_:# ]?[0-9]{5,10}\b/gi },
            { type: 'ID', regex: /\bCOURSE[-_:# ]?[A-Z]{3,4}[ ]?[0-9]{3,4}\b/gi },
            { type: 'ID', regex: /\b(?:FERPA|IRB)[-_:# ]?[A-Z0-9]{5,10}\b/gi },
            { type: 'ID', regex: /\bGRADE[S]?[\s:][A-DF][+-]?\b/gi }
        ],
        'creative': [
            { type: 'SECRET', regex: /\b(?:PROJECT|DRAFT|ASSET|SCRIPT|IP)[-_: ]?[0-9]{4,10}\b/gi },
            { type: 'SECRET', regex: /\b(?:SPOILER|UNRELEASED|EMBARGOED)\b/gi },
            { type: 'NAME', regex: /\b(?:GHOSTWRITER|SOURCE)[:\s][A-Z][a-z]+ [A-Z][a-z]+\b/g }
        ],
        'tech': [
            { type: 'ID', regex: /\b(?:INSTANCE|NODE|CLUSTER)[-_]ID[-_][a-z0-9-]{10,}\b/gi },
            { type: 'ID', regex: /\bENV[-_: ]?(?:PROD|STAGING|DEV|TEST|QA)\b/gi },
            { type: 'SECRET', regex: /\b(?:CONFIG|KUBECONFIG|TFSTATE)[-_: ]?[A-Z0-9]{6,15}\b/gi }
        ],
        'personal': [
            { type: 'ID', regex: /\b(?:DOB|BIRTHDAY)[\s:]*[0-9./-]{6,10}\b/gi },
            { type: 'SECRET', regex: /\b(?:PASSWORD|PWD|SECRET|PIN)[\s:]*[\S]{4,20}\b/gi },
            { type: 'PHONE', regex: /\b(?:WIFE|HUSBAND|PARTNER|MOM|DAD)[\s:]+(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/gi }
        ],
        'wealthmgmt': [
            { type: 'LEGAL', regex: /\b(?:THE\s+)?[A-Z][A-Z\s.'-]{4,}\s+(?:(?:REVOCABLE|IRREVOCABLE|LIVING|FAMILY|TESTAMENTARY|CHARITABLE|GENERATION-SKIPPING)\s+)*TRUST\b/g },
            { type: 'NAME', regex: /(?<=^|[^\p{L}\p{N}_])\p{Lu}{3,}(?:[\p{Lu}'-]*\p{Lu})?(?:[ \t\xA0]+\p{Lu}\.)*[ \t\xA0]+\p{Lu}\p{Ll}[\p{Ll}'-]*(?:\p{Lu}[\p{Ll}'-]*)?\p{L}(?:'s)?(?=[^\p{L}\p{N}_]|$)/gu },
            { type: 'FINANCIAL', regex: /\b(?:ABA|Routing(?:\s+No)?|RTN)[:\s#]*\d{9}\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:Account|Acct\.?)[:\s#]*\d{4}[-\s]?\d{4}[-\s]?\d{2,6}\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:Policy|Contract)\s*(?:No\.?|Number|#)[:\s]+[A-Z0-9][A-Z0-9\-]{3,14}\b/gi },
            { type: 'ID', regex: /\bCRD\s*#?\s*\d{4,8}\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:Annual\s+(?:Distribution|Withdrawal)|RMD|Required\s+Minimum\s+Distribution)[:\s]+[$][\d,]+(?:[.][\d]{2})?\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:Portfolio|Market\s+Value|Net\s+Worth|AUM|Total\s+Assets)[:\s]+[$][\d,.]+[KMB]?\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:Roth\s+)?(?:IRA|401k|401\(k\)|403b|403\(b\)|SEP|SIMPLE)\s*(?:Account|Acct|Plan)?\s*(?:No|Number|#)?[:\s#]*[A-Z0-9]{4,15}\b/gi }
        ],
        'insurance': [
            { type: 'ID', regex: /\b(?:Claim|CLM)[:\s#-]*[A-Z0-9]{6,15}\b/gi },
            { type: 'ID', regex: /\b(?:Policy|POL)[:\s#-]*[A-Z]{0,4}[-]?\d{6,12}\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:Loss|Claim\s+Amount|Settlement|Reserve|Indemnity)[:\s]+[$][\d,]+(?:[.]\d{2})?\b/gi },
            { type: 'ID', regex: /\b(?:Adjuster\s+(?:ID|No)|Claim\s+Rep(?:\.|resentative)?)[:\s#]*[A-Z0-9]{4,12}\b/gi },
            { type: 'ID', regex: /\bNAIC[:\s#]*\d{5}\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:Deductible|Premium|Coverage\s+Amount)[:\s]+[$][\d,]+(?:[.]\d{2})?\b/gi },
            { type: 'ID', regex: /\b[A-HJ-NPR-Z0-9]{17}\b/g },
            { type: 'ID', regex: /\b(?:Insured|Named\s+Insured)[:\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g },
            { type: 'ID', regex: /\b(?:Agent|Producer)\s*(?:Code|No|ID)[:\s#]*[A-Z0-9]{4,12}\b/gi }
        ],
        'accounting': [
            { type: 'ID', regex: /\b(?:EIN|FEIN|Tax\s+ID)[:\s#]*\d{2}-\d{7}\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:AGI|Adjusted\s+Gross\s+Income|Taxable\s+Income|Total\s+Income)[:\s]+[$][\d,]+(?:[.]\d{2})?\b/gi },
            { type: 'FINANCIAL', regex: /\bBox\s+\d{1,2}[a-z]?[:\s]+[$][\d,]+(?:[.]\d{2})?\b/gi },
            { type: 'ID', regex: /\b(?:Form|Schedule)\s+(?:1040|1040-SR|W-2|W-4|1099-[A-Z]{1,4}|K-1|941|990|4562)\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:Federal|State)\s+(?:Tax\s+)?(?:Refund|Amount\s+Owed|Balance\s+Due)[:\s]+[$][\d,]+(?:[.]\d{2})?\b/gi },
            { type: 'ID', regex: /\b(?:State\s+Tax\s+ID|SUI|UI\s+Account\s+No)[:\s#]*[A-Z]{0,3}[-]?\d{4,15}\b/gi },
            { type: 'FINANCIAL', regex: /\b(?:Net\s+Pay|Gross\s+Pay|Taxable\s+Wages)[:\s]+[$][\d,]+(?:[.]\d{2})?\b/gi },
            { type: 'ID', regex: /\b(?:CAF|Practitioner\s+(?:PIN|ID)|PTIN)[:\s#]*[A-Z]?\d{6,9}\b/gi }
        ],
        'pharma': [
            { type: 'ID', regex: /\b(?:Subject|Patient|Participant)\s+(?:ID|No)[:\s#]*[A-Z0-9]{3,12}\b/gi },
            { type: 'ID', regex: /\b(?:Protocol|Study)\s*(?:No|Number|ID)[:\s#]*[A-Z0-9][-A-Z0-9]{3,15}\b/gi },
            { type: 'ID', regex: /\b(?:IND|NDA|BLA|ANDA)\s*(?:No|Number|#)?[:\s]*\d{3,6}\b/gi },
            { type: 'ID', regex: /\bIRB[:\s#]*[A-Z0-9]{4,12}\b/gi },
            { type: 'ID', regex: /\b(?:Site\s+(?:No|ID)|Investigator\s+Site)[:\s#]*\d{3,6}\b/gi },
            { type: 'ID', regex: /\b(?:Batch|Lot|Serial)\s*(?:No[.]?|Number|#)?[:\s#]*[A-Z0-9][A-Z0-9\-]{3,14}\b/gi },
            { type: 'PHI', regex: /\b(?:Dose|Dosage)[:\s]+\d+(?:\.\d+)?\s*(?:mg|mcg|mL|IU|units?)\b/gi },
            { type: 'ID', regex: /\b(?:CRF|eCRF|Case\s+Report\s+Form)\s*(?:No|Page|ID)?[:\s#]*[A-Z0-9]{2,10}\b/gi }
        ]
    };
    let NAME_STOP_LIST = new Set([
        'case no',
        'account no',
        'client no',
        'ref no',
        'matter no',
        'affected user',
        'incident date',
        'incident type',
        'incident report',
        'review period',
        'review date',
        'salary band',
        'salary range',
        'personal email',
        'work email',
        'business email',
        'lead source',
        'account exec',
        'account executive',
        'next appt',
        'next appointment',
        'last appt',
        'chief complaint',
        'portfolio value',
        'portfolio manager',
        'tax id',
        'account number',
        'employee id',
        'social security',
        'date of',
        'date of birth',
        'place of birth',
        'hiring manager',
        'direct report',
        'team lead',
        'team leader',
        'job title',
        'job function',
        'pay grade',
        'review type',
        'performance review',
        'annual review',
        'invoice number',
        'purchase order',
        'order number',
        'oak street',
        'main street',
        'high street',
        'park avenue',
        'first street',
        'second street',
        'third street',
        'north avenue',
        'south avenue',
        'east side',
        'west side',
        'soc team',
        'hr team',
        'it team',
        'qa team',
        'ux team',
        'new york',
        'los angeles',
        'san francisco',
        'las vegas',
        'united states',
        'united kingdom',
        'north america',
        'south america',
        'senior analyst',
        'senior engineer',
        'senior manager',
        'senior consultant',
        'junior analyst',
        'junior engineer',
        'junior developer',
        'vice president',
        'chief executive',
        'chief officer',
        'account manager',
        'project manager',
        'product manager',
        'security officer',
        'compliance officer',
        'general hospital',
        'medical center',
        'urgent care',
        'primary care',
        'read more',
        'learn more',
        'click here',
        'sign up',
        'log in',
        'privacy policy',
        'terms of',
        'terms of service',
        'true positive',
        'false positive',
        'open source',
        'private identifiers',
        'data privacy',
        'system instruction',
        'system instructions',
        'critical',
        'instruction',
        'user data',
        'protected user',
        'privacy scrubber',
        'end of',
        'thank you',
        'best regards',
        'kind regards',
        'warm regards',
        'yours truly',
        'sincerely yours',
        'good morning',
        'good afternoon',
        'good evening',
        'hello world',
        'hello there',
        'supreme court',
        'high court',
        'district court',
        'civil court',
        'non disclosure',
        'data protection',
        'intellectual property',
        'trade secret',
        'force majeure',
        'habeas corpus',
        'amicus curiae',
        'board member',
        'board meeting',
        'general assembly',
        'first name',
        'last name',
        'middle name',
        'full name',
        'email address',
        'phone number',
        'cell phone',
        'home phone',
        'zip code',
        'postal code',
        'page number',
        'section one',
        'table contents',
        'table of',
        'figure one',
        'marketing department',
        'sales department',
        'engineering team',
        'product team',
        'customer support',
        'human resources',
        'public relations',
        'artificial intelligence',
        'machine learning',
        'deep learning',
        'large language',
        'operating system',
        'source code',
        'user interface',
        'web browser',
        'pull request',
        'merge request',
        'commit message',
        'code review',
        'cloud computing',
        'database schema',
        'blood pressure',
        'heart rate',
        'chief physician',
        'treating physician',
        'health care',
        'healthcare provider',
        'medical record',
        'grade a',
        'grade b',
        'grade c',
        'grade d',
        'grade f',
        'version 1',
        'version 2',
        'version 3',
        'version 4',
        'version 5',
        'step 1',
        'step 2',
        'step 3',
        'step 4',
        'step 5',
        'page 1',
        'page 2',
        'page 3',
        'page 4',
        'page 5',
        'cs101',
        'course cs101',
        'january',
        'february',
        'march',
        'april',
        'may',
        'june',
        'july',
        'august',
        'september',
        'october',
        'november',
        'december',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
        'yesterday',
        'tomorrow',
        'today',
        'last week',
        'next month',
        'early morning',
        'late night',
        'microsoft office',
        'google workspace',
        'slack channel',
        'zoom meeting',
        'teams call',
        'amazon prime',
        'netflix show',
        'youtube video',
        'twitter post',
        'linkedin profile',
        'central park',
        'white house',
        'grand canyon',
        'mount everest',
        'pacific ocean',
        'atlantic ocean',
        'silicon valley',
        'wall street',
        'fifth avenue',
        'times square',
        'golden gate',
        'empire state',
        'statue liberty',
        'tower bridge',
        'big ben',
        'eiffel tower',
        'great wall',
        'london bridge',
        'san jose',
        'las vegas',
        'mexico city',
        'hong kong',
        'san diego',
        'software development',
        'user experience',
        'front end',
        'back end',
        'full stack',
        'web application',
        'mobile app',
        'desktop app',
        'cloud services',
        'data analytics',
        'cyber security',
        'network security',
        'information security',
        'incident response',
        'disaster recovery',
        'business continuity',
        'risk management',
        'quality assurance',
        'user acceptance',
        'beta test',
        'release candidate',
        'version control',
        'continuous integration',
        'continuous deployment',
        'agile scrum',
        'kanban board',
        'sprint planning',
        'daily standup',
        'product backlog',
        'user story',
        'acceptance criteria',
        'technical debt',
        'codebase',
        'repository',
        'branch name',
        'tag version',
        'hot fix',
        'patch note',
        'legal counsel',
        'general counsel',
        'human capital',
        'talent acquisition',
        'employee benefits',
        'payroll services',
        'stock options',
        'health insurance',
        'retirement plan',
        'vacation time',
        'sick leave',
        'performance bonus',
        'commission structure',
        'sales target',
        'market share',
        'brand identity',
        'marketing campaign',
        'ad spend',
        'click rate',
        'conversion rate',
        'customer lifetime',
        'churn rate',
        'user engagement',
        'social media',
        'content strategy',
        'search engine',
        'local search',
        'organic traffic',
        'paid search',
        'email marketing',
        'press release',
        'case study',
        'white paper',
        'user guide',
        'help center',
        'frequently asked',
        'support ticket',
        'service level',
        'response time',
        'resolution time',
        'customer satisfaction',
        'net promoter',
        'user feedback',
        'product feature',
        'roadmap item',
        'beta program',
        'early access',
        'invite only',
        'project status',
        'meeting notes',
        'call transcript',
        'action items',
        'follow up',
        'best practices',
        'success stories',
        'class name',
        'function name',
        'variable name',
        'database table',
        'schema name',
        'index name',
        'query result',
        'error message',
        'warning message',
        'log entry',
        'debug log',
        'stack trace',
        'staff member',
        'team member',
        'board member',
        'board meeting',
        'committee member',
        'executive board',
        'email us',
        'contact us',
        'about us',
        'sign in',
        'sign out',
        'quarterly results',
        'strategic planning',
        'market research',
        'customer base',
        'privacy settings',
        'account settings',
        'security settings',
        'download now',
        'free trial',
        'limited time',
        'copyright protected',
        'all rights',
        'rights reserved',
        'credit score',
        'monthly rent',
        'lease application',
        'property address',
        'reference number',
        'additional identifier',
        'lease agreement',
        'hiring review',
        'candidate name',
        'lighting',
        'keyboard',
        'creating',
        'building',
        'training',
        'planning',
        'starting',
        'painting',
        'printing',
        'returned',
        'released',
        'required',
        'accepted',
        'imported',
        'services',
        'products',
        'accounts',
        'settings',
        'partners',
        'keywords',
        'keystone',
        'keyspace',
        'keynotes',
        'keychain'
    ]);
    let JARGON_WORDS = new Set([
        'step',
        'page',
        'grade',
        'version',
        'course',
        'class',
        'follow',
        'chapter',
        'lesson',
        'unit',
        'marketing',
        'manager',
        'specialist',
        'science',
        'administration',
        'university',
        'skills',
        'leadership',
        'communication',
        'working',
        'proficiency',
        'decision',
        'driven',
        'experience',
        'summary',
        'bachelor',
        'ads',
        'solutions',
        'positioning',
        'acquisition',
        'strategy',
        'research',
        'database',
        'forecast',
        'interest',
        'prepared',
        'merchant',
        'document',
        'feedback',
        'template',
        'campaign',
        'partners',
        'settings',
        'keystone'
    ]);
    let NOT_NAME_WORDS = new Set([
        'the',
        'a',
        'an',
        'this',
        'that',
        'these',
        'those',
        'my',
        'your',
        'his',
        'her',
        'their',
        'our',
        'its',
        'it',
        'he',
        'she',
        'they',
        'we',
        'i',
        'you',
        'who',
        'whom',
        'which',
        'what',
        'whose',
        'why',
        'how',
        'when',
        'where',
        'with',
        'for',
        'from',
        'by',
        'to',
        'at',
        'in',
        'on',
        'of',
        'about',
        'as',
        'into',
        'through',
        'during',
        'before',
        'after',
        'above',
        'below',
        'and',
        'but',
        'or',
        'so',
        'yet',
        'hello',
        'hi',
        'hey',
        'dear',
        'greetings',
        'summary',
        'experience',
        'education',
        'skills',
        'languages',
        'project',
        'history',
        'background',
        'objective',
        'profile',
        'awards',
        'honors',
        'certifications',
        'publications',
        'interests',
        'references',
        'manager',
        'director',
        'specialist',
        'analyst',
        'engineer',
        'developer',
        'consultant',
        'officer',
        'representative',
        'agent',
        'lead',
        'leader',
        'president',
        'coordinator',
        'admin',
        'administrator',
        'executive',
        'founder',
        'partner',
        'intern',
        'trainee',
        'advisor',
        'head',
        'vp',
        'chief',
        'marketing',
        'sales',
        'engineering',
        'finance',
        'accounting',
        'legal',
        'operations',
        'support',
        'recruiting',
        'talent',
        'acquisition',
        'compliance',
        'security',
        'technical',
        'development',
        'product',
        'design',
        'creative',
        'strategy',
        'planning',
        'analytics',
        'science',
        'business',
        'administration',
        'google',
        'ads',
        'analytics',
        'meta',
        'hubspot',
        'crm',
        'salesforce',
        'wordpress',
        'mailchimp',
        'adobe',
        'figma',
        'canva',
        'slack',
        'zoom',
        'teams',
        'microsoft',
        'office',
        'excel',
        'word',
        'powerpoint',
        'notion',
        'jira',
        'confluence',
        'github',
        'gitlab',
        'aws',
        'azure',
        'cloud',
        'database',
        'sql',
        'python',
        'java',
        'javascript',
        'html',
        'css',
        'react',
        'node',
        'api',
        'saas',
        'b2b',
        'b2c',
        'url',
        'domain',
        'website',
        'app',
        'application',
        'software',
        'email',
        'phone',
        'contact',
        'address',
        'bachelor',
        'master',
        'doctor',
        'associate',
        'degree',
        'university',
        'college',
        'school',
        'institute',
        'academy',
        'graduated',
        'major',
        'minor',
        'gpa',
        'cum',
        'laude',
        'honors',
        'deans',
        'list',
        'scholarship',
        'results',
        'driven',
        'oriented',
        'expert',
        'professional',
        'proven',
        'track',
        'record',
        'creative',
        'excellent',
        'communication',
        'verbal',
        'written',
        'native',
        'fluent',
        'bilingual',
        'working',
        'proficiency',
        'strategic',
        'interpersonal',
        'teamwork',
        'organizational',
        'detail',
        'analytical',
        'results-driven',
        'data-driven',
        'customer-centric',
        'detail-oriented',
        'cross-functional',
        'self-motivated',
        'time-management',
        'problem-solving',
        'fast-paced',
        'year-over-year',
        'trust',
        'trustee',
        'co-trustee',
        'settlor',
        'grantor',
        'beneficiary',
        'agreement',
        'will',
        'estate',
        'witness',
        'declaration',
        'signatory',
        'testator',
        'notary',
        'commission',
        'county',
        'state',
        'court',
        'article',
        'section',
        'paragraph',
        'schedule',
        'exhibit',
        'amendment',
        'addendum',
        'power',
        'attorney',
        'guardian',
        'executor',
        'administrator',
        'survivor',
        'predecessor',
        'successor',
        'whereof',
        'hereby',
        'thereby',
        'herein',
        'therein',
        'witnesseth',
        'whereas',
        'therefore',
        'now',
        'dated',
        'effective',
        'california',
        'texas',
        'florida',
        'york',
        'illinois',
        'pennsylvania',
        'ohio',
        'georgia',
        'michigan',
        'carolina',
        'virginia',
        'washington',
        'arizona',
        'massachusetts',
        'tennessee',
        'indiana',
        'maryland',
        'missouri',
        'wisconsin',
        'colorado',
        'minnesota',
        'alabama',
        'louisiana',
        'kentucky',
        'oregon',
        'oklahoma',
        'connecticut',
        'utah',
        'iowa',
        'nevada',
        'arkansas',
        'mississippi',
        'kansas',
        'new mexico',
        'nebraska',
        'idaho',
        'hawaii',
        'maine',
        'new hampshire',
        'rhode island',
        'montana',
        'delaware',
        'south dakota',
        'north dakota',
        'alaska',
        'vermont',
        'wyoming'
    ]);
    // --- END DEFAULT RULES ---

    /**
     * Runtime Initialization for dynamic rule synchronization.
     * @param {Object} config - { regexes, profiles, names }
     */
    function init(config) {
        if (!config) return;
        
        // Re-hydrate regex objects if they came from JSON storage as strings
        const hydrateRegex = (rule) => {
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
        };

        if (config.regexes) {
            REGEX_RULES = config.regexes.map(hydrateRegex);
        }
        
        if (config.profiles) {
            PROFILE_RULES = {};
            for (const [profile, rules] of Object.entries(config.profiles)) {
                PROFILE_RULES[profile] = rules.map(hydrateRegex);
            }
        }

        if (config.names) NAME_STOP_LIST = new Set(config.names);
        
        if (typeof window !== 'undefined' && window.PrivacyScrubberCore) {
            window.PrivacyScrubberCore.isInitialized = true;
        }
    }

// Stitcher runs for ALL profiles — LEGAL_STARTERS guard prevents false positives.

// Signal A: line ends with a name fragment (all-caps or mixed-case caps word or initial+dot)
// e.g. "KKKKK I.", "John I.", "JOHNSON", or "Johnson"
const RE_LINE_ENDS_AS_NAME = /(?:^|[ ,])(?:[A-Z]{2,}(?:[A-Z'-]*[A-Z])?|[A-Z][a-z]+(?:[' -][A-Z][a-z]+)*)(?:\s+[A-Z]\.)*\s*$/m;

// Signal B: next line starts with a surname (all-caps or mixed-case) — supports short surnames (e.g. Li, Wu)
const RE_LINE_STARTS_AS_SURNAME = /^(?:[A-Z][a-z]+(?:[A-Za-z'-]*)?|[A-Z]{2,}(?:[A-Z'-]*)?)(?:[,\s]|$)/;

// Signal C: line is exactly a middle initial + optional dot
const RE_MIDDLE_INITIAL = /^[A-Z]\.?,?\s*$/;

// Guard: if next line starts with one of these words, it is a legal/structural paragraph
// starter — NOT a surname. Skip stitching to avoid false positives.
const LEGAL_STARTERS = new Set([
    // Mixed-case legal clause starters
    'Wherein','That','This','The','Said','Dated','Whereas','Now','Therefore',
    'Hereby','Herein','Hereto','Herewith','Hereafter','Upon','Pursuant',
    'Between','Among','Under','Within','Without','During','After','Before',
    'Each','Any','All','Such','Both','Either','Neither','No','Not','If','When',
    // ALL-CAPS equivalents (trust/deed documents often use all-caps paragraphs)
    'WHEREIN','THAT','THIS','WHEREAS','NOW','THEREFORE','HEREBY','HEREIN',
    'PURSUANT','BETWEEN','AMONG','UNDER','DURING','AFTER','BEFORE',
    'TRUST','AGREEMENT','DEED','SCHEDULE','EXHIBIT','ARTICLE','SECTION'
]);

function stitchOrphanedNameLines(text, profile) {
    // Only run on multi-line text (single-line paste has nothing to stitch)
    if (!text.includes('\n')) return text;
    const lines = text.split('\n');
    if (lines.length < 2) return text;
    const result = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const next1 = lines[i + 1];
        const next2 = lines[i + 2];

        // 1. Try 3-line stitch first: Firstname \n MiddleInitial \n Surname
        if (next1 !== undefined && next2 !== undefined &&
            RE_LINE_ENDS_AS_NAME.test(line) &&
            RE_MIDDLE_INITIAL.test(next1.trim()) &&
            RE_LINE_STARTS_AS_SURNAME.test(next2.trimStart())) {
            
            const firstWord = (next2.trimStart().match(/^[A-Za-z]+/) || [''])[0];
            if (LEGAL_STARTERS.has(firstWord)) {
                result.push(line);
                i++;
            } else {
                result.push(line.trimEnd() + ' ' + next1.trim() + ' ' + next2.trimStart());
                i += 3;
            }
        } 
        // 2. Fall back to 2-line stitch
        else if (next1 !== undefined && RE_LINE_ENDS_AS_NAME.test(line) && RE_LINE_STARTS_AS_SURNAME.test(next1.trimStart())) {
            const firstWord = (next1.trimStart().match(/^[A-Za-z]+/) || [''])[0];
            if (LEGAL_STARTERS.has(firstWord)) {
                result.push(line);
                i++;
            } else {
                result.push(line.trimEnd() + ' ' + next1.trimStart());
                i += 2;
            }
        } else {
            result.push(line);
            i++;
        }
    }
    return result.join('\n');
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
function scrubText(text, customRules = [], tokenLabelMap = {}, profile = 'General', existingSessionMap = {}) {
    if (!text) return { scrubbedText: "", tokenMap: {}, count: 0, uniqueUnmasked: new Set() };
    
    // Stitch PDF-split name fragments across line breaks (all profiles)
    text = stitchOrphanedNameLines(text, profile);
    
    // Protect system prompt from being scrubbed or counted
    let extractedSystemPrompt = "";
    let textToProcess = text.replace(/[\u200b\u200c\u200d\ufeff]/g, '');
    
    // Split attached table labels/headers (e.g. Sarah MitchellEmail: -> Sarah Mitchell Email:)
    // Specifically matches a letter followed directly by field names and a colon
    textToProcess = textToProcess.replace(/([a-zA-Z])(Email|Phone|Mobile|Tel|Address|IP|ID|URL|SSN|Date):/g, '$1 $2:');
    
    const sysMarker = "[Privacy Scrubber Mode]";
    const oldMarker = "[SYSTEM INSTRUCTION: DATA PRIVACY MODE]";
    const newMarker = "[Context: identifiers";
    if (textToProcess.includes(sysMarker) || textToProcess.includes(oldMarker) || textToProcess.includes(newMarker)) {
        const sysPromptRegex = /(?:----------------------\s*)?(?:\[SYSTEM INSTRUCTION: DATA PRIVACY MODE\]|\[Privacy Scrubber Mode\]|\[Context: identifiers)[\s\S]*/;
        const match = textToProcess.match(sysPromptRegex);
        if (match) {
            extractedSystemPrompt = match[0];
            textToProcess = textToProcess.replace(sysPromptRegex, '');
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
    let matches = [];

    // Custom rules (PRO) — sorted longest pattern first to prevent partial matches
    if (customRules && customRules.length > 0) {
        const sorted = [...customRules].sort((a, b) => {
            const patternA = typeof a === 'string' ? a : a.pattern;
            const patternB = typeof b === 'string' ? b : b.pattern;
            return patternB.length - patternA.length;
        });
        
        sorted.forEach(cr => {
            const pattern = typeof cr === 'string' ? cr : cr.pattern;
            const label = typeof cr === 'string' ? 'CUSTOM' : (cr.label || 'CUSTOM');
            
            let rx;
            try {
                // If it looks like exact text (no regex boundaries/quantifiers), escape it
                const isExact = !/(\^|\$|\\[bBdDwWsS]|\[|\(|\{|\*|\+|\|)/.test(pattern);
                if (isExact) {
                    const safe = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    rx = new RegExp(`(?:^|\\b)${safe}(?:\\b|$)`, 'gi');
                } else {
                    rx = new RegExp(pattern, 'gi');
                }
            } catch (e) {
                console.warn('Invalid custom regex pattern:', pattern);
                return;
            }

            let m;
            // Prevent infinite loops from 0-length regex matches
            if (rx.test('')) return;
            rx.lastIndex = 0;
            
            while ((m = rx.exec(textToProcess)) !== null) {
                matches.push({ start: m.index, end: m.index + m[0].length, value: m[0], type: 'CUSTOM', customLabel: label });
            }
        });
    }

    // Combine built-in regex rules with profile rules.
    // PROFILE_ALIAS_MAP: normalizes popup.html dropdown values to PROFILE_RULES keys.
    // Popup has display names like 'Medical', 'Engineering', 'Bizops' etc. — these must
    // map to the canonical keys used in PROFILE_RULES (loaded from ps_rules_cache).
    // Any unrecognized profile silently falls back to General (base REGEX_RULES only).
    const PROFILE_ALIAS_MAP = {
        // Healthcare
        'medical':     'medical',
        'healthcare':  'medical',
        'health':      'medical',
        'pharma':      'pharma',
        // Engineering / Dev
        'engineering': 'engineering',
        'dev':         'engineering',
        'tech':        'tech',
        // Finance
        'finance':     'finance',
        'bizops':      'bizops',
        'sales':       'sales',
        'wealthmgmt':  'wealthmgmt',
        'insurance':   'insurance',
        'accounting':  'accounting',
        // Legal
        'legal':       'legal',
        'compliance':  'compliance',
        'ccpa':        'ccpa',
        // HR
        'hr':          'hr',
        // Security
        'security':    'security',
        // Marketing / Support
        'marketing':   'marketing',
        'support':     'support',
    };
    let activeRules = [...REGEX_RULES];

    // Node.js local license key validation enforcement (ZTDS Compliance)
    if (typeof process !== 'undefined' && process.env && typeof require === 'function' && profile && profile.toLowerCase() !== 'general') {
        try {
            const key = (process.env.PRIVACYSCRUBBER_KEY || "").trim();
            let isPro = false;
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
                            isPro = true;
                        }
                    }
                }
            }
            if (!isPro) {
                profile = 'General';
            }
        } catch (e) {
            profile = 'General';
        }
    }

    if (profile && profile.toLowerCase() !== 'general') {
        const rawKey = profile.toLowerCase();
        // Resolve alias (undefined = key not in map at all → treat as General)
        const resolvedKey = PROFILE_ALIAS_MAP.hasOwnProperty(rawKey)
            ? PROFILE_ALIAS_MAP[rawKey]
            : rawKey;  // pass-through for direct keys like 'health', 'finance', 'hr', 'legal', 'dev'
        if (resolvedKey && PROFILE_RULES[resolvedKey]) {
            activeRules = [...PROFILE_RULES[resolvedKey], ...activeRules];
        }
    }
    

    activeRules.forEach(rule => {
        // Apply Detection Profiles Logic
        const isDevProfile = (profile === 'Dev' || profile.toLowerCase() === 'engineering' || profile.toLowerCase() === 'security');
        if (isDevProfile && rule.type === 'NAME' && !rule.isContextName) return; // Dev/Security profiles don't protect function names
        
        // Option 2.2: Disable aggressive 2-word capitalized name matching for all specialized profiles
        if (profile && profile.toLowerCase() !== 'general' && rule.isAggressiveName) return;
        
        rule.regex.lastIndex = 0;
        let m;
        
        while ((m = rule.regex.exec(textToProcess)) !== null) {
            let matchedText = m[0];
            let start = m.index;
            let end = m.index + matchedText.length;

            // Context-anchored name: match[1] is the name, match[0] includes the prefix anchor
            if (rule.isContextName && m[1]) {
                const nameStart = m.index + m[0].indexOf(m[1]);
                start = nameStart;
                matchedText = m[1];
                end = nameStart + matchedText.length;
            }
            
            if (rule.type === 'NAME') {
                let words = matchedText.split(/[ \t\xA0]+/);
                
                // Trim leading stop words/jargon words
                while (words.length >= 2 && (NOT_NAME_WORDS.has(words[0].toLowerCase()) || JARGON_WORDS.has(words[0].toLowerCase()))) {
                    const removedWord = words.shift();
                    const prefixLength = removedWord.length + (matchedText.slice(removedWord.length).match(/^[ \t\xA0]+/)?.[0]?.length || 0);
                    start += prefixLength;
                    matchedText = matchedText.slice(prefixLength);
                }
                
                // Trim trailing stop words/jargon words
                while (words.length >= 2 && (NOT_NAME_WORDS.has(words[words.length - 1].toLowerCase()) || JARGON_WORDS.has(words[words.length - 1].toLowerCase()))) {
                    const removedWord = words.pop();
                    const suffixLength = removedWord.length + (matchedText.slice(0, matchedText.length - removedWord.length).match(/[ \t\xA0]+$/)?.[0]?.length || 0);
                    end -= suffixLength;
                    matchedText = matchedText.slice(0, matchedText.length - suffixLength);
                }
                
                if (words.length < 2) {
                    continue;
                }
                
                // Final validation: check if any remaining words are stop/jargon words
                if (words.some(w => NOT_NAME_WORDS.has(w.toLowerCase()) || JARGON_WORDS.has(w.toLowerCase()))) {
                    continue;
                }
                const val = matchedText.toLowerCase().trim();
                if (NAME_STOP_LIST.has(val)) {
                    continue;
                }
                
                matches.push({ start, end, value: matchedText, type: rule.type });
            } else {
                const val = matchedText.toLowerCase().trim();
                if (NAME_STOP_LIST.has(val)) {
                    continue;
                }
                const words = val.split(/\s+/);
                if (words.some(w => JARGON_WORDS.has(w))) {
                    continue;
                }
                matches.push({ start, end, value: matchedText, type: rule.type });
            }
        }
    });

    /* --- Dynamic Name Learning Phase --- */
    const learnedNames = new Set();
    matches.forEach(m => {
        if (m.type === 'NAME') {
            const nameWords = m.value.split(/[^\p{L}'-]+/u);
            nameWords.forEach(w => {
                if (w && w.length >= 2 && /^\p{Lu}/u.test(w)) {
                    const wl = w.toLowerCase();
                    if (!NOT_NAME_WORDS.has(wl) && !JARGON_WORDS.has(wl) && !NAME_STOP_LIST.has(wl)) {
                        learnedNames.add(w);
                    }
                }
            });
        }
    });

    if (learnedNames.size > 0) {
        learnedNames.forEach(name => {
            const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp(`(?<=^|[^\\p{L}\\p{N}_])${safeName}(?=[^\\p{L}\\p{N}_]|$)`, 'gu');
            let m;
            while ((m = rx.exec(text)) !== null) {
                const exists = matches.some(existing => existing.start <= m.index && existing.end >= m.index + m[0].length);
                if (!exists) {
                    matches.push({ start: m.index, end: m.index + m[0].length, value: m[0], type: 'NAME' });
                }
            }
        });
    }

    // Sort by start, prefer longer matches, remove overlaps
    
    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    let filtered = [];
    let lastEnd = 0;
    matches.forEach(m => {
        if (m.start >= lastEnd) { filtered.push(m); lastEnd = m.end; }
    });

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

    // Replace from end → start (preserves string indices while mutating result)
    const rightToLeft = [...filtered].sort((a, b) => b.start - a.start);
    let result = textToProcess;
    rightToLeft.forEach(m => {
        result = result.substring(0, m.start) + m.token + result.substring(m.end);
    });

    return {
        scrubbedText: extractedSystemPrompt + result,
        tokenMap: sessionMap,
        count: Object.keys(sessionMap).length,
        uniqueUnmasked: uniqueUnmasked
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

function buildRestorationRegexAndRules(tokenMap) {
    const keys = Object.keys(tokenMap);
    if (keys.length === 0) {
        return { compositeRegex: null, looseRules: [] };
    }

    const sortedKeys = [...keys].sort((a, b) => {
        const innerA = a.replace(/^\[|\]$/g, '');
        const innerB = b.replace(/^\[|\]$/g, '');
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
        const inner = k.replace(/^\[|\]$/g, '');
        const match = inner.match(/^([A-Za-z_0-9]+?)[-_]?(\d+)$/);
        if (match) {
            const label = match[1];
            const baseIndex = parseInt(match[2], 10);
            const aliases = getLabelAliases(label);
            
            const escapedAliases = aliases.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            const aliasesGroup = `(?:${escapedAliases.join('|')})`;
            
            const looseRegex = '\\[?\\s*' + aliasesGroup + '[-_\\s]*0*' + baseIndex + '\\s*\\]?';
            looseRules.push({ patternStr: looseRegex, originalKey: k });
            regexParts.push(looseRegex);
        } else {
            const safe = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            looseRules.push({ patternStr: safe, originalKey: k });
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
function cleanAIPromptPrefix(text) {
    if (!text) return "";
    let cleaned = text.replace(/^\s*(Claude responded|Claude|ChatGPT|Gemini|Grok|DeepSeek|Kimi|Copilot|Assistant|User)\s*(?::|\bsaid\b|\bresponded\b)\s*/i, "");
    cleaned = cleaned.replace(/^\s*Edit\s*\n+/i, "");
    cleaned = cleaned.replace(/\s*\bEdit\s+in\s+a\s+page\b\s*$/i, "");
    return cleaned;
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
    
    const { compositeRegex, looseRules } = buildRestorationRegexAndRules(tokenMap);
    if (compositeRegex) {
        text = text.replace(compositeRegex, (match) => {
            restoredCount++;
            let origKey = match;
            for (const rule of looseRules) {
                if (new RegExp('^' + rule.patternStr + '$', 'i').test(match)) {
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
    
    const { compositeRegex, looseRules } = buildRestorationRegexAndRules(tokenMap);
    if (compositeRegex) {
        text = text.replace(compositeRegex, (match) => {
            restoredCount++;
            let origKey = match;
            for (const rule of looseRules) {
                if (new RegExp('^' + rule.patternStr + '$', 'i').test(match)) {
                    origKey = rule.originalKey;
                    break;
                }
            }
            const rawVal = tokenMap[origKey] || match;
            const safeVal = rawVal.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c] || c));
            return `<span class="ps-restored-data" title="Restored by PrivacyScrubber" style="border-bottom: 2px dashed #10b981; color: inherit; cursor: help; padding-bottom: 1px; font-weight: 500; text-shadow: 0 0 5px rgba(16, 185, 129, 0.2);">${safeVal}</span>`;
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
    function scrubDataInDOM(rootElement, customRules, globalTokenLabels, activeProfile, existingSessionMap, detectOnly = false) {
        if (!rootElement) return null;

        // ── TEXTAREA / INPUT fast path ────────────────────────────────────────
        // Native <textarea> and <input> store their content in .value — it is
        // NOT a child text node, so createTreeWalker finds nothing and always
        // returns count=0.  Handle them directly here.
        if (rootElement.tagName === 'TEXTAREA' || rootElement.tagName === 'INPUT') {
            const text = rootElement.value || '';
            if (!text.trim()) return { count: 0, tokenMap: existingSessionMap || {} };
            const result = scrubText(text, customRules, globalTokenLabels, activeProfile, existingSessionMap || {});
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
            const fullResult = scrubText(fullText, customRules, globalTokenLabels, activeProfile, existingSessionMap || {});
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
            const result = scrubText(originalText, customRules, globalTokenLabels, activeProfile, globalTokenMap);
            
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
            const root = el.getRootNode();
            if (root instanceof ShadowRoot && root.host) {
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
                                // NOTE: We intentionally do NOT check textContent for
                                // '[Privacy Scrubber Mode]' at the element level because
                                // textContent aggregates ALL descendant text. A parent
                                // container (like <main>) would match the user prompt's
                                // instruction block and skip the entire subtree including
                                // AI responses. The instruction check is only safe at the
                                // TEXT_NODE level where parentElement scope is narrow.
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
                span.title = 'Decrypted Locally. LLMs cannot see this.';
                Object.assign(span.style, {
                    borderBottom: '2px dashed #10b981',
                    color: '#10b981',
                    cursor: 'help',
                    paddingBottom: '1px',
                    fontWeight: '500',
                    position: 'relative',
                    zIndex: '1',
                    textShadow: '0 0 5px rgba(16, 185, 129, 0.2)'
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
            const activeInput = inputs.find(el => el.offsetParent !== null && el.offsetHeight > 0 && !el.closest('.ps-toolbar-container'));
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
                const isVisible = (el.offsetParent !== null && el.offsetHeight > 0) || (rect && rect.height > 0 && rect.width > 0);
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

            if (validResponses.length > 0) {
                // Return the text of the very last valid response on the page.
                // De-ancestor: if element A contains element B (both matched), prefer B (more specific).
                const leafResponses = validResponses.filter((el, _, arr) =>
                    !arr.some(other => other !== el && el.contains(other))
                );
                const candidates = leafResponses.length > 0 ? leafResponses : validResponses;
                const lastLeaf = candidates[candidates.length - 1];

                // MULTI-LEAF AGGREGATION (fixes Copilot partial response):
                // When multiple leaf elements exist, check if they share a close ancestor
                // within 2 DOM levels of the last leaf. If yes, use the ancestor's full text
                // (groups same-message paragraphs). Depth limit of 2 prevents merging Kimi's
                // separate user + AI message elements whose common ancestor is 4+ levels up.
                let found = false;
                if (candidates.length > 1) {
                    let probe = lastLeaf.parentElement;
                    for (let depth = 0; depth < 2 && probe; depth++) {
                        if (activeInput && probe.contains(activeInput)) break;
                        if (probe.tagName === 'BODY') break;
                        const contained = candidates.filter(el => probe.contains(el));
                        if (contained.length >= 2) {
                            outputText = probe.innerText || probe.textContent || '';
                            found = true;
                            break;
                        }
                        probe = probe.parentElement;
                    }
                }
                if (!found) {
                    outputText = lastLeaf.innerText || lastLeaf.textContent || '';
                }
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
    function getRules(profile = 'General') {
        let activeRules = [...REGEX_RULES];
        if (profile && profile.toLowerCase() !== 'general') {
            // Apply same alias map as scrubText() for consistency
            const ALIAS = {
                'medical': 'medical', 'healthcare': 'medical',
                'engineering': 'engineering', 'security': 'security',
                'bizops': 'finance', 'sales': 'finance',
                'compliance': 'legal',
            };
            const rawKey = profile.toLowerCase();
            const resolvedKey = ALIAS[rawKey] || rawKey;
            if (resolvedKey && PROFILE_RULES[resolvedKey]) {
                activeRules = [...PROFILE_RULES[resolvedKey], ...activeRules];
            }
        }
        return activeRules;
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
            { id: 'General', label: 'General' },
            { id: 'Engineering', label: 'Engineering' },
            { id: 'Finance', label: 'Finance' },
            { id: 'Legal', label: 'Legal' },
            { id: 'Medical', label: 'Healthcare' },
            { id: 'HR', label: 'HR' }
        ];

        chrome.storage.local.get(['ps_active_profile', 'ps_is_pro', 'ps_is_teams'], (data) => {
            const activeProfile = data.ps_active_profile || 'General';
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
                if (p.id === activeProfile) item.classList.add('active');
                
                let labelText = p.label;
                item.innerText = labelText;

                if (!isPro && p.id !== 'General') {
                    item.style.opacity = '0.5';
                    item.style.cursor = 'not-allowed';
                    item.title = 'PRO Feature';
                    item.innerText = labelText + ' 🔒';
                } else if (p.id === activeProfile) {
                    item.innerText = labelText + ' ✓';
                }

                item.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    if (!isPro && p.id !== 'General') {
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
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${filename}-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            if (window.showInPageToast) window.showInPageToast("✓ Session exported successfully", "success");
        } catch (e) {
            console.error("PrivacyScrubber Export Error:", e);
            if (window.showInPageToast) window.showInPageToast("❌ Export failed.", "error");
        }
    }

    if (typeof window !== 'undefined') {
        window.PrivacyScrubberCore = { 
            init, 
            scrubText, 
            unscrubText, 
            unscrubTextAsHTML, 
            showTeamsPassphraseModal, 
            scrubDataInDOM, 
            revealDataInDOM, 
            gatherUniversalAIContext,
            exportSessionToFile,
            getRules,
            showProfileMenu,
            cleanAIPromptPrefix,
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
    } else if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            init,
            scrubText,
            unscrubText,
            getRules,
            unscrubTextAsHTML,
            hydrateRegex,
            cleanAIPromptPrefix
        };
    }
})();

