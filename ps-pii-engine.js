/**
 * PrivacyScrubber Shared PII Engine
 * Shared between Website Worker, Chrome Extension, and MCP Server.
 * Responsible for running Regex checks, overlap resolution, and reverse scrubbing.
 */

(function() {
    if (typeof window !== 'undefined' && window.PrivacyScrubberEngine) return;

    // --- START DEFAULT RULES ---
/**
 * PrivacyScrubber Unified PII Detection Rules
 * Shared between Website Worker, Chrome Extension, and Build Pipeline.
 */

let DEVOPS_SECRETS = [
    // Secrets & API Keys
    { name: 'AWS Credentials', type: 'SECRET', regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA)[A-Z0-9]{16}\b/g },
    { name: 'JSON Web Token (JWT)', type: 'SECRET', regex: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g },
    { name: 'API Token/Key (GitHub/Slack/NPM)', type: 'SECRET', regex: /\b(?:ghp|gho|ghu|ghs|ghr|glpat|npm|xox[baprs])[-_][A-Za-z0-9_]{10,}\b/g },
    { name: 'Stripe API Key', type: 'SECRET', regex: /\b(?:[rs]k)_(?:test|live)_[a-zA-Z0-9]{24,}\b/g },
    { name: 'OpenAI Project API Key', type: 'SECRET', regex: /\b(?:sk|pk)-(?:proj-)?[a-zA-Z0-9_-]{16,}\b/gi },
    { name: 'Database Connection URI', type: 'SECRET', regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^\s"']+/gi },
    { name: 'Generic Secret/Key', type: 'SECRET', regex: /\b(sk|pk|secret|key|token|auth)(?:[-_][a-zA-Z0-9_-]{3,}|(?=[a-zA-Z0-9_-]{5,}\b)(?=[a-zA-Z_-]*[0-9])[a-zA-Z0-9_-]{5,})\b/gi },
    { name: 'Hash / Hex Key (32-64 chars)', type: 'SECRET', regex: /\b[a-fA-F0-9]{32,64}\b/g },
    { name: 'CVE Identifier', type: 'SECRET', regex: /\bCVE-\d{4}-\d{4,}\b/gi },
    { name: 'Cryptographic Hash', type: 'SECRET', regex: /\b(MD5|SHA1|SHA256)[:\s][a-f0-9]{32,64}\b/gi },
    { name: 'Database/API Secret', type: 'SECRET', regex: /\b(DB|POSTGRES|REDIS|MYSQL|AWS|SECRET|PASSWORD|TOKEN|API|KEY)[A-Z0-9_]*\s*[:=]\s*[^\s"']+\b/gi },
    { name: 'Proprietary IP / Confidential', type: 'SECRET', regex: /\b(CONFIDENTIAL|PROPRIETARY|TRADE SECRET|DO NOT DISTRIBUTE|INTERNAL USE ONLY)\b/gi },
    { name: 'Private Cryptographic Key', type: 'SECRET', regex: /-----BEGIN (?:RSA |EC |PGP |DSA )?PRIVATE KEY-----/g }
];

let REGEX_RULES = [
    ...DEVOPS_SECRETS,
    // Emails 
    { type: 'EMAIL', regex: /\b[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,}\b/g },

    // Financial Data (PCI-DSS, Bank Accounts, Direct Deposits, Cards, IBAN, SWIFT, Routing Numbers)
    { type: 'FINANCIAL', regex: /\b[A-Z]{4}(?:AD|AE|AF|AG|AI|AL|AM|AO|AQ|AR|AS|AT|AU|AW|AX|AZ|BA|BB|BD|BE|BF|BG|BH|BI|BJ|BL|BM|BN|BO|BQ|BR|BS|BT|BV|BW|BY|BZ|CA|CC|CD|CF|CG|CH|CI|CK|CL|CM|CN|CO|CR|CU|CV|CW|CX|CY|CZ|DE|DJ|DK|DM|DO|DZ|EC|EE|EG|EH|ER|ES|ET|FI|FJ|FK|FM|FO|FR|GA|GB|GD|GE|GF|GG|GH|GI|GL|GM|GN|GP|GQ|GR|GS|GT|GU|GW|GY|HK|HM|HN|HR|HT|HU|ID|IE|IL|IM|IN|IO|IQ|IR|IS|IT|JE|JM|JO|JP|KE|KG|KH|KI|KM|KN|KP|KR|KW|KY|KZ|LA|LB|LC|LI|LK|LR|LS|LT|LU|LV|LY|MA|MC|MD|ME|MF|MG|MH|MK|ML|MM|MN|MO|MP|MQ|MR|MS|MT|MU|MV|MW|MX|MY|MZ|NA|NC|NE|NF|NG|NI|NL|NO|NP|NR|NU|NZ|OM|PA|PE|PF|PG|PH|PK|PL|PM|PN|PR|PS|PT|PW|PY|QA|RE|RO|RS|RU|RW|SA|SB|SC|SD|SE|SG|SH|SI|SJ|SK|SL|SM|SN|SO|SR|SS|ST|SV|SX|SY|SZ|TC|TD|TF|TG|TJ|TK|TL|TM|TN|TO|TR|TT|TV|TW|TZ|UA|UG|UM|US|UY|UZ|VA|VC|VE|VG|VI|VN|VU|WF|WS|YE|YT|ZA|ZM|ZW)[A-Z2-9][A-NP-Z0-9](?:[A-Z0-9]{3})?\b/g },
    { type: 'FINANCIAL', regex: /\b[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{4}[0-9]{7}[a-zA-Z0-9]{0,16}\b/g },
    { type: 'FINANCIAL', regex: /\bPORTFOLIO[-_][A-Z0-9]{5,}\b/gi },
    { type: 'FINANCIAL', regex: /\b(?:\d[ -]?){13,19}\b/g },
    { type: 'FINANCIAL', regex: /\b(?:1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,39}\b/g },
    { type: 'FINANCIAL', regex: /\b0x[a-fA-F0-9]{40}\b/g },
    // Masked / Direct Deposit Bank Account Numbers & Routing Numbers
    { type: 'FINANCIAL', regex: /\b(?:Account|Acct|Checking|Savings|Direct\s+Deposit)\s*(?:#|ID|No\.?|Number)?[:\s#]*(?:[\*xX•.-]{3,}\d{2,6}|\d{4}[-\s]?\d{4}[-\s]?\d{2,6})\b/gi },
    { type: 'FINANCIAL', regex: /\b(?:ABA|Routing|RTN)\s*(?:#|ID|No\.?|Number)?[:\s#]*\d{9}\b/gi },

    // Legal & Court
    { type: 'LEGAL', regex: /\bCASE[-_][A-Z0-9_-]{4,}\b/gi },
    { type: 'LEGAL', regex: /\bMATTER[-_][A-Z0-9_-]{4,}\b/gi },
    { type: 'PRIVILEGE', regex: /ATTORNEY[- ]CLIENT[- ]PRIVILEGE/gi },

    // Professional IDs & Organizations
    { type: 'NAME', isContextName: true, regex: /\b(?:[A-Z][A-Za-z0-9&.,'-]*[ \t\xA0]+){1,5}(?:Inc\.?|LLC|Corp\.?|Corporation|Ltd\.?|Limited|Co\.?|Company|Group|Holdings|Solutions|Services|Technologies|Logistics|Industries|Capital|Bank|Partners|LLP|PLLC)(?:\s+(?:LLC|Inc\.?|Corp\.?|Ltd\.?|USA|Group))?\b/g },
    { type: 'ID', regex: /\b(?:Employee|Emp|EE|Worker|Staff|File|Badge|Member|Advisor|Producer|Agent|Borrower)\s*(?:#|ID|No\.?|Number)[:\s#]*[A-Z0-9-]{3,15}\b/gi },
    { type: 'ID', regex: /\b(?:Pay\s+Group|Cost\s+Center|Dept|Department)[:\s#]*[A-Za-z0-9_-]{2,30}\b/gi },
    { type: 'ID', regex: /(?:\b(?:Box\s+d\b|d\.\s*(?:Control|#)?|d\s+Control)\s*(?:number|no\.?|#|num)?[:\s#]*|\bControl\s*(?:number|no\.?|#|num)[:\s#]*|\bControl[:#]\s*)([A-Za-z0-9-]{3,30})/gi },
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
    { type: 'ID', regex: /\bTENANT[-_]ID[-_][0-9]{4,}\b/gi },

    // Insurance & Health Plan IDs
    { type: 'ID', regex: /\b(?:BCBS|AETNA|CIGNA|UHC|HUMANA|MEDICARE|MEDICAID)[-_A-Za-z0-9]+\b/gi },
    { type: 'ID', regex: /\b(?:Insurance|Policy|Member|Subscriber|Group|Plan|Health|Rx)[-_: ]*ID[:\s#]*([A-Za-z0-9-]+)/gi },

    // Addresses & Locations
    { type: 'ADDRESS', isContextAddress: true, regex: /(?:(?:\bBox\s+f\b|\bf\.\s*|\bf\s+(?=Employee))\s*(?:Employee(?:'s)?\s*)?(?:address[,\s]+and\s+ZIP\s+code|address)?|(?:Employee(?:'s)?\s+address[,\s]+and\s+ZIP\s+code))[\s:#]*([A-Za-z0-9#.,\s-]{4,55}?)(?=\r?\n|$|\s{3,}|\t|Box|\d+\b|1\b|2\b|Wages|Federal|Social|Medicare)/gi },
    { type: 'ADDRESS', isContextAddress: true, regex: /(?:(?:Borrower(?:'s)?|Co-Borrower(?:'s)?|Employee(?:'s)?|Employer(?:'s)?|Home|Mailing|Property|Physical)\s+address)[\s:#]+([A-Za-z0-9#.,\s-]{4,55}?)(?=\r?\n|$|\s{3,}|\t|City|State|ZIP|SSN|EIN|Phone|Box|\d+\b)/gi },
    { type: 'ADDRESS', regex: /\b\d{1,6}[ \t\xA0]+(?:[A-Za-z0-9.-]+[ \t\xA0]+){1,4}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place|Terrace|Pkwy|Parkway|Sq|Square|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Row|Pike|Box|PO Box|P\.O\.[ \t\xA0]*Box)\b(?:[ \t\xA0]*,?[ \t\xA0]*(?:Apt|Apartment|Suite|Ste|Unit|#|Fl|Floor|Bldg|Building)\.?[ \t\xA0]*[A-Za-z0-9-]+)?/gi },
    { type: 'ADDRESS', regex: /\b(?:P\.?O\.?[ \t\xA0]*Box|PO[ \t\xA0]*Box)[ \t\xA0]+\d{1,6}\b/gi },
    { type: 'ADDRESS', regex: /\b[A-Za-z][a-zA-Z\s.-]{1,25},?\s+(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR)\s+\d{5}(?:-\d{4})?\b/g },
    { type: 'ADDRESS', regex: /\b(?:ZIP|Postal|Code)?\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR)\s+\d{5}(?:-\d{4})?\b/g },
    { type: 'ADDRESS', regex: /\b\d{5}-\d{4}\b/g },
    { type: 'LOCATION', regex: /\b[A-Za-z][a-zA-Z\s.-]{1,25},?\s+(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR)\b/g },

    // PHI & Medical
    { type: 'PHI', regex: /\b(?:MRN|Patient ID|Medical Record No|Patient No)[\s:#]+([A-Za-z0-9-]+)/gi },
    { type: 'PHI', regex: /\bMRN[ -]?\d{6,}\b/gi },
    { type: 'PHI', regex: /\b[A-TV-Z]\d{2}[. ]?\d[A-Z0-9]?\b/g },
    { type: 'PHI', regex: /\b[A-Z]{2,3}\d{6,8}\b/g },
    { type: 'PHI', regex: /\bNHS[ -]?\d{3}[ -]?\d{3}[ -]?\d{4}\b/gi },

    // Copyrights
    { type: 'COPYRIGHT', regex: /\bPROJECT[-_][A-Z0-9]{5,}\b/gi },
    { type: 'COPYRIGHT', regex: /\b(DRAFT|ASSET|SCRIPT)[-_][0-9]{4,}\b/gi },

    // General Privacy, Dates & Secrets
    { type: 'ID', regex: /\b(?:GDPR|HIPAA|CCPA|SOC2)[-_]AUDIT[-_]\d{4}\b/gi },
    { type: 'ID', regex: /\bPOLICY[-_][A-Z0-9]{5,}\b/gi },
    { type: 'ID', regex: /\bGRADE[S]?\s*:\s*[A-DF][+-]?\b/gi },
    { type: 'DATE', regex: /\b(?:DOB|BIRTHDAY|Date of Birth)[\s:]+([0-9./-]{6,10})\b/gi },
    { type: 'SECRET', regex: /\b(?:PASSWORD|PWD|SECRET)\s*[:=]\s*["']?[\S]{4,}["']?/gi },

    // Standard IDs (SSN, EIN, Passport, VAT)
    { type: 'ID', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
    { type: 'ID', regex: /\b(?:XXX|xxx|\*\*\*)[ -]?(?:XX|xx|\*\*)[ -]?\d{4}\b/g },
    { type: 'ID', regex: /\b\d{2}-\d{7}\b/g },
    { type: 'ID', regex: /(?:(?:[A-Za-z]:\\|\/(?:usr|var|etc|home|root|Users|private|tmp|opt|bin|sbin|dev|Applications|Library)\/)[a-zA-Z0-9_.-]+(?:[\/\\][a-zA-Z0-9_.-]+)*|\/(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+\.(?:txt|pdf|docx|xlsx|csv|js|ts|json|env|log|key|pem|crt|conf|yaml|yml|xml|html|sql|py|go|rs|c|cpp|h|sh|bin|zip|tar|gz|png|jpg|jpeg|svg|webp|wasm)\b)/g },
    { type: 'ID', regex: /\b[A-CEGHJ-PR-TW-Z]{1}[A-CEGHJ-NPR-TW-Z]{1}[0-9]{6}[A-DFM]{1}\b/gi },
    { type: 'ID', regex: /\b[A-Z]{2}[0-9]{6,12}\b/gi },
    { type: 'ID', regex: /[A-Z0-9<]{30,44}/g },
    
    // IT / Technical IDs
    { type: 'IP', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
    { type: 'IP', regex: /\b(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}\b/g },
    { type: 'ID', regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g },
    { type: 'ID', regex: /(?:\B\/|\b[a-zA-Z]:\\)(?:[\w.-]+[\/\\])*[\w.-]+\b/g },
    { type: 'ID', regex: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::\d{2})?)?\b/g },
    { type: 'ID', regex: /\b\d{4}-\d{2}-\d{2}\b/g },
    { type: 'ID', regex: /\b\d{2}\/\d{2}\/\d{4}\b/g },

    // Phone Numbers
    { type: 'PHONE', regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
    { type: 'PHONE', regex: /\+?[1-9]\d{1,3}[\s.-]\(?\d{1,4}\)?[\s.-]\d{2,4}[\s.-]\d{4}/g },
    { type: 'PHONE', regex: /(?:\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}\b/g },
    { type: 'PHONE', regex: /\b(?:\d{3}[-.\s]\d{4}|\(\d{3}\)\s??\d{3}[-.\s]??\d{4}|\d{3}[-.\s]??\d{3}[-.\s]??\d{4})\b/g },
    
    // Geolocation (Lat/Long)
    { type: 'LOCATION', regex: /\b-?\d{1,3}\.\d{4,6}[° ]?[NSns],\s*-?\d{1,3}\.\d{4,6}[° ]?[EWew]\b/g },
    { type: 'LOCATION', regex: /\b(LATITUDE|LONGITUDE)[:\s]-?\d{1,3}\.\d{4,10}\b/gi },

    // Driver Licenses & State IDs
    { type: 'ID', regex: /\bDL[ -]?\d{6,12}\b/gi },
    { type: 'ID', regex: /\bDRIVER[S]?\s+LICENSE[ -]?\d{6,15}\b/gi },

    // Generalized Name Detection (First [Middle] Last) — max 1 middle word to avoid grabbing job titles
    // Middle word must be: a particle (van/de/etc.), a single initial (A. or A), or a capitalized word of ≥2 lowercase letters
    { type: 'NAME', isAggressiveName: true, regex: /(?<=^|[^\p{L}\p{N}_])(?:\p{Lu}[\p{Ll}'-]*\p{Ll}|\p{Lu}[\p{Ll}'-]*[\p{Lu}'-][\p{Ll}'-]*)(?:[ \t\xA0]+(?:\p{Lu}[\p{Ll}'-]*\p{Ll}|\p{Lu}[\p{Ll}'-]*[\p{Lu}'-][\p{Ll}'-]*|\p{Lu}\.?|van|von|de|di|da|la|le|del|du|der|van[ \t\xA0]+de|van[ \t\xA0]+der)){0,1}[ \t\xA0]+(?:\p{Lu}[\p{Ll}'-]*\p{Ll}|\p{Lu}[\p{Ll}'-]*[\p{Lu}'-][\p{Ll}'-]*)(?:'s)?(?=[^\p{L}\p{N}_]|$)(?![ \t\xA0]*:)/gu },
    // Payroll Format Names (e.g. "BARKER, KELLY", "BARKER, KELLY M", "DOE, JOHN M.")
    { type: 'NAME', regex: /\b[A-Z]{2,25},\s+[A-Z]{2,25}(?:\s+[A-Z]\.?|\s+[A-Z]{2,25})*\b/g },
    // All-Caps Names (2–3 words, supporting single-letter middle initial e.g. "KELLY M BARKER", "JOHN M BARKER")
    { type: 'NAME', regex: /(?<=^|[^\p{L}\p{N}_])\p{Lu}{2,}(?:[\p{Lu}'-]*\p{Lu})?(?:[ \t\xA0]+(?:\p{Lu}\.?|[A-Z][a-z]+))?[ \t\xA0]+\p{Lu}{2,}(?:[\p{Lu}'-]*\p{Lu})?(?:'s)?(?=[^\p{L}\p{N}_]|$)(?![ \t\xA0]*:)/gu },
    // ALL-CAPS first + middle initial(s) with optional spaces + ALL-CAPS last name
    { type: 'NAME', regex: /(?<=^|[^\p{L}\p{N}_])\p{Lu}{2,}(?:[\p{Lu}'-]*\p{Lu})?(?:[ \t\xA0]*\p{Lu}\.)+[ \t\xA0]*\p{Lu}{2,}(?:[\p{Lu}'-]*\p{Lu})?(?:'s)?(?=[^\p{L}\p{N}_]|$)(?![ \t\xA0]*:)/gu },
    // ALL-CAPS first name + optional middle initial(s) with optional spaces + Mixed-Case last name
    { type: 'NAME', regex: /(?<=^|[^\p{L}\p{N}_])\p{Lu}{2,}(?:[\p{Lu}'-]*\p{Lu})?(?:(?:[ \t\xA0]*\p{Lu}\.)+[ \t\xA0]*|[ \t\xA0]+)(?:\p{Lu}\p{Ll}[\p{Ll}'-]*|\p{Lu}[\p{Ll}'-]*[\p{Lu}'-][\p{Ll}'-]*)(?:'s)?(?=[^\p{L}\p{N}_]|$)(?![ \t\xA0]*:)/gu },
    // Names with Honorifics (with or without period, supporting single or multi-word full names) (Unicode-safe)
    { type: 'NAME', regex: /(?<=^|[^\p{L}\p{N}_])(?:Mr|Mrs|Ms|Dr|Prof|Hon|Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Hon\.)[ \t\xA0]+(?:\p{Lu}[\p{Ll}'-]*\p{Ll}|\p{Lu}[\p{Ll}'-]*[\p{Lu}'-][\p{Ll}'-]*)(?:[ \t\xA0]+(?:\p{Lu}[\p{Ll}'-]*\p{Ll}|\p{Lu}[\p{Ll}'-]*[\p{Lu}'-][\p{Ll}'-]*))?(?=[^\p{L}\p{N}_]|$)(?![ \t\xA0]*:)/gu },
    
    // W-2 Box c Employer Block (Name, Address, and Zip Code)
    { type: 'NAME', isContextName: true, regex: /(?:(?:\bBox\s+c\b|\bc\.\s*|\bc\s+(?=Employer))\s*(?:Employer(?:'s)?\s*)?(?:name[,\s]+address[,\s]+and\s+ZIP\s+code|name)?|(?:Employer(?:'s)?\s+name[,\s]+address[,\s]+and\s+ZIP\s+code))[\s:#]*([A-Za-z0-9&., \t\xA0'-]{2,45}?)(?=\r?\n|$|\s{3,}|\t|EIN|FEIN|Box|\d+\b|Wages|Federal|Social|Medicare)/gi },
    // W-2 Box e Employee Name & Initial
    { type: 'NAME', isContextName: true, regex: /(?:(?:\bBox\s+e\b|\be\.\s*|\be\s+(?=Employee))\s*(?:Employee(?:'s)?\s*)?(?:first\s+name(?:\s+(?:and|&)\s+initial)?|name)?[:\s#]*|(?:Employee(?:'s)?\s+first\s+name(?:\s+(?:and|&)\s+initial)?))[\s:#]*([A-Za-z0-9.\s'-]{2,35}?)(?=\r?\n|$|\s{3,}|\t|Last|Surname|Suff|Box|\d+\b|1\b)/gi },
    // Contextual First Names (Employee's first name, First name, Given name)
    { type: 'NAME', isContextName: true, regex: /(?:(?:Employee(?:'s)?|Borrower(?:'s)?|Co-Borrower(?:'s)?|Applicant(?:'s)?|Candidate(?:'s)?|Worker(?:'s)?|Taxpayer(?:'s)?|Spouse(?:'s)?|Person(?:'s)?)\s+)?(?:First\s+name(?:\s+(?:and|&)\s+initial)?|Given\s+name)[\s:#]+(?:\b|\b\s*)([A-Za-z0-9.\s'-]{2,30}?)(?=\r?\n|$|\s{3,}|\t|Last|Surname|Family|Suff|Box|Address|SSN|EIN)/gi },
    // Contextual Last Names (Last name, Surname, Family name)
    { type: 'NAME', isContextName: true, regex: /(?:(?:Employee(?:'s)?|Borrower(?:'s)?|Co-Borrower(?:'s)?|Applicant(?:'s)?|Candidate(?:'s)?|Worker(?:'s)?|Taxpayer(?:'s)?|Spouse(?:'s)?|Person(?:'s)?)\s+)?(?:Last\s+name|Surname|Family\s+name)[\s:#]+(?:\b|\b\s*)([A-Za-z'-]{2,30})/gi },
    // Contextual General Names (Employee, Borrower, Co-Borrower, Taxpayer, Spouse, Applicant, Candidate, Worker, Employer, Company, Insured, Patient, Client, etc.)
    { type: 'NAME', isContextName: true, regex: /(?:Employee(?:\s+Name)?|Employer(?:\s+Name)?|Borrower(?:\s+Name)?|Co-Borrower(?:\s+Name)?|Applicant(?:\s+Name)?|Candidate(?:\s+Name)?|Worker(?:\s+Name)?|Taxpayer(?:\s+Name)?|Spouse(?:\s+Name)?|Manager|Supervisor|Reporting To|Insured|Claimant|Patient|Client|Customer|Account Holder|Prepared By|Attention|Attn|Contact(?: Name)?|Child|Parent|Guardian|Relationship|Kin|Tenant|Landlord|Buyer|Seller|Plaintiff|Defendant|Testator)[\s:#]+(?:\b|\b\s*)([A-Za-z0-9&.,\s'-]{2,40}?)(?=\r?\n|$|\s{3,}|\t|Employee|Employer|Address|Phone|SSN|EIN|FEIN|Date|Pay|Rate|Tax|W-2|OMB|Copy|Box|Status)/gi },
    // Box e shorthand
    { type: 'NAME', isContextName: true, regex: /\b(?:Box\s+e)\s*[:#-]\s*([A-Za-z0-9&.,\s'-]{2,40})/gi }
];

let PROFILE_RULES = {
    general: [],
    legal: [
        { type: 'LEGAL', regex: /\bCASE[-_][A-Z0-9_-]{4,}\b/gi },
        { type: 'LEGAL', regex: /\bMATTER[-_][A-Z0-9_-]{4,}\b/gi },
        { type: 'LEGAL', regex: /\b[A-Z]{2,4}[- ]?\d{2}[- ]?\d{4,}\b/g },
        { type: 'PRIVILEGE', regex: /ATTORNEY[- ]CLIENT[- ]PRIVILEGE/gi }
    ],
    hr: [
        { type: 'NAME', isContextName: true, regex: /(?:Candidate|Applicant|Employee|Reporting To|Manager|Mentored by|Direct Report)[\s:]+([A-Z][a-z]*(?:\s+[A-Z][a-z]*)?)/g },
        { type: 'ID', regex: /\bEEID[ -]?\d{4,}\b/gi },
        { type: 'ID', regex: /\bEMP[-_]\d{3,}\b/gi },
        { type: 'ID', regex: /\bRESUME[-_]?[A-Z0-9]{4,}\b/gi },
        { type: 'DATE', regex: /\b(?:DOB|BIRTHDAY|Date of Birth)[\s:]+([0-9./-]{6,10})\b/gi },
        { type: 'DATE', regex: /\b(?:Graduated|Graduation|Class of)[:\s]+(?:(?:Spring|Summer|Fall|Winter)\s+)?(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\s+)?\d{4}\b/gi },
        { type: 'ID', regex: /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/gi },
        { type: 'ID', regex: /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+/gi },
        { type: 'ADDRESS', regex: /\b\d{1,6}\s+(?:[A-Z0-9][a-zA-Z0-9-]*\s+){1,3}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Ln|Lane|Drive|Way|Ct|Court|Pl|Place|Terrace|Pkwy|Parkway|Sq|Square|Highway|Hwy|Circle|Cir|Trail|Trl|Dr(?!\.?\s+[A-Z][a-z]+))\b/g }
    ],
    finance: [
        { type: 'FINANCIAL', regex: /\b[A-Z]{4}(?:AD|AE|AF|AG|AI|AL|AM|AO|AQ|AR|AS|AT|AU|AW|AX|AZ|BA|BB|BD|BE|BF|BG|BH|BI|BJ|BL|BM|BN|BO|BQ|BR|BS|BT|BV|BW|BY|BZ|CA|CC|CD|CF|CG|CH|CI|CK|CL|CM|CN|CO|CR|CU|CV|CW|CX|CY|CZ|DE|DJ|DK|DM|DO|DZ|EC|EE|EG|EH|ER|ES|ET|FI|FJ|FK|FM|FO|FR|GA|GB|GD|GE|GF|GG|GH|GI|GL|GM|GN|GP|GQ|GR|GS|GT|GU|GW|GY|HK|HM|HN|HR|HT|HU|ID|IE|IL|IM|IN|IO|IQ|IR|IS|IT|JE|JM|JO|JP|KE|KG|KH|KI|KM|KN|KP|KR|KW|KY|KZ|LA|LB|LC|LI|LK|LR|LS|LT|LU|LV|LY|MA|MC|MD|ME|MF|MG|MH|MK|ML|MM|MN|MO|MP|MQ|MR|MS|MT|MU|MV|MW|MX|MY|MZ|NA|NC|NE|NF|NG|NI|NL|NO|NP|NR|NU|NZ|OM|PA|PE|PF|PG|PH|PK|PL|PM|PN|PR|PS|PT|PW|PY|QA|RE|RO|RS|RU|RW|SA|SB|SC|SD|SE|SG|SH|SI|SJ|SK|SL|SM|SN|SO|SR|SS|ST|SV|SX|SY|SZ|TC|TD|TF|TG|TJ|TK|TL|TM|TN|TO|TR|TT|TV|TW|TZ|UA|UG|UM|US|UY|UZ|VA|VC|VE|VG|VI|VN|VU|WF|WS|YE|YT|ZA|ZM|ZW)[A-Z2-9][A-NP-Z0-9](?:[A-Z0-9]{3})?\b/g },
        { type: 'FINANCIAL', regex: /\b[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{4}[0-9]{7}[a-zA-Z0-9]{0,16}\b/g },
        { type: 'FINANCIAL', regex: /\bPORTFOLIO[-_][A-Z0-9]{5,}\b/gi }
    ],
    medical: [
        { type: 'PHI', regex: /\b(?:MRN|Patient ID|Medical Record No|Patient No)[\s:#]+([A-Za-z0-9-]+)/gi },
        { type: 'DATE', regex: /\b(?:DOB|Date of Birth|BIRTHDAY)[\s:]+([0-9./-]{6,10})\b/gi },
        { type: 'PHI', regex: /\bMRN[ -]?\d{6,}\b/gi },
        { type: 'ID', regex: /\b(?:Insurance|Policy|Member|Subscriber|Group|Plan|Health|Rx)[-_: ]*ID[:\s#]*([A-Za-z0-9-]+)/gi },
        { type: 'ID', regex: /\b(?:BCBS|AETNA|CIGNA|UHC|HUMANA|MEDICARE|MEDICAID)[-_A-Za-z0-9]+\b/gi },
        { type: 'PHI', regex: /\b[A-TV-Z]\d{2}[. ]?\d[A-Z0-9]?\b/g },
        { type: 'PHI', regex: /\b[A-Z]{2,3}\d{6,8}\b/g },
        { type: 'PHI', regex: /\bNHS[ -]?\d{3}[ -]?\d{3}[ -]?\d{4}\b/gi }
    ],
    security: [
        { type: 'SECRET', regex: /\b(?:INCIDENT|BREACH)[-_: ]?ID[-_: ]?[0-9]{4,10}\b/gi }
    ],
    marketing: [
        { type: 'ID', regex: /\b(?:LEAD|PROSPECT)[-_: ]*[A-Z0-9_-]*[0-9][A-Z0-9_-]*\b/gi },
        { type: 'ID', regex: /\b(?:CAMPAIGN|CLID|GCLID|FBCLID)[-_:=]*[A-Za-z0-9_-]{10,}\b/gi },
        { type: 'FINANCIAL', regex: /(?<=\b(?:LTV|CAC)[\s:]*)(?:[$€£¥₪₽₹]|(?:USD|EUR|GBP|CHF|ILS|RUB)\s?)[0-9,.]+\b/gi },
        { type: 'ID', regex: /\b(?:SEGMENT|COHORT)[-_: ]*[0-9]{4,8}\b/gi }
    ],
    bizops: [
        { type: 'ID', regex: /\b(?:DEAL|KPI|METRIC)[-_: ]?[A-Z0-9]{4,}\b/gi },
        { type: 'ID', regex: /\b(?:ENTITY|VENDOR|PARTNER)[-_: ]?[0-9]{4,10}\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:REVENUE|EBITDA|PROFIT|MARGIN)[\s:_-]+(?:[$€£¥₪₽₹]|(?:USD|EUR|GBP|CHF|ILS|RUB)\s?)?[0-9,.]+[KM]?\b/gi },
        { type: 'SECRET', regex: /\b(?:NDA|M&A|MERGER)[-_: ]?[A-Z0-9]{4,}\b/gi }
    ],
    sales: [
        { type: 'ID', regex: /\bOPPORTUNITY[-_: ]?[A-Z0-9]{5,}\b/gi },
        { type: 'ID', regex: /\b(?:DOCUSIGN|CONTRACT)[-_: ]?[0-9A-F]{8,32}\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:ARR|MRR|QUOTA)[\s:]+(?:[$€£¥₪₽₹]|(?:USD|EUR|GBP|CHF|ILS|RUB)\s?)?[0-9,.]+[KM]?\b/gi },
        { type: 'ID', regex: /\b(?:SFDC|HUBSPOT)[-_: ]?[0-9A-Z]{15,18}\b/gi }
    ],
    support: [
        { type: 'ID', regex: /\bTICKET[-_:# ]?[A-Z0-9]{5,10}\b/gi },
        { type: 'ID', regex: /\b(?:ZENDESK|INTERCOM|JIRA)[-_:# ]?[0-9]{4,10}\b/gi },
        { type: 'ID', regex: /\b(?:REFUND|RETURN|RMA)[-_:# ]?[A-Z0-9]{6,12}\b/gi },
        { type: 'ID', regex: /\b(?:LOYALTY|REWARDS)[-_:# ]?\d{8,12}\b/gi }
    ],
    realestate: [
        { type: 'ID', regex: /\b(?:MLS|LIS)[- ]?\d{6,10}\b/gi },
        { type: 'ID', regex: /\bPARCEL[- ]?\d{5,15}\b/gi },
        { type: 'ID', regex: /\bTENANT[-_]ID[-_][0-9]{4,}\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:RENT|LEASE|ESCROW)[\s:]+(?:[$€£¥₪₽₹]|(?:USD|EUR|GBP|CHF|ILS|RUB)\s?)[0-9,]{3,}\b/gi },
        { type: 'SECRET', regex: /\b(?:GATE|DOOR|LOBBY)[-_ ](?:CODE|PIN)[\s:]*\d{4,6}\b/gi }
    ],
    compliance: [
        { type: 'SECRET', regex: /\b(?:GDPR|HIPAA|CCPA|SOC2|ISO27001)[-_: ]?AUDIT[-_: ]?\d{4}\b/gi },
        { type: 'SECRET', regex: /\b(?:DPA|POLICY)[-_: ]?[A-Z0-9]{5,15}\b/gi },
        { type: 'ID', regex: /\b(?:SAR|DSAR)[-_\/: ]?[A-Z0-9-/]+\b/gi }
    ],
    ccpa: [
        { type: 'ID', regex: /\b(?:DL|DRIVER['’]?S?\s+LICENSE)[:\s#-]*[A-Z0-9]{6,12}\b/gi },
        { type: 'LOCATION', regex: /\b-?\d{1,3}\.\d{4,6}[° ]?[NSns],\s*-?\d{1,3}\.\d{4,6}[° ]?[EWew]\b/g },
        { type: 'ID', regex: /\b(?:CCPA|CPRA)[-_: ]?OPT[-_ ]OUT\b/gi },
        { type: 'ID', regex: /\bACCOUNT[ -]?(?:ID|NUM|NUMBER)[:\s]+[A-Z0-9]{6,20}\b/gi }
    ],
    engineering: [
        { type: 'SECRET', regex: /(?<=\b(?:DB|POSTGRES|REDIS|MYSQL|AWS|SECRET|PASSWORD|TOKEN|API|KEY)[A-Z0-9_]*\s*[:=]\s*["']?)[A-Za-z0-9_-]{10,}/gi },
        { type: 'ID', regex: /\b[a-z0-9._-]+\/[a-z0-9._-]+:[a-z0-9._-]+\b/g },
        { type: 'ID', regex: /\b[a-fA-F0-9]{40}\b/g },
        { type: 'ID', regex: /\b[a-z0-9](?:[-a-z0-9]*[a-z0-9])?\.svc\.cluster\.local\b/g }
    ],
    agents: [
        { type: 'ID', regex: /\b(?:AGENT|VECTOR|EMBEDDING)[-_: ]?(?:ID[-_: ]?)?[A-Z0-9]{8,}\b/gi },
        { type: 'ID', regex: /\bTASK[-_: ]?[A-Z0-9]{5,15}\b/gi },
        { type: 'SECRET', regex: /\b(?:SYS_PROMPT|SYSTEM_PROMPT|OPENAI_API_KEY)[-_: ]?[A-Za-z0-9_-]{10,}\b/gi }
    ],
    academic: [
        { type: 'ID', regex: /\b(?:STUDENT|ALUMNI)[-_:# ]?[0-9]{5,10}\b/gi },
        { type: 'ID', regex: /\bCOURSE[-_:# ]?[A-Z]{3,4}[ ]?[0-9]{3,4}\b/gi },
        { type: 'ID', regex: /\b(?:FERPA|IRB)[-_:# ]?[A-Z0-9]{5,10}\b/gi },
        { type: 'ID', regex: /\bGRADE[S]?[\s:][A-DF][+-]?\b/gi }
    ],
    creative: [
        { type: 'SECRET', regex: /\b(?:PROJECT|DRAFT|ASSET|SCRIPT|IP)[-_: ]?[0-9]{4,10}\b/gi },
        { type: 'SECRET', regex: /\b(?:SPOILER|UNRELEASED|EMBARGOED)\b/gi },
        { type: 'NAME', regex: /\b(?:GHOSTWRITER|SOURCE)[:\s][A-Z][a-z]+ [A-Z][a-z]+\b/g }
    ],
    tech: [
        { type: 'ID', regex: /\b(?:INSTANCE|NODE|CLUSTER)[-_]ID[-_][a-z0-9-]{10,}\b/gi },
        { type: 'ID', regex: /\bENV[-_: ]?(?:PROD|STAGING|DEV|TEST|QA)\b/gi },
        { type: 'SECRET', regex: /\b(?:CONFIG|KUBECONFIG|TFSTATE)[-_: ]?[A-Z0-9]{6,15}\b/gi }
    ],
    personal: [
        { type: 'DATE', regex: /\b(?:DOB|BIRTHDAY|Date of Birth)[\s:]+([0-9./-]{6,10})\b/gi },
        { type: 'SECRET', regex: /\b(?:PASSWORD|PWD|SECRET|PIN)[\s:]*[\S]{4,20}\b/gi },
        { type: 'PHONE', regex: /\b(?:WIFE|HUSBAND|PARTNER|MOM|DAD)[\s:]+(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/gi }
    ],
    wealthmgmt: [
        { type: 'LEGAL', regex: /\b(?:THE\s+)?[A-Z][A-Z\s.'-]{4,}\s+(?:(?:REVOCABLE|IRREVOCABLE|LIVING|FAMILY|TESTAMENTARY|CHARITABLE|GENERATION-SKIPPING)\s+)*TRUST\b/g },
        // Mixed-Caps name: All-Caps first name (3+ chars) + optional initials + Mixed-Case last name
        // Handles PDF-rendered trust names where OCR/extraction produces e.g. "KKKKK I. Mmmmmmm"
        { type: 'NAME', regex: /(?<=^|[^\p{L}\p{N}_])\p{Lu}{3,}(?:[\p{Lu}'-]*\p{Lu})?(?:[ \t\xA0]+\p{Lu}\.)*[ \t\xA0]+\p{Lu}\p{Ll}[\p{Ll}'-]*(?:\p{Lu}[\p{Ll}'-]*)?\p{L}(?:'s)?(?=[^\p{L}\p{N}_]|$)/gu },
        { type: 'FINANCIAL', regex: /\b(?:ABA|Routing(?:\s+No)?|RTN)[:\s#]*\d{9}\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:Account|Acct\.?)[:\s#]*\d{4}[-\s]?\d{4}[-\s]?\d{2,6}\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:Policy|Contract)\s*(?:No\.?|Number|#)[:\s]+[A-Z0-9][A-Z0-9\-]{3,14}\b/gi },
        { type: 'ID', regex: /\bCRD\s*#?\s*\d{4,8}\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:Annual\s+(?:Distribution|Withdrawal)|RMD|Required\s+Minimum\s+Distribution)[:\s]+(?:[$€£¥₪₽₹]|(?:USD|EUR|GBP|CHF|ILS|RUB)\s?)[\d,]+(?:[.][\d]{2})?\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:Portfolio|Market\s+Value|Net\s+Worth|AUM|Total\s+Assets)[:\s]+(?:[$€£¥₪₽₹]|(?:USD|EUR|GBP|CHF|ILS|RUB)\s?)[\d,.]+[KMB]?\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:Roth\s+)?(?:IRA|401k|401\(k\)|403b|403\(b\)|SEP|SIMPLE)\s*(?:Account|Acct|Plan)?\s*(?:No|Number|#)?[:\s#]*[A-Z0-9]{4,15}\b/gi }
    ],
    insurance: [
        { type: 'ID', regex: /\b(?:Claim|CLM)[:\s#-]*[A-Z0-9]{6,15}\b/gi },
        { type: 'ID', regex: /\b(?:Policy|POL)[:\s#-]*[A-Z]{0,4}[-]?\d{6,12}\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:Loss|Claim\s+Amount|Settlement|Reserve|Indemnity)[:\s]+(?:[$€£¥₪₽₹]|(?:USD|EUR|GBP|CHF|ILS|RUB)\s?)[\d,]+(?:[.]\d{2})?\b/gi },
        { type: 'ID', regex: /\b(?:Adjuster\s+(?:ID|No)|Claim\s+Rep(?:\.|resentative)?)[:\s#]*[A-Z0-9]{4,12}\b/gi },
        { type: 'ID', regex: /\bNAIC[:\s#]*\d{5}\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:Deductible|Premium|Coverage\s+Amount)[:\s]+(?:[$€£¥₪₽₹]|(?:USD|EUR|GBP|CHF|ILS|RUB)\s?)[\d,]+(?:[.]\d{2})?\b/gi },
        { type: 'ID', regex: /\b[A-HJ-NPR-Z0-9]{17}\b/g },
        { type: 'ID', regex: /\b(?:Insured|Named\s+Insured)[:\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g },
        { type: 'ID', regex: /\b(?:Agent|Producer)\s*(?:Code|No|ID)[:\s#]*[A-Z0-9]{4,12}\b/gi }
    ],
    accounting: [
        { type: 'ID', regex: /\b(?:EIN|FEIN|Tax\s+ID)[:\s#]*\d{2}-\d{7}\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:AGI|Adjusted\s+Gross\s+Income|Taxable\s+Income|Total\s+Income)[:\s]+(?:[$€£¥₪₽₹]|(?:USD|EUR|GBP|CHF|ILS|RUB)\s?)[\d,]+(?:[.]\d{2})?\b/gi },
        { type: 'FINANCIAL', regex: /\bBox\s+\d{1,2}[a-z]?[:\s]+(?:[$€£¥₪₽₹]|(?:USD|EUR|GBP|CHF|ILS|RUB)\s?)[\d,]+(?:[.]\d{2})?\b/gi },
        { type: 'ID', regex: /\b(?:Form|Schedule)\s+(?:1040|1040-SR|W-2|W-4|1099-[A-Z]{1,4}|K-1|941|990|4562)\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:Federal|State)\s+(?:Tax\s+)?(?:Refund|Amount\s+Owed|Balance\s+Due)[:\s]+(?:[$€£¥₪₽₹]|(?:USD|EUR|GBP|CHF|ILS|RUB)\s?)[\d,]+(?:[.]\d{2})?\b/gi },
        { type: 'ID', regex: /\b(?:State\s+Tax\s+ID|SUI|UI\s+Account\s+No)[:\s#]*[A-Z]{0,3}[-]?\d{4,15}\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:Net\s+Pay|Gross\s+Pay|Taxable\s+Wages)[:\s]+(?:[$€£¥₪₽₹]|(?:USD|EUR|GBP|CHF|ILS|RUB)\s?)[\d,]+(?:[.]\d{2})?\b/gi },
        { type: 'ID', regex: /\b(?:CAF|Practitioner\s+(?:PIN|ID)|PTIN)[:\s#]*[A-Z]?\d{6,9}\b/gi }
    ],
    pharma: [
        { type: 'ID', regex: /\b(?:Subject|Patient|Participant)\s+(?:ID|No)[:\s#]*[A-Z0-9]{3,12}\b/gi },
        { type: 'ID', regex: /\b(?:Protocol|Study)\s*(?:No|Number|ID)[:\s#]*[A-Z0-9][-A-Z0-9]{3,15}\b/gi },
        { type: 'ID', regex: /\b(?:IND|NDA|BLA|ANDA)\s*(?:No|Number|#)?[:\s]*\d{3,6}\b/gi },
        { type: 'ID', regex: /\bIRB[:\s#]*[A-Z0-9]{4,12}\b/gi },
        { type: 'ID', regex: /\b(?:Site\s+(?:No|ID)|Investigator\s+Site)[:\s#]*\d{3,6}\b/gi },
        { type: 'ID', regex: /\b(?:Batch|Lot|Serial)\s*(?:No[.]?|Number|#)?[:\s#]*[A-Z0-9][A-Z0-9\-]{3,14}\b/gi },
        { type: 'PHI', regex: /\b(?:Dose|Dosage)[:\s]+\d+(?:\.\d+)?\s*(?:mg|mcg|mL|IU|units?)\b/gi },
        { type: 'ID', regex: /\b(?:CRF|eCRF|Case\s+Report\s+Form)\s*(?:No|Page|ID)?[:\s#]*[A-Z0-9]{2,10}\b/gi }
    ],
    underwriting: [
        // Employer Corporate / Business Names
        { type: 'NAME', isContextName: true, regex: /\b(?:[A-Z][A-Za-z0-9&.,'-]*[ \t\xA0]+){1,5}(?:Inc\.?|LLC|Corp\.?|Corporation|Ltd\.?|Limited|Co\.?|Company|Group|Holdings|Solutions|Services|Technologies|Logistics|Industries|Capital|Bank|Partners|LLP|PLLC)(?:\s+(?:LLC|Inc\.?|Corp\.?|Ltd\.?|USA|Group))?\b/g },
        { type: 'NAME', isContextName: true, regex: /(?:Employer|Company|Organization|Business)\s*(?:Name)?[\s:#]+([A-Za-z0-9&.,\s'-]{2,40}?)(?=\r?\n|$|\s{3,}|\t|Address|EIN|FEIN|Phone|W-2|Rate|Pay|Wage)/gi },
        
        // W-2 & Tax Identifiers
        { type: 'ID', regex: /(?:\b(?:Box\s+d\b|d\.\s*(?:Control|#)?|d\s+Control)\s*(?:number|no\.?|#|num)?[:\s#]*|\bControl\s*(?:number|no\.?|#|num)[:\s#]*|\bControl[:#]\s*)([A-Za-z0-9-]{3,30})/gi },
        { type: 'ID', regex: /\b(?:EIN|FEIN|Tax\s+ID)[:\s#]*\d{2}-\d{7}\b/gi },
        { type: 'ID', regex: /\b\d{2}-\d{7}\b/g },
        { type: 'ID', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
        { type: 'ID', regex: /\b(?:XXX|xxx|\*\*\*)[ -]?(?:XX|xx|\*\*)[ -]?\d{4}\b/g },
        
        // Employee, Loan & Payroll IDs
        { type: 'ID', regex: /\b(?:Employee|Emp|EE|Worker|Borrower|Badge|Advisor|Producer|Agent|Applicant|File)\s*(?:#|ID|No\.?|Number)[:\s#]*[A-Z0-9-]{3,20}\b/gi },
        { type: 'ID', regex: /\b(?:Pay\s+Group|Cost\s+Center|Dept|Department)[:\s#]*[A-Za-z0-9_-]{2,30}\b/gi },
        { type: 'ID', regex: /\b(?:Loan|Application|Deal|Borrower|File)\s*(?:#|ID|No\.?|Number)[:\s#]*[A-Za-z0-9-]{4,25}\b/gi },
        
        // Direct Deposit, Bank Accounts & Routing Numbers (Masked & Unmasked)
        { type: 'FINANCIAL', regex: /\b(?:Account|Acct|Checking|Savings|Direct\s+Deposit)\s*(?:#|ID|No\.?|Number)?[:\s#]*(?:[\*xX•.-]{3,}\d{2,6}|\d{4}[-\s]?\d{4}[-\s]?\d{2,6})\b/gi },
        { type: 'FINANCIAL', regex: /\b(?:ABA|Routing|RTN)\s*(?:#|ID|No\.?|Number)?[:\s#]*\d{9}\b/gi },
        
        // Borrower & Co-Borrower Names (ALL-CAPS, Payroll, Title Case)
        { type: 'NAME', regex: /\b[A-Z]{2,25},\s+[A-Z]{2,25}(?:\s+[A-Z]\.?|\s+[A-Z]{2,25})*\b/g },
        { type: 'NAME', isAggressiveName: true, regex: /(?<=^|[^\p{L}\p{N}_])\p{Lu}{2,}(?:[\p{Lu}'-]*\p{Lu})?(?:[ \t\xA0]+(?:\p{Lu}\.?|[A-Z][a-z]+))?[ \t\xA0]+\p{Lu}{2,}(?:[\p{Lu}'-]*\p{Lu})?(?:'s)?(?=[^\p{L}\p{N}_]|$)(?![ \t\xA0]*:)/gu },
        { type: 'NAME', isContextName: true, regex: /(?:(?:Borrower|Co-Borrower|Applicant|Co-Applicant|Employee|Worker|Taxpayer|Candidate|Primary\s+Borrower|Joint\s+Borrower|Account\s+Holder|Insured|Client)\s*(?:Name)?|First\s+name|Given\s+name)[\s:#]+(?:\b|\b\s*)([A-Za-z0-9&.,\s'-]{2,35}?)(?=\r?\n|$|\s{3,}|\t|SSN|EIN|DOB|Address|Phone|Rate|Pay|Wage|Date|Box|Last|Surname)/gi },
        { type: 'NAME', isContextName: true, regex: /(?:Last\s+name|Surname|Family\s+name)[\s:#]+(?:\b|\b\s*)([A-Za-z'-]{2,30})/gi },
        
        // Addresses & Locations
        { type: 'ADDRESS', isContextAddress: true, regex: /(?:(?:Borrower(?:'s)?|Co-Borrower(?:'s)?|Employee(?:'s)?|Employer(?:'s)?|Home|Mailing|Property|Physical)\s+address|(?:(?:\bBox\s+f\b|\bf\.\s*|\bf\s+(?=Employee))\s*(?:Employee(?:'s)?\s*)?address))[\s:#]+([A-Za-z0-9#.,\s-]{4,55}?)(?=\r?\n|$|\s{3,}|\t|City|State|ZIP|SSN|EIN|Phone|Box|\d+\b)/gi },
        { type: 'ADDRESS', regex: /\b\d{1,6}[ \t\xA0]+(?:[A-Za-z0-9.-]+[ \t\xA0]+){1,4}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place|Terrace|Pkwy|Parkway|Sq|Square|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Row|Pike|Box|PO Box|P\.O\.[ \t\xA0]*Box)\b(?:[ \t\xA0]*,?[ \t\xA0]*(?:Apt|Apartment|Suite|Ste|Unit|#|Fl|Floor|Bldg|Building)\.?[ \t\xA0]*[A-Za-z0-9-]+)?/gi },
        { type: 'ADDRESS', regex: /\b[A-Za-z][a-zA-Z\s.-]{1,25},?\s+(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR)\s+\d{5}(?:-\d{4})?\b/g },
        { type: 'ADDRESS', regex: /\b\d{5}-\d{4}\b/g },
        { type: 'LOCATION', regex: /\b[A-Za-z][a-zA-Z\s.-]{1,25},?\s+(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR)\b/g }
    ]
};

let NAME_STOP_LIST = new Set([
    'clinical note', 'case note', 'prod log', 'siem alert', 'hr review', 'crm export', 'bank statement', 'file export', 'database row', 'lease application', 'strategy export', 'action log', 'glossary query', 'tool comparison', 'call transcript', 'zendesk ticket', 'board minutes', 'agent context', 'config dump', 'database dump', 'patient note', 'medical record', 'admission note', 'discharge summary', 'progress note', 'hiring review', 'security audit', 'incident response', 'server log', 'system log', 'api response', 'error log', 'audit log', 'debug log',
    'tax statement', 'wage and tax statement', 'wage and tax', 'wage statement', 'earning statement', 'earnings statement', 'pay statement', 'pay stub', 'paystub', 'withholding statement',
    'case no', 'account no', 'client no', 'ref no', 'matter no',
    'affected user', 'incident date', 'incident type', 'incident report',
    'review period', 'review date', 'salary band', 'salary range',
    'personal email', 'work email', 'business email',
    'lead source', 'account exec', 'account executive',
    'next appt', 'next appointment', 'last appt', 'chief complaint',
    'portfolio value', 'portfolio manager',
    'tax id', 'account number', 'employee id', 'social security',
    'date of', 'date of birth', 'place of birth',
    'hiring manager', 'direct report', 'team lead', 'team leader',
    'job title', 'job function', 'pay grade',
    'review type', 'performance review', 'annual review',
    'invoice number', 'purchase order', 'order number',
    'oak street', 'main street', 'high street', 'park avenue',
    'first street', 'second street', 'third street',
    'north avenue', 'south avenue', 'east side', 'west side',
    'soc team', 'hr team', 'it team', 'qa team', 'ux team',
    'new york', 'los angeles', 'san francisco', 'las vegas',
    'united states', 'united kingdom', 'north america', 'south america',
    'senior analyst', 'senior engineer', 'senior manager', 'senior consultant',
    'junior analyst', 'junior engineer', 'junior developer',
    'vice president', 'chief executive', 'chief officer',
    'account manager', 'project manager', 'product manager',
    'security officer', 'compliance officer',
    'general hospital', 'medical center', 'urgent care', 'primary care',
    'read more', 'learn more', 'click here', 'sign up', 'log in',
    'privacy policy', 'terms of', 'terms of service',
    'true positive', 'false positive', 'open source',
    'private identifiers', 'data privacy', 'system instruction', 'system instructions', 'critical', 'instruction',
    'user data', 'protected user', 'privacy scrubber', 'end of',
    'thank you', 'best regards', 'kind regards', 'warm regards', 'yours truly', 'sincerely yours', 'good morning', 'good afternoon', 'good evening', 'hello world', 'hello there',
    'supreme court', 'high court', 'district court', 'civil court', 'non disclosure', 'data protection', 'intellectual property', 'trade secret', 'force majeure', 'habeas corpus', 'amicus curiae', 'board member', 'board meeting', 'general assembly',
    'first name', 'last name', 'middle name', 'full name', 'email address', 'phone number', 'cell phone', 'home phone', 'zip code', 'postal code', 'page number', 'section one', 'table contents', 'table of', 'figure one',
    'marketing department', 'sales department', 'engineering team', 'product team', 'customer support', 'human resources', 'public relations',
    'artificial intelligence', 'machine learning', 'deep learning', 'large language', 'operating system', 'source code', 'user interface', 'web browser', 'pull request', 'merge request', 'commit message', 'code review', 'cloud computing', 'database schema',
    'blood pressure', 'heart rate', 'chief physician', 'treating physician', 'health care', 'healthcare provider', 'medical record',
    'grade a', 'grade b', 'grade c', 'grade d', 'grade f',
    'version 1', 'version 2', 'version 3', 'version 4', 'version 5',
    'step 1', 'step 2', 'step 3', 'step 4', 'step 5',
    'page 1', 'page 2', 'page 3', 'page 4', 'page 5',
    'cs101', 'course cs101',
    // Expanded Stop List (Common nouns, command phrases, legal, prompt, chess, and animation terms)
    'docket number', 'docket numbers', 'dockets section', 'case name', 'case names', 'case number', 'case numbers', 'law firm', 'law firms', 'counsel stack', 'counselstack', 'counselstack connector', 'tier 0', 'tier 1', 'tier 2', 'tier 3', 'tier 4', 'do not', 'do not write', 'specific permission', 'write again', 'without permission', 'without specific permission', 'on screen', 'in report', 'own line', 'connector access', 'prompt instruction', 'prompt instructions', 'finding report', 'findings report',
    'white bishop', 'black bishop', 'white knight', 'black knight', 'white king', 'black king', 'white queen', 'black queen', 'white rook', 'black rook', 'white pawn', 'black pawn', 'chess piece', 'chess pieces', 'chess game', 'chess match', 'disney-pixar', 'disney pixar', 'pixar animation', 'close-up', 'close up',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'yesterday', 'tomorrow', 'today', 'last week', 'next month', 'early morning', 'late night',
    'microsoft office', 'google workspace', 'slack channel', 'zoom meeting', 'teams call',
    'amazon prime', 'netflix show', 'youtube video', 'twitter post', 'linkedin profile',
    'central park', 'white house', 'grand canyon', 'mount everest', 'pacific ocean', 'atlantic ocean',
    'silicon valley', 'wall street', 'fifth avenue', 'times square', 'golden gate', 'empire state',
    'statue liberty', 'tower bridge', 'big ben', 'eiffel tower', 'great wall',
    'london bridge', 'san jose', 'las vegas', 'mexico city', 'hong kong', 'san diego',
    'software development', 'user experience', 'front end', 'back end', 'full stack',
    'web application', 'mobile app', 'desktop app', 'cloud services', 'data analytics',
    'cyber security', 'network security', 'information security', 'incident response',
    'disaster recovery', 'business continuity', 'risk management', 'quality assurance',
    'user acceptance', 'beta test', 'release candidate', 'version control', 'continuous integration',
    'continuous deployment', 'agile scrum', 'kanban board', 'sprint planning', 'daily standup',
    'product backlog', 'user story', 'acceptance criteria', 'technical debt', 'codebase',
    'repository', 'branch name', 'tag version', 'hot fix', 'patch note',
    'legal counsel', 'general counsel', 'human capital', 'talent acquisition',
    'employee benefits', 'payroll services', 'stock options', 'health insurance',
    'retirement plan', 'vacation time', 'sick leave', 'performance bonus',
    'commission structure', 'sales target', 'market share', 'brand identity',
    'marketing campaign', 'ad spend', 'click rate', 'conversion rate',
    'customer lifetime', 'churn rate', 'user engagement', 'social media',
    'content strategy', 'search engine', 'local search', 'organic traffic',
    'paid search', 'email marketing', 'press release', 'case study',
    'white paper', 'user guide', 'help center', 'frequently asked',
    'support ticket', 'service level', 'response time', 'resolution time',
    'customer satisfaction', 'net promoter', 'user feedback', 'product feature',
    'roadmap item', 'beta program', 'early access', 'invite only',
    'project status', 'meeting notes', 'call transcript', 'action items', 'follow up', 'best practices', 'success stories',
    'class name', 'function name', 'variable name', 'database table', 'schema name', 'index name', 'query result', 'error message', 'warning message', 'log entry', 'debug log', 'stack trace',
    'staff member', 'team member', 'board member', 'board meeting', 'committee member', 'executive board',
    'email us', 'contact us', 'about us', 'sign in', 'sign out',
    'driver license', 'drivers license', 'opt out', 'opt-out', 'ccpa opt', 'cpra opt', 'spoiler unreleased', 'unreleased draft',
    'lighting', 'keyboard', 'creating', 'building', 'training', 'planning', 'starting', 'painting', 'printing', 'returned', 'released', 'required', 'accepted', 'imported', 'services', 'products', 'accounts', 'settings', 'partners', 'keywords', 'keystone', 'keyspace', 'keynotes', 'keychain'
, 'quarterly results', 'strategic planning', 'market research', 'customer base', 'privacy settings', 'account settings', 'security settings', 'download now', 'free trial', 'limited time', 'copyright protected', 'all rights', 'rights reserved', 'credit score', 'monthly rent', 'lease application', 'property address', 'reference number', 'additional identifier', 'lease agreement', 'hiring review', 'candidate name', 'privacy policy', 'terms of service', 'machine learning', 'artificial intelligence', 'generative ai', 'silicon valley', 'google cloud', 'amazon web', 'data science', 'operating system', 'software engineer', 'product manager', 'project manager', 'data analyst', 'gross margin', 'revenue growth', 'source code', 'version control', 'large language model',
    'wages', 'wage', 'tips', 'compensation', 'withheld', 'withholding', 'medicare', 'deductions', 'deduction',
    'regular', 'hours', 'holiday', 'overtime', 'commission', 'bonus', 'bonuses', 'records', 'record', 'statement', 'statements', 'rate', 'rates', 'current', 'ytd', 'benefits', 'taxable', 'pre-tax', 'post-tax', 'reimbursements', 'reimbursement', 'fica', 'oasdi', 'disability', 'unemployment', 'sui', 'sdi', 'std', 'ltd', 'exemptions', 'exemption', 'allowances', 'allowance', 'filing', 'status', 'single', 'married', 'head', 'household', 'advice', 'frequency', 'bi-weekly', 'biweekly', 'weekly', 'monthly', 'semi-monthly', 'direct', 'deposit', 'routing', 'box', 'boxes', 'code', 'control', 'omb', 'copy', 'instructions', 'information', 'deferred', 'adoption', 'statutory', 'third-party', 'sick', 'form', 'schedule', 'w-2', 'w2', 'w-4', 'w4', '1099', 'k-1', '1040', 'fed', 'med', 'fwt', 'swt', 'fed w/h', 'fed med', 'locality', 'state wages', 'state tax', 'local wages', 'local tax', 'allocated', 'nonqualified', 'suff', 'suffix', 'allocated tips', 'advance eic', 'advance eic payment', 'dependent care', 'dependent care benefits', 'nonqualified plans', 'statutory employee', 'retirement plan', 'third-party sick pay']);

let JARGON_WORDS = new Set(['step', 'page', 'grade', 'version', 'course', 'class', 'follow', 'chapter', 'lesson', 'unit', 'marketing', 'manager', 'specialist', 'science', 'administration', 'university', 'skills', 'leadership', 'communication', 'working', 'proficiency', 'decision', 'driven', 'experience', 'summary', 'bachelor', 'ads', 'solutions', 'positioning', 'acquisition', 'strategy', 'research', 'database', 'forecast', 'interest', 'prepared', 'merchant', 'document', 'feedback', 'template', 'campaign', 'partners', 'settings', 'keystone', 'llm', 'gpt', 'chatgpt', 'openai', 'anthropic', 'claude', 'gemini', 'api', 'json', 'xml', 'html', 'css', 'javascript', 'python', 'golang', 'typescript', 'rust', 'fastapi', 'snowflake', 'kubernetes', 'terraform', 'docker', 'redis', 'kafka', 'pytorch', 'policy', 'terms', 'conditions', 'release', 'sprint', 'deployment', 'cluster', 'instance', 'package', 'module', 'revenue', 'margin', 'gross', 'quarter', 'system', 'code', 'data', 'cloud', 'server', 'database', 'artificial', 'intelligence', 'learning', 'generative', 'regular', 'hours', 'holiday', 'earnings', 'deductions', 'withheld', 'withholding', 'taxes', 'medicare', 'benefits', 'reimbursements', 'compensation', 'wages', 'code']);

let NOT_NAME_WORDS = new Set([
    // Grammatical & Sentence Starters
    'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'their', 'our', 'its', 'it', 'he', 'she', 'they', 'we', 'i', 'you', 'who', 'whom', 'which', 'what', 'whose', 'why', 'how', 'when', 'where', 'with', 'for', 'from', 'by', 'to', 'at', 'in', 'on', 'of', 'about', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'and', 'but', 'or', 'so', 'yet', 'im', "i'm", "you're", "they're", "we're", "it's", "he's", "she's", "that's", "there's", "what's", "who's", "i've", "you've", "we've", "they've", "i'll", "you'll", "we'll", "they'll", "i'd", "you'd", "we'd", "they'd",
    // Verbs, Auxiliaries, Commands & Imperatives
    'do', 'does', 'did', 'done', 'doing', 'dont', "don't", 'doesnt', "doesn't", 'didnt', "didn't", 'not', 'no', 'never', 'always',
    'be', 'is', 'am', 'are', 'was', 'were', 'been', 'being',
    'have', 'has', 'had', 'having',
    'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would', 'wont', "won't", 'wouldnt', "wouldn't", 'shouldnt', "shouldn't", 'couldnt', "couldn't", 'cant', "can't", 'cannot',
    'write', 'writing', 'written', 'writes', 'read', 'reading', 'reads',
    'wait', 'waiting', 'waited', 'waits', 'place', 'placing', 'placed', 'places',
    'display', 'displaying', 'displayed', 'displays',
    'provide', 'providing', 'provided', 'provides',
    'show', 'showing', 'shown', 'shows',
    'tell', 'telling', 'told', 'tells',
    'ask', 'asking', 'asked', 'asks',
    'use', 'using', 'used', 'uses',
    'select', 'selecting', 'selected', 'selects',
    'find', 'finding', 'findings', 'found', 'finds',
    'reference', 'referencing', 'referenced', 'references',
    'access', 'accessing', 'accessed', 'accesses',
    'note', 'noting', 'noted', 'notes',
    'get', 'getting', 'got', 'gotten', 'gets',
    'make', 'making', 'made', 'makes',
    'give', 'giving', 'given', 'gives',
    'take', 'taking', 'took', 'taken', 'takes',
    'put', 'putting', 'puts',
    'set', 'setting', 'sets',
    'keep', 'keeping', 'kept', 'keeps',
    'let', 'letting', 'lets',
    'leave', 'leaving', 'left', 'leaves',
    'run', 'running', 'ran', 'runs',
    'stop', 'stopping', 'stopped', 'stops',
    'start', 'starting', 'started', 'starts',
    'check', 'checking', 'checked', 'checks',
    'print', 'printing', 'printed', 'prints',
    'generate', 'generating', 'generated', 'generates',
    'create', 'creating', 'created', 'creates',
    'build', 'building', 'built', 'builds',
    'include', 'including', 'included', 'includes',
    'exclude', 'excluding', 'excluded', 'excludes',
    'format', 'formatting', 'formatted', 'formats',
    'change', 'changing', 'changed', 'changes',
    'send', 'sending', 'sent', 'sends',
    'receive', 'receiving', 'received', 'receives',
    'delete', 'deleting', 'deleted', 'deletes',
    'remove', 'removing', 'removed', 'removes',
    'insert', 'inserting', 'inserted', 'inserts',
    'update', 'updating', 'updated', 'updates',
    'review', 'reviewing', 'reviewed', 'reviews',
    'allow', 'allowing', 'allowed', 'allows',
    'deny', 'denying', 'denied', 'denies',
    'require', 'requiring', 'required', 'requires',
    'turn', 'turning', 'turned', 'turns',
    'switch', 'switching', 'switched', 'switches',
    'enable', 'enabling', 'enabled', 'enables',
    'disable', 'disabling', 'disabled', 'disables',
    'ensure', 'ensuring', 'ensured', 'ensures',
    'verify', 'verifying', 'verified', 'verifies',
    'execute', 'executing', 'executed', 'executes',
    'test', 'testing', 'tested', 'tests',
    'install', 'installing', 'installed', 'installs',
    'uninstall', 'uninstalling', 'uninstalled', 'uninstalls',
    'suppose', 'supposed', 'supposing', 'supposes',
    'respond', 'responding', 'responded', 'responds',
    'preserve', 'preserving', 'preserved', 'preserves',
    'replace', 'replacing', 'replaced', 'replaces',
    // Adverbs, Prepositions, Conjunctions & Modifiers
    'again', 'without', 'with', 'within', 'specific', 'specifically', 'permission', 'permissions',
    'underneath', 'above', 'below', 'between', 'among', 'together', 'separately', 'instead',
    'also', 'too', 'either', 'neither', 'both', 'each', 'every', 'all', 'some', 'any', 'none',
    'only', 'just', 'already', 'currently', 'more', 'most', 'less', 'least',
    'very', 'quite', 'rather', 'such', 'same', 'different', 'other', 'others', 'another',
    'like', 'unlike', 'similar', 'complete', 'completely', 'entire', 'entirely',
    'exact', 'exactly', 'approximate', 'approximately', 'general', 'generally',
    'direct', 'directly', 'indirect', 'indirectly', 'total', 'totally', 'full', 'fully',
    'partial', 'partially', 'own', 'proper', 'properly',
    'now', 'then', 'soon', 'later', 'here', 'there', 'everywhere', 'nowhere', 'somewhere', 'anywhere',
    'inside', 'outside', 'before', 'after', 'since', 'until', 'till',
    'while', 'whereas', 'unless', 'although', 'though', 'even', 'because',
    'therefore', 'however', 'furthermore', 'moreover', 'meanwhile', 'otherwise', 'besides', 'further',
    // Greetings & Salutations
    'hello', 'hi', 'hey', 'dear', 'greetings',
    // Document & Resume Structure
    'summary', 'experience', 'education', 'skills', 'languages', 'project', 'history', 'background', 'objective', 'profile', 'awards', 'honors', 'certifications', 'publications', 'interests', 'references', 'statement', 'statements', 'form', 'forms',
    // Business & Job Roles
    'manager', 'director', 'specialist', 'analyst', 'engineer', 'developer', 'consultant', 'officer', 'representative', 'agent', 'lead', 'leader', 'president', 'coordinator', 'admin', 'administrator', 'executive', 'founder', 'partner', 'intern', 'trainee', 'advisor', 'head', 'vp', 'chief',
    // Departments & Fields
    'marketing', 'sales', 'engineering', 'finance', 'accounting', 'legal', 'operations', 'support', 'recruiting', 'talent', 'acquisition', 'compliance', 'security', 'technical', 'development', 'product', 'design', 'creative', 'strategy', 'planning', 'analytics', 'science', 'business', 'administration',
    // Tools & Tech Concepts
    'google', 'ads', 'analytics', 'meta', 'hubspot', 'crm', 'salesforce', 'wordpress', 'mailchimp', 'adobe', 'figma', 'canva', 'slack', 'zoom', 'teams', 'microsoft', 'office', 'excel', 'word', 'powerpoint', 'notion', 'jira', 'confluence', 'github', 'gitlab', 'aws', 'gcp', 'azure', 'cloud', 'database', 'sql', 'python', 'golang', 'typescript', 'rust', 'fastapi', 'snowflake', 'kubernetes', 'terraform', 'docker', 'redis', 'kafka', 'pytorch', 'java', 'javascript', 'html', 'css', 'react', 'node', 'api', 'saas', 'b2b', 'b2c', 'url', 'domain', 'website', 'app', 'application', 'software', 'email', 'phone', 'contact', 'address',

    // General Academic & Professional vocabulary
    'bachelor', 'master', 'doctor', 'associate', 'degree', 'university', 'college', 'school', 'institute', 'academy', 'graduated', 'major', 'minor', 'gpa', 'cum', 'laude', 'honors', 'deans', 'list', 'scholarship',
    // Quality & Adjectives
    'results', 'driven', 'oriented', 'expert', 'professional', 'proven', 'track', 'record', 'creative', 'excellent', 'communication', 'verbal', 'written', 'native', 'fluent', 'bilingual', 'working', 'proficiency', 'strategic', 'interpersonal', 'teamwork', 'organizational', 'detail', 'analytical',
    // Common Resume / Business Phrases
    'results-driven', 'data-driven', 'customer-centric', 'detail-oriented', 'cross-functional', 'self-motivated', 'time-management', 'problem-solving', 'fast-paced', 'year-over-year',
    // Legal & Trust terms
    'trust', 'trustee', 'co-trustee', 'settlor', 'grantor', 'beneficiary', 'agreement', 'will', 'estate', 'witness', 'declaration', 'signatory', 'testator', 'notary', 'commission', 'county', 'state', 'court', 'article', 'section', 'paragraph', 'schedule', 'exhibit', 'amendment', 'addendum', 'power', 'attorney', 'guardian', 'executor', 'administrator', 'survivor', 'predecessor', 'successor', 'whereof', 'hereby', 'thereby', 'herein', 'therein', 'witnesseth', 'whereas', 'therefore', 'now', 'dated', 'effective', 'matter', 'case', 'cases', 'docket', 'dockets', 'number', 'numbers', 'firm', 'firms', 'lawyer', 'lawyers', 'counsel', 'counsels', 'counselstack', 'tier', 'tiers', 'finding', 'findings', 'connector', 'connectors', 'platform', 'platforms',
    // Medical & Clinical terms
    'clinical', 'note', 'notes', 'dx', 'rx', 'tx', 'hx', 'px', 'sx', 'type', 'diabetes', 'referred', 'referral', 'diagnosed', 'diagnosis', 'patient', 'insurance', 'bcbs', 'mrn', 'dob',
    // Tax & Payroll terms
    'wages', 'wage', 'tips', 'compensation', 'withheld', 'withholding', 'medicare', 'deductions', 'deduction', 'earning', 'earnings', 'gross', 'net', 'pay', 'payroll', 'paystub', 'taxable', 'exempt', 'allowance', 'allowances', 'regular', 'hours', 'holiday', 'overtime', 'commission', 'bonus', 'bonuses', 'records', 'record', 'statement', 'statements', 'rate', 'rates', 'current', 'ytd', 'benefits', 'taxable', 'pre-tax', 'post-tax', 'reimbursements', 'reimbursement', 'fica', 'oasdi', 'disability', 'unemployment', 'sui', 'sdi', 'std', 'ltd', 'exemptions', 'exemption', 'allowances', 'allowance', 'filing', 'status', 'single', 'married', 'head', 'household', 'advice', 'frequency', 'bi-weekly', 'biweekly', 'weekly', 'monthly', 'semi-monthly', 'direct', 'deposit', 'routing', 'box', 'boxes', 'code', 'control', 'omb', 'copy', 'instructions', 'information', 'deferred', 'adoption', 'statutory', 'third-party', 'sick', 'form', 'schedule', 'w-2', 'w2', 'w-4', 'w4', '1099', 'k-1', '1040', 'fed', 'med', 'fwt', 'swt', 'fed w/h', 'fed med', 'locality', 'state wages', 'state tax', 'local wages', 'local tax', 'allocated', 'nonqualified',
    // Common Web, UI, Compliance, Document & AI Terms (Suppresses false-positive Name detection on headlines, buttons, and badges)
    'types', 'type', 'leaked', 'leak', 'leaks', 'masked', 'mask', 'masking', 'leave', 'screen', 'screens', 'risk', 'risks', 'cluster', 'clusters', 'parameter', 'parameters', 'processing', 'process', 'processed', 'verified', 'verify', 'verification', 'playground', 'guide', 'guides', 'protection', 'protect', 'corporate', 'enterprise', 'log', 'logs', 'airplane', 'mode', 'zero', 'trust', 'top', 'data', 'live', 'scrubber', 'scrub', 'scrubbed', 'note', 'notes', 'secret', 'secrets', 'card', 'cards', 'raw', 'input', 'output', 'contains', 'contain', 'contained', 'platform', 'solutions', 'pricing', 'company', 'news', 'dashboard', 'add', 'chrome', 'sample', 'samples', 'try', 'terms', 'privacy', 'policy', 'policies', 'home', 'compliance', 'framework', 'frameworks', 'audit', 'audits', 'receipt', 'receipts', 'overview', 'explore', 'vectors', 'vector', 'standard', 'standards', 'status', 'preview', 'view', 'actions', 'action', 'button', 'buttons', 'option', 'options', 'general', 'specialized', 'custom', 'rule', 'rules', 'token', 'tokens', 'value', 'values', 'session', 'sessions', 'local', 'server', 'servers', 'cloud', 'ram', 'memory', 'offline', 'online', 'client', 'browser', 'extension', 'workspace', 'workplace', 'pan', 'phi', 'pii', 'soc', 'soc2', 'gdpr', 'hipaa', 'ccpa', 'iso27001', 'pci', 'dss', 'nist', 'chatgpt', 'claude', 'gemini', 'copilot', 'perplexity', 'deepseek', 'qwen', 'grok', 'llama', 'mistral', 'ai', 'llm', 'prompt', 'prompts', 'transmission', 'transit', 'egress', 'neutralized', 'stripped', 'isolated', 'isolation', 'unlocked', 'locked', 'unlock', 'download', 'copy', 'dismiss', 'close', 'save', 'settings', 'protect', 'reveal', 'unmask', 'restore', 'restored', 'export', 'import',
    // Games, Chess, and Playing Pieces
    'bishop', 'bishops', 'knight', 'knights', 'rook', 'rooks', 'pawn', 'pawns', 'king', 'kings', 'queen', 'queens', 'chessboard', 'checkmate', 'stalemate', 'castling', 'en passant', 'chess',
    // Colors & Visual Descriptors
    'white', 'black', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'gray', 'grey', 'dark', 'light', 'gold', 'silver', 'bronze',
    // Animation, 3D Rendering & Prompt Terminology
    'pixar', 'disney', 'animation', 'render', 'rendering', 'composition', 'cinematic', 'smooth', 'glides', 'glide', 'gliding', 'capture', 'captures', 'capturing', 'camera', 'orbit', 'orbits', 'orbiting', 'trapped', 'trap', 'trapping', 'square', 'squares', 'character', 'characters', 'expressive', 'living', 'texture', 'textures', 'reflection', 'reflections', 'grain', 'candlelight', 'wooden', 'polished', 'vertical', 'horizontal', 'macro', 'closeup', 'close-up', 'scene', 'scenes', 'shot', 'shots', 'shadow', 'shadows',
    // Email, Outreach, Guest Posting & Agency Business Vocabulary
    'guest', 'post', 'posts', 'posting', 'attached', 'attach', 'attachment', 'attachments', 'updated', 'update', 'updates', 'list', 'lists', 'line', 'lines', 'rate', 'rates', 'affordable', 'services', 'service', 'infotech', 'technologies', 'technology', 'agency', 'agencies', 'digital', 'marketing', 'traffic', 'smart', 'design', 'seo', 'per', 'host', 'hosting', 'sites', 'site', 'inbox', 'starred', 'snoozed', 'important', 'sent', 'drafts', 'draft', 'spam', 'bin', 'trash', 'purchases', 'travel', 'social', 'forums', 'promotions', 'promotion', 'reply', 'forward', 'labels', 'label', 'compose', 'message', 'messages', 'mailer', 'outreach', 'backlink', 'backlinks', 'domain', 'authority', 'da', 'dr', 'founder', 'ceo', 'cto', 'cfo', 'coo', 'vp', 'head', 'lead',
    // US States
    'california', 'texas', 'florida', 'york', 'illinois', 'pennsylvania', 'ohio', 'georgia', 'michigan', 'carolina', 'virginia', 'washington', 'arizona', 'massachusetts', 'tennessee', 'indiana', 'maryland', 'missouri', 'wisconsin', 'colorado', 'minnesota', 'alabama', 'louisiana', 'kentucky', 'oregon', 'oklahoma', 'connecticut', 'utah', 'iowa', 'nevada', 'arkansas', 'mississippi', 'kansas', 'new mexico', 'nebraska', 'idaho', 'hawaii', 'maine', 'new hampshire', 'rhode island', 'montana', 'delaware', 'south dakota', 'north dakota', 'alaska', 'vermont', 'wyoming',
    'f.3d', 'f.supp', 'u.s.c.', 'v.', 'plaintiff', 'defendant', 'v', 'u.s.', 'court', 'app.', 'reporter', 'cir.']);

const PROFILE_JARGON = {
    medical: ['sleep', 'apnea', 'symptom', 'symptoms', 'trauma', 'hypertension', 'health', 'disease', 'condition', 'diagnosis', 'treatment', 'medication', 'dose', 'patient', 'clinic', 'surgery', 'therapy', 'alcohol', 'cannabis', 'blood', 'pressure', 'heart', 'rate', 'emergency', 'contact', 'relationship', 'type', 'diabetes', 'cancer', 'asthma', 'copd', 'covid', 'infection', 'syndrome', 'disorder', 'chronic', 'acute', 'illness', 'fever', 'allergy', 'pain', 'referral', 'referred', 'prescription', 'prescribed', 'doctor', 'physician', 'nurse', 'hospital', 'clinical', 'note', 'notes', 'dx', 'rx', 'tx', 'hx', 'px', 'sx', 'insurance', 'bcbs'],
    realestate: ['escrow', 'tenant', 'landlord', 'lease', 'mortgage', 'appraisal', 'broker', 'property', 'zoning', 'parcel', 'rent', 'buyer', 'seller', 'agent', 'listing'],
    legal: ['testator', 'notary', 'commission', 'county', 'court', 'affidavit', 'plaintiff', 'defendant', 'litigation', 'jurisdiction', 'agreement', 'contract', 'settlement', 'clause', 'article', 'section', 'matter', 'case'],
    hr: ['candidate', 'employee', 'payroll', 'benefits', 'salary', 'vacation', 'supervisor', 'subordinate', 'performance', 'appraisal', 'interview', 'resume', 'applicant'],
    sales: ['prospect', 'opportunity', 'quota', 'pipeline', 'deal', 'revenue', 'forecast', 'lead', 'churn', 'client', 'customer']
};
    // --- END DEFAULT RULES ---

    function hydrateRegex(r) {
        if (r && typeof r.regex === 'string') {
            if (r.regex.startsWith('/')) {
                try {
                    const lastSlash = r.regex.lastIndexOf('/');
                    const pattern = r.regex.substring(1, lastSlash);
                    const flags = r.regex.substring(lastSlash + 1);
                    return { ...r, regex: new RegExp(pattern, flags) };
                } catch (e) {
                    console.error('Failed to hydrate regex:', r.regex, e);
                    return r;
                }
            } else {
                return { ...r, regex: new RegExp(r.regex, 'gi') };
            }
        }
        return r;
    }

    function init(config) {
        if (!config) return;
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
    }

    const PROFILE_ALIAS_MAP = {
        'general': 'general',
        'underwriting': 'underwriting', 'lending': 'underwriting', 'mortgage': 'underwriting', 'loan': 'underwriting', 'income': 'underwriting', 'income_verification': 'underwriting', 'payroll': 'underwriting', 'w2': 'underwriting', 'paystub': 'underwriting',
        'medical': 'medical', 'healthcare': 'medical', 'health': 'medical', 'pharma': 'pharma',
        'engineering': 'engineering', 'dev': 'engineering', 'devops': 'engineering', 'tech': 'tech',
        'finance': 'finance', 'bizops': 'bizops', 'sales': 'sales', 'wealthmgmt': 'wealthmgmt', 'wealth': 'wealthmgmt', 'insurance': 'insurance', 'accounting': 'accounting',
        'legal': 'legal', 'compliance': 'compliance', 'ccpa': 'ccpa',
        'hr': 'hr', 'security': 'security', 'marketing': 'marketing', 'support': 'support',
        'realestate': 'realestate', 'academic': 'academic', 'agents': 'agents', 'ai_agents': 'agents', 'creative': 'creative', 'personal': 'personal'
    };

    function getActiveRules(activeProfile) {
        let activeRules = [...REGEX_RULES];
        if (activeProfile && activeProfile.toLowerCase() !== 'general') {
            const canonicalProfile = PROFILE_ALIAS_MAP[activeProfile.toLowerCase()] || 'general';
            if (canonicalProfile !== 'general' && PROFILE_RULES[canonicalProfile]) {
                activeRules = PROFILE_RULES[canonicalProfile].concat(activeRules);
            }
        }
        return activeRules;
    }

    function stitchOrphanedNameLines(text, profile) {
        if (profile === 'medical') {
            text = text.replace(/Patient Name:\s*\n+([A-Z][a-zA-Z]+\s[A-Z][a-zA-Z]+)/g, 'Patient Name: $1');
        } else if (profile === 'legal') {
            text = text.replace(/Defendant:\s*\n+([A-Z][a-zA-Z]+\s[A-Z][a-zA-Z]+)/g, 'Defendant: $1');
        }
        return text;
    }

    function detectMatches(text, activeProfile = 'general', customRules = [], nlpNames = [], enabledEntities = null, mlEntities = []) {
        let textToProcess = text.replace(/[\u200b\u200c\u200d\ufeff]/g, '');
        textToProcess = textToProcess.replace(/([a-zA-Z])(Email|Phone|Mobile|Tel|Address|IP|ID|URL|SSN|Date):/g, '$1 $2:');

        let matches = [];
        
        if (customRules && customRules.length > 0) {
            const sorted = [...customRules].sort((a, b) => {
                const patternA = typeof a === 'string' ? a : (a.pattern || (a.regex ? a.regex.source : '') || '');
                const patternB = typeof b === 'string' ? b : (b.pattern || (b.regex ? b.regex.source : '') || '');
                return patternB.length - patternA.length;
            });
            
            sorted.forEach(cr => {
                const pattern = typeof cr === 'string' ? cr : (cr.pattern || (cr.regex ? cr.regex.source : ''));
                if (!pattern) return;
                const label = typeof cr === 'string' ? 'CUSTOM' : (cr.label || cr.mask || cr.name || 'CUSTOM');
                
                let rx;
                try {
                    const isExact = !/(\^|\$|\\[bBdDwWsS]|\[|\(|\{|\*|\+|\|)/.test(pattern);
                    if (isExact) {
                        const safe = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        rx = new RegExp(`(?:^|\\b)${safe}(?:\\b|$)`, 'gi');
                    } else {
                        rx = new RegExp(pattern, 'gi');
                    }
                } catch (e) {
                    return;
                }
                if (rx.test('')) return;
                rx.lastIndex = 0;
                let m;
                while ((m = rx.exec(textToProcess)) !== null) {
                    matches.push({ start: m.index, end: m.index + m[0].length, value: m[0], type: 'CUSTOM', customLabel: label });
                }
            });
        }

        const activeRules = getActiveRules(activeProfile);
        const currentJargon = PROFILE_JARGON[PROFILE_ALIAS_MAP[activeProfile?.toLowerCase()]] ? new Set([...JARGON_WORDS, ...PROFILE_JARGON[PROFILE_ALIAS_MAP[activeProfile?.toLowerCase()]]]) : JARGON_WORDS;

        activeRules.forEach(rule => {
            if (enabledEntities && enabledEntities.indexOf(rule.type) === -1) return;
            if (!rule.regex) return;
            
            rule.regex.lastIndex = 0;
            let m;
            while ((m = rule.regex.exec(textToProcess)) !== null) {
                let matchedText = m[0];
                let start = m.index;
                
                if (m.length > 1 && m[1] !== undefined && m[1] !== '') {
                    matchedText = m[1];
                    const relOffset = m[0].indexOf(m[1]);
                    if (relOffset !== -1) {
                        start = m.index + relOffset;
                    }
                }
                const end = start + matchedText.length;
                
                if (rule.type !== 'NAME' && rule.type !== 'ADDRESS') {
                    const val = matchedText.toLowerCase().trim();
                    if (NAME_STOP_LIST.has(val) || NOT_NAME_WORDS.has(val)) {
                        // Skip if generic English dictionary term matched by greedy regex (e.g. SWIFT matching SCRUBBER or CONTAINS)
                        if (rule.type === 'FINANCIAL' || rule.type === 'ID' || rule.type === 'PRIVACY' || rule.type === 'SECRET') {
                            continue;
                        }
                    }
                    matches.push({ start, end, value: matchedText, type: rule.type });
                } else {
                    let val = matchedText.toLowerCase().trim();
                    if (NAME_STOP_LIST.has(val)) continue;
                    
                    if (!rule.isContextName && rule.type === 'NAME') {
                        let words = val.split(/[ \t\xA0]+/);
                        let origWords = matchedText.split(/[ \t\xA0]+/);
                        while (words.length > 2 && (currentJargon.has(words[0]) || (words[0].length > 1 && NOT_NAME_WORDS.has(words[0])) || (words[0].replace(/[^\p{L}]/gu, '').length > 1 && NOT_NAME_WORDS.has(words[0].replace(/[^\p{L}]/gu, ''))))) {
                            origWords.shift();
                            words.shift();
                            const nextStart = matchedText.indexOf(origWords[0]);
                            if (nextStart !== -1) {
                                start += nextStart;
                                matchedText = matchedText.substring(nextStart);
                                val = matchedText.toLowerCase().trim();
                            } else {
                                break;
                            }
                        }
                        if (words.some(w => {
                            const cleanW = w.replace(/[^\p{L}]/gu, '');
                            if (cleanW.length <= 1) return false;
                            return currentJargon.has(w) || NOT_NAME_WORDS.has(w) || NOT_NAME_WORDS.has(cleanW) || NAME_STOP_LIST.has(w) || NAME_STOP_LIST.has(cleanW);
                        })) continue;
                    } else if (rule.type === 'ADDRESS') {
                        const cleanVal = val.replace(/[.,;!?]/g, ' ').trim();
                        if (NAME_STOP_LIST.has(cleanVal) || currentJargon.has(cleanVal)) continue;
                    }
                    
                    matches.push({ start, end: start + matchedText.length, value: matchedText, type: rule.type });
                }
            }
        });

        if (nlpNames && nlpNames.length > 0) {
            nlpNames.forEach(name => {
                const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const rx = new RegExp(`(?<=^|[^\\p{L}\\p{N}_])${safeName}(?=[^\\p{L}\\p{N}_]|$)`, 'gu');
                let m;
                while ((m = rx.exec(textToProcess)) !== null) {
                    matches.push({ start: m.index, end: m.index + m[0].length, value: m[0], type: 'NAME' });
                }
            });
        }
        
        if (mlEntities && mlEntities.length > 0) {
            mlEntities.forEach(item => {
                const safeName = item.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const rx = new RegExp(`(?<=^|[^\\p{L}\\p{N}_])${safeName}(?=[^\\p{L}\\p{N}_]|$)`, 'giu');
                let m;
                while ((m = rx.exec(textToProcess)) !== null) {
                    matches.push({ start: m.index, end: m.index + m[0].length, value: m[0], type: item.type });
                }
            });
        }

        const learnedNames = new Set();
        matches.forEach(m => {
            if (m.type === 'NAME') {
                const nameWords = m.value.split(/[^\p{L}'-]+/u);
                nameWords.forEach(w => {
                    if (w && w.length >= 2 && /^\p{Lu}/u.test(w)) {
                        const wl = w.toLowerCase();
                        if (!NOT_NAME_WORDS.has(wl) && !JARGON_WORDS.has(wl) && !NAME_STOP_LIST.has(wl) && !currentJargon.has(wl)) {
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
                while ((m = rx.exec(textToProcess)) !== null) {
                    matches.push({ start: m.index, end: m.index + m[0].length, value: m[0], type: 'NAME' });
                }
            });
        }

        matches.sort((a, b) => a.start - b.start || b.end - a.end);
        let filtered = [];
        let lastEnd = 0;
        matches.forEach(m => {
            if (m.start >= lastEnd) { filtered.push(m); lastEnd = m.end; }
        });

        return { filteredMatches: filtered, processedText: textToProcess };
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
        if (LABEL_ALIASES[upper]) return LABEL_ALIASES[upper];
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
        const ObjectKeys = Object.keys(tokenMap);
        if (ObjectKeys.length === 0) return { compositeRegex: null, looseRules: [] };

        const sortedKeys = [...ObjectKeys].sort((a, b) => {
            const innerA = a.replace(/^\[|<|\{\{|__|\]|>|\}\}|__/g, '');
            const innerB = b.replace(/^\[|<|\{\{|__|\]|>|\}\}|__/g, '');
            const matchA = innerA.match(/^([A-Za-z_0-9]+?)[-_]?(\d+)$/);
            const matchB = innerB.match(/^([A-Za-z_0-9]+?)[-_]?(\d+)$/);
            if (matchA && matchB) {
                const idxA = parseInt(matchA[2], 10);
                const idxB = parseInt(matchB[2], 10);
                const labelA = matchA[1];
                const labelB = matchB[1];
                if (idxA !== idxB) return idxB - idxA;
                if (labelA.length !== labelB.length) return labelB.length - labelA.length;
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
                const loosePattern = `(?:\\[\\s*${aliasesGroup}[-_\\s]*0*${baseIndex}\\s*\\]|<\\s*${aliasesGroup}[-_\\s]*0*${baseIndex}\\s*>|\\{\\{\\s*${aliasesGroup}[-_\\s]*0*${baseIndex}\\s*\\}\\}|__\\s*${aliasesGroup}[-_\\s]*0*${baseIndex}\\s*__|(?<![A-Za-z0-9\\u0400-\\u04FF_])${aliasesGroup}[-_\\s]*0*${baseIndex}(?![A-Za-z0-9\\u0400-\\u04FF_]))(?:'s|’s|s|[а-яёА-ЯЁ]{1,3})?`;
                looseRules.push({ token: k, pattern: loosePattern });
            }
            regexParts.push(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        });

        let compositeRegex = null;
        if (regexParts.length > 0) {
            compositeRegex = new RegExp(`(?:\\b|\\[|<|\\{\\{|__)?(?:(?:(?<!\\w)|(?<=\\s))(?:${regexParts.join('|')})(?:(?!\\w)|(?=\\s)))(?:\\b|\\]|>|\\}\\}|__)?(?:'s|’s|s|[а-яёА-ЯЁ]{1,3})?`, 'g');
        }

        return { compositeRegex, looseRules };
    }

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
            // 1. Strip raw CSS / style blocks leaked from ChatGPT Canvas, web components or stylesheets (handles multi-line, unclosed and variable definitions)
            cleaned = cleaned.replace(/^\s*(?:[.#][a-zA-Z0-9_-]+|\[[a-zA-Z0-9_#.:\-*>=,'"\s]+\]|:is\([^)]+\)|[a-zA-Z0-9_-]+)?\s*\{[^}]*?(?:\}\s*|\n\n+|$)/gi, "");
            cleaned = cleaned.replace(/^[;{} \t\r\n]+/, "");
            cleaned = cleaned.replace(/(?:^|\n)[a-zA-Z0-9_#.:\-*>[\]=\s,'"]+\{[^}]*(--[a-zA-Z0-9_-]+:|color-mix\(|var\()[^}]*\}/g, "");
        }
        // 2. Strip AI author prefixes and platform artifacts
        cleaned = cleaned.replace(/^\s*(?:Claude responded|Claude|ChatGPT|Gemini|Grok|DeepSeek|Kimi|Copilot|Assistant|User)\s*(?::|\bsaid\b|\bresponded\b|(?=\s))\s*/i, "");
        cleaned = cleaned.replace(/^(?:Here (?:is|are) (?:the )?(?:redacted|scrubbed|sanitized|processed|clean|updated|modified) (?:text|output|version|data).*?[:\n]+|\*\*Scrubbed Text\*\*[:\n]+|### Scrubbed Text[:\n]+)/i, '');
        cleaned = cleaned.replace(/^\s*Edit\s*\n+/i, "");
        cleaned = cleaned.replace(/\s*\bEdit\s+in\s+a\s+page\b\s*$/i, "");
        // 3. Strip stray leading colons, semicolons, or separators left by stripped icons/artifact headers
        cleaned = cleaned.replace(/^[:;|\-\—\–]+(?=\n|$)/, "");
        cleaned = cleaned.replace(/^[:;]+\s*/, "");
        return cleaned.trim();
    }

    function buildFastTokenLookup(sessionMap) {
        const lookup = new Map();
        const customRegexParts = [];
        const keys = Object.keys(sessionMap || {});
        
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const v = sessionMap[k];
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

    function resolveTokenValue(rawMatch, targetTokenKey, sessionMap) {
        if (!sessionMap) return undefined;
        if (sessionMap[targetTokenKey] !== undefined) return sessionMap[targetTokenKey];
        if (sessionMap[rawMatch] !== undefined) return sessionMap[rawMatch];
        const cleanRaw = rawMatch.replace(/^\[|<|\{\{|__|\]|>|\}\}|__/g, '').trim();
        for (const k of Object.keys(sessionMap)) {
            const cleanK = k.replace(/^\[|<|\{\{|__|\]|>|\}\}|__/g, '').trim();
            if (cleanK.toLowerCase() === cleanRaw.toLowerCase()) {
                return sessionMap[k];
            }
        }
        return undefined;
    }

    function unscrubText(text, sessionMap) {
        let restoredCount = 0;
        let result = text;
        const tokens = Object.keys(sessionMap || {});
        if (tokens.length === 0) return { text: result, count: 0 };
        
        result = cleanAIPromptPrefix(result);

        if (tokens.length > 50) {
            const { lookup, tokenRegex } = buildFastTokenLookup(sessionMap);
            result = result.replace(tokenRegex, (match) => {
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
            return { text: result, count: restoredCount };
        }

        const { compositeRegex, looseRules } = buildRestorationRegexAndRules(sessionMap);

        if (compositeRegex) {
            result = result.replace(compositeRegex, (match) => {
                const suffixMatch = match.match(/(?:'s|’s|s|[а-яёА-ЯЁ]{1,3})$/);
                const suffix = suffixMatch ? suffixMatch[0] : '';
                const baseMatch = suffix ? match.slice(0, -suffix.length) : match;
                const cleanMatch = baseMatch.replace(/^\[|<|\{\{|__|\]|>|\}\}|__/g, '').trim();
                const token = `[${cleanMatch}]`;

                const val = resolveTokenValue(baseMatch, token, sessionMap) ?? resolveTokenValue(baseMatch, cleanMatch, sessionMap);
                if (val !== undefined) {
                    restoredCount++;
                    return val + suffix;
                }
                return match;
            });
        }

        looseRules.forEach(rule => {
            const rx = new RegExp(rule.pattern, 'gi');
            result = result.replace(rx, (match) => {
                const suffixMatch = match.match(/(?:'s|’s|s|[а-яёА-ЯЁ]{1,3})$/);
                const suffix = suffixMatch ? suffixMatch[0] : '';
                const baseMatch = suffix ? match.slice(0, -suffix.length) : match;

                const val = sessionMap[rule.token] ?? resolveTokenValue(baseMatch, rule.token, sessionMap);
                if (val !== undefined) {
                    restoredCount++;
                    return val + suffix;
                }
                return match;
            });
        });

        return { text: result, count: restoredCount };
    }

    function escapeHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function unscrubTextAsHTML(text, sessionMap) {
        let restoredCount = 0;
        let cleaned = cleanAIPromptPrefix(text || '');
        let result = escapeHTML(cleaned);
        const tokens = Object.keys(sessionMap || {});
        if (tokens.length === 0) return { text: result, count: 0 };

        if (tokens.length > 50) {
            const { lookup, tokenRegex } = buildFastTokenLookup(sessionMap);
            result = result.replace(tokenRegex, (match) => {
                let rawVal = null;
                let suffix = '';
                if (lookup.has(match)) {
                    rawVal = lookup.get(match);
                } else if (lookup.has(match.toUpperCase())) {
                    rawVal = lookup.get(match.toUpperCase());
                } else {
                    const possMatch = match.match(/^([\s\S]+?)('s|’s|s|[а-яёА-ЯЁ]{1,3})$/);
                    if (possMatch) {
                        const base = possMatch[1];
                        suffix = possMatch[2];
                        if (lookup.has(base)) rawVal = lookup.get(base);
                        else if (lookup.has(base.toUpperCase())) rawVal = lookup.get(base.toUpperCase());
                    }
                }
                if (rawVal !== null) {
                    restoredCount++;
                    const escapedVal = escapeHTML(rawVal);
                    const cleanMatch = match.replace(/^\[|<|\{\{|__|\]|>|\}\}|__/g, '').trim();
                    return `<span class="ps-restored-data entity-tag entity-revealed" title="Original Token: ${escapeHTML(cleanMatch)}">${escapedVal}</span>${escapeHTML(suffix)}`;
                }
                return match;
            });
            return { text: result, count: restoredCount };
        }

        const { compositeRegex, looseRules } = buildRestorationRegexAndRules(sessionMap);

        if (compositeRegex) {
            result = result.replace(compositeRegex, (match) => {
                const suffixMatch = match.match(/(?:'s|’s|s|[а-яёА-ЯЁ]{1,3})$/);
                const suffix = suffixMatch ? suffixMatch[0] : '';
                const baseMatch = suffix ? match.slice(0, -suffix.length) : match;
                const cleanMatch = baseMatch.replace(/^\[|<|\{\{|__|\]|>|\}\}|__/g, '').trim();
                const token = `[${cleanMatch}]`;

                const val = resolveTokenValue(baseMatch, token, sessionMap) ?? resolveTokenValue(baseMatch, cleanMatch, sessionMap);
                if (val !== undefined) {
                    restoredCount++;
                    const escapedVal = escapeHTML(val);
                    return `<span class="ps-restored-data entity-tag entity-revealed" title="Original Token: ${escapeHTML(token)}">${escapedVal}</span>${escapeHTML(suffix)}`;
                }
                return match;
            });
        }

        looseRules.forEach(rule => {
            const rx = new RegExp(rule.pattern, 'gi');
            result = result.replace(rx, (match, offset, fullStr) => {
                const before = fullStr.substring(0, offset);
                const lastOpen = before.lastIndexOf('<');
                const lastClose = before.lastIndexOf('>');
                if (lastOpen > lastClose) return match;

                const suffixMatch = match.match(/(?:'s|’s|s|[а-яёА-ЯЁ]{1,3})$/);
                const suffix = suffixMatch ? suffixMatch[0] : '';
                const baseMatch = suffix ? match.slice(0, -suffix.length) : match;

                const val = sessionMap[rule.token] ?? resolveTokenValue(baseMatch, rule.token, sessionMap);
                if (val !== undefined) {
                    restoredCount++;
                    const escapedVal = escapeHTML(val);
                    return `<span class="ps-restored-data entity-tag entity-revealed" title="Original Token: ${escapeHTML(rule.token)} (Fuzzy Match)">${escapedVal}</span>${escapeHTML(suffix)}`;
                }
                return match;
            });
        });

        return { text: result, count: restoredCount };
    }

    const PrivacyScrubberEngine = {
        init,
        hydrateRegex,
        getActiveRules,
        stitchOrphanedNameLines,
        detectMatches,
        getRulesMap: () => ({ REGEX_RULES, PROFILE_RULES }),
        getDevopsRules: () => DEVOPS_SECRETS,
        LABEL_ALIASES,
        getLabelAliases,
        PROFILE_ALIAS_MAP,
        formatToken,
        buildRestorationRegexAndRules,
        unscrubText,
        unscrubTextAsHTML,
        cleanAIPromptPrefix,
        // Expose underlying constants for Node scripts & build pipeline proxy
        REGEX_RULES,
        PROFILE_RULES,
        NAME_STOP_LIST,
        JARGON_WORDS,
        NOT_NAME_WORDS,
        PROFILE_JARGON,
    };

    if (typeof exports !== 'undefined') {
        module.exports = PrivacyScrubberEngine;
    }
    if (typeof self !== 'undefined') {
        self.PrivacyScrubberEngine = PrivacyScrubberEngine;
    }
    if (typeof window !== 'undefined') {
        window.PrivacyScrubberEngine = PrivacyScrubberEngine;
    }
})();
