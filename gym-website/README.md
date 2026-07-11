# HM Fitness — Website

A gym website for **HM Fitness** (Mirpurkhas) with member signup/login, plan purchase, an admin approval workflow, and a fully editable admin panel. Data is stored in **MongoDB** so it survives restarts and redeploys.

## How it works

1. A visitor signs up (name, Pakistani phone number, gender, password — all required) and logs in.
2. After logging in, they pick a plan: **Monthly (Rs 2,500)**, **Quarterly (Rs 8,000)**, or **Yearly (Rs 27,000)**, plus a one-time **admission fee (Rs 2,500)**.
3. This creates a **pending** request. Your team then contacts the member to collect payment (cash, bank transfer, JazzCash/EasyPaisa, etc. — handled outside the website).
4. In the **Admin Panel**, you mark that member's payment as **Verified** (or **Rejected**).
5. Once verified, the member's dashboard automatically unlocks **Workouts** and **Diet plans**.
6. Everything on the public site — gym name, location, timings, fees, about text, workouts, diets — is editable from the Admin Panel. No code changes needed.

---

## Part 1 — Run it on your own computer

Requires [Node.js](https://nodejs.org) 18+ and a free MongoDB Atlas database (takes 5 minutes, see Part 2, step 1).

```bash
cd gym-website
npm install
cp .env.example .env
```

Open `.env` and paste in your MongoDB connection string and a random `JWT_SECRET`. Then:

```bash
npm start
```

Open **http://localhost:3000**. The first time it connects, it automatically creates default settings, sample workouts/diets, and an admin account (`admin` / `admin123`) inside your database.

---

## Part 2 — Put it online for free (MongoDB Atlas + Render)

### Step 1: Create a free database (MongoDB Atlas)
1. Go to **mongodb.com/cloud/atlas/register** and sign up (no credit card needed).
2. Create a free **M0 cluster** (pick any region close to Pakistan, e.g. Mumbai).
3. Under **Database Access**, create a database user with a username and password — save these.
4. Under **Network Access**, click **Add IP Address** → **Allow Access from Anywhere** (`0.0.0.0/0`) — needed since Render's servers don't have a fixed IP.
5. Click **Connect** on your cluster → **Drivers** → copy the connection string. It looks like:
   `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
   Replace `<username>` and `<password>` with the ones from step 3.

### Step 2: Put your code on GitHub
1. Create a free account at **github.com** if you don't have one.
2. Create a new repository (e.g. `hm-fitness`), and upload the `gym-website` folder contents to it (via the GitHub website's "upload files", or `git push` if you're comfortable with Git).
   - Do **not** upload your `.env` file or `node_modules` folder — `.gitignore` already excludes them.

### Step 3: Deploy on Render
1. Go to **render.com** and sign up with your GitHub account (no credit card needed for the free tier).
2. Click **New +** → **Web Service** → connect your `hm-fitness` repository.
3. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Under **Environment Variables**, add:
   - `MONGODB_URI` = the connection string from Step 1
   - `JWT_SECRET` = any long random string (e.g. generate one at random.org)
5. Click **Create Web Service**. Render will build and deploy — after a minute or two you'll get a live URL like `https://hm-fitness.onrender.com`.

That's it — your site is now public. Share the link, and use `/admin.html` on that same domain to manage members.

### About the free tier
- Render's free web service **sleeps after 15 minutes of no visitors**. The next visitor waits ~30-50 seconds while it wakes up — after that it's fast again. This is fine while you're starting out; if it becomes a problem once you have steady traffic, Render's paid tier ($7/mo) keeps it always-on.
- MongoDB Atlas's M0 tier (512MB storage) is **free forever**, not a trial — no surprise expiry.
- Change the default admin password (`admin123`) immediately from the Admin Panel → Admin Account tab.

### Optional: a custom domain (e.g. hmfitness.pk)
Buy a domain from any registrar, then in Render go to your service → **Settings** → **Custom Domain** and follow the DNS instructions shown there.

---

## Admin panel

Go to `https://your-site-url/admin.html`

- Default login: **username** `admin`, **password** `admin123`
- Change this password immediately from *Admin Account* inside the panel.

## Project structure

```
gym-website/
  server.js          Express API: auth, plan requests, admin verification, editable settings/content
  db.js               MongoDB connection + default data seeding
  .env.example         Template for your local environment variables
  public/
    index.html           Home page (name, location, timings, pricing — all pulled live from settings)
    signup.html            Member signup
    login.html               Member login
    buy-plan.html              Plan selection + payment request
    dashboard.html               Member dashboard (locked until payment verified, then shows workouts/diets)
    admin.html                    Admin login + panel (members/payments, site settings, workouts/diets, admin password)
    css/style.css                  Shared styling
    js/api.js                       Shared frontend API helper
```

## Notes

- Payment itself (JazzCash, EasyPaisa, bank transfer, cash) is handled by your team outside the website; the site only tracks each member's request and verification status.
- If you outgrow the free tiers, the code doesn't need to change — just upgrade your Render plan and/or your Atlas cluster size.
