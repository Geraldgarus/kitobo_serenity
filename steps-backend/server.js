// server.js – Steps Premium Suite API
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const bcrypt  = require('bcrypt');
const dns     = require('dns').promises;

const pool    = require('./db/pool');

// Add this function AFTER the pool is created
async function ensurePaymentColumns() {
  try {
    console.log('🔧 Checking required columns...');
    await pool.query(`
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'unpaid';
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_date TIMESTAMP;
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS amount_paid INT DEFAULT 0;
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS balance INT DEFAULT 0;
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS checkout_time TIME DEFAULT '11:00:00';
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS identification VARCHAR(100);
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS id_type VARCHAR(50) DEFAULT 'NIDA';
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS price_per_night INT DEFAULT 0;
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS rate_type VARCHAR(50) DEFAULT 'Bed and Breakfast';
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS booked_by VARCHAR(100) DEFAULT 'system';
    `);
    await pool.query(`
      ALTER TABLE apartments ADD COLUMN IF NOT EXISTS under_maintenance BOOLEAN DEFAULT FALSE;
      ALTER TABLE apartments ADD COLUMN IF NOT EXISTS rate_per_night INT DEFAULT 90000;
    `);
    await pool.query(`
      ALTER TABLE store_items ADD COLUMN IF NOT EXISTS pos VARCHAR(50);
      ALTER TABLE store_items ADD COLUMN IF NOT EXISTS item_type VARCHAR(50);
      UPDATE store_items SET item_type = pos WHERE item_type IS NULL AND pos IS NOT NULL;
    `);
    await pool.query(`
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS pos_type VARCHAR(50);
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'Cash';
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS waiter_name VARCHAR(200);
    `);
    await pool.query(`
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'other';
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(200) NOT NULL,
        type       VARCHAR(20) NOT NULL DEFAULT 'store',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(name, type)
      )
    `);
    const seedCategories = {
      store:           ['Beer', 'Gins', 'Wine', 'Whisky', 'Spirits', 'Soft Drinks', 'Kitchen', 'Housekeeping'],
      bar:             ['Beer', 'Gins', 'Wine', 'Whisky', 'Spirits', 'Cocktails', 'Mocktails', 'Soft Drinks', 'Fresh Juice', 'Water', 'Other'],
      restaurant:      ['Soup', 'Salad', 'Stew', 'Vegetables', 'Burger and Sandwiches', 'Side Dishes', 'Dessert', 'Pasta', 'Snacks and Bites', 'Fresh Drinks'],
      maintenance:     ['HVAC', 'Carpenter', 'Painter', 'Welder', 'Electrician', 'Plumber', 'Mason', 'Gardener', 'Furniture', 'Appliance', 'Building', 'Other'],
      expense:         ['Water', 'Electricity', 'Internet', 'Salary', 'Maintenance', 'Office Supplies', 'Marketing and Advertising', 'Other'],
      purchase_order:  ['bar', 'kitchen', 'housekeeping', 'other'],
    };
    for (const [type, names] of Object.entries(seedCategories)) {
      for (const name of names) {
        await pool.query(
          'INSERT INTO categories (name, type) VALUES ($1, $2) ON CONFLICT (name, type) DO NOTHING',
          [name, type]
        );
      }
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(200) NOT NULL,
        ingredients  TEXT,
        price        INT NOT NULL DEFAULT 0,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'General';
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS laundry_services (
        id               SERIAL PRIMARY KEY,
        room_number      VARCHAR(50)  NOT NULL,
        clothes_type     VARCHAR(200),
        services         TEXT,
        service_date     DATE         NOT NULL DEFAULT CURRENT_DATE,
        housekeeper_name VARCHAR(200) NOT NULL,
        price            DECIMAL(10,2) DEFAULT 0,
        payment_method   VARCHAR(50),
        payment_status   VARCHAR(20)  DEFAULT 'pending',
        amount_paid      DECIMAL(10,2) DEFAULT 0,
        notes            TEXT,
        created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      ALTER TABLE laundry_services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id         SERIAL PRIMARY KEY,
        role       VARCHAR(50)  NOT NULL,
        page_key   VARCHAR(100) NOT NULL,
        allowed    BOOLEAN      DEFAULT true,
        UNIQUE(role, page_key)
      )
    `);
    console.log('✅ Required columns verified');
  } catch (err) {
    console.log('⚠️ Column check:', err.message);
  }
}

const app     = express();
const PORT    = process.env.PORT || 3000;


// ============================================================
// AUTO DATABASE SETUP - Runs on startup
// ============================================================
async function setupDatabase() {
  console.log('🔄 Checking database setup...');
  
  if (!process.env.DATABASE_URL) {
    console.log('⚠️ DATABASE_URL not set. Skipping auto-migration.');
    return;
  }
  
  try {
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schema);
      console.log('✅ Database tables are ready!');
    } else {
      console.log('⚠️ schema.sql not found at:', schemaPath);
    }
  } catch (err) {
    console.log('⚠️ Database setup note:', err.message);
  }
}

// ============================================================
// ACTIVITY LOGGER FUNCTION
// ============================================================
async function logActivity(userId, username, action, entityType, entityId, oldData = null, newData = null, req = null) {
  try {
    const ipAddress = req ? req.ip || req.connection?.remoteAddress || null : null;
    const userAgent = req ? req.headers['user-agent'] : null;
    
    await pool.query(
      `INSERT INTO activity_logs (user_id, username, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId || null, username || 'system', action, entityType, entityId, 
       oldData ? JSON.stringify(oldData) : null, 
       newData ? JSON.stringify(newData) : null, 
       ipAddress, userAgent]
    );
    console.log(`✅ Activity logged: ${action} ${entityType} #${entityId} by ${username || 'system'}`);
  } catch (err) {
    console.error('Failed to log activity:', err.message);
  }
}

// ============================================================
// MIDDLEWARE
// ============================================================
const allowedOrigins = [
  'https://www.kitoboserenityresortpms.com',
  'https://kitoboserenityresortpms.com'
];
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// ============================================================
// JWT AUTHENTICATION MIDDLEWARE - Protects ALL API routes
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-this';

// Middleware to protect API routes
function protectAPI(req, res, next) {
  // Skip authentication for login and register
  if (req.path === '/auth/login' || req.path === '/auth/register' || req.path === '/auth/validate-email' || req.path.startsWith('/booking/')) {
    return next();
  }
  
  // Get token from header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token. Please login again.' });
  }
}

// Apply protection to ALL /api routes
app.use('/api', protectAPI);

// ============================================================
// CLEAN URLS - Access pages without .html extension
// ============================================================
const pages = [
  'dashboard', 'dashboard1', 'reservations', 'rooms',
  'rooms-list', 'housekeeping', 'housekeeping-status', 'reports',
  'store-main', 'store-main1', 'store-outlets', 'store-outlets1', 'outlet-store', 'outlet-store1',
  'store-housekeeping', 'store-kitchen', 'store-public', 'users', 'users1',
  'activity-logs', 'register', 'back-office', 'index2', 'purchase-orders', 'goods-receipt',
  'purchase-orders-reports', 'goods-receipt-reports', 'store-inventory-reports', 
  'point-of-sale', 'bar', 'restaurant', 'sales-report',  'staff-activities', 'staff-activities-report','add-reservation','guest-database','maintenance','daily-activities', 'expenditures', 'expenses', 'expenses-report', 'profit-report', 'daily-activities-report','financial-report',  'maintenance-report', 'housekeeping-report', 'permissions', 'booking',
  'store-categories', 'bar-menu-categories', 'restaurant-menu-categories',
  'maintenance-repair-types', 'expense-categories', 'purchase-order-categories'
];

// Create routes for each page without .html extension
pages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', `${page}.html`));
  });
});

// Login page served from public/index.html
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Redirect root to login
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Public Booking Engine ─────────────────────────────────────────────────────

// GET /api/booking/rooms?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD
app.get('/api/booking/rooms', async (req, res) => {
  const { checkin, checkout } = req.query;
  try {
    let query, params;
    if (checkin && checkout) {
      query = `
        SELECT a.*,
          NOT EXISTS (
            SELECT 1 FROM reservations r
            WHERE r.apt_id = a.id
              AND r.checkin  < $2::date
              AND r.checkout > $1::date
          ) AS available
        FROM apartments a
        ORDER BY a.type, a.name
      `;
      params = [checkin, checkout];
    } else {
      query = `
        SELECT a.*,
          NOT EXISTS (
            SELECT 1 FROM reservations r
            WHERE r.apt_id = a.id
              AND r.checkin  <= CURRENT_DATE
              AND r.checkout >  CURRENT_DATE
          ) AS available
        FROM apartments a
        ORDER BY a.type, a.name
      `;
      params = [];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/booking/create  — public, inserts directly into reservations
app.post('/api/booking/create', async (req, res) => {
  const {
    apt_id, checkin, checkout, adults, children,
    guest, email, mobile, national_id, id_type, country, city,
    rate_type, total, amount_paid, payment_method, payment_status
  } = req.body;
  const identification = national_id || null;
  const balance = Math.max(0, (total || 0) - (amount_paid || 0));

  if (!apt_id || !checkin || !checkout || !guest || !mobile) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Re-check availability to prevent double-booking
    const { rows: conflict } = await pool.query(`
      SELECT id FROM reservations
      WHERE apt_id = $1 AND checkin < $3::date AND checkout > $2::date
    `, [apt_id, checkin, checkout]);
    if (conflict.length > 0) {
      return res.status(409).json({ error: 'Room is no longer available for the selected dates. Please choose different dates.' });
    }

    const { rows } = await pool.query(`
      INSERT INTO reservations
        (apt_id, checkin, checkout, adults, children,
         guest, email, mobile, identification, id_type, country, city,
         rate_type, total, amount_paid, balance, payment_method, payment_status, booked_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'website')
      RETURNING id
    `, [
      apt_id, checkin, checkout,
      adults || 1, children || 0,
      guest, email, mobile,
      identification, id_type || 'NIDA',
      country || null, city || null,
      rate_type || 'Bed & Breakfast',
      total || 0, amount_paid || 0, balance,
      payment_method || 'Pending', payment_status || 'unpaid'
    ]);

    const reservationId = rows[0].id;
    const refNo = `KSR-${String(reservationId).padStart(5, '0')}`;

    // Send email notification via Formspree (non-blocking)
    const formspreeUrl = process.env.FORMSPREE_URL;
    if (formspreeUrl && !formspreeUrl.includes('YOUR_FORM_ID')) {
      fetch(formspreeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          _subject: `New Booking ${refNo} – ${guest}`,
          _replyto: email,
          'Booking Reference': refNo,
          'Guest Name':        guest,
          'Email':             email,
          'Mobile':            mobile,
          'Room ID':           apt_id,
          'Check-in':          checkin,
          'Check-out':         checkout,
          'Nights':            Math.round((new Date(checkout) - new Date(checkin)) / 86400000),
          'Adults':            adults || 1,
          'Children':          children || 0,
          'Rate Type':         rate_type || 'Bed & Breakfast',
          'Total Amount':      `TSh ${(total || 0).toLocaleString()}`,
          'Amount Paid':       `TSh ${(amount_paid || 0).toLocaleString()}`,
          'Balance Due':       `TSh ${balance.toLocaleString()}`,
          'Payment Method':    payment_method || 'Pending',
          'Payment Status':    payment_status || 'unpaid',
          'National ID':       identification || '—',
          'Country':           country || '—',
          'City':              city || '—',
          'Booked Via':        'Website Booking Engine',
        })
      }).catch(err => console.error('Formspree notification failed:', err.message));
    }

    res.json({ success: true, reservationId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Room Inquiry — public, sends email notification ──────────────────────────
app.post('/api/booking/inquiry', async (req, res) => {
  const { name, email, phone, checkin, checkout, adults, children, room_type, rate_type, message } = req.body;

  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'Name, email, and phone number are required' });
  }

  console.log('📧 New Room Inquiry:', { name, email, phone, room_type, checkin, checkout });

  // Send notification via Formspree (non-blocking)
  const formspreeUrl = process.env.FORMSPREE_URL;
  if (formspreeUrl && !formspreeUrl.includes('YOUR_FORM_ID')) {
    fetch(formspreeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        _subject:                     `Room Inquiry from ${name} – Kitobo Serenity Resort`,
        _replyto:                     email,
        'Guest Name':                 name,
        'Email':                      email,
        'Phone':                      phone,
        'Preferred Check-in':         checkin  || 'Not specified',
        'Preferred Check-out':        checkout || 'Not specified',
        'Adults':                     adults   || 1,
        'Children':                   children || 0,
        'Room Type':                  room_type  || 'Not specified',
        'Rate Type':                  rate_type  || 'Not specified',
        'Message / Special Requests': message  || '—',
        'Source':                     'Website Inquiry Form',
      })
    }).catch(err => console.error('Formspree inquiry failed:', err.message));
  }

  res.json({ success: true });
});

// ── Email domain validation (no auth required) ───────────────────────────────
app.get('/api/auth/validate-email', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.json({ valid: false, reason: 'No email provided' });

  const fmt = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!fmt.test(email)) return res.json({ valid: false, reason: 'Invalid email format' });

  const domain = email.split('@')[1].toLowerCase();

  // Common typos / obviously fake domains
  const blocklist = ['example.com', 'test.com', 'fake.com', 'invalid.com', 'noemail.com'];
  if (blocklist.includes(domain)) return res.json({ valid: false, reason: 'Email domain is not accepted' });

  try {
    const records = await dns.resolveMx(domain);
    if (records && records.length > 0) {
      res.json({ valid: true });
    } else {
      res.json({ valid: false, reason: 'Email domain has no mail servers' });
    }
  } catch {
    res.json({ valid: false, reason: 'Email domain does not exist' });
  }
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  APARTMENTS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/apartments – list all apartments with today's occupancy status
app.get('/api/apartments', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        a.*,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM reservations r
            WHERE r.apt_id = a.id
              AND r.checkin  <= CURRENT_DATE
              AND r.checkout  > CURRENT_DATE
          ) THEN TRUE ELSE FALSE
        END AS occupied
      FROM apartments a
      ORDER BY a.id
    `);
    res.json(rows.map(camelApt));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/apartments/:id
app.get('/api/apartments/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM apartments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Apartment not found' });
    res.json(camelApt(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/apartments/:id – update rate or details
app.put('/api/apartments/:id', async (req, res) => {
  const { name, type, maxAdults, emoji, color, ratePerNight } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE apartments
        SET name           = COALESCE($1, name),
            type           = COALESCE($2, type),
            max_adults     = COALESCE($3, max_adults),
            emoji          = COALESCE($4, emoji),
            color          = COALESCE($5, color),
            rate_per_night = COALESCE($6, rate_per_night)
      WHERE id = $7
      RETURNING *
    `, [name, type, maxAdults, emoji, color, ratePerNight, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Apartment not found' });
    res.json(camelApt(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/apartments – create new apartment
app.post('/api/apartments', async (req, res) => {
  const { name, type, maxAdults, emoji, color } = req.body;
  if (!name || !type || !maxAdults) {
    return res.status(400).json({ error: 'Name, type, and maxAdults are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO apartments (name, type, max_adults, emoji, color, rate_per_night)
       VALUES ($1, $2, $3, $4, $5, 0)
       RETURNING *`,
      [name, type, maxAdults, emoji || '', color || '#2d9c6e']
    );
    res.status(201).json(camelApt(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/apartments/:id – delete apartment
app.delete('/api/apartments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // First check if any reservations exist for this apartment
    const { rowCount: resCount } = await pool.query('SELECT id FROM reservations WHERE apt_id = $1 LIMIT 1', [id]);
    if (resCount > 0) {
      return res.status(400).json({ error: 'Cannot delete apartment with existing reservations. Remove reservations first.' });
    }
    const { rowCount } = await pool.query('DELETE FROM apartments WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Apartment not found' });
    res.json({ message: 'Apartment deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/apartments/maintenance – list rooms currently under maintenance
app.get('/api/apartments/maintenance', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM apartments WHERE under_maintenance = TRUE ORDER BY name`
    );
    res.json(rows.map(camelApt));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/apartments/:id/maintenance – set or clear maintenance flag
app.put('/api/apartments/:id/maintenance', async (req, res) => {
  const { id } = req.params;
  const { under_maintenance } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE apartments SET under_maintenance = $1 WHERE id = $2 RETURNING *`,
      [under_maintenance === true || under_maintenance === 'true', id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Apartment not found' });
    res.json(camelApt(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  RESERVATIONS - FIXED DATE HANDLING
// ════════════════════════════════════════════════════════════════════════════

// GET /api/reservations – with checkout time info
// ============================================================
// RESERVATIONS API WITH PAYMENT FIELDS
// ============================================================

// GET /api/reservations – list all reservations with payment info
app.get('/api/reservations', async (req, res) => {
  const { aptId, from, to } = req.query;
  const conditions = [];
  const values     = [];

  if (aptId) { values.push(aptId); conditions.push(`r.apt_id = $${values.length}`); }
  if (from)  { values.push(from);  conditions.push(`r.checkout + COALESCE(r.checkout_time, '11:00:00') > $${values.length}::timestamp`); }
  if (to)    { values.push(to);    conditions.push(`r.checkin <= $${values.length}::date`); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const { rows } = await pool.query(`
      SELECT 
        r.*, 
        a.name AS apt_name, 
        a.type AS apt_type, 
        a.emoji AS apt_emoji, 
        a.color AS apt_color,
        TO_CHAR(r.checkin, 'YYYY-MM-DD') as checkin_str,
        TO_CHAR(r.checkout, 'YYYY-MM-DD') as checkout_str,
        TO_CHAR(r.checkout_time, 'HH24:MI:SS') as checkout_time_str,
        r.identification,
        r.id_type,
        r.payment_status,
        r.payment_method,
        r.amount_paid,
        r.balance,
        CASE 
          WHEN (r.checkout + COALESCE(r.checkout_time, '11:00:00')) <= CURRENT_TIMESTAMP THEN 'checked_out'
          WHEN r.checkin <= CURRENT_DATE THEN 'active'
          ELSE 'upcoming'
        END as current_status
      FROM reservations r
      JOIN apartments a ON a.id = r.apt_id
      ${where}
      ORDER BY r.checkin DESC
    `, values);
    
    const formattedRows = rows.map(row => ({
      ...row,
      checkin: row.checkin_str,
      checkout: row.checkout_str,
      checkoutTime: row.checkout_time_str || '11:00:00',
      currentStatus: row.current_status,
      identification: row.identification,
      idType: row.id_type,
      paymentStatus: row.payment_status,
      paymentMethod: row.payment_method,
      amountPaid: row.amount_paid,
      balance: row.balance
    }));
    
    res.json(formattedRows.map(camelRes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reservations/:id – get single reservation with payment info
app.get('/api/reservations/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        r.*, 
        a.name AS apt_name, 
        a.type AS apt_type, 
        a.emoji AS apt_emoji, 
        a.color AS apt_color,
        TO_CHAR(r.checkin, 'YYYY-MM-DD') as checkin_str,
        TO_CHAR(r.checkout, 'YYYY-MM-DD') as checkout_str,
        r.identification,
        r.id_type,
        r.payment_status,
        r.payment_method,
        r.amount_paid,
        r.balance
      FROM reservations r
      JOIN apartments a ON a.id = r.apt_id
      WHERE r.id = $1
    `, [req.params.id]);
    
    if (!rows.length) return res.status(404).json({ error: 'Reservation not found' });
    
    const row = rows[0];
    const formattedRow = {
      ...row,
      checkin: row.checkin_str,
      checkout: row.checkout_str,
      identification: row.identification,
      idType: row.id_type,
      price_per_night: row.price_per_night,
      paymentStatus: row.payment_status,
      paymentMethod: row.payment_method,
      amountPaid: row.amount_paid,
      balance: row.balance
    };
    
    res.json(camelRes(formattedRow));
  } catch (err) {
    console.error('Error in GET /api/reservations/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reservations – create new reservation with payment fields
app.post('/api/reservations', async (req, res) => {
  let { aptId, guest, email, mobile, country, city, checkin, checkout, adults, children, rateType, total, pricePerNight, checkoutTime, userId, username, identification, idType, paymentMethod, paymentStatus, amountPaid } = req.body;

  // CRITICAL FIX: Ensure dates are pure YYYY-MM-DD strings
  if (checkin) checkin = String(checkin).split('T')[0];
  if (checkout) checkout = String(checkout).split('T')[0];
  
  // Set default checkout time to 11:00 AM if not provided
  const finalCheckoutTime = checkoutTime || '11:00:00';
  
  // Calculate payment fields
  const finalAmountPaid = amountPaid || 0;
  const balance = (total || 0) - finalAmountPaid;
  const finalPaymentStatus = paymentStatus || (balance <= 0 ? 'paid' : (finalAmountPaid > 0 ? 'partial' : 'unpaid'));
  
  console.log('📅 Creating reservation:', { checkin, checkout, total, paymentStatus: finalPaymentStatus, balance });

  // Basic validation
  if (!aptId || !guest || !checkin || !checkout) {
    return res.status(400).json({ error: 'aptId, guest, checkin, checkout are required' });
  }
  if (checkin >= checkout) {
    return res.status(400).json({ error: 'checkout must be after checkin' });
  }

  try {
    // Check for conflicting reservation in same apartment
    const conflict = await pool.query(`
      SELECT id FROM reservations
      WHERE apt_id = $1
        AND checkin < $3::date
        AND (checkout + COALESCE(checkout_time, '11:00:00')) > ($2::date + $4::time)
    `, [aptId, checkin, checkout, finalCheckoutTime]);

    if (conflict.rows.length) {
      return res.status(409).json({ error: 'Room is already booked for those dates' });
    }

    const bookedByName = username || req.body.username || req.body.created_by || 'system';

    const { rows } = await pool.query(`
      INSERT INTO reservations (
        apt_id, guest, email, mobile, country, city, checkin, checkout, checkout_time,
        adults, children, rate_type, total, price_per_night, identification, id_type,
        payment_status, payment_method, amount_paid, balance, booked_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9::time,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *
    `, [
      aptId, guest, email, mobile || null, country || null, city || null,
      checkin, checkout, finalCheckoutTime, adults || 1, children || 0,
      rateType || 'Full', total || 0, pricePerNight || 0, identification || null, idType || null,
      finalPaymentStatus, paymentMethod || null, finalAmountPaid, balance, bookedByName
    ]);

    const result = camelRes(rows[0]);
    
    // ========== LOG ACTIVITY ==========
    const loggedInUserId = userId || req.body.userId || null;
    const loggedInUsername = username || req.body.username || req.body.created_by || guest || 'system';
    await logActivity(loggedInUserId, loggedInUsername, 'CREATE', 'reservation', result.id, null, result, req);
    
    console.log('✅ Reservation created:', result.id, 'Payment:', finalPaymentStatus, 'Balance:', balance);
    res.status(201).json(result);
  } catch (err) {
    console.error('❌ Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/reservations/:id – update reservation with payment fields
app.put('/api/reservations/:id', async (req, res) => {
  let { aptId, guest, email, mobile, country, city, checkin, checkout, adults, children, rateType, total, pricePerNight, userId, username, identification, idType, paymentMethod, paymentStatus, amountPaid } = req.body;
  
  // CRITICAL FIX: Ensure dates are pure YYYY-MM-DD strings
  if (checkin) checkin = String(checkin).split('T')[0];
  if (checkout) checkout = String(checkout).split('T')[0];

  try {
    // Get old data BEFORE update for logging
    const oldDataResult = await pool.query('SELECT * FROM reservations WHERE id = $1', [req.params.id]);
    if (oldDataResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    const oldData = oldDataResult.rows[0];
    
    // Calculate new payment values
    const newTotal = total || oldData.total;
    const newAmountPaid = amountPaid !== undefined ? amountPaid : oldData.amount_paid;
    const newBalance = newTotal - newAmountPaid;
    const newPaymentStatus = paymentStatus || (newBalance <= 0 ? 'paid' : (newAmountPaid > 0 ? 'partial' : 'unpaid'));
    
    // Conflict check excluding current reservation
    if (aptId && checkin && checkout) {
      const conflict = await pool.query(`
        SELECT id FROM reservations
        WHERE apt_id = $1
          AND id != $4
          AND checkin < $3::date
          AND checkout > $2::date
      `, [aptId, checkin, checkout, req.params.id]);

      if (conflict.rows.length) {
        return res.status(409).json({ error: 'Room is already booked for those dates' });
      }
    }

    const { rows } = await pool.query(`
      UPDATE reservations SET
        apt_id    = COALESCE($1, apt_id),
        guest     = COALESCE($2, guest),
        email     = COALESCE($3, email),
        mobile    = COALESCE($4, mobile),
        country   = COALESCE($5, country),
        city      = COALESCE($6, city),
        checkin   = COALESCE($7::date, checkin),
        checkout  = COALESCE($8::date, checkout),
        adults    = COALESCE($9, adults),
        children  = COALESCE($10, children),
        rate_type = COALESCE($11, rate_type),
        total     = COALESCE($12, total),
        price_per_night = COALESCE($13, price_per_night),
        identification = COALESCE($14, identification),
        id_type   = COALESCE($15, id_type),
        payment_method = COALESCE($16, payment_method),
        payment_status = COALESCE($17, payment_status),
        amount_paid = COALESCE($18, amount_paid),
        balance   = COALESCE($19, balance)
      WHERE id = $20
      RETURNING *
    `, [
      aptId, guest, email, mobile, country, city, checkin, checkout,
      adults, children, rateType, total, pricePerNight || null, identification, idType,
      paymentMethod, newPaymentStatus, newAmountPaid, newBalance, req.params.id
    ]);

    if (!rows.length) return res.status(404).json({ error: 'Reservation not found' });
    
    const newData = rows[0];
    
    // ========== LOG ACTIVITY ==========
    const loggedInUserId = userId || req.body.userId;
    const loggedInUsername = username || req.body.username || 'system';
    await logActivity(loggedInUserId, loggedInUsername, 'UPDATE', 'reservation', req.params.id, oldData, newData, req);
    
    res.json(camelRes(newData));
  } catch (err) {
    console.error('Error updating reservation:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/reservations/:id – delete reservation
app.delete('/api/reservations/:id', async (req, res) => {
  try {
    // Get data before delete for logging
    const oldDataResult = await pool.query('SELECT * FROM reservations WHERE id = $1', [req.params.id]);
    const oldData = oldDataResult.rows[0];
    
    const { rowCount } = await pool.query('DELETE FROM reservations WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Reservation not found' });
    
    // LOG ACTIVITY
    if (oldData) {
      const userId = req.body.userId || null;
      const username = req.body.username || 'system';
      await logActivity(userId, username, 'DELETE', 'reservation', req.params.id, oldData, null, req);
    }
    
    res.json({ message: 'Reservation deleted' });
  } catch (err) {
    console.error('Error deleting reservation:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  REPORTS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/reports/summary?from=&to=
// Counts and revenue are attributed to booking date (created_at), not stay dates.
app.get('/api/reports/summary', async (req, res) => {
  const { from, to } = req.query;
  const conditions = [];
  const values     = [];
  if (from) { values.push(from); conditions.push(`r.created_at::date >= $${values.length}::date`); }
  if (to)   { values.push(to);   conditions.push(`r.created_at::date <= $${values.length}::date`); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const { rows: summary } = await pool.query(`
      SELECT
        COUNT(*)::int                                        AS total_reservations,
        COALESCE(SUM(total), 0)::int                         AS total_revenue,
        COALESCE(AVG(checkout - checkin), 0)::numeric(6,2)  AS avg_stay_nights,
        COALESCE(SUM(checkout - checkin), 0)::int            AS total_nights
      FROM reservations r
      ${where}
    `, values);

    const { rows: byApt } = await pool.query(`
      SELECT
        a.id, a.name, a.type, a.color, a.emoji, a.rate_per_night,
        COUNT(r.id)::int                                     AS bookings,
        COALESCE(SUM(r.checkout - r.checkin), 0)::int        AS nights,
        COALESCE(SUM(r.total), 0)::int                       AS revenue
      FROM apartments a
      LEFT JOIN reservations r ON r.apt_id = a.id
        ${conditions.length ? 'AND ' + conditions.join(' AND ') : ''}
      GROUP BY a.id
      ORDER BY a.id
    `, values);

    res.json({
      summary: {
        totalReservations: summary[0].total_reservations,
        totalRevenue:      summary[0].total_revenue,
        avgStayNights:     parseFloat(summary[0].avg_stay_nights),
        totalNights:       summary[0].total_nights,
      },
      byApartment: byApt.map(r => ({
        id:           r.id,
        name:         r.name,
        type:         r.type,
        color:        r.color,
        emoji:        r.emoji,
        ratePerNight: r.rate_per_night,
        bookings:     r.bookings,
        nights:       r.nights,
        revenue:      r.revenue,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/reservations?from=&to=
// Revenue is attributed to booking date (created_at), NOT spread across stay nights
app.get('/api/reports/reservations', async (req, res) => {
  const { from, to } = req.query;
  let query = `
    SELECT
      r.id, r.guest, r.email, r.mobile,
      TO_CHAR(r.checkin, 'YYYY-MM-DD')   AS checkin,
      TO_CHAR(r.checkout, 'YYYY-MM-DD')  AS checkout,
      (r.checkout - r.checkin)            AS nights,
      r.total, r.amount_paid, r.balance,
      r.payment_method, r.payment_status,
      r.booked_by,
      TO_CHAR(r.created_at, 'YYYY-MM-DD HH24:MI') AS booked_at,
      a.name AS room_name, a.type AS room_type
    FROM reservations r
    LEFT JOIN apartments a ON a.id = r.apt_id
    WHERE 1=1
  `;
  const params = [];
  let p = 1;
  // Stay-date overlap: a reservation counts if its checkin..checkout range
  // overlaps the filter range, so e.g. a 2-4 Jul stay is included when filtering 3-4 Jul.
  if (from) { query += ` AND r.checkout >= $${p++}::date`; params.push(from); }
  if (to)   { query += ` AND r.checkin <= $${p++}::date`; params.push(to); }
  query += ` ORDER BY r.created_at DESC`;

  try {
    const { rows } = await pool.query(query, params);
    res.json(rows.map(row => ({
      id:            row.id,
      guest:         row.guest,
      email:         row.email,
      mobile:        row.mobile,
      room:          row.room_name,
      roomType:      row.room_type,
      checkin:       row.checkin,
      checkout:      row.checkout,
      nights:        parseInt(row.nights) || 0,
      total:         parseInt(row.total) || 0,
      amountPaid:    parseInt(row.amount_paid) || 0,
      balance:       parseInt(row.balance) || 0,
      paymentMethod: row.payment_method || '—',
      paymentStatus: row.payment_status || 'unpaid',
      bookedBy:      row.booked_by || 'system',
      bookedAt:      row.booked_at,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  HELPERS – snake_case → camelCase (FIXED DATE HANDLING)
// ════════════════════════════════════════════════════════════════════════════

function camelApt(r) {
  return {
    id:               r.id,
    name:             r.name,
    type:             r.type,
    maxAdults:        r.max_adults,
    emoji:            r.emoji,
    color:            r.color,
    ratePerNight:     r.rate_per_night,
    occupied:         r.occupied ?? undefined,
    underMaintenance: r.under_maintenance ?? false,
  };
}

function camelRes(r) {
  // CRITICAL FIX: Return dates as-is without any conversion
  // They should already be YYYY-MM-DD strings from the query
  return {
    id:        r.id,
    aptId:     r.apt_id,
    guest:     r.guest,
    email:     r.email,
    mobile:    r.mobile,
    country:   r.country,
    city:      r.city,
    checkin:   r.checkin,   // Already formatted as YYYY-MM-DD
    checkout:  r.checkout,  // Already formatted as YYYY-MM-DD
    adults:    r.adults,
    children:  r.children,
    rateType:  r.rate_type,
    total:     r.total,
    createdAt: r.created_at,
    aptName:   r.apt_name  ?? undefined,
    aptType:   r.apt_type  ?? undefined,
    aptEmoji:  r.apt_emoji ?? undefined,
    aptColor:  r.apt_color ?? undefined,
    identification: r.identification ?? null,
    idType: r.id_type ?? null,
    pricePerNight: r.price_per_night ?? 0,
    // Payment fields
    paymentStatus: r.payment_status ?? 'unpaid',
    paymentMethod: r.payment_method ?? null,
    amountPaid: r.amount_paid ?? 0,
    balance: r.balance ?? 0
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  MAIN STORE API
// ════════════════════════════════════════════════════════════════════════════

// GET all main store items
app.get('/api/store/items', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM store_items ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST add item to main store
app.post('/api/store/items', async (req, res) => {
  const { name, category, cost, quantity, item_type } = req.body;
  if (!name || !category) {
    return res.status(400).json({ error: 'Name and category are required' });
  }
  const parts = quantity.trim().split(' ');
  const stock_value = parseFloat(parts[0]);
  const unit = parts[1] || 'units';
  try {
    const { rows } = await pool.query(
      `INSERT INTO store_items (name, category, cost, quantity, stock_value, unit, item_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, category, cost, quantity, stock_value, unit, item_type || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update main store item
app.put('/api/store/items/:id', async (req, res) => {
  const { name, category, cost, quantity, item_type } = req.body;
  const id = req.params.id;
  const parts = quantity.trim().split(' ');
  const stock_value = parseFloat(parts[0]);
  const unit = parts[1] || 'units';
  try {
    const { rows } = await pool.query(
      `UPDATE store_items SET name=$1, category=$2, cost=$3, quantity=$4, stock_value=$5, unit=$6, item_type=$7
       WHERE id=$8 RETURNING *`,
      [name, category, cost, quantity, stock_value, unit, item_type || null, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE main store item
app.delete('/api/store/items/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Remove linked sales_items records first to satisfy the foreign key constraint
    await client.query('DELETE FROM sales_items WHERE item_id = $1', [id]);
    const { rowCount } = await client.query('DELETE FROM store_items WHERE id = $1', [id]);
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }
    await client.query('COMMIT');
    res.json({ message: 'Item deleted' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// MENU ITEMS API (restaurant menu managed from main store)
// ============================================================
app.get('/api/menu-items', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM menu_items ORDER BY name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/menu-items', async (req, res) => {
  const { name, ingredients, price, category } = req.body;
  if (!name || price == null) return res.status(400).json({ error: 'name and price are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO menu_items (name, ingredients, price, category) VALUES ($1, $2, $3, $4) RETURNING *',
      [name.trim(), ingredients || null, parseInt(price) || 0, category || 'General']
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/menu-items/:id', async (req, res) => {
  const { name, ingredients, price, category } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE menu_items SET name=$1, ingredients=$2, price=$3, category=$4 WHERE id=$5 RETURNING *',
      [name.trim(), ingredients || null, parseInt(price) || 0, category || 'General', req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Menu item not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/menu-items/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM menu_items WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Menu item not found' });
    res.json({ message: 'Menu item deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// BAR MENU ITEMS API
// ============================================================
app.get('/api/bar-menu-items', async (req, res) => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS bar_menu_items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'Other',
      price INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    const { rows } = await pool.query('SELECT * FROM bar_menu_items ORDER BY category, name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/bar-menu-items', async (req, res) => {
  const { name, price, category } = req.body;
  if (!name || price == null) return res.status(400).json({ error: 'name and price are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO bar_menu_items (name, category, price) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), category || 'Other', parseInt(price) || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/bar-menu-items/:id', async (req, res) => {
  const { name, price, category } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE bar_menu_items SET name=$1, category=$2, price=$3 WHERE id=$4 RETURNING *',
      [name.trim(), category || 'Other', parseInt(price) || 0, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Bar menu item not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/bar-menu-items/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM bar_menu_items WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Bar menu item not found' });
    res.json({ message: 'Bar menu item deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// REQUESTS API (outlets request from main store)
// ============================================================

// GET all requests
app.get('/api/store/requests', async (req, res) => {
  const { status, outlet, from, to } = req.query;
  let query = 'SELECT * FROM store_requests WHERE 1=1';
  const params = [];
  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }
  if (outlet) {
    params.push(outlet);
    query += ` AND requested_by = $${params.length}`;
  }
  if (from) {
    params.push(from);
    query += ` AND DATE(COALESCE(approved_at, created_at)) >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    query += ` AND DATE(COALESCE(approved_at, created_at)) <= $${params.length}`;
  }
  query += ' ORDER BY created_at DESC';
  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create request from outlet
app.post('/api/store/requests', async (req, res) => {
  const { item_name, category, quantity_value, quantity_unit, requested_by } = req.body;
  if (!item_name || !category || !quantity_value || !quantity_unit || !requested_by) {
    return res.status(400).json({ error: 'All fields required' });
  }
  const addVal = parseFloat(quantity_value);
  if (isNaN(addVal) || addVal <= 0) return res.status(400).json({ error: 'Invalid quantity' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Merge with existing pending request for same item+outlet to avoid duplicates
    const { rows: existing } = await client.query(
      `SELECT * FROM store_requests WHERE LOWER(TRIM(item_name))=LOWER(TRIM($1)) AND requested_by=$2 AND status='pending' LIMIT 1`,
      [item_name, requested_by]
    );
    if (existing.length > 0) {
      const ex = existing[0];
      const exVal = parseFloat((ex.quantity || '0').split(' ')[0]) || 0;
      const newQty = `${exVal + addVal} ${quantity_unit}`;
      const { rows } = await client.query(
        `UPDATE store_requests SET quantity=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
        [newQty, ex.id]
      );
      await client.query('COMMIT');
      return res.status(200).json({ ...rows[0], merged: true });
    }
    const { rows } = await client.query(
      `INSERT INTO store_requests (item_name, category, quantity, cost, requested_by, status)
       VALUES ($1, $2, $3, 0, $4, 'pending') RETURNING *`,
      [item_name, category, `${addVal} ${quantity_unit}`, requested_by]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT approve request - SIMPLIFIED (no units needed)
// PUT approve request - MODIFIED to update existing outlet inventory
// PUT approve request - FIXED: Cost based on Main Store average cost
app.delete('/api/store/requests/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(`DELETE FROM store_requests WHERE id=$1 AND status='pending'`, [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Pending request not found' });
    res.json({ message: 'Request cancelled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/store/requests/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { authorizedQuantity } = req.body;
  
  if (!authorizedQuantity) {
    return res.status(400).json({ error: 'Authorized quantity required' });
  }
  
  const authValue = parseFloat(authorizedQuantity);
  if (isNaN(authValue) || authValue <= 0) {
    return res.status(400).json({ error: 'Please enter a valid positive number' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get the request
    const { rows: reqRows } = await client.query('SELECT * FROM store_requests WHERE id = $1 FOR UPDATE', [id]);
    if (reqRows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const request = reqRows[0];
    if (request.status !== 'pending') return res.status(400).json({ error: 'Request already processed' });
    
    // Get the unit from the request
    const reqParts = request.quantity.trim().split(' ');
    const unit = reqParts[1] || 'units';
    
    // Find item in main store
    const { rows: itemRows } = await client.query(
      `SELECT * FROM store_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) FOR UPDATE`,
      [request.item_name]
    );
    if (itemRows.length === 0) {
      return res.status(404).json({ error: `Item "${request.item_name}" not found in main store` });
    }
    const mainItem = itemRows[0];
    const mainParts = mainItem.quantity.trim().split(' ');
    const mainValue = parseFloat(mainParts[0]);
    const mainUnit = mainParts[1];
    
    // Check if units match
    if (mainUnit !== unit) {
      return res.status(400).json({ 
        error: `Unit mismatch. Main store uses ${mainUnit}. Please use the same unit.`,
        availableUnit: mainUnit
      });
    }
    
    if (mainValue < authValue) {
      return res.status(400).json({ 
        error: `Insufficient stock. Available: ${mainItem.quantity}, requested: ${authValue} ${unit}` 
      });
    }
    
    // Calculate cost based on MAIN STORE's current cost per unit
    // This ensures consistency across all transfers
    const costPerUnit = mainItem.cost;
    const calculatedCost = Math.round(costPerUnit * authValue);
    
    console.log('Cost calculation:', {
      item: request.item_name,
      mainStoreCostPerUnit: costPerUnit,
      quantity: authValue,
      totalCost: calculatedCost
    });
    
    // Deduct from main store
    const newValue = mainValue - authValue;
    const newQuantity = `${newValue} ${mainUnit}`;
    await client.query(
      'UPDATE store_items SET quantity = $1, stock_value = $2 WHERE id = $3',
      [newQuantity, newValue, mainItem.id]
    );
    
    const authorizedDisplay = `${authValue} ${unit}`;
    
    // Check if item already exists in outlet inventory
    const existingOutletItem = await client.query(
      `SELECT * FROM outlet_inventory WHERE outlet = $1 AND LOWER(TRIM(item_name)) = LOWER(TRIM($2)) FOR UPDATE`,
      [request.requested_by, request.item_name]
    );
    
    if (existingOutletItem.rows.length > 0) {
      // UPDATE EXISTING ITEM - add quantity and update cost using MAIN STORE cost
      const existingItem = existingOutletItem.rows[0];
      const existingParts = existingItem.quantity.split(' ');
      const existingQty = parseFloat(existingParts[0]);
      const existingTotalCost = existingItem.cost;
      const newTotalQty = existingQty + authValue;
      // Use the MAIN STORE cost per unit for consistency
      const newTotalCost = existingTotalCost + calculatedCost;
      const newQuantityStr = newTotalQty + ' ' + unit;
      
      await client.query(
        `UPDATE outlet_inventory 
         SET quantity = $1, cost = $2, unit = $3, source_request_id = $4, created_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [newQuantityStr, newTotalCost, unit, id, existingItem.id]
      );
    } else {
      // INSERT NEW ITEM
      await client.query(
        `INSERT INTO outlet_inventory (outlet, item_name, category, quantity, cost, unit, source_request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [request.requested_by, request.item_name, request.category, authorizedDisplay, calculatedCost, unit, id]
      );
    }
    
    // Update request
    await client.query(
      `UPDATE store_requests SET status = 'approved', approved_at = NOW(), authorized_quantity = $1, cost = $2 WHERE id = $3`,
      [authorizedDisplay, calculatedCost, id]
    );
    
    await client.query('COMMIT');
    res.json({ 
      message: 'Approved, stock deducted, item transferred',
      transferred: authorizedDisplay,
      newStock: newQuantity,
      costPerUnit: costPerUnit,
      totalCost: calculatedCost
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
app.put('/api/store/requests/:id/reject', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      `UPDATE store_requests SET status='rejected', approved_at=NOW() WHERE id=$1 AND status='pending'`,
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Request not found or already processed' });
    res.json({ message: 'Request rejected' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// OUTLET INVENTORY API
// ============================================================

// GET items for specific outlet
// GET items for specific outlet - GROUPED by item name
// ============================================================
// OUTLET INVENTORY API (FIXED)
// ============================================================

// GET items for specific outlet - GROUPED by item name
app.get('/api/outlet-inventory', async (req, res) => {
  const { outlet } = req.query;
  if (!outlet) {
    return res.status(400).json({ error: 'Outlet parameter required' });
  }
  try {
    const { rows } = await pool.query(`
      SELECT 
        item_name,
        category,
        COALESCE(unit, 'units') as unit,
        SUM(CAST(SPLIT_PART(quantity, ' ', 1) AS DECIMAL)) as total_quantity,
        SUM(cost) as total_cost,
        MAX(created_at) as last_received,
        array_agg(id) as item_ids,
        array_agg(quantity) as all_quantities
      FROM outlet_inventory 
      WHERE outlet = $1
      GROUP BY item_name, category, unit
      ORDER BY last_received DESC
    `, [outlet]);
    
    const formatted = rows.map(row => ({
      id: row.item_ids[0],
      item_name: row.item_name,
      category: row.category,
      unit: row.unit,
      quantity: row.total_quantity + ' ' + row.unit,
      cost: Math.round(row.total_cost),
      created_at: row.last_received,
      source_ids: row.item_ids,
      all_quantities: row.all_quantities
    }));
    
    res.json(formatted);
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE bulk items from outlet inventory
// DELETE /api/outlets/:id – delete an outlet
app.delete('/api/outlets/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // First check if outlet exists
    const outletCheck = await pool.query('SELECT id FROM outlets WHERE id = $1', [id]);
    if (outletCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Outlet not found' });
    }
    
    // Delete the outlet
    const { rowCount } = await pool.query('DELETE FROM outlets WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Outlet not found' });
    }
    
    res.json({ message: 'Outlet deleted successfully' });
  } catch (err) {
    console.error('Delete outlet error:', err);
    res.status(500).json({ error: err.message });
  }
});
// DELETE all outlet inventory items by outlet + item name
app.delete('/api/outlet-inventory/bulk/:outlet/:itemName', async (req, res) => {
  const { outlet, itemName } = req.params;
  try {
    await pool.query(
      `DELETE FROM outlet_inventory WHERE outlet=$1 AND LOWER(TRIM(item_name))=LOWER(TRIM($2))`,
      [outlet, itemName]
    );
    res.json({ message: 'Items deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE single item from outlet inventory
app.delete('/api/outlet-inventory/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM outlet_inventory WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Item not found' });
    res.json({ message: 'Item deleted successfully' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all outlets
app.get('/api/outlets', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM outlets ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create new outlet
app.post('/api/outlets', async (req, res) => {
  const { name } = req.body;
  if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
    return res.status(400).json({ error: 'Invalid outlet name. Use lowercase letters, numbers, underscores.' });
  }
  try {
    const { rows } = await pool.query('INSERT INTO outlets (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Outlet already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// AUTHENTICATION API
// ============================================================

// POST /api/auth/register – create a new user
app.post('/api/auth/register', async (req, res) => {
  const { fullName, email, password, role } = req.body;
  
  console.log('Registration attempt:', { fullName, email, role });
  
  if (!fullName || !email || !password || !role) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    // Check if user already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Generate username from email (before @)
    const username = email.split('@')[0];
    
    // Insert new user
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, username, email, role, full_name`,
      [username, email, hashedPassword, role, fullName]
    );
    
    console.log('User registered successfully:', result.rows[0]);
    res.status(201).json({
      message: 'User registered successfully',
      user: result.rows[0]
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});





// POST /api/auth/login – email and password only
// POST /api/auth/login – email and password only (RETURNS TOKEN)
// ============================================================
// ACCOUNT LOCKOUT - Brute Force Protection
// ============================================================


// Lockout settings
// ============================================================
// ACCOUNT LOCKOUT - Database Version (Persists after restart)
// ============================================================
// ============================================================
// ACCOUNT LOCKOUT - Memory Version (WORKING)
// ============================================================
// ============================================================
// ACCOUNT LOCKOUT - Combined Version (WORKS 100%)
// ============================================================
const failedAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Check if account is locked (from memory)
async function checkAccountLockout(email) {
  const record = failedAttempts.get(email);
  
  if (!record) return;
  
  if (record.count >= MAX_ATTEMPTS) {
    const timeElapsed = Date.now() - record.lockUntil;
    const lockoutMs = LOCKOUT_MINUTES * 60 * 1000;
    
    if (timeElapsed < lockoutMs) {
      const minutesLeft = Math.ceil((lockoutMs - timeElapsed) / 60000);
      throw new Error(`Account locked. Try again in ${minutesLeft} minutes.`);
    } else {
      failedAttempts.delete(email);
    }
  }
}

// Record failed attempt (memory + database)
async function recordFailedAttempt(email) {
  // Update memory (for lockout)
  const record = failedAttempts.get(email) || { count: 0, lockUntil: null };
  record.count++;
  record.lockUntil = Date.now();
  failedAttempts.set(email, record);
  
  // Update database (for User Management page)
  try {
    await pool.query(
      `UPDATE users SET failed_attempts = $1 WHERE email = $2`,
      [record.count, email]
    );
    
    if (record.count >= MAX_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
      await pool.query(
        `UPDATE users SET locked_until = $1 WHERE email = $2`,
        [lockUntil, email]
      );
      console.log(`🔒 Account ${email} LOCKED`);
    }
  } catch (err) {
    console.log('Database update failed:', err.message);
  }
  
  console.log(`⚠️ Failed login for ${email} (${record.count}/${MAX_ATTEMPTS})`);
}

// Reset failed attempts (memory + database)
async function resetFailedAttempts(email) {
  // Clear memory
  failedAttempts.delete(email);
  
  // Clear database
  try {
    await pool.query(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE email = $1`,
      [email]
    );
  } catch (err) {
    console.log('Database reset failed:', err.message);
  }
  
  console.log(`✅ Lockout reset for ${email}`);
}





// POST /api/auth/login – email and password only (RETURNS TOKEN) WITH ACCOUNT LOCKOUT
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  try {
    // ========== CHECK ACCOUNT LOCKOUT ==========
    await checkAccountLockout(email);
    
    const { rows } = await pool.query(
      'SELECT id, username, email, password_hash, role, full_name FROM users WHERE email = $1',
      [email]
    );
    
    if (rows.length === 0) {
      await recordFailedAttempt(email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    
    if (!match) {
      await recordFailedAttempt(email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // ========== LOGIN SUCCESSFUL - RESET LOCKOUT ==========
    await resetFailedAttempts(email);
    
    // ========== LOG THE LOGIN ACTIVITY ==========
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;
    
    await pool.query(`
      INSERT INTO activity_logs (user_id, username, action, entity_type, entity_id, ip_address, user_agent, new_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [user.id, user.username, 'LOGIN', 'user', user.id, ipAddress, userAgent, JSON.stringify({ loginTime: new Date().toISOString() })]);
    
    // ========== GENERATE JWT TOKEN ==========
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Return user data WITH token
    res.json({
      token,
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
    });
  } catch (err) {
    // This catches lockout errors from checkAccountLockout
    console.error(err);
    res.status(403).json({ error: err.message });
  }
});


app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      // Decode token to get user info
      const decoded = jwt.verify(token, JWT_SECRET);
      const ipAddress = req.ip || req.connection.remoteAddress || null;
      const userAgent = req.headers['user-agent'] || null;
      
      await pool.query(`
        INSERT INTO activity_logs (user_id, username, action, entity_type, entity_id, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [decoded.id, decoded.email, 'LOGOUT', 'user', decoded.id, ipAddress, userAgent]);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error(err);
    res.json({ message: 'Logged out' });
  }
});



// Function to log user activities
async function logActivity(userId, username, action, entityType, entityId = null, oldData = null, newData = null, req = null) {
  try {
    const ipAddress = req ? req.ip || req.connection.remoteAddress || null : null;
    const userAgent = req ? req.headers['user-agent'] || null : null;
    
    await db.query(`
      INSERT INTO activity_logs (user_id, username, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [userId, username, action, entityType, entityId, oldData, newData, ipAddress, userAgent]);
  } catch (err) {
    console.error('Failed to log activity:', err.message);
  }
}


// Get login history
app.get('/api/activity-logs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        username,
        action,
        entity_type,
        created_at as time,
        ip_address,
        user_agent
      FROM activity_logs 
      WHERE action IN ('LOGIN', 'LOGOUT')
      ORDER BY created_at DESC
      LIMIT 100
    `);
    
    // Always return an array
    res.json(result.rows || []);
  } catch (err) {
    console.error('Activity logs error:', err);
    res.status(500).json({ error: err.message, logs: [] });
  }
});
// POST /api/auth/change-password
app.post('/api/auth/change-password', async (req, res) => {
  const { userId, oldPassword, newPassword } = req.body;
  if (!userId || !oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});



// ============================================================
// USER MANAGEMENT API (admin only)
// ============================================================



// GET all users (with lock status)
app.get('/api/users', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, email, role, full_name, created_at, updated_at, failed_attempts, locked_until FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/users error:', err);
    res.status(500).json({ error: err.message });
  }
});


// GET all users
app.get('/api/users', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, email, role, full_name, created_at, updated_at FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/users error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET single user
app.get('/api/users/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, email, role, full_name, created_at, updated_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/users/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST create new user
app.post('/api/users', async (req, res) => {
  const { username, email, password, role, full_name } = req.body;
  
  console.log('Create user request:', { username, email, role, full_name });
  
  if (!username || !email || !password || !role) {
    return res.status(400).json({ error: 'Username, email, password and role are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    // Check if email already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    // Check if username already exists
    const existingUsername = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUsername.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, role, full_name, created_at, updated_at`,
      [username, email, hashedPassword, role, full_name || null]
    );
    
    console.log('User created successfully:', rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /api/users error:', err);
    res.status(500).json({ error: 'Failed to create user: ' + err.message });
  }
});

// PUT update user
app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { username, email, role, full_name, password } = req.body;
  
  console.log('Update user request:', { id, username, email, role });
  
  try {
    // Check if user exists
    const existing = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    // Build update query dynamically
    let updateFields = [];
    let values = [];
    let paramCount = 1;
    
    if (username) {
      updateFields.push(`username = $${paramCount++}`);
      values.push(username);
    }
    if (email) {
      updateFields.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (role) {
      updateFields.push(`role = $${paramCount++}`);
      values.push(role);
    }
    if (full_name !== undefined) {
      updateFields.push(`full_name = $${paramCount++}`);
      values.push(full_name);
    }
    if (password && password.length >= 6) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.push(`password_hash = $${paramCount++}`);
      values.push(hashedPassword);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(id);
    const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING id, username, email, role, full_name, created_at, updated_at`;
    const { rows } = await pool.query(query, values);
    
    console.log('User updated successfully:', rows[0]);
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /api/users/:id error:', err);
    res.status(500).json({ error: 'Failed to update user: ' + err.message });
  }
});

// DELETE user
app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Prevent deleting the last admin
    const adminCount = await pool.query('SELECT COUNT(*) FROM users WHERE role = $1', ['admin']);
    const userCheck = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    
    if (userCheck.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (userCheck.rows[0].role === 'admin' && parseInt(adminCount.rows[0].count) <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin user' });
    }
    
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('DELETE /api/users/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});



// GET all users (with lock status)
app.get('/api/users', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, email, role, full_name, created_at, updated_at, failed_attempts, locked_until FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/users error:', err);
    res.status(500).json({ error: err.message });
  }
});


// Add this to your server.js if not already there
// UNLOCK USER - Admin only
app.post('/api/users/unlock/:id', protectAPI, async (req, res) => {
  // Check if user is admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const { id } = req.params;
  try {
    // Get user email first
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const email = rows[0].email;
    
    // Clear database
    await pool.query(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1',
      [id]
    );
    
    // ========== CLEAR MEMORY LOCKOUT ==========
    if (failedAttempts && typeof failedAttempts.delete === 'function') {
      failedAttempts.delete(email);
    }
    
    console.log(`🔓 User ${email} unlocked by admin ${req.user.email}`);
    res.json({ message: 'User unlocked successfully' });
  } catch (err) {
    console.error('Unlock error:', err);
    res.status(500).json({ error: err.message });
  }
});
// ============================================================
// HOUSEKEEPING STATUS API
// ============================================================

// GET housekeeping status for all apartments
// GET housekeeping status for all apartments (with checkout_time)
app.get('/api/housekeeping/status', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        a.id as apartment_id,
        a.name,
        a.type,
        a.emoji,
        a.color,
        a.max_adults,
        COALESCE(a.under_maintenance, FALSE) as under_maintenance,
        COALESCE(hs.status, 'clean') as status,
        hs.last_updated,
        hs.updated_by,
        hs.notes,
        -- Get current reservation with checkout time
        (
          SELECT jsonb_build_object(
            'guest', r.guest,
            'email', r.email,
            'mobile', r.mobile,
            'checkin', r.checkin,
            'checkout', r.checkout,
            'checkout_time', r.checkout_time
          )
          FROM reservations r
          WHERE r.apt_id = a.id
            AND r.checkin <= CURRENT_DATE
            AND (r.checkout + COALESCE(r.checkout_time, '11:00:00')) > CURRENT_TIMESTAMP
          ORDER BY r.checkin DESC
          LIMIT 1
        ) as current_reservation,
        -- Check if checkout today (considering checkout time)
        EXISTS (
          SELECT 1 FROM reservations r 
          WHERE r.apt_id = a.id 
            AND DATE(r.checkout) = CURRENT_DATE
        ) as is_checkout_today
      FROM apartments a
      LEFT JOIN housekeeping_status hs ON a.id = hs.apartment_id
      ORDER BY a.id
    `);
    
    // Get current hour for time comparison
    const currentHour = new Date().getHours();
    const CHECKOUT_HOUR = 11;
    
    // Process each row
    const processedRows = rows.map(row => {
      const result = {
        apartment_id: row.apartment_id,
        name: row.name,
        type: row.type,
        emoji: row.emoji,
        color: row.color,
        max_adults: row.max_adults,
        under_maintenance: row.under_maintenance,
        status: row.status,
        last_updated: row.last_updated,
        updated_by: row.updated_by,
        notes: row.notes
      };
      
      // Add guest info if occupied
      if (row.current_reservation) {
        result.guest_name = row.current_reservation.guest;
        result.guest_email = row.current_reservation.email;
        result.guest_mobile = row.current_reservation.mobile;
        result.checkin_date = row.current_reservation.checkin;
        result.checkout_date = row.current_reservation.checkout;
        result.checkout_time = row.current_reservation.checkout_time || '11:00:00';
        result.reservation_status = 'occupied';
      } 
      // Check if checkout today
      else if (row.is_checkout_today) {
        // Determine if after checkout time (11:00 AM)
        if (currentHour >= CHECKOUT_HOUR) {
          result.reservation_status = 'checkout_completed';
        } else {
          result.reservation_status = 'checkout';
          result.hours_until_checkout = CHECKOUT_HOUR - currentHour;
        }
      } 
      else {
        result.reservation_status = 'vacant';
      }
      
      return result;
    });
    
    res.json(processedRows);
  } catch (err) {
    console.error('Error fetching housekeeping status:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE housekeeping status for an apartment
app.put('/api/housekeeping/status/:apartmentId', async (req, res) => {
  const { apartmentId } = req.params;
  const { status, notes, updated_by } = req.body;
  
  console.log('Updating housekeeping status:', { apartmentId, status, notes, updated_by });
  
  if (!status || !['clean', 'dirty', 'checkout'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be clean, dirty, or checkout' });
  }
  
  try {
    // First check if apartment exists
    const aptCheck = await pool.query('SELECT id FROM apartments WHERE id = $1', [apartmentId]);
    if (aptCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Apartment not found' });
    }
    
    // Insert or update status
    const { rows } = await pool.query(`
      INSERT INTO housekeeping_status (apartment_id, status, updated_by, notes, last_updated)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (apartment_id) 
      DO UPDATE SET 
        status = EXCLUDED.status,
        updated_by = EXCLUDED.updated_by,
        notes = EXCLUDED.notes,
        last_updated = CURRENT_TIMESTAMP
      RETURNING *
    `, [apartmentId, status, updated_by || 'system', notes || null]);
    
    console.log('Status updated successfully:', rows[0]);
    res.json({ 
      success: true, 
      message: `Status updated to ${status}`,
      data: rows[0]
    });
  } catch (err) {
    console.error('Error updating status:', err);
    res.status(500).json({ error: err.message });
  }
});

// Force reset status for testing (optional)
app.post('/api/housekeeping/reset/:apartmentId', async (req, res) => {
  const { apartmentId } = req.params;
  try {
    await pool.query(`
      INSERT INTO housekeeping_status (apartment_id, status, updated_by, last_updated)
      VALUES ($1, 'dirty', 'system', CURRENT_TIMESTAMP)
      ON CONFLICT (apartment_id) 
      DO UPDATE SET 
        status = 'dirty',
        updated_by = 'system',
        last_updated = CURRENT_TIMESTAMP
    `, [apartmentId]);
    
    res.json({ message: 'Status reset to dirty' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});





// ============================================================
// PURCHASE ORDERS API
// ============================================================

// GET all vendors
app.get('/api/vendors', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vendors ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create new vendor
app.post('/api/vendors', async (req, res) => {
  const { name, type } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Vendor name required' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO vendors (name, type) VALUES ($1, $2) RETURNING *',
      [name, type || 'local']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Vendor already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET all purchase orders (with optional date filter)
app.get('/api/purchase-orders', async (req, res) => {
  const { date } = req.query;
  let query = `
    SELECT po.*, v.name as vendor_name, v.type as vendor_type
    FROM purchase_orders po
    JOIN vendors v ON po.vendor_id = v.id
  `;
  const params = [];
  if (date) {
    query += ' WHERE po.order_date = $1';
    params.push(date);
  }
  query += ' ORDER BY po.order_date DESC, po.id DESC';
  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single purchase order with items
app.get('/api/purchase-orders/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const poResult = await pool.query(`
      SELECT po.*, v.name as vendor_name, v.type as vendor_type
      FROM purchase_orders po
      JOIN vendors v ON po.vendor_id = v.id
      WHERE po.id = $1
    `, [id]);
    
    if (poResult.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    const itemsResult = await pool.query(`
      SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY id
    `, [id]);
    
    res.json({
      ...poResult.rows[0],
      items: itemsResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create new purchase order
app.post('/api/purchase-orders', async (req, res) => {
  const { vendor_id, order_date, notes, items, created_by, category } = req.body;

  if (!vendor_id || !items || items.length === 0) {
    return res.status(400).json({ error: 'Vendor and at least one item required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Generate PO number
    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const countResult = await client.query('SELECT COUNT(*) FROM purchase_orders');
    const poNumber = `PO-${dateStr}-${(parseInt(countResult.rows[0].count) + 1).toString().padStart(4, '0')}`;

    // Calculate total amount
    let totalAmount = 0;
    for (const item of items) {
      totalAmount += item.unit_price * item.quantity;
    }

    // Insert purchase order
    const poResult = await client.query(`
      INSERT INTO purchase_orders (po_number, vendor_id, order_date, status, total_amount, notes, created_by, category)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
    `, [poNumber, vendor_id, order_date || new Date().toISOString().slice(0,10), 'pending', totalAmount, notes || null, created_by || 'system', category || 'other']);
    
    const poId = poResult.rows[0].id;
    
    // Insert items
    for (const item of items) {
      await client.query(`
        INSERT INTO purchase_order_items (po_id, item_name, category, unit, unit_price, quantity, total_price)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [poId, item.item_name, item.category, item.unit, item.unit_price, item.quantity, item.unit_price * item.quantity]);
    }
    
    await client.query('COMMIT');
    
    res.status(201).json(poResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT update purchase order status
app.put('/api/purchase-orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE purchase_orders SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *
    `, [status, id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// DELETE purchase order item
app.delete('/api/purchase-order-items/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM purchase_order_items WHERE id = $1', [id]);
    res.json({ message: 'Item removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST add item to existing purchase order
app.post('/api/purchase-order-items', async (req, res) => {
  const { po_id, item_name, category, unit, unit_price, quantity } = req.body;
  const total_price = unit_price * quantity;
  try {
    const { rows } = await pool.query(`
      INSERT INTO purchase_order_items (po_id, item_name, category, unit, unit_price, quantity, total_price)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [po_id, item_name, category, unit, unit_price, quantity, total_price]);
    
    // Update PO total amount
    await pool.query(`
      UPDATE purchase_orders SET total_amount = (
        SELECT COALESCE(SUM(total_price), 0) FROM purchase_order_items WHERE po_id = $1
      ) WHERE id = $1
    `, [po_id]);
    
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DELETE PURCHASE ORDER
// ============================================================
app.delete('/api/purchase-orders/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // First check if purchase order exists
    const poCheck = await client.query(
      'SELECT id, status, po_number FROM purchase_orders WHERE id = $1',
      [id]
    );
    
    if (poCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    const po = poCheck.rows[0];
    
    // Break circular FK: purchase_orders.grn_id → goods_receipt_notes
    await client.query(`UPDATE purchase_orders SET grn_id = NULL WHERE id = $1`, [id]);

    // Delete goods_receipt_items referencing this PO's items
    await client.query(
      `DELETE FROM goods_receipt_items WHERE po_item_id IN (SELECT id FROM purchase_order_items WHERE po_id = $1)`,
      [id]
    );

    // Delete goods receipt notes linked to this PO
    await client.query(`DELETE FROM goods_receipt_notes WHERE po_id = $1`, [id]);

    // Delete purchase order items
    await client.query('DELETE FROM purchase_order_items WHERE po_id = $1', [id]);

    // Delete the purchase order
    await client.query('DELETE FROM purchase_orders WHERE id = $1', [id]);
    
    await client.query('COMMIT');
    
    console.log(`✅ Deleted purchase order #${po.po_number} (ID: ${id})`);
    res.json({ 
      message: `Purchase order #${po.po_number} deleted successfully` 
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete PO error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT update purchase order (status, notes, items)
app.put('/api/purchase-orders/:id', async (req, res) => {
  const { id } = req.params;
  const { status, notes, items } = req.body;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Update status and notes
    await client.query(`
      UPDATE purchase_orders SET status = $1, notes = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [status, notes, id]);
    
    // Update item prices and quantities - CONVERT TO NUMERIC
    for (const item of items) {
      // Use CAST to convert to numeric/decimal
      await client.query(`
        UPDATE purchase_order_items 
        SET unit_price = CAST($1 AS DECIMAL), 
            quantity = CAST($2 AS DECIMAL), 
            total_price = CAST($1 AS DECIMAL) * CAST($2 AS DECIMAL)
        WHERE id = $3
      `, [item.unit_price, item.quantity, item.item_id]);
    }
    
    // Update total amount
    await client.query(`
      UPDATE purchase_orders SET total_amount = (
        SELECT COALESCE(SUM(total_price), 0) FROM purchase_order_items WHERE po_id = $1
      ) WHERE id = $1
    `, [id]);
    
    await client.query('COMMIT');
    res.json({ message: 'Purchase order updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update PO error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


// ============================================================
// GOODS RECEIPT NOTE (GRN) API
// ============================================================

// GET all GRNs (with optional date filter)
app.get('/api/grn', async (req, res) => {
  const { date } = req.query;
  let query = `
    SELECT grn.*, v.name as vendor_name, po.po_number
    FROM goods_receipt_notes grn
    JOIN vendors v ON grn.vendor_id = v.id
    JOIN purchase_orders po ON grn.po_id = po.id
  `;
  const params = [];
  if (date) {
    query += ' WHERE grn.receipt_date = $1';
    params.push(date);
  }
  query += ' ORDER BY grn.receipt_date DESC, grn.id DESC';
  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single GRN with items
app.get('/api/grn/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const grnResult = await pool.query(`
      SELECT grn.*, v.name as vendor_name, po.po_number
      FROM goods_receipt_notes grn
      JOIN vendors v ON grn.vendor_id = v.id
      JOIN purchase_orders po ON grn.po_id = po.id
      WHERE grn.id = $1
    `, [id]);
    
    if (grnResult.rows.length === 0) {
      return res.status(404).json({ error: 'GRN not found' });
    }
    
    const itemsResult = await pool.query(`
      SELECT * FROM goods_receipt_items WHERE grn_id = $1 ORDER BY id
    `, [id]);
    
    res.json({
      ...grnResult.rows[0],
      items: itemsResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create GRN from purchase order (Receive goods)
app.post('/api/grn/receive/:poId', async (req, res) => {
  const { poId } = req.params;
  const { notes, created_by, items: updatedItems, payment_method } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Apply store-manager quantity and buying cost overrides before processing
    if (updatedItems && updatedItems.length > 0) {
      for (const ui of updatedItems) {
        const qty = parseFloat(ui.quantity) || 0;
        const cost = parseFloat(ui.unit_price) || 0;
        const total = qty * cost;
        await client.query(
          'UPDATE purchase_order_items SET quantity=$1, unit_price=$2, total_price=$3 WHERE id=$4 AND po_id=$5',
          [qty, cost, total, ui.id, poId]
        );
      }
      await client.query(
        'UPDATE purchase_orders SET total_amount=(SELECT COALESCE(SUM(total_price),0) FROM purchase_order_items WHERE po_id=$1) WHERE id=$1',
        [poId]
      );
    }

    // Get purchase order details
    const poResult = await client.query(`
      SELECT po.*, v.name as vendor_name, v.id as vendor_id
      FROM purchase_orders po
      JOIN vendors v ON po.vendor_id = v.id
      WHERE po.id = $1 AND po.status = 'pending'
    `, [poId]);

    if (poResult.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase order not found or already processed' });
    }
    const po = poResult.rows[0];

    // Get PO items (with updated quantities/costs applied above)
    const itemsResult = await client.query(`
      SELECT * FROM purchase_order_items WHERE po_id = $1
    `, [poId]);
    
    if (itemsResult.rows.length === 0) {
      return res.status(400).json({ error: 'No items in this purchase order' });
    }
    
    // Generate GRN number
    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const countResult = await client.query('SELECT COUNT(*) FROM goods_receipt_notes');
    const grnNumber = `GRN-${dateStr}-${(parseInt(countResult.rows[0].count) + 1).toString().padStart(4, '0')}`;
    
    // Create GRN
    const grnResult = await client.query(`
      INSERT INTO goods_receipt_notes (grn_number, po_id, vendor_id, receipt_date, status, notes, created_by)
      VALUES ($1, $2, $3, CURRENT_DATE, 'received', $4, $5) RETURNING *
    `, [grnNumber, poId, po.vendor_id, notes, created_by || 'system']);
    const grn = grnResult.rows[0];
    
    // Create GRN items and update main store inventory
    for (const item of itemsResult.rows) {
      // Insert GRN item
      await client.query(`
        INSERT INTO goods_receipt_items (grn_id, po_item_id, item_name, category, unit, quantity_received, unit_price, total_cost)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [grn.id, item.id, item.item_name, item.category, item.unit, item.quantity, item.unit_price, item.total_price]);
      
      // Update main store inventory (store_items)
      const existingItem = await client.query(`
        SELECT * FROM store_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
      `, [item.item_name]);
      
      if (existingItem.rows.length > 0) {
        const stockItem = existingItem.rows[0];
        const currentQtyParts = (stockItem.quantity || '0 units').split(' ');
        const currentQty = parseFloat(currentQtyParts[0]) || 0;
        const unit = currentQtyParts[1] || item.unit;
        const newQty = currentQty + parseFloat(item.quantity);
        const newQuantityStr = newQty + ' ' + unit;
        // Use the PO unit_price (possibly edited before receiving) as the new cost
        const newCost = parseFloat(item.unit_price) || parseFloat(stockItem.cost) || 0;
        const newStockValue = Math.round(newQty * newCost);

        await client.query(`
          UPDATE store_items SET quantity = $1, stock_value = $2, cost = $3 WHERE id = $4
        `, [newQuantityStr, newStockValue, newCost, stockItem.id]);
      } else {
        // New item — use PO unit_price as the starting cost
        const newCost = parseFloat(item.unit_price) || 0;
        const newStockValue = Math.round(parseFloat(item.quantity) * newCost);
        await client.query(`
          INSERT INTO store_items (name, category, cost, quantity, stock_value, unit)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [item.item_name, item.category, newCost, item.quantity + ' ' + item.unit, newStockValue, item.unit]);
      }
    }
    
    // Update purchase order status to 'received'
    await client.query(`
      UPDATE purchase_orders SET status = 'received', received_status = 'received', grn_id = $1, payment_method = $2 WHERE id = $3
    `, [grn.id, payment_method || 'cash', poId]);

    // Auto-create expense entry for this purchase
    const expCount = await client.query('SELECT COUNT(*) FROM expenses');
    const expDateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const expNumber = `EXP-${expDateStr}-${(parseInt(expCount.rows[0].count) + 1).toString().padStart(4, '0')}`;
    await client.query(`
      INSERT INTO expenses (expense_number, category, description, amount, expense_date, payment_method, paid_to, remarks, created_by)
      VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $8)
    `, [
      expNumber,
      po.category || 'other',
      `Purchase Order ${po.po_number} received`,
      Math.round(po.total_amount),
      payment_method || 'cash',
      po.vendor_name,
      `Auto-created from PO ${po.po_number}`,
      created_by || 'system'
    ]);

    await client.query('COMMIT');
    
    res.status(201).json({ 
      message: 'Goods received successfully! Stock updated in Main Store.',
      grn: grn,
      items_received: itemsResult.rows.length
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});



// ============================================================
// REPORTS API - For the report pages
// ============================================================
// ============================================================
// REPORTS API - Add these to your server.js
// ============================================================

// GET /api/reports/purchase-orders - Filter by date range and status
app.get('/api/reports/purchase-orders', async (req, res) => {
  const { from, to, status, vendorId } = req.query;
  let query = `
    SELECT 
      po.id, po.po_number, po.order_date, po.status, po.total_amount, 
      po.created_by, po.created_at,
      v.name as vendor_name,
      (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) as items_count
    FROM purchase_orders po
    JOIN vendors v ON po.vendor_id = v.id
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 1;
  
  if (from) {
    query += ` AND po.order_date >= $${paramCount++}`;
    params.push(from);
  }
  if (to) {
    query += ` AND po.order_date <= $${paramCount++}`;
    params.push(to);
  }
  if (status && status !== 'all') {
    query += ` AND po.status = $${paramCount++}`;
    params.push(status);
  }
  if (vendorId && vendorId !== 'all') {
    query += ` AND po.vendor_id = $${paramCount++}`;
    params.push(parseInt(vendorId));
  }
  
  query += ` ORDER BY po.order_date DESC, po.id DESC`;
  
  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching PO report:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/goods-receipt - Filter by date range and vendor
// GET /api/reports/goods-receipt - CORRECTED with proper total calculation
// GET /api/reports/goods-receipt - FIXED with proper numeric totals
app.get('/api/reports/goods-receipt', async (req, res) => {
  const { from, to, vendorId } = req.query;
  let query = `
    SELECT 
      grn.id, 
      grn.grn_number, 
      grn.receipt_date, 
      grn.status, 
      grn.created_by,
      po.po_number,
      v.name as vendor_name,
      COALESCE((
        SELECT SUM(total_cost)::INTEGER
        FROM goods_receipt_items 
        WHERE grn_id = grn.id
      ), 0) as total_value,
      COALESCE((
        SELECT COUNT(*) 
        FROM goods_receipt_items 
        WHERE grn_id = grn.id
      ), 0) as items_count
    FROM goods_receipt_notes grn
    JOIN purchase_orders po ON grn.po_id = po.id
    JOIN vendors v ON grn.vendor_id = v.id
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 1;
  
  if (from) {
    query += ` AND grn.receipt_date >= $${paramCount++}::date`;
    params.push(from);
  }
  if (to) {
    query += ` AND grn.receipt_date <= $${paramCount++}::date`;
    params.push(to);
  }
  if (vendorId && vendorId !== 'all') {
    query += ` AND grn.vendor_id = $${paramCount++}`;
    params.push(parseInt(vendorId));
  }
  
  query += ` ORDER BY grn.receipt_date DESC, grn.id DESC`;
  
  try {
    const { rows } = await pool.query(query, params);
    // Ensure total_value is a number
    const formattedRows = rows.map(row => ({
      ...row,
      total_value: parseInt(row.total_value) || 0
    }));
    res.json(formattedRows);
  } catch (err) {
    console.error('Error fetching GRN report:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/grn/:id/items - Get items for a specific GRN
app.get('/api/grn/:id/items', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`
      SELECT * FROM goods_receipt_items WHERE grn_id = $1 ORDER BY id
    `, [id]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching GRN items:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchase-orders/:id/items - Get items for a specific PO
app.get('/api/purchase-orders/:id/items', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`
      SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY id
    `, [id]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching PO items:', err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// SALES API ENDPOINTS
// ============================================================
// ============================================================
// SALES API ENDPOINTS (FIXED DATE HANDLING)
// ============================================================

// POST /api/sales - Save a completed sale
app.post('/api/sales', async (req, res) => {
  const { items, total_amount, cashier_id, cashier_name, pos_type, payment_method, waiter_name } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'No items in sale' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query(`
      INSERT INTO sales_orders (cashier_id, cashier_name, total_amount, status, order_date, pos_type, payment_method, waiter_name)
      VALUES ($1, $2, $3, 'completed', CURRENT_TIMESTAMP, $4, $5, $6)
      RETURNING id, order_number
    `, [cashier_id || null, cashier_name, total_amount, pos_type || null, payment_method || 'Cash', waiter_name || null]);
    
    const saleId = orderResult.rows[0].id;
    const orderNumber = orderResult.rows[0].order_number;
    
    for (const item of items) {
      await client.query(`
        INSERT INTO sales_items (sale_id, item_id, item_name, category, unit, quantity, unit_price, total_price)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [saleId, item.item_id || null, item.item_name, item.category, item.unit, item.quantity, item.unit_price, item.total_price]);
    }
    
    await client.query('COMMIT');
    
    res.status(201).json({ 
      success: true, 
      order_number: orderNumber,
      message: 'Sale saved successfully' 
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error saving sale:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/sales - Get sales with items in a single query
app.get('/api/sales', async (req, res) => {
  const { from, to, pos_type } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  let paramCount = 1;

  if (from) { where += ` AND so.order_date >= $${paramCount++}::date`; params.push(from); }
  if (to)   { where += ` AND so.order_date < ($${paramCount++}::date + INTERVAL '1 day')`; params.push(to); }
  if (pos_type) { where += ` AND so.pos_type = $${paramCount++}`; params.push(pos_type); }

  try {
    const { rows } = await pool.query(`
      SELECT
        so.id, so.order_number, so.cashier_name, so.waiter_name, so.total_amount,
        so.order_date, so.status, so.pos_type, so.payment_method,
        COALESCE(json_agg(
          json_build_object(
            'item_name', si.item_name,
            'quantity',  si.quantity,
            'unit_price',si.unit_price,
            'total_price',si.total_price
          ) ORDER BY si.id
        ) FILTER (WHERE si.id IS NOT NULL), '[]') AS items
      FROM sales_orders so
      LEFT JOIN sales_items si ON si.sale_id = so.id
      ${where}
      GROUP BY so.id
      ORDER BY so.order_date DESC
    `, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching sales:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sales/:id - Delete a POS sale order
app.delete('/api/sales/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM sales_items WHERE sale_id = $1', [id]);
    const { rowCount } = await pool.query('DELETE FROM sales_orders WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Sale not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/sales/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/:id/items - Get items for a specific sale
app.get('/api/sales/:id/items', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`
      SELECT * FROM sales_items WHERE sale_id = $1 ORDER BY id
    `, [id]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching sale items:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/stats/summary - Get sales summary statistics
app.get('/api/sales/stats/summary', async (req, res) => {
  const { from, to } = req.query;
  let query = `
    SELECT 
      COUNT(*)::INTEGER as total_orders,
      COALESCE(SUM(total_amount), 0)::INTEGER as total_revenue,
      COALESCE(AVG(total_amount), 0)::INTEGER as avg_order_value
    FROM sales_orders
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 1;
  
  if (from) {
    query += ` AND order_date >= $${paramCount++}::date`;
    params.push(from);
  }
  if (to) {
    query += ` AND order_date < ($${paramCount++}::date + INTERVAL '1 day')`;
    params.push(to);
  }
  
  try {
    const { rows } = await pool.query(query, params);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching sales stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/top-products - Get best selling products
app.get('/api/sales/top-products', async (req, res) => {
  const { from, to, limit = 10 } = req.query;
  let query = `
    SELECT 
      si.item_name,
      si.category,
      SUM(si.quantity)::INTEGER as total_quantity,
      SUM(si.total_price)::INTEGER as total_revenue
    FROM sales_items si
    JOIN sales_orders so ON si.sale_id = so.id
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 1;
  
  if (from) {
    query += ` AND so.order_date >= $${paramCount++}::date`;
    params.push(from);
  }
  if (to) {
    query += ` AND so.order_date < ($${paramCount++}::date + INTERVAL '1 day')`;
    params.push(to);
  }
  
  query += ` GROUP BY si.item_name, si.category
             ORDER BY total_quantity DESC
             LIMIT $${paramCount}`;
  params.push(limit);
  
  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching top products:', err);
    res.status(500).json({ error: err.message });
  }
});



// DELETE /api/sales/:id - Delete a sales order and its items
app.delete('/api/sales/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM sales_items WHERE sale_id = $1', [id]);
    const { rowCount } = await client.query('DELETE FROM sales_orders WHERE id = $1', [id]);
    if (rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Sale not found' }); }
    await client.query('COMMIT');
    res.json({ message: 'Sale deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete sale error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// LAUNDRY SERVICES API
// ============================================================

// GET /api/laundry - list with optional date/status filters
app.get('/api/laundry', async (req, res) => {
  const { from, to, payment_status } = req.query;
  let query = `SELECT * FROM laundry_services WHERE 1=1`;
  const params = [];
  let p = 1;
  if (from)            { query += ` AND service_date >= $${p++}::date`; params.push(from); }
  if (to)              { query += ` AND service_date < ($${p++}::date + INTERVAL '1 day')`; params.push(to); }
  if (payment_status)  { query += ` AND payment_status = $${p++}`; params.push(payment_status); }
  query += ` ORDER BY service_date DESC, created_at DESC`;
  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/laundry - create new record
app.post('/api/laundry', async (req, res) => {
  const { room_number, clothes_type, services, service_date, housekeeper_name, price, payment_method, payment_status, amount_paid, notes } = req.body;
  if (!room_number || !housekeeper_name) return res.status(400).json({ error: 'room_number and housekeeper_name are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO laundry_services (room_number, clothes_type, services, service_date, housekeeper_name, price, payment_method, payment_status, amount_paid, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [room_number, clothes_type || null, services || null, service_date || new Date().toISOString().split('T')[0],
       housekeeper_name, parseFloat(price) || 0, payment_method || null, payment_status || 'pending',
       parseFloat(amount_paid) || 0, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/laundry/:id - update record
app.put('/api/laundry/:id', async (req, res) => {
  const { id } = req.params;
  const { room_number, clothes_type, services, service_date, housekeeper_name, price, payment_method, payment_status, amount_paid, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE laundry_services SET room_number=$1, clothes_type=$2, services=$3, service_date=$4,
       housekeeper_name=$5, price=$6, payment_method=$7, payment_status=$8, amount_paid=$9, notes=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [room_number, clothes_type || null, services || null, service_date,
       housekeeper_name, parseFloat(price) || 0, payment_method || null, payment_status || 'pending',
       parseFloat(amount_paid) || 0, notes || null, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Record not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/laundry/:id
app.delete('/api/laundry/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM laundry_services WHERE id=$1`, [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// CATEGORIES API
// ============================================================

// GET all categories (optionally filtered by ?type=store|bar|restaurant)
app.get('/api/categories', async (req, res) => {
  const { type } = req.query;
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        CASE c.type
          WHEN 'bar' THEN (SELECT COUNT(*) FROM bar_menu_items WHERE category = c.name)
          WHEN 'restaurant' THEN (SELECT COUNT(*) FROM menu_items WHERE category = c.name)
          WHEN 'maintenance' THEN (SELECT COUNT(*) FROM maintenance_records WHERE repair_type = c.name)
          WHEN 'expense' THEN (SELECT COUNT(*) FROM expenses WHERE category = c.name)
          WHEN 'purchase_order' THEN (SELECT COUNT(*) FROM purchase_orders WHERE category = c.name)
          ELSE (SELECT COUNT(*) FROM store_items WHERE category = c.name)
        END as items_count
      FROM categories c
      WHERE $1::text IS NULL OR c.type = $1
      ORDER BY c.name
    `, [type || null]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST create new category
app.post('/api/categories', async (req, res) => {
  const { name, type } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Category name is required' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO categories (name, type) VALUES ($1, $2) RETURNING *',
      [name.trim(), type || 'store']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Category already exists' });
    }
    console.error('Error creating category:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update category
app.put('/api/categories/:id', async (req, res) => {
  const { id } = req.params;
  const { name, type } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE categories SET name = $1, type = $2 WHERE id = $3 RETURNING *',
      [name, type, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Category name already exists' });
    }
    console.error('Error updating category:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE category
app.delete('/api/categories/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // First check if category has any items
    const categoryCheck = await pool.query(
      'SELECT name, type FROM categories WHERE id = $1',
      [id]
    );
    if (categoryCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const { name: categoryName, type: categoryType } = categoryCheck.rows[0];

    // Uncategorize any items still using this category, in the table matching its type.
    // maintenance_records.repair_type and expenses.category are NOT NULL, so those fall back to 'Other' instead.
    if (categoryType === 'bar') {
      await pool.query('UPDATE bar_menu_items SET category = NULL WHERE category = $1', [categoryName]);
    } else if (categoryType === 'restaurant') {
      await pool.query('UPDATE menu_items SET category = NULL WHERE category = $1', [categoryName]);
    } else if (categoryType === 'maintenance') {
      await pool.query('UPDATE maintenance_records SET repair_type = $1 WHERE repair_type = $2', ['Other', categoryName]);
    } else if (categoryType === 'expense') {
      await pool.query('UPDATE expenses SET category = $1 WHERE category = $2', ['Other', categoryName]);
    } else if (categoryType === 'purchase_order') {
      await pool.query('UPDATE purchase_orders SET category = $1 WHERE category = $2', ['other', categoryName]);
    } else {
      await pool.query('UPDATE store_items SET category = NULL WHERE category = $1', [categoryName]);
    }

    // Delete the category
    const { rowCount } = await pool.query('DELETE FROM categories WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ message: 'Category deleted successfully' });
  } catch (err) {
    console.error('Error deleting category:', err);
    res.status(500).json({ error: err.message });
  }
});




// ============================================================
// ACTIVITY LOGGER FUNCTION
// ============================================================
// ============================================================
// ACTIVITY LOGS API
// ============================================================
// GET /api/activity-logs - Get all activity logs with proper date filtering
app.get('/api/activity-logs', async (req, res) => {
  const { from, to, action, entityType, limit = 500 } = req.query;
  let query = `
    SELECT 
      al.id,
      al.user_id,
      al.username,
      al.action,
      al.entity_type,
      al.entity_id,
      al.old_data,
      al.new_data,
      al.ip_address,
      al.user_agent,
      al.created_at
    FROM activity_logs al
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 1;
  
  // FIX: Compare date only, not time
  if (from) {
    query += ` AND DATE(al.created_at) >= $${paramCount++}`;
    params.push(from);
  }
  if (to) {
    query += ` AND DATE(al.created_at) <= $${paramCount++}`;
    params.push(to);
  }
  if (action && action !== '') {
    query += ` AND al.action = $${paramCount++}`;
    params.push(action);
  }
  if (entityType && entityType !== '') {
    query += ` AND al.entity_type = $${paramCount++}`;
    params.push(entityType);
  }
  
  query += ` ORDER BY al.created_at DESC LIMIT $${paramCount}`;
  params.push(parseInt(limit));
  
  try {
    const { rows } = await pool.query(query, params);
    console.log(`📋 Found ${rows.length} activity logs for date range: ${from || 'start'} to ${to || 'end'}`);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching activity logs:', err);
    res.status(500).json({ error: err.message });
  }
});




// ============================================================
// ROLE PERMISSIONS API
// ============================================================

// GET permissions for a specific role
app.get('/api/permissions/:role', async (req, res) => {
  const { role } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT page_key FROM role_permissions WHERE role = $1 AND allowed = true',
      [role]
    );
    res.json({ role, pages: rows.map(r => r.page_key) });
  } catch (err) {
    console.error('GET /api/permissions/:role error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET all roles permissions
app.get('/api/permissions', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT role, page_key FROM role_permissions WHERE allowed = true ORDER BY role, page_key'
    );
    const result = {};
    rows.forEach(r => {
      if (!result[r.role]) result[r.role] = [];
      result[r.role].push(r.page_key);
    });
    res.json(result);
  } catch (err) {
    console.error('GET /api/permissions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST save permissions for a role (admin only)
app.post('/api/permissions', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { role, pages } = req.body;
  if (!role || !Array.isArray(pages)) {
    return res.status(400).json({ error: 'role and pages[] are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM role_permissions WHERE role = $1', [role]);
    if (pages.length > 0) {
      const values = pages.map((p, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(',');
      const params = pages.flatMap(p => [role, p, true]);
      await client.query(
        `INSERT INTO role_permissions (role, page_key, allowed) VALUES ${values}`,
        params
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, role, saved: pages.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/permissions error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Run all migrations sequentially (one connection at a time) then start server
setupDatabase()
  .then(() => ensurePaymentColumns())
  .then(() => createMaintenanceTable())
  .then(() => createStaffActivitiesTable())
  .then(() => createExpendituresTable())
  .then(() => createExpensesTable())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Kitobo Serenity Resort API running on http://localhost:${PORT}`);
      console.log(`📄 Clean URLs enabled - access pages without .html`);
      console.log(`   Example: http://localhost:${PORT}/dashboard`);
    });
  }).catch(err => {
  console.error('Failed to setup database:', err);
  process.exit(1);
});

// ============================================================
// COUNTRIES API
// ============================================================

// GET all countries (alphabetical)
app.get('/api/countries', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name FROM countries ORDER BY name ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching countries:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST add new country (for future expansion)
app.post('/api/countries', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Country name required' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO countries (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *',
      [name.trim()]
    );
    res.status(201).json(rows[0] || { message: 'Country already exists' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});






// optimize speed
// optimize speed
// optimize speed
const compression = require('compression');
app.use(compression());



// ============================================================
// MAINTENANCE MANAGEMENT API
// ============================================================

// Create maintenance records table
async function createMaintenanceTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS maintenance_records (
        id SERIAL PRIMARY KEY,
        task_number VARCHAR(50) NOT NULL UNIQUE,
        technician_name VARCHAR(100) NOT NULL,
        contact_number VARCHAR(50),
        repair_type VARCHAR(50) NOT NULL,
        item_name VARCHAR(200),
        description TEXT NOT NULL,
        labour_cost INT DEFAULT 0,
        tools JSONB DEFAULT '[]',
        total_tools_cost INT DEFAULT 0,
        total_cost INT DEFAULT 0,
        payment_method VARCHAR(50),
        task_date DATE NOT NULL,
        remarks TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      ALTER TABLE maintenance_records ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
      ALTER TABLE maintenance_records ADD COLUMN IF NOT EXISTS expense_id INT;
    `);
    console.log('✅ Maintenance records table ready');
  } catch (err) {
    console.log('Maintenance records table note:', err.message);
  }
}

// Auto-record a maintenance record's cost as an expense (create the linked
// expense the first time, then keep it in sync on later edits)
async function syncMaintenanceExpense(task) {
  const description = `Maintenance: ${task.repair_type}${task.item_name ? ' - ' + task.item_name : ''} (Tech: ${task.technician_name})`;
  const amount = task.total_cost || 0;
  const paymentMethod = task.payment_method || 'cash';
  try {
    if (task.expense_id) {
      await pool.query(`
        UPDATE expenses SET description = $1, amount = $2, expense_date = $3, payment_method = $4, paid_to = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
      `, [description, amount, task.task_date, paymentMethod, task.technician_name, task.expense_id]);
    } else {
      const { rows } = await pool.query(`
        INSERT INTO expenses (expense_number, category, description, amount, expense_date, payment_method, paid_to, remarks, created_by)
        VALUES ($1, 'Maintenance', $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
        `EXP-${task.task_number}`, description, amount, task.task_date, paymentMethod, task.technician_name,
        `Auto-recorded from Maintenance Record #${task.task_number}`, task.created_by || 'system'
      ]);
      await pool.query('UPDATE maintenance_records SET expense_id = $1 WHERE id = $2', [rows[0].id, task.id]);
      task.expense_id = rows[0].id;
    }
  } catch (err) {
    console.error('Failed to sync maintenance expense for record', task.id, ':', err.message);
  }
}

// GET all maintenance records (with filters)
app.get('/api/maintenance', async (req, res) => {
  const { from, to, repairType, status } = req.query;
  let query = 'SELECT * FROM maintenance_records WHERE 1=1';
  const params = [];
  let paramCount = 1;
  
  if (from) {
    query += ` AND task_date >= $${paramCount++}::date`;
    params.push(from);
  }
  if (to) {
    query += ` AND task_date <= $${paramCount++}::date`;
    params.push(to);
  }
  if (repairType && repairType !== '') {
    query += ` AND repair_type = $${paramCount++}`;
    params.push(repairType);
  }
  if (status && status !== '') {
    query += ` AND status = $${paramCount++}`;
    params.push(status);
  }
  
  query += ' ORDER BY task_date DESC, id DESC';
  
  try {
    const { rows } = await pool.query(query, params);
    // Parse tools JSON for each row
    const formattedRows = rows.map(row => ({
      ...row,
      tools: typeof row.tools === 'string' ? JSON.parse(row.tools) : (row.tools || [])
    }));
    res.json(formattedRows);
  } catch (err) {
    console.error('GET /api/maintenance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET single maintenance record
app.get('/api/maintenance/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM maintenance_records WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    
    const task = rows[0];
    // Parse tools JSON
    task.tools = typeof task.tools === 'string' ? JSON.parse(task.tools) : (task.tools || []);
    
    res.json(task);
  } catch (err) {
    console.error('GET /api/maintenance/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST create maintenance record
app.post('/api/maintenance', async (req, res) => {
  const {
    taskNumber, technicianName, contactNumber, repairType, itemName, description,
    labourCost, tools, totalToolsCost, date, remarks, status, paymentMethod
  } = req.body;
  
  console.log('📝 Creating maintenance record:', { technicianName, contactNumber, repairType, itemName, labourCost });
  
  if (!technicianName || !repairType || !description) {
    return res.status(400).json({ error: 'Technician name, repair type, and description are required' });
  }
  
  const totalCost = (labourCost || 0) + (totalToolsCost || 0);
  const taskNum = taskNumber || `MT-${Date.now()}`;
  const toolsJson = JSON.stringify(tools || []);
  
  try {
    const { rows } = await pool.query(`
      INSERT INTO maintenance_records (
        task_number, technician_name, contact_number, repair_type, item_name, description,
        labour_cost, tools, total_tools_cost, total_cost, payment_method,
        task_date, remarks, status, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [
      taskNum, technicianName, contactNumber || null, repairType, itemName || null, description,
      labourCost || 0, toolsJson, totalToolsCost || 0, totalCost, paymentMethod || null,
      date, remarks || null, status || 'pending', req.body.created_by || 'system'
    ]);
    
    const newTask = rows[0];
    newTask.tools = typeof newTask.tools === 'string' ? JSON.parse(newTask.tools) : (newTask.tools || []);
    await syncMaintenanceExpense(newTask);

    console.log('✅ Record created:', newTask.id);
    res.status(201).json(newTask);
  } catch (err) {
    console.error('Create record error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update maintenance record
app.put('/api/maintenance/:id', async (req, res) => {
  const { id } = req.params;
  const {
    technicianName, contactNumber, repairType, itemName, description,
    labourCost, tools, totalToolsCost, date, remarks, status, paymentMethod
  } = req.body;

  const totalCost = (labourCost || 0) + (totalToolsCost || 0);
  const toolsJson = JSON.stringify(tools || []);

  try {
    const { rows } = await pool.query(`
      UPDATE maintenance_records SET
        technician_name = COALESCE($1, technician_name),
        contact_number = COALESCE($2, contact_number),
        repair_type = COALESCE($3, repair_type),
        item_name = COALESCE($4, item_name),
        description = COALESCE($5, description),
        labour_cost = COALESCE($6, labour_cost),
        tools = COALESCE($7, tools),
        total_tools_cost = COALESCE($8, total_tools_cost),
        total_cost = COALESCE($9, total_cost),
        task_date = COALESCE($10, task_date),
        remarks = COALESCE($11, remarks),
        status = COALESCE($12, status),
        payment_method = COALESCE($13, payment_method),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING *
    `, [
      technicianName, contactNumber, repairType, itemName, description,
      labourCost, toolsJson, totalToolsCost, totalCost,
      date, remarks, status, paymentMethod, id
    ]);
    
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    
    const updatedTask = rows[0];
    updatedTask.tools = typeof updatedTask.tools === 'string' ? JSON.parse(updatedTask.tools) : (updatedTask.tools || []);
    await syncMaintenanceExpense(updatedTask);

    res.json(updatedTask);
  } catch (err) {
    console.error('Update record error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update task status only
app.put('/api/maintenance/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  try {
    const { rows } = await pool.query(`
      UPDATE maintenance_records SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *
    `, [status, id]);
    
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE maintenance record
app.delete('/api/maintenance/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM maintenance_records WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Task not found' });
    res.json({ message: 'Task deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// DAILY ACTIVITIES API
// ============================================================

// ============================================================
// STAFF ACTIVITIES API (Clean table - no conflicts)
// ============================================================

// Create staff_activities table
async function createStaffActivitiesTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_activities (
        id SERIAL PRIMARY KEY,
        activity_date DATE NOT NULL,
        tasks JSONB DEFAULT '[]'::jsonb,
        tasks_description TEXT,
        prepared_by VARCHAR(100) NOT NULL,
        remarks TEXT,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Staff activities table ready');
  } catch (err) {
    console.log('Staff activities table note:', err.message);
  }
}

// GET all staff activities (with filters)
app.get('/api/staff-activities', async (req, res) => {
  const { from, to, preparedBy } = req.query;
  let query = 'SELECT * FROM staff_activities WHERE 1=1';
  const params = [];
  let paramCount = 1;
  
  if (from) {
    query += ` AND activity_date >= $${paramCount++}::date`;
    params.push(from);
  }
  if (to) {
    query += ` AND activity_date <= $${paramCount++}::date`;
    params.push(to);
  }
  if (preparedBy) {
    query += ` AND prepared_by ILIKE $${paramCount++}`;
    params.push(`%${preparedBy}%`);
  }
  
  query += ' ORDER BY activity_date DESC, id DESC';
  
  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/staff-activities error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET single staff activity
app.get('/api/staff-activities/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM staff_activities WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Activity not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/staff-activities/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST create staff activity with tasks
app.post('/api/staff-activities', async (req, res) => {
  const { date, tasks, tasksDescription, preparedBy, remarks } = req.body;
  
  if (!date || !preparedBy) {
    return res.status(400).json({ error: 'Date and prepared by are required' });
  }
  
  const tasksJson = JSON.stringify(tasks || []);
  const finalDescription = tasksDescription || (tasks ? tasks.map(t => `${t.completed ? '✅' : '⏳'} ${t.description}`).join('\n') : '');
  
  try {
    const { rows } = await pool.query(`
      INSERT INTO staff_activities (activity_date, tasks, tasks_description, prepared_by, remarks, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [date, tasksJson, finalDescription, preparedBy, remarks || null, req.body.created_by || 'system']);
    
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update staff activity with tasks
app.put('/api/staff-activities/:id', async (req, res) => {
  const { id } = req.params;
  const { date, tasks, tasksDescription, preparedBy, remarks } = req.body;
  
  const tasksJson = JSON.stringify(tasks || []);
  const finalDescription = tasksDescription || (tasks ? tasks.map(t => `${t.completed ? '✅' : '⏳'} ${t.description}`).join('\n') : '');
  
  try {
    const { rows } = await pool.query(`
      UPDATE staff_activities SET
        activity_date = COALESCE($1, activity_date),
        tasks = COALESCE($2, tasks),
        tasks_description = COALESCE($3, tasks_description),
        prepared_by = COALESCE($4, prepared_by),
        remarks = COALESCE($5, remarks),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
    `, [date, tasksJson, finalDescription, preparedBy, remarks, id]);
    
    if (rows.length === 0) return res.status(404).json({ error: 'Activity not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE staff activity
app.delete('/api/staff-activities/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM staff_activities WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Activity not found' });
    res.json({ message: 'Activity deleted successfully' });
  } catch (err) {
    console.error('DELETE error:', err);
    res.status(500).json({ error: err.message });
  }
});



// ============================================================
// EXPENDITURES API
// ============================================================

// Create expenditures table
async function createExpendituresTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expenditures (
        id SERIAL PRIMARY KEY,
        expenditure_number VARCHAR(50) NOT NULL UNIQUE,
        category VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        amount INT NOT NULL,
        expenditure_date DATE NOT NULL,
        paid_to VARCHAR(100),
        payment_method VARCHAR(50) DEFAULT 'cash',
        receipt_number VARCHAR(100),
        remarks TEXT,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Expenditures table ready');
  } catch (err) {
    console.log('Expenditures table note:', err.message);
  }
}

// GET all expenditures
app.get('/api/expenditures', async (req, res) => {
  const { from, to, category } = req.query;
  let query = 'SELECT * FROM expenditures WHERE 1=1';
  const params = [];
  let paramCount = 1;
  
  if (from) {
    query += ` AND expenditure_date >= $${paramCount++}::date`;
    params.push(from);
  }
  if (to) {
    query += ` AND expenditure_date <= $${paramCount++}::date`;
    params.push(to);
  }
  if (category && category !== '') {
    query += ` AND category = $${paramCount++}`;
    params.push(category);
  }
  
  query += ' ORDER BY expenditure_date DESC, id DESC';
  
  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/expenditures error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET single expenditure
app.get('/api/expenditures/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM expenditures WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Expenditure not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create expenditure
app.post('/api/expenditures', async (req, res) => {
  const { date, expenditureNumber, category, description, amount, paidTo, paymentMethod, receiptNumber, remarks } = req.body;
  
  if (!date || !category || !description || !amount) {
    return res.status(400).json({ error: 'Date, category, description, and amount are required' });
  }
  
  try {
    const { rows } = await pool.query(`
      INSERT INTO expenditures (expenditure_number, category, description, amount, expenditure_date, paid_to, payment_method, receipt_number, remarks, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [expenditureNumber, category, description, amount, date, paidTo || null, paymentMethod || 'cash', receiptNumber || null, remarks || null, req.body.created_by || 'system']);
    
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /api/expenditures error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update expenditure
app.put('/api/expenditures/:id', async (req, res) => {
  const { id } = req.params;
  const { date, category, description, amount, paidTo, paymentMethod, receiptNumber, remarks } = req.body;
  
  try {
    const { rows } = await pool.query(`
      UPDATE expenditures SET
        category = COALESCE($1, category),
        description = COALESCE($2, description),
        amount = COALESCE($3, amount),
        expenditure_date = COALESCE($4, expenditure_date),
        paid_to = COALESCE($5, paid_to),
        payment_method = COALESCE($6, payment_method),
        receipt_number = COALESCE($7, receipt_number),
        remarks = COALESCE($8, remarks),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *
    `, [category, description, amount, date, paidTo, paymentMethod, receiptNumber, remarks, id]);
    
    if (rows.length === 0) return res.status(404).json({ error: 'Expenditure not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /api/expenditures/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE expenditure
app.delete('/api/expenditures/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM expenditures WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Expenditure not found' });
    res.json({ message: 'Expenditure deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// EXPENSES
// ============================================================

async function createExpensesTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        expense_number VARCHAR(50) NOT NULL UNIQUE,
        category VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        amount INT NOT NULL,
        expense_date DATE NOT NULL,
        payment_method VARCHAR(50) DEFAULT 'cash',
        paid_to VARCHAR(200),
        remarks TEXT,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Safe migration: add paid_to to existing databases that predate this column
    await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_to VARCHAR(200)`);
    console.log('✅ Expenses table ready');
  } catch (err) {
    console.log('Expenses table note:', err.message);
  }
}

// GET all expenses
app.get('/api/expenses', async (req, res) => {
  const { from, to, category } = req.query;
  let query = 'SELECT * FROM expenses WHERE 1=1';
  const params = [];
  let paramCount = 1;
  if (from) { query += ` AND expense_date >= $${paramCount++}::date`; params.push(from); }
  if (to)   { query += ` AND expense_date <= $${paramCount++}::date`; params.push(to); }
  if (category && category !== '') { query += ` AND category = $${paramCount++}`; params.push(category); }
  query += ' ORDER BY expense_date DESC, id DESC';
  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single expense
app.get('/api/expenses/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create expense
app.post('/api/expenses', async (req, res) => {
  const { date, expenseNumber, category, description, amount, paymentMethod, paidTo, remarks } = req.body;
  if (!date || !category || !description || !amount) {
    return res.status(400).json({ error: 'Date, category, description, and amount are required' });
  }
  try {
    const { rows } = await pool.query(`
      INSERT INTO expenses (expense_number, category, description, amount, expense_date, payment_method, paid_to, remarks, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `, [expenseNumber, category, description, parseInt(amount), date, paymentMethod || 'cash', paidTo || null, remarks || null, req.body.created_by || 'system']);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update expense
app.put('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  const { date, category, description, amount, paymentMethod, paidTo, remarks } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE expenses SET
        category = COALESCE($1, category),
        description = COALESCE($2, description),
        amount = COALESCE($3, amount),
        expense_date = COALESCE($4, expense_date),
        payment_method = COALESCE($5, payment_method),
        paid_to = $6,
        remarks = COALESCE($7, remarks),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 RETURNING *
    `, [category, description, amount ? parseInt(amount) : null, date, paymentMethod, paidTo || null, remarks, id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE expense
app.delete('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM expenses WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json({ message: 'Expense deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/profit-summary — date-filtered totals for profit report
app.get('/api/reports/profit-summary', async (req, res) => {
  const { from, to } = req.query;

  // Stay-date overlap: a reservation counts if its checkin..checkout range
  // overlaps the filter range, so e.g. a 2-4 Jul stay is included when filtering 3-4 Jul.
  const resParams = []; let resWhere = 'WHERE 1=1'; let rp = 1;
  if (from) { resWhere += ` AND checkout >= $${rp++}::date`; resParams.push(from); }
  if (to)   { resWhere += ` AND checkin <= $${rp++}::date`; resParams.push(to); }

  const salesParams = []; let salesWhere = 'WHERE 1=1'; let sp = 1;
  if (from) { salesWhere += ` AND order_date >= $${sp++}::date`; salesParams.push(from); }
  if (to)   { salesWhere += ` AND order_date < ($${sp++}::date + INTERVAL '1 day')`; salesParams.push(to); }

  const laundryParams = []; let laundryWhere = 'WHERE 1=1'; let lp = 1;
  if (from) { laundryWhere += ` AND service_date >= $${lp++}::date`; laundryParams.push(from); }
  if (to)   { laundryWhere += ` AND service_date < ($${lp++}::date + INTERVAL '1 day')`; laundryParams.push(to); }

  const expParams = []; let expWhere = 'WHERE 1=1'; let ep = 1;
  if (from) { expWhere += ` AND expense_date >= $${ep++}::date`; expParams.push(from); }
  if (to)   { expWhere += ` AND expense_date <= $${ep++}::date`; expParams.push(to); }

  try {
    const [reservations, bar, restaurant, laundry, expenses] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total), 0)::int AS total, COUNT(*)::int AS count FROM reservations ${resWhere}`, resParams),
      pool.query(`SELECT COALESCE(SUM(total_amount), 0)::int AS total, COUNT(*)::int AS count FROM sales_orders ${salesWhere} AND LOWER(pos_type) = 'bar'`, salesParams),
      pool.query(`SELECT COALESCE(SUM(total_amount), 0)::int AS total, COUNT(*)::int AS count FROM sales_orders ${salesWhere} AND LOWER(pos_type) = 'restaurant'`, salesParams),
      pool.query(`SELECT COALESCE(SUM(price), 0)::int AS total, COUNT(*)::int AS count FROM laundry_services ${laundryWhere}`, laundryParams),
      pool.query(`SELECT COALESCE(SUM(amount), 0)::int AS total, COUNT(*)::int AS count FROM expenses ${expWhere}`, expParams),
    ]);

    const reservationRevenue  = reservations.rows[0].total;
    const barRevenue          = bar.rows[0].total;
    const restaurantRevenue   = restaurant.rows[0].total;
    const housekeepingRevenue = laundry.rows[0].total;
    const totalExpenses       = expenses.rows[0].total;
    const totalSales          = reservationRevenue + barRevenue + restaurantRevenue + housekeepingRevenue;
    const profit              = totalSales - totalExpenses;

    res.json({
      reservationRevenue,
      reservationCount: reservations.rows[0].count,
      barRevenue,
      barCount: bar.rows[0].count,
      restaurantRevenue,
      restaurantCount: restaurant.rows[0].count,
      housekeepingRevenue,
      housekeepingCount: laundry.rows[0].count,
      totalSales,
      totalExpenses,
      expenseCount: expenses.rows[0].count,
      profit,
    });
  } catch (err) {
    console.error('Profit summary error:', err);
    res.status(500).json({ error: err.message });
  }
});