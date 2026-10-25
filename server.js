require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === "production";
const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "gameku.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS listings (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 seller_id INTEGER NOT NULL REFERENCES users(id),
 game TEXT NOT NULL,
 title TEXT NOT NULL,
 description TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price > 0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','sold','removed')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 buyer_id INTEGER NOT NULL REFERENCES users(id),
 seller_id INTEGER NOT NULL REFERENCES users(id),
 listing_id INTEGER NOT NULL REFERENCES listings(id),
 price INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','completed','cancelled','refunded')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS deposits (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 amount INTEGER NOT NULL CHECK(amount >= 10000),
 method TEXT NOT NULL DEFAULT 'DANA',
 reference TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL REFERENCES orders(id),
 sender_id INTEGER NOT NULL REFERENCES users(id),
 body TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 amount INTEGER NOT NULL,
 type TEXT NOT NULL,
 note TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "";
if (adminEmail && adminPassword && adminPassword.length >= 12 &&
    !db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail)) {
  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')")
    .run("Admin GAMEKU", adminEmail, hash);
  console.log("Admin account seeded:", adminEmail);
}

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.json({ limit: "20kb" }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir }),
  name: "gameku.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public")));

function safeUser(user) {
  return user ? { id: user.id, name: user.name, email: user.email, role: user.role, balance: user.balance } : null;
}
function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare("SELECT id,name,email,role,balance FROM users WHERE id=?").get(req.session.userId) || null;
}
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Silakan login terlebih dahulu." });
  req.user = user; next();
}
function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Khusus admin." });
  req.user = user; next();
}
function rupiah(n) { return "Rp" + Number(n).toLocaleString("id-ID"); }
function validText(v, max) { return typeof v === "string" && v.trim().length > 0 && v.trim().length <= max; }

app.get("/api/me", (req, res) => res.json({ user: safeUser(currentUser(req)) }));

app.post("/api/register", rateLimit({ windowMs: 60 * 60 * 1000, limit: 8 }), (req, res) => {
  const { name, email, password } = req.body || {};
  if (!validText(name, 60) || !validText(email, 160) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" || password.length < 10 || password.length > 100) {
    return res.status(400).json({ error: "Isi nama, email valid, dan password 10–100 karakter." });
  }
  const normalized = email.trim().toLowerCase();
  try {
    const hash = bcrypt.hashSync(password, 12);
    const result = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
      .run(name.trim(), normalized, hash);
    req.session.userId = Number(result.lastInsertRowid);
    res.json({ user: safeUser(currentUser(req)) });
  } catch {
    res.status(409).json({ error: "Email sudah terdaftar." });
  }
});

app.post("/api/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") return res.status(400).json({ error: "Email/password wajib." });
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: "Email atau password salah." });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Gagal membuat sesi." });
    req.session.userId = user.id;
    res.json({ user: safeUser(currentUser(req)) });
  });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get("/api/listings", (req, res) => {
  const game = String(req.query.game || "").slice(0, 60);
  const search = String(req.query.q || "").slice(0, 100);
  let sql = `SELECT l.id,l.game,l.title,l.description,l.price,l.status,l.created_at,u.name seller_name
             FROM listings l JOIN users u ON u.id=l.seller_id WHERE l.status='active'`;
  const args = [];
  if (game) { sql += " AND l.game=?"; args.push(game); }
  if (search) { sql += " AND (l.title LIKE ? OR l.game LIKE ? OR l.description LIKE ?)"; args.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  sql += " ORDER BY l.id DESC LIMIT 100";
  res.json({ listings: db.prepare(sql).all(...args) });
});

app.post("/api/listings", requireAuth, (req, res) => {
  const { game, title, description, price } = req.body || {};
  const p = Number(price);
  if (!validText(game, 50) || !validText(title, 100) || !validText(description, 1500) ||
      !Number.isSafeInteger(p) || p < 1000 || p > 100000000) {
    return res.status(400).json({ error: "Data produk tidak valid. Harga minimal Rp1.000." });
  }
  const result = db.prepare("INSERT INTO listings(seller_id,game,title,description,price) VALUES(?,?,?,?,?)")
    .run(req.user.id, game.trim(), title.trim(), description.trim(), p);
  res.json({ id: Number(result.lastInsertRowid) });
});

app.post("/api/orders", requireAuth, (req, res) => {
  const listingId = Number(req.body?.listingId);
  if (!Number.isSafeInteger(listingId)) return res.status(400).json({ error: "Produk tidak valid." });
  const createOrder = db.transaction(() => {
    const listing = db.prepare("SELECT * FROM listings WHERE id=? AND status='active'").get(listingId);
    const buyer = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    if (!listing) throw new Error("Produk tidak tersedia.");
    if (listing.seller_id === buyer.id) throw new Error("Tidak bisa membeli produk sendiri.");
    if (buyer.balance < listing.price) throw new Error("Saldo tidak cukup. Buat permintaan deposit terlebih dahulu.");
    db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(listing.price, buyer.id);
    db.prepare("INSERT INTO ledger(user_id,amount,type,note) VALUES(?,?,?,?)")
      .run(buyer.id, -listing.price, "purchase_hold", `Dana ditahan untuk pesanan listing ${listing.id}`);
    const result = db.prepare("INSERT INTO orders(buyer_id,seller_id,listing_id,price,status) VALUES(?,?,?,?, 'paid')")
      .run(buyer.id, listing.seller_id, listing.id, listing.price);
    db.prepare("UPDATE listings SET status='sold' WHERE id=?").run(listing.id);
    return Number(result.lastInsertRowid);
  });
  try { res.json({ orderId: createOrder() }); }
  catch (e) { res.status(400).json({ error: e.message || "Pesanan gagal." }); }
});

app.get("/api/orders", requireAuth, (req, res) => {
  const orders = db.prepare(`
    SELECT o.id,o.price,o.status,o.created_at,l.title,l.game,
      b.name buyer_name,s.name seller_name,o.buyer_id,o.seller_id
    FROM orders o JOIN listings l ON l.id=o.listing_id
    JOIN users b ON b.id=o.buyer_id JOIN users s ON s.id=o.seller_id
    WHERE o.buyer_id=? OR o.seller_id=? ORDER BY o.id DESC
  `).all(req.user.id, req.user.id);
  res.json({ orders });
});

app.post("/api/orders/:id/complete", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const complete = db.transaction(() => {
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
    if (!order || order.buyer_id !== req.user.id) throw new Error("Pesanan tidak ditemukan atau bukan milik pembeli.");
    if (order.status !== "paid") throw new Error("Pesanan tidak bisa diselesaikan.");
    db.prepare("UPDATE orders SET status='completed' WHERE id=?").run(id);
    db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(order.price, order.seller_id);
    db.prepare("INSERT INTO ledger(user_id,amount,type,note) VALUES(?,?,?,?)")
      .run(order.seller_id, order.price, "sale", `Hasil penjualan pesanan ${id}`);
  });
  try { complete(); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/orders/:id/messages", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const order = db.prepare("SELECT * FROM orders WHERE id=? AND (buyer_id=? OR seller_id=?)")
    .get(id, req.user.id, req.user.id);
  if (!order) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
  const messages = db.prepare("SELECT m.id,m.body,m.created_at,m.sender_id,u.name sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.order_id=? ORDER BY m.id ASC LIMIT 200").all(id);
  res.json({ messages });
});
app.post("/api/orders/:id/messages", requireAuth, (req, res) => {
  const id = Number(req.params.id), body = req.body?.body;
  if (!validText(body, 1000)) return res.status(400).json({ error: "Pesan wajib diisi, maksimal 1.000 karakter." });
  const order = db.prepare("SELECT * FROM orders WHERE id=? AND (buyer_id=? OR seller_id=?)")
    .get(id, req.user.id, req.user.id);
  if (!order) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
  db.prepare("INSERT INTO messages(order_id,sender_id,body) VALUES(?,?,?)").run(id, req.user.id, body.trim());
  res.json({ ok: true });
});

app.post("/api/deposits", requireAuth, (req, res) => {
  const amount = Number(req.body?.amount), reference = req.body?.reference;
  if (!Number.isSafeInteger(amount) || amount < 10000 || amount > 5000000 || !validText(reference, 120)) {
    return res.status(400).json({ error: "Minimal deposit Rp10.000, maksimal Rp5.000.000. Isi referensi transfer." });
  }
  const result = db.prepare("INSERT INTO deposits(user_id,amount,reference) VALUES(?,?,?)")
    .run(req.user.id, amount, reference.trim());
  res.json({ depositId: Number(result.lastInsertRowid), message: "Permintaan tercatat. Saldo baru bertambah setelah admin memverifikasi pembayaran." });
});
app.get("/api/deposits", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT id,amount,method,reference,status,created_at FROM deposits WHERE user_id=? ORDER BY id DESC").all(req.user.id);
  res.json({ deposits: rows });
});

app.get("/api/admin/summary", requireAdmin, (req, res) => {
  res.json({
    users: db.prepare("SELECT COUNT(*) n FROM users WHERE role='user'").get().n,
    listings: db.prepare("SELECT COUNT(*) n FROM listings WHERE status='active'").get().n,
    orders: db.prepare("SELECT COUNT(*) n FROM orders").get().n,
    pendingDeposits: db.prepare("SELECT COUNT(*) n FROM deposits WHERE status='pending'").get().n
  });
});
app.get("/api/admin/deposits", requireAdmin, (req, res) => {
  res.json({ deposits: db.prepare("SELECT d.*,u.name,u.email FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 200").all() });
});
app.post("/api/admin/deposits/:id/decision", requireAdmin, (req, res) => {
  const id = Number(req.params.id), decision = req.body?.decision;
  if (!["approve","reject"].includes(decision)) return res.status(400).json({ error: "Keputusan tidak valid." });
  const action = db.transaction(() => {
    const deposit = db.prepare("SELECT * FROM deposits WHERE id=?").get(id);
    if (!deposit || deposit.status !== "pending") throw new Error("Deposit tidak ditemukan atau sudah diproses.");
    if (decision === "approve") {
      db.prepare("UPDATE deposits SET status='approved' WHERE id=?").run(id);
      db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(deposit.amount, deposit.user_id);
      db.prepare("INSERT INTO ledger(user_id,amount,type,note) VALUES(?,?,?,?)")
        .run(deposit.user_id, deposit.amount, "deposit", `Deposit ${id} diverifikasi admin`);
    } else {
      db.prepare("UPDATE deposits SET status='rejected' WHERE id=?").run(id);
    }
  });
  try { action(); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/admin/listings", requireAdmin, (req, res) => {
  res.json({ listings: db.prepare("SELECT l.*,u.name seller_name FROM listings l JOIN users u ON u.id=l.seller_id ORDER BY l.id DESC LIMIT 200").all() });
});
app.post("/api/admin/listings/:id/remove", requireAdmin, (req, res) => {
  db.prepare("UPDATE listings SET status='removed' WHERE id=? AND status='active'").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/ledger", requireAuth, (req, res) => {
  res.json({ entries: db.prepare("SELECT amount,type,note,created_at FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 100").all(req.user.id) });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`GAMEKU berjalan di http://localhost:${PORT}`));
