// server.js – Steps Premium Suite API (FIXED DATE HANDLING + CLEAN URLs)
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { Pool } = require('pg');
const bcrypt  = require('bcrypt');

const pool    = require('./db/pool');
const app     = express();
const PORT    = process.env.PORT || 3000;

// ============================================================
// AUTO DATABASE SETUP - Runs on startup (ONLY ADDITION)
// ============================================================
async function setupDatabase() {
  console.log('🔄 Checking database setup...');
  if (!process.env.DATABASE_URL) return;
  
  const dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await dbPool.query(schema);
      console.log('✅ Database tables are ready!');
    }
  } catch (err) {
    console.log('⚠️ Database setup note:', err.message);
  } finally {
    await dbPool.end();
  }
}

// ============================================================
// ACTIVITY LOGGER FUNCTION - MUST BE DEFINED BEFORE ANY ROUTES
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

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// CLEAN URLS - Access pages without .html extension
// ============================================================

// List of all your HTML pages (without .html)
const pages = [
  'dashboard', 'dashboard1', 'reservations', 'apartments', 
  'apartments-list','apartments-list1', 'housekeeping', 'housekeeping-status', 'reports',
  'store-main','store-main1', 'store-outlets','store-outlets1', 'outlet-store', 'outlet-store1','store-housekeeping',
  'store-kitchen', 'store-public', 'users','users1', 'login','activity-logs' ,'register','back-office', 'index2', 'purchase-orders', 'goods-receipt', 'purchase-orders-reports', 'goods-receipt-reports', 'store-inventory-reports', 'point-of-sale', 'sales-report', 'add-reservation'
];

// Create routes for each page without .html extension
pages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', `${page}.html`));
  });
});

// Redirect root to dashboard
app.get('/', (req, res) => {
  res.redirect('/dashboard');
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
  const { name, type, maxAdults, emoji, color, ratePerNight } = req.body;
  if (!name || !type || !maxAdults || !ratePerNight) {
    return res.status(400).json({ error: 'Name, type, maxAdults, ratePerNight are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO apartments (name, type, max_adults, emoji, color, rate_per_night)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, type, maxAdults, emoji || '', color || '#2d9c6e', ratePerNight]
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

// ════════════════════════════════════════════════════════════════════════════
//  RESERVATIONS - FIXED DATE HANDLING
// ════════════════════════════════════════════════════════════════════════════

// GET /api/reservations – with checkout time info
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
    
    // Format dates as YYYY-MM-DD strings without timezone conversion
    const formattedRows = rows.map(row => ({
      ...row,
      checkin: row.checkin_str,
      checkout: row.checkout_str,
      checkoutTime: row.checkout_time_str || '11:00:00',
      currentStatus: row.current_status
    }));
    
    res.json(formattedRows.map(camelRes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reservations/:id
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
        TO_CHAR(r.checkout, 'YYYY-MM-DD') as checkout_str
      FROM reservations r
      JOIN apartments a ON a.id = r.apt_id
      WHERE r.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Reservation not found' });
    
    const row = rows[0];
    const formattedRow = {
      ...row,
      checkin: row.checkin_str,
      checkout: row.checkout_str
    };
    
    res.json(camelRes(formattedRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reservations – create new reservation
app.post('/api/reservations', async (req, res) => {
  let { aptId, guest, email, mobile, country, city, checkin, checkout, adults, children, rateType, total, checkoutTime, userId, username } = req.body;

  if (checkin) checkin = String(checkin).split('T')[0];
  if (checkout) checkout = String(checkout).split('T')[0];
  const finalCheckoutTime = checkoutTime || '11:00:00';

  if (!aptId || !guest || !email || !checkin || !checkout) {
    return res.status(400).json({ error: 'aptId, guest, email, checkin, checkout are required' });
  }
  if (checkin >= checkout) {
    return res.status(400).json({ error: 'checkout must be after checkin' });
  }

  try {
    const conflict = await pool.query(`
      SELECT id FROM reservations
      WHERE apt_id = $1
        AND checkin < $3::date
        AND (checkout + COALESCE(checkout_time, '11:00:00')) > ($2::date + $4::time)
    `, [aptId, checkin, checkout, finalCheckoutTime]);

    if (conflict.rows.length) {
      return res.status(409).json({ error: 'Apartment is already booked for those dates' });
    }

    const { rows } = await pool.query(`
      INSERT INTO reservations (apt_id, guest, email, mobile, country, city, checkin, checkout, checkout_time, adults, children, rate_type, total)
      VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9::time,$10,$11,$12,$13)
      RETURNING *
    `, [aptId, guest, email, mobile || null, country || null, city || null,
        checkin, checkout, finalCheckoutTime, adults || 1, children || 0, rateType || 'Full', total || 0]);

    const result = camelRes(rows[0]);
    
    const loggedInUserId = userId || req.body.userId || null;
    const loggedInUsername = username || req.body.username || req.body.created_by || guest || 'system';
    await logActivity(loggedInUserId, loggedInUsername, 'CREATE', 'reservation', result.id, null, result, req);
    
    res.status(201).json(result);
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/reservations/:id – update a reservation
app.put('/api/reservations/:id', async (req, res) => {
  let { aptId, guest, email, mobile, country, city, checkin, checkout, adults, children, rateType, total, userId, username } = req.body;
  
  if (checkin) checkin = String(checkin).split('T')[0];
  if (checkout) checkout = String(checkout).split('T')[0];

  try {
    const oldDataResult = await pool.query('SELECT * FROM reservations WHERE id = $1', [req.params.id]);
    if (oldDataResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    const oldData = oldDataResult.rows[0];
    
    if (aptId && checkin && checkout) {
      const conflict = await pool.query(`
        SELECT id FROM reservations
        WHERE apt_id   = $1
          AND id      != $4
          AND checkin  < $3::date
          AND checkout > $2::date
      `, [aptId, checkin, checkout, req.params.id]);

      if (conflict.rows.length) {
        return res.status(409).json({ error: 'Apartment is already booked for those dates' });
      }
    }

    const { rows } = await pool.query(`
      UPDATE reservations SET
        apt_id    = COALESCE($1,  apt_id),
        guest     = COALESCE($2,  guest),
        email     = COALESCE($3,  email),
        mobile    = COALESCE($4,  mobile),
        country   = COALESCE($5,  country),
        city      = COALESCE($6,  city),
        checkin   = COALESCE($7::date,  checkin),
        checkout  = COALESCE($8::date,  checkout),
        adults    = COALESCE($9,  adults),
        children  = COALESCE($10, children),
        rate_type = COALESCE($11, rate_type),
        total     = COALESCE($12, total)
      WHERE id = $13
      RETURNING *
    `, [aptId, guest, email, mobile, country, city, checkin, checkout, adults, children, rateType, total, req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Reservation not found' });
    
    const newData = rows[0];
    
    const loggedInUserId = userId || req.body.userId;
    const loggedInUsername = username || req.body.username || 'system';
    await logActivity(loggedInUserId, loggedInUsername, 'UPDATE', 'reservation', req.params.id, oldData, newData, req);
    
    res.json(camelRes(newData));
  } catch (err) {
    console.error('Error updating reservation:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/reservations/:id
app.delete('/api/reservations/:id', async (req, res) => {
  try {
    const oldDataResult = await pool.query('SELECT * FROM reservations WHERE id = $1', [req.params.id]);
    const oldData = oldDataResult.rows[0];
    
    const { rowCount } = await pool.query('DELETE FROM reservations WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Reservation not found' });
    
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
app.get('/api/reports/summary', async (req, res) => {
  const { from, to } = req.query;
  const conditions = [];
  const values     = [];
  if (from) { values.push(from); conditions.push(`r.checkout > $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`r.checkin <= $${values.length}`); }
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

// ════════════════════════════════════════════════════════════════════════════
//  HELPERS – snake_case → camelCase (FIXED DATE HANDLING)
// ════════════════════════════════════════════════════════════════════════════

function camelApt(r) {
  return {
    id:           r.id,
    name:         r.name,
    type:         r.type,
    maxAdults:    r.max_adults,
    emoji:        r.emoji,
    color:        r.color,
    ratePerNight: r.rate_per_night,
    occupied:     r.occupied ?? undefined,
  };
}

function camelRes(r) {
  return {
    id:        r.id,
    aptId:     r.apt_id,
    guest:     r.guest,
    email:     r.email,
    mobile:    r.mobile,
    country:   r.country,
    city:      r.city,
    checkin:   r.checkin,
    checkout:  r.checkout,
    adults:    r.adults,
    children:  r.children,
    rateType:  r.rate_type,
    total:     r.total,
    createdAt: r.created_at,
    aptName:   r.apt_name  ?? undefined,
    aptType:   r.apt_type  ?? undefined,
    aptEmoji:  r.apt_emoji ?? undefined,
    aptColor:  r.apt_color ?? undefined,
  };
}

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
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const username = email.split('@')[0];
    
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
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, username, email, password_hash, role, full_name FROM users WHERE email = $1',
      [email]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
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

// ── Start ────────────────────────────────────────────────────────────────────
// Run database setup, then start server
setupDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Steps PMS API running on http://localhost:${PORT}`);
    console.log(`📄 Clean URLs enabled - access pages without .html`);
    console.log(`   Example: http://localhost:${PORT}/dashboard`);
  });
});