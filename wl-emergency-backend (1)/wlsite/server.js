/**
 * WL Emergency — backend (Stage 2)
 * Zero external dependencies — runs with plain `node server.js`.
 *
 * NEW in this stage:
 *  - Real Discord OAuth2 + Roblox OAuth2 linking (needs your own app
 *    credentials — see README). Falls back to a friendly setup page
 *    if credentials aren't configured yet.
 *  - Full security/activity log with a "type" per event
 *    (login / logout / link / unlink / role_change / account_created).
 *  - GET /api/admin/logs — merged, sorted log for the admin panel.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ======== OAuth credentials (set these as environment variables) ======== */
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';
const ROBLOX_CLIENT_ID = process.env.ROBLOX_CLIENT_ID || '';
const ROBLOX_CLIENT_SECRET = process.env.ROBLOX_CLIENT_SECRET || '';
const ROBLOX_REDIRECT_URI = process.env.ROBLOX_REDIRECT_URI || '';

/* ---------------- tiny JSON "database" ---------------- */
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { users: [], activity: {}, seq: 1000 };
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
let DB = loadDB();

function nowStr() { return new Date().toISOString().slice(0, 16).replace('T', ' '); }

/* every event gets a "type" so the admin log can filter/label it */
function addActivity(wlId, text, type) {
  if (!DB.activity[wlId]) DB.activity[wlId] = [];
  DB.activity[wlId].unshift({ time: nowStr(), text, type: type || 'other' });
}
function publicUser(u) {
  if (!u) return null;
  const { passwordHash, salt, ...safe } = u;
  return safe;
}

/* ---------------- password hashing (built-in crypto) ---------------- */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
}

/* ---------------- sessions ---------------- */
const SESSIONS = new Map();     // sid -> wlId
const OAUTH_STATES = new Map(); // state -> {wlId, provider, expires}
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}
function currentUserFromReq(req) {
  const sid = getCookie(req, 'sid');
  if (!sid || !SESSIONS.has(sid)) return null;
  const wlId = SESSIONS.get(sid);
  return DB.users.find(u => u.wlId === wlId) || null;
}

/* ---------------- helpers ---------------- */
function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function sendHTML(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
  });
}
function nextWlId() { DB.seq += 1; return 'WL-' + DB.seq; }
function requireRole(user, roles) { return user && roles.includes(user.role); }
function searchUsers(q) {
  q = (q || '').trim().toLowerCase();
  if (!q) return [];
  return DB.users.filter(u =>
    u.wlId.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) ||
    (u.discordUsername || '').toLowerCase().includes(q) || (u.discordId || '').toLowerCase().includes(q) ||
    (u.robloxUsername || '').toLowerCase().includes(q) || (u.robloxDisplayName || '').toLowerCase().includes(q) ||
    (u.robloxId || '').toLowerCase().includes(q)
  );
}
/* tiny wrapper around https for calling Discord/Roblox APIs — no dependencies */
function httpsRequest(urlStr, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const options = { hostname: u.hostname, path: u.pathname + u.search, method, headers };
    const req = https.request(options, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        let parsed; try { parsed = JSON.parse(data); } catch (e) { parsed = { raw: data }; }
        resolve({ status: r.statusCode, data: parsed });
      });
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
  <body><h2>⚠️ ربط ${provider} غير مُفعّل بعد</h2>
  <p>لازم تضيف متغيرات البيئة التالية على السيرفر أولًا:</p>
  <p>${varsNeeded.map(v => `<code>${v}</code>`).join('<br>')}</p>
  <p>راجع README.md لمعرفة كيف تسوي تطبيق ${provider} وتحصل على القيم.</p>
  <p><a href="/">⟵ رجوع للموقع</a></p></body></html>`;
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

/* ================= OAuth: Discord ================= */
async function discordStart(req, res) {
  const user = currentUserFromReq(req);
  if (!user) return sendHTML(res, 401, setupNeededPage('Discord', ['يجب تسجيل الدخول لموقع WL أولًا قبل الربط']));
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) {
    return sendHTML(res, 200, setupNeededPage('Discord', ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI']));
  }
  const state = newToken();
  OAUTH_STATES.set(state, { wlId: user.wlId, provider: 'discord', expires: Date.now() + 10 * 60 * 1000 });
  const url = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(DISCORD_CLIENT_ID)}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify&state=${state}`;
  res.writeHead(302, { Location: url });
  res.end();
}
async function discordCallback(req, res, query) {
  const { code, state } = query;
  const saved = OAUTH_STATES.get(state);
  if (!saved || saved.provider !== 'discord' || saved.expires < Date.now()) { return sendHTML(res, 400, '<p>جلسة الربط منتهية، حاول مرة ثانية من صفحة الملف الشخصي.</p>'); }
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
      target.discordId = du.id;
      target.discordUsername = du.username;
      target.discordLinked = true;
      addActivity(target.wlId, `تم ربط حساب Discord الحقيقي (${du.username}).`, 'link_discord');
      saveDB(DB);
    }
    res.writeHead(302, { Location: '/?linked=discord' });
    res.end();
  } catch (e) {
    sendHTML(res, 500, `<p>حدث خطأ أثناء الربط مع Discord: ${e.message}</p><a href="/">رجوع</a>`);
  }
}

/* ================= OAuth: Roblox ================= */
async function robloxStart(req, res) {
  const user = currentUserFromReq(req);
  if (!user) return sendHTML(res, 401, setupNeededPage('Roblox', ['يجب تسجيل الدخول لموقع WL أولًا قبل الربط']));
  if (!ROBLOX_CLIENT_ID || !ROBLOX_CLIENT_SECRET || !ROBLOX_REDIRECT_URI) {
    return sendHTML(res, 200, setupNeededPage('Roblox', ['ROBLOX_CLIENT_ID', 'ROBLOX_CLIENT_SECRET', 'ROBLOX_REDIRECT_URI']));
  }
  const state = newToken();
  OAUTH_STATES.set(state, { wlId: user.wlId, provider: 'roblox', expires: Date.now() + 10 * 60 * 1000 });
  const url = `https://apis.roblox.com/oauth/v1/authorize?client_id=${encodeURIComponent(ROBLOX_CLIENT_ID)}&redirect_uri=${encodeURIComponent(ROBLOX_REDIRECT_URI)}&scope=${encodeURIComponent('openid profile')}&response_type=code&state=${state}`;
  res.writeHead(302, { Location: url });
  res.end();
}
async function robloxCallback(req, res, query) {
  const { code, state } = query;
  const saved = OAUTH_STATES.get(state);
  if (!saved || saved.provider !== 'roblox' || saved.expires < Date.now()) { return sendHTML(res, 400, '<p>جلسة الربط منتهية، حاول مرة ثانية من صفحة الملف الشخصي.</p>'); }
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
      target.robloxId = ru.sub;
      target.robloxUsername = ru.preferred_username || ru.nickname || target.robloxUsername;
      target.robloxDisplayName = ru.name || ru.nickname || target.robloxDisplayName;
      target.robloxLinked = true;
      addActivity(target.wlId, `تم ربط حساب Roblox الحقيقي (${target.robloxUsername}).`, 'link_roblox');
      saveDB(DB);
    }
    res.writeHead(302, { Location: '/?linked=roblox' });
    res.end();
  } catch (e) {
    sendHTML(res, 500, `<p>حدث خطأ أثناء الربط مع Roblox: ${e.message}</p><a href="/">رجوع</a>`);
  }
}

/* ================= API routes ================= */
async function handleApi(req, res, pathname) {
  const method = req.method;

  if (pathname === '/api/register' && method === 'POST') {
    const { username, password } = await readBody(req);
    if (!username || !password || password.length < 4) return sendJSON(res, 400, { error: 'اسم المستخدم وكلمة مرور (4 أحرف فأكثر) مطلوبة' });
    if (DB.users.find(u => u.username.toLowerCase() === username.toLowerCase())) return sendJSON(res, 409, { error: 'اسم المستخدم مستخدم بالفعل' });
    const { salt, hash } = hashPassword(password);
    const wlId = nextWlId();
    const role = DB.users.length === 0 ? 'admin' : 'user';
    const user = { wlId, username, passwordHash: hash, salt, role, discordUsername: null, discordId: null, discordLinked: false, robloxUsername: null, robloxDisplayName: null, robloxId: null, robloxLinked: false, createdAt: nowStr(), lastLogin: nowStr() };
    DB.users.push(user);
    addActivity(wlId, 'تم إنشاء الحساب.', 'account_created');
    if (role === 'admin') addActivity(wlId, 'أول حساب في النظام — تم تعيينه Owner/Admin تلقائيًا.', 'role_change');
    saveDB(DB);
    const sid = newToken();
    SESSIONS.set(sid, wlId);
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const { username, password } = await readBody(req);
    const user = DB.users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
    if (!user || !verifyPassword(password || '', user.salt, user.passwordHash)) return sendJSON(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    user.lastLogin = nowStr();
    addActivity(user.wlId, `تسجيل دخول للحساب ${user.username}.`, 'login');
    saveDB(DB);
    const sid = newToken();
    SESSIONS.set(sid, user.wlId);
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const user = currentUserFromReq(req);
    if (user) { addActivity(user.wlId, `تسجيل خروج من الحساب ${user.username}.`, 'logout'); saveDB(DB); }
    const sid = getCookie(req, 'sid');
    if (sid) SESSIONS.delete(sid);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && method === 'GET') return sendJSON(res, 200, { user: publicUser(currentUserFromReq(req)) });

  if (pathname === '/api/unlink/discord' && method === 'POST') {
    const user = currentUserFromReq(req);
    if (!user) return sendJSON(res, 401, { error: 'سجّل الدخول أولاً' });
    user.discordLinked = false;
    addActivity(user.wlId, 'تم إلغاء ربط حساب Discord.', 'unlink_discord');
    saveDB(DB);
    return sendJSON(res, 200, { user: publicUser(user) });
  }
  if (pathname === '/api/unlink/roblox' && method === 'POST') {
    const user = currentUserFromReq(req);
    if (!user) return sendJSON(res, 401, { error: 'سجّل الدخول أولاً' });
    user.robloxLinked = false;
    addActivity(user.wlId, 'تم إلغاء ربط حساب Roblox.', 'unlink_roblox');
    saveDB(DB);
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/my/activity' && method === 'GET') {
    const user = currentUserFromReq(req);
    if (!user) return sendJSON(res, 401, { error: 'سجّل الدخول أولاً' });
    return sendJSON(res, 200, { activity: DB.activity[user.wlId] || [] });
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
    const latest = [...DB.users].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map(publicUser);
    return sendJSON(res, 200, { total, discordLinked, robloxLinked, staff, admins, latest });
  }

  if (pathname === '/api/admin/users' && method === 'GET') {
    const user = currentUserFromReq(req);
    if (!requireRole(user, ['staff', 'admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    const urlObj = new URL(req.url, 'http://x');
    const results = searchUsers(urlObj.searchParams.get('q') || '').map(publicUser);
    return sendJSON(res, 200, { results });
  }

  if (pathname === '/api/admin/logs' && method === 'GET') {
    const user = currentUserFromReq(req);
    if (!requireRole(user, ['staff', 'admin'])) return sendJSON(res, 403, { error: 'غير مصرح' });
    const relevant = new Set(['login', 'logout', 'link_discord', 'unlink_discord', 'link_roblox', 'unlink_roblox', 'role_change', 'account_created']);
    let merged = [];
    for (const u of DB.users) {
      const entries = DB.activity[u.wlId] || [];
      entries.forEach(e => { if (relevant.has(e.type)) merged.push({ ...e, wlId: u.wlId, username: u.username }); });
    }
    merged.sort((a, b) => b.time.localeCompare(a.time));
    return sendJSON(res, 200, { logs: merged.slice(0, 200) });
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
    addActivity(target.wlId, `قام ${admin.username} بتغيير الصلاحية إلى ${role}.`, 'role_change');
    saveDB(DB);
    return sendJSON(res, 200, { user: publicUser(target) });
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
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'خطأ في الخادم' });
  }
});

server.listen(PORT, () => console.log(`WL Emergency backend running: http://localhost:${PORT}`));
