const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
const { connectDB } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// In production, always set this via an environment variable (see .env.example).
const JWT_SECRET = process.env.JWT_SECRET || "hm-fitness-dev-secret-change-me";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let db; // set once connectDB() resolves, before the server starts accepting requests

// ---------- small data helpers ----------
async function getMeta() {
  return db.collection("meta").findOne({ _id: "site" });
}
async function updateMeta(patch) {
  await db.collection("meta").updateOne({ _id: "site" }, { $set: patch });
  return getMeta();
}
async function findUserById(id) {
  return db.collection("users").findOne({ id });
}

// ---------- validation helpers ----------
const PK_PHONE_REGEX = /^03[0-9]{9}$/; // e.g. 03001234567

function validSignup(body) {
  const { name, phone, gender, password } = body;
  if (!name || typeof name !== "string" || name.trim().length < 2) {
    return "Name is required.";
  }
  if (!phone || !PK_PHONE_REGEX.test(phone)) {
    return "Enter a valid Pakistani mobile number, e.g. 03001234567.";
  }
  if (!gender || !["male", "female"].includes(gender)) {
    return "Please select a gender.";
  }
  if (!password || password.length < 6) {
    return "Password must be at least 6 characters.";
  }
  return null;
}

// ---------- auth middleware ----------
function authUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "user") throw new Error("wrong role");
    req.userId = payload.id;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired, please log in again." });
  }
}

function authAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Admin login required." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") throw new Error("wrong role");
    next();
  } catch {
    return res.status(401).json({ error: "Admin session expired, please log in again." });
  }
}

// Wraps async route handlers so thrown errors become clean 500 responses
// instead of crashing the process or hanging the request.
function safe(handler) {
  return (req, res) => handler(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });
}

function publicUser(u) {
  const { passwordHash, _id, ...rest } = u;
  return rest;
}

// =========================================================
// PUBLIC: site settings (read-only for visitors)
// =========================================================
app.get("/api/settings", safe(async (req, res) => {
  const meta = await getMeta();
  res.json(meta.settings);
}));

// =========================================================
// AUTH: signup / login (members)
// =========================================================
app.post("/api/signup", safe(async (req, res) => {
  const err = validSignup(req.body);
  if (err) return res.status(400).json({ error: err });

  const { name, phone, gender, password } = req.body;

  const existing = await db.collection("users").findOne({ phone });
  if (existing) {
    return res.status(409).json({ error: "An account with this phone number already exists." });
  }

  const user = {
    id: "u_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    name: name.trim(),
    phone,
    gender,
    passwordHash: bcrypt.hashSync(password, 10),
    plan: null, // 'monthly' | 'quarterly' | 'yearly'
    paymentStatus: "none", // 'none' | 'pending' | 'verified' | 'rejected'
    createdAt: new Date().toISOString(),
  };

  await db.collection("users").insertOne(user);

  const token = jwt.sign({ id: user.id, role: "user" }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: publicUser(user) });
}));

app.post("/api/login", safe(async (req, res) => {
  const { phone, password } = req.body;
  const user = await db.collection("users").findOne({ phone });
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Invalid phone number or password." });
  }
  const token = jwt.sign({ id: user.id, role: "user" }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: publicUser(user) });
}));

app.get("/api/me", authUser, safe(async (req, res) => {
  const user = await findUserById(req.userId);
  if (!user) return res.status(404).json({ error: "Account not found." });
  res.json({ user: publicUser(user) });
}));

// =========================================================
// USER: buy a plan (creates a pending payment request)
// =========================================================
app.post("/api/buy-plan", authUser, safe(async (req, res) => {
  const { plan } = req.body;
  if (!["monthly", "quarterly", "yearly"].includes(plan)) {
    return res.status(400).json({ error: "Choose a valid plan." });
  }

  const patch = {
    plan,
    paymentStatus: "pending",
    planRequestedAt: new Date().toISOString(),
  };
  const result = await db.collection("users").findOneAndUpdate(
    { id: req.userId },
    { $set: patch },
    { returnDocument: "after" }
  );
  if (!result) return res.status(404).json({ error: "Account not found." });
  res.json({ user: publicUser(result) });
}));

// =========================================================
// USER: workouts & diets (only unlocked once admin verifies payment)
// =========================================================
app.get("/api/content", authUser, safe(async (req, res) => {
  const user = await findUserById(req.userId);
  if (!user) return res.status(404).json({ error: "Account not found." });
  if (user.paymentStatus !== "verified") {
    return res.status(403).json({ error: "Your plan isn't active yet. Our team will contact you to complete payment." });
  }
  const meta = await getMeta();
  res.json(meta.content);
}));

// =========================================================
// ADMIN: login
// =========================================================
app.post("/api/admin/login", safe(async (req, res) => {
  const meta = await getMeta();
  const { username, password } = req.body;
  if (username !== meta.admin.username || !bcrypt.compareSync(password || "", meta.admin.passwordHash)) {
    return res.status(401).json({ error: "Invalid admin credentials." });
  }
  const token = jwt.sign({ role: "admin", username }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token });
}));

// ---------- admin: site settings (fully editable) ----------
app.put("/api/admin/settings", authAdmin, safe(async (req, res) => {
  const meta = await getMeta();
  const merged = { ...meta.settings, ...req.body };
  await updateMeta({ settings: merged });
  res.json(merged);
}));

// ---------- admin: users & payment verification ----------
app.get("/api/admin/users", authAdmin, safe(async (req, res) => {
  const users = await db.collection("users").find({}).sort({ createdAt: -1 }).toArray();
  res.json(users.map(publicUser));
}));

app.post("/api/admin/users/:id/verify", authAdmin, safe(async (req, res) => {
  const result = await db.collection("users").findOneAndUpdate(
    { id: req.params.id },
    { $set: { paymentStatus: "verified", verifiedAt: new Date().toISOString() } },
    { returnDocument: "after" }
  );
  if (!result) return res.status(404).json({ error: "User not found." });
  res.json(publicUser(result));
}));

app.post("/api/admin/users/:id/reject", authAdmin, safe(async (req, res) => {
  const result = await db.collection("users").findOneAndUpdate(
    { id: req.params.id },
    { $set: { paymentStatus: "rejected" } },
    { returnDocument: "after" }
  );
  if (!result) return res.status(404).json({ error: "User not found." });
  res.json(publicUser(result));
}));

// ---------- admin: workouts & diets (fully editable) ----------
app.get("/api/admin/content", authAdmin, safe(async (req, res) => {
  const meta = await getMeta();
  res.json(meta.content);
}));

app.put("/api/admin/content", authAdmin, safe(async (req, res) => {
  const meta = await getMeta();
  const { workouts, diets } = req.body;
  const content = {
    workouts: Array.isArray(workouts) ? workouts : meta.content.workouts,
    diets: Array.isArray(diets) ? diets : meta.content.diets,
  };
  await updateMeta({ content });
  res.json(content);
}));

// ---------- admin: change admin password ----------
app.put("/api/admin/password", authAdmin, safe(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters." });
  }
  const meta = await getMeta();
  await updateMeta({ admin: { ...meta.admin, passwordHash: bcrypt.hashSync(newPassword, 10) } });
  res.json({ ok: true });
}));

// ---------- start server after the database connection is ready ----------
connectDB()
  .then((connectedDb) => {
    db = connectedDb;
    app.listen(PORT, () => {
      console.log(`HM Fitness server running at http://localhost:${PORT}`);
      console.log(`Default admin login -> username: admin, password: admin123 (change this in the admin panel)`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
