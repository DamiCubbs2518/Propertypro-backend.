# PropertyPro Backend — Pick Up Here on Wednesday

Everything below assumes you already have Node.js and VS Code installed,
and a Railway account with the free trial running.

## What's in this folder

```
propertypro-backend/
  ├── schema.sql              ← run this in Railway's Postgres query editor first
  ├── package.json            ← dependencies already listed, just run npm install
  ├── .env.example            ← copy to .env and fill in your real DATABASE_URL
  ├── .gitignore
  └── src/
      ├── server.js           ← entry point, wires up all routes
      ├── db.js                ← Postgres connection
      └── routes/
          ├── properties.js
          ├── tenants.js
          ├── payments.js      ← includes auto commission creation
          ├── agents.js        ← includes commission tracker + remit toggle
          ├── shortlet.js
          └── complaints.js
```

This covers every screen in the mockup: Dashboard, Properties, Tenants,
Shortlet, Agents (with commission tracking), and Reports data.

## Step 1 — Set up Postgres on Railway

1. Open your Railway project (or create one if you haven't).
2. Click **New → Database → PostgreSQL**. Railway runs it for you — nothing
   to install locally.
3. Click into the Postgres service → **Data** tab → there's a built-in SQL
   query editor.
4. Open `schema.sql` from this folder, copy the whole thing, paste it into
   the editor, and run it. This creates all 8 tables: users, agents,
   properties, tenants, payments, commissions, shortlet_units, complaints.
5. Click the Postgres service → **Variables** tab → copy the `DATABASE_URL`
   value. You'll need it in Step 3.

## Step 2 — Get this code onto your machine

Move this whole `propertypro-backend` folder to wherever you're keeping the
project (Desktop, or your existing folder from before). Then open a
terminal inside it:

```bash
cd path/to/propertypro-backend
npm install
```

This reads `package.json` and installs express, pg, cors, dotenv, and
nodemon automatically — no need to install them one by one again.

## Step 3 — Add your database connection

```bash
cp .env.example .env
```

Open `.env` in VS Code and paste your real `DATABASE_URL` from Step 1
in place of the placeholder. Leave `PORT=4000` as is for local testing.

## Step 4 — Run it locally

```bash
npm run dev
```

You should see `PropertyPro API running on port 4000`. Then open your
browser to:

```
http://localhost:4000/api/properties
```

You'll get back `[]` (empty array) since there's no data yet — that's
correct, it means the connection to Postgres worked.

## Step 5 — Add some test data (optional but recommended)

In Railway's SQL query editor, run something like:

```sql
INSERT INTO properties (name, address, city, country, currency)
VALUES ('14 Aba Road', '14 Aba Road', 'Port Harcourt', 'Nigeria', 'NGN');
```

Then refresh `http://localhost:4000/api/properties` — you should see that
property come back as JSON.

## Step 6 — Push to GitHub and deploy on Railway

```bash
git init
git add .
git commit -m "Initial backend"
```

Create a new repo on GitHub, then:

```bash
git remote add origin https://github.com/yourusername/propertypro-backend.git
git push -u origin main
```

In Railway: **New → GitHub Repo** → select this repo. In its **Variables**
tab, link `DATABASE_URL` from your Postgres service so the live version
can reach the database too.

## What each route file does

| File | Endpoint base | Powers |
|---|---|---|
| `properties.js` | `/api/properties` | Properties screen |
| `tenants.js` | `/api/tenants` | Tenants screen + tenant profile drawer |
| `payments.js` | `/api/payments` | Recent payments table, mark-paid + auto commission |
| `agents.js` | `/api/agents` | Agents screen, commission tracker, remit checkbox |
| `shortlet.js` | `/api/shortlet` | Shortlet screen + listing drawer |
| `complaints.js` | `/api/complaints` | Complaints/enquiries in the tenant drawer |

## What's intentionally not built yet

- **Login/authentication** — right now every route is open, no password
  check. We'll add this once the core data flow works.
- **Paystack integration** — `payments.js` has a `mark-paid` endpoint ready
  for a webhook to call, but the actual Paystack connection isn't wired up.
- **Role-based access for agents** — the database and privileges are
  designed for it (agents can't see other agents' commissions, can't edit
  rent), but the backend doesn't enforce that yet — that comes with login.

## If something breaks

- `ECONNREFUSED` or connection errors → double check `DATABASE_URL` in
  `.env` matches exactly what Railway shows you.
- `relation "properties" does not exist` → the schema didn't run — repeat
  Step 1.
- Nothing happens when you visit localhost → check the terminal for an
  error message from `npm run dev`, and share it and I'll help debug.
