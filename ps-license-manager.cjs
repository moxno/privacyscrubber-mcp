(function(global) {
    // ── START LICENSE CRYPTO ──
    const PUBLIC_KEY_N = BigInt("21317979104050344678233452423803986868842680501941538057759536089609908024281729760556922188810565541201321990374637212776148857190553192389608364990754937991254608109727112734447704854882786946805547031142530865504430968628760311494129154950865158735816268612258108296781892583171421605668998979064782378729322077179022581884976242706169323540456286526420742434868559866211716347133681429395477256705746276962607312574959642065929462114149296066812527505837608212730874704915352119747022918247963886630350365119206627670591400728523813746184290857872958847087691236909900501703203494160206941648263514117706558791691");
    const PUBLIC_KEY_E = 65537n;

    function modPow(base, exp, mod) {
        let res = 1n;
        base = base % mod;
        while (exp > 0n) {
            if (exp % 2n === 1n) res = (res * base) % mod;
            exp = exp / 2n;
            base = (base * base) % mod;
        }
        return res;
    }

    function bigIntToString(bi) {
        let hex = bi.toString(16);
        if (hex.length % 2 !== 0) hex = '0' + hex;
        let str = '';
        for (let i = 0; i < hex.length; i += 2) {
            str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        }
        return str;
    }

    function stringToBigInt(str) {
        let hex = '';
        for (let i = 0; i < str.length; i++) {
            hex += str.charCodeAt(i).toString(16).padStart(2, '0');
        }
        return BigInt('0x' + hex);
    }

    function sha256(ascii) {
        function rightRotate(value, amount) { return (value>>>amount) | (value<<(32 - amount)); }
        var mathPow = Math.pow; var maxWord = mathPow(2, 32);
        var lengthProperty = 'length'; var i, j;
        var result = ''; var words = []; var asciiBitLength = ascii[lengthProperty]*8;
        var hash = sha256.h = sha256.h || [];
        var k = sha256.k = sha256.k || [];
        var primeCounter = k[lengthProperty];
        var isComposite = {};
        for (var candidate = 2; primeCounter < 64; candidate++) {
            if (!isComposite[candidate]) {
                for (i = 0; i < 313; i += candidate) { isComposite[i] = candidate; }
                hash[primeCounter] = (mathPow(candidate, .5)*maxWord)|0;
                k[primeCounter++] = (mathPow(candidate, 1/3)*maxWord)|0;
            }
        }
        ascii += '\x80';
        while (ascii[lengthProperty]%64 - 56) ascii += '\x00';
        for (i = 0; i < ascii[lengthProperty]; i++) {
            j = ascii.charCodeAt(i);
            if (j>>8) return; 
            words[i>>2] |= j << ((3 - i)%4)*8;
        }
        words[words[lengthProperty]] = ((asciiBitLength/maxWord)|0);
        words[words[lengthProperty]] = (asciiBitLength)
        for (j = 0; j < words[lengthProperty];) {
            var w = words.slice(j, j += 16);
            var oldHash = hash;
            hash = hash.slice(0, 8);
            for (i = 0; i < 64; i++) {
                var w15 = w[i - 15], w2 = w[i - 2];
                var a = hash[0], e = hash[4];
                var temp1 = hash[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e&hash[5])^((~e)&hash[6])) + k[i] + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15>>>3)) + w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2>>>10)))|0);
                var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a&hash[1])^(a&hash[2])^(hash[1]&hash[2]));
                hash = [(temp1 + temp2)|0].concat(hash);
                hash[4] = (hash[4] + temp1)|0;
            }
            for (i = 0; i < 8; i++) { hash[i] = (hash[i] + oldHash[i])|0; }
        }
        for (i = 0; i < 8; i++) {
            for (j = 3; j + 1; j--) {
                var b = (hash[i]>>(j*8))&255;
                result += ((b < 16) ? 0 : '') + b.toString(16);
            }
        }
        return result;
    }
    // ── END LICENSE CRYPTO ──

    class LicenseManager {
        /**
         * Validates a license key universally across all environments.
         * @param {string} key - The license key.
         * @param {object} options - Options mapping to environment specifics.
         * @returns {object} { valid: boolean, tier: string|null, reason?: string, expires?: number }
         */
        static validate(key, options = {}) {
            if (!key) return { valid: false, tier: null, reason: "No key provided" };
            const rawKey = key.trim();
            const k = rawKey.toUpperCase();
            const parts = k.split('-');
            
            const now = options.mockTime !== undefined && options.mockTime !== null ? options.mockTime : Date.now();
            let lastSeen = 0;
            
            if (options.storage) {
                lastSeen = parseInt(options.storage.getItem('ps_last_seen_time') || '0', 10);
                if (options.mockTime === undefined || options.mockTime === null) {
                    options.storage.setItem('ps_last_seen_time', now.toString());
                }
            }
            
            // Clock rollback guard
            if ((options.mockTime === undefined || options.mockTime === null) && now < lastSeen) {
                if (options.onAnomaly) options.onAnomaly();
                return { valid: false, tier: null, reason: "Clock rollback anomaly detected" };
            }

            const _atob = typeof atob !== 'undefined' ? atob : (str) => Buffer.from(str, 'base64').toString('binary');
            
            // 1. Process Pilot Keys (RSA-1024 Encrypted Timestamps)
            if (k.startsWith('PS-PILOT-')) {
                try {
                    const payload = rawKey.substring(9);
                    const binary = _atob(payload);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }
                    let hex = '';
                    for (let i = 0; i < bytes.length; i++) {
                        hex += bytes[i].toString(16).padStart(2, '0');
                    }
                    const S = BigInt('0x' + hex);
                    
                    const M = modPow(S, PUBLIC_KEY_E, PUBLIC_KEY_N);
                    const decryptedStr = bigIntToString(M);
                    
                    if (decryptedStr.startsWith('ZTDS-PILOT-')) {
                        const expDate = parseInt(decryptedStr.substring(11), 10);
                        if (!isNaN(expDate)) {
                            if (now < expDate) return { valid: true, tier: 'TEAMS', expires: expDate };
                            
                            if (options.onExpired) options.onExpired('Pilot');
                            return { valid: false, tier: null, reason: "Pilot expired" };
                        }
                    }
                } catch(e) { 
                    return { valid: false, tier: null, reason: "Pilot decryption failed" }; 
                }
            }
            
            // 1.5. Process RSA Signed Keys (PS-RSA-...)
            if (k.startsWith('PS-RSA-')) {
                try {
                    const payload = rawKey.substring(7);
                    const binary = _atob(payload);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }
                    let hex = '';
                    for (let i = 0; i < bytes.length; i++) {
                        hex += bytes[i].toString(16).padStart(2, '0');
                    }
                    const S = BigInt('0x' + hex);
                    
                    const M = modPow(S, PUBLIC_KEY_E, PUBLIC_KEY_N);
                    const decryptedStr = bigIntToString(M);
                    
                    if (decryptedStr.startsWith('ZTDS-LIC-')) {
                        const pieces = decryptedStr.split('-');
                        if (pieces.length >= 5) {
                            const tier = pieces[2];
                            const expires = parseInt(pieces[4], 10);
                            if (!isNaN(expires)) {
                                if (now < expires) return { valid: true, tier: tier, expires: expires };
                                
                                if (options.onExpired) options.onExpired('RSA');
                                return { valid: false, tier: null, reason: "RSA key expired" };
                            }
                        }
                    }
                } catch(e) { 
                    return { valid: false, tier: null, reason: "RSA decryption failed" }; 
                }
            }
            
            // 2. Process Modern Prefixed Keys (v1.4.2+ Salted Checksum)
            if (parts.length === 4 && parts[0] === 'PS' && ['PRO', 'TEAMS', 'SDK', 'OEM', 'ENTERPRISE'].includes(parts[1])) {
                const tier = parts[1];
                const core = parts[2];
                const checksum = parts[3];
                const salt = "ZTDS_SALT_2026_!@#";
                const input = core + salt + tier;
                let sum = 0;
                for (let i = 0; i < input.length; i++) {
                    sum += input.charCodeAt(i) * (i + 1);
                }
                const expectedChecksum = (sum % 9999).toString().padStart(4, '0');
                if (checksum === expectedChecksum) {
                    return { valid: true, tier: tier };
                }
            }

            // 3. Process Standard RS256 JWTs (eyJ...)
            if (rawKey.startsWith('eyJ') && rawKey.split('.').length === 3) {
                try {
                    const [b64Header, b64Payload, b64Signature] = rawKey.split('.');
                    
                    let sigStr = b64Signature.replace(/-/g, '+').replace(/_/g, '/');
                    while (sigStr.length % 4) sigStr += '=';
                    const binarySig = _atob(sigStr);
                    let hexSig = '';
                    for (let i = 0; i < binarySig.length; i++) {
                        hexSig += binarySig.charCodeAt(i).toString(16).padStart(2, '0');
                    }
                    
                    const S = BigInt('0x' + hexSig);
                    const M = modPow(S, PUBLIC_KEY_E, PUBLIC_KEY_N);
                    
                    let mHex = M.toString(16);
                    if (mHex.length % 2 !== 0) mHex = '0' + mHex;
                    
                    const expectedHash = sha256(b64Header + '.' + b64Payload);
                    
                    if (mHex.endsWith(expectedHash)) {
                        const payloadJson = _atob(b64Payload.replace(/-/g, '+').replace(/_/g, '/'));
                        const payload = JSON.parse(payloadJson);
                        
                        if (payload.exp && (now / 1000) < payload.exp) {
                            return { valid: true, tier: payload.tier || 'PRO', expires: payload.exp * 1000 };
                        } else {
                            if (options.onExpired) options.onExpired('JWT');
                            return { valid: false, tier: null, reason: "JWT expired" };
                        }
                    }
                } catch(e) { 
                    return { valid: false, tier: null, reason: "JWT validation failed" }; 
                }
            }

            return { valid: false, tier: null, reason: "Invalid format" };
        }
    }

    // Export module for ES modules, CommonJS, and Browser Global
    if (typeof globalThis !== 'undefined') {
        globalThis.LicenseManager = LicenseManager;
    }
    if (typeof global !== 'undefined') {
        global.LicenseManager = LicenseManager;
    }
    if (typeof window !== 'undefined') {
        window.LicenseManager = LicenseManager;
    }
    if (typeof exports !== 'undefined') {
        if (typeof module !== 'undefined' && module.exports) {
            module.exports = LicenseManager;
        }
        exports.LicenseManager = LicenseManager;
    }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
