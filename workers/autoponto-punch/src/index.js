/**
 * Autoponto punch proxy: POST → GET bin → append record → PUT bin (JSONBin.io).
 * Secrets: JSONBIN_BIN_ID, JSONBIN_MASTER_KEY, SHORTCUT_TOKEN (wrangler secret put).
 */

const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b';

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
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Autoponto-Token',
    'Access-Control-Max-Age': '86400'
  };
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

function extractToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const h = request.headers.get('X-Autoponto-Token');
  if (h) return h.trim();
  return '';
}

export default {
  async fetch(request, env) {
    const c = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: c });
    }

    const url = new URL(request.url);
    const pathOk = url.pathname === '/' || url.pathname === '/punch';
    if (!pathOk) {
      return jsonResponse({ ok: false, error: 'not_found' }, 404, c);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, c);
    }

    const binId = env.JSONBIN_BIN_ID;
    const masterKey = env.JSONBIN_MASTER_KEY;
    const expectedToken = env.SHORTCUT_TOKEN;

    if (!binId || !masterKey || !expectedToken) {
      return jsonResponse({ ok: false, error: 'server_misconfigured' }, 503, c);
    }

    const token = extractToken(request);
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

    const getHeaders = {
      'X-Master-Key': masterKey,
      'X-Bin-Meta': 'false'
    };

    const getRes = await fetch(`${JSONBIN_BASE}/${binId}/latest`, { headers: getHeaders });
    if (!getRes.ok) {
      return jsonResponse(
        { ok: false, error: 'jsonbin_get_failed', status: getRes.status },
        502,
        c
      );
    }

    let getData;
    try {
      getData = await getRes.json();
    } catch (_) {
      return jsonResponse({ ok: false, error: 'jsonbin_invalid_response' }, 502, c);
    }

    const record = parseBinPayload(getData);
    const config = record.config && typeof record.config === 'object' ? record.config : {};
    const records = Array.isArray(record.records) ? record.records : [];

    const nextRecords = sortRecords([...records, { type, datetime }]);

    const putBody = { config, records: nextRecords };
    const putRes = await fetch(`${JSONBIN_BASE}/${binId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': masterKey
      },
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      return jsonResponse(
        { ok: false, error: 'jsonbin_put_failed', status: putRes.status },
        502,
        c
      );
    }

    return jsonResponse({ ok: true, type, datetime }, 200, c);
  }
};
