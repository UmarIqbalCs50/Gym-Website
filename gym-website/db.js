const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");
const dns = require("dns");
require("dotenv").config();

// Some Windows machines and ISPs (common in Pakistan) don't properly resolve
// the mongodb+srv:// DNS lookup Atlas relies on, causing "querySrv ECONNREFUSED".
// Forcing Node to use Google's public DNS resolvers fixes that locally, but can
// interfere with networking on cloud hosts (Railway, Render, etc). So it's opt-in:
// set FORCE_PUBLIC_DNS=true in your LOCAL .env only if you hit that specific error.
// Do NOT set this on Railway/Render.
if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}

let client;
let dbInstance;

const DEFAULT_META = {
  _id: "site",
  settings: {
    gymName: "HM Fitness",
    location: "Mirpurkhas, Sindh",
    tagline: "Train hard. Train here.",
    timings: {
      male: { label: "Male Hours", start: "6:00 PM", end: "12:00 AM" },
      female: { label: "Female Hours", start: "2:00 PM", end: "6:00 PM" },
    },
    fees: { admission: 2500, monthly: 2500, quarterly: 8000, yearly: 27000 },
    contactPhone: "0300-0000000",
    aboutText:
      "HM Fitness is Mirpurkhas' home for serious training — free weights, machines, and a coaching team that knows your name.",
  },
  admin: {
    username: "admin",
    // default password: admin123 (change this from the admin panel after first login)
    passwordHash: bcrypt.hashSync("admin123", 10),
  },
  content: {
    workouts: [
      {
        id: "w1",
        title: "Full Body Foundation (Week 1-4)",
        description:
          "3 days/week. Squat, bench, deadlift, overhead press, rows. Focus on form and consistency before adding weight.",
      },
      {
        id: "w2",
        title: "Push / Pull / Legs Split",
        description:
          "6 days/week for intermediate members. Push (chest, shoulders, triceps), Pull (back, biceps), Legs (quads, hamstrings, calves).",
      },
    ],
    diets: [
      {
        id: "d1",
        title: "Lean Muscle Meal Plan",
        description:
          "High protein, moderate carb plan built around daal, chicken, eggs, and roti. ~2200 kcal/day, adjust per body weight.",
      },
      {
        id: "d2",
        title: "Fat Loss Meal Plan",
        description:
          "Calorie-deficit plan with high fiber vegetables, lean protein, and controlled portions of rice/roti. ~1600-1800 kcal/day.",
      },
    ],
  },
};

async function connectDB() {
  if (dbInstance) return dbInstance;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Create a .env file locally (see .env.example) or set it in your hosting provider's environment variables."
    );
  }

  client = new MongoClient(uri);
  await client.connect();
  dbInstance = client.db(process.env.MONGODB_DB || "hm_fitness");

  // Make sure phone numbers are unique at the database level too.
  await dbInstance.collection("users").createIndex({ phone: 1 }, { unique: true });

  // Seed default site settings/admin/content on a brand new database.
  const existing = await dbInstance.collection("meta").findOne({ _id: "site" });
  if (!existing) {
    await dbInstance.collection("meta").insertOne(DEFAULT_META);
    console.log("Seeded default site settings, admin account, and content into MongoDB.");
  }

  return dbInstance;
}

module.exports = { connectDB };
