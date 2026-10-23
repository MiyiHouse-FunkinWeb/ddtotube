// DDTOTUBE server: API + upload + live signaling (WebRTC) dalam satu file
const express = require('express');
const multer = require('multer');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const VERIFY_FOLLOWERS = 100;                 // centang otomatis
const DEV_OTP = !process.env.FONNTE_TOKEN;    // tanpa provider SMS/WA -> kode OTP tampil di layar (mode tes)
fs.mkdirSync(UP_DIR, { recursive: true });

// ---------- "database" JSON sederhana ----------
let db = { users: {}, sessions: {}, videos: [], follows: {}, otps: {}, comments: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch {}
let saveT;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db), () => {}), 300); };
const id = (n = 8) => crypto.randomBytes(n).toString('hex');

// ---------- util ----------
const hashPw = (pw, salt = id(8)) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const checkPw = (pw, h) => { const [s] = h.split(':'); return hashPw(pw, s) === h; };
const followers = (u) => (db.follows[u] || []).length;
const pubUser = (u) => u && ({
  username: u.username, followers: followers(u.username),
  verified: followers(u.username) >= VERIFY_FOLLOWERS,
  phoneVerified: !!u.phoneVerified, bio: u.bio || ''
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UP_DIR, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));

const auth = (req, res, next) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const s = db.sessions[t];
  if (!s) return res.status(401).json({ error: 'Silakan login dulu' });
  req.user = db.users[s]; req.token = t; next();
};

// ---------- akun ----------
app.post('/api/register', (req, res) => {
  const { username = '', password = '' } = req.body;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username 3-20 huruf/angka/_' });
  if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
  const key = username.toLowerCase();
  if (db.users[key]) return res.status(400).json({ error: 'Username sudah dipakai' });
  db.users[key] = { username, pw: hashPw(password), created: Date.now() };
  const token = id(24); db.sessions[token] = key; save();
  res.json({ token, user: pubUser(db.users[key]) });
});
app.post('/api/login', (req, res) => {
  const u = db.users[(req.body.username || '').toLowerCase()];
  if (!u || !checkPw(req.body.password || '', u.pw)) return res.status(400).json({ error: 'Username / password salah' });
  const token = id(24); db.sessions[token] = u.username.toLowerCase(); save();
  res.json({ token, user: pubUser(u) });
});
app.get('/api/me', auth, (req, res) => res.json(pubUser(req.user)));

// ---------- verifikasi nomor HP (OTP) ----------
async function sendSms(phone, text) {
  if (DEV_OTP) return;
  // Fonnte (WhatsApp/SMS Indonesia). Ganti sesuai provider kamu (Twilio, Zenziva, dll).
  await fetch('https://api.fonnte.com/send', {
    method: 'POST', headers: { Authorization: process.env.FONNTE_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: phone, message: text })
  });
}
app.post('/api/phone/send', auth, async (req, res) => {
  let phone = String(req.body.phone || '').replace(/[^0-9+]/g, '');
  if (phone.startsWith('0')) phone = '+62' + phone.slice(1);
  if (!/^\+\d{9,15}$/.test(phone)) return res.status(400).json({ error: 'Nomor HP tidak valid (contoh 08123456789)' });
  const used = Object.values(db.users).find(u => u.phoneVerified && u.phone === phone && u !== req.user);
  if (used) return res.status(400).json({ error: 'Nomor ini sudah dipakai akun lain' });
  const last = db.otps[req.user.username.toLowerCase()];
  if (last && Date.now() - last.t < 30000) return res.status(429).json({ error: 'Tunggu 30 detik sebelum kirim ulang' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.otps[req.user.username.toLowerCase()] = { phone, code, t: Date.now(), tries: 0 }; save();
  try { await sendSms(phone, `Kode DDTOTUBE kamu: ${code}`); } catch (e) { return res.status(500).json({ error: 'Gagal kirim SMS' }); }
  console.log(`[OTP] ${phone} -> ${code}`);
  res.json({ ok: true, devCode: DEV_OTP ? code : undefined });
});
app.post('/api/phone/verify', auth, (req, res) => {
  const k = req.user.username.toLowerCase(); const o = db.otps[k];
  if (!o || Date.now() - o.t > 5 * 60000) return res.status(400).json({ error: 'Kode kedaluwarsa, kirim ulang' });
  if (++o.tries > 5) return res.status(429).json({ error: 'Terlalu banyak percobaan' });
  if (String(req.body.code) !== o.code) return res.status(400).json({ error: 'Kode salah' });
  req.user.phone = o.phone; req.user.phoneVerified = true; delete db.otps[k]; save();
  res.json({ ok: true, user: pubUser(req.user) });
});

// ---------- video ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UP_DIR,
    filename: (r, f, cb) => cb(null, id(10) + path.extname(f.originalname).toLowerCase().slice(0, 6))
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});
const vOut = (v) => ({ ...v, author: pubUser(db.users[v.owner]) });

app.get('/api/videos', (req, res) => {
  const q = (req.query.q || '').toLowerCase(), by = (req.query.by || '').toLowerCase();
  res.json(db.videos.filter(v => (!q || v.title.toLowerCase().includes(q)) && (!by || v.owner === by))
    .sort((a, b) => b.created - a.created).slice(0, 60).map(vOut));
});
app.post('/api/videos', auth, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), (req, res) => {
  const f = req.files || {};
  const rm = () => Object.values(f).flat().forEach(x => fs.unlink(x.path, () => {}));
  if (!f.video) return res.status(400).json({ error: 'Pilih file video' });
  if (!/^video\//.test(f.video[0].mimetype)) { rm(); return res.status(400).json({ error: 'File harus video' }); }
  if (f.thumbnail) {
    if (!req.user.phoneVerified) { rm(); return res.status(403).json({ error: 'Upload thumbnail wajib verifikasi nomor HP dulu', needPhone: true }); }
    if (!/^image\//.test(f.thumbnail[0].mimetype)) { rm(); return res.status(400).json({ error: 'Thumbnail harus gambar' }); }
  }
  const v = {
    id: id(5), owner: req.user.username.toLowerCase(), title: (req.body.title || 'Tanpa judul').slice(0, 100),
    desc: (req.body.desc || '').slice(0, 2000), video: '/uploads/' + f.video[0].filename,
    thumb: f.thumbnail ? '/uploads/' + f.thumbnail[0].filename : null, views: 0, likes: [], created: Date.now()
  };
  db.videos.push(v); save(); res.json(vOut(v));
});
app.get('/api/videos/:id', (req, res) => {
  const v = db.videos.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Tidak ditemukan' });
  v.views++; save();
  res.json({ ...vOut(v), likeCount: v.likes.length, comments: db.comments.filter(c => c.video === v.id).slice(-100) });
});
app.post('/api/videos/:id/like', auth, (req, res) => {
  const v = db.videos.find(x => x.id === req.params.id); if (!v) return res.sendStatus(404);
  const k = req.user.username.toLowerCase(), i = v.likes.indexOf(k);
  i >= 0 ? v.likes.splice(i, 1) : v.likes.push(k); save(); res.json({ likeCount: v.likes.length, liked: i < 0 });
});
app.post('/api/videos/:id/comments', auth, (req, res) => {
  const text = String(req.body.text || '').slice(0, 500).trim(); if (!text) return res.sendStatus(400);
  const c = { video: req.params.id, user: pubUser(req.user), text, t: Date.now() }; db.comments.push(c); save(); res.json(c);
});

// ---------- profil & follow ----------
app.get('/api/users/:name', (req, res) => {
  const u = db.users[req.params.name.toLowerCase()]; if (!u) return res.sendStatus(404);
  const t = (req.headers.authorization || '').replace('Bearer ', ''), me = db.sessions[t];
  res.json({ ...pubUser(u), following: !!me && (db.follows[u.username.toLowerCase()] || []).includes(me), needed: VERIFY_FOLLOWERS });
});
app.post('/api/users/:name/follow', auth, (req, res) => {
  const k = req.params.name.toLowerCase(), me = req.user.username.toLowerCase();
  if (!db.users[k] || k === me) return res.status(400).json({ error: 'Tidak bisa' });
  const a = db.follows[k] = db.follows[k] || [], i = a.indexOf(me);
  i >= 0 ? a.splice(i, 1) : a.push(me); save();
  res.json({ following: i < 0, ...pubUser(db.users[k]) });
});

// ---------- live streaming (signaling WebRTC lewat WebSocket) ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const lives = new Map();   // username -> { ws, title, viewers:Set<ws>, started }
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const liveList = () => [...lives.entries()].map(([u, l]) => ({ username: db.users[u].username, title: l.title, viewers: l.viewers.size, verified: pubUser(db.users[u]).verified }));

wss.on('connection', (ws) => {
  ws.id = id(4);
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const me = ws.user;
    switch (m.type) {
      case 'auth': { const s = db.sessions[m.token]; if (s) ws.user = s; send(ws, { type: 'auth', ok: !!s }); break; }
      case 'go-live': {
        if (!me) return send(ws, { type: 'error', error: 'Login dulu' });
        if (lives.has(me)) lives.get(me).ws.close();
        lives.set(me, { ws, title: String(m.title || 'Live').slice(0, 80), viewers: new Set(), started: Date.now() });
        ws.live = me; send(ws, { type: 'live-started' }); break;
      }
      case 'end-live': endLive(ws); break;
      case 'watch': {
        const l = lives.get(String(m.streamer || '').toLowerCase());
        if (!l) return send(ws, { type: 'offline' });
        ws.watching = String(m.streamer).toLowerCase(); l.viewers.add(ws);
        send(l.ws, { type: 'viewer-join', viewer: ws.id, count: l.viewers.size });
        break;
      }
      // relay signaling: broadcaster <-> viewer
      case 'offer': case 'ice-to-viewer': { const l = lives.get(ws.live); const v = l && [...l.viewers].find(x => x.id === m.to); v && send(v, { ...m, from: ws.id }); break; }
      case 'answer': case 'ice-to-broadcaster': { const l = lives.get(ws.watching); l && send(l.ws, { ...m, from: ws.id }); break; }
      case 'chat': {
        const room = lives.get(ws.live || ws.watching); if (!room || !me) return;
        const msg = { type: 'chat', user: db.users[me].username, verified: pubUser(db.users[me]).verified, text: String(m.text || '').slice(0, 200) };
        [room.ws, ...room.viewers].forEach(x => send(x, msg)); break;
      }
    }
  });
  ws.on('close', () => {
    endLive(ws);
    if (ws.watching) { const l = lives.get(ws.watching); if (l) { l.viewers.delete(ws); send(l.ws, { type: 'viewer-left', viewer: ws.id, count: l.viewers.size }); } }
  });
});
function endLive(ws) {
  if (!ws.live) return; const l = lives.get(ws.live);
  if (l && l.ws === ws) { l.viewers.forEach(v => send(v, { type: 'ended' })); lives.delete(ws.live); }
  ws.live = null;
}
app.get('/api/lives', (req, res) => res.json(liveList()));

server.listen(PORT, () => console.log(`DDTOTUBE jalan di http://localhost:${PORT}  (OTP mode tes: ${DEV_OTP})`));
