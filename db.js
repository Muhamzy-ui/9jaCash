const { Pool } = require('pg');

let dbType = 'sqlite';
let pgPool = null;
let sqliteDb = null;

// Determine database type from environment variables
if (process.env.DATABASE_URL) {
  dbType = 'postgres';
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Neon/Render/Railway
  });
  console.log('🔌 Database: Connected to PostgreSQL (production)');
} else {
  let sqlite3;
  try {
    sqlite3 = require('sqlite3');
    dbType = 'sqlite';
    sqliteDb = new sqlite3.Database('./database.sqlite');
    console.log('🔌 Database: Connected to SQLite (local development: database.sqlite)');
  } catch (err) {
    console.error('Failed to load sqlite3 module, falling back to mock DB:', err.message);
    dbType = 'mock';
  }
}

// Unified query abstraction
function query(sql, params = []) {
  if (dbType === 'postgres') {
    // Translate standard SQL placeholders (?) to Postgres placeholders ($1, $2, etc.)
    let pgSql = sql;
    let index = 1;
    while (pgSql.includes('?')) {
      pgSql = pgSql.replace('?', `$${index}`);
      index++;
    }
    return pgPool.query(pgSql, params)
      .then(res => res.rows)
      .catch(err => {
        console.error('Postgres Query Error:', err.message, 'SQL:', pgSql);
        throw err;
      });
  } else if (dbType === 'sqlite') {
    return new Promise((resolve, reject) => {
      const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
      if (isSelect) {
        sqliteDb.all(sql, params, (err, rows) => {
          if (err) {
            console.error('SQLite Query Error:', err.message, 'SQL:', sql);
            reject(err);
          } else {
            resolve(rows);
          }
        });
      } else {
        sqliteDb.run(sql, params, function(err) {
          if (err) {
            console.error('SQLite Run Error:', err.message, 'SQL:', sql);
            reject(err);
          } else {
            resolve({ lastID: this.lastID, changes: this.changes });
          }
        });
      }
    });
  } else {
    // Mock database connection for production preview when DATABASE_URL is missing
    console.warn('⚠️ MOCK DB QUERY (No Postgres/SQLite loaded):', sql);
    const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
    if (isSelect) {
      // Return a basic mock response list so pages don't crash on select
      return Promise.resolve([]);
    } else {
      return Promise.resolve({ lastID: 1, changes: 1 });
    }
  }
}

// Table schemas initialization
async function initDb() {
  try {
    // 1. Users Table
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        phone TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        password TEXT,
        full_name TEXT,
        bank_name TEXT,
        account_number TEXT,
        balance NUMERIC DEFAULT 0,
        mining_power NUMERIC DEFAULT 1,
        total_mined NUMERIC DEFAULT 0,
        referred_by TEXT,
        junior_admin_code TEXT,
        plan_name TEXT DEFAULT 'Free Miner',
        status TEXT DEFAULT 'active',
        created_at TEXT
      )
    `);

    // 2. Withdrawals Table
    await query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id TEXT PRIMARY KEY,
        phone TEXT,
        full_name TEXT,
        amount NUMERIC,
        bank_name TEXT,
        account_number TEXT,
        status TEXT DEFAULT 'Pending',
        referred_by TEXT,
        created_at TEXT
      )
    `);

    // 3. Junior Admins Table
    await query(`
      CREATE TABLE IF NOT EXISTS junior_admins (
        email TEXT PRIMARY KEY,
        password TEXT,
        referral_code TEXT UNIQUE,
        bank_name TEXT,
        account_number TEXT,
        account_name TEXT,
        crypto_address TEXT,
        crypto_network TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT
      )
    `);

    // 4. User Notifications Table (Announcements & Payout Key Pushes)
    await query(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id TEXT PRIMARY KEY,
        phone TEXT,
        type TEXT,
        title TEXT,
        content TEXT,
        amount TEXT,
        created_at TEXT
      )
    `);

    // 5. Video Submissions Table
    await query(`
      CREATE TABLE IF NOT EXISTS video_submissions (
        id TEXT PRIMARY KEY,
        phone TEXT,
        video_url TEXT,
        status TEXT DEFAULT 'Pending',
        created_at TEXT
      )
    `);

    // 6. System Settings Table
    await query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // 7. Receipts Table
    await query(`
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        phone TEXT,
        user_name TEXT,
        type TEXT,
        plan_name TEXT,
        amount NUMERIC,
        receipt_image TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT
      )
    `);

    // Alter table schemas dynamically to support existing local databases
    try { await query("ALTER TABLE users ADD COLUMN junior_admin_code TEXT"); } catch(e) {}
    try { await query("ALTER TABLE users ADD COLUMN plan_name TEXT DEFAULT 'Free Miner'"); } catch(e) {}
    try { await query("ALTER TABLE users ADD COLUMN payout_key TEXT"); } catch(e) {}
    try { await query('ALTER TABLE junior_admins ADD COLUMN bank_name TEXT'); } catch(e) {}
    try { await query('ALTER TABLE junior_admins ADD COLUMN account_number TEXT'); } catch(e) {}
    try { await query('ALTER TABLE junior_admins ADD COLUMN account_name TEXT'); } catch(e) {}
    try { await query('ALTER TABLE junior_admins ADD COLUMN crypto_address TEXT'); } catch(e) {}
    try { await query('ALTER TABLE junior_admins ADD COLUMN crypto_network TEXT'); } catch(e) {}

    console.log('✅ Database schemas verified/initialized.');
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message);
  }
}

module.exports = {
  query,
  initDb,
  dbType: () => dbType
};
