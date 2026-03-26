/**
 * Autoponto Worker: atalho iOS (POST + SHORTCUT_TOKEN) + API web (sessão JWT + SESSION_SECRET).
 * Secrets: JSONBIN_BIN_ID, JSONBIN_MASTER_KEY, SHORTCUT_TOKEN, SESSION_SECRET
 */

const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b';

const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders
    }
  });
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const base = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Autoponto-Token',
    'Access-Control-Max-Age': '86400'
  };
  if (!origin) return base;
  return {
    ...base,
    'Access-Control-Allow-Origin': origin
  };
}

function noStoreHeaders() {
  return { 'Cache-Control': 'no-store' };
}

function normalizeType(type) {
  if (!type || typeof type !== 'string') return type;
  const t = type.trim().toLowerCase();
  if (t === 'saida' || t === 'saída') return 'saída';
  if (t === 'entrada') return 'entrada';
  return type;
}

function sortRecords(records) {
  return [...(records || [])].sort((a, b) => {
    const ta = new Date(a.datetime).getTime();
    const tb = new Date(b.datetime).getTime();
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb;
  });
}

function parseBinPayload(data) {
  if (data && data.record != null) return data.record;
  if (data && (typeof data.config !== 'undefined' || typeof data.records !== 'undefined')) {
    return data;
  }
  return { config: {}, records: [] };
}

function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function extractShortcutToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const h = request.headers.get('X-Autoponto-Token');
  if (h) return h.trim();
  return '';
}

function extractSessionBearer(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function b64urlEncodeBytes(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeToBytes(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(str) {
  const enc = new TextEncoder();
  const data = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return Array.from(new Uint8Array(data))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function passwordMatchesStored(stored, submitted) {
  if (stored == null || stored === '') return false;
  if (typeof submitted !== 'string') return false;
  const hash = await sha256Hex(submitted);
  if (timingSafeEqualString(stored, submitted)) return true;
  if (stored.length === 64 && /^[0-9a-f]+$/i.test(stored) && timingSafeEqualString(stored.toLowerCase(), hash)) {
    return true;
  }
  return false;
}

function sanitizeRecord(record) {
  const config = record.config && typeof record.config === 'object' ? { ...record.config } : {};
  delete config.password;
  const records = Array.isArray(record.records) ? record.records : [];
  return { config, records };
}

async function signSessionJwt(secret) {
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: 'autoponto', exp: now + SESSION_TTL_SEC, iat: now };
  const headerB64 = b64urlEncodeBytes(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payloadB64 = b64urlEncodeBytes(enc.encode(JSON.stringify(payload)));
  const data = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${b64urlEncodeBytes(new Uint8Array(sig))}`;
}

async function verifySessionJwt(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const enc = new TextEncoder();
  let key;
  try {
    key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch (_) {
    return null;
  }
  let sigBytes;
  try {
    sigBytes = b64urlDecodeToBytes(s);
  } catch (_) {
    return null;
  }
  let ok;
  try {
    ok = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
  } catch (_) {
    return null;
  }
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecodeToBytes(p)));
  } catch (_) {
    return null;
  }
  if (payload.exp != null && Math.floor(Date.now() / 1000) > payload.exp) return null;
  if (payload.sub !== 'autoponto') return null;
  return payload;
}

async function jsonBinFetch(binId, masterKey, pathSuffix, init) {
  const url = `${JSONBIN_BASE}/${binId}${pathSuffix}`;
  return fetch(url, init);
}

async function jsonBinGetLatest(binId, masterKey) {
  const res = await jsonBinFetch(binId, masterKey, '/latest', {
    headers: {
      'X-Master-Key': masterKey,
      'X-Bin-Meta': 'false'
    }
  });
  return res;
}

async function jsonBinPut(binId, masterKey, body) {
  return jsonBinFetch(binId, masterKey, '', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': masterKey
    },
    body: JSON.stringify(body)
  });
}

async function readRecordFromBin(binId, masterKey) {
  const getRes = await jsonBinGetLatest(binId, masterKey);
  if (!getRes.ok) return { error: 'jsonbin_get_failed', httpStatus: getRes.status, record: null };
  let getData;
  try {
    getData = await getRes.json();
  } catch (_) {
    return { error: 'jsonbin_invalid_response', httpStatus: 502, record: null };
  }
  return { error: null, httpStatus: null, record: parseBinPayload(getData) };
}

function hasPasswordInRecord(record) {
  const p = record.config && record.config.password;
  return typeof p === 'string' && p.length > 0;
}

async function handlePunch(request, env, c) {
  const binId = env.JSONBIN_BIN_ID;
  const masterKey = env.JSONBIN_MASTER_KEY;
  const expectedToken = env.SHORTCUT_TOKEN;

  if (!binId || !masterKey || !expectedToken) {
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 503, c);
  }

  const token = extractShortcutToken(request);
  if (!token || !timingSafeEqualString(token, expectedToken)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401, c);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400, c);
  }

  const rawType = body && body.type;
  const type = normalizeType(rawType);
  if (type !== 'entrada' && type !== 'saída') {
    return jsonResponse({ ok: false, error: 'invalid_type' }, 400, c);
  }

  let datetime = body && body.datetime;
  if (datetime != null && typeof datetime !== 'string') {
    return jsonResponse({ ok: false, error: 'invalid_datetime' }, 400, c);
  }
  if (!datetime || !String(datetime).trim()) {
    datetime = new Date().toISOString();
  } else {
    datetime = String(datetime).trim();
    const t = new Date(datetime).getTime();
    if (Number.isNaN(t)) {
      return jsonResponse({ ok: false, error: 'invalid_datetime' }, 400, c);
    }
  }

  const { error, httpStatus, record } = await readRecordFromBin(binId, masterKey);
  if (error) {
    return jsonResponse({ ok: false, error, status: httpStatus }, 502, c);
  }

  const config = record.config && typeof record.config === 'object' ? record.config : {};
  const records = Array.isArray(record.records) ? record.records : [];
  const nextRecords = sortRecords([...records, { type, datetime }]);
  const putBody = { config, records: nextRecords };

  const putRes = await jsonBinPut(binId, masterKey, putBody);
  if (!putRes.ok) {
    return jsonResponse({ ok: false, error: 'jsonbin_put_failed', status: putRes.status }, 502, c);
  }

  return jsonResponse({ ok: true, type, datetime }, 200, c);
}

async function requireSession(request, env, c) {
  const sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret) {
    return { error: jsonResponse({ ok: false, error: 'server_misconfigured' }, 503, c) };
  }
  const raw = extractSessionBearer(request);
  const payload = await verifySessionJwt(raw, sessionSecret);
  if (!payload) {
    return { error: jsonResponse({ ok: false, error: 'unauthorized' }, 401, c) };
  }
  return { error: null };
}

export default {
  async fetch(request, env) {
    const c = { ...corsHeaders(request) };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: c });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    const binId = env.JSONBIN_BIN_ID;
    const masterKey = env.JSONBIN_MASTER_KEY;

    if (!binId || !masterKey) {
      return jsonResponse({ ok: false, error: 'server_misconfigured' }, 503, c);
    }

    if (path === '/' || path === '/punch') {
      if (request.method !== 'POST') {
        return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, c);
      }
      return handlePunch(request, env, c);
    }

    if (path === '/auth/meta') {
      if (request.method !== 'GET') {
        return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, { ...c, ...noStoreHeaders() });
      }
      const { error, httpStatus, record } = await readRecordFromBin(binId, masterKey);
      if (error) {
        return jsonResponse(
          { ok: false, error, status: httpStatus },
          502,
          { ...c, ...noStoreHeaders() }
        );
      }
      return jsonResponse({ hasPassword: hasPasswordInRecord(record) }, 200, { ...c, ...noStoreHeaders() });
    }

    if (path === '/auth/login') {
      if (request.method !== 'POST') {
        return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, c);
      }
      const sessionSecret = env.SESSION_SECRET;
      if (!sessionSecret) {
        return jsonResponse({ ok: false, error: 'server_misconfigured' }, 503, c);
      }
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return jsonResponse({ ok: false, error: 'invalid_json' }, 400, c);
      }
      const password = body && body.password;
      const { error, record } = await readRecordFromBin(binId, masterKey);
      if (error) {
        return jsonResponse({ ok: false, error }, 502, c);
      }
      if (!hasPasswordInRecord(record)) {
        return jsonResponse({ ok: false, error: 'password_not_set' }, 400, c);
      }
      const stored = record.config.password;
      const ok = await passwordMatchesStored(stored, password);
      if (!ok) {
        return jsonResponse({ ok: false, error: 'invalid_password' }, 401, c);
      }
      const token = await signSessionJwt(sessionSecret);
      return jsonResponse({ ok: true, token, record: sanitizeRecord(record) }, 200, c);
    }

    if (path === '/auth/setup') {
      if (request.method !== 'POST') {
        return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, c);
      }
      const sessionSecret = env.SESSION_SECRET;
      if (!sessionSecret) {
        return jsonResponse({ ok: false, error: 'server_misconfigured' }, 503, c);
      }
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return jsonResponse({ ok: false, error: 'invalid_json' }, 400, c);
      }
      const password = body && body.password;
      if (typeof password !== 'string' || password.length < 1) {
        return jsonResponse({ ok: false, error: 'invalid_password' }, 400, c);
      }
      const { error, record } = await readRecordFromBin(binId, masterKey);
      if (error) {
        return jsonResponse({ ok: false, error }, 502, c);
      }
      if (hasPasswordInRecord(record)) {
        return jsonResponse({ ok: false, error: 'password_already_set' }, 409, c);
      }
      const hash = await sha256Hex(password);
      const config = { ...(record.config && typeof record.config === 'object' ? record.config : {}), password: hash };
      const records = Array.isArray(record.records) ? record.records : [];
      const putBody = { config, records };
      const putRes = await jsonBinPut(binId, masterKey, putBody);
      if (!putRes.ok) {
        return jsonResponse({ ok: false, error: 'jsonbin_put_failed', status: putRes.status }, 502, c);
      }
      const newRecord = { config, records };
      const token = await signSessionJwt(sessionSecret);
      return jsonResponse({ ok: true, token, record: sanitizeRecord(newRecord) }, 200, c);
    }

    if (path === '/api/bin') {
      const sessionCheck = await requireSession(request, env, c);
      if (sessionCheck.error) return sessionCheck.error;

      if (request.method === 'GET') {
        const { error, record } = await readRecordFromBin(binId, masterKey);
        if (error) {
          return jsonResponse({ ok: false, error }, 502, c);
        }
        return jsonResponse({ ok: true, record: sanitizeRecord(record) }, 200, c);
      }

      if (request.method === 'PUT') {
        let body;
        try {
          body = await request.json();
        } catch (_) {
          return jsonResponse({ ok: false, error: 'invalid_json' }, 400, c);
        }
        const { error, record: current } = await readRecordFromBin(binId, masterKey);
        if (error) {
          return jsonResponse({ ok: false, error }, 502, c);
        }
        const serverPwd = current.config && current.config.password;
        const incConfig = body && body.config && typeof body.config === 'object' ? { ...body.config } : {};
        delete incConfig.password;
        const nextConfig = { ...incConfig };
        if (serverPwd !== undefined && serverPwd !== null && serverPwd !== '') {
          nextConfig.password = serverPwd;
        }
        const nextRecords = Array.isArray(body && body.records) ? body.records : [];
        const putBody = { config: nextConfig, records: nextRecords };
        const putRes = await jsonBinPut(binId, masterKey, putBody);
        if (!putRes.ok) {
          return jsonResponse({ ok: false, error: 'jsonbin_put_failed', status: putRes.status }, 502, c);
        }
        return jsonResponse({ ok: true, record: sanitizeRecord(putBody) }, 200, c);
      }

      return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, c);
    }

    return jsonResponse({ ok: false, error: 'not_found' }, 404, c);
  }
};
