const { Pool } = require('pg');

let dbType = 'sqlite';
let pgPool = null;
let sqliteDb = null;
let sqlite3 = null;

// Initialize SQLite fallback database
try {
  sqlite3 = require('sqlite3');
  sqliteDb = new sqlite3.Database('./database.sqlite');
  console.log('🔌 Database: SQLite initialized (database.sqlite)');
  dbType = 'sqlite';
} catch (err) {
  console.warn('⚠️ SQLite3 native module error, fallback to mock DB:', err.message);
  dbType = 'mock';
}

// Initialize Postgres if DATABASE_URL is supplied
if (process.env.DATABASE_URL) {
  try {
    let rawUrl = process.env.DATABASE_URL.trim();
    let cleanUrl = rawUrl.replace(/([?&])channel_binding=[^&]*&?/g, '$1').replace(/[?&]$/, '');
    pgPool = new Pool({
      connectionString: cleanUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      max: 5
    });
    pgPool.on('error', (err) => {
      console.error('⚠️ Idle PostgreSQL pool client error (safe handled):', err.message);
    });
    dbType = 'postgres';
    console.log('🔌 Database: Configured for PostgreSQL (production)');
  } catch (err) {
    console.error('Failed to initialize Postgres pool, using fallback:', err.message);
  }
}

// Helper for SQLite queries
function querySqlite(sql, params = []) {
  return new Promise((resolve) => {
    const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
    if (isSelect) {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) {
          console.error('SQLite Query Error:', err.message, 'SQL:', sql);
          resolve([]);
        } else {
          resolve(rows || []);
        }
      });
    } else {
      sqliteDb.run(sql, params, function(err) {
        if (err) {
          console.error('SQLite Run Error:', err.message, 'SQL:', sql);
          resolve({ lastID: 1, changes: 0 });
        } else {
          resolve({ lastID: this ? this.lastID : 1, changes: this ? this.changes : 0 });
        }
      });
    }
  });
}

// Helper for Mock DB queries
function queryMock(sql, params = []) {
  const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
  if (isSelect) {
    return Promise.resolve([]);
  } else {
    return Promise.resolve({ lastID: 1, changes: 1 });
  }
}

// Unified query function with seamless fallback and timeout protection
async function query(sql, params = []) {
  if (dbType === 'postgres' && pgPool) {
    try {
      let pgSql = sql;
      let index = 1;
      while (pgSql.includes('?')) {
        pgSql = pgSql.replace('?', `$${index}`);
        index++;
      }
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('PostgreSQL Query Timeout')), 5000)
      );
      const res = await Promise.race([pgPool.query(pgSql, params), timeoutPromise]);
      return res.rows || [];
    } catch (err) {
      console.warn('⚠️ Postgres query warning/timeout:', err.message);
      if (sqliteDb) {
        return querySqlite(sql, params);
      }
      return queryMock(sql, params);
    }
  } else if (sqliteDb) {
    return querySqlite(sql, params);
  } else {
    return queryMock(sql, params);
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
        payout_key TEXT,
        status TEXT DEFAULT 'active',
        is_verified INTEGER DEFAULT 0,
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

    // 4. User Notifications Table
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

    // Dynamic Alter Columns for backwards compatibility
    const alterStatements = [
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS junior_admin_code TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_name TEXT DEFAULT 'Free Miner'",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_key TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified INTEGER DEFAULT 0",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS bank_name TEXT",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS account_number TEXT",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS account_name TEXT",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS crypto_address TEXT",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS crypto_network TEXT",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS fee_bank_name TEXT",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS fee_account_number TEXT",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS fee_account_name TEXT",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS fee_amount NUMERIC",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS telegram_link TEXT",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS whatsapp_link TEXT"
    ];
    for (const stmt of alterStatements) {
      try { await query(stmt); } catch (e) {}
    }

    // Seed default system settings if missing
    const defaultSettings = [
      {
        key: 'payment',
        value: JSON.stringify({ bankName: 'Kuda MFB', accountNumber: '2088598772', accountName: 'Christian|Ts Agent', paymentNotice: '' })
      },
      { key: 'secondBilling', value: JSON.stringify({ feeAmount: 35200 }) },
      { key: 'tasks', value: JSON.stringify({ tasksList: [] }) },
      { key: 'withdrawalStatus', value: JSON.stringify({ active: false }) },
      { key: 'paymentStatus', value: JSON.stringify({ active: false }) },
      { key: 'videoChallenge', value: JSON.stringify({ active: true }) },
      { key: 'payoutKeys', value: JSON.stringify({ price: 25000 }) },
      { key: 'redirects', value: JSON.stringify({ payoutSuccess: 'success.html', payoutFailed: 'payment-failed.html' }) }
    ];

    for (const s of defaultSettings) {
      try {
        const existing = await query('SELECT key FROM system_settings WHERE key = ?', [s.key]);
        if (!existing || existing.length === 0) {
          await query('INSERT INTO system_settings (key, value) VALUES (?, ?)', [s.key, s.value]);
        }
      } catch (e) {}
    }

    // One-time clean: delete non-key deposit/revenue receipts once to start from beginning as requested by admin
    try {
      const runFlag = await query("SELECT key FROM system_settings WHERE key = 'deposit_purged_2026'");
      if (!runFlag || runFlag.length === 0) {
        console.log('🧹 Running one-time deposit/revenue receipts purge...');
        await query(`
          DELETE FROM receipts 
          WHERE type NOT IN ('payout_key_purchase', 'payout', 'key', 'payoutKey', 'payout_key')
          AND LOWER(plan_name) NOT LIKE '%key%'
        `);
        await query("INSERT INTO system_settings (key, value) VALUES ('deposit_purged_2026', 'true')");
        console.log('🧹 One-time purge complete and flag set.');
      }
    } catch (e) {
      console.error('Error during one-time receipts purge:', e);
    }

    console.log('✅ Database schemas verified/initialized with defaults.');
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message);
  }
}

module.exports = {
  query,
  initDb,
  dbType: () => dbType
};

