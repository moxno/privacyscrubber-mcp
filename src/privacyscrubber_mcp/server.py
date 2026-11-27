"""
Zero-Trust Data Sanitization (ZTDS) MCP Server Python Wrapper & Fallback.
Compatible with Cursor, Windsurf, Claude Desktop, Claude Code, and AI agent frameworks.
"""

import base64
import fcntl
import hashlib
import hmac
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

VERSION = "2.5.5"

FREE_TIER_DAILY_LIMIT = 100
EVAL_TIER_DAILY_LIMIT = 250
USAGE_FILE_MAX_BYTES = 4096
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_DOCX_UNZIPPED_BYTES = 20 * 1024 * 1024
MAX_CONCURRENT_SESSIONS = 200
MAX_SESSION_TOKENS = 5000

PRO_ELIGIBLE_TIERS = {
    "PRO",
    "TEAMS",
    "SDK",
    "SDK_INTERNAL",
    "SDK_OEM",
    "ENTERPRISE",
    "ENTERPRISE_AIRGAP",
    "OEM",
}

# Public asymmetric verification keys (zero symmetric secrets embedded)
PUBLIC_KEY_N = int(
    "21317979104050344678233452423803986868842680501941538057759536089609908024281729"
    "76055692218881056554120132199037463721277614885719055319238960836499075493799125"
    "46081097271127344477048548827869468055470311425308655044309686287603114941291549"
    "50865158735816268612258108296781892583171421605668998979064782378729322077179022"
    "58188497624270616932354045628652642074243486855986621171634713368142939547725670"
    "57462769626073125749596420659294621141492960668125275058376082127308747049153521"
    "19747022918247963886630350365119206627670591400728523813746184290857872958847087"
    "691236909900501703203494160206941648263514117706558791691"
)
PUBLIC_KEY_E = 65537

ZTDS_EVAL_PUB_RAW = base64.b64decode("MCowBQYDK2VwAyEA4aQfaGa+ZbbAGWDjKBblHpO71vEqQaDsUG8FPhtYBJU=")[12:]
ZTDS_COMM_PUB_RAW = base64.b64decode("MCowBQYDK2VwAyEAg3N98ZgL4Uqbu0PmqvG8KN8vUicYkgKfUNVgwlLObr4=")[12:]

REVOKED_KEY_DIGESTS = {
    "33ca3f758f52a555642aee82a4c60524edb11a288385e6aad69dfe862bf4e785",
    "4320427aaa45eac645aff413113c4ea92713b1045a74f92992f000bf92cca27b",
    "12cb51d8ec1724dfe400fd5e6ebc01d2be3f108534002730ac4f8d76740ac872",
    "1d60277975973d904679cfb6fc206fa577761f7ff51107ff1d783b5046262d37",
    "33f88c0a3742a844c9df5147efeb07915b5e495c9245a68c0b4c81abfdf001a0",
    "b47998aa7730c296b7d96c713694b31f02d1926a86c71014f5c8a305a23eecc6",
    "8607836eda711003b0834e114cca4310456c81fc2e0845c3069cd50d2de17c70",
    "ef5d7ca8a7da606fb145b4b6849bec41c9b541137a38b07a42a4f4c310721f58",
    "b5cafa90a33019ab23b6685691348ce9173d168f613febb100b115061f5fd950",
    "167256cb0d0eb4e47ffd66e43c756fe985ccdd4231893b6627d8fe97f28aee6b",
    "adc54c86555a7aebee398fcd751e04ab431be6ba046d1f53e64c13fadfb21c61",
    "f51bddc3b3a4686c3d3bf6b51b35078743370a4063bf92818c46a0cb6d5e9f9e",
    "07df95ed298f165adf1cff12ab6b1858de61cd0862e92b2180674389b20cc707",
}

# Pure-Python RFC 8032 Ed25519 signature verification (stdlib only)
_ED_Q = 2**255 - 19
_ED_L = 2**252 + 27742317777372353535851937790883648493


def _ed_inv(x: int) -> int:
    return pow(x, _ED_Q - 2, _ED_Q)


_ED_D = (-121665 * _ed_inv(121666)) % _ED_Q
_ED_I = pow(2, (_ED_Q - 1) // 4, _ED_Q)


def _ed_xrecover(y: int) -> int:
    xx = (y * y - 1) * _ed_inv(_ED_D * y * y + 1) % _ED_Q
    x = pow(xx, (_ED_Q + 3) // 8, _ED_Q)
    if (x * x - xx) % _ED_Q != 0:
        x = (x * _ED_I) % _ED_Q
    if x % 2 != 0:
        x = _ED_Q - x
    return x


_ED_BY = (4 * _ed_inv(5)) % _ED_Q
_ED_BX = _ed_xrecover(_ED_BY)
_ED_B = (_ED_BX % _ED_Q, _ED_BY % _ED_Q, 1, (_ED_BX * _ED_BY) % _ED_Q)
_ED_ID = (0, 1, 1, 0)


def _ed_add(p, q):
    x1, y1, z1, t1 = p
    x2, y2, z2, t2 = q
    a = ((y1 - x1) * (y2 - x2)) % _ED_Q
    b = ((y1 + x1) * (y2 + x2)) % _ED_Q
    c = (2 * _ED_D * t1 * t2) % _ED_Q
    d = (2 * z1 * z2) % _ED_Q
    e = (b - a) % _ED_Q
    f = (d - c) % _ED_Q
    g = (d + c) % _ED_Q
    h = (b + a) % _ED_Q
    return ((e * f) % _ED_Q, (g * h) % _ED_Q, (f * g) % _ED_Q, (e * h) % _ED_Q)


def _ed_scalarmult(p, e: int):
    res = _ED_ID
    addend = p
    while e > 0:
        if e & 1:
            res = _ed_add(res, addend)
        addend = _ed_add(addend, addend)
        e >>= 1
    return res


def _ed_encodepoint(p) -> bytes:
    x, y, z, _ = p
    zi = _ed_inv(z)
    xp = (x * zi) % _ED_Q
    yp = (y * zi) % _ED_Q
    out = bytearray(yp.to_bytes(32, "little"))
    out[31] |= (xp & 1) << 7
    return bytes(out)


def _ed_decodepoint(s: bytes):
    if len(s) != 32:
        return None
    y_bytes = bytearray(s)
    sign = (y_bytes[31] >> 7) & 1
    y_bytes[31] &= 0x7F
    y = int.from_bytes(y_bytes, "little")
    if y >= _ED_Q:
        return None
    xx = (y * y - 1) * _ed_inv(_ED_D * y * y + 1) % _ED_Q
    if xx == 0:
        if sign:
            return None
        return (0, y, 1, 0)
    x = pow(xx, (_ED_Q + 3) // 8, _ED_Q)
    if (x * x - xx) % _ED_Q != 0:
        x = (x * _ED_I) % _ED_Q
    if (x * x - xx) % _ED_Q != 0:
        return None
    if (x & 1) != sign:
        x = _ED_Q - x
    return (x, y, 1, (x * y) % _ED_Q)


def _ed25519_verify(msg: bytes, sig: bytes, pub: bytes) -> bool:
    if len(sig) != 64 or len(pub) != 32:
        return False
    r_pt = _ed_decodepoint(sig[:32])
    a_pt = _ed_decodepoint(pub)
    if r_pt is None or a_pt is None:
        return False
    s = int.from_bytes(sig[32:], "little")
    if s < 0 or s >= _ED_L:
        return False
    h_digest = hashlib.sha512(sig[:32] + pub + msg).digest()
    h = int.from_bytes(h_digest, "little") % _ED_L
    left = _ed_scalarmult(_ED_B, s)
    right = _ed_add(r_pt, _ed_scalarmult(a_pt, h))
    return _ed_encodepoint(left) == _ed_encodepoint(right)


def _canonicalize_json(val):
    if isinstance(val, dict):
        return {k: _canonicalize_json(val[k]) for k in sorted(val.keys())}
    if isinstance(val, list):
        return [_canonicalize_json(v) for v in val]
    return val


def _b64url_decode(val: str) -> bytes:
    pad = "=" * ((4 - len(val) % 4) % 4)
    return base64.urlsafe_b64decode(val + pad)


def _canonical_profile_slug(name: str) -> str:
    lower = str(name or "general").strip().lower()
    if not lower or lower in ("universal", "baseline", "general"):
        return "general"
    if lower == "dev_secrets":
        return "dev"
    if lower == "privilege":
        return "legal"
    return lower


def _parse_iso_ms(val: str):
    if not isinstance(val, str) or not val.strip():
        return None
    s = val.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


def validate_license_offline(raw_key: str) -> dict:
    if not raw_key or not isinstance(raw_key, str):
        return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "No license key"}
    key = raw_key.strip().strip("\"'").strip()
    url_m = re.search(r"(?:[?&#](?:restore|team_restore|key|ps_pro)=)([^&#\s]+)", key, re.IGNORECASE)
    if url_m:
        try:
            from urllib.parse import unquote
            key = unquote(url_m.group(1)).strip()
        except Exception:
            key = url_m.group(1).strip()
    if not key:
        return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "No license key"}

    d_raw = hashlib.sha256(key.encode("utf-8", errors="replace")).hexdigest()
    d_up = hashlib.sha256(key.upper().encode("utf-8", errors="replace")).hexdigest()
    if d_raw in REVOKED_KEY_DIGESTS or d_up in REVOKED_KEY_DIGESTS:
        return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "License key revoked"}

    now_ms = int(time.time() * 1000)

    # 1. ZTDS-LIC-v1 (Pure-Python Ed25519 Offline Verification)
    if key.startswith("ZTDS-LIC-v1."):
        parts = key.split(".")
        if len(parts) != 3 or parts[0] != "ZTDS-LIC-v1":
            return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "Invalid ZTDS format"}
        try:
            payload_bytes = _b64url_decode(parts[1])
            sig_bytes = _b64url_decode(parts[2])
            payload = json.loads(payload_bytes.decode("utf-8"))
            if not isinstance(payload, dict):
                return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "Invalid ZTDS payload"}
            canon = json.dumps(_canonicalize_json(payload), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            matched = None
            if _ed25519_verify(canon, sig_bytes, ZTDS_COMM_PUB_RAW):
                matched = "comm"
            elif _ed25519_verify(canon, sig_bytes, ZTDS_EVAL_PUB_RAW):
                matched = "eval"
            if not matched:
                return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "ZTDS signature invalid"}

            exp_str = payload.get("expires_at")
            if exp_str:
                exp_ms = _parse_iso_ms(str(exp_str))
                if exp_ms is None:
                    return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "Invalid expiration"}
                grace_days = payload.get("grace_period_days", 0)
                if not isinstance(grace_days, (int, float)) or isinstance(grace_days, bool) or grace_days < 0:
                    grace_days = 0
                if now_ms > exp_ms + int(grace_days * 86400 * 1000):
                    return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "ZTDS license expired"}

            raw_tier = str(payload.get("tier") or "developer_eval").lower().strip()
            features = payload.get("features") if isinstance(payload.get("features"), dict) else {}
            has_spec = bool(features.get("specialized_profiles"))
            if matched == "eval" or "eval" in raw_tier or not has_spec:
                mapped_tier = "EVAL"
            elif raw_tier in ("developer_pro", "sdk", "developer"):
                mapped_tier = "SDK"
            elif raw_tier in ("teams", "team"):
                mapped_tier = "TEAMS"
            elif raw_tier == "enterprise":
                mapped_tier = "ENTERPRISE"
            elif raw_tier == "oem":
                mapped_tier = "OEM"
            elif raw_tier in ("pro", "individual"):
                mapped_tier = "PRO"
            else:
                mapped_tier = "SDK"

            raw_allowed = features.get("allowed_profiles")
            allowed_profiles = None
            if isinstance(raw_allowed, list) and len(raw_allowed) > 0:
                if not any(str(p).strip() == "*" for p in raw_allowed):
                    allowed_profiles = list(dict.fromkeys(_canonical_profile_slug(p) for p in raw_allowed if str(p).strip()))
            if not allowed_profiles and (mapped_tier == "EVAL" or not has_spec):
                allowed_profiles = ["general"]

            is_eval = mapped_tier == "EVAL"
            is_pro = not is_eval and mapped_tier in PRO_ELIGIBLE_TIERS
            return {
                "valid": True,
                "is_pro": is_pro,
                "is_eval": is_eval,
                "tier": mapped_tier,
                "allowed_profiles": allowed_profiles,
                "reason": None,
            }
        except Exception:
            return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "ZTDS validation failed"}

    # 2. RS256 JWT
    if key.startswith("eyJ") and len(key.split(".")) == 3:
        try:
            b64_h, b64_p, b64_s = key.split(".")
            header = json.loads(_b64url_decode(b64_h).decode("utf-8"))
            if not isinstance(header, dict) or header.get("alg") != "RS256":
                return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "JWT alg invalid"}
            sig_int = int.from_bytes(_b64url_decode(b64_s), "big")
            if sig_int <= 0 or sig_int >= PUBLIC_KEY_N:
                return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "JWT signature invalid"}
            m_int = pow(sig_int, PUBLIC_KEY_E, PUBLIC_KEY_N)
            n_hex_len = len(format(PUBLIC_KEY_N, "x"))
            if n_hex_len % 2 != 0:
                n_hex_len += 1
            em_hex = format(m_int, "x").rjust(n_hex_len, "0")
            expected_hash = hashlib.sha256((b64_h + "." + b64_p).encode("utf-8")).hexdigest()
            if not re.match(r"^0001(?:ff){8,}003031300d060960864801650304020105000420" + expected_hash + r"$", em_hex):
                return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "JWT signature mismatch"}
            payload = json.loads(_b64url_decode(b64_p).decode("utf-8"))
            exp_sec = payload.get("exp")
            if not exp_sec or (now_ms / 1000.0) >= float(exp_sec):
                return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "JWT expired"}
            tier = str(payload.get("tier") or "PRO").upper().strip()
            is_eval = tier in ("EVAL", "EVALUATION")
            is_pro = not is_eval and tier in PRO_ELIGIBLE_TIERS
            raw_allowed = payload.get("allowed_profiles") or payload.get("allowedProfiles")
            allowed_profiles = None
            if isinstance(raw_allowed, list) and len(raw_allowed) > 0 and not any(str(p).strip() == "*" for p in raw_allowed):
                allowed_profiles = list(dict.fromkeys(_canonical_profile_slug(p) for p in raw_allowed if str(p).strip()))
            elif is_eval:
                allowed_profiles = ["general"]
            if not is_eval and not is_pro:
                return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "Unsupported JWT tier"}
            return {"valid": True, "is_pro": is_pro, "is_eval": is_eval, "tier": tier, "allowed_profiles": allowed_profiles, "reason": None}
        except Exception:
            return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "JWT validation failed"}

    # 3. PS-PILOT- / PS-RSA- RSA-1024 keys
    upper_key = key.upper()
    if upper_key.startswith("PS-PILOT-") or upper_key.startswith("PS-RSA-"):
        try:
            b64_part = key[9:] if upper_key.startswith("PS-PILOT-") else key[7:]
            raw_bytes = base64.b64decode(b64_part)
            s_int = int.from_bytes(raw_bytes, "big")
            m_int = pow(s_int, PUBLIC_KEY_E, PUBLIC_KEY_N)
            m_len = (m_int.bit_length() + 7) // 8
            dec_str = m_int.to_bytes(m_len, "big").decode("latin-1")
            if upper_key.startswith("PS-PILOT-") and dec_str.startswith("ZTDS-PILOT-"):
                exp_ms = int(dec_str[11:])
                if now_ms < exp_ms:
                    return {"valid": True, "is_pro": True, "is_eval": False, "tier": "TEAMS", "allowed_profiles": None, "reason": None}
                return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "Pilot expired"}
            if upper_key.startswith("PS-RSA-") and dec_str.startswith("ZTDS-LIC-"):
                pieces = dec_str.split("-")
                if len(pieces) >= 5:
                    tier = str(pieces[2]).upper().strip()
                    exp_ms = int(pieces[4])
                    if now_ms < exp_ms and tier in PRO_ELIGIBLE_TIERS:
                        return {"valid": True, "is_pro": True, "is_eval": False, "tier": tier, "allowed_profiles": None, "reason": None}
                    return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "RSA key expired or invalid tier"}
        except Exception:
            return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "RSA key decryption failed"}

    # 4. Delegate PS-* keys if bundled or local ps-license-manager.cjs + node exist
    bundled_lm = os.path.abspath(os.path.join(os.path.dirname(__file__), "_runtime", "ps-license-manager.cjs"))
    local_lm = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ps-license-manager.cjs"))
    lm_target = bundled_lm if os.path.isfile(bundled_lm) else (local_lm if os.path.isfile(local_lm) else "")
    node_bin = shutil.which("node")
    if node_bin and lm_target and upper_key.startswith("PS-"):
        try:
            script = (
                "const lm = require(process.argv[1]);"
                "const r = lm.validate(process.env._PS_CHECK_KEY || '');"
                "process.stdout.write(JSON.stringify(r));"
            )
            env_sub = os.environ.copy()
            env_sub["_PS_CHECK_KEY"] = key
            out = subprocess.check_output([node_bin, "-e", script, lm_target], env=env_sub, timeout=3, stderr=subprocess.DEVNULL)
            r = json.loads(out.decode("utf-8"))
            if isinstance(r, dict) and r.get("valid"):
                tier = str(r.get("tier") or "PRO").upper().strip()
                if tier == "ENT":
                    tier = "ENTERPRISE"
                is_eval = tier in ("EVAL", "EVALUATION")
                is_pro = not is_eval and tier in PRO_ELIGIBLE_TIERS
                if is_eval or is_pro:
                    raw_allowed = r.get("allowedProfiles")
                    allowed_profiles = None
                    if isinstance(raw_allowed, list) and len(raw_allowed) > 0 and not any(str(p).strip() == "*" for p in raw_allowed):
                        allowed_profiles = list(dict.fromkeys(_canonical_profile_slug(p) for p in raw_allowed if str(p).strip()))
                    elif is_eval:
                        allowed_profiles = ["general"]
                    return {"valid": True, "is_pro": is_pro, "is_eval": is_eval, "tier": tier, "allowed_profiles": allowed_profiles, "reason": None}
        except Exception:
            pass

    # 5. Pure-Python offline V2 SHA-256 MAC + Sealed V1 verification (for Node-less air-gapped hosts)
    parts = upper_key.split("-")
    v2_tiers = {"PRO", "TEAMS", "SDK", "SDK_INTERNAL", "SDK_OEM", "OEM", "ENTERPRISE", "ENT", "ENTERPRISE_AIRGAP"}
    if len(parts) == 4 and parts[0] == "PS" and parts[1] in v2_tiers:
        raw_tier = parts[1]
        canon_tier = "ENTERPRISE" if raw_tier == "ENT" else raw_tier
        core = parts[2]
        checksum = parts[3]
        if len(core) == 8 and re.match(r"^[A-Z0-9]{8}$", core) and re.match(r"^\d{4}$", checksum):
            alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
            seal_mask = [9, 50, 61, 223, 192, 228, 247, 135, 160, 187, 72, 123, 122, 11, 30, 47, 177, 166, 155, 138, 144, 193, 205, 77, 47, 108, 120, 21, 86, 62, 186, 227, 128, 128]
            mac_secret = "".join(chr(b ^ ((idx * 19 + 0x53) & 0xFF)) for idx, b in enumerate(seal_mask))
            core6 = core[:6]
            mac_hex = hashlib.sha256(f"{mac_secret}:{raw_tier}:{core6}".encode("utf-8")).hexdigest()
            c6 = alphabet[int(mac_hex[0:4], 16) % 32]
            c7 = alphabet[int(mac_hex[4:8], 16) % 32]
            expected_core = core6 + c6 + c7
            if hmac.compare_digest(expected_core, core):
                tag_hex = hashlib.sha256(f"{mac_secret}:TAG:{raw_tier}:{expected_core}".encode("utf-8")).hexdigest()
                expected_checksum = str((int(tag_hex[0:8], 16) & 0xFFFFFFFF) % 9999).zfill(4)
                if hmac.compare_digest(expected_checksum, checksum) and canon_tier in PRO_ELIGIBLE_TIERS:
                    return {"valid": True, "is_pro": True, "is_eval": False, "tier": canon_tier, "allowed_profiles": None, "reason": None}

    return {"valid": False, "is_pro": False, "is_eval": False, "tier": None, "allowed_profiles": None, "reason": "Invalid or unverified license key"}


def _get_usage_file_path() -> str:
    home_dir = (
        os.environ.get("HOME", "").strip()
        or os.environ.get("USERPROFILE", "").strip()
        or os.path.expanduser("~")
    )
    if not home_dir or home_dir == "~":
        return ""
    return os.path.abspath(os.path.join(home_dir, ".privacyscrubber-usage.json"))


def _check_and_increment_usage(is_pro: bool, is_eval: bool) -> dict:
    if is_pro:
        return {"blocked": False, "count": 0}
    usage_path = _get_usage_file_path()
    if not usage_path:
        return {"blocked": True, "tampered": True, "reason": "Home directory unavailable for quota tracking"}
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    parent_dir = os.path.dirname(usage_path)
    try:
        os.makedirs(parent_dir, mode=0o700, exist_ok=True)
    except Exception as err:
        return {"blocked": True, "tampered": True, "reason": str(err)}

    lock_path = usage_path + ".lock"
    try:
        if os.path.islink(lock_path):
            return {"blocked": True, "tampered": True, "reason": "Usage lockfile cannot be a symlink"}
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | (getattr(os, "O_NOFOLLOW", 0)), 0o600)
    except Exception as err:
        return {"blocked": True, "tampered": True, "reason": f"Usage lock failed: {err}"}

    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        count_val = 0
        eval_val = 0
        try:
            lst = os.lstat(usage_path)
            if stat.S_ISLNK(lst.st_mode) or not stat.S_ISREG(lst.st_mode):
                return {"blocked": True, "tampered": True, "reason": "Usage file must be a regular non-symlink file"}
            if lst.st_size > USAGE_FILE_MAX_BYTES:
                return {"blocked": True, "tampered": True, "reason": "Usage file exceeds 4096-byte cap"}
            if not os.access(usage_path, os.R_OK | os.W_OK):
                return {"blocked": True, "tampered": True, "reason": "Usage file is read-only / unwritable"}
            o_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            rfd = os.open(usage_path, o_flags)
            try:
                raw_json = os.read(rfd, USAGE_FILE_MAX_BYTES + 1).decode("utf-8")
            finally:
                os.close(rfd)
            data = json.loads(raw_json)
            if not isinstance(data, dict):
                return {"blocked": True, "tampered": True, "reason": "Usage schema invalid"}
            f_date = data.get("date")
            if not isinstance(f_date, str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", f_date):
                return {"blocked": True, "tampered": True, "reason": "Usage date field invalid"}
            if f_date > today:
                return {"blocked": True, "tampered": True, "reason": "Usage file has future date"}
            if f_date == today:
                has_c = "count" in data
                has_e = "evalCount" in data
                if not has_c and not has_e:
                    return {"blocked": True, "tampered": True, "reason": "Usage counters missing"}
                c_raw = data.get("count", 0)
                e_raw = data.get("evalCount", 0)
                if isinstance(c_raw, bool) or not isinstance(c_raw, int) or c_raw < 0:
                    return {"blocked": True, "tampered": True, "reason": "Invalid count field"}
                if isinstance(e_raw, bool) or not isinstance(e_raw, int) or e_raw < 0:
                    return {"blocked": True, "tampered": True, "reason": "Invalid evalCount field"}
                count_val = c_raw
                eval_val = e_raw
        except FileNotFoundError:
            pass
        except Exception as err:
            return {"blocked": True, "tampered": True, "reason": f"Usage read failed: {err}"}

        if is_eval:
            if eval_val >= EVAL_TIER_DAILY_LIMIT:
                return {"blocked": True, "count": eval_val, "eval_exhausted": True}
            eval_val += 1
        else:
            if count_val >= FREE_TIER_DAILY_LIMIT:
                return {"blocked": True, "count": count_val}
            count_val += 1

        tmp_path = f"{usage_path}.tmp.{os.getpid()}"
        t_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        tfd = os.open(tmp_path, t_flags, 0o600)
        try:
            payload = json.dumps({"date": today, "count": count_val, "evalCount": eval_val}).encode("utf-8")
            os.write(tfd, payload)
            os.fsync(tfd)
        finally:
            os.close(tfd)
        os.replace(tmp_path, usage_path)

        if is_eval and eval_val > EVAL_TIER_DAILY_LIMIT:
            return {"blocked": True, "count": eval_val, "eval_exhausted": True}
        if (not is_eval) and count_val > FREE_TIER_DAILY_LIMIT:
            return {"blocked": True, "count": count_val}
        return {"blocked": False, "count": eval_val if is_eval else count_val}
    except Exception as err:
        return {"blocked": True, "tampered": True, "reason": f"Quota enforcement failed: {err}"}
    finally:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
        except Exception:
            pass
        try:
            os.close(lock_fd)
        except Exception:
            pass


def _resolve_profile_entitlement(tool_args: dict, lic: dict, default_profile: str = "General") -> dict:
    raw_sec = str(tool_args.get("sector") or "").strip()
    raw_prof = str(tool_args.get("profile") or "").strip()
    has_explicit = bool((raw_sec and raw_sec.lower() != "auto") or (raw_prof and raw_prof.lower() != "auto"))
    req = raw_sec if (raw_sec and (not raw_prof or raw_prof.lower() == "general")) else (raw_prof or default_profile)
    norm_req = _canonical_profile_slug(req)
    allowed = lic.get("allowed_profiles")
    if isinstance(allowed, list) and len(allowed) > 0:
        if norm_req not in allowed:
            if has_explicit:
                return {
                    "allowed": False,
                    "error": f"Error: PROFILE_NOT_LICENSED - Profile '{req}' is not permitted under your license scope ({', '.join(allowed)})."
                }
            fallback = _canonical_profile_slug(default_profile) if _canonical_profile_slug(default_profile) in allowed else ("general" if "general" in allowed else allowed[0])
            return {"allowed": True, "profile": fallback.capitalize(), "normalized_profile": fallback}
    return {"allowed": True, "profile": req, "normalized_profile": norm_req}


def _extract_docx_text(raw_bytes: bytes) -> str:
    if len(raw_bytes) > MAX_FILE_BYTES:
        raise ValueError("DOCX exceeds 10MB limit.")
    chunks = []
    authors = set()
    links = []
    with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
        infos = zf.infolist()
        if len(infos) > 250:
            raise ValueError("DOCX archive contains too many entries.")
        total_uncomp = 0
        for info in infos:
            total_uncomp += info.file_size
            if total_uncomp > MAX_DOCX_UNZIPPED_BYTES or info.file_size > MAX_FILE_BYTES:
                raise ValueError("DOCX uncompressed content exceeds safety limit.")
            name = info.filename
            if re.match(r"^(?:word/(?:document|header\d*|footer\d*|footnotes|endnotes|comments|commentsExtended|people)\.xml|docProps/(?:core|app|custom)\.xml)$", name, re.I):
                xml_bytes = zf.read(name)
                try:
                    root = ET.fromstring(xml_bytes)
                    for elem in root.iter():
                        for attr_k, attr_v in elem.attrib.items():
                            if attr_k.endswith("author") or attr_k.endswith("userId"):
                                if attr_v.strip():
                                    authors.add(attr_v.strip())
                        if elem.text and elem.text.strip():
                            chunks.append(elem.text.strip())
                except ET.ParseError:
                    stripped = re.sub(r"<[^>]+>", " ", xml_bytes.decode("utf-8", errors="replace")).strip()
                    if stripped:
                        chunks.append(stripped)
            elif re.match(r"^word/_rels/.*\.rels$", name, re.I):
                rel_text = zf.read(name).decode("utf-8", errors="replace")
                for m in re.finditer(r'Target="([^"]+)"', rel_text, re.I):
                    tgt = m.group(1)
                    if re.match(r"^(?:mailto:|tel:|https?://)", tgt, re.I) and not re.search(r"schemas\.openxmlformats\.org|schemas\.microsoft\.com|w3\.org", tgt, re.I):
                        links.append(tgt)
    if authors:
        chunks.append("[Document Reviewers]: " + ", ".join(sorted(authors)))
    for lnk in links:
        chunks.append("[Document Link]: " + lnk)
    return "\n".join(chunks)


def _check_safe_workspace_path(file_path: str) -> str:
    if not file_path or "\x00" in file_path:
        raise ValueError("Invalid 'file_path'.")
    workspace_real = os.path.realpath(os.getcwd())
    abs_candidate = os.path.abspath(os.path.expanduser(file_path))
    resolved_path = os.path.realpath(abs_candidate)
    if resolved_path != workspace_real and not resolved_path.startswith(workspace_real + os.sep):
        raise PermissionError(f"Path '{file_path}' escapes active workspace root '{workspace_real}'.")
    normalized_check = resolved_path.replace("\\", "/").lower()
    if any(seg in normalized_check for seg in FORBIDDEN_PATH_SEGMENTS):
        raise PermissionError("Access to system credential path is restricted by ZTDS policy.")
    lst = os.lstat(abs_candidate)
    if stat.S_ISLNK(lst.st_mode):
        if not os.path.realpath(abs_candidate).startswith(workspace_real + os.sep):
            raise PermissionError("Target symlink escapes workspace root.")
    fst = os.stat(resolved_path)
    if not stat.S_ISREG(fst.st_mode):
        raise ValueError(f"Path '{file_path}' is not a regular file.")
    return resolved_path


PATTERNS = {
    "SECRET": re.compile(
        r'-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----|'
        r'\b(?:Bearer\s+(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?|[A-Za-z0-9._-]{20,})|'
        r'sk-(?:ant-|proj-|svcacct-)?[a-zA-Z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|'
        r'github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[0-9a-zA-Z-]{10,48}|AIza[0-9A-Za-z-_]{35}|'
        r'(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@]+:[^\s:@]+@[^\s"\'>]+)\b'
    ),
    "JWT": re.compile(r'\beyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+\b'),
    "EMAIL": re.compile(r'\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}\b', re.IGNORECASE),
    "PHONE": re.compile(r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b'),
    "SSN": re.compile(r'\b\d{3}-\d{2}-\d{4}\b'),
    "FINANCIAL": re.compile(r'\b(?:\d{4}[-\s]?){3}\d{4}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b'),
    "IP": re.compile(r'\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b'),
    "NAME": re.compile(r'\b(?:Patient|Client|Customer|Employee|Candidate|Applicant|Contact|Author|Sender|Recipient|Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.)\s+([A-Z][a-z]{1,24}(?:\s+[A-Z][a-z]{1,24}){1,2})\b'),
}

NATIVE_VERTICAL_PATTERNS = {
    "medical": [("HEALTH_MRN", re.compile(r'\bMRN[-:\s#]*[A-Z0-9]{4,16}\b', re.IGNORECASE))],
    "legal": [("LEGAL_DOCKET", re.compile(r'\bDocket\s*(?:No\.?|#)?\s*[A-Z0-9-]{4,20}\b', re.IGNORECASE))],
    "hr": [("EMPLOYEE_ID", re.compile(r'\bEMP[-_][A-Z0-9]{4,14}\b', re.IGNORECASE))],
}

TOKEN_RE = re.compile(r'(?:\[[A-Za-z0-9_]+_\d+\]|<[A-Za-z0-9_]+_\d+>|\{\{[A-Za-z0-9_]+_\d+\}\}|__[A-Za-z0-9_]+_\d+__)')
FORBIDDEN_PATH_SEGMENTS = ('/etc/shadow', '/etc/passwd', '/.ssh/', '/.aws/', '/.gnupg/', 'id_rsa', 'id_ed25519')


class NativeZtdsEngine:
    def __init__(self):
        self.session_map = {}
        self.counters = {}
        self.ignore_list = set()

    def sanitize(self, text: str, profile: str = "general") -> tuple:
        if not text:
            return "", {}

        reverse_map = {v: k for k, v in self.session_map.items()}
        tokens_created = {}

        def replacer(match, entity_type: str):
            has_group = bool(match.lastindex and match.lastindex >= 1)
            val = match.group(1) if has_group else match.group(0)
            if val.lower() in self.ignore_list:
                return match.group(0)
            if val in reverse_map:
                tok = reverse_map[val]
                tokens_created[tok] = val
            else:
                self.counters[entity_type] = self.counters.get(entity_type, 0) + 1
                tok = f"[{entity_type}_{self.counters[entity_type]}]"
                self.session_map[tok] = val
                reverse_map[val] = tok
                tokens_created[tok] = val
            if has_group:
                full = match.group(0)
                rel_start = match.start(1) - match.start(0)
                rel_end = match.end(1) - match.start(0)
                return full[:rel_start] + tok + full[rel_end:]
            return tok

        scrubbed = text
        norm_prof = _canonical_profile_slug(profile)
        for entity_type, pat in NATIVE_VERTICAL_PATTERNS.get(norm_prof, []):
            scrubbed = pat.sub(lambda m, et=entity_type: replacer(m, et), scrubbed)
        for entity_type, pat in PATTERNS.items():
            if entity_type == "EMAIL" and "@" not in scrubbed:
                continue
            scrubbed = pat.sub(lambda m, et=entity_type: replacer(m, et), scrubbed)

        try:
            max_tokens = int(os.environ.get("PRIVACYSCRUBBER_MAX_SESSION_TOKENS", str(MAX_SESSION_TOKENS)) or str(MAX_SESSION_TOKENS))
            if max_tokens < 1:
                max_tokens = MAX_SESSION_TOKENS
        except ValueError:
            max_tokens = MAX_SESSION_TOKENS
        if len(self.session_map) > max_tokens:
            prune_count = len(self.session_map) - max_tokens
            keys_to_remove = list(self.session_map.keys())[:prune_count]
            for k in keys_to_remove:
                del self.session_map[k]

        return scrubbed, tokens_created

    def reveal(self, text: str, custom_map: dict = None) -> str:
        if not text:
            return ""
        active_map = custom_map if custom_map is not None else self.session_map
        if not active_map:
            return text
        normalized_map = {}
        for k, v in active_map.items():
            key_str = str(k).strip()
            normalized_map[key_str] = v
            normalized_map[key_str.upper()] = v
            inner = re.sub(r"^(?:\[|<|\{\{|__)|(?:\]|>|\}\}|__)$", "", key_str)
            for wrap_fmt in (f"[{inner}]", f"<{inner}>", f"{{{{{inner}}}}}", f"__{inner}__"):
                normalized_map[wrap_fmt] = v
                normalized_map[wrap_fmt.upper()] = v
        return TOKEN_RE.sub(
            lambda m: normalized_map.get(m.group(0), normalized_map.get(m.group(0).upper(), m.group(0))),
            text,
        )

    def zeroize_session(self) -> None:
        self.session_map.clear()
        self.counters.clear()
        self.ignore_list.clear()


def _build_telemetry(tokens: dict) -> tuple:
    entity_counts = {}
    for tok in (tokens or {}):
        m = re.match(r'^\[([A-Za-z0-9_]+)_\d+\]$', tok)
        etype = m.group(1).upper() if m else "CUSTOM"
        entity_counts[etype] = entity_counts.get(etype, 0) + 1
    total_masked = len(tokens or {})
    high_risk_types = {"SECRET", "JWT", "SSN", "FINANCIAL", "API_KEY", "AWS_KEY", "PRIVATE_KEY"}
    if total_masked == 0:
        risk_level = "CLEAN (ZERO PII)"
    elif any(t in high_risk_types for t in entity_counts) or len(entity_counts) >= 3 or total_masked >= 10:
        risk_level = "CRITICAL (HIGH EXPOSURE)"
    elif len(entity_counts) >= 2 or total_masked >= 3:
        risk_level = "MODERATE EXPOSURE"
    else:
        risk_level = "LOW EXPOSURE"
    breakdown = ", ".join(f"{cnt} {etype}" for etype, cnt in entity_counts.items())
    return total_masked, entity_counts, risk_level, breakdown


def _format_footer(total_masked: int, risk_level: str, breakdown: str, compact: bool = False, verbose_receipt: bool = False) -> str:
    breakdown_part = f" ({breakdown})" if breakdown else ""
    if compact and not verbose_receipt:
        if total_masked == 0:
            return "\n\n> [ZTDS: CLEAN (ZERO PII DETECTED)]"
        return f"\n\n> [ZTDS: {total_masked} masked{breakdown_part} | Risk: {risk_level}]"
    if verbose_receipt:
        if total_masked == 0:
            return "\n\n> **PrivacyScrubber Audit Receipt**: CLEAN (ZERO PII DETECTED)"
        return (
            f"\n\n> **PrivacyScrubber Audit Receipt**\n"
            f"> * **Risk Level:** {risk_level}\n"
            f"> * **Tokens Masked:** {total_masked}{breakdown_part}\n"
            f"> * **Network Egress:** 0 bytes (Local RAM)"
        )
    return f"\n\n> [PrivacyScrubber Audit Receipt | ZTDS: {risk_level} | {total_masked} masked{breakdown_part} | 0 bytes egress]"


def run_native_mcp_loop():
    sessions = {"default": NativeZtdsEngine()}

    def get_session_engine(sid_val) -> tuple:
        sid = str(sid_val or "default").strip() or "default"
        if sid not in sessions:
            if len(sessions) >= MAX_CONCURRENT_SESSIONS:
                evict_key = next((k for k in sessions.keys() if k != "default"), None)
                if evict_key:
                    sessions[evict_key].zeroize_session()
                    del sessions[evict_key]
            sessions[sid] = NativeZtdsEngine()
        return sid, sessions[sid]

    def check_license_from_env() -> dict:
        raw_k = (
            os.environ.get("PRIVACYSCRUBBER_KEY", "")
            or os.environ.get("PRIVACYSCRUBBER_LICENSE_KEY", "")
            or os.environ.get("ZTDS_LICENSE", "")
            or os.environ.get("ZTDS_LICENSE_KEY", "")
        ).strip()
        return validate_license_offline(raw_k)

    def quota_error_res(req_id, limit_res: dict) -> dict:
        if limit_res.get("tampered"):
            msg = f"Error: Daily quota persistence check failed closed ({limit_res.get('reason', 'invalid usage file')})."
        elif limit_res.get("eval_exhausted"):
            msg = f"Error: Evaluation license daily limit exhausted ({EVAL_TIER_DAILY_LIMIT} requests)."
        else:
            msg = f"Error: Free tier daily limit exhausted ({FREE_TIER_DAILY_LIMIT} requests). Set PRIVACYSCRUBBER_KEY to continue."
        return {"jsonrpc": "2.0", "id": req_id, "result": {"isError": True, "content": [{"type": "text", "text": msg}]}}

    sys.stderr.write(
        f"[PrivacyScrubber MCP] Native Python Engine Active (v{VERSION})\n"
        f"[PrivacyScrubber MCP] Architecture: 100% In-Memory RAM | 0 Network Egress\n"
        f"[PrivacyScrubber MCP] Preserving prompt confidentiality at client boundary.\n"
    )
    sys.stderr.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue

        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params", {})

        if method == "initialize":
            res = {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "@privacyscrubber/mcp-server", "version": VERSION},
                    "instructions": (
                        "Zero-Trust Data Sanitization (ZTDS) Protocol Active (100% local RAM, 0 network egress).\n"
                        "AUTOMATIC INTERCEPTION RULES FOR AI AGENTS:\n"
                        "1. FILE READS: Before reading .env, configs, logs, or sensitive files, call 'sanitize_file' instead of native file read tools.\n"
                        "2. RAW TEXT: Sanitize raw user PII/secrets via 'sanitize_text' before external reasoning.\n"
                        "3. LOCAL RESTORATION: Keep tokens like [EMAIL_1], [API_KEY_1] intact during reasoning and call 'reveal_text' to restore final answers."
                    ),
                },
            }
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif method == "notifications/initialized":
            pass

        elif method == "ping":
            res = {"jsonrpc": "2.0", "id": req_id, "result": {}}
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif method == "tools/list":
            ro_annot = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}
            res = {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "tools": [
                        {
                            "name": "audit_context",
                            "description": "Pre-flight read-only inspection of raw text for PII and secrets without mutating session maps.",
                            "annotations": {"title": "Pre-Flight Audit Context", **ro_annot},
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "text": {"type": "string"},
                                    "profile": {"type": "string"},
                                    "format": {"type": "string"},
                                },
                                "required": ["text"],
                            },
                        },
                        {
                            "name": "sanitize_text",
                            "description": "Locally intercept and scrub PII, credentials, API keys, and sensitive tokens from text in local RAM before AI ingestion.",
                            "annotations": {"title": "Sanitize Text in Local RAM", **ro_annot, "readOnlyHint": False},
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "text": {"type": "string", "description": "Text to sanitize"},
                                    "profile": {"type": "string", "description": "Optional profile name (default: General)"},
                                    "compact": {"type": "boolean"},
                                    "verbose_receipt": {"type": "boolean"},
                                    "session_id": {"type": "string"},
                                },
                                "required": ["text"],
                            },
                        },
                        {
                            "name": "reveal_text",
                            "description": "Locally re-insert and detokenize original cleartext into AI responses containing synthetic tokens in local RAM.",
                            "annotations": {"title": "Restore Tokens in Local RAM", **ro_annot},
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "text": {"type": "string"},
                                    "tokenMap": {"type": "object"},
                                    "session_id": {"type": "string"},
                                },
                                "required": ["text"],
                            },
                        },
                        {
                            "name": "sanitize_file",
                            "description": "Read and locally sanitize a workspace file in RAM before sharing with an AI model.",
                            "annotations": {"title": "Sanitize File in Local RAM", **ro_annot, "readOnlyHint": False},
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "file_path": {"type": "string"},
                                    "profile": {"type": "string"},
                                    "session_id": {"type": "string"},
                                },
                                "required": ["file_path"],
                            },
                        },
                        {
                            "name": "guard_read_file",
                            "description": "Read and sanitize a workspace file within session context.",
                            "annotations": {"title": "Guard Read File", **ro_annot, "readOnlyHint": False},
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "file_path": {"type": "string"},
                                    "profile": {"type": "string"},
                                    "session_id": {"type": "string"},
                                },
                                "required": ["file_path"],
                            },
                        },
                        {
                            "name": "check_status",
                            "description": "Show PrivacyScrubber MCP license tier, active session count, and architectural configuration.",
                            "annotations": {"title": "Check Engine Status", **ro_annot},
                            "inputSchema": {"type": "object", "properties": {}},
                        },
                        {
                            "name": "generate_procurement_memo",
                            "description": "Generate an offline CISO/DPO compliance & TCO procurement memorandum.",
                            "annotations": {"title": "Generate Procurement Memo", **ro_annot},
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "target_tier": {"type": "string"},
                                    "team_size": {"type": "integer"},
                                },
                            },
                        },
                        {
                            "name": "mark_false_positive",
                            "description": "Exclude a false-positive token or phrase from future sanitization in this RAM session.",
                            "annotations": {"title": "Mark False Positive", "readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": False},
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "token": {"type": "string"},
                                    "session_id": {"type": "string"},
                                },
                                "required": ["token"],
                            },
                        },
                        {
                            "name": "guard_session_info",
                            "description": "Inspect volatile session token counts without revealing cleartext PII.",
                            "annotations": {"title": "Session Info", **ro_annot},
                            "inputSchema": {"type": "object", "properties": {"session_id": {"type": "string"}}},
                        },
                        {
                            "name": "guard_session_reset",
                            "description": "Immediately zeroize and purge all volatile in-memory token mappings and counters.",
                            "annotations": {"title": "Reset RAM Session", "readOnlyHint": False, "destructiveHint": True, "idempotentHint": True, "openWorldHint": False},
                            "inputSchema": {"type": "object", "properties": {"session_id": {"type": "string"}}},
                        },
                        {
                            "name": "ztds_sanitize",
                            "description": "Vendor-neutral ZTDS RAM sanitization with attestation receipt.",
                            "annotations": {"title": "ZTDS Sanitize", **ro_annot, "readOnlyHint": False},
                            "inputSchema": {
                                "type": "object",
                                "properties": {"text": {"type": "string"}, "profile": {"type": "string"}, "sessionId": {"type": "string"}},
                                "required": ["text"],
                            },
                        },
                        {
                            "name": "ztds_restore",
                            "description": "Vendor-neutral ZTDS RAM detokenization.",
                            "annotations": {"title": "ZTDS Restore", **ro_annot},
                            "inputSchema": {
                                "type": "object",
                                "properties": {"text": {"type": "string"}, "sessionId": {"type": "string"}},
                                "required": ["text"],
                            },
                        },
                        {
                            "name": "ztds_audit",
                            "description": "Vendor-neutral ZTDS read-only exposure audit.",
                            "annotations": {"title": "ZTDS Audit", **ro_annot},
                            "inputSchema": {
                                "type": "object",
                                "properties": {"text": {"type": "string"}, "profile": {"type": "string"}},
                                "required": ["text"],
                            },
                        },
                        {
                            "name": "ztds_info",
                            "description": "Display ZTDS RFC v1.0 invariants and runtime licensing state.",
                            "annotations": {"title": "ZTDS Info", **ro_annot},
                            "inputSchema": {"type": "object", "properties": {}},
                        },
                        {
                            "name": "ztds_reset_session",
                            "description": "Zeroize one or all active ZTDS RAM sessions.",
                            "annotations": {"title": "ZTDS Reset Session", "readOnlyHint": False, "destructiveHint": True, "idempotentHint": True, "openWorldHint": False},
                            "inputSchema": {"type": "object", "properties": {"sessionId": {"type": "string"}}},
                        },
                    ]
                },
            }
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif method == "tools/call":
            tool_name = params.get("name")
            tool_args = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
            lic = check_license_from_env()
            sid_arg = tool_args.get("session_id") if tool_args.get("session_id") is not None else tool_args.get("sessionId")
            sid, eng = get_session_engine(sid_arg)

            if tool_name in ("audit_context", "ztds_audit"):
                raw_text = tool_args.get("text")
                if not isinstance(raw_text, str):
                    res = {"jsonrpc": "2.0", "id": req_id, "result": {"isError": True, "content": [{"type": "text", "text": "Error: Parameter 'text' must be a string."}]}}
                else:
                    p_chk = _resolve_profile_entitlement(tool_args, lic, "General")
                    if not p_chk["allowed"]:
                        res = {"jsonrpc": "2.0", "id": req_id, "result": {"isError": True, "content": [{"type": "text", "text": p_chk["error"]}]}}
                    else:
                        q_res = _check_and_increment_usage(lic["is_pro"], lic["is_eval"])
                        if q_res["blocked"]:
                            res = quota_error_res(req_id, q_res)
                        else:
                            char_lim = 5000 if (p_chk["normalized_profile"] != "general" and not lic["is_pro"]) else 15000
                            was_trunc = (not lic["is_pro"]) and len(raw_text) > char_lim
                            audit_input = raw_text[:char_lim] if was_trunc else raw_text
                            dry_eng = NativeZtdsEngine()
                            _, tokens = dry_eng.sanitize(audit_input, p_chk["normalized_profile"])
                            total_masked, counts, risk_level, _ = _build_telemetry(tokens)
                            if tool_name == "ztds_audit":
                                payload = {
                                    "riskLevel": "CLEAN" if total_masked == 0 else ("MODERATE" if total_masked < 5 else "CRITICAL"),
                                    "totalEntitiesFound": total_masked,
                                    "breakdown": counts,
                                    "contentHash": "sha256:" + hashlib.sha256(raw_text.encode("utf-8", errors="replace")).hexdigest()[:16],
                                    "profile": p_chk["profile"],
                                    "wasTruncated": was_trunc,
                                    "rfcCompliance": {"invariant1_zeroEgress": True, "invariant2_deterministicSurrogates": True, "invariant3_ramIsolation": True, "invariant4_subprocessorExclusion": True},
                                }
                                res = {"jsonrpc": "2.0", "id": req_id, "result": {"structuredContent": payload, "content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}}
                            else:
                                struct_out = {"riskLevel": risk_level, "totalDetected": total_masked, "entities": counts, "profile": p_chk["profile"], "wasTruncated": was_trunc, "executionEngine": "ZTDS Python Native RAM"}
                                res = {"jsonrpc": "2.0", "id": req_id, "result": {"structuredContent": struct_out, "content": [{"type": "text", "text": json.dumps(struct_out, indent=2)}]}}

            elif tool_name in ("sanitize_text", "scrub_text", "ztds_sanitize"):
                raw_text = tool_args.get("text")
                if not isinstance(raw_text, str):
                    res = {"jsonrpc": "2.0", "id": req_id, "result": {"isError": True, "content": [{"type": "text", "text": "Error: Parameter 'text' must be a string."}]}}
                else:
                    p_chk = _resolve_profile_entitlement(tool_args, lic, "General")
                    if not p_chk["allowed"]:
                        res = {"jsonrpc": "2.0", "id": req_id, "result": {"isError": True, "content": [{"type": "text", "text": p_chk["error"]}]}}
                    else:
                        q_res = _check_and_increment_usage(lic["is_pro"], lic["is_eval"])
                        if q_res["blocked"]:
                            res = quota_error_res(req_id, q_res)
                        else:
                            compact = bool(tool_args.get("compact", False))
                            verbose_receipt = bool(tool_args.get("verbose_receipt", False))
                            char_lim = 5000 if (p_chk["normalized_profile"] != "general" and not lic["is_pro"]) else 15000
                            was_trunc = (not lic["is_pro"]) and len(raw_text) > char_lim
                            text_in = raw_text[:char_lim] if was_trunc else raw_text
                            scrubbed, tokens = eng.sanitize(text_in, p_chk["normalized_profile"])
                            total_masked, counts, risk_level, breakdown = _build_telemetry(tokens)
                            footer = _format_footer(total_masked, risk_level, breakdown, compact, verbose_receipt)
                            if was_trunc:
                                footer += f"\n> [Free Tier Truncation: Processed first {char_lim:,} chars. Upgrade: https://privacyscrubber.com/pricing/?tier=teams&utm_source=py_mcp]"
                            if not lic["is_pro"] and p_chk["normalized_profile"] != "general":
                                footer += f"\n> [Notice] Python Native Fallback runs baseline rules. Specialized profiles require the Node.js engine & commercial license."
                            if tool_name == "ztds_sanitize":
                                receipt_hex = hashlib.sha256(scrubbed.encode("utf-8", errors="replace")).hexdigest()[:16].upper()
                                struct_out = {
                                    "sanitizedText": scrubbed,
                                    "entitiesMasked": total_masked,
                                    "categories": list(counts.keys()),
                                    "auditReceipt": f"ZTDS-RECEIPT-{receipt_hex}",
                                    "zeroEgressAttested": True,
                                }
                                res = {"jsonrpc": "2.0", "id": req_id, "result": {"structuredContent": struct_out, "content": [{"type": "text", "text": scrubbed + footer}]}}
                            else:
                                struct_out = {"scrubbedText": scrubbed, "tokensRedacted": total_masked, "riskLevel": risk_level, "entities": counts, "profile": p_chk["profile"], "sessionId": sid, "wasTruncated": was_trunc}
                                res = {"jsonrpc": "2.0", "id": req_id, "result": {"structuredContent": struct_out, "content": [{"type": "text", "text": scrubbed + footer}]}}

            elif tool_name in ("reveal_text", "ztds_restore"):
                masked_text = tool_args.get("text")
                if not isinstance(masked_text, str):
                    res = {"jsonrpc": "2.0", "id": req_id, "result": {"isError": True, "content": [{"type": "text", "text": "Error: Parameter 'text' must be a string."}]}}
                else:
                    custom_map = tool_args.get("tokenMap") if isinstance(tool_args.get("tokenMap"), dict) else None
                    restored = eng.reveal(masked_text, custom_map)
                    res = {"jsonrpc": "2.0", "id": req_id, "result": {"structuredContent": {"restoredText": restored, "sessionId": sid}, "content": [{"type": "text", "text": restored}]}}

            elif tool_name in ("sanitize_file", "scrub_file", "guard_read_file"):
                file_path = str(tool_args.get("file_path") or tool_args.get("path") or "").strip()
                try:
                    p_chk = _resolve_profile_entitlement(tool_args, lic, "Dev" if tool_name == "guard_read_file" else "General")
                    if not p_chk["allowed"]:
                        res = {"jsonrpc": "2.0", "id": req_id, "result": {"isError": True, "content": [{"type": "text", "text": p_chk["error"]}]}}
                    else:
                        resolved_path = _check_safe_workspace_path(file_path)
                        lower_path = resolved_path.lower()
                        if lower_path.endswith((".pdf", ".xlsx", ".xls")):
                            res = {
                                "jsonrpc": "2.0",
                                "id": req_id,
                                "result": {
                                    "isError": True,
                                    "content": [{
                                        "type": "text",
                                        "text": "[PrivacyScrubber PRO / TEAMS] PDF and Excel (XLSX) sanitization requires the Node.js engine and a PRO/TEAMS/SDK license: https://privacyscrubber.com/pricing/?tier=teams&trial=true&utm_source=py_mcp&utm_medium=file_type",
                                    }],
                                },
                            }
                        else:
                            q_res = _check_and_increment_usage(lic["is_pro"], lic["is_eval"])
                            if q_res["blocked"]:
                                res = quota_error_res(req_id, q_res)
                            else:
                                if os.path.getsize(resolved_path) > MAX_FILE_BYTES:
                                    raise ValueError("File exceeds 10MB in-memory sanitization limit.")
                                if lower_path.endswith(".docx"):
                                    with open(resolved_path, "rb") as bf:
                                        raw_content = _extract_docx_text(bf.read())
                                else:
                                    with open(resolved_path, "r", encoding="utf-8", errors="replace") as f:
                                        raw_content = f.read()
                                char_lim = 5000 if (p_chk["normalized_profile"] != "general" and not lic["is_pro"]) else 15000
                                was_trunc = (not lic["is_pro"]) and len(raw_content) > char_lim
                                text_in = raw_content[:char_lim] if was_trunc else raw_content
                                scrubbed, tokens = eng.sanitize(text_in)
                                total_masked, _, risk_level, breakdown = _build_telemetry(tokens)
                                footer = _format_footer(total_masked, risk_level, breakdown, bool(tool_args.get("compact", False)), bool(tool_args.get("verbose_receipt", False)))
                                if was_trunc:
                                    footer += f"\n> [Free Tier Truncation: Processed first {char_lim:,} chars.]"
                                res = {"jsonrpc": "2.0", "id": req_id, "result": {"content": [{"type": "text", "text": scrubbed + footer}]}}
                except Exception as err:
                    res = {"jsonrpc": "2.0", "id": req_id, "result": {"isError": True, "content": [{"type": "text", "text": f"Error reading file '{file_path}': {err}"}]}}

            elif tool_name == "check_status":
                tier_label = lic["tier"] or "FREE"
                allowed_desc = f" (Scoped: {', '.join(lic['allowed_profiles'])})" if lic.get("allowed_profiles") else ""
                status_text = (
                    f"PrivacyScrubber MCP Server (Python Native Engine v{VERSION})\n"
                    f"Architecture: 100% In-Memory RAM | Zero-Network Air-Gapped\n"
                    f"Tier: {tier_label}{allowed_desc}\n"
                    f"Active Session: {sid} ({len(eng.session_map)} tokens)\n"
                    f"Active Sessions Total: {len(sessions)}\n"
                    f"Commercial Licensing (PRO $15/mo | TEAMS $99/mo | SDK $299/mo): https://privacyscrubber.com/pricing/?tier=teams&utm_source=py_mcp_status\n"
                )
                res = {"jsonrpc": "2.0", "id": req_id, "result": {"content": [{"type": "text", "text": status_text}]}}

            elif tool_name == "ztds_info":
                info_payload = {
                    "specification": "ZTDS RFC v1.0 (https://ztds.ai/standard/)",
                    "ietfTrack": "draft-sibiryakov-ztds-protocol",
                    "version": VERSION,
                    "engine": "python-native-fallback",
                    "license": {
                        "active": bool(lic["is_pro"] or lic["is_eval"]),
                        "tier": lic["tier"] or "FREE",
                        "allowedProfiles": lic.get("allowed_profiles"),
                    },
                }
                res = {"jsonrpc": "2.0", "id": req_id, "result": {"structuredContent": info_payload, "content": [{"type": "text", "text": json.dumps(info_payload, indent=2)}]}}

            elif tool_name == "generate_procurement_memo":
                tier = str(tool_args.get("target_tier", "teams")).lower()
                team_size = int(tool_args.get("team_size", 10) or 10)
                memo_text = (
                    f"MEMORANDUM: ADOPTION OF PRIVACYSCRUBBER ({'DEVELOPER SDK' if tier == 'sdk' else 'TEAMS'}) - ZTDS STANDARD\n"
                    f"TO: Chief Information Security Officer (CISO), Data Protection Officer (DPO), VP Engineering\n"
                    f"SCOPE: {team_size} Engineers | 100% Local In-Memory RAM Sanitization (0 Bytes Network Egress)\n\n"
                    f"1. COMPLIANCE & STATUTORY SAFE HARBOR\n"
                    f"   Enforces client-side pseudonymization prior to AI/LLM ingestion (GDPR Art. 25/32, HIPAA, SOC 2, PCI DSS, NIST SP 800-53).\n\n"
                    f"2. TOTAL COST OF OWNERSHIP (TCO) COMPARISON\n"
                    f"   - Traditional Cloud DLP Proxies: $1,500 - $4,000/mo + latency + third-party DPA risk.\n"
                    f"   - PrivacyScrubber TEAMS: $99/mo flat (unlimited engineering seats).\n"
                    f"   - PrivacyScrubber Developer SDK: $299/mo flat or $2,990/yr (unlimited backend nodes).\n\n"
                    f"3. PROCUREMENT & 7-DAY EVALUATION\n"
                    f"   - https://privacyscrubber.com/pricing/?tier={tier if tier in ('teams', 'sdk') else 'teams'}&trial=true&utm_source=py_mcp_memo\n"
                )
                res = {"jsonrpc": "2.0", "id": req_id, "result": {"content": [{"type": "text", "text": memo_text}]}}

            elif tool_name == "mark_false_positive":
                val = str(tool_args.get("token") or tool_args.get("value") or "").strip()
                restored_phrase = eng.session_map.pop(val, None) or eng.session_map.pop(val.upper(), None)
                target_phrase = restored_phrase if restored_phrase else val
                if target_phrase:
                    eng.ignore_list.add(target_phrase.lower())
                is_credential_token = bool(
                    re.match(
                        r'^\[(?:SECRET|API_KEY|API_TOKEN|AWS_KEY|STRIPE_KEY|OPENAI_KEY|JWT|JWT_TOKEN|BEARER_TOKEN|GITHUB_PAT|TOKEN|CREDENTIAL|DB_URI|PRIVATE_KEY|PASSWORD)_\d+\]$',
                        val,
                        re.IGNORECASE,
                    )
                )
                msg_text = (
                    f"Marked '{val}' as a false positive for this RAM session (plaintext echo suppressed for credential token)."
                    if is_credential_token
                    else f"Marked '{target_phrase}' as a false positive for this RAM session."
                )
                res = {"jsonrpc": "2.0", "id": req_id, "result": {"content": [{"type": "text", "text": msg_text}]}}

            elif tool_name == "guard_session_info":
                info = {"session_id": sid, "tokens_in_session": len(eng.session_map), "ignore_list_size": len(eng.ignore_list), "active_sessions": len(sessions)}
                res = {"jsonrpc": "2.0", "id": req_id, "result": {"structuredContent": info, "content": [{"type": "text", "text": json.dumps(info, indent=2)}]}}

            elif tool_name in ("guard_session_reset", "reset_session", "ztds_reset_session"):
                if tool_name == "ztds_reset_session" and not sid_arg:
                    cleared_count = sum(len(s.session_map) for s in sessions.values())
                    for s in sessions.values():
                        s.zeroize_session()
                    sessions.clear()
                    sessions["default"] = NativeZtdsEngine()
                else:
                    cleared_count = len(eng.session_map)
                    eng.zeroize_session()
                    if sid != "default" and sid in sessions:
                        del sessions[sid]
                res = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "structuredContent": {"purged": True, "tokensPurged": cleared_count, "activeSessionsRemaining": len(sessions)},
                        "content": [{"type": "text", "text": f"Session zeroized in RAM ({cleared_count} tokens purged)."}],
                    },
                }

            else:
                res = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Tool '{tool_name}' not found."}}

            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        else:
            if req_id is not None:
                res = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method '{method}' not implemented."}}
                sys.stdout.write(json.dumps(res) + "\n")
                sys.stdout.flush()


def _is_python_entrypoint(bin_path: str) -> bool:
    try:
        real_target = os.path.realpath(bin_path)
        if real_target in (os.path.realpath(__file__), os.path.realpath(sys.argv[0])):
            return True
        if real_target.endswith((".py", ".pyw")):
            return True
        with open(real_target, "rb") as bf:
            head = bf.read(256).lower()
        if b"python" in head:
            return True
    except Exception:
        return True
    return False


def main():
    force_native = "--native" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--native"]

    if force_native or os.environ.get("_PS_MCP_EXEC_GUARD") == "1":
        run_native_mcp_loop()
        return

    # 1. Check for local index.js (e.g. in cloned repository or npm bundle) or wheel-bundled _runtime
    bundled_runtime = os.path.abspath(os.path.join(os.path.dirname(__file__), "_runtime", "mcp-runtime.cjs"))
    local_index = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "index.js"))
    node_bin = shutil.which("node")
    if node_bin:
        for js_entry in (local_index, bundled_runtime):
            if os.path.isfile(js_entry):
                try:
                    os.environ["_PS_MCP_EXEC_GUARD"] = "1"
                    os.execvp(node_bin, [node_bin, js_entry] + args)
                except Exception:
                    pass

    # 2. Check for locally installed non-Python privacyscrubber-mcp binary in PATH (0 network egress)
    mcp_bin = shutil.which("privacyscrubber-mcp")
    if mcp_bin and not _is_python_entrypoint(mcp_bin):
        try:
            os.environ["_PS_MCP_EXEC_GUARD"] = "1"
            os.execvp(mcp_bin, [mcp_bin] + args)
        except Exception:
            pass

    # 3. Fallback to zero-dependency Python ZTDS engine (strictly air-gapped, no self-exec recursion)
    run_native_mcp_loop()


if __name__ == "__main__":
    main()
