/**
 * WL Emergency — backend (Stage 3: "official site" foundations)
 * Zero external dependencies — runs with plain `node server.js`.
 *
 * NEW in this stage:
 *  - Accounts now include email.
 *  - Profile picture upload (stored as data-URL in the DB — fine for this
 *    stage; move to real object storage later if avatars get large/numerous).
 *  - Rules, branches (Discord servers), and site settings are now stored
 *    in the database and shared with everyone (not per-browser anymore).
 *  - The activation test is graded on the SERVER (correct answers never
 *    reach the browser), supports a 1-hour retry cooldown after a fail,
 *    and can be locked/unlocked by the admin.
 *  - Every account event (register, login, logout, link, unlink, role
 *    change, test result) is sent live to a Discord channel via Webhook,
 *    if the admin has configured one (see /api/admin/settings).
 *
 * STILL DEFERRED (Batch 2 — needs live external APIs):
 *  - Real live-stream detection for YouTube / Twitch / Kick / TikTok.
 *  - Real Roblox online-player count + "play now" deep link.
 *  - An actual always-on Discord Bot that grants roles (a Webhook can
 *    post messages, but only a running Bot process can grant a role —
 *    that's next).
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(DATA_DIR, 'data.json');
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || ''; // e.g. libsql://your-db-org.turso.io
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || '';
const USE_TURSO = !!(TURSO_DATABASE_URL && TURSO_AUTH_TOKEN);
const PUBLIC_DIR = path.join(__dirname, 'public');

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';
const ROBLOX_CLIENT_ID = process.env.ROBLOX_CLIENT_ID || '';
const ROBLOX_CLIENT_SECRET = process.env.ROBLOX_CLIENT_SECRET || '';
const ROBLOX_REDIRECT_URI = process.env.ROBLOX_REDIRECT_URI || '';
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const KICK_CLIENT_ID = process.env.KICK_CLIENT_ID || '';
const KICK_CLIENT_SECRET = process.env.KICK_CLIENT_SECRET || '';

/* ---------------- default settings (persisted after first boot) ---------------- */
const DEFAULT_SETTINGS = {
  numQuestions: 10,
  passPercent: 80,
  testDurationMinutes: 15,
  testOpen: true,
  discordRoleName: 'عضو مفعل',
  logChannelName: '#activation-logs',
  primaryDiscordInvite: '',
  discordWebhookLog: '',
  discordWebhookTest: '',
  robloxPlaceId: ''
};

/* ---------------- default question bank (seed only — admin manages the real one in DB.questionBank) ---------------- */
const DEFAULT_QUESTION_BANK = (() => {
  const bank = [
    ["ما هو أول إجراء يجب اتخاذه عند وصولك لموقع حادث سير؟","تأمين الموقع وتنبيه المرور","مغادرة الموقع فورًا","الاتصال بالإعلام","تجاهل الموقف"],
    ["ما معنى الكود 10-4 في الاتصالات؟","تم الاستلام / مفهوم","طلب دعم فوري","إنهاء المهمة","خطر داهم"],
    ["متى يجوز استخدام الأضواء والصفارة معًا؟","في حالات الطوارئ الفعلية فقط","في كل الأوقات","عند الرغبة الشخصية","عند التنقل بين المراكز"],
    ["ما هو دور فريق الإسعاف الأساسي في المشهد؟","تقييم الحالة وتقديم الإسعافات الأولية","تنظيم حركة المرور","توثيق الأدلة الجنائية","اعتقال المتورطين"],
    ["كيف يتم التعامل مع مستخدم يخالف قوانين الدور بشكل متكرر؟","توثيق المخالفة ورفعها للإدارة","تجاهلها","الرد بالمثل","طرده من السيرفر شخصيًا"],
    ["ما هو الغرض من اختبار التفعيل الإلكتروني؟","التأكد من فهم العضو لقوانين وآلية اللعب","تعقيد التسجيل","تقليل عدد اللاعبين","لا يوجد غرض محدد"],
    ["أين تتم عملية منح رتبة التفعيل النهائية؟","عبر Discord Bot بعد اجتياز الاختبار","من داخل الموقع مباشرة","لا تُمنح إطلاقًا","عشوائيًا"],
    ["ما الإجراء الصحيح عند وجود شكوى على عضو؟","التواصل مع الإدارة عبر Discord","نشرها في الدردشة العامة","تجاهلها","الرد شخصيًا بعقوبة"],
    ["ما هي أهم صفة يجب توفرها في أعضاء قطاع الطوارئ؟","الالتزام والجدية أثناء الأدوار","السرعة في القيادة فقط","كثرة الظهور فقط","لا شيء محدد"],
    ["ما الهدف من ربط حساب Roblox و Discord بحساب WL؟","توحيد هوية العضو وتسهيل التحقق من سجله","تعقيد الدخول للموقع","لا يوجد هدف","جمع بيانات دون فائدة"],
    ["ما الذي يحدث عند اجتياز اختبار التفعيل بنجاح؟","إرسال حدث لمنح رتبة Discord تلقائيًا لاحقًا","تفعيل الحساب فورًا من الموقع","لا شيء","حظر الحساب"],
    ["كيف يتم التعرف على الحساب بدقة بدلًا من الاسم الظاهر؟","الاعتماد على المعرفات الفريدة (IDs)","الاعتماد على اسم المستخدم الظاهر فقط","تخمين الشخص من الصورة","لا يمكن التعرف عليه"],
    ["ما هو أفضل وصف لدور 'قطاعات' الطوارئ؟","فرق متخصصة كالإسعاف والإطفاء والشرطة","مجموعة عشوائية من الأعضاء","صناع محتوى فقط","إداريون فقط"],
    ["ماذا يحدث إذا رسب العضو في اختبار التفعيل؟","ينتظر ساعة ويمكنه إعادة المحاولة","يُحظر تلقائيًا","يفقد حسابه نهائيًا","لا يحدث شيء"],
    ["أين تُسجَّل نتيجة اختبار التفعيل (نجاح أو رسوب)؟","تُرسل كسجل Embed إلى قناة السجلات في Discord","لا تُسجَّل في أي مكان","تُنشر للعامة في المجتمع","تُحذف فورًا"],
    ["من الجهة المسؤولة عن فتح وإغلاق التفعيل وترتيب الأدوار؟","Discord Bot خارج نطاق الموقع","الموقع مباشرة","لا جهة مسؤولة","صناع المحتوى"],
    ["ما هو دور قسم 'السجلات' في لوحة الإدارة؟","البحث عن أي عضو بمعرفاته ومعرفة بياناته الكاملة","نشر الأخبار","إدارة البثوث فقط","لا دور له"],
    ["لماذا لا يُسمح للمستخدم العادي بدخول قسم السجلات؟","لأنه يحتوي على بيانات حساسة تخص الأعضاء الآخرين","لأنه غير موجود أصلًا","لأنه مخصص لصناع المحتوى","لا سبب"],
    ["ما هو أفضل وصف لهذا الموقع؟","موقع رسمي لتسجيل الأعضاء وربط حساباتهم واختبارهم إلكترونيًا","نسخة تجريبية لن تُستخدم فعليًا","لعبة مستقلة عن المشروع","تطبيق جوال منفصل"],
    ["ما هو الدور الأساسي لصناع المحتوى في المجتمع؟","نشر وتوثيق تجربة اللعب بشكل إيجابي","إصدار القرارات الإدارية","تحديد قوانين السيرفر","منح رتب التفعيل"]
  ];
  return bank.map((row, i) => {
    const shift = i % (row.length - 1);
    let opts = row.slice(1);
    for (let s = 0; s < shift; s++) opts.push(opts.shift());
    const correct = (0 - shift + opts.length) % opts.length;
    return { id: 'seed-' + (i + 1), q: row[0], options: opts, correct };
  });
})();

/* ---------------- tiny JSON "database" ---------------- */
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function defaultDB() {
  return {
    users: [], activity: {}, seq: 1000,
    rules: [
      { id: 'gen', icon: '👤', title: 'القوانين العامة', rules: ['احترام جميع الأعضاء والطاقم الإداري.', 'يمنع استخدام أي وسيلة غش أو استغلال أخطاء برمجية.', 'الالتزام بالهوية داخل الأدوار (Roleplay) طوال فترة اللعب.'] },
      { id: 'police', icon: '🚔', title: 'قوانين الشرطة', rules: ['الالتزام بالزي الرسمي أثناء الخدمة.', 'استخدام القوة يكون تدريجيًا وحسب الموقف.'] },
      { id: 'ems', icon: '🚑', title: 'قوانين الإسعاف', rules: ['إعطاء الأولوية للحالات الحرجة أولًا.'] },
      { id: 'taxi', icon: '🚕', title: 'قوانين التاكسي', rules: ['الالتزام بقوانين المرور أثناء نقل الركاب.'] }
    ],
    branches: [], streamers: [], officials: [],
    questionBank: DEFAULT_QUESTION_BANK,
    settings: { ...DEFAULT_SETTINGS }
  };
}
function normalizeDB(db) {
  db.rules = db.rules || [];
  db.branches = db.branches || [];
  db.streamers = db.streamers || [];
  db.officials = db.officials || [];
  db.questionBank = (db.questionBank && db.questionBank.length) ? db.questionBank : DEFAULT_QUESTION_BANK;
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
  return db;
}

/* ---- Turso (optional free-forever remote DB — see README) ---- */
async function tursoPipeline(requests) {
  const base = TURSO_DATABASE_URL.replace(/^libsql:\/\//, 'https://');
  const url = base.replace(/\/$/, '') + '/v2/pipeline';
  const body = JSON.stringify({ requests });
  const r = await httpsRequest(url, { method: 'POST', headers: { Authorization: `Bearer ${TURSO_AUTH_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body });
  if (!r.data || !Array.isArray(r.data.results)) throw new Error('Turso: unexpected response shape');
  const execResult = r.data.results.find(x => x.type === 'ok' && x.response && x.response.type === 'execute');
  const errResult = r.data.results.find(x => x.type === 'error');
  if (errResult) throw new Error('Turso error: ' + JSON.stringify(errResult.error));
  return execResult ? execResult.response.result : null;
}
async function tursoLoadDB() {
  await tursoPipeline([{ type: 'execute', stmt: { sql: "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)" } }, { type: 'close' }]);
  const result = await tursoPipeline([{ type: 'execute', stmt: { sql: "SELECT value FROM kv WHERE key = 'db'" } }, { type: 'close' }]);
  if (!result || !result.rows || result.rows.length === 0) {
    // genuinely first boot — safe to start fresh
    return normalizeDB(defaultDB());
  }
  const cell = result.rows[0][0];
  const raw = (cell && typeof cell === 'object') ? cell.value : cell;
  try {
    return normalizeDB(JSON.parse(raw));
  } catch (e) {
    // a row exists but we couldn't parse it — refuse to proceed with an
    // empty DB, since that would silently overwrite real data on next save.
    throw new Error('Turso: found a "db" row but could not parse it — refusing to start to protect existing data. Raw preview: ' + String(raw).slice(0, 200));
  }
}
async function tursoSaveDB(db) {
  const json = JSON.stringify(db);
  await tursoPipeline([
    { type: 'execute', stmt: { sql: "INSERT INTO kv (key, value) VALUES ('db', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [{ type: 'text', value: json }] } },
    { type: 'close' }
  ]);
}

async function loadDB() {
  if (USE_TURSO) return tursoLoadDB();
  if (!fs.existsSync(DB_FILE)) return normalizeDB(defaultDB());
  return normalizeDB(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
}
async function saveDB(db) {
  if (USE_TURSO) return tursoSaveDB(db);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
let DB; // populated before the server starts listening (see bottom of file)
const PENDING_TESTS = new Map(); // attemptId -> {wlId, questions(with correct), createdAt}

function nowStr() { return new Date().toISOString().slice(0, 16).replace('T', ' '); }
function addActivity(wlId, text, type) {
  if (!DB.activity[wlId]) DB.activity[wlId] = [];
  DB.activity[wlId].unshift({ time: nowStr(), text, type: type || 'other' });
}
function publicUser(u) {
  if (!u) return null;
  const { passwordHash, salt, ...safe } = u;
  return safe;
}

/* ---------------- password hashing ---------------- */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
}

/* ---------------- sessions ---------------- */
const SESSIONS = new Map();
const OAUTH_STATES = new Map();
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}
function currentUserFromReq(req) {
  const sid = getCookie(req, 'sid');
  if (!sid || !SESSIONS.has(sid)) return null;
  return DB.users.find(u => u.wlId === SESSIONS.get(sid)) || null;
}

/* ---------------- helpers ---------------- */
function sendJSON(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function sendHTML(res, status, html) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
function readBody(req, limit = 2e6) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > limit) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
  });
}
function nextWlId() { DB.seq += 1; return 'WL-' + DB.seq; }
function shuffleArray(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function requireRole(user, roles) { return user && roles.includes(user.role); }
function searchUsers(q) {
  q = (q || '').trim().toLowerCase();
  if (!q) return [];
  return DB.users.filter(u =>
    u.wlId.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) ||
    (u.discordUsername || '').toLowerCase().includes(q) || (u.discordId || '').toLowerCase().includes(q) ||
    (u.robloxUsername || '').toLowerCase().includes(q) || (u.robloxDisplayName || '').toLowerCase().includes(q) ||
    (u.robloxId || '').toLowerCase().includes(q)
  );
}
function httpsRequest(urlStr, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { let parsed; try { parsed = JSON.parse(data); } catch (e) { parsed = { raw: data }; } resolve({ status: r.statusCode, data: parsed }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
function setupNeededPage(provider, varsNeeded) {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>الإعداد مطلوب</title>
  <style>body{font-family:sans-serif;background:#14101d;color:#ece7f7;padding:60px 20px;text-align:center;}
  code{background:#221a33;padding:3px 8px;border-radius:6px;}a{color:#b794f6;}</style></head>
  <body><h2>⚠️ ربط ${provider} غير مُفعّل بعد</h2><p>لازم تضيف متغيرات البيئة التالية على السيرفر أولًا:</p>
  <p>${varsNeeded.map(v => `<code>${v}</code>`).join('<br>')}</p>
  <p>راجع README.md.</p><p><a href="/">⟵ رجوع للموقع</a></p></body></html>`;
}

/* ---------------- Discord Webhook (sends real embeds to a channel) ---------------- */
function sendWebhook(url, payload) {
  if (!url) return;
  try {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const body = JSON.stringify(payload);
    const req = mod.request({ hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, () => {});
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch (e) { /* ignore malformed webhook URL */ }
}
const ACTIVITY_LABELS = {
  account_created: '✨ إنشاء حساب', login: '🟢 تسجيل دخول', logout: '🔴 تسجيل خروج',
  link_discord: '🔗 ربط Discord', unlink_discord: '✂️ إلغاء ربط Discord',
  link_roblox: '🔗 ربط Roblox', unlink_roblox: '✂️ إلغاء ربط Roblox', role_change: '🛡️ تغيير صلاحية'
};
function logAndNotify(wlId, username, text, type) {
  addActivity(wlId, text, type);
  const label = ACTIVITY_LABELS[type];
  if (label && DB.settings.discordWebhookLog) {
    sendWebhook(DB.settings.discordWebhookLog, {
      embeds: [{ title: label, description: `**${username}** (${wlId})\n${text}`, color: 0x8b5cf6, timestamp: new Date().toISOString() }]
    });
  }
}
function sendTestResultWebhook(user, attempt) {
  const url = DB.settings.discordWebhookTest || DB.settings.discordWebhookLog;
  if (!url) return;
  sendWebhook(url, {
    embeds: [{
      title: 'اختبار التفعيل الإلكتروني',
      color: attempt.passed ? 0x22c55e : 0xef4444,
      fields: [
        { name: '👤 المستخدم', value: user.username, inline: true },
        { name: '🎮 Roblox', value: `${user.robloxUsername || '—'} (${user.robloxId || '—'})`, inline: true },
        { name: '💬 Discord', value: `${user.discordUsername || '—'} (${user.discordId || '—'})`, inline: true },
        { name: '📊 النتيجة', value: `${attempt.score} / ${attempt.total}`, inline: true },
        { name: '📈 النسبة', value: `${attempt.percent}%`, inline: true },
        { name: attempt.passed ? '✅ الحالة' : '🔴 الحالة', value: attempt.passed ? 'ناجح' : 'راسب', inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/* ---------------- static file serving ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serveStatic(req, res) {
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';
  const full = path.join(PUBLIC_DIR, filePath);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(content);
  });
}

/* ================= OAuth: Discord / Roblox (unchanged flow) ================= */
async function discordStart(req, res) {
  const user = currentUserFromReq(req);
  if (!user) return sendHTML(res, 401, setupNeededPage('Discord', ['يجب تسجيل الدخول لموقع WL أولًا قبل الربط']));
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) return sendHTML(res, 200, setupNeededPage('Discord', ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI']));
  const state = newToken();
  OAUTH_STATES.set(state, { wlId: user.wlId, provider: 'discord', expires: Date.now() + 10 * 60 * 1000 });
  res.writeHead(302, { Location: `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(DISCORD_CLIENT_ID)}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify&state=${state}` });
  res.end();
}
async function discordCallback(req, res, query) {
  const { code, state } = query;
  const saved = OAUTH_STATES.get(state);
  if (!saved || saved.provider !== 'discord' || saved.expires < Date.now()) return sendHTML(res, 400, '<p>جلسة الربط منتهية.</p>');
  OAUTH_STATES.delete(state);
  try {
    const params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: DISCORD_REDIRECT_URI }).toString();
    const tokenRes = await httpsRequest('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(params) }, body: params });
    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw new Error('discord token exchange failed');
    const userRes = await httpsRequest('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
    const du = userRes.data;
    const target = DB.users.find(u => u.wlId === saved.wlId);
    if (target) {
      target.discordId = du.id; target.discordUsername = du.username; target.discordLinked = true;
      logAndNotify(target.wlId, target.username, `تم ربط حساب Discord (${du.username}).`, 'link_discord');
      await saveDB(DB);
    }
    res.writeHead(302, { Location: '/?linked=discord' }); res.end();
  } catch (e) { sendHTML(res, 500, `<p>خطأ أثناء الربط: ${e.message}</p><a href="/">رجوع</a>`); }
}
async function robloxStart(req, res) {
  const user = currentUserFromReq(req);
  if (!user) return sendHTML(res, 401, setupNeededPage('Roblox', ['يجب تسجيل الدخول لموقع WL أولًا قبل الربط']));
  if (!ROBLOX_CLIENT_ID || !ROBLOX_CLIENT_SECRET || !ROBLOX_REDIRECT_URI) return sendHTML(res, 200, setupNeededPage('Roblox', ['ROBLOX_CLIENT_ID', 'ROBLOX_CLIENT_SECRET', 'ROBLOX_REDIRECT_URI']));
  const state = newToken();
  OAUTH_STATES.set(state, { wlId: user.wlId, provider: 'roblox', expires: Date.now() + 10 * 60 * 1000 });
  res.writeHead(302, { Location: `https://apis.roblox.com/oauth/v1/authorize?client_id=${encodeURIComponent(ROBLOX_CLIENT_ID)}&redirect_uri=${encodeURIComponent(ROBLOX_REDIRECT_URI)}&scope=${encodeURIComponent('openid profile')}&response_type=code&state=${state}` });
  res.end();
}
async function robloxCallback(req, res, query) {
  const { code, state } = query;
  const saved = OAUTH_STATES.get(state);
  if (!saved || saved.provider !== 'roblox' || saved.expires < Date.now()) return sendHTML(res, 400, '<p>جلسة الربط منتهية.</p>');
  OAUTH_STATES.delete(state);
  try {
    const params = new URLSearchParams({ client_id: ROBLOX_CLIENT_ID, client_secret: ROBLOX_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: ROBLOX_REDIRECT_URI }).toString();
    const tokenRes = await httpsRequest('https://apis.roblox.com/oauth/v1/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(params) }, body: params });
    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw new Error('roblox token exchange failed');
    const userRes = await httpsRequest('https://apis.roblox.com/oauth/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
    const ru = userRes.data;
    const target = DB.users.find(u => u.wlId === saved.wlId);
    if (target) {
      target.robloxId = ru.sub; target.robloxUsername = ru.preferred_username || ru.nickname || target.robloxUsername;
      target.robloxDisplayName = ru.name || ru.nickname || target.robloxDisplayName; target.robloxLinked = true;
      logAndNotify(target.wlId, target.username, `تم ربط حساب Roblox (${target.robloxUsername}).`, 'link_roblox');
      await saveDB(DB);
    }
    res.writeHead(302, { Location: '/?linked=roblox' }); res.end();
  } catch (e) { sendHTML(res, 500, `<p>خطأ أثناء الربط: ${e.message}</p><a href="/">رجوع</a>`); }
}

/* ================= Live-stream detection (Batch 2) ================= */
let twitchAppToken = { token: '', expiresAt: 0 };
async function getTwitchAppToken() {
  if (twitchAppToken.token && Date.now() < twitchAppToken.expiresAt) return twitchAppToken.token;
  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(TWITCH_CLIENT_ID)}&client_secret=${encodeURIComponent(TWITCH_CLIENT_SECRET)}&grant_type=client_credentials`;
  const r = await httpsRequest(url, { method: 'POST' });
  if (!r.data.access_token) throw new Error('twitch token failed');
  twitchAppToken = { token: r.data.access_token, expiresAt: Date.now() + (r.data.expires_in - 300) * 1000 };
  return twitchAppToken.token;
}
async function checkTwitchStreamers(streamers) {
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !streamers.length) return [];
  try {
    const token = await getTwitchAppToken();
    const qs = streamers.map(s => `user_login=${encodeURIComponent(s.handle)}`).join('&');
    const r = await httpsRequest(`https://api.twitch.tv/helix/streams?${qs}`, { headers: { 'Client-Id': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } });
    const data = Array.isArray(r.data.data) ? r.data.data : [];
    return data.map(d => {
      const s = streamers.find(x => x.handle.toLowerCase() === d.user_login.toLowerCase());
      const thumb = d.thumbnail_url ? d.thumbnail_url.replace('{width}', '440').replace('{height}', '248') : '';
      return { streamerId: s ? s.id : null, displayName: s ? s.displayName : d.user_name, platform: 'twitch', title: d.title, viewers: d.viewer_count, url: `https://twitch.tv/${d.user_login}`, thumbnail: thumb };
    });
  } catch (e) { return []; }
}
async function checkYouTubeStreamers(streamers) {
  if (!YOUTUBE_API_KEY || !streamers.length) return [];
  const results = await Promise.allSettled(streamers.map(async s => {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(s.handle)}&eventType=live&type=video&key=${YOUTUBE_API_KEY}`;
    const r = await httpsRequest(searchUrl);
    const items = r.data.items;
    if (!items || !items.length) return null;
    const videoId = items[0].id.videoId;
    let viewers = 0;
    try {
      const vr = await httpsRequest(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${YOUTUBE_API_KEY}`);
      viewers = parseInt(vr.data.items?.[0]?.liveStreamingDetails?.concurrentViewers || '0', 10);
    } catch (e) {}
    const thumb = items[0].snippet.thumbnails?.medium?.url || items[0].snippet.thumbnails?.default?.url || '';
    return { streamerId: s.id, displayName: s.displayName, platform: 'youtube', title: items[0].snippet.title, viewers, url: `https://www.youtube.com/watch?v=${videoId}`, thumbnail: thumb };
  }));
  return results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
}
let kickAppToken = { token: '', expiresAt: 0 };
async function getKickAppToken() {
  if (kickAppToken.token && Date.now() < kickAppToken.expiresAt) return kickAppToken.token;
  const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: KICK_CLIENT_ID, client_secret: KICK_CLIENT_SECRET }).toString();
  const r = await httpsRequest('https://id.kick.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(params) }, body: params });
  if (!r.data.access_token) throw new Error('kick token failed');
  kickAppToken = { token: r.data.access_token, expiresAt: Date.now() + (r.data.expires_in - 300) * 1000 };
  return kickAppToken.token;
}
async function checkKickStreamers(streamers) {
  if (!KICK_CLIENT_ID || !KICK_CLIENT_SECRET || !streamers.length) return [];
  try {
    const token = await getKickAppToken();
    const results = await Promise.allSettled(streamers.map(async s => {
      const r = await httpsRequest(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(s.handle)}`, { headers: { Authorization: `Bearer ${token}` } });
      const ch = Array.isArray(r.data.data) ? r.data.data[0] : (Array.isArray(r.data) ? r.data[0] : null);
      if (!ch) return null;
      // Kick's public API is newer — check the couple of shapes it's known to use.
      const stream = ch.stream || ch.livestream;
      const isLive = stream ? (stream.is_live !== false) : false;
      if (!isLive) return null;
      const thumb = (stream.thumbnail && (stream.thumbnail.url || stream.thumbnail.src)) || ch.banner_picture || '';
      return { streamerId: s.id, displayName: s.displayName, platform: 'kick', title: stream.stream_title || stream.session_title || '', viewers: stream.viewer_count || 0, url: `https://kick.com/${s.handle}`, thumbnail: thumb };
    }));
    return results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  } catch (e) { return []; }
}
let streamCache = { data: [], expiresAt: 0 };
async function getLiveStreams() {
  if (Date.now() < streamCache.expiresAt) return streamCache.data;
  const byPlatform = { youtube: [], twitch: [], kick: [] };
  DB.streamers.forEach(s => { if (byPlatform[s.platform]) byPlatform[s.platform].push(s); });
  const [twitch, youtube, kick] = await Promise.all([
    checkTwitchStreamers(byPlatform.twitch),
    checkYouTubeStreamers(byPlatform.youtube),
    checkKickStreamers(byPlatform.kick)
  ]);
  const live = [...twitch, ...youtube, ...kick].sort((a, b) => b.viewers - a.viewers);
  streamCache = { data: live, expiresAt: Date.now() + 45000 };
  return live;
}

/* ================= Roblox real player count ================= */
let robloxCache = { placeId: '', universeId: '', playing: 0, maxPlayers: 0, expiresAt: 0 };
async function getRobloxStatus(placeId) {
  if (!placeId) return { configured: false };
  if (robloxCache.placeId === placeId && Date.now() < robloxCache.expiresAt) {
    return { configured: true, playing: robloxCache.playing, maxPlayers: robloxCache.maxPlayers, placeUrl: `https://www.roblox.com/games/${placeId}` };
  }
  try {
    let universeId = robloxCache.placeId === placeId ? robloxCache.universeId : '';
    if (!universeId) {
      const ur = await httpsRequest(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
      universeId = ur.data.universeId;
    }
    const gr = await httpsRequest(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
    const game = gr.data.data && gr.data.data[0];
    const playing = game ? game.playing : 0;
    const maxPlayers = game ? game.maxPlayers : 0;
    robloxCache = { placeId, universeId, playing, maxPlayers, expiresAt: Date.now() + 30000 };
    return { configured: true, playing, maxPlayers, placeUrl: `https://www.roblox.com/games/${placeId}` };
  } catch (e) { return { configured: true, playing: null, maxPlayers: null, placeUrl: `https://www.roblox.com/games/${placeId}`, error: true }; }
}

/* ================= API routes ================= */
async function handleApi(req, res, pathname) {
  const method = req.method;

  /* ---- auth ---- */
  if (pathname === '/api/register' && method === 'POST') {
    const { username, email, password } = await readBody(req);
    if (!username || !password || password.length < 4) return sendJSON(res, 400, { error: 'اسم المستخدم وكلمة مرور (4 أحرف فأكثر) مطلوبة' });
    if (DB.users.find(u => u.username.toLowerCase() === username.toLowerCase())) return sendJSON(res, 409, { error: 'اسم المستخدم مستخدم بالفعل' });
    if (email && DB.users.find(u => (u.email || '').toLowerCase() === email.toLowerCase())) return sendJSON(res, 409, { error: 'البريد الإلكتروني مستخدم بالفعل' });
    const { salt, hash } = hashPassword(password);
    const wlId = nextWlId();
    const role = DB.users.length === 0 ? 'admin' : 'user';
    const user = {
      wlId, username, email: email || null, passwordHash: hash, salt, role, avatarUrl: null,
      discordUsername: null, discordId: null, discordLinked: false,
      robloxUsername: null, robloxDisplayName: null, robloxId: null, robloxLinked: false,
      createdAt: nowStr(), lastLogin: nowStr(), testAttempts: [], lastTestAt: null
    };
    DB.users.push(user);
    logAndNotify(wlId, username, 'تم إنشاء الحساب.', 'account_created');
    await saveDB(DB);
    const sid = newToken(); SESSIONS.set(sid, wlId);
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const { username, password } = await readBody(req);
    const user = DB.users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
    if (!user || !verifyPassword(password || '', user.salt, user.passwordHash)) return sendJSON(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    user.lastLogin = nowStr();
    logAndNotify(user.wlId, user.username, `تسجيل دخول للحساب ${user.username}.`, 'login');
    await saveDB(DB);
    const sid = newToken(); SESSIONS.set(sid, user.wlId);
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const user = currentUserFromReq(req);
    if (user) { logAndNotify(user.wlId, user.username, `تسجيل خروج من الحساب ${user.username}.`, 'logout'); await saveDB(DB); }
    const sid = getCookie(req, 'sid');
    if (sid) SESSIONS.delete(sid);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && method === 'GET') return sendJSON(res, 200, { user: publicUser(currentUserFromReq(req)) });

  if (pathname === '/api/me/avatar' && method === 'POST') {
    const user = currentUserFromReq(req);
    if (!user) return sendJSON(res, 401, { error: 'سجّل الدخول أولاً' });
    const { imageDataUrl } = await readBody(req, 1.5e6);
    if (!imageDataUrl || !/^data:image\/(png|jpe?g|webp);base64,/.test(imageDataUrl)) return sendJSON(res, 400, { error: 'صورة غير صالحة' });
    if (imageDataUrl.length > 900000) return sendJSON(res, 400, { error: 'حجم الصورة كبير جدًا' });
    user.avatarUrl = imageDataUrl;
    await saveDB(DB);
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/unlink/discord' && method === 'POST') {
    const user = currentUserFromReq(req);
    if (!user) return sendJSON(res, 401, { error: 'سجّل الدخول أولاً' });
    user.discordLinked = false;
    logAndNotify(user.wlId, user.username, 'تم إلغاء ربط حساب Discord.', 'unlink_discord');
    await saveDB(DB);
    return sendJSON(res, 200, { user: publicUser(user) });
  }
  if (pathname === '/api/unlink/roblox' && method === 'POST') {
    const user = currentUserFromReq(req);
    if (!user) return sendJSON(res, 401, { error: 'سجّل الدخول أولاً' });
    user.robloxLinked = false;
    logAndNotify(user.wlId, user.username, 'تم إلغاء ربط حساب Roblox.', 'unlink_roblox');
    await saveDB(DB);
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/my/activity' && method === 'GET') {
    const user = currentUserFromReq(req);
    if (!user) return sendJSON(res, 401, { error: 'سجّل الدخول أولاً' });
    return sendJSON(res, 200, { activity: DB.activity[user.wlId] || [] });
  }

  /* ---- public content ---- */
  if (pathname === '/api/rules' && method === 'GET') return sendJSON(res, 200, { rules: DB.rules });
  if (pathname === '/api/branches' && method === 'GET') return sendJSON(res, 200, { branches: DB.branches });
  if (pathname === '/api/officials' && method === 'GET') return sendJSON(res, 200, { officials: DB.officials });
  if (pathname === '/api/settings/public' && method === 'GET') {
    const s = DB.settings;
    return sendJSON(res, 200, { numQuestions: s.numQuestions, passPercent: s.passPercent, testDurationMinutes: s.testDurationMinutes, testOpen: s.testOpen, primaryDiscordInvite: s.primaryDiscordInvite, discordRoleName: s.discordRoleName, robloxPlaceId: s.robloxPlaceId });
  }

  /* ---- activation test (graded server-side) ---- */
  if (pathname === '/api/test/start' && method === 'POST') {
    const user = currentUserFromReq(req);
    if (!user) return sendJSON(res, 401, { error: 'سجّل الدخول أولاً' });
    if (!DB.settings.testOpen) return sendJSON(res, 403, { error: 'الاختبار مغلق حاليًا من الإدارة', closed: true, discordInvite: DB.settings.primaryDiscordInvite });
    if (!user.discordLinked || !user.robloxLinked) return sendJSON(res, 400, { error: 'اربط Discord و Roblox أولًا' });
    const last = user.testAttempts[0];
    if (last && !last.passed && user.lastTestAt && (Date.now() - user.lastTestAt) < 3600000) {
      const remain = Math.ceil((3600000 - (Date.now() - user.lastTestAt)) / 60000);
      return sendJSON(res, 429, { error: `لازم تنتظر ${remain} دقيقة قبل إعادة المحاولة`, cooldownMinutes: remain });
    }
    if (!DB.questionBank.length) return sendJSON(res, 400, { error: 'ما فيه أسئلة بالبنك بعد — تواصل مع الإدارة' });
    const n = Math.min(DB.settings.numQuestions, DB.questionBank.length);
    const questions = shuffleArray([...DB.questionBank]).slice(0, n);
    const attemptId = newToken();
    PENDING_TESTS.set(attemptId, { wlId: user.wlId, questions, createdAt: Date.now() });
    return sendJSON(res, 200, {
      attemptId, durationMinutes: DB.settings.testDurationMinutes,
      questions: questions.map(q => ({ id: q.id, q: q.q, options: q.options }))
    });
  }
  if (pathname === '/api/test/submit' && method === 'POST') {
    const user = currentUserFromReq(req);
    if (!user) return sendJSON(res, 401, { error: 'سجّل الدخول أولاً' });
    const { attemptId, answers } = await readBody(req);
    const pending = PENDING_TESTS.get(attemptId);
    if (!pending || pending.wlId !== user.wlId) return sendJSON(res, 400, { error: 'محاولة غير صالحة' });
    if (Date.now() - pending.createdAt > (DB.settings.testDurationMinutes + 5) * 60000) { PENDING_TESTS.delete(attemptId); return sendJSON(res, 400, { error: 'انتهت مهلة الاختبار' }); }
    let correct = 0;
    pending.questions.forEach((q, i) => { if (answers && answers[i] === q.correct) correct++; });
    const total = pending.questions.length;
    const percent = Math.round((correct / total) * 100);
    const passed = percent >= DB.settings.passPercent;
    const attempt = { date: nowStr(), score: correct, total, percent, passed };
    user.testAttempts.unshift(attempt);
    user.lastTestAt = Date.now();
    PENDING_TESTS.delete(attemptId);
    addActivity(user.wlId, `أنهى اختبار التفعيل — ${passed ? 'نجح' : 'رسب'} (${percent}%).`, 'test_result');
    sendTestResultWebhook(user, attempt);
    await saveDB(DB);
    return sendJSON(res, 200, { score: correct, total, percent, passed });
  }

  /* ---- admin / staff only ---- */
  if (pathname === '/api/admin/stats' && method === 'GET') {
    const user = currentUserFromReq(req);
    if (!requireRole(user, ['staff', 'admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    const total = DB.users.length;
    const discordLinked = DB.users.filter(u => u.discordLinked).length;
    const robloxLinked = DB.users.filter(u => u.robloxLinked).length;
    const staff = DB.users.filter(u => u.role === 'staff').length;
    const admins = DB.users.filter(u => u.role === 'admin').length;
    const allAttempts = DB.users.flatMap(u => u.testAttempts.map(a => ({ ...a, username: u.username, wlId: u.wlId })));
    const passed = allAttempts.filter(a => a.passed).length;
    const failed = allAttempts.length - passed;
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = allAttempts.filter(a => a.date.slice(0, 10) === today).length;
    const latest = [...DB.users].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map(publicUser);
    const latestTests = allAttempts.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    return sendJSON(res, 200, { total, discordLinked, robloxLinked, staff, admins, latest, testsTotal: allAttempts.length, testsPassed: passed, testsFailed: failed, testsToday: todayCount, latestTests });
  }
  if (pathname === '/api/admin/users' && method === 'GET') {
    const user = currentUserFromReq(req);
    if (!requireRole(user, ['staff', 'admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    const urlObj = new URL(req.url, 'http://x');
    return sendJSON(res, 200, { results: searchUsers(urlObj.searchParams.get('q') || '').map(publicUser) });
  }
  if (pathname === '/api/admin/logs' && method === 'GET') {
    const user = currentUserFromReq(req);
    if (!requireRole(user, ['staff', 'admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    const relevant = new Set(['login', 'logout', 'link_discord', 'unlink_discord', 'link_roblox', 'unlink_roblox', 'role_change', 'account_created', 'test_result']);
    let merged = [];
    for (const u of DB.users) (DB.activity[u.wlId] || []).forEach(e => { if (relevant.has(e.type)) merged.push({ ...e, wlId: u.wlId, username: u.username }); });
    merged.sort((a, b) => b.time.localeCompare(a.time));
    return sendJSON(res, 200, { logs: merged.slice(0, 300) });
  }
  const detailMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (detailMatch && method === 'GET') {
    const user = currentUserFromReq(req);
    if (!requireRole(user, ['staff', 'admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    const target = DB.users.find(u => u.wlId === detailMatch[1]);
    if (!target) return sendJSON(res, 404, { error: 'غير موجود' });
    return sendJSON(res, 200, { user: publicUser(target), activity: DB.activity[target.wlId] || [] });
  }
  const roleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
  if (roleMatch && method === 'POST') {
    const admin = currentUserFromReq(req);
    if (!requireRole(admin, ['admin'])) return sendJSON(res, 403, { error: 'فقط الإدارة تقدر تغيّر الصلاحيات' });
    const { role } = await readBody(req);
    if (!['user', 'staff', 'admin'].includes(role)) return sendJSON(res, 400, { error: 'صلاحية غير صحيحة' });
    const target = DB.users.find(u => u.wlId === roleMatch[1]);
    if (!target) return sendJSON(res, 404, { error: 'غير موجود' });
    target.role = role;
    logAndNotify(target.wlId, target.username, `قام ${admin.username} بتغيير الصلاحية إلى ${role}.`, 'role_change');
    await saveDB(DB);
    return sendJSON(res, 200, { user: publicUser(target) });
  }

  if (pathname === '/api/admin/questions' && method === 'GET') {
    const user = currentUserFromReq(req);
    if (!requireRole(user, ['staff', 'admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    return sendJSON(res, 200, { questions: DB.questionBank });
  }
  if (pathname === '/api/admin/questions' && method === 'PUT') {
    const admin = currentUserFromReq(req);
    if (!requireRole(admin, ['admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    const { questions } = await readBody(req, 5e6);
    if (!Array.isArray(questions)) return sendJSON(res, 400, { error: 'بيانات غير صالحة' });
    for (const q of questions) {
      if (!q.q || !Array.isArray(q.options) || q.options.length < 2 || typeof q.correct !== 'number') {
        return sendJSON(res, 400, { error: 'كل سؤال يحتاج نص، خيارين على الأقل، وتحديد الإجابة الصحيحة' });
      }
    }
    DB.questionBank = questions; await saveDB(DB);
    return sendJSON(res, 200, { questions: DB.questionBank });
  }

  if (pathname === '/api/admin/rules' && method === 'PUT') {
    const admin = currentUserFromReq(req);
    if (!requireRole(admin, ['admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    const { rules } = await readBody(req, 3e6);
    if (!Array.isArray(rules)) return sendJSON(res, 400, { error: 'بيانات غير صالحة' });
    DB.rules = rules; await saveDB(DB);
    return sendJSON(res, 200, { rules: DB.rules });
  }
  if (pathname === '/api/admin/branches' && method === 'PUT') {
    const admin = currentUserFromReq(req);
    if (!requireRole(admin, ['admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    const { branches } = await readBody(req, 2e6);
    if (!Array.isArray(branches)) return sendJSON(res, 400, { error: 'بيانات غير صالحة' });
    DB.branches = branches; await saveDB(DB);
    return sendJSON(res, 200, { branches: DB.branches });
  }
  if (pathname === '/api/admin/officials' && method === 'PUT') {
    const admin = currentUserFromReq(req);
    if (!requireRole(admin, ['admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    const { officials } = await readBody(req, 3e6);
    if (!Array.isArray(officials)) return sendJSON(res, 400, { error: 'بيانات غير صالحة' });
    DB.officials = officials; await saveDB(DB);
    return sendJSON(res, 200, { officials: DB.officials });
  }
  if (pathname === '/api/admin/streamers' && method === 'GET') {
    const user = currentUserFromReq(req);
    if (!requireRole(user, ['staff', 'admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    return sendJSON(res, 200, { streamers: DB.streamers });
  }
  if (pathname === '/api/admin/streamers' && method === 'PUT') {
    const admin = currentUserFromReq(req);
    if (!requireRole(admin, ['admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    const { streamers } = await readBody(req, 2e6);
    if (!Array.isArray(streamers)) return sendJSON(res, 400, { error: 'بيانات غير صالحة' });
    DB.streamers = streamers; await saveDB(DB);
    return sendJSON(res, 200, { streamers: DB.streamers });
  }
  if (pathname === '/api/admin/settings' && method === 'GET') {
    const user = currentUserFromReq(req);
    if (!requireRole(user, ['staff', 'admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    return sendJSON(res, 200, { settings: DB.settings });
  }
  if (pathname === '/api/admin/settings' && method === 'PUT') {
    const admin = currentUserFromReq(req);
    if (!requireRole(admin, ['admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    const body = await readBody(req);
    DB.settings = { ...DB.settings, ...body };
    await saveDB(DB);
    return sendJSON(res, 200, { settings: DB.settings });
  }

  /* ---- streams (data model ready now; live-detection is Batch 2) ---- */
  if (pathname === '/api/streams' && method === 'GET') {
    try { return sendJSON(res, 200, { live: await getLiveStreams() }); }
    catch (e) { return sendJSON(res, 200, { live: [] }); }
  }
  if (pathname === '/api/roblox/status' && method === 'GET') {
    const status = await getRobloxStatus(DB.settings.robloxPlaceId);
    return sendJSON(res, 200, status);
  }

  return sendJSON(res, 404, { error: 'مسار غير موجود' });
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  const query = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  try {
    if (pathname === '/auth/discord/start') return discordStart(req, res);
    if (pathname === '/auth/discord/callback') return discordCallback(req, res, query);
    if (pathname === '/auth/roblox/start') return robloxStart(req, res);
    if (pathname === '/auth/roblox/callback') return robloxCallback(req, res, query);
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return serveStatic(req, res);
  } catch (err) { console.error(err); sendJSON(res, 500, { error: 'خطأ في الخادم' }); }
});
(async () => {
  try {
    DB = await loadDB();
  } catch (e) {
    console.error('FATAL: could not load the database, refusing to start (to avoid any risk of data loss).');
    console.error(e.message);
    process.exit(1);
  }
  server.listen(PORT, () => console.log(`WL Emergency backend running: http://localhost:${PORT}${USE_TURSO ? ' (storage: Turso)' : ' (storage: local file)'}`));
})();
