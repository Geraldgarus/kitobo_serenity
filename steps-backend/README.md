# 🏨 Steps Premium Suite – Backend Setup

This guide connects your Steps PMS frontend to a **PostgreSQL database** via a Node.js/Express REST API.

---

## File Structure

```
steps-pms-backend/
├── db/
│   ├── schema.sql       ← Create tables + seed data
│   └── pool.js          ← PostgreSQL connection pool
├── public/
│   ├── js/app.js        ← NEW frontend JS (replaces old app.js)
│   └── css/style.css    ← Your existing stylesheet (copy here)
├── server.js            ← Express API server
├── package.json
├── .env.example         ← Copy to .env and fill in your DB credentials
└── README.md
```

---

## Step 1 — Prerequisites

- **Node.js** v18+ — https://nodejs.org
- **PostgreSQL** v14+ — https://www.postgresql.org/download/

---

## Step 2 — Create the Database

Open psql (or pgAdmin) and run:

```sql
CREATE DATABASE steps_pms;
```

Then apply the schema:

```bash
psql -U postgres -d steps_pms -f db/schema.sql
```

This creates the `apartments` and `reservations` tables and seeds your initial data.

---

## Step 3 — Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/steps_pms
PORT=3000
CORS_ORIGIN=*
```

---

## Step 4 — Install & Run

```bash
npm install
npm start
```

You should see:
```
✅ Steps PMS API running on http://localhost:3000
```

Test it:
```
http://localhost:3000/api/health      → { "status": "ok", "database": "connected" }
http://localhost:3000/api/apartments  → JSON list of 6 apartments
http://localhost:3000/api/reservations → JSON list of reservations
```

---

## Step 5 — Connect the Frontend

1. Copy your existing `index.html` into the `public/` folder
2. Replace the old `<script src="js/app.js">` with the new one (already in `public/js/app.js`)
3. Copy your `css/style.css` into `public/css/`
4. Open `http://localhost:3000` — the app now reads and writes to PostgreSQL!

> If your frontend is served separately (e.g. live-server on port 5500), update `API_BASE` at the top of `app.js`:
> ```js
> const API_BASE = 'http://localhost:3000/api';
> ```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | DB connection check |
| GET | `/api/apartments` | All apartments + occupied status |
| PUT | `/api/apartments/:id` | Update apartment details/rate |
| GET | `/api/reservations` | All reservations (filter: `?aptId=&from=&to=`) |
| GET | `/api/reservations/:id` | Single reservation |
| POST | `/api/reservations` | Create reservation |
| PUT | `/api/reservations/:id` | Update reservation |
| DELETE | `/api/reservations/:id` | Delete reservation |
| GET | `/api/reports/summary` | Revenue + occupancy summary (filter: `?from=&to=`) |

---

## Deployment Options (Free Tiers)

### Render.com (Recommended)
1. Push this folder to GitHub
2. Create a **Web Service** pointing to `server.js`
3. Add a **PostgreSQL** database — Render gives you the `DATABASE_URL`
4. Set environment variables in the Render dashboard

### Railway.app
1. Create a new project → Add PostgreSQL
2. Deploy from GitHub
3. Set `DATABASE_URL` from the Railway-provided connection string

### Supabase (PostgreSQL only)
1. Create a project at supabase.com
2. Run `schema.sql` in the Supabase SQL editor
3. Use the connection string from Settings → Database
4. Add `ssl: { rejectUnauthorized: false }` to `db/pool.js`

---

## Development

```bash
npm install --save-dev nodemon
npm run dev    # auto-restarts server on file changes
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ECONNREFUSED` on DB | Check PostgreSQL is running: `pg_ctl status` |
| `password authentication failed` | Check `DATABASE_URL` in `.env` |
| CORS error in browser | Set `CORS_ORIGIN=*` or your frontend's URL |
| `relation does not exist` | Run `schema.sql` against the correct database |
| Port 3000 in use | Change `PORT=3001` in `.env` and update `API_BASE` in `app.js` |
