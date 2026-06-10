// ---------------------------------------------------------------------------
// Poker Tracker — frontend (ванильный JS, без фреймворков)
// ---------------------------------------------------------------------------

// Пароль храним на время сессии браузера (исчезает после закрытия вкладки).
let password = sessionStorage.getItem('pokerPassword') || '';
let data = { settings: { defaultBuyIn: 20 }, players: [], events: [] };
let activeTab = 'stats';

// ----------------------------- Помощники -----------------------------------
const $ = (sel) => document.querySelector(sel);

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = 'toast' + (isError ? ' error' : '');
  setTimeout(() => toast.classList.add('hidden'), 2600);
}

// Обёртка над fetch: добавляет пароль и разбирает ошибки.
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-app-password': password },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Ошибка запроса');
  return json;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function moneyOf(event, p) {
  return event.buyIn + p.rebuys * event.buyIn + (p.addon ? event.buyIn : 0);
}

// Выигрыш по месту: банк делится 50/30/20 на топ-3.
// 1-е место получает остаток, чтобы сумма призов точно равнялась банку.
function payoutOf(pot, place) {
  if (place === 2) return Math.round(pot * 0.3);
  if (place === 3) return Math.round(pot * 0.2);
  if (place === 1) return pot - Math.round(pot * 0.3) - Math.round(pot * 0.2);
  return 0;
}

function nameOf(id) {
  const p = data.players.find((x) => x.id === id);
  return p ? p.name : '—';
}

// ------------------------------- Вход --------------------------------------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#login-password').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!res.ok) throw new Error('Неверный пароль');
    password = pw;
    sessionStorage.setItem('pokerPassword', password);
    $('#login-error').textContent = '';
    await enterApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', () => {
  password = '';
  sessionStorage.removeItem('pokerPassword');
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  $('#login-password').value = '';
});

async function enterApp() {
  await loadData();
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  render();
}

async function loadData() {
  data = await api('GET', '/api/data');
}

// ------------------------------ Вкладки ------------------------------------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    render();
  });
});

function render() {
  ['stats', 'game', 'history', 'players'].forEach((t) => {
    $('#tab-' + t).classList.toggle('hidden', t !== activeTab);
  });
  if (activeTab === 'stats') renderStats();
  if (activeTab === 'game') renderGame();
  if (activeTab === 'history') renderHistory();
  if (activeTab === 'players') renderPlayers();
}

// ---------------------- Накопительная статистика ---------------------------
// Считается только по ЗАВЕРШЁННЫМ играм.
function computeStats() {
  const stats = {};
  data.players.forEach((p) => {
    stats[p.id] = {
      id: p.id, name: p.name, games: 0,
      first: 0, second: 0, third: 0,
      rebuys: 0, addons: 0, contributed: 0, won: 0,
    };
  });
  data.events
    .filter((ev) => ev.status === 'finished')
    .forEach((ev) => {
      let pot = 0;
      ev.participants.forEach((p) => (pot += moneyOf(ev, p)));
      ev.participants.forEach((p) => {
        const s = stats[p.playerId];
        if (!s) return; // игрок мог быть удалён — пропускаем
        s.games += 1;
        if (p.place === 1) s.first += 1;
        if (p.place === 2) s.second += 1;
        if (p.place === 3) s.third += 1;
        s.rebuys += p.rebuys;
        if (p.addon) s.addons += 1;
        s.contributed += moneyOf(ev, p);
        s.won += payoutOf(pot, p.place);
      });
    });
  return Object.values(stats).sort(
    (a, b) => b.first - a.first || b.games - a.games || b.contributed - a.contributed
  );
}

function renderStats() {
  const rows = computeStats();
  const played = rows.filter((r) => r.games > 0);
  const el = $('#tab-stats');

  if (played.length === 0) {
    el.innerHTML = `<h2 class="section-title">Статистика</h2>
      <div class="card"><div class="empty">Пока нет завершённых игр.<br>Сыграйте вечер и завершите его — статистика появится здесь.</div></div>`;
    return;
  }

  el.innerHTML = `
    <h2 class="section-title">Таблица лидеров</h2>
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th class="rank">#</th>
            <th>Игрок</th>
            <th class="num">Игр</th>
            <th class="num">🥇</th>
            <th class="num">🥈</th>
            <th class="num">🥉</th>
            <th class="num">Ребаи</th>
            <th class="num">Аддоны</th>
            <th class="num">Внёс, €</th>
            <th class="num">Вынес, €</th>
          </tr>
        </thead>
        <tbody>
          ${played.map((r, i) => `
            <tr>
              <td class="rank">${i + 1}</td>
              <td>${esc(r.name)}</td>
              <td class="num">${r.games}</td>
              <td class="num">${r.first}</td>
              <td class="num">${r.second}</td>
              <td class="num">${r.third}</td>
              <td class="num">${r.rebuys}</td>
              <td class="num">${r.addons}</td>
              <td class="num">${r.contributed}</td>
              <td class="num">${r.won}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// --------------------------- Текущая игра ----------------------------------
function renderGame() {
  const el = $('#tab-game');
  const open = data.events.find((ev) => ev.status === 'open');

  if (data.players.length === 0) {
    el.innerHTML = `<h2 class="section-title">Текущая игра</h2>
      <div class="card"><div class="empty">Сначала добавьте игроков во вкладке «Игроки».</div></div>`;
    return;
  }

  if (!open) {
    el.innerHTML = `
      <h2 class="section-title">Текущая игра</h2>
      <div class="card">
        <h2>Начать новую игру</h2>
        <div class="row">
          <div style="flex:2 1 160px;">
            <label class="muted">Дата</label>
            <input type="date" id="new-date" value="${todayISO()}" />
          </div>
          <div style="flex:1 1 100px;">
            <label class="muted">Бай-ин, €</label>
            <input type="number" id="new-buyin" min="1" value="${data.settings.defaultBuyIn}" />
          </div>
        </div>
        <div style="margin-top:14px;">
          <button class="btn btn-primary" id="create-game-btn">Начать игру</button>
        </div>
      </div>`;
    $('#create-game-btn').addEventListener('click', createGame);
    return;
  }

  // Есть открытая игра — рисуем редактор участников.
  // Карта существующих данных участников для удобного доступа.
  const byId = {};
  open.participants.forEach((p) => (byId[p.playerId] = p));

  // Деньги одного участника: бай-ин + ребаи + аддон.
  const buyIn0 = Number(open.buyIn) || 0;
  const moneyOf = (cur) => {
    if (!cur) return 0;
    const rebuys = Number(cur.rebuys) || 0;
    return buyIn0 + rebuys * buyIn0 + (cur.addon ? buyIn0 : 0);
  };
  let pot0 = 0;

  el.innerHTML = `
    <h2 class="section-title">Текущая игра <span class="badge badge-open">идёт</span></h2>
    <div class="card">
      <div class="row">
        <div style="flex:2 1 160px;">
          <label class="muted">Дата</label>
          <input type="date" id="game-date" value="${open.date}" />
        </div>
        <div style="flex:1 1 100px;">
          <label class="muted">Бай-ин, €</label>
          <input type="number" id="game-buyin" min="1" value="${open.buyIn}" />
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Участники</h2>
      <p class="muted" style="margin-top:-6px;">Отметьте присутствующих и проставьте места, ребаи и аддоны.</p>
      <div id="players-list">
        ${data.players.map((pl) => {
          const cur = byId[pl.id];
          const present = !!cur;
          const money = moneyOf(cur);
          pot0 += money;
          return `
          <div class="player-row ${present ? '' : 'absent'}" data-pid="${pl.id}">
            <div class="player-name">${esc(pl.name)}</div>
            <label class="check" style="justify-self:end;">
              <input type="checkbox" class="present" ${present ? 'checked' : ''}/> присутствует
            </label>
            <div class="player-controls">
              <label>Место<input type="number" class="place" min="1" value="${cur && cur.place ? cur.place : ''}" /></label>
              <label>Ребаи<input type="number" class="rebuys" min="0" value="${cur ? cur.rebuys : 0}" /></label>
              <label class="check">Аддон<input type="checkbox" class="addon" ${cur && cur.addon ? 'checked' : ''}/></label>
              <span class="spacer"></span>
              <span class="player-money">${money} €</span>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="pot-line"><span>Банк вечера</span><span id="pot-total">${pot0} €</span></div>
    </div>

    <div class="card">
      <div class="row">
        <button class="btn btn-primary" id="save-game-btn">Сохранить</button>
        <button class="btn btn-success" id="finish-game-btn">Завершить игру</button>
        <span class="spacer"></span>
        <button class="btn btn-danger btn-sm" id="delete-game-btn">Удалить игру</button>
      </div>
    </div>

    <div class="card">
      <h2>Отправить результат на e-mail</h2>
      <div class="row">
        <input type="email" id="email-to" placeholder="кому@почта.com" style="flex:3 1 200px;" />
        <button class="btn" id="send-email-btn" style="flex:1 1 120px;">Отправить результат</button>
      </div>
      <p class="muted" style="margin-bottom:0;">Совет: удобнее отправлять уже завершённую игру.</p>
    </div>`;

  // Пересчёт денег при любом изменении.
  const recalc = () => {
    const buyInEl = $('#game-buyin');
    const buyIn = Number(buyInEl && buyInEl.value) || 0;
    let pot = 0;
    document.querySelectorAll('.player-row').forEach((row) => {
      const presentEl = row.querySelector('.present');
      const present = presentEl ? presentEl.checked : false;
      row.classList.toggle('absent', !present);
      const rebuysEl = row.querySelector('.rebuys');
      const rebuys = Number(rebuysEl && rebuysEl.value) || 0;
      const addonEl = row.querySelector('.addon');
      const addon = addonEl ? addonEl.checked : false;
      const m = present ? buyIn + rebuys * buyIn + (addon ? buyIn : 0) : 0;
      const moneyEl = row.querySelector('.player-money');
      if (moneyEl) moneyEl.textContent = m + ' €';
      pot += m;
    });
    const potEl = $('#pot-total');
    if (potEl) potEl.textContent = pot + ' €';
  };
  el.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', recalc));
  recalc();

  $('#save-game-btn').addEventListener('click', () => saveGame(open.id, false));
  $('#finish-game-btn').addEventListener('click', () => saveGame(open.id, true));
  $('#delete-game-btn').addEventListener('click', () => deleteGame(open.id));
  $('#send-email-btn').addEventListener('click', () => sendEmail(open.id));
}

function collectParticipants() {
  const participants = [];
  document.querySelectorAll('.player-row').forEach((row) => {
    if (!row.querySelector('.present').checked) return;
    const placeVal = row.querySelector('.place').value;
    participants.push({
      playerId: row.dataset.pid,
      place: placeVal === '' ? null : Number(placeVal),
      rebuys: Number(row.querySelector('.rebuys').value) || 0,
      addon: row.querySelector('.addon').checked,
    });
  });
  return participants;
}

async function createGame() {
  try {
    await api('POST', '/api/events', {
      date: $('#new-date').value || todayISO(),
      buyIn: Number($('#new-buyin').value) || data.settings.defaultBuyIn,
    });
    await loadData();
    render();
    showToast('Игра начата');
  } catch (e) { showToast(e.message, true); }
}

async function saveGame(id, finish) {
  try {
    await api('PUT', '/api/events/' + id, {
      date: $('#game-date').value,
      buyIn: Number($('#game-buyin').value),
      participants: collectParticipants(),
    });
    if (finish) {
      await api('POST', '/api/events/' + id + '/finish');
    }
    await loadData();
    if (finish) activeTab = 'stats';
    render();
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
    showToast(finish ? 'Игра завершена' : 'Сохранено');
  } catch (e) { showToast(e.message, true); }
}

async function deleteGame(id) {
  if (!confirm('Удалить текущую игру? Данные не сохранятся.')) return;
  try {
    await api('DELETE', '/api/events/' + id);
    await loadData();
    render();
    showToast('Игра удалена');
  } catch (e) { showToast(e.message, true); }
}

async function sendEmail(id) {
  const to = $('#email-to').value.trim();
  if (!to) return showToast('Введите e-mail получателя', true);
  try {
    // Сначала сохраняем текущие данные, чтобы письмо было актуальным
    // (только если игра ещё открыта).
    const ev = data.events.find((e) => e.id === id);
    if (ev && ev.status === 'open') {
      await api('PUT', '/api/events/' + id, {
        date: $('#game-date').value,
        buyIn: Number($('#game-buyin').value),
        participants: collectParticipants(),
      });
      await loadData();
    }
    await api('POST', '/api/events/' + id + '/email', { to });
    showToast('Письмо отправлено на ' + to);
  } catch (e) { showToast(e.message, true); }
}

// ------------------------------ История ------------------------------------
function renderHistory() {
  const el = $('#tab-history');
  const events = [...data.events].sort((a, b) => (a.date < b.date ? 1 : -1));

  if (events.length === 0) {
    el.innerHTML = `<h2 class="section-title">История</h2>
      <div class="card"><div class="empty">Пока нет ни одной игры.</div></div>`;
    return;
  }

  el.innerHTML = `<h2 class="section-title">История игр</h2>` + events.map((ev) => {
    const sorted = [...ev.participants].sort((a, b) => (a.place || 99) - (b.place || 99));
    let pot = 0;
    sorted.forEach((p) => (pot += moneyOf(ev, p)));
    const badge = ev.status === 'open'
      ? '<span class="badge badge-open">идёт</span>'
      : '<span class="badge badge-finished">завершена</span>';
    return `
      <div class="card">
        <div class="row" style="align-items:baseline;">
          <h2 style="margin:0;">${ev.date} ${badge}</h2>
          <span class="spacer"></span>
          <span class="muted">Бай-ин ${ev.buyIn} € · Банк ${pot} €</span>
        </div>
        <div class="table-wrap" style="margin-top:10px;">
          <table>
            <thead><tr><th>Место</th><th>Игрок</th><th class="num">Ребаи</th><th class="num">Аддон</th><th class="num">Внёс, €</th><th class="num">Вынес, €</th></tr></thead>
            <tbody>
              ${sorted.map((p) => `
                <tr>
                  <td>${p.place ? p.place : '—'}</td>
                  <td>${esc(nameOf(p.playerId))}</td>
                  <td class="num">${p.rebuys}</td>
                  <td class="num">${p.addon ? 'да' : '—'}</td>
                  <td class="num">${moneyOf(ev, p)}</td>
                  <td class="num">${payoutOf(pot, p.place)}</td>
                </tr>`).join('') || '<tr><td colspan="6" class="muted">Нет участников</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

// ------------------------------ Игроки -------------------------------------
function renderPlayers() {
  const el = $('#tab-players');
  el.innerHTML = `
    <h2 class="section-title">Игроки</h2>
    <div class="card">
      <div class="row">
        <input type="text" id="new-player" placeholder="Имя нового игрока" style="flex:3 1 200px;" />
        <button class="btn btn-primary" id="add-player-btn" style="flex:1 1 120px;">Добавить</button>
      </div>
    </div>
    <div class="card">
      ${data.players.length === 0
        ? '<div class="empty">Список пуст. Добавьте первого игрока выше.</div>'
        : data.players.map((p) => `
          <div class="player-row" data-pid="${p.id}" style="grid-template-columns:1fr auto;">
            <input type="text" class="edit-name" value="${esc(p.name)}" />
            <div class="row" style="flex:0 0 auto;gap:6px;">
              <button class="btn btn-sm rename-btn">Сохранить</button>
              <button class="btn btn-sm btn-danger del-btn">Удалить</button>
            </div>
          </div>`).join('')}
    </div>`;

  $('#add-player-btn').addEventListener('click', addPlayer);
  $('#new-player').addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer(); });
  el.querySelectorAll('.rename-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.player-row');
      renamePlayer(row.dataset.pid, row.querySelector('.edit-name').value);
    });
  });
  el.querySelectorAll('.del-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.player-row');
      deletePlayer(row.dataset.pid);
    });
  });
}

async function addPlayer() {
  const name = $('#new-player').value.trim();
  if (!name) return;
  try {
    await api('POST', '/api/players', { name });
    await loadData();
    render();
    showToast('Игрок добавлен');
  } catch (e) { showToast(e.message, true); }
}

async function renamePlayer(id, name) {
  try {
    await api('PUT', '/api/players/' + id, { name });
    await loadData();
    render();
    showToast('Имя обновлено');
  } catch (e) { showToast(e.message, true); }
}

async function deletePlayer(id) {
  if (!confirm('Удалить игрока?')) return;
  try {
    await api('DELETE', '/api/players/' + id);
    await loadData();
    render();
    showToast('Игрок удалён');
  } catch (e) { showToast(e.message, true); }
}

// --------------------------- Автовход --------------------------------------
// Если пароль уже сохранён в сессии — пробуем войти автоматически.
(async function init() {
  if (!password) return;
  try {
    await enterApp();
  } catch (e) {
    // пароль устарел/неверный — покажем экран входа
    password = '';
    sessionStorage.removeItem('pokerPassword');
  }
})();
