(function () {
  'use strict';

  const CONFIG = window.APP_CONFIG;
  const STORAGE_KEY = 'autoponto_logged_in';
  const API_BASE = 'https://api.jsonbin.io/v3/b';

  if (!CONFIG || !CONFIG.BIN_ID || !CONFIG.API_KEY) {
    document.body.innerHTML = '<div class="screen" id="screen-error"><p>Configure <code>config.js</code> ou <code>config.local.js</code> com BIN_ID e API_KEY (JSONBin.io).</p></div>';
    return;
  }

  const binUrl = () => `${API_BASE}/${CONFIG.BIN_ID}/latest`;
  const binPutUrl = () => `${API_BASE}/${CONFIG.BIN_ID}`;

  const headers = (isPut) => ({
    'Content-Type': 'application/json',
    'X-Master-Key': CONFIG.API_KEY,
    ...(isPut ? {} : { 'X-Bin-Meta': 'false' })
  });

  const FETCH_TIMEOUT_MS = 12000;
  /** Ajuste para totais e exibição no calendário: entrada +2 min, saída −2 min (horário salvo no bin permanece o real). */
  const PUNCH_ADJUST_MS = 2 * 60 * 1000;

  function timeoutPromise(ms) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Tempo esgotado. Verifique sua conexão e se o BIN_ID está correto.')), ms)
    );
  }

  async function apiGet() {
    const fetchPromise = fetch(binUrl(), { headers: headers(false) });
    const res = await Promise.race([fetchPromise, timeoutPromise(FETCH_TIMEOUT_MS)]);
    if (!res.ok) {
      if (res.status === 404) throw new Error('Bin não encontrado. Verifique o BIN_ID ou crie o bin no JSONBin.io.');
      throw new Error('Falha ao carregar dados');
    }
    const data = await res.json();
    if (data.record != null) return data.record;
    if (data && (typeof data.config !== 'undefined' || typeof data.records !== 'undefined')) return data;
    return { config: {}, records: [] };
  }

  async function apiPut(body) {
    const res = await fetch(binPutUrl(), {
      method: 'PUT',
      headers: headers(true),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Falha ao salvar');
    return res.json();
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

  function computeBalanceUpTo(records, endDateKey, cfg) {
    var total = cfg.initialBalanceMinutes;
    if (!cfg.startDate || compareDateKeys(endDateKey, cfg.startDate) < 0) return total;
    var cur = cfg.startDate;
    var guard = 0;
    while (compareDateKeys(cur, endDateKey) <= 0) {
      var d = parseLocalDateKey(cur);
      if (!d) break;
      var expected = expectedMinutesForLocalDate(d, cfg);
      var worked = minutesWorkedInDay(getRecordsByDate(records, cur));
      total += worked - expected;
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
    addingForDate: null
  };

  function normalizeConfigBalance() {
    if (!state.config) state.config = {};
    state.config.balance = mergeBalanceConfig(state.config);
  }

  function isLoggedIn() {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }

  function setLoggedIn(value) {
    if (value) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); });
    const el = document.getElementById('screen-' + id);
    if (el) el.classList.add('active');
  }

  function renderLogin(data) {
    const hasPassword = data.config && data.config.password;
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
        const stored = data.config.password;
        const hash = await sha256(submitted);
        const match = stored === submitted || (stored && stored === hash);
        if (match) {
          setLoggedIn(true);
          state.config = data.config || {};
          state.records = data.records || [];
          normalizeConfigBalance();
          showScreen('app');
          renderApp();
        } else {
          errEl.textContent = 'Senha incorreta.';
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
        const hash = await sha256(p1);
        const newConfig = { ...(data.config || {}), password: hash };
        const newRecords = data.records || [];
        try {
          state.config = newConfig;
          state.records = newRecords;
          normalizeConfigBalance();
          await apiPut({ config: state.config, records: state.records });
          setLoggedIn(true);
          showScreen('app');
          renderApp();
        } catch (err) {
          errEl.textContent = err.message || 'Erro ao salvar.';
        }
      };
    }
  }

  async function sha256(str) {
    const enc = new TextEncoder();
    const data = await crypto.subtle.digest('SHA-256', enc.encode(str));
    return Array.from(new Uint8Array(data)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function renderApp() {
    const container = document.getElementById('calendar-container');
    if (!container) return;
    const year = state.currentYear;
    const month = state.currentMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const start = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    let grid = '<div class="calendar-weekdays">' + weekDays.map(d => `<span>${d}</span>`).join('') + '</div><div class="calendar-grid">';
    for (let i = 0; i < start; i++) grid += '<div class="calendar-day empty"></div>';
    const balanceCfg = mergeBalanceConfig(state.config);
    const yesterdayKey = yesterdayLocalDateKey();
    let totalMonthMinutes = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStrLocal = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayRecords = getRecordsByDate(state.records, dateStrLocal);
      const minutes = minutesWorkedInDay(dayRecords);
      totalMonthMinutes += minutes;
      const isToday = dateStrLocal === dateStr(new Date());
      const dayBalanceStr = compareDateKeys(dateStrLocal, yesterdayKey) <= 0
        ? formatSignedBalanceMinutes(computeBalanceUpTo(state.records, dateStrLocal, balanceCfg))
        : '—';
      grid += `<div class="calendar-day ${isToday ? 'today' : ''}" data-date="${dateStrLocal}">
        <div class="day-number">${d}</div>
        <div class="day-total"><span class="day-total-label">Total:</span> <span class="day-hours">${minutes > 0 ? formatMinutes(minutes) : '—'}</span></div>
        <div class="day-balance"><span class="day-balance-label">Saldo:</span> <span class="day-balance-value">${dayBalanceStr}</span></div>
        <ul class="day-records">${dayRecords.map(r => {
          const type = normalizeType(r.type);
          return `
          <li data-id="${r.id || r.datetime}" class="record-${type}">
            <span class="record-type">${type === 'entrada' ? 'E' : 'S'}</span>
            <span class="record-time">${formatRecordTime(r)}</span>
            <button type="button" class="btn-edit" data-id="${r.id || r.datetime}" aria-label="Editar">✎</button>
            <button type="button" class="btn-delete" data-id="${r.id || r.datetime}" aria-label="Excluir">×</button>
          </li>`;
        }).join('')}</ul>
        <button type="button" class="btn-add-point" data-date="${dateStrLocal}">+ Ponto</button>
      </div>`;
    }
    grid += '</div>';
    const monthTotalStr = totalMonthMinutes > 0 ? formatMinutes(totalMonthMinutes) : '—';
    const balanceMinutes = computeBalanceUpTo(state.records, yesterdayKey, balanceCfg);
    const balanceStr = formatSignedBalanceMinutes(balanceMinutes);
    const nav = `
      <nav class="calendar-nav">
        <button type="button" id="btn-prev-month" aria-label="Mês anterior">‹</button>
        <span class="calendar-title">${firstDay.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
        <button type="button" id="btn-next-month" aria-label="Próximo mês">›</button>
        <div class="calendar-nav-totals">
          <span class="calendar-balance" aria-label="Saldo de horas até ontem">Saldo até ontem: ${balanceStr}</span>
          <span class="calendar-month-total" aria-label="Total de horas no mês">Total do mês: ${monthTotalStr}</span>
        </div>
      </nav>
      <button type="button" id="btn-logout" class="btn-logout">Sair</button>
    `;
    container.innerHTML = nav + grid;

    document.getElementById('btn-prev-month').onclick = () => {
      if (state.currentMonth === 0) { state.currentYear--; state.currentMonth = 11; }
      else state.currentMonth--;
      renderApp();
    };
    document.getElementById('btn-next-month').onclick = () => {
      if (state.currentMonth === 11) { state.currentYear++; state.currentMonth = 0; }
      else state.currentMonth++;
      renderApp();
    };
    document.getElementById('btn-logout').onclick = () => {
      setLoggedIn(false);
      showScreen('login');
    };

    container.querySelectorAll('.btn-edit').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        const r = state.records.find(x => (x.id || x.datetime) === id);
        if (r) openEditModal(r);
      };
    });
    container.querySelectorAll('.btn-delete').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Excluir este registro?')) deleteRecord(id);
      };
    });
    container.querySelectorAll('.btn-add-point').forEach(btn => {
      btn.onclick = () => {
        const date = btn.getAttribute('data-date');
        openAddModal(date);
      };
    });
  }

  function getRecordId(r) {
    return r.id || r.datetime;
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
    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
  }

  async function saveEdit(e) {
    e.preventDefault();
    const type = document.getElementById('edit-type').value;
    const datetime = document.getElementById('edit-datetime').value;
    if (!datetime) return;
    const iso = new Date(datetime).toISOString();
    const idx = state.records.findIndex(r => getRecordId(r) === state.editingId);
    if (idx === -1) { closeModals(); return; }
    state.records[idx] = { ...state.records[idx], type, datetime: iso };
    await persist();
    closeModals();
    renderApp();
  }

  async function saveAdd(e) {
    e.preventDefault();
    const type = document.getElementById('add-type').value;
    const datetime = document.getElementById('add-datetime').value;
    if (!datetime) return;
    const iso = new Date(datetime).toISOString();
    state.records.push({ type, datetime: iso });
    state.records = sortRecords(state.records);
    await persist();
    closeModals();
    renderApp();
  }

  async function deleteRecord(id) {
    state.records = state.records.filter(r => getRecordId(r) !== id);
    await persist();
    renderApp();
  }

  async function persist() {
    normalizeConfigBalance();
    const body = { config: state.config, records: state.records };
    await apiPut(body);
  }

  var formEdit = document.getElementById('form-edit');
  if (formEdit) formEdit.addEventListener('submit', saveEdit);
  var formAdd = document.getElementById('form-add');
  if (formAdd) formAdd.addEventListener('submit', saveAdd);
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
      showError('O carregamento demorou demais. Verifique sua conexão, o BIN_ID nos Secrets do GitHub e se o bin existe no JSONBin.io.');
    }, FAILSAFE_MS);
    if (loading) loading.classList.add('active');
    showScreen('loading');
    try {
      const data = await apiGet();
      if (done) return;
      state.config = data.config || {};
      state.records = data.records || [];
      normalizeConfigBalance();
      if (isLoggedIn()) {
        showScreen('app');
        renderApp();
      } else {
        showScreen('login');
        renderLogin(data);
      }
    } catch (err) {
      if (done) return;
      const msg = err.message || '';
      const friendly = msg.includes('Tempo esgotado') || msg.includes('Bin não encontrado')
        ? msg
        : (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
          ? 'Não foi possível conectar ao servidor. Verifique a conexão e se o bin existe no JSONBin.io.'
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
