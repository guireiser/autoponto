(function () {
  'use strict';

  const CONFIG = window.APP_CONFIG;
  const SESSION_STORAGE_KEY = 'autoponto_session_token';
  const LEGACY_LOGGED_KEY = 'autoponto_logged_in';

  if (!CONFIG || !CONFIG.WORKER_BASE_URL || String(CONFIG.WORKER_BASE_URL).trim() === '') {
    document.body.innerHTML = '<div class="screen" id="screen-error"><p>Configure <code>config.js</code> ou <code>config.local.js</code> com WORKER_BASE_URL (URL pública do Cloudflare Worker).</p></div>';
    return;
  }

  try {
    localStorage.removeItem(LEGACY_LOGGED_KEY);
  } catch (e) { /* ignore */ }

  function workerBaseUrl() {
    return String(CONFIG.WORKER_BASE_URL).replace(/\/+$/, '');
  }

  function getSessionToken() {
    try {
      return sessionStorage.getItem(SESSION_STORAGE_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setSessionToken(t) {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, t);
    } catch (e) { /* ignore */ }
  }

  function clearSessionToken() {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (e) { /* ignore */ }
  }

  function workerFetch(path, init) {
    init = init || {};
    var url = workerBaseUrl() + path;
    var headers = {};
    if (init.body != null && typeof init.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }
    if (init.headers) {
      for (var k in init.headers) {
        if (Object.prototype.hasOwnProperty.call(init.headers, k)) {
          headers[k] = init.headers[k];
        }
      }
    }
    if (init.withAuth) {
      var tok = getSessionToken();
      if (tok) headers['Authorization'] = 'Bearer ' + tok;
    }
    return fetch(url, {
      method: init.method || 'GET',
      body: init.body,
      headers: headers
    });
  }

  const FETCH_TIMEOUT_MS = 12000;
  /** Ajuste para totais e exibição no calendário: entrada +2 min, saída −2 min (horário salvo no bin permanece o real). */
  const PUNCH_ADJUST_MS = 2 * 60 * 1000;

  function timeoutPromise(ms) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Tempo esgotado. Verifique sua conexão e a URL do Worker em config.')), ms)
    );
  }

  async function fetchAuthMeta() {
    const res = await Promise.race([
      workerFetch('/auth/meta', { method: 'GET' }),
      timeoutPromise(FETCH_TIMEOUT_MS)
    ]);
    if (!res.ok) throw new Error('Falha ao consultar o servidor.');
    const data = await res.json();
    return { hasPassword: !!data.hasPassword };
  }

  async function apiGet() {
    const fetchPromise = workerFetch('/api/bin', { method: 'GET', withAuth: true });
    const res = await Promise.race([fetchPromise, timeoutPromise(FETCH_TIMEOUT_MS)]);
    if (res.status === 401) {
      clearSessionToken();
      throw new Error('UNAUTHORIZED');
    }
    if (!res.ok) throw new Error('Falha ao carregar dados');
    const data = await res.json();
    if (!data.ok || !data.record) throw new Error('Falha ao carregar dados');
    return data.record;
  }

  async function apiPut(body) {
    const res = await Promise.race([
      workerFetch('/api/bin', {
        method: 'PUT',
        withAuth: true,
        body: JSON.stringify(body)
      }),
      timeoutPromise(FETCH_TIMEOUT_MS)
    ]);
    if (res.status === 401) {
      clearSessionToken();
      throw new Error('Sessão expirada. Entre novamente.');
    }
    if (!res.ok) throw new Error('Falha ao salvar');
    const data = await res.json();
    if (data.ok && data.record) {
      state.config = data.record.config || {};
      state.records = data.record.records || [];
      normalizeConfigBalance();
      normalizeHolidaysConfig();
      normalizeVacationsConfig();
      normalizeDayCommentsConfig();
    }
    return data;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toLocalDateKey(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) {
      if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
      return '';
    }
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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

  function getRecordsByDate(records, dayKey) {
    return sortRecords(records).filter(r => r.datetime && toLocalDateKey(r.datetime) === dayKey);
  }

  function dateStr(d) {
    return toLocalDateKey(d);
  }

  function yesterdayLocalDateKey() {
    var now = new Date();
    var y = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    y.setDate(y.getDate() - 1);
    return dateStr(y);
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatDateForInput(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function normalizeType(type) {
    if (!type || typeof type !== 'string') return type;
    const t = type.trim().toLowerCase();
    if (t === 'saida' || t === 'saída') return 'saída';
    if (t === 'entrada') return 'entrada';
    return type;
  }

  function getRecordId(r) {
    return r.id || r.datetime;
  }

  /** Ícones de origem: seta GPS (atalho), lápis (web ou edição no app). */
  var ICON_GPS_SVG = '<svg class="record-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" focusable="false"><path fill="currentColor" d="M12 2.5L19.5 12h-5.25v9.5H9.75V12H4.5L12 2.5z"/></svg>';
  var ICON_MANUAL_SVG = '<svg class="record-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round" d="M5 19h9a2 2 0 002-2v-5"/><path fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" d="M15.5 4.5l5 5M9 15l-3.5.5.5-3.5L15.5 4.5z"/></svg>';

  function recordSourceIconsHtml(r) {
    if (!r) return '';
    var parts = [];
    if (r.source === 'gps') {
      parts.push('<span class="record-source-icon record-source-gps" title="Registrado pelo atalho (GPS)">' + ICON_GPS_SVG + '</span>');
    }
    if (r.source === 'manual' || r.editedInApp === true) {
      parts.push('<span class="record-source-icon record-source-manual" title="Inserido ou editado no app">' + ICON_MANUAL_SVG + '</span>');
    }
    if (!parts.length) return '';
    return '<span class="record-source-icons">' + parts.join('') + '</span>';
  }

  /** Pares consecutivos (ordem global por data/hora real) entrada/saída com intervalo menor que 5 min (real): fora da UI e do saldo; registros permanecem no bin. */
  const GPS_GLITCH_PAIR_MAX_MS = 5 * 60 * 1000;

  function getRawRecordMs(record) {
    const t = new Date(record.datetime).getTime();
    return Number.isNaN(t) ? NaN : t;
  }

  function buildGpsNoiseIdSet(records) {
    const sorted = sortRecords(records);
    const set = {};
    let i = 0;
    while (i < sorted.length - 1) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const ta = getRawRecordMs(a);
      const tb = getRawRecordMs(b);
      if (Number.isNaN(ta) || Number.isNaN(tb)) {
        i += 1;
        continue;
      }
      const typeA = normalizeType(a.type);
      const typeB = normalizeType(b.type);
      const opposite = (typeA === 'entrada' && typeB === 'saída') || (typeA === 'saída' && typeB === 'entrada');
      const dt = tb - ta;
      if (opposite && dt >= 0 && dt < GPS_GLITCH_PAIR_MAX_MS) {
        set[getRecordId(a)] = true;
        set[getRecordId(b)] = true;
        i += 2;
      } else {
        i += 1;
      }
    }
    return set;
  }

  function getCalculationMs(record) {
    const raw = new Date(record.datetime).getTime();
    if (Number.isNaN(raw)) return NaN;
    const type = normalizeType(record.type);
    if (type === 'entrada') return raw + PUNCH_ADJUST_MS;
    if (type === 'saída') return raw - PUNCH_ADJUST_MS;
    return raw;
  }

  function formatRecordTime(record) {
    const ms = getCalculationMs(record);
    if (Number.isNaN(ms)) return formatTime(record.datetime);
    return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function minutesWorkedInDay(dayRecords) {
    const sorted = sortRecords(dayRecords);
    let totalMs = 0;
    let lastEntrada = null;
    for (const r of sorted) {
      const type = normalizeType(r.type);
      const t = getCalculationMs(r);
      if (Number.isNaN(t)) continue;
      if (type === 'entrada') lastEntrada = t;
      else if (type === 'saída' && lastEntrada !== null) {
        totalMs += Math.max(0, t - lastEntrada);
        lastEntrada = null;
      }
    }
    if (totalMs === 0 && sorted.length >= 2) {
      const entradas = sorted.filter(r => normalizeType(r.type) === 'entrada').map(r => getCalculationMs(r));
      const saidas = sorted.filter(r => normalizeType(r.type) === 'saída').map(r => getCalculationMs(r));
      if (entradas.length === 1 && saidas.length === 1) {
        const tE = entradas[0];
        const tS = saidas[0];
        if (!Number.isNaN(tE) && !Number.isNaN(tS) && tS > tE) totalMs = tS - tE;
      }
    }
    return Math.round(totalMs / 60000);
  }

  function formatMinutes(m) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${h}h ${min}min`;
  }

  var BALANCE_DEFAULTS = {
    startDate: '2026-03-23',
    initialBalanceMinutes: 296,
    weekdayMinutes: 540,
    fridayMinutes: 480
  };

  function parseLocalDateKey(key) {
    if (!key || typeof key !== 'string') return null;
    var parts = key.split('-');
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10);
    var mo = parseInt(parts[1], 10) - 1;
    var da = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(mo) || isNaN(da)) return null;
    var d = new Date(y, mo, da);
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== da) return null;
    return d;
  }

  function addOneDayToDateKey(key) {
    var d = parseLocalDateKey(key);
    if (!d) return null;
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function compareDateKeys(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  function expectedMinutesForLocalDate(d, cfg) {
    if (!d || Number.isNaN(d.getTime())) return 0;
    var day = d.getDay();
    if (day === 0 || day === 6) return 0;
    if (day === 5) return cfg.fridayMinutes;
    return cfg.weekdayMinutes;
  }

  function mergeBalanceConfig(config) {
    var raw = (config && config.balance) || {};
    var startDate = typeof raw.startDate === 'string' && raw.startDate.length >= 10
      ? raw.startDate.slice(0, 10)
      : BALANCE_DEFAULTS.startDate;
    var initialBalanceMinutes = typeof raw.initialBalanceMinutes === 'number' && !isNaN(raw.initialBalanceMinutes)
      ? Math.round(raw.initialBalanceMinutes)
      : BALANCE_DEFAULTS.initialBalanceMinutes;
    var weekdayMinutes = typeof raw.weekdayMinutes === 'number' && !isNaN(raw.weekdayMinutes)
      ? Math.round(raw.weekdayMinutes)
      : BALANCE_DEFAULTS.weekdayMinutes;
    var fridayMinutes = typeof raw.fridayMinutes === 'number' && !isNaN(raw.fridayMinutes)
      ? Math.round(raw.fridayMinutes)
      : BALANCE_DEFAULTS.fridayMinutes;
    return {
      startDate: startDate,
      initialBalanceMinutes: initialBalanceMinutes,
      weekdayMinutes: weekdayMinutes,
      fridayMinutes: fridayMinutes
    };
  }

  /** Feriados nacionais e principais móveis (2026, Brasil). Facultativos podem ser desativados em Feriados. */
  var BR_HOLIDAYS_2026 = [
    { date: '2026-01-01', name: 'Confraternização Universal' },
    { date: '2026-02-16', name: 'Carnaval (segunda-feira)' },
    { date: '2026-02-17', name: 'Carnaval (terça-feira)' },
    { date: '2026-04-03', name: 'Sexta-feira Santa' },
    { date: '2026-04-21', name: 'Tiradentes' },
    { date: '2026-05-01', name: 'Dia do Trabalhador' },
    { date: '2026-06-04', name: 'Corpus Christi' },
    { date: '2026-09-07', name: 'Independência do Brasil' },
    { date: '2026-10-12', name: 'Nossa Senhora Aparecida' },
    { date: '2026-11-02', name: 'Finados' },
    { date: '2026-11-15', name: 'Proclamação da República' },
    { date: '2026-11-20', name: 'Consciência Negra' },
    { date: '2026-12-25', name: 'Natal' }
  ];

  function isValidDateKey(key) {
    return key && parseLocalDateKey(key) !== null;
  }

  function mergePremiumDayLabel(map, dateKey, label) {
    var L = label && String(label).trim() ? String(label).trim() : 'Férias';
    var existing = map[dateKey];
    if (!existing) {
      map[dateKey] = L;
      return;
    }
    if (existing === L) return;
    var parts = String(existing).split(' · ');
    for (var p = 0; p < parts.length; p++) {
      if (parts[p] === L) return;
    }
    map[dateKey] = existing + ' · ' + L;
  }

  function applyVacationRangesToMap(map, config) {
    var list = config && Array.isArray(config.vacations) ? config.vacations : [];
    var i;
    for (i = 0; i < list.length; i++) {
      var v = list[i];
      if (!v || typeof v !== 'object') continue;
      var s = typeof v.startDate === 'string' ? v.startDate.slice(0, 10) : '';
      var e = typeof v.endDate === 'string' ? v.endDate.slice(0, 10) : '';
      if (!isValidDateKey(s) || !isValidDateKey(e)) continue;
      if (compareDateKeys(s, e) > 0) {
        var tmp = s;
        s = e;
        e = tmp;
      }
      var nm = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : 'Férias';
      var cur = s;
      var guard = 0;
      while (compareDateKeys(cur, e) <= 0 && guard < 5000) {
        mergePremiumDayLabel(map, cur, nm);
        var nx = addOneDayToDateKey(cur);
        if (!nx || nx === cur) break;
        cur = nx;
        guard++;
      }
    }
  }

  function buildHolidayMap(config) {
    var map = {};
    var i;
    for (i = 0; i < BR_HOLIDAYS_2026.length; i++) {
      var nh = BR_HOLIDAYS_2026[i];
      map[nh.date] = nh.name;
    }
    var removed = config && Array.isArray(config.holidaysRemoved) ? config.holidaysRemoved : [];
    for (i = 0; i < removed.length; i++) {
      var rk = typeof removed[i] === 'string' ? removed[i].slice(0, 10) : '';
      if (rk) delete map[rk];
    }
    var extra = config && Array.isArray(config.holidaysExtra) ? config.holidaysExtra : [];
    for (i = 0; i < extra.length; i++) {
      var ex = extra[i];
      if (!ex || typeof ex !== 'object') continue;
      var dk = typeof ex.date === 'string' ? ex.date.slice(0, 10) : '';
      if (!isValidDateKey(dk)) continue;
      var nm = typeof ex.name === 'string' && ex.name.trim() ? ex.name.trim() : 'Feriado';
      map[dk] = nm;
    }
    applyVacationRangesToMap(map, config);
    return map;
  }

  function normalizeHolidaysConfig() {
    if (!state.config) state.config = {};
    var extraIn = state.config.holidaysExtra;
    if (!Array.isArray(extraIn)) extraIn = [];
    var byDate = {};
    var j;
    for (j = 0; j < extraIn.length; j++) {
      var item = extraIn[j];
      if (!item || typeof item !== 'object') continue;
      var d = typeof item.date === 'string' ? item.date.slice(0, 10) : '';
      if (!isValidDateKey(d)) continue;
      var name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Feriado';
      byDate[d] = { date: d, name: name };
    }
    var extraOut = Object.keys(byDate).sort(compareDateKeys).map(function (k) { return byDate[k]; });
    state.config.holidaysExtra = extraOut;

    var remIn = state.config.holidaysRemoved;
    if (!Array.isArray(remIn)) remIn = [];
    var seenR = {};
    var remOut = [];
    for (j = 0; j < remIn.length; j++) {
      var rd = typeof remIn[j] === 'string' ? remIn[j].slice(0, 10) : '';
      if (!isValidDateKey(rd) || seenR[rd]) continue;
      seenR[rd] = true;
      remOut.push(rd);
    }
    remOut.sort(compareDateKeys);
    state.config.holidaysRemoved = remOut;
  }

  function normalizeVacationsConfig() {
    if (!state.config) state.config = {};
    var raw = state.config.vacations;
    if (!Array.isArray(raw)) raw = [];
    var out = [];
    var j;
    for (j = 0; j < raw.length; j++) {
      var v = raw[j];
      if (!v || typeof v !== 'object') continue;
      var s = typeof v.startDate === 'string' ? v.startDate.slice(0, 10) : '';
      var e = typeof v.endDate === 'string' ? v.endDate.slice(0, 10) : '';
      if (!isValidDateKey(s) || !isValidDateKey(e)) continue;
      if (compareDateKeys(s, e) > 0) {
        var swap = s;
        s = e;
        e = swap;
      }
      var name = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : 'Férias';
      out.push({ startDate: s, endDate: e, name: name });
    }
    out.sort(function (a, b) {
      var c = compareDateKeys(a.startDate, b.startDate);
      if (c !== 0) return c;
      return compareDateKeys(a.endDate, b.endDate);
    });
    state.config.vacations = out;
  }

  function normalizeDayCommentsConfig() {
    if (!state.config) state.config = {};
    var raw = state.config.dayComments;
    var out = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      var keys = Object.keys(raw);
      var i;
      for (i = 0; i < keys.length; i++) {
        var k = keys[i];
        var key = typeof k === 'string' ? k.slice(0, 10) : '';
        if (!isValidDateKey(key)) continue;
        var v = raw[k];
        var text = typeof v === 'string' ? v.trim() : '';
        if (text) out[key] = text;
      }
    }
    state.config.dayComments = out;
  }

  function getDayCommentText(dateKey) {
    var raw = state.config && state.config.dayComments;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
    var v = raw[dateKey];
    return typeof v === 'string' ? v.trim() : '';
  }

  function isPremiumBalanceDay(dateKey, localDate, holidayMap) {
    if (!localDate) return false;
    if (localDate.getDay() === 0) return true;
    return !!(holidayMap && holidayMap[dateKey]);
  }

  function computeBalanceUpTo(records, endDateKey, cfg, holidayMap, gpsNoiseIds) {
    holidayMap = holidayMap || {};
    gpsNoiseIds = gpsNoiseIds || {};
    var total = cfg.initialBalanceMinutes;
    if (!cfg.startDate || compareDateKeys(endDateKey, cfg.startDate) < 0) return total;
    var cur = cfg.startDate;
    var guard = 0;
    while (compareDateKeys(cur, endDateKey) <= 0) {
      var d = parseLocalDateKey(cur);
      if (!d) break;
      var expected = expectedMinutesForLocalDate(d, cfg);
      var dayAll = getRecordsByDate(records, cur);
      var dayForBalance = dayAll.filter(function (r) { return !gpsNoiseIds[getRecordId(r)]; });
      var rawWorked = minutesWorkedInDay(dayForBalance);
      var premium = isPremiumBalanceDay(cur, d, holidayMap);
      var effectiveWorked = premium ? rawWorked * 2 : rawWorked;
      total += effectiveWorked - expected;
      var next = addOneDayToDateKey(cur);
      if (!next || next === cur) break;
      cur = next;
      guard++;
      if (guard > 5000) break;
    }
    return total;
  }

  function formatSignedBalanceMinutes(m) {
    if (m === 0) return '0h 0min';
    var sign = m > 0 ? '+' : '−';
    var abs = Math.abs(m);
    return sign + formatMinutes(abs);
  }

  let state = {
    config: {},
    records: [],
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth(),
    editingId: null,
    addingForDate: null,
    appView: 'calendar',
    appChromeBound: false,
    holidayEditIndex: null,
    vacationEditIndex: null,
    dayDetailDate: null,
    dayCommentFeedbackTimer: null
  };

  function normalizeConfigBalance() {
    if (!state.config) state.config = {};
    state.config.balance = mergeBalanceConfig(state.config);
  }

  function applyRecord(record) {
    state.config = (record && record.config) || {};
    state.records = (record && record.records) || [];
    normalizeConfigBalance();
    normalizeHolidaysConfig();
    normalizeVacationsConfig();
    normalizeDayCommentsConfig();
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); });
    const el = document.getElementById('screen-' + id);
    if (el) el.classList.add('active');
  }

  function renderLogin(meta) {
    const hasPassword = meta && meta.hasPassword;
    const screen = document.getElementById('screen-login');
    if (!screen) return;
    if (hasPassword) {
      screen.innerHTML = `
        <h1>Controle de Ponto</h1>
        <form id="form-login">
          <label>Senha <input type="password" id="input-password" required autocomplete="current-password"></label>
          <button type="submit">Entrar</button>
        </form>
        <p id="login-error" class="error" aria-live="polite"></p>
      `;
      screen.querySelector('#form-login').onsubmit = async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('login-error');
        const input = document.getElementById('input-password');
        const submitted = input.value;
        errEl.textContent = '';
        try {
          const res = await Promise.race([
            workerFetch('/auth/login', {
              method: 'POST',
              body: JSON.stringify({ password: submitted })
            }),
            timeoutPromise(FETCH_TIMEOUT_MS)
          ]);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            errEl.textContent = res.status === 401 ? 'Senha incorreta.' : (data.error || 'Erro ao entrar.');
            return;
          }
          if (data.token) setSessionToken(data.token);
          applyRecord(data.record);
          showScreen('app');
          renderApp();
        } catch (err) {
          errEl.textContent = err.message && err.message.indexOf('Tempo esgotado') !== -1
            ? err.message
            : 'Erro ao entrar. Verifique a conexão.';
        }
      };
    } else {
      screen.innerHTML = `
        <h1>Controle de Ponto</h1>
        <p>Primeira vez: defina uma senha de acesso.</p>
        <form id="form-set-password">
          <label>Nova senha <input type="password" id="input-new-password" required minlength="1" autocomplete="new-password"></label>
          <label>Repetir <input type="password" id="input-repeat" required minlength="1"></label>
          <button type="submit">Definir senha</button>
        </form>
        <p id="set-password-error" class="error" aria-live="polite"></p>
      `;
      screen.querySelector('#form-set-password').onsubmit = async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('set-password-error');
        const p1 = document.getElementById('input-new-password').value;
        const p2 = document.getElementById('input-repeat').value;
        if (p1 !== p2) {
          errEl.textContent = 'As senhas não coincidem.';
          return;
        }
        errEl.textContent = '';
        try {
          const res = await Promise.race([
            workerFetch('/auth/setup', {
              method: 'POST',
              body: JSON.stringify({ password: p1 })
            }),
            timeoutPromise(FETCH_TIMEOUT_MS)
          ]);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            errEl.textContent = res.status === 409
              ? 'A senha já foi definida. Recarregue a página.'
              : (data.error || 'Erro ao salvar.');
            return;
          }
          if (data.token) setSessionToken(data.token);
          applyRecord(data.record);
          showScreen('app');
          renderApp();
        } catch (err) {
          errEl.textContent = err.message || 'Erro ao salvar.';
        }
      };
    }
  }

  function setAppViewVisibility(view) {
    var vc = document.getElementById('view-calendar');
    var vh = document.getElementById('view-holidays');
    var tabC = document.getElementById('tab-calendar');
    var tabH = document.getElementById('tab-holidays');
    if (!vc || !vh) return;
    var isCal = view === 'calendar';
    vc.classList.toggle('active', isCal);
    vh.classList.toggle('active', !isCal);
    vc.setAttribute('aria-hidden', isCal ? 'false' : 'true');
    vh.setAttribute('aria-hidden', isCal ? 'true' : 'false');
    if (tabC) tabC.classList.toggle('active', isCal);
    if (tabH) tabH.classList.toggle('active', !isCal);
  }

  function ensureAppChrome() {
    if (state.appChromeBound) return;
    var lo = document.getElementById('btn-logout');
    if (lo) {
      lo.onclick = function () {
        clearSessionToken();
        var loginScreen = document.getElementById('screen-login');
        if (loginScreen) loginScreen.innerHTML = '<p>Carregando…</p>';
        showScreen('login');
        fetchAuthMeta()
          .then(function (m) { renderLogin(m); })
          .catch(function () { renderLogin({ hasPassword: true }); });
      };
    }
    var tabC = document.getElementById('tab-calendar');
    var tabH = document.getElementById('tab-holidays');
    if (tabC) {
      tabC.onclick = function () {
        state.appView = 'calendar';
        setAppViewVisibility('calendar');
        renderCalendar();
      };
    }
    if (tabH) {
      tabH.onclick = function () {
        state.appView = 'holidays';
        setAppViewVisibility('holidays');
        renderHolidays();
      };
    }
    state.appChromeBound = true;
  }

  function renderCalendar() {
    const container = document.getElementById('view-calendar');
    if (!container) return;
    const year = state.currentYear;
    const month = state.currentMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const start = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    let grid = '<div class="calendar-scroll"><div class="calendar-weekdays">' + weekDays.map(d => `<span>${d}</span>`).join('') + '</div><div class="calendar-grid">';
    for (let i = 0; i < start; i++) grid += '<div class="calendar-day empty"></div>';
    const balanceCfg = mergeBalanceConfig(state.config);
    const holidayMap = buildHolidayMap(state.config);
    const gpsNoiseIds = buildGpsNoiseIdSet(state.records);
    const yesterdayKey = yesterdayLocalDateKey();
    let totalMonthMinutes = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStrLocal = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayRecordsAll = getRecordsByDate(state.records, dateStrLocal);
      const dayRecords = dayRecordsAll.filter(r => !gpsNoiseIds[getRecordId(r)]);
      const minutes = minutesWorkedInDay(dayRecords);
      totalMonthMinutes += minutes;
      const isToday = dateStrLocal === dateStr(new Date());
      const holidayName = holidayMap[dateStrLocal];
      const isHolidayCell = !!holidayName;
      const dParsed = parseLocalDateKey(dateStrLocal);
      const premium = isPremiumBalanceDay(dateStrLocal, dParsed, holidayMap);
      const showPremiumHint = minutes > 0 && premium;
      const dayBalanceStr = compareDateKeys(dateStrLocal, yesterdayKey) <= 0
        ? formatSignedBalanceMinutes(computeBalanceUpTo(state.records, dateStrLocal, balanceCfg, holidayMap, gpsNoiseIds))
        : '—';
      const dayClasses = ['calendar-day'];
      if (isToday) dayClasses.push('today');
      if (isHolidayCell) dayClasses.push('holiday');
      const hasDayComment = !!getDayCommentText(dateStrLocal);
      const commentHint = hasDayComment ? 'Há comentário neste dia (veja nos detalhes)' : '';
      const dLabel = dParsed
        ? dParsed.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
        : dateStrLocal;
      const openLabel = 'Abrir detalhes: ' + dLabel;
      grid += `<div class="${dayClasses.join(' ')}" data-date="${dateStrLocal}">
        <button type="button" class="day-open-detail" data-date="${dateStrLocal}" title="${escapeHtml(openLabel)}" aria-label="${escapeHtml(openLabel)}">
          <span class="day-open-detail-num">${d}</span>
          <span class="day-open-detail-trail">
            <span class="day-open-detail-chevron" aria-hidden="true">›</span>
            ${hasDayComment ? `<span class="day-comment-icon" title="${escapeHtml(commentHint)}" aria-label="Comentário neste dia">💬</span>` : '<span class="day-open-detail-slot" aria-hidden="true"></span>'}
          </span>
        </button>
        ${isHolidayCell ? `<div class="day-holiday-name" title="${escapeHtml(holidayName)}">${escapeHtml(holidayName)}</div>` : ''}
        <div class="day-total"><span class="day-total-label">Total:</span> <span class="day-hours">${minutes > 0 ? formatMinutes(minutes) : '—'}</span>${showPremiumHint ? ' <span class="day-premium-hint" title="Horas contam em dobro no saldo (domingo, feriado ou férias)">(2× saldo)</span>' : ''}</div>
        <div class="day-balance"><span class="day-balance-label">Saldo:</span> <span class="day-balance-value">${dayBalanceStr}</span></div>
        <ul class="day-records day-records-calendar">${calendarDayRecordsPreviewHtml(dayRecords)}</ul>
      </div>`;
    }
    grid += '</div></div>';
    const monthTotalStr = totalMonthMinutes > 0 ? formatMinutes(totalMonthMinutes) : '—';
    const balanceMinutes = computeBalanceUpTo(state.records, yesterdayKey, balanceCfg, holidayMap, gpsNoiseIds);
    const balanceStr = formatSignedBalanceMinutes(balanceMinutes);
    const nav = `
      <nav class="calendar-nav">
        <button type="button" id="btn-prev-month" aria-label="Mês anterior">‹</button>
        <span class="calendar-title">${(function () {
          var mn = firstDay.toLocaleDateString('pt-BR', { month: 'long' });
          var cap = mn.charAt(0).toUpperCase() + mn.slice(1);
          return cap + '/' + firstDay.getFullYear();
        })()}</span>
        <button type="button" id="btn-next-month" aria-label="Próximo mês">›</button>
        <div class="calendar-nav-totals">
          <span class="calendar-balance" aria-label="Saldo de horas até ontem">Saldo até ontem: ${balanceStr}</span>
          <span class="calendar-month-total" aria-label="Total de horas no mês">Total do mês: ${monthTotalStr}</span>
        </div>
      </nav>
    `;
    container.innerHTML = nav + grid;

    document.getElementById('btn-prev-month').onclick = () => {
      if (state.currentMonth === 0) { state.currentYear--; state.currentMonth = 11; }
      else state.currentMonth--;
      renderCalendar();
    };
    document.getElementById('btn-next-month').onclick = () => {
      if (state.currentMonth === 11) { state.currentYear++; state.currentMonth = 0; }
      else state.currentMonth++;
      renderCalendar();
    };

    container.querySelectorAll('.day-open-detail').forEach(btn => {
      btn.onclick = function () {
        var dk = btn.getAttribute('data-date');
        if (dk) openDayDetailModal(dk);
      };
    });
  }

  function openHolidayModal(mode, index) {
    state.holidayEditIndex = mode === 'edit' && typeof index === 'number' ? index : null;
    const modal = document.getElementById('modal-holiday');
    const title = document.getElementById('modal-holiday-title');
    const dateIn = document.getElementById('holiday-date');
    const nameIn = document.getElementById('holiday-name');
    if (!modal || !dateIn || !nameIn) return;
    if (title) title.textContent = mode === 'edit' ? 'Editar feriado manual' : 'Adicionar feriado manual';
    if (mode === 'edit' && state.holidayEditIndex !== null) {
      var row = state.config.holidaysExtra[state.holidayEditIndex];
      dateIn.value = row ? row.date : '';
      nameIn.value = row ? row.name : '';
    } else {
      dateIn.value = '';
      nameIn.value = '';
    }
    dateIn.disabled = mode === 'edit';
    modal.classList.add('active');
    nameIn.focus();
  }

  function closeHolidayModal() {
    state.holidayEditIndex = null;
    const modal = document.getElementById('modal-holiday');
    if (modal) modal.classList.remove('active');
    var dateIn = document.getElementById('holiday-date');
    if (dateIn) dateIn.disabled = false;
  }

  async function saveHolidayForm(e) {
    e.preventDefault();
    const dateIn = document.getElementById('holiday-date');
    const nameIn = document.getElementById('holiday-name');
    if (!dateIn || !nameIn) return;
    const dk = dateIn.value;
    const nm = nameIn.value.trim();
    if (!isValidDateKey(dk) || !nm) return;
    var backup = JSON.stringify(state.config.holidaysExtra || []);
    var extra = Array.isArray(state.config.holidaysExtra) ? state.config.holidaysExtra.slice() : [];
    if (state.holidayEditIndex !== null) {
      var idx = state.holidayEditIndex;
      if (extra[idx]) extra[idx] = { date: extra[idx].date, name: nm };
    } else {
      var replaced = false;
      for (var i = 0; i < extra.length; i++) {
        if (extra[i].date === dk) {
          extra[i] = { date: dk, name: nm };
          replaced = true;
          break;
        }
      }
      if (!replaced) extra.push({ date: dk, name: nm });
    }
    state.config.holidaysExtra = extra;
    normalizeHolidaysConfig();
    try {
      await persist();
    } catch (err) {
      try {
        state.config.holidaysExtra = JSON.parse(backup);
      } catch (_) {
        state.config.holidaysExtra = [];
      }
      normalizeHolidaysConfig();
      alert(err.message || 'Erro ao salvar.');
      return;
    }
    closeHolidayModal();
    renderHolidays();
  }

  function openVacationModal(mode, index) {
    state.vacationEditIndex = mode === 'edit' && typeof index === 'number' ? index : null;
    const modal = document.getElementById('modal-vacation');
    const title = document.getElementById('modal-vacation-title');
    const startIn = document.getElementById('vacation-start');
    const endIn = document.getElementById('vacation-end');
    const nameIn = document.getElementById('vacation-name');
    if (!modal || !startIn || !endIn || !nameIn) return;
    if (title) title.textContent = mode === 'edit' ? 'Editar férias' : 'Adicionar férias';
    if (mode === 'edit' && state.vacationEditIndex !== null) {
      var row = state.config.vacations[state.vacationEditIndex];
      startIn.value = row ? row.startDate : '';
      endIn.value = row ? row.endDate : '';
      nameIn.value = row && row.name !== 'Férias' ? row.name : '';
    } else {
      startIn.value = '';
      endIn.value = '';
      nameIn.value = '';
    }
    modal.classList.add('active');
    startIn.focus();
  }

  function closeVacationModal() {
    state.vacationEditIndex = null;
    const modal = document.getElementById('modal-vacation');
    if (modal) modal.classList.remove('active');
  }

  async function saveVacationForm(e) {
    e.preventDefault();
    const startIn = document.getElementById('vacation-start');
    const endIn = document.getElementById('vacation-end');
    const nameIn = document.getElementById('vacation-name');
    if (!startIn || !endIn || !nameIn) return;
    var s = startIn.value;
    var en = endIn.value;
    if (!isValidDateKey(s) || !isValidDateKey(en)) return;
    var nm = nameIn.value.trim();
    if (!nm) nm = 'Férias';
    var backup = JSON.stringify(state.config.vacations || []);
    var list = Array.isArray(state.config.vacations) ? state.config.vacations.slice() : [];
    if (state.vacationEditIndex !== null) {
      var ix = state.vacationEditIndex;
      if (list[ix]) list[ix] = { startDate: s.slice(0, 10), endDate: en.slice(0, 10), name: nm };
    } else {
      list.push({ startDate: s.slice(0, 10), endDate: en.slice(0, 10), name: nm });
    }
    state.config.vacations = list;
    normalizeVacationsConfig();
    try {
      await persist();
    } catch (err) {
      try {
        state.config.vacations = JSON.parse(backup);
      } catch (_) {
        state.config.vacations = [];
      }
      normalizeVacationsConfig();
      alert(err.message || 'Erro ao salvar.');
      return;
    }
    closeVacationModal();
    renderHolidays();
  }

  function renderHolidays() {
    const container = document.getElementById('view-holidays');
    if (!container) return;
    normalizeHolidaysConfig();
    normalizeVacationsConfig();
    var holidayMap = buildHolidayMap(state.config);
    var removedSet = {};
    var rm = state.config.holidaysRemoved || [];
    for (var r = 0; r < rm.length; r++) removedSet[rm[r]] = true;

    var nationalRows = BR_HOLIDAYS_2026.map(function (h) {
      var inMap = !!holidayMap[h.date];
      var displayName = inMap ? holidayMap[h.date] : h.name;
      var statusLabel = inMap ? 'Ativo' : 'Não considerado';
      var actions = inMap && !removedSet[h.date]
        ? `<button type="button" class="btn-table" data-holiday-ignore="${h.date}">Não considerar</button>`
        : `<button type="button" class="btn-table" data-holiday-restore="${h.date}">Restaurar</button>`;
      return `<tr><td>${h.date}</td><td>${escapeHtml(displayName)}</td><td>Nacional 2026</td><td>${statusLabel}</td><td>${actions}</td></tr>`;
    }).join('');

    var extras = state.config.holidaysExtra || [];
    var manualRows = extras.map(function (row, idx) {
      return `<tr><td>${row.date}</td><td>${escapeHtml(row.name)}</td><td>Manual</td><td>—</td><td>
        <button type="button" class="btn-table" data-holiday-edit="${idx}">Editar</button>
        <button type="button" class="btn-table danger" data-holiday-delete="${idx}">Excluir</button>
      </td></tr>`;
    }).join('');

    var vacs = state.config.vacations || [];
    var vacationRows = vacs.map(function (row, vidx) {
      return `<tr><td>${row.startDate}</td><td>${row.endDate}</td><td>${escapeHtml(row.name)}</td><td>
        <button type="button" class="btn-table" data-vacation-edit="${vidx}">Editar</button>
        <button type="button" class="btn-table danger" data-vacation-delete="${vidx}">Excluir</button>
      </td></tr>`;
    }).join('');

    container.innerHTML = `
      <div class="holidays-page">
        <p class="holidays-intro">Feriados nacionais e móveis de 2026 vêm do app; use <strong>Não considerar</strong> se não se aplicam (ex.: ponto facultativo). <strong>Férias</strong> são períodos (data inicial e final): cada dia do intervalo se comporta como feriado no saldo. Horas em <strong>domingo</strong>, <strong>feriado ativo</strong> ou <strong>dia de férias</strong> contam em <strong>dobro</strong> só no saldo.</p>
        <p><button type="button" id="btn-add-holiday" class="btn-primary">Adicionar feriado manual</button>
        <button type="button" id="btn-add-vacation" class="btn-primary">Adicionar férias</button></p>
        <h3 class="holidays-section-title">Nacionais (semente 2026)</h3>
        <div class="table-wrap">
          <table class="holidays-table">
            <thead><tr><th>Data</th><th>Nome</th><th>Origem</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>${nationalRows}</tbody>
          </table>
        </div>
        <h3 class="holidays-section-title">Manuais</h3>
        <div class="table-wrap">
          <table class="holidays-table">
            <thead><tr><th>Data</th><th>Nome</th><th>Origem</th><th></th><th>Ações</th></tr></thead>
            <tbody>${manualRows || '<tr><td colspan="5">Nenhum feriado manual.</td></tr>'}</tbody>
          </table>
        </div>
        <h3 class="holidays-section-title">Férias</h3>
        <div class="table-wrap">
          <table class="holidays-table">
            <thead><tr><th>Início</th><th>Fim</th><th>Nome</th><th>Ações</th></tr></thead>
            <tbody>${vacationRows || '<tr><td colspan="4">Nenhum período de férias.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;

    var addBtn = document.getElementById('btn-add-holiday');
    if (addBtn) addBtn.onclick = function () { openHolidayModal('add'); };
    var addVac = document.getElementById('btn-add-vacation');
    if (addVac) addVac.onclick = function () { openVacationModal('add'); };

    container.querySelectorAll('[data-holiday-ignore]').forEach(function (btn) {
      btn.onclick = async function () {
        var dt = btn.getAttribute('data-holiday-ignore');
        if (!dt) return;
        var cur = state.config.holidaysRemoved || [];
        if (cur.indexOf(dt) === -1) {
          state.config.holidaysRemoved = cur.concat([dt]);
          normalizeHolidaysConfig();
          try {
            await persist();
          } catch (err) {
            alert(err.message || 'Erro ao salvar.');
          }
        }
        renderHolidays();
      };
    });

    container.querySelectorAll('[data-holiday-restore]').forEach(function (btn) {
      btn.onclick = async function () {
        var dt = btn.getAttribute('data-holiday-restore');
        if (!dt) return;
        state.config.holidaysRemoved = (state.config.holidaysRemoved || []).filter(function (x) { return x !== dt; });
        normalizeHolidaysConfig();
        try {
          await persist();
        } catch (err) {
          alert(err.message || 'Erro ao salvar.');
        }
        renderHolidays();
      };
    });

    container.querySelectorAll('[data-holiday-edit]').forEach(function (btn) {
      btn.onclick = function () {
        var idx = parseInt(btn.getAttribute('data-holiday-edit'), 10);
        if (!isNaN(idx)) openHolidayModal('edit', idx);
      };
    });

    container.querySelectorAll('[data-holiday-delete]').forEach(function (btn) {
      btn.onclick = async function () {
        var idx = parseInt(btn.getAttribute('data-holiday-delete'), 10);
        if (isNaN(idx) || !confirm('Excluir este feriado manual?')) return;
        var ex = (state.config.holidaysExtra || []).slice();
        ex.splice(idx, 1);
        state.config.holidaysExtra = ex;
        normalizeHolidaysConfig();
        try {
          await persist();
        } catch (err) {
          alert(err.message || 'Erro ao salvar.');
        }
        renderHolidays();
      };
    });

    container.querySelectorAll('[data-vacation-edit]').forEach(function (btn) {
      btn.onclick = function () {
        var idx = parseInt(btn.getAttribute('data-vacation-edit'), 10);
        if (!isNaN(idx)) openVacationModal('edit', idx);
      };
    });

    container.querySelectorAll('[data-vacation-delete]').forEach(function (btn) {
      btn.onclick = async function () {
        var idx = parseInt(btn.getAttribute('data-vacation-delete'), 10);
        if (isNaN(idx) || !confirm('Excluir este período de férias?')) return;
        var list = (state.config.vacations || []).slice();
        list.splice(idx, 1);
        state.config.vacations = list;
        normalizeVacationsConfig();
        try {
          await persist();
        } catch (err) {
          alert(err.message || 'Erro ao salvar.');
        }
        renderHolidays();
      };
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderApp() {
    ensureAppChrome();
    if (!state.appView) state.appView = 'calendar';
    setAppViewVisibility(state.appView);
    if (state.appView === 'holidays') renderHolidays();
    else renderCalendar();
  }

  function openEditModal(record) {
    state.editingId = getRecordId(record);
    const modal = document.getElementById('modal-edit');
    if (!modal) return;
    document.getElementById('edit-type').value = normalizeType(record.type);
    document.getElementById('edit-datetime').value = formatDateForInput(record.datetime);
    document.getElementById('edit-datetime').focus();
    modal.classList.add('active');
  }

  function openAddModal(dateStrLocal) {
    state.addingForDate = dateStrLocal;
    const modal = document.getElementById('modal-add');
    if (!modal) return;
    document.getElementById('add-type').value = 'entrada';
    document.getElementById('add-datetime').value = dateStrLocal + 'T08:00';
    modal.classList.add('active');
  }

  function closeModals() {
    state.editingId = null;
    state.addingForDate = null;
    var me = document.getElementById('modal-edit');
    var ma = document.getElementById('modal-add');
    if (me) me.classList.remove('active');
    if (ma) ma.classList.remove('active');
  }

  async function saveEdit(e) {
    e.preventDefault();
    const type = document.getElementById('edit-type').value;
    const datetime = document.getElementById('edit-datetime').value;
    if (!datetime) return;
    const iso = new Date(datetime).toISOString();
    const idx = state.records.findIndex(r => getRecordId(r) === state.editingId);
    if (idx === -1) { closeModals(); return; }
    state.records[idx] = { ...state.records[idx], type, datetime: iso, editedInApp: true };
    await persist();
    closeModals();
    renderApp();
    refreshDayDetailModalIfOpen();
  }

  async function saveAdd(e) {
    e.preventDefault();
    const type = document.getElementById('add-type').value;
    const datetime = document.getElementById('add-datetime').value;
    if (!datetime) return;
    const iso = new Date(datetime).toISOString();
    state.records.push({ type, datetime: iso, source: 'manual' });
    state.records = sortRecords(state.records);
    await persist();
    closeModals();
    renderApp();
    refreshDayDetailModalIfOpen();
  }

  async function deleteRecord(id) {
    state.records = state.records.filter(r => getRecordId(r) !== id);
    await persist();
    renderApp();
    refreshDayDetailModalIfOpen();
  }

  async function persist() {
    normalizeConfigBalance();
    normalizeHolidaysConfig();
    normalizeVacationsConfig();
    normalizeDayCommentsConfig();
    const body = { config: state.config, records: state.records };
    await apiPut(body);
  }

  function closeDayDetailModal() {
    state.dayDetailDate = null;
    var modal = document.getElementById('modal-day-detail');
    if (modal) modal.classList.remove('active');
  }

  function calendarDayRecordsPreviewHtml(dayRecords) {
    if (!dayRecords.length) {
      return '<li class="day-calendar-empty">Nenhum ponto neste dia.</li>';
    }
    return dayRecords.map(function (r) {
      var type = normalizeType(r.type);
      return `
          <li class="record-${type} day-record-calendar">
            <span class="record-type">${type === 'entrada' ? 'E' : 'S'}</span>
            <span class="record-time">${formatRecordTime(r)}</span>
            ${recordSourceIconsHtml(r)}
          </li>`;
    }).join('');
  }

  function dayDetailRecordsHtml(dayRecords) {
    return dayRecords.map(function (r) {
      var type = normalizeType(r.type);
      return `
          <li data-id="${r.id || r.datetime}" class="record-${type}">
            <span class="record-type">${type === 'entrada' ? 'E' : 'S'}</span>
            <span class="record-time">${formatRecordTime(r)}</span>
            ${recordSourceIconsHtml(r)}
            <button type="button" class="btn-edit" data-id="${r.id || r.datetime}" aria-label="Editar">✎</button>
            <button type="button" class="btn-delete" data-id="${r.id || r.datetime}" aria-label="Excluir">×</button>
          </li>`;
    }).join('');
  }

  function bindDayDetailRecordButtons() {
    var modal = document.getElementById('modal-day-detail');
    if (!modal) return;
    modal.querySelectorAll('.btn-edit').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var r = state.records.find(function (x) { return (x.id || x.datetime) === id; });
        if (r) openEditModal(r);
      };
    });
    modal.querySelectorAll('.btn-delete').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        if (confirm('Excluir este registro?')) deleteRecord(id);
      };
    });
  }

  function clearDayCommentSaveFeedback() {
    var el = document.getElementById('day-detail-comment-feedback');
    if (el) {
      el.textContent = '';
      el.className = 'day-detail-save-feedback';
      el.setAttribute('hidden', 'hidden');
    }
    if (state.dayCommentFeedbackTimer) {
      clearTimeout(state.dayCommentFeedbackTimer);
      state.dayCommentFeedbackTimer = null;
    }
    var btn = document.getElementById('day-detail-save-comment');
    if (btn) {
      btn.classList.remove('is-success-flash');
      var def = btn.getAttribute('data-label-default');
      if (def) btn.textContent = def;
    }
  }

  function showDayCommentSavedFeedback() {
    var el = document.getElementById('day-detail-comment-feedback');
    if (el) {
      el.textContent = 'Comentário salvo com sucesso.';
      el.className = 'day-detail-save-feedback is-success';
      el.removeAttribute('hidden');
    }
    var btn = document.getElementById('day-detail-save-comment');
    if (btn) {
      btn.textContent = 'Salvo ✓';
      btn.classList.add('is-success-flash');
    }
    if (state.dayCommentFeedbackTimer) clearTimeout(state.dayCommentFeedbackTimer);
    state.dayCommentFeedbackTimer = setTimeout(function () {
      clearDayCommentSaveFeedback();
    }, 4000);
  }

  function populateDayDetailModal(dateStrLocal) {
    var titleEl = document.getElementById('modal-day-detail-title');
    var ul = document.getElementById('day-detail-records');
    var ta = document.getElementById('day-detail-comment');
    if (!titleEl || !ul || !ta) return;
    var d = parseLocalDateKey(dateStrLocal);
    var titleStr = d
      ? d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : dateStrLocal;
    titleEl.textContent = titleStr.charAt(0).toUpperCase() + titleStr.slice(1);
    var gpsNoiseIds = buildGpsNoiseIdSet(state.records);
    var dayRecordsAll = getRecordsByDate(state.records, dateStrLocal);
    var dayRecords = dayRecordsAll.filter(function (r) { return !gpsNoiseIds[getRecordId(r)]; });
    ul.innerHTML = dayRecords.length
      ? dayDetailRecordsHtml(dayRecords)
      : '<li class="day-detail-empty">Sem registros neste dia.</li>';
    ta.value = getDayCommentText(dateStrLocal);
    bindDayDetailRecordButtons();
  }

  function refreshDayDetailModalIfOpen(opts) {
    var clearFb = !opts || opts.clearCommentFeedback !== false;
    var modal = document.getElementById('modal-day-detail');
    if (!modal || !modal.classList.contains('active') || !state.dayDetailDate) return;
    if (clearFb) clearDayCommentSaveFeedback();
    populateDayDetailModal(state.dayDetailDate);
  }

  function openDayDetailModal(dateStrLocal) {
    state.dayDetailDate = dateStrLocal;
    var modal = document.getElementById('modal-day-detail');
    if (!modal) return;
    clearDayCommentSaveFeedback();
    populateDayDetailModal(dateStrLocal);
    modal.classList.add('active');
  }

  async function saveDayDetailComment() {
    var dateStrLocal = state.dayDetailDate;
    if (!dateStrLocal) return;
    var ta = document.getElementById('day-detail-comment');
    if (!ta) return;
    var text = typeof ta.value === 'string' ? ta.value.trim() : '';
    if (!state.config.dayComments || typeof state.config.dayComments !== 'object' || Array.isArray(state.config.dayComments)) {
      state.config.dayComments = {};
    }
    if (text) state.config.dayComments[dateStrLocal] = text;
    else delete state.config.dayComments[dateStrLocal];
    normalizeDayCommentsConfig();
    var saveBtn = document.getElementById('day-detail-save-comment');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.classList.add('is-busy');
    }
    try {
      await persist();
    } catch (err) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.classList.remove('is-busy');
      }
      alert(err.message || 'Erro ao salvar.');
      return;
    }
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove('is-busy');
    }
    refreshDayDetailModalIfOpen({ clearCommentFeedback: false });
    renderApp();
    showDayCommentSavedFeedback();
  }

  var formEdit = document.getElementById('form-edit');
  if (formEdit) formEdit.addEventListener('submit', saveEdit);
  var formAdd = document.getElementById('form-add');
  if (formAdd) formAdd.addEventListener('submit', saveAdd);
  var formHoliday = document.getElementById('form-holiday');
  if (formHoliday) formHoliday.addEventListener('submit', saveHolidayForm);
  var formVacation = document.getElementById('form-vacation');
  if (formVacation) formVacation.addEventListener('submit', saveVacationForm);
  var modalHoliday = document.getElementById('modal-holiday');
  if (modalHoliday) {
    var modalHolidayClose = modalHoliday.querySelector('.modal-close');
    if (modalHolidayClose) modalHolidayClose.addEventListener('click', closeHolidayModal);
  }
  var modalVacation = document.getElementById('modal-vacation');
  if (modalVacation) {
    var modalVacationClose = modalVacation.querySelector('.modal-close');
    if (modalVacationClose) modalVacationClose.addEventListener('click', closeVacationModal);
  }
  var modalEditClose = document.getElementById('modal-edit');
  if (modalEditClose) {
    modalEditClose = modalEditClose.querySelector('.modal-close');
    if (modalEditClose) modalEditClose.addEventListener('click', closeModals);
  }
  var modalAddClose = document.getElementById('modal-add');
  if (modalAddClose) {
    modalAddClose = modalAddClose.querySelector('.modal-close');
    if (modalAddClose) modalAddClose.addEventListener('click', closeModals);
  }

  var modalDayDetail = document.getElementById('modal-day-detail');
  if (modalDayDetail) {
    var modalDayDetailClose = modalDayDetail.querySelector('.modal-close');
    if (modalDayDetailClose) modalDayDetailClose.addEventListener('click', closeDayDetailModal);
    var btnDayAdd = document.getElementById('day-detail-add-point');
    if (btnDayAdd) {
      btnDayAdd.addEventListener('click', function () {
        if (state.dayDetailDate) openAddModal(state.dayDetailDate);
      });
    }
    var btnSaveComment = document.getElementById('day-detail-save-comment');
    if (btnSaveComment) btnSaveComment.addEventListener('click', saveDayDetailComment);
  }

  function showError(message) {
    const errEl = document.getElementById('screen-error');
    if (errEl) {
      const p = errEl.querySelector('p');
      if (p) p.textContent = message;
      showScreen('error');
    }
  }

  async function init() {
    const loading = document.getElementById('screen-loading');
    const FAILSAFE_MS = 16000;
    let done = false;
    const failsafeId = setTimeout(function () {
      if (done) return;
      done = true;
      showError('O carregamento demorou demais. Verifique sua conexão, se o Worker está no ar e se WORKER_BASE_URL está correto no deploy.');
    }, FAILSAFE_MS);
    if (loading) loading.classList.add('active');
    showScreen('loading');
    try {
      if (getSessionToken()) {
        try {
          const data = await apiGet();
          if (done) return;
          applyRecord(data);
          showScreen('app');
          renderApp();
          return;
        } catch (err) {
          if (done) return;
          if (err.message !== 'UNAUTHORIZED') {
            const msg = err.message || '';
            const friendly = msg.includes('Tempo esgotado')
              ? msg
              : (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
                ? 'Não foi possível conectar ao Worker. Verifique a conexão e WORKER_BASE_URL.'
                : msg || 'Erro ao carregar.');
            showError(friendly);
            return;
          }
        }
      }
      const meta = await fetchAuthMeta();
      if (done) return;
      showScreen('login');
      renderLogin(meta);
    } catch (err) {
      if (done) return;
      const msg = err.message || '';
      const friendly = msg.includes('Tempo esgotado')
        ? msg
        : (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
          ? 'Não foi possível conectar ao Worker. Verifique a conexão e WORKER_BASE_URL.'
          : msg || 'Erro ao carregar.');
      showError(friendly);
    } finally {
      done = true;
      clearTimeout(failsafeId);
      if (loading) loading.classList.remove('active');
    }
  }

  try {
    init();
  } catch (e) {
    var errEl = document.getElementById('screen-error');
    if (errEl && errEl.querySelector('p')) errEl.querySelector('p').textContent = (e && e.message) || 'Erro ao iniciar.';
    showScreen('error');
  }
})();
