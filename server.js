// ---------------------------------------------------------------------------
// Poker Tracker — backend (Node.js + Express)
// Хранит данные в data.json, защищает изменения общим паролем,
// отправляет результаты игры на e-mail через SMTP (nodemailer).
// ---------------------------------------------------------------------------

const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// --- Загрузка .env (без внешних зависимостей) ---------------------------------
// Читаем файл .env рядом с server.js и переносим значения в process.env.
// Если файла нет (например, на хостинге переменные заданы в панели) — просто
// пропускаем. Реальные переменные окружения имеют приоритет над .env.
(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return; // пропускаем пустые и комментарии
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
  } catch (e) {
    /* .env нет — это нормально */
  }
})();

const app = express();
const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'changeme'; // ОБЯЗАТЕЛЬНО задайте свой в .env
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------- Хранилище ------------------------------------
// Читаем весь файл целиком при каждом запросе и пишем целиком — для домашней
// нагрузки (несколько человек) этого более чем достаточно и это просто.
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    // Файла нет или он повреждён — возвращаем пустую структуру по умолчанию.
    return { settings: { defaultBuyIn: 20 }, players: [], events: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Простой генератор уникальных id.
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Деньги одного участника = бай-ин + ребаи*бай-ин + (аддон ? бай-ин : 0)
function money(event, p) {
  return event.buyIn + p.rebuys * event.buyIn + (p.addon ? event.buyIn : 0);
}

// ----------------------------- Вход ----------------------------------------
// Проверка пароля. Фронтенд после успеха хранит пароль и шлёт его в заголовке.
app.post('/api/login', (req, res) => {
  if ((req.body.password || '') === APP_PASSWORD) {
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Неверный пароль' });
});

// Всё, что ниже (/api/...), требует правильный пароль в заголовке x-app-password.
app.use('/api', (req, res, next) => {
  if ((req.headers['x-app-password'] || '') === APP_PASSWORD) return next();
  res.status(401).json({ error: 'Требуется вход' });
});

// --------------------------- Данные ----------------------------------------
app.get('/api/data', (req, res) => {
  res.json(readData());
});

// --------------------------- Игроки ----------------------------------------
app.post('/api/players', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Введите имя игрока' });
  const data = readData();
  if (data.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: 'Такой игрок уже есть' });
  }
  const player = { id: genId(), name };
  data.players.push(player);
  writeData(data);
  res.json(player);
});

app.put('/api/players/:id', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Введите имя игрока' });
  const data = readData();
  const player = data.players.find((p) => p.id === req.params.id);
  if (!player) return res.status(404).json({ error: 'Игрок не найден' });
  player.name = name;
  writeData(data);
  res.json(player);
});

app.delete('/api/players/:id', (req, res) => {
  const data = readData();
  // Не даём удалить игрока, который уже участвовал в играх (чтобы не ломать историю).
  const used = data.events.some((ev) =>
    ev.participants.some((p) => p.playerId === req.params.id)
  );
  if (used) {
    return res.status(400).json({ error: 'Нельзя удалить: игрок уже участвовал в играх' });
  }
  data.players = data.players.filter((p) => p.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
});

// ---------------------------- События --------------------------------------
// Создать новую игру. Разрешаем только одну незавершённую игру одновременно.
app.post('/api/events', (req, res) => {
  const data = readData();
  if (data.events.some((ev) => ev.status === 'open')) {
    return res.status(400).json({ error: 'Уже есть незавершённая игра — сначала завершите её' });
  }
  const buyIn = Number(req.body.buyIn) > 0 ? Number(req.body.buyIn) : data.settings.defaultBuyIn;
  const date = req.body.date || new Date().toISOString().slice(0, 10);
  const event = { id: genId(), date, buyIn, status: 'open', participants: [] };
  data.events.push(event);
  writeData(data);
  res.json(event);
});

// Изменить текущую игру. Завершённую игру изменить нельзя (защита истории).
app.put('/api/events/:id', (req, res) => {
  const data = readData();
  const ev = data.events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Игра не найдена' });
  if (ev.status === 'finished') {
    return res.status(403).json({ error: 'Завершённую игру изменить нельзя' });
  }
  if (req.body.date) ev.date = req.body.date;
  if (Number(req.body.buyIn) > 0) ev.buyIn = Number(req.body.buyIn);
  if (Array.isArray(req.body.participants)) {
    ev.participants = req.body.participants.map((p) => ({
      playerId: p.playerId,
      place: p.place !== null && p.place !== undefined && p.place !== '' ? Number(p.place) : null,
      rebuys: Number(p.rebuys) > 0 ? Number(p.rebuys) : 0,
      addon: !!p.addon,
    }));
  }
  writeData(data);
  res.json(ev);
});

// Завершить игру — после этого она становится только для чтения.
app.post('/api/events/:id/finish', (req, res) => {
  const data = readData();
  const ev = data.events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Игра не найдена' });
  ev.status = 'finished';
  writeData(data);
  res.json(ev);
});

// Удалить можно только незавершённую игру.
app.delete('/api/events/:id', (req, res) => {
  const data = readData();
  const ev = data.events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Игра не найдена' });
  if (ev.status === 'finished') {
    return res.status(403).json({ error: 'Завершённую игру удалить нельзя' });
  }
  data.events = data.events.filter((e) => e.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
});

// ------------------------ Отправка на e-mail -------------------------------
function buildSummary(event, players) {
  const nameOf = (id) => (players.find((p) => p.id === id) || {}).name || '—';
  const sorted = [...event.participants].sort((a, b) => (a.place || 99) - (b.place || 99));
  let pot = 0;
  const lines = sorted.map((p) => {
    const m = money(event, p);
    pot += m;
    const place = p.place ? `${p.place} место` : 'без места';
    return `${place} — ${nameOf(p.playerId)}: ребаи ${p.rebuys}, аддон ${p.addon ? 'да' : 'нет'} = ${m} €`;
  });
  return (
    `Результаты игры от ${event.date}\n` +
    `Бай-ин: ${event.buyIn} €\n\n` +
    `${lines.join('\n')}\n\n` +
    `Банк вечера: ${pot} €`
  );
}

app.post('/api/events/:id/email', async (req, res) => {
  const to = (req.body.to || '').trim();
  if (!to) return res.status(400).json({ error: 'Введите e-mail получателя' });
  if (!process.env.SMTP_HOST) {
    return res.status(400).json({ error: 'Отправка почты не настроена на сервере' });
  }
  const data = readData();
  const ev = data.events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Игра не найдена' });

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: Number(process.env.SMTP_PORT) !== 587, // 465 = SSL; 587 = STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `Результаты покера ${ev.date}`,
      text: buildSummary(ev, data.players),
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Не удалось отправить письмо: ' + e.message });
  }
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Tiltometer запущен: http://localhost:${PORT}`);
});
