const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");
const { connectDB } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "hm-fitness-dev-secret-change-me";

app.use(cors());
app.use(express.json({ limit: "6mb" }));
app.use(express.static(path.join(__dirname, "public")));

let db;

// =========================================================
// SELF-PING — keeps Render free tier awake
// =========================================================
function startSelfPing() {
  const url = process.env.APP_URL;
  if (!url) return;
  setInterval(async () => {
    try {
      await fetch(url + "/api/ping");
    } catch (e) {
      // silent — just a keep-alive ping
    }
  }, 5 * 60 * 1000); // every 5 minutes
}

app.get("/api/ping", (req, res) => res.json({ ok: true }));

// =========================================================
// RATE LIMITING
// =========================================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  handler: (req, res) => {
    res.status(429).json({ error: "Too many attempts. Please wait 15 minutes and try again." });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  handler: (req, res) => {
    res.status(429).json({ error: "Too many password reset requests. Please wait 1 hour and try again." });
  },
});

// =========================================================
// HELPERS
// =========================================================
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

const PK_PHONE_REGEX = /^03[0-9]{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validSignup(body) {
  const { name, phone, email, gender, password } = body;
  if (!name || typeof name !== "string" || name.trim().length < 2)
    return "Please enter your full name (at least 2 characters).";
  if (!email || !EMAIL_REGEX.test(email))
    return "Please enter a valid email address.";
  if (!phone || !PK_PHONE_REGEX.test(phone))
    return "Please enter a valid Pakistani phone number in format 03XXXXXXXXX.";
  if (!gender || !["male", "female"].includes(gender))
    return "Please select your gender.";
  if (!password || password.length < 8)
    return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password))
    return "Password must contain at least one uppercase letter.";
  if (!/[0-9]/.test(password))
    return "Password must contain at least one number.";
  return null;
}

function publicUser(u) {
  const { passwordHash, _id, ...rest } = u;
  return rest;
}

function safe(handler) {
  return (req, res) => handler(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });
}

// =========================================================
// AUTH MIDDLEWARE
// =========================================================
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
    return res.status(401).json({ error: "Session expired. Please log in again." });
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
    return res.status(401).json({ error: "Admin session expired. Please log in again." });
  }
}

// =========================================================
// EMAIL HELPER
// =========================================================
async function sendEmail({ to, subject, html }) {
  const meta = await getMeta();
  const cfg = meta.emailConfig || {};
  if (!cfg.gmailAddress || !cfg.gmailAppPassword) {
    throw new Error("Email is not configured. Please set it up in the Admin Panel under Email Settings.");
  }
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: cfg.gmailAddress, pass: cfg.gmailAppPassword },
  });
  await transporter.sendMail({ from: `"${meta.settings.gymName}" <${cfg.gmailAddress}>`, to, subject, html });
}

// =========================================================
// PUBLIC ROUTES
// =========================================================
app.get("/api/settings", safe(async (req, res) => {
  const meta = await getMeta();
  res.json(meta.settings);
}));

// =========================================================
// AUTH: signup / login
// =========================================================
app.post("/api/signup", authLimiter, safe(async (req, res) => {
  const err = validSignup(req.body);
  if (err) return res.status(400).json({ error: err });

  const { name, phone, email, gender, password } = req.body;

  const existingEmail = await db.collection("users").findOne({ email: email.toLowerCase() });
  if (existingEmail) {
    return res.status(409).json({ error: "An account with this email address already exists. Try logging in instead." });
  }

  if (phone) {
    const existingPhone = await db.collection("users").findOne({ phone });
    if (existingPhone) {
      return res.status(409).json({ error: "This phone number is already registered to another account." });
    }
  }

  const user = {
    id: "u_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    phone: phone || null,
    gender,
    passwordHash: bcrypt.hashSync(password, 10),
    plan: null,
    paymentStatus: "none",
    createdAt: new Date().toISOString(),
  };

  await db.collection("users").insertOne(user);
  const token = jwt.sign({ id: user.id, role: "user" }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: publicUser(user) });
}));

app.post("/api/login", authLimiter, safe(async (req, res) => {
  const { phone, password } = req.body;
if (!phone || typeof phone !== "string") return res.status(400).json({ error: "Please enter your phone number." });
if (!password || typeof password !== "string") return res.status(400).json({ error: "Please enter your password." });

  const user = await db.collection("users").findOne({ phone });
  if (!user) {
    return res.status(401).json({ error: "No account found with this phone number. Please check and try again." });
  }
  if (!bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Incorrect password. Please try again." });
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
// FORGOT PASSWORD
// =========================================================
app.post("/api/forgot-password", forgotLimiter, safe(async (req, res) => {
  const { email } = req.body;
  if (!email || !EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  const user = await db.collection("users").findOne({ email: email.toLowerCase() });

  // Always return success — don't reveal if email exists (security best practice)
  if (!user) {
    return res.json({ ok: true, message: "If an account with that email exists, a reset link has been sent." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  await db.collection("users").updateOne(
    { id: user.id },
    { $set: { resetToken: token, resetTokenExpiry: expiry } }
  );

  const meta = await getMeta();
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const resetLink = `${appUrl}/reset-password.html?token=${token}`;

  try {
    await sendEmail({
      to: user.email,
      subject: `Reset your password — ${meta.settings.gymName}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;">
          <h2 style="color:#E33629;">Password Reset</h2>
          <p>Hi ${user.name},</p>
          <p>We received a request to reset your password for your ${meta.settings.gymName} account.</p>
          <p>Click the button below to reset it. This link expires in <strong>1 hour</strong>.</p>
          <a href="${resetLink}" style="display:inline-block;background:#E33629;color:white;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;margin:16px 0;">Reset my password</a>
          <p style="color:#666;font-size:13px;">If you didn't request this, just ignore this email. Your password won't change.</p>
        </div>
      `,
    });
  } catch (e) {
    return res.status(500).json({ error: "Could not send reset email. Please ask the gym admin to check the email configuration in the Admin Panel." });
  }

  res.json({ ok: true, message: "If an account with that email exists, a reset link has been sent." });
}));

app.post("/api/reset-password", safe(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || typeof token !== "string") return res.status(400).json({ error: "Invalid or missing reset token." });
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (!/[A-Z]/.test(newPassword))
    return res.status(400).json({ error: "Password must contain at least one uppercase letter." });
  if (!/[0-9]/.test(newPassword))
    return res.status(400).json({ error: "Password must contain at least one number." });

  const user = await db.collection("users").findOne({ resetToken: token });
  if (!user || !user.resetTokenExpiry || new Date(user.resetTokenExpiry) < new Date()) {
    return res.status(400).json({ error: "This reset link has expired or is invalid. Please request a new one." });
  }

  await db.collection("users").updateOne(
    { id: user.id },
    {
      $set: { passwordHash: bcrypt.hashSync(newPassword, 10) },
      $unset: { resetToken: "", resetTokenExpiry: "" },
    }
  );

  res.json({ ok: true });
}));

// =========================================================
// USER: buy a plan
// =========================================================
app.post("/api/buy-plan", authUser, safe(async (req, res) => {
  const { plan } = req.body;
  if (!["monthly", "quarterly", "yearly"].includes(plan)) {
    return res.status(400).json({ error: "Please choose a valid plan." });
  }
  const result = await db.collection("users").findOneAndUpdate(
    { id: req.userId },
    { $set: { plan, paymentStatus: "pending", planRequestedAt: new Date().toISOString() } },
    { returnDocument: "after" }
  );
  if (!result) return res.status(404).json({ error: "Account not found." });
  res.json({ user: publicUser(result) });
}));

// =========================================================
// USER: content (workouts & diets)
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
app.post("/api/admin/login", authLimiter, safe(async (req, res) => {
  const meta = await getMeta();
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Please enter both username and password." });
  }
  if (username !== meta.admin.username || !bcrypt.compareSync(password, meta.admin.passwordHash)) {
    return res.status(401).json({ error: "Incorrect username or password. Please try again." });
  }
  const token = jwt.sign({ role: "admin", username }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token });
}));

// =========================================================
// ADMIN: settings
// =========================================================
app.put("/api/admin/settings", authAdmin, safe(async (req, res) => {
  const meta = await getMeta();

  if (req.body.photoUrl) {
    const isDataUrl = /^data:image\/(png|jpe?g|webp);base64,/.test(req.body.photoUrl);
    if (!isDataUrl) {
      return res.status(400).json({ error: "Gym photo must be a PNG, JPG, or WEBP image." });
    }
    if (req.body.photoUrl.length > 5_000_000) {
      return res.status(400).json({ error: "That photo is too large. Please use an image under 3MB." });
    }
  }

  const merged = { ...meta.settings, ...req.body };
  await updateMeta({ settings: merged });
  res.json(merged);
}));

// =========================================================
// ADMIN: email config
// =========================================================
app.get("/api/admin/email-config", authAdmin, safe(async (req, res) => {
  const meta = await getMeta();
  const cfg = meta.emailConfig || {};
  res.json({ gmailAddress: cfg.gmailAddress || "", configured: !!(cfg.gmailAddress && cfg.gmailAppPassword) });
}));

app.put("/api/admin/email-config", authAdmin, safe(async (req, res) => {
  const { gmailAddress, gmailAppPassword } = req.body;
  if (!gmailAddress || !EMAIL_REGEX.test(gmailAddress)) {
    return res.status(400).json({ error: "Please enter a valid Gmail address." });
  }
  if (!gmailAppPassword || gmailAppPassword.length < 8) {
    return res.status(400).json({ error: "Please enter a valid Gmail App Password." });
  }
  await updateMeta({ emailConfig: { gmailAddress: gmailAddress.toLowerCase().trim(), gmailAppPassword } });
  res.json({ ok: true });
}));

app.post("/api/admin/email-test", authAdmin, safe(async (req, res) => {
  const meta = await getMeta();
  try {
    await sendEmail({
      to: meta.emailConfig.gmailAddress,
      subject: `Test email from ${meta.settings.gymName}`,
      html: `<p>✅ Your email is working correctly! Members will now receive password reset emails from this address.</p>`,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Test email failed: " + e.message });
  }
}));

// =========================================================
// ADMIN: users & payments
// =========================================================
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
  if (!result) return res.status(404).json({ error: "Member not found." });
  res.json(publicUser(result));
}));

app.post("/api/admin/users/:id/reject", authAdmin, safe(async (req, res) => {
  const result = await db.collection("users").findOneAndUpdate(
    { id: req.params.id },
    { $set: { paymentStatus: "rejected" } },
    { returnDocument: "after" }
  );
  if (!result) return res.status(404).json({ error: "Member not found." });
  res.json(publicUser(result));
}));

// =========================================================
// ADMIN: content
// =========================================================
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

// =========================================================
// ADMIN: change password
// =========================================================
app.put("/api/admin/password", authAdmin, safe(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters." });
  }
  const meta = await getMeta();
  await updateMeta({ admin: { ...meta.admin, passwordHash: bcrypt.hashSync(newPassword, 10) } });
  res.json({ ok: true });
}));

// =========================================================
// START
// =========================================================
connectDB()
  .then((connectedDb) => {
    db = connectedDb;
    app.listen(PORT, () => {
      console.log(`HM Fitness server running at http://localhost:${PORT}`);
      startSelfPing();
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
