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

    // 8. Login Videos Table
    await query(`
      CREATE TABLE IF NOT EXISTS login_videos (
        id INTEGER PRIMARY KEY,
        video_url TEXT,
        likes_count INTEGER DEFAULT 255700,
        favorites_count INTEGER DEFAULT 12000,
        shares_count INTEGER DEFAULT 8500,
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
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS whatsapp_link TEXT",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS telegram_active INTEGER DEFAULT 1",
      "ALTER TABLE junior_admins ADD COLUMN IF NOT EXISTS whatsapp_active INTEGER DEFAULT 1"
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

    // Seed default login videos if missing
    try {
      const existingVideos = await query('SELECT COUNT(*) AS cnt FROM login_videos');
      const videoCount = parseInt(existingVideos && existingVideos[0] ? (existingVideos[0].cnt || existingVideos[0].COUNT || existingVideos[0]['COUNT(*)'] || 0) : 0);
      if (videoCount === 0) {
        console.log("🌱 Seeding default login videos...");
        const defaultVideos = [
          { id: 1, url: 'https://assets.mixkit.co/videos/preview/mixkit-tree-with-yellow-flowers-against-the-sky-42861-large.mp4', likes: 255700, favorites: 12000, shares: 8500 },
          { id: 2, url: 'https://assets.mixkit.co/videos/preview/mixkit-abstract-laser-lights-background-42171-large.mp4', likes: 182400, favorites: 9800, shares: 6200 },
          { id: 3, url: 'https://assets.mixkit.co/videos/preview/mixkit-motion-graphics-of-a-bitcoin-rotating-42188-large.mp4', likes: 310500, favorites: 15400, shares: 11000 },
          { id: 4, url: 'https://assets.mixkit.co/videos/preview/mixkit-crypto-mining-concept-with-glowing-circuits-42217-large.mp4', likes: 220100, favorites: 10500, shares: 7400 }
        ];
        for (const v of defaultVideos) {
          await query(`
            INSERT INTO login_videos (id, video_url, likes_count, favorites_count, shares_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [v.id, v.url, v.likes, v.favorites, v.shares, new Date().toISOString()]);
        }
        console.log("🌱 Seeding default login videos complete!");
      }
    } catch (e) {
      console.error("❌ Seeding login videos error:", e);
    }

    // Seed restored receipts from user's screenshot if database receipts table is empty
    try {
      const existing = await query("SELECT COUNT(*) AS cnt FROM receipts");
      const currentCount = parseInt(existing && existing[0] ? (existing[0].cnt || existing[0].COUNT || existing[0]['COUNT(*)'] || 0) : 0);
      if (currentCount === 0) {
        console.log("🌱 Seeding restored receipts from screenshot...");
        const seeds = [
          { id: 'rc_seed_1', phone: '08032040543', name: 'FATIA MOTENIOLA OLAWALE', type: 'key', plan: 'Basic Key', amount: 8550, date: '7/26/2026, 12:48:25 PM' },
          { id: 'rc_seed_2', phone: '08104398181', name: 'JOSHUA EMMANUEL AYOMIDE', type: 'key', plan: 'Basic Key', amount: 8550, date: '7/26/2026, 12:46:34 PM' },
          { id: 'rc_seed_3', phone: '09040297203', name: 'BENJAMIN NWABUNWANNE CHIBUZOR', type: 'key', plan: 'Basic Key', amount: 8550, date: '7/26/2026, 1:23:12 PM' },
          { id: 'rc_seed_4', phone: '09025948934', name: 'BLESSING JOSEPH', type: 'key', plan: 'Standard Key', amount: 15500, date: '7/26/2026, 12:28:43 PM' },
          { id: 'rc_seed_5', phone: '09025948934', name: 'BLESSING JOSEPH', type: 'key', plan: 'Basic Key', amount: 8550, date: '7/26/2026, 12:22:54 PM' },
          { id: 'rc_seed_6', phone: '07073350533', name: 'CHIWENDU ANGELINA IMUCHUKWU', type: 'key', plan: 'Basic Key', amount: 8550, date: '7/26/2026, 12:16:02 PM' },
          { id: 'rc_seed_7', phone: '08113151262', name: 'OLAMIPOSI OLAKUNLE ALAFIA', type: 'key', plan: 'Basic Key', amount: 8550, date: '7/26/2026, 12:15:22 PM' },
          { id: 'rc_seed_8', phone: '08113151262', name: 'OLAMIPOSI OLAKUNLE ALAFIA', type: 'key', plan: 'Basic Key', amount: 8550, date: '7/26/2026, 12:07:51 PM' },
          { id: 'rc_seed_9', phone: '07045248158', name: 'AKINBOBOLA CELESTINAH REBECCA', type: 'key', plan: 'Basic Key', amount: 8550, date: '7/26/2026, 1:14:45 PM' },
          { id: 'rc_seed_10', phone: '09011231389', name: 'CHIBUEZE GABRIEL AGWU', type: 'key', plan: 'Basic Key', amount: 8550, date: '7/26/2026, 1:07:10 PM' },
          { id: 'rc_seed_11', phone: '08127029385', name: 'SAMUEL DAMILARE OMOLAJA', type: 'key', plan: 'Basic Key', amount: 8550, date: '7/26/2026, 10:04:35 PM' },
          { id: 'rc_seed_12', phone: '09048026341', name: 'BLESISNG ABEL', type: 'key', plan: 'Basic Key', amount: 8550, date: '7/26/2026, 10:02:38 PM' }
        ];
        for (const s of seeds) {
          await query(`
            INSERT INTO receipts (id, phone, user_name, type, plan_name, amount, receipt_image, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'pending', ?)
          `, [s.id, s.phone, s.name, s.type, s.plan, s.amount, s.date]);
        }
        console.log("🌱 Seeding complete!");
      }
    } catch(e) {
      console.error("❌ Seeding error:", e);
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

