// app.js — 9jaCash Express Application Router
// Contains all REST API endpoints for user and admin database management.
// Shared between local server.js and Netlify production serverless functions.
try { require('dotenv').config(); } catch(e) {}

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const db = require('./db');
const https = require('https');

// Helper to send emails via Resend API or SMTP fallback
function sendResendEmail(to, subject, html, retries = 3, delay = 1000) {
  // Skip placeholder derived emails
  if (!to || to.endsWith('@9jacash.com') || !to.includes('@')) {
    console.log(`[EMAIL SKIP] Placeholder or invalid email address: ${to}`);
    return Promise.resolve({ success: false, reason: 'skipped_placeholder' });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM || '9jaCash <onboarding@resend.dev>';

  // Preferred Path: Resend API
  if (resendApiKey && !resendApiKey.includes('placeholder') && resendApiKey.trim() !== '') {
    console.log(`[EMAIL OUTBOUND] Sending via Resend API to: ${to}`);
    const data = JSON.stringify({
      from: resendFrom,
      to: [to.trim()],
      subject: subject,
      html: html
    });

    const options = {
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey.trim()}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    return new Promise((resolve, reject) => {
      function attemptResend(remainingAttempts, currentDelay) {
        const req = https.request(options, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(body);
                console.log(`[RESEND SUCCESS] Email successfully delivered via Resend API! ID: ${parsed.id}`);
                resolve({ success: true, messageId: parsed.id });
              } catch (e) {
                console.log(`[RESEND SUCCESS] Delivered with unparseable response: ${body}`);
                resolve({ success: true });
              }
            } else {
              console.error(`[RESEND ERROR] Status: ${res.statusCode} | Body: ${body}`);
              if (remainingAttempts > 1) {
                console.warn(`[RESEND RETRY] Retrying in ${currentDelay}ms... (${remainingAttempts - 1} left)`);
                setTimeout(() => {
                  attemptResend(remainingAttempts - 1, currentDelay * 2);
                }, currentDelay);
              } else {
                reject(new Error(`Resend send failed: ${body}`));
              }
            }
          });
        });

        req.on('error', (err) => {
          console.error(`[RESEND CONN ERROR] Message: ${err.message}`);
          if (remainingAttempts > 1) {
            console.warn(`[RESEND RETRY] Retrying in ${currentDelay}ms... (${remainingAttempts - 1} left)`);
            setTimeout(() => {
              attemptResend(remainingAttempts - 1, currentDelay * 2);
            }, currentDelay);
          } else {
            reject(err);
          }
        });

        req.write(data);
        req.end();
      }

      attemptResend(retries, delay);
    });
  }

  // Fallback Path: SMTP (Gmail)
  const nodemailer = require('nodemailer');
  const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

  // Simulation Fallback: If no credentials are set, simulate the email
  if (!smtpUser || !smtpPass || smtpUser.includes('placeholder') || smtpPass.includes('placeholder')) {
    console.log(`[EMAIL SIMULATION] To: ${to} | Subject: ${subject}`);
    return Promise.resolve({ success: true, simulated: true });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: smtpUser,
      pass: smtpPass
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });

  const mailOptions = {
    from: `"9jaCash Alerts" <${smtpUser}>`,
    to: to.trim(),
    subject: subject,
    html: html
  };

  console.log(`[EMAIL OUTBOUND] Attempting send to: ${to} | Sender: ${smtpUser}`);

  return new Promise((resolve, reject) => {
    function attempt(remainingAttempts, currentDelay) {
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error(`[SMTP ERROR] to: ${to} | Code: ${error.code || 'N/A'} | Message: ${error.message}`);
          
          if (error.message.includes('535')) {
            console.error('[SMTP CRITICAL] Gmail Authentication failed. Check App Password or account security blocks.');
          } else if (error.message.includes('550')) {
            console.error('[SMTP CRITICAL] Mailbox unavailable or rejected by spam filters.');
          }

          if (remainingAttempts > 1) {
            console.warn(`[SMTP RETRY] Retrying in ${currentDelay}ms... (${remainingAttempts - 1} attempts left)`);
            setTimeout(() => {
              attempt(remainingAttempts - 1, currentDelay * 2);
            }, currentDelay);
          } else {
            reject(new Error(`SMTP send failed: ${error.message}`));
          }
        } else {
          console.log(`[SMTP SUCCESS] Email successfully delivered! MessageId: ${info.messageId} | Response: ${info.response}`);
          resolve({ success: true, messageId: info.messageId });
        }
      });
    }

    attempt(retries, delay);
  });
}

// Helper to compile professional brand-themed HTML templates
function compileEmailTemplate(title, bodyHtml, ctaText = '', ctaUrl = '', accentColor = '#6366f1') {
  const ctaButtonHtml = ctaText && ctaUrl ? `
    <div style="margin: 30px 0; text-align: center;">
      <a href="${ctaUrl}" style="display: inline-block; box-sizing: border-box; background: linear-gradient(135deg, ${accentColor}, #8b5cf6); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 700; font-size: 14px; text-align: center; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);">
        ${ctaText}
      </a>
    </div>
  ` : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #090d16; padding: 40px 20px; color: #f3f4f6; text-align: center;">
      <div style="max-width: 500px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 35px; text-align: left; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);">
        
        <!-- Brand Header -->
        <div style="margin-bottom: 25px; text-align: center; border-bottom: 1px solid #1f2937; padding-bottom: 20px;">
          <span style="font-size: 24px; font-weight: 800; letter-spacing: -0.5px; background: linear-gradient(135deg, #818cf8, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">9jaCash</span>
        </div>

        <h2 style="font-size: 18px; font-weight: 700; color: #ffffff; margin-top: 0; margin-bottom: 15px; line-height: 1.3;">${title}</h2>
        
        <div style="font-size: 14px; color: #9ca3af; line-height: 1.6; margin-bottom: 20px;">
          ${bodyHtml}
        </div>

        ${ctaButtonHtml}

        <hr style="border: 0; border-top: 1px solid #1f2937; margin: 25px 0;">
        
        <!-- Footer -->
        <div style="text-align: center; font-size: 11px; color: #4b5563; line-height: 1.5;">
          <p style="margin: 0 0 4px 0;">© ${new Date().getFullYear()} 9jaCash Inc. All rights reserved.</p>
          <p style="margin: 0;">This is a secure system transaction alert. Please do not reply directly.</p>
        </div>

      </div>
    </div>
  `;
}

function getBaseUrl(req) {
  const protocol = req.secure ? 'https' : 'http';
  return `${protocol}://${req.headers.host}`;
}

const app = express();

// Initialize tables automatically
db.initDb();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
const path = require('path');
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// ─── BANK RESOLVER CACHE ──────────────────────────────────────────────────
let banksCache = [];
let banksCachedAt = 0;
const BANKS_CACHE_TTL = 24 * 60 * 60 * 1000;

async function getBankList() {
  const now = Date.now();
  if (banksCache.length > 0 && now - banksCachedAt < BANKS_CACHE_TTL) {
    return banksCache;
  }
  try {
    const res = await fetch('https://api.paystack.co/bank?country=nigeria&perPage=300', {
      headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}` }
    });
    const data = await res.json();
    if (data.status && Array.isArray(data.data)) {
      banksCache = data.data
        .filter(b => b.active && !b.is_deleted)
        .map(b => ({ code: b.code, name: b.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      banksCachedAt = now;
    }
  } catch (err) {
    console.error('Failed to load banks from Paystack:', err.message);
  }
  return banksCache;
}

// ─── API ROUTES ─────────────────────────────────────────────────────────────

// GET /api/banks — Load banks list
app.get('/api/banks', async (req, res) => {
  try {
    const banks = await getBankList();
    res.json({ status: true, banks });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to load bank list' });
  }
});

// POST /api/verify-account — Resolve account name via Paystack
app.post('/api/verify-account', async (req, res) => {
  const { account_number, bank_code } = req.body || {};
  if (!account_number || !/^\d{10}$/.test(account_number)) {
    return res.status(400).json({ status: false, error: 'Invalid account number.' });
  }
  if (!bank_code) {
    return res.status(400).json({ status: false, error: 'Bank selection is required.' });
  }

  const MOCK_ACCOUNTS = {
    '1028627906_057': { status: true, account_name: 'CHIDUBEM TIMOTHY IJENDU', account_number: '1028627906', bank_code: '057' },
    '7039995946_999992': { status: true, account_name: 'CHIDUBEM TIMOTHY IJENDU', account_number: '7039995946', bank_code: '999992' },
    '2028019932_033': { status: true, account_name: 'ONYEKA KENNETH', account_number: '2028019932', bank_code: '033' },
  };

  const mockKey = `${account_number}_${bank_code}`;
  if (MOCK_ACCOUNTS[mockKey]) {
    return res.json({ ...MOCK_ACCOUNTS[mockKey], cached: false, mocked: true });
  }

  // Developer Fallback: If no Paystack key is loaded locally, auto-generate a valid mock response
  if (!PAYSTACK_SECRET_KEY || PAYSTACK_SECRET_KEY.includes('YOUR_PAYSTACK') || PAYSTACK_SECRET_KEY.includes('placeholder') || PAYSTACK_SECRET_KEY === 'YOUR_PAYSTACK_KEY') {
    return res.json({
      status: true,
      account_name: 'DEV TEST (' + account_number.substring(0, 4) + '...)',
      account_number: account_number,
      bank_code,
      mocked: true
    });
  }

  try {
    const paystackRes = await fetch(
      `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
      { headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}` } }
    );
    const paystackData = await paystackRes.json();
    if (paystackRes.ok && paystackData.status && paystackData.data?.account_name) {
      return res.json({
        status: true,
        account_name: paystackData.data.account_name,
        account_number: paystackData.data.account_number,
        bank_code
      });
    }
    return res.status(422).json({ status: false, error: paystackData.message || 'Could not resolve account name.' });
  } catch (err) {
    return res.status(500).json({ status: false, error: 'Verification service offline.' });
  }
});

async function findJuniorAdminCode(referredBy) {
  if (!referredBy) return null;
  const refClean = referredBy.trim().toUpperCase();
  try {
    // 1. Check if referredBy is a junior admin referral code (case-insensitive)
    const ja = await db.query('SELECT referral_code FROM junior_admins WHERE UPPER(referral_code) = ?', [refClean]);
    if (ja.length > 0) {
      return ja[0].referral_code;
    }

    // 2. Otherwise, check if referredBy is a regular user's phone number
    const u = await db.query('SELECT referred_by, junior_admin_code FROM users WHERE phone = ?', [refClean]);
    if (u.length > 0) {
      if (u[0].junior_admin_code) {
        return u[0].junior_admin_code;
      }
      // Recursively trace up parent chain (limit depth to 10 to avoid infinite loops)
      let parent = u[0].referred_by;
      for (let depth = 0; depth < 10; depth++) {
        if (!parent) break;
        const jaParent = await db.query('SELECT referral_code FROM junior_admins WHERE referral_code = ?', [parent]);
        if (jaParent.length > 0) {
          return jaParent[0].referral_code;
        }
        const uParent = await db.query('SELECT referred_by FROM users WHERE phone = ?', [parent]);
        if (uParent.length > 0) {
          parent = uParent[0].referred_by;
        } else {
          break;
        }
      }
    }
  } catch(e) {
    console.error('Error in findJuniorAdminCode:', e.message);
  }
  return null;
}

// Helper to map database underscore properties to camelCase properties for frontend compatibility
function mapUserKeys(u) {
  if (!u) return null;
  return {
    phone: u.phone,
    email: u.email,
    fullName: u.full_name,
    name: u.full_name,
    bankName: u.bank_name,
    accountNumber: u.account_number,
    balance: parseFloat(u.balance) || 0,
    miningPower: parseFloat(u.mining_power) || 1,
    totalMined: parseFloat(u.total_mined) || 0,
    planName: u.plan_name || 'Free Miner',
    payoutKey: u.payout_key,
    juniorAdminCode: u.junior_admin_code || null,
    referredBy: u.referred_by,
    status: u.status,
    createdAt: u.created_at
  };
}

// POST /api/register — User signup
app.post('/api/register', async (req, res) => {
  const { phone, email, password, fullName, bankName, accountNumber, promoCode, promoBonus, referredBy } = req.body || {};
  
  if (!phone || phone.length !== 11) {
    return res.status(400).json({ status: false, error: 'Phone must be 11 digits' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ status: false, error: 'Password must be at least 6 characters' });
  }
  if (!fullName) {
    return res.status(400).json({ status: false, error: 'Full name is required' });
  }

  if (!email || !email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ status: false, error: 'A valid email address is required' });
  }

  const finalEmail = email;

  try {
    // Check if phone or email already registered
    const existing = await db.query('SELECT phone, email FROM users WHERE phone = ? OR email = ?', [phone, finalEmail]);
    if (existing.length > 0) {
      return res.status(409).json({ status: false, error: 'Phone number or Email is already registered' });
    }

    const createdAt = new Date().toISOString();
    const juniorAdminCode = await findJuniorAdminCode(referredBy);
    
    // Insert into database
    await db.query(`
      INSERT INTO users (
        phone, email, password, full_name, bank_name, account_number, 
        balance, mining_power, total_mined, referred_by, junior_admin_code, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [phone, finalEmail, password, fullName, bankName, accountNumber, 0, 1, 0, referredBy || null, juniorAdminCode, 'active', createdAt]);

    // Fetch new user doc to return
    const users = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);

    // Send welcome email if they registered with a real email
    if (finalEmail && !finalEmail.endsWith('@9jacash.com')) {
      try {
        const welcomeHtml = compileEmailTemplate(
          "Account Activated! 🎉",
          `<p>Hi ${fullName || 'User'},</p>
           <p>Welcome to <strong>9jaCash</strong>! Your account has been successfully created and activated.</p>
           <p>You can now start mining, completing tasks, and earning daily rewards.</p>`,
          "Go to Dashboard",
          `${getBaseUrl(req)}/dashboard.html`,
          "#10b981"
        );
        await sendResendEmail(finalEmail, "Welcome to 9jaCash — Account Activated! 🎉", welcomeHtml);
      } catch (emailErr) {
        console.error('Failed to send registration welcome email:', emailErr.message);
      }
    }

    res.status(201).json({ status: true, user: mapUserKeys(users[0]) });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ status: false, error: 'Registration failed' });
  }
});

// POST /api/login — User login (supports Phone OR Email)
app.post('/api/login', async (req, res) => {
  const { phoneOrEmail, password } = req.body || {};
  if (!phoneOrEmail || !password) {
    return res.status(400).json({ status: false, error: 'Credentials are required' });
  }

  try {
    const adminPass = process.env.ADMIN_PASSWORD || '9jaCashAdminMasterSecretCode1083';
    if (phoneOrEmail === 'admin@9jacash.com' && password === adminPass) {
      return res.json({
        status: true,
        user: {
          phone: 'admin',
          email: 'admin@9jacash.com',
          full_name: 'Super Admin',
          fullName: 'Super Admin',
          balance: 999999,
          status: 'active'
        }
      });
    }

    const users = await db.query('SELECT * FROM users WHERE (phone = ? OR email = ?) AND password = ?', [phoneOrEmail, phoneOrEmail, password]);
    if (users.length === 0) {
      return res.status(401).json({ status: false, error: 'Invalid phone/email or password.' });
    }

    const user = users[0];
    if (user.status === 'suspended') {
      return res.status(403).json({ status: false, error: 'Account suspended. Contact support.' });
    }

    res.json({ status: true, user: mapUserKeys(user) });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ status: false, error: 'Login execution failed' });
  }
});

// POST /api/user/sync — Fetch fresh user stats with recovery and verification checks
app.post('/api/user/sync', async (req, res) => {
  const { phone, balance, totalMined } = req.body || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone required' });
  try {
    const users = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
    const localBalance = parseFloat(balance) || 0;
    const localTotalMined = parseFloat(totalMined) || 0;

    let dbUser;
    if (users.length === 0) {
      // Auto-migrate: create user row with frontend's local stats if available
      await db.query(`
        INSERT INTO users (phone, email, password, full_name, balance, total_mined, status, created_at)
        VALUES (?, ?, '123456', '9jaCash User', ?, ?, 'active', ?)
      `, [phone, `${phone}@9jacash.com`, localBalance, localTotalMined, new Date().toISOString()]);
      const newUsers = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
      dbUser = newUsers[0];
    } else {
      dbUser = users[0];
      let dbBalance = parseFloat(dbUser.balance) || 0;
      let dbTotalMined = parseFloat(dbUser.total_mined) || 0;
      let needsUpdate = false;

      // Restore/recover balance if local storage is higher than DB balance
      if (localBalance > dbBalance) {
        dbBalance = localBalance;
        needsUpdate = true;
      }
      if (localTotalMined > dbTotalMined) {
        dbTotalMined = localTotalMined;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await db.query('UPDATE users SET balance = ?, total_mined = ? WHERE phone = ?', [dbBalance, dbTotalMined, phone]);
        const updatedUsers = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
        dbUser = updatedUsers[0];
      }
    }

    // Determine verification status, withdrawal count, and if they have bounced before
    const rejectedWithdrawals = await db.query("SELECT COUNT(*) AS count FROM withdrawals WHERE phone = ? AND status = 'Rejected'", [phone]);
    const hasBouncedBefore = parseInt(rejectedWithdrawals[0].count || rejectedWithdrawals[0]['COUNT(*)'] || 0) > 0;

    const withdrawalsResult = await db.query('SELECT COUNT(*) AS count FROM withdrawals WHERE phone = ?', [phone]);
    const withdrawalCount = parseInt(withdrawalsResult[0].count || withdrawalsResult[0]['COUNT(*)'] || 0);

    const verificationResult = await db.query(
      "SELECT COUNT(*) AS count FROM receipts WHERE phone = ? AND type = 'account_verification' AND status = 'approved'", 
      [phone]
    );
    const verified = parseInt(verificationResult[0].count || verificationResult[0]['COUNT(*)'] || 0) > 0;

    const mapped = mapUserKeys(dbUser);
    mapped.hasBouncedBefore = hasBouncedBefore;
    mapped.withdrawalCount = withdrawalCount;
    mapped.verified = verified;

    res.json({ status: true, user: mapped });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Sync failed' });
  }
});

// POST /api/user/bounce — Mark latest pending withdrawal as Rejected (bounced) in DB
app.post('/api/user/bounce', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone required' });
  try {
    const list = await db.query("SELECT id FROM withdrawals WHERE phone = ? AND status = 'Pending' ORDER BY created_at DESC LIMIT 1", [phone]);
    if (list.length > 0) {
      await db.query("UPDATE withdrawals SET status = 'Rejected' WHERE id = ?", [list[0].id]);
      console.log(`Withdrawal ${list[0].id} marked as Rejected (bounced) for user ${phone}`);
    }
    res.json({ status: true, message: 'Latest withdrawal marked as Rejected' });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to record bounce' });
  }
});

// POST /api/user/link-email — Connect a Gmail address to an active account
app.post('/api/user/link-email', async (req, res) => {
  const { phone, password, email } = req.body || {};
  if (!phone || !email) {
    return res.status(400).json({ status: false, error: 'Phone and Email are required' });
  }

  if (!email.includes('@') || email.length < 5) {
    return res.status(400).json({ status: false, error: 'Invalid email address' });
  }

  try {
    // SECURITY: Authenticate request using user password
    const userList = await db.query('SELECT password FROM users WHERE phone = ?', [phone]);
    if (userList.length === 0) return res.status(404).json({ status: false, error: 'User not found' });
    if (password && userList[0].password !== password) {
      return res.status(401).json({ status: false, error: 'Unauthorized' });
    }

    // Check if email already registered to someone else
    const existing = await db.query('SELECT phone FROM users WHERE email = ? AND phone != ?', [email, phone]);
    if (existing.length > 0) {
      return res.status(409).json({ status: false, error: 'Email is already linked to another account' });
    }

    await db.query('UPDATE users SET email = ? WHERE phone = ?', [email, phone]);
    const users = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
    const u = users[0];
    
    // Trigger Welcome Email alert
    const welcomeHtml = compileEmailTemplate(
      "Welcome to 9jaCash! ⛏️",
      `<p>Hi ${u.full_name || 'User'},</p>
       <p>Your Gmail address has been successfully linked to your 9jaCash account (Phone: <strong>${phone}</strong>).</p>
       <p>You will now receive secure real-time notifications about your withdrawals, plan upgrades, and payout key delivery straight to your inbox.</p>
       <p>Click the button below to log into your dashboard, claim your rewards, and start mining.</p>`,
      "Go to Dashboard",
      `${getBaseUrl(req)}/dashboard.html`,
      "#6366f1"
    );
    try {
      await sendResendEmail(email, "Welcome to 9jaCash — Account Activated! 🎉", welcomeHtml);
    } catch (err) {
      console.error("Welcome email failed:", err);
    }

    res.json({ status: true, user: mapUserKeys(u), message: 'Email linked successfully' });
  } catch (err) {
    console.error('Link email error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to link email' });
  }
});

// POST /api/user/update-bank — Connect bank details to an active account
app.post('/api/user/update-bank', async (req, res) => {
  const { phone, password, bankName, accountNumber } = req.body || {};
  if (!phone || !bankName || !accountNumber) {
    return res.status(400).json({ status: false, error: 'Phone, Bank Name and Account Number are required' });
  }
  
  try {
    // SECURITY: Authenticate request using user password
    const userList = await db.query('SELECT password FROM users WHERE phone = ?', [phone]);
    if (userList.length === 0) return res.status(404).json({ status: false, error: 'User not found' });
    if (password && userList[0].password !== password) {
      return res.status(401).json({ status: false, error: 'Unauthorized' });
    }

    await db.query('UPDATE users SET bank_name = ?, account_number = ? WHERE phone = ?', [bankName, accountNumber, phone]);
    const users = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
    res.json({ status: true, user: mapUserKeys(users[0]), message: 'Bank details updated successfully' });
  } catch (err) {
    console.error('Update bank error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to update bank details' });
  }
});

// POST /api/user/update-balance — Updates user balance (mining/checkin/claim etc.)
app.post('/api/user/update-balance', async (req, res) => {
  const { phone, password, balance, totalMined, adminSecret } = req.body || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone required' });
  try {
    // SECURITY: Authenticate request using user password OR admin secret
    const ADMIN_SECRET = process.env.ADMIN_SECRET || '9jaCashAdminMasterSecretCode1083';
    if (adminSecret && adminSecret === ADMIN_SECRET) {
      // Admin bypass
    } else {
      const userList = await db.query('SELECT password FROM users WHERE phone = ?', [phone]);
      if (userList.length > 0 && password && userList[0].password !== password) {
        return res.status(401).json({ status: false, error: 'Unauthorized' });
      }
    }

    const existing = await db.query('SELECT phone, balance, total_mined FROM users WHERE phone = ?', [phone]);
    let finalBalance = balance;
    if (existing.length === 0) {
      // Auto-migrate: create user row with correct balance
      await db.query(`
        INSERT INTO users (phone, email, password, full_name, balance, total_mined, status, created_at)
        VALUES (?, ?, '123456', '9jaCash User', ?, ?, 'active', ?)
      `, [phone, `${phone}@9jacash.com`, balance, totalMined, new Date().toISOString()]);
    } else {
      const dbBalance = parseFloat(existing[0].balance) || 0;
      if (dbBalance > balance && !(adminSecret && adminSecret === ADMIN_SECRET)) {
        // Protect higher database balance (e.g. from admin verification approval or bounce)
        const dbTotalMined = parseFloat(existing[0].total_mined) || 0;
        const miningIncrement = Math.max(0, totalMined - dbTotalMined);
        finalBalance = dbBalance + miningIncrement;
      }
      await db.query('UPDATE users SET balance = ?, total_mined = ? WHERE phone = ?', [finalBalance, totalMined, phone]);
    }
    res.json({ status: true, message: 'Balance updated successfully', balance: finalBalance });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Balance update failed' });
  }
});

// POST /api/user/update-plan-power — Upgrades a user's plan and mining power (called by Admin / Junior Admin)
app.post('/api/user/update-plan-power', async (req, res) => {
  const { phone, plan, miningPower, adminSecret } = req.body || {};
  if (!phone || !plan || !miningPower) {
    return res.status(400).json({ status: false, error: 'Missing parameters' });
  }

  const ADMIN_SECRET = process.env.ADMIN_SECRET || '9jaCashAdminMasterSecretCode1083';
  if (!adminSecret || adminSecret !== ADMIN_SECRET) {
    return res.status(401).json({ status: false, error: 'Unauthorized admin request' });
  }

  try {
    // Check if user exists
    const users = await db.query('SELECT phone FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) {
      return res.status(404).json({ status: false, error: 'User not found' });
    }

    // Update in database
    await db.query('UPDATE users SET plan_name = ?, mining_power = ? WHERE phone = ?', [plan, miningPower, phone]);
    res.json({ status: true, message: `Plan upgraded to ${plan} with ${miningPower}x power` });
  } catch (err) {
    console.error('Update plan power error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to update plan power' });
  }
});

// POST /api/user/stake-spin — Stake wallet balance and spin the wheel
app.post('/api/user/stake-spin', async (req, res) => {
  const { phone, stakeAmount } = req.body || {};
  const stake = parseFloat(stakeAmount);

  if (!phone || isNaN(stake) || stake < 100) {
    return res.status(400).json({ status: false, error: 'Stake amount must be at least ₦100' });
  }

  try {
    // 1. Fetch user document
    const users = await db.query('SELECT balance, email, full_name FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) {
      return res.status(404).json({ status: false, error: 'User not found' });
    }

    const user = users[0];
    const balance = parseFloat(user.balance) || 0;

    if (balance < stake) {
      return res.status(400).json({ status: false, error: 'Insufficient balance to place stake' });
    }

    // 2. 18 Multiplier Wheel Segments with balanced weights
    const segments = [
      { mult: 0, weight: 28.0 },   // 0x (Bomb/Lose) - slightly higher loss rate as requested
      { mult: 0.2, weight: 10.0 }, // 0.2x
      { mult: 0.5, weight: 12.0 }, // 0.5x
      { mult: 0.8, weight: 8.0 },  // 0.8x
      { mult: 1, weight: 10.0 },   // 1x
      { mult: 1.2, weight: 6.0 },  // 1.2x
      { mult: 1.5, weight: 5.0 },  // 1.5x
      { mult: 2, weight: 4.0 },    // 2x
      { mult: 2.5, weight: 3.0 },  // 2.5x
      { mult: 3, weight: 2.5 },    // 3x
      { mult: 3.5, weight: 2.0 },  // 3.5x
      { mult: 4, weight: 1.5 },    // 4x
      { mult: 5, weight: 1.2 },    // 5x
      { mult: 6, weight: 1.0 },    // 6x
      { mult: 8, weight: 0.8 },    // 8x - much more likely jackpot
      { mult: 10, weight: 0.6 },   // 10x - much more likely
      { mult: 20, weight: 0.4 },   // 20x - much more likely
      { mult: 100, weight: 0.2 }   // 100x - much more likely jackpot!
    ];

    // 3. Roll the multiplier based on weight distribution
    const totalWeight = segments.reduce((sum, s) => sum + s.weight, 0);
    let roll = Math.random() * totalWeight;
    let selectedSegmentIndex = 0;
    let multiplier = 0;

    for (let i = 0; i < segments.length; i++) {
      roll -= segments[i].weight;
      if (roll <= 0) {
        selectedSegmentIndex = i;
        multiplier = segments[i].mult;
        break;
      }
    }

    // 4. Calculate payouts and update balance
    const payoutAmount = Math.round(stake * multiplier);
    const newBalance = Math.max(0, balance - stake + payoutAmount);

    // 5. Update user record in database
    await db.query('UPDATE users SET balance = ? WHERE phone = ?', [newBalance, phone]);

    // 6. Log transaction notification
    const msgId = 'nt_' + Math.random().toString(36).substr(2, 9);
    const title = multiplier === 0 ? '💣 Stake & Spin Lost' : '🎉 Stake & Spin Won!';
    const content = multiplier === 0
      ? `You staked ₦${stake.toLocaleString()} on the Spin Wheel and hit the BOMB! Better luck next time!`
      : `Congratulations! You staked ₦${stake.toLocaleString()} and hit a ${multiplier}x multiplier, winning ₦${payoutAmount.toLocaleString()}!`;
    
    await db.query(`
      INSERT INTO user_notifications (id, phone, type, title, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [msgId, phone, multiplier === 0 ? 'alert' : 'message', title, content, new Date().toISOString()]);

    res.json({
      status: true,
      multiplier,
      payoutAmount,
      newBalance,
      segmentIndex: selectedSegmentIndex
    });
  } catch (err) {
    console.error('Stake & Spin error:', err.message);
    res.status(500).json({ status: false, error: 'An error occurred during your spin' });
  }
});

// POST /api/withdraw — Submit a withdrawal request
app.post('/api/withdraw', async (req, res) => {
  const { phone, amount, bankName, accountNumber, fullName } = req.body || {};
  if (!phone || !amount || !bankName || !accountNumber || !fullName) {
    return res.status(400).json({ status: false, error: 'Missing withdrawal parameters' });
  }

  try {
    // Check user balance and retrieve email
    const users = await db.query('SELECT balance, email, referred_by FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) return res.status(404).json({ status: false, error: 'User not found' });

    const user = users[0];

    // Enforce account verification on 3rd withdrawal (after 2 successful/requested withdrawals)
    const withdrawalCountResult = await db.query('SELECT COUNT(*) AS count FROM withdrawals WHERE phone = ?', [phone]);
    const withdrawalCount = parseInt(withdrawalCountResult[0].count || withdrawalCountResult[0]['COUNT(*)'] || 0);

    if (withdrawalCount >= 2) {
      const verificationCountResult = await db.query(
        "SELECT COUNT(*) AS count FROM receipts WHERE phone = ? AND type = 'account_verification' AND status = 'approved'", 
        [phone]
      );
      const verificationCount = parseInt(verificationCountResult[0].count || verificationCountResult[0]['COUNT(*)'] || 0);

      if (verificationCount === 0) {
        return res.status(403).json({ 
          status: false, 
          error: 'verification_required', 
          message: 'You have completed 2 withdrawals. Please verify your account before initiating your third withdrawal.' 
        });
      }
    }

    if (user.balance < amount) return res.status(400).json({ status: false, error: 'Insufficient balance' });

    // Deduct balance
    const newBalance = parseFloat(user.balance) - parseFloat(amount);
    await db.query('UPDATE users SET balance = ? WHERE phone = ?', [newBalance, phone]);

    // Insert withdrawal record
    const withdrawalId = 'W' + Date.now();
    await db.query(`
      INSERT INTO withdrawals (
        id, phone, full_name, amount, bank_name, account_number, status, referred_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [withdrawalId, phone, fullName, amount, bankName, accountNumber, 'Pending', user.referred_by || null, new Date().toISOString()]);

    // Send email alert in background
    if (user.email) {
      const withdrawalHtml = compileEmailTemplate(
        "Withdrawal Request Received",
        `<p>Hi ${fullName || 'User'},</p>
         <p>We have received your request to withdraw funds to your bank account. Here are the transfer details:</p>
         <div style="background-color: #1f2937; border-radius: 8px; padding: 15px; margin: 15px 0;">
           <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #9ca3af;">
             <tr><td style="padding: 4px 0;"><strong>Bank Name:</strong></td><td style="text-align: right; color: #f3f4f6;">${bankName}</td></tr>
             <tr><td style="padding: 4px 0;"><strong>Account Number:</strong></td><td style="text-align: right; color: #f3f4f6;">${accountNumber}</td></tr>
             <tr><td style="padding: 4px 0;"><strong>Reference ID:</strong></td><td style="text-align: right; color: #f3f4f6; font-family: monospace;">${withdrawalId}</td></tr>
             <tr><td style="padding: 4px 0;"><strong>Amount:</strong></td><td style="text-align: right; color: #10b981; font-weight: 700;">₦${parseFloat(amount).toLocaleString()}</td></tr>
           </table>
         </div>
         <p>Your request is currently <strong>Pending</strong> review by our team. We will notify you as soon as the funds are approved and credited.</p>`,
        "View Account History",
        `${getBaseUrl(req)}/dashboard.html`,
        "#f59e0b"
      );
      try {
        await sendResendEmail(user.email, "Withdrawal Request Received — Pending Approval", withdrawalHtml);
      } catch (err) {
        console.error("Withdrawal pending email failed:", err);
      }
    }

    res.json({ status: true, message: 'Withdrawal submitted successfully', newBalance });
  } catch (err) {
    console.error('Withdrawal error:', err.message);
    res.status(500).json({ status: false, error: 'Withdrawal processing failed' });
  }
});

// GET /api/user/withdrawals — Fetch live list of withdrawals for a user
app.get('/api/user/withdrawals', async (req, res) => {
  const { phone } = req.query || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone parameter required' });
  try {
    const list = await db.query('SELECT * FROM withdrawals WHERE phone = ? ORDER BY created_at DESC LIMIT 10', [phone]);
    res.json({ status: true, withdrawals: list });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to fetch withdrawals' });
  }
});

// ─── JUNIOR ADMIN ENDPOINTS ─────────────────────────────────────────────────

// POST /api/admin/junior/login — Auth for Junior Admin
app.post('/api/admin/junior/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ status: false, error: 'Email and password required' });
  }

  try {
    const list = await db.query('SELECT * FROM junior_admins WHERE email = ? AND password = ? AND is_active = 1', [email, password]);
    if (list.length === 0) {
      return res.status(401).json({ status: false, error: 'Invalid Junior Admin credentials.' });
    }
    res.json({ status: true, junior: list[0] });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Junior admin login error' });
  }
});

// GET /api/admin/junior/users — Fetch referred users (with payout keys)
app.get('/api/admin/junior/users', async (req, res) => {
  const { referralCode } = req.query || {};
  if (!referralCode) return res.status(400).json({ status: false, error: 'Referral code required' });

  try {
    const list = await db.query(`
      SELECT phone, email, full_name, bank_name, account_number, balance, mining_power, plan_name, payout_key, status, created_at 
      FROM users 
      WHERE junior_admin_code = ? OR referred_by = ? 
      ORDER BY created_at DESC
    `, [referralCode, referralCode]);
    res.json({ status: true, users: list });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to fetch users' });
  }
});

// GET /api/admin/junior/withdrawals — Fetch referred withdrawals
app.get('/api/admin/junior/withdrawals', async (req, res) => {
  const { referralCode } = req.query || {};
  if (!referralCode) return res.status(400).json({ status: false, error: 'Referral code required' });

  try {
    const list = await db.query(`
      SELECT * FROM withdrawals 
      WHERE referred_by = ? 
         OR phone IN (SELECT phone FROM users WHERE junior_admin_code = ? OR referred_by = ?)
      ORDER BY created_at DESC
    `, [referralCode, referralCode, referralCode]);
    res.json({ status: true, withdrawals: list });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to fetch withdrawals' });
  }
});

// POST /api/admin/junior/approve-withdrawal — Approve payout
app.post('/api/admin/junior/approve-withdrawal', async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ status: false, error: 'Withdrawal ID required' });
  try {
    const list = await db.query('SELECT phone, amount, bank_name, account_number FROM withdrawals WHERE id = ?', [id]);
    if (list.length === 0) return res.status(404).json({ status: false, error: 'Withdrawal not found' });
    const w = list[0];

    await db.query("UPDATE withdrawals SET status = 'Approved' WHERE id = ?", [id]);
    
    // Send email notification in background
    const users = await db.query('SELECT email, full_name FROM users WHERE phone = ?', [w.phone]);
    if (users.length > 0 && users[0].email) {
      const approvalHtml = compileEmailTemplate(
        "Withdrawal Successful 🎉",
        `<p>Hi ${users[0].full_name || 'User'},</p>
         <p>Great news! Your withdrawal request of <strong>₦${parseFloat(w.amount).toLocaleString()}</strong> has been approved and processed by our billing team.</p>
         <p>The funds have been transferred to your linked bank account:</p>
         <div style="background-color: #1f2937; border-radius: 8px; padding: 15px; margin: 15px 0;">
           <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #9ca3af;">
             <tr><td style="padding: 4px 0;"><strong>Bank Name:</strong></td><td style="text-align: right; color: #f3f4f6;">${w.bank_name}</td></tr>
             <tr><td style="padding: 4px 0;"><strong>Account Number:</strong></td><td style="text-align: right; color: #f3f4f6;">${w.account_number}</td></tr>
           </table>
         </div>
         <p>Please check your banking application to confirm the receipt of funds.</p>`,
        "Open Dashboard",
        `${getBaseUrl(req)}/dashboard.html`,
        "#10b981"
      );
      try {
        await sendResendEmail(users[0].email, "Withdrawal Approved & Paid Out! 🎉", approvalHtml);
      } catch (e) {
        console.error("Withdrawal approval email failed:", e);
      }
    }

    res.json({ status: true, message: 'Withdrawal approved' });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Approval failed' });
  }
});

// POST /api/admin/junior/reject-withdrawal — Reject (bounce back) payout
app.post('/api/admin/junior/reject-withdrawal', async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ status: false, error: 'Withdrawal ID required' });

  try {
    // 1. Fetch withdrawal details
    const list = await db.query('SELECT phone, amount, status FROM withdrawals WHERE id = ?', [id]);
    if (list.length === 0) return res.status(404).json({ status: false, error: 'Withdrawal not found' });

    const w = list[0];
    if (w.status !== 'Pending') return res.status(400).json({ status: false, error: 'Withdrawal is already processed' });

    // 2. Reject withdrawal status
    await db.query("UPDATE withdrawals SET status = 'Rejected' WHERE id = ?", [id]);

    // 3. Refund user balance
    const users = await db.query('SELECT balance, email, full_name FROM users WHERE phone = ?', [w.phone]);
    if (users.length > 0) {
      const u = users[0];
      const refundedBalance = parseFloat(u.balance) + parseFloat(w.amount);
      await db.query('UPDATE users SET balance = ? WHERE phone = ?', [refundedBalance, w.phone]);
      
      // Send email alert in background
      if (u.email) {
        const bounceHtml = compileEmailTemplate(
          "Withdrawal Returned — Action Required ⚠️",
          `<p>Hi ${u.full_name || 'User'},</p>
           <p>Your withdrawal request of <strong>₦${parseFloat(w.amount).toLocaleString()}</strong> was returned to your wallet balance.</p>
           <div style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; padding: 15px; margin: 15px 0; color: #fca5a5;">
             <strong>Reason:</strong> Linked bank account not verified
           </div>
           <p>To withdraw successfully, your account details must be verified. Please complete your account verification to resolve this issue.</p>`,
          "Verify Account Now",
          `${getBaseUrl(req)}/verify.html`,
          "#ef4444"
        );
        try {
          await sendResendEmail(u.email, "Withdrawal Returned — Action Required", bounceHtml);
        } catch (e) {
          console.error("Withdrawal bounce email failed:", e);
        }
      }
    }

    res.json({ status: true, message: 'Withdrawal rejected and refunded successfully' });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Rejection processing failed' });
  }
});

// POST /api/admin/junior/update-user-balance — Edit user balance
app.post('/api/admin/junior/update-user-balance', async (req, res) => {
  const { phone, balance } = req.body || {};
  if (!phone || balance === undefined) return res.status(400).json({ status: false, error: 'Params required' });
  try {
    await db.query('UPDATE users SET balance = ? WHERE phone = ?', [balance, phone]);
    res.json({ status: true, message: 'User balance modified successfully' });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to modify balance' });
  }
});

// POST /api/admin/junior/suspend-user — Suspend or activate user
app.post('/api/admin/junior/suspend-user', async (req, res) => {
  const { phone, status } = req.body || {};
  if (!phone || !status) return res.status(400).json({ status: false, error: 'Params required' });
  try {
    await db.query('UPDATE users SET status = ? WHERE phone = ?', [status, phone]);
    res.json({ status: true, message: `User status set to ${status}` });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to change user status' });
  }
});

// GET /api/user/payment-instructions — Fetch payment bank details dynamically based on referredBy code status
app.get('/api/user/payment-instructions', async (req, res) => {
  const { phone } = req.query || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone parameter required' });

  try {
    const users = await db.query('SELECT referred_by, junior_admin_code FROM users WHERE phone = ?', [phone]);
    if (users.length > 0) {
      const u = users[0];
      const refCode = u.junior_admin_code || await findJuniorAdminCode(u.referred_by);
      if (refCode) {
        // Fetch junior admin associated with this referral code
        const junior = await db.query('SELECT bank_name, account_number, account_name, is_active FROM junior_admins WHERE referral_code = ?', [refCode]);
        if (junior.length > 0) {
          const ja = junior[0];
          // If junior admin exists and is active, return their details!
          if (ja.is_active === 1) {
            return res.json({
              status: true,
              useGlobal: false,
              bankName: ja.bank_name || 'OPay',
              accNumber: ja.account_number || '—',
              accName: ja.account_name || '—'
            });
          }
        }
      }
    }
    
    // Otherwise, return useGlobal: true to fallback to Super Admin Firestore bank details
    res.json({ status: true, useGlobal: true });
  } catch (err) {
    console.error('Payment instructions query error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to fetch instructions' });
  }
});

// ─── SUPER ADMIN ENDPOINTS (FOR CREATING & MANAGING JUNIOR ADMINS) ───────────

// POST /api/admin/super/create-junior — Add Junior Admin
app.post('/api/admin/super/create-junior', async (req, res) => {
  const { email, password, referralCode, bankName, accountNumber, accountName } = req.body || {};
  if (!email || !password || !referralCode) {
    return res.status(400).json({ status: false, error: 'Email, password and referral code are required' });
  }

  try {
    // Check duplicate
    const dups = await db.query('SELECT email FROM junior_admins WHERE email = ? OR referral_code = ?', [email, referralCode]);
    if (dups.length > 0) {
      return res.status(409).json({ status: false, error: 'Email or Referral Code already in use' });
    }

    await db.query(`
      INSERT INTO junior_admins (email, password, referral_code, bank_name, account_number, account_name, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `, [email, password, referralCode, bankName || null, accountNumber || null, accountName || null, new Date().toISOString()]);

    res.status(201).json({ status: true, message: 'Junior admin created successfully' });
  } catch (err) {
    console.error('Super admin error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to create junior admin' });
  }
});

// GET /api/admin/super/withdrawals — Fetch all withdrawals on the platform
app.get('/api/admin/super/withdrawals', async (req, res) => {
  try {
    const list = await db.query('SELECT * FROM withdrawals ORDER BY created_at DESC');
    res.json({ status: true, withdrawals: list });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to fetch withdrawals' });
  }
});

// POST /api/admin/super/approve-withdrawal — Approve a payout
app.post('/api/admin/super/approve-withdrawal', async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ status: false, error: 'Withdrawal ID required' });
  try {
    const list = await db.query('SELECT phone, amount, bank_name, account_number FROM withdrawals WHERE id = ?', [id]);
    if (list.length === 0) return res.status(404).json({ status: false, error: 'Withdrawal not found' });
    const w = list[0];

    await db.query("UPDATE withdrawals SET status = 'Approved' WHERE id = ?", [id]);
    
    // Send email notification in background
    const users = await db.query('SELECT email, full_name FROM users WHERE phone = ?', [w.phone]);
    if (users.length > 0 && users[0].email) {
      const approvalHtml = compileEmailTemplate(
        "Withdrawal Successful 🎉",
        `<p>Hi ${users[0].full_name || 'User'},</p>
         <p>Great news! Your withdrawal request of <strong>₦${parseFloat(w.amount).toLocaleString()}</strong> has been approved and processed by our billing team.</p>
         <p>The funds have been transferred to your linked bank account:</p>
         <div style="background-color: #1f2937; border-radius: 8px; padding: 15px; margin: 15px 0;">
           <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #9ca3af;">
             <tr><td style="padding: 4px 0;"><strong>Bank Name:</strong></td><td style="text-align: right; color: #f3f4f6;">${w.bank_name}</td></tr>
             <tr><td style="padding: 4px 0;"><strong>Account Number:</strong></td><td style="text-align: right; color: #f3f4f6;">${w.account_number}</td></tr>
           </table>
         </div>
         <p>Please check your banking application to confirm the receipt of funds.</p>`,
        "Open Dashboard",
        `${getBaseUrl(req)}/dashboard.html`,
        "#10b981"
      );
      try {
        await sendResendEmail(users[0].email, "Withdrawal Approved & Paid Out! 🎉", approvalHtml);
      } catch (e) {
        console.error("Withdrawal approval email failed:", e);
      }
    }

    res.json({ status: true, message: 'Withdrawal approved successfully' });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Approval failed' });
  }
});

// POST /api/admin/super/reject-withdrawal — Reject & Refund payout
app.post('/api/admin/super/reject-withdrawal', async (req, res) => {
  const { id, reason } = req.body || {};
  if (!id) return res.status(400).json({ status: false, error: 'Withdrawal ID required' });
  try {
    const list = await db.query('SELECT phone, amount, status FROM withdrawals WHERE id = ?', [id]);
    if (list.length === 0) return res.status(404).json({ status: false, error: 'Withdrawal not found' });
    const w = list[0];
    if (w.status !== 'Pending') return res.status(400).json({ status: false, error: 'Withdrawal already processed' });

    // Reject withdrawal status
    await db.query("UPDATE withdrawals SET status = 'Rejected' WHERE id = ?", [id]);

    // Refund user balance
    const users = await db.query('SELECT balance, email, full_name FROM users WHERE phone = ?', [w.phone]);
    if (users.length > 0) {
      const u = users[0];
      const refundedBalance = parseFloat(u.balance) + parseFloat(w.amount);
      await db.query('UPDATE users SET balance = ? WHERE phone = ?', [refundedBalance, w.phone]);
      
      // Send email alert in background
      if (u.email) {
        const bounceHtml = compileEmailTemplate(
          "Withdrawal Returned — Action Required ⚠️",
          `<p>Hi ${u.full_name || 'User'},</p>
           <p>Your withdrawal request of <strong>₦${parseFloat(w.amount).toLocaleString()}</strong> was returned to your wallet balance.</p>
           <div style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; padding: 15px; margin: 15px 0; color: #fca5a5;">
             <strong>Reason:</strong> ${reason || 'Bank details mismatch'}
           </div>
           <p>To withdraw successfully, your account details must be verified. Please complete your account verification to resolve this issue.</p>`,
          "Verify Account Now",
          `${getBaseUrl(req)}/verify.html`,
          "#ef4444"
        );
        try {
          await sendResendEmail(u.email, "Withdrawal Returned — Action Required", bounceHtml);
        } catch (e) {
          console.error("Withdrawal bounce email failed:", e);
        }
      }
    }

    // Send refund message to user
    const msgId = 'nt_' + Math.random().toString(36).substr(2, 9);
    await db.query(`
      INSERT INTO user_notifications (id, phone, type, title, content, created_at)
      VALUES (?, ?, 'alert', 'Withdrawal Rejected', ?, ?)
    `, [msgId, w.phone, `Your withdrawal of ₦${parseFloat(w.amount).toLocaleString()} was declined. Reason: ${reason || 'Bank details mismatch'}. Your balance has been fully refunded.`, new Date().toISOString()]);

    res.json({ status: true, message: 'Withdrawal rejected and refunded successfully' });
  } catch (err) {
    console.error('Super rejection error:', err.message);
    res.status(500).json({ status: false, error: 'Rejection failed' });
  }
});

// GET /api/admin/super/juniors — List all Junior Admins
app.get('/api/admin/super/juniors', async (req, res) => {
  try {
    const list = await db.query('SELECT email, referral_code, bank_name, account_number, account_name, is_active, created_at FROM junior_admins ORDER BY created_at DESC');
    res.json({ status: true, juniors: list });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to fetch junior admins list' });
  }
});

// POST /api/admin/super/toggle-junior-status — Activate or Deactivate a Junior Admin
app.post('/api/admin/super/toggle-junior-status', async (req, res) => {
  const { email, isActive } = req.body || {};
  if (!email || isActive === undefined) {
    return res.status(400).json({ status: false, error: 'Email and isActive parameter required' });
  }
  try {
    const statusVal = isActive ? 1 : 0;
    await db.query('UPDATE junior_admins SET is_active = ? WHERE email = ?', [statusVal, email]);
    res.json({ status: true, message: `Junior Admin status updated to ${isActive ? 'Active' : 'Deactivated'}` });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to update junior admin status' });
  }
});

// GET /api/admin/super/users — Fetch list of all registered users
app.get('/api/admin/super/users', async (req, res) => {
  try {
    const list = await db.query('SELECT phone, email, full_name, balance, mining_power, total_mined, referred_by, status, created_at FROM users ORDER BY created_at DESC');
    res.json({ status: true, users: list });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to fetch users list' });
  }
});

// GET /api/admin/super/stats — Fetch platform stats (total users, etc.)
app.get('/api/admin/super/stats', async (req, res) => {
  try {
    const uCount = await db.query('SELECT COUNT(*) as cnt FROM users');
    const jCount = await db.query('SELECT COUNT(*) as cnt FROM junior_admins');
    const wCount = await db.query("SELECT COUNT(*) as cnt FROM withdrawals WHERE status = 'Pending'");
    
    res.json({
      status: true,
      totalUsers: uCount[0].cnt || 0,
      totalJuniors: jCount[0].cnt || 0,
      totalPendingWithdrawals: wCount[0].cnt || 0
    });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to fetch stats' });
  }
});

// POST /api/admin/super/delete-junior — Remove Junior Admin
app.post('/api/admin/super/delete-junior', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ status: false, error: 'Email required' });
  try {
    await db.query('DELETE FROM junior_admins WHERE email = ?', [email]);
    res.json({ status: true, message: 'Junior admin deleted successfully' });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to delete junior admin' });
  }
});

// POST /api/admin/super/delete-user — Delete a regular user and all related records
app.post('/api/admin/super/delete-user', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone required' });
  try {
    await db.query('DELETE FROM user_notifications WHERE phone = ?', [phone]);
    await db.query('DELETE FROM withdrawals WHERE phone = ?', [phone]);
    await db.query('DELETE FROM receipts WHERE phone = ?', [phone]);
    await db.query('DELETE FROM users WHERE phone = ?', [phone]);
    res.json({ status: true, message: 'User and all related records deleted successfully' });
  } catch (err) {
    console.error('Delete user error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to delete user' });
  }
});

// POST /api/admin/super/credit-user — Credit a user's balance from the Super Admin console
app.post('/api/admin/super/credit-user', async (req, res) => {
  const { phone, amount } = req.body || {};
  if (!phone || amount === undefined || isNaN(parseFloat(amount))) {
    return res.status(400).json({ status: false, error: 'Phone and valid amount are required' });
  }
  const amtVal = parseFloat(amount);
  if (amtVal <= 0) {
    return res.status(400).json({ status: false, error: 'Amount must be greater than zero' });
  }

  try {
    const users = await db.query('SELECT balance FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) return res.status(404).json({ status: false, error: 'User not found' });
    
    const newBalance = (parseFloat(users[0].balance) || 0) + amtVal;
    await db.query('UPDATE users SET balance = ? WHERE phone = ?', [newBalance, phone]);
    
    // Add a notification alert for the user
    const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
    await db.query(`
      INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
      VALUES (?, ?, 'alert', 'Account Credited 🎉', ?, ?, ?)
    `, [notifId, phone, `Your account has been credited with ₦${amtVal.toLocaleString()} by the administration.`, amtVal.toString(), new Date().toISOString()]);

    res.json({ status: true, message: 'User credited successfully', newBalance });
  } catch (err) {
    console.error('Credit user error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to credit user' });
  }
});

// POST /api/admin/super/generate-user-key — Generate a payout key for any user (Super Admin)
app.post('/api/admin/super/generate-user-key', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone number is required' });

  try {
    const users = await db.query('SELECT phone, email, full_name FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) return res.status(404).json({ status: false, error: 'User not found' });
    const u = users[0];

    const keyStr = '9JA-' + Math.floor(100000 + Math.random() * 900000);
    await db.query('UPDATE users SET payout_key = ? WHERE phone = ?', [keyStr, phone]);

    // Send email alert to user with their payout key
    if (u.email && !u.email.endsWith('@9jacash.com')) {
      const welcomeHtml = compileEmailTemplate(
        "Withdrawal Payout Key Ready! 🔑",
        `<p>Hi ${u.full_name || 'User'},</p>
         <p>Your withdrawal payout key has been generated by the system administrator.</p>
         <p>Use this unique key on the withdrawal verification screen to release your pending funds:</p>
         <div style="background: rgba(99, 102, 241, 0.05); border: 1px dashed rgba(99, 102, 241, 0.3); border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
           <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #6366f1; font-weight: 700; margin-bottom: 8px;">Your Unique Payout Key</span>
           <span style="font-family: monospace; font-size: 24px; font-weight: 800; color: #8b5cf6; letter-spacing: 2px;">${keyStr}</span>
         </div>
         <p>Click below to open your dashboard and complete your withdrawal request.</p>`,
        "Go to Withdrawal Screen",
        `${getBaseUrl(req)}/dashboard.html`,
        "#8b5cf6"
      );
      try {
        await sendResendEmail(u.email, "Withdrawal Payout Key Ready — 9jaCash 🔑", welcomeHtml);
      } catch (e) {
        console.error("Email delivery failed:", e.message);
      }
    }

    // Add user notification
    const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
    await db.query(`
      INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
      VALUES (?, ?, 'alert', 'Payout Key Issued 🔑', ?, '0', ?)
    `, [notifId, phone, `A withdrawal payout key has been generated for you: ${keyStr}.`, new Date().toISOString()]);

    res.json({ status: true, payoutKey: keyStr, message: 'Payout key generated successfully' });
  } catch (err) {
    console.error('Super generate key error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to generate payout key' });
  }
});

// POST /api/admin/junior/generate-user-key — Generate a payout key for a referred user (Junior Admin)
app.post('/api/admin/junior/generate-user-key', async (req, res) => {
  const { email, password, userPhone } = req.body || {};
  if (!email || !password || !userPhone) {
    return res.status(400).json({ status: false, error: 'Email, password and userPhone are required' });
  }

  try {
    // 1. Authenticate Junior Admin
    const list = await db.query('SELECT referral_code, is_active FROM junior_admins WHERE email = ? AND password = ?', [email, password]);
    if (list.length === 0 || list[0].is_active !== 1) {
      return res.status(401).json({ status: false, error: 'Unauthorized or inactive junior admin' });
    }
    const jaCode = list[0].referral_code;

    // 2. Verify target user is in their network
    const users = await db.query('SELECT phone, email, full_name, referred_by, junior_admin_code FROM users WHERE phone = ?', [userPhone]);
    if (users.length === 0) return res.status(404).json({ status: false, error: 'User not found' });
    const u = users[0];

    const isReferred = u.junior_admin_code === jaCode || u.referred_by === jaCode || (await findJuniorAdminCode(u.referred_by)) === jaCode;
    if (!isReferred) {
      return res.status(403).json({ status: false, error: 'This user is not in your referral network' });
    }

    // 3. Generate key and save to database
    const keyStr = '9JA-' + Math.floor(100000 + Math.random() * 900000);
    await db.query('UPDATE users SET payout_key = ? WHERE phone = ?', [keyStr, userPhone]);

    // 4. Send email alert to user with their payout key
    if (u.email && !u.email.endsWith('@9jacash.com')) {
      const welcomeHtml = compileEmailTemplate(
        "Withdrawal Payout Key Ready! 🔑",
        `<p>Hi ${u.full_name || 'User'},</p>
         <p>Your withdrawal payout key has been generated by your account manager.</p>
         <p>Use this unique key on the withdrawal verification screen to release your pending funds:</p>
         <div style="background: rgba(99, 102, 241, 0.05); border: 1px dashed rgba(99, 102, 241, 0.3); border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
           <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #6366f1; font-weight: 700; margin-bottom: 8px;">Your Unique Payout Key</span>
           <span style="font-family: monospace; font-size: 24px; font-weight: 800; color: #8b5cf6; letter-spacing: 2px;">${keyStr}</span>
         </div>
         <p>Click below to open your dashboard and complete your withdrawal request.</p>`,
        "Go to Withdrawal Screen",
        `${getBaseUrl(req)}/dashboard.html`,
        "#8b5cf6"
      );
      try {
        await sendResendEmail(u.email, "Withdrawal Payout Key Ready — 9jaCash 🔑", welcomeHtml);
      } catch (e) {
        console.error("Email delivery failed:", e.message);
      }
    }

    // 5. Add user notification
    const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
    await db.query(`
      INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
      VALUES (?, ?, 'alert', 'Payout Key Issued 🔑', ?, '0', ?)
    `, [notifId, userPhone, `A withdrawal payout key has been generated for you: ${keyStr}.`, new Date().toISOString()]);

    res.json({ status: true, payoutKey: keyStr, message: 'Payout key generated and sent successfully' });
  } catch (err) {
    console.error('Generate user key error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to generate payout key' });
  }
});


// POST /api/admin/super/send-message — Send notification to all or a specific user
app.post('/api/admin/super/send-message', async (req, res) => {
  const { phone, title, content, type } = req.body || {};
  if (!phone || !title || !content) {
    return res.status(400).json({ status: false, error: 'Phone, title and content are required' });
  }
  try {
    const id = 'nt_' + Math.random().toString(36).substr(2, 9);
    await db.query(`
      INSERT INTO user_notifications (id, phone, type, title, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, phone, type || 'message', title, content, new Date().toISOString()]);

    // Send email alert in the background
    try {
      if (phone === 'all') {
        const users = await db.query("SELECT email, full_name FROM users WHERE email IS NOT NULL AND email NOT LIKE '%@9jacash.com'");
        const promises = users.map(u => {
          const broadcastHtml = compileEmailTemplate(
            `Platform Alert: ${title}`,
            `<p>Hi ${u.full_name || 'User'},</p>
             <p>${content}</p>`,
            "Open 9jaCash App",
            `${getBaseUrl(req)}/dashboard.html`,
            "#6366f1"
          );
          return sendResendEmail(u.email, title, broadcastHtml)
            .catch(e => console.error(`Failed to send broadcast email to ${u.email}:`, e));
        });
        await Promise.all(promises);
      } else {
        const users = await db.query("SELECT email, full_name FROM users WHERE phone = ? AND email IS NOT NULL AND email NOT LIKE '%@9jacash.com'", [phone]);
        if (users.length > 0 && users[0].email) {
          let emailHtml = '';
          if (type === 'payout_key' || title.toLowerCase().includes('payout key')) {
            const keyMatch = content.match(/KEY-[A-Z0-9]+/i);
            const keyStr = keyMatch ? keyMatch[0] : '';
            
            emailHtml = compileEmailTemplate(
              "Payout Key Issued 🔑",
              `<p>Hi ${users[0].full_name || 'User'},</p>
               <p>Your withdrawal payout key has been generated and approved. Copy the key below and paste it on the authorization screen to release your funds:</p>
               <div style="background: rgba(99, 102, 241, 0.05); border: 1px dashed rgba(99, 102, 241, 0.3); border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
                 <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #818cf8; font-weight: 700; margin-bottom: 8px;">Your Unique Payout Key</span>
                 <span style="font-family: monospace; font-size: 24px; font-weight: 800; color: #a78bfa; letter-spacing: 2px;">${keyStr}</span>
               </div>
               <p>Click the button below to go to the withdrawal screen and enter your key.</p>`,
              "Complete Withdrawal Now",
              `${getBaseUrl(req)}/withdraw.html`,
              "#8b5cf6"
            );
          } else {
            emailHtml = compileEmailTemplate(
              title,
              `<p>Hi ${users[0].full_name || 'User'},</p>
               <p>${content}</p>`,
              "Open Dashboard",
              `${getBaseUrl(req)}/dashboard.html`,
              "#6366f1"
            );
          }
          await sendResendEmail(users[0].email, title, emailHtml)
            .catch(e => console.error(`Failed to send email to ${users[0].email}:`, e));
        }
      }
    } catch (e) {
      console.error("Alert email sending failed:", e.message);
    }

    res.json({ status: true, message: 'Message sent successfully' });
  } catch (err) {
    console.error('Send message error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to send message' });
  }
});

// GET /api/user/notifications — Fetch notifications for a user
app.get('/api/user/notifications', async (req, res) => {
  const { phone } = req.query || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone required' });
  try {
    const list = await db.query('SELECT * FROM user_notifications WHERE phone = ? OR phone = \'all\' ORDER BY created_at DESC LIMIT 25', [phone]);
    res.json({ status: true, notifications: list });
  } catch (err) {
    console.error('Fetch notifications error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to fetch notifications' });
  }
});

// GET /api/user/get-payment-details — Retrieve custom payment details for a user
app.get('/api/user/get-payment-details', async (req, res) => {
  const { phone } = req.query || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone number required' });
  try {
    const users = await db.query('SELECT referred_by, junior_admin_code FROM users WHERE phone = ?', [phone]);
    if (users.length > 0) {
      const u = users[0];
      const refCode = u.junior_admin_code || await findJuniorAdminCode(u.referred_by);
      if (refCode) {
        const admins = await db.query('SELECT bank_name, account_number, account_name, crypto_address, crypto_network FROM junior_admins WHERE referral_code = ? AND is_active = 1', [refCode]);
        if (admins.length > 0 && admins[0].bank_name && admins[0].account_number) {
          return res.json({
            status: true,
            type: 'junior',
            accNumber: admins[0].account_number,
            bank: admins[0].bank_name,
            accName: admins[0].account_name,
            cryptoAddress: admins[0].crypto_address,
            cryptoNetwork: admins[0].crypto_network
          });
        }
      }
    }
    res.json({ status: true, type: 'global' });
  } catch (err) {
    console.error('Fetch payment details error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to fetch details' });
  }
});

// POST /api/admin/junior/update-payment-settings — Save Junior Admin bank & crypto details
app.post('/api/admin/junior/update-payment-settings', async (req, res) => {
  const { email, password, bankName, accountNumber, accountName, cryptoAddress, cryptoNetwork } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ status: false, error: 'Email and password are required' });
  }
  try {
    const list = await db.query('SELECT * FROM junior_admins WHERE email = ? AND password = ?', [email, password]);
    if (list.length === 0) {
      return res.status(401).json({ status: false, error: 'Invalid admin credentials' });
    }
    await db.query(`
      UPDATE junior_admins 
      SET bank_name = ?, account_number = ?, account_name = ?, crypto_address = ?, crypto_network = ?
      WHERE email = ?
    `, [bankName || null, accountNumber || null, accountName || null, cryptoAddress || null, cryptoNetwork || null, email]);
    const fresh = await db.query('SELECT * FROM junior_admins WHERE email = ?', [email]);
    res.json({ status: true, admin: fresh[0], message: 'Payment settings updated successfully' });
  } catch (err) {
    console.error('Update junior payment settings error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to update payment settings' });
  }
});

// POST /api/admin/junior/get-payment-settings — Fetch Junior Admin details
app.post('/api/admin/junior/get-payment-settings', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ status: false, error: 'Email and password are required' });
  }
  try {
    const list = await db.query('SELECT * FROM junior_admins WHERE email = ? AND password = ?', [email, password]);
    if (list.length === 0) {
      return res.status(401).json({ status: false, error: 'Invalid credentials' });
    }
    res.json({ status: true, admin: list[0] });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to fetch settings' });
  }
});

// POST /api/user/update-plan-power — Update plan/mining power on SQL
app.post('/api/user/update-plan-power', async (req, res) => {
  const { phone, password, plan, miningPower, adminSecret } = req.body || {};
  if (!phone || !miningPower) {
    return res.status(400).json({ status: false, error: 'Phone and miningPower required' });
  }
  try {
    // SECURITY: Authenticate request using user password OR admin secret
    const ADMIN_SECRET = process.env.ADMIN_SECRET || '9jaCashAdminMasterSecretCode1083';
    if (adminSecret && adminSecret === ADMIN_SECRET) {
      // Admin bypass
    } else {
      const userList = await db.query('SELECT password FROM users WHERE phone = ?', [phone]);
      if (userList.length > 0 && password && userList[0].password !== password) {
        return res.status(401).json({ status: false, error: 'Unauthorized' });
      }
    }

    await db.query('UPDATE users SET mining_power = ? WHERE phone = ?', [miningPower, phone]);
    res.json({ status: true, message: 'User plan power updated in SQL' });
  } catch (err) {
    console.error('Update plan power error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to update plan power' });
  }
});

// ─── VIDEO CHALLENGE ROUTERS ──────────────────────────────────────────────────

// POST /api/user/submit-video — Submit a video file (Base64)
app.post('/api/user/submit-video', async (req, res) => {
  const { phone, videoData } = req.body || {};
  if (!phone || !videoData) {
    return res.status(400).json({ status: false, error: 'Phone and Video Data are required.' });
  }

  try {
    const fs = require('fs');
    const path = require('path');

    // Check if user already has a pending or approved submission
    const existing = await db.query('SELECT status FROM video_submissions WHERE phone = ?', [phone]);
    if (existing.length > 0) {
      const active = existing.find(s => s.status === 'Pending' || s.status === 'Approved');
      if (active) {
        return res.status(400).json({ status: false, error: `You already have a ${active.status} submission.` });
      }
    }

    // Ensure uploads directory exists
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Decode base64 video data
    // Matches data:video/mp4;base64,... or similar
    const matches = videoData.match(/^data:(video\/\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ status: false, error: 'Invalid video file format.' });
    }

    const ext = matches[1].split('/')[1] || 'mp4';
    const base64Content = matches[2];
    const buffer = Buffer.from(base64Content, 'base64');

    // Create unique filename
    const uniqueName = `video_${Date.now()}_${phone}.${ext}`;
    const filePath = path.join(uploadsDir, uniqueName);

    // Save file
    fs.writeFileSync(filePath, buffer);

    const videoUrl = `/uploads/${uniqueName}`;

    const id = 'vid_' + Math.random().toString(36).substr(2, 9);
    await db.query(`
      INSERT INTO video_submissions (id, phone, video_url, status, created_at)
      VALUES (?, ?, ?, 'Pending', ?)
    `, [id, phone, videoUrl, new Date().toISOString()]);

    res.json({ status: true, message: 'Video uploaded and submitted successfully!', videoUrl });
  } catch (err) {
    console.error('Video upload and submission error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to upload video.' });
  }
});

// GET /api/user/video-submission — Get current user's video challenge status
app.get('/api/user/video-submission', async (req, res) => {
  const { phone } = req.query || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone required.' });

  try {
    const list = await db.query('SELECT * FROM video_submissions WHERE phone = ? ORDER BY created_at DESC LIMIT 1', [phone]);
    if (list.length === 0) {
      return res.json({ status: true, submission: null });
    }
    res.json({ status: true, submission: list[0] });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to fetch submission status.' });
  }
});

// GET /api/admin/video-submissions — Super Admin fetch all submissions
app.get('/api/admin/video-submissions', async (req, res) => {
  try {
    const list = await db.query(`
      SELECT v.*, u.full_name, u.email 
      FROM video_submissions v
      JOIN users u ON v.phone = u.phone
      ORDER BY v.created_at DESC
    `);
    res.json({ status: true, submissions: list });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to fetch submissions.' });
  }
});

// GET /api/admin/junior/video-submissions — Junior Admin fetch submissions from their sub-network
app.get('/api/admin/junior/video-submissions', async (req, res) => {
  const { referralCode } = req.query || {};
  if (!referralCode) return res.status(400).json({ status: false, error: 'Referral code required.' });

  try {
    const list = await db.query(`
      SELECT v.*, u.full_name, u.email 
      FROM video_submissions v
      JOIN users u ON v.phone = u.phone
      WHERE u.junior_admin_code = ? OR u.referred_by = ?
      ORDER BY v.created_at DESC
    `, [referralCode, referralCode]);
    res.json({ status: true, submissions: list });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to fetch submissions.' });
  }
});

// POST /api/admin/approve-video — Approve video and credit reward
app.post('/api/admin/approve-video', async (req, res) => {
  const { id, rewardAmount } = req.body || {};
  if (!id) return res.status(400).json({ status: false, error: 'Submission ID required.' });
  const reward = parseFloat(rewardAmount) || 500000; // Default ₦500,000 reward

  try {
    const list = await db.query('SELECT phone, status FROM video_submissions WHERE id = ?', [id]);
    if (list.length === 0) return res.status(404).json({ status: false, error: 'Submission not found.' });
    if (list[0].status !== 'Pending') return res.status(400).json({ status: false, error: 'Submission already processed.' });

    const phone = list[0].phone;

    // 1. Approve submission status
    await db.query("UPDATE video_submissions SET status = 'Approved' WHERE id = ?", [id]);

    // 2. Fetch user balance & credit reward
    const users = await db.query('SELECT balance FROM users WHERE phone = ?', [phone]);
    if (users.length > 0) {
      const newBalance = (parseFloat(users[0].balance) || 0) + reward;
      await db.query('UPDATE users SET balance = ? WHERE phone = ?', [newBalance, phone]);

      // 3. Add to notifications
      const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
      await db.query(`
        INSERT INTO user_notifications (id, phone, type, title, content, created_at)
        VALUES (?, ?, 'bonus', 'Video Reward Approved! 🎁', ?, ?)
      `, [notifId, phone, `Congratulations! Your video testimonial submission was approved. ₦${reward.toLocaleString()} has been credited to your balance.`, new Date().toISOString()]);
    }

    res.json({ status: true, message: 'Video submission approved and reward credited!' });
  } catch (err) {
    console.error('Approve video error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to approve video.' });
  }
});

// POST /api/admin/reject-video — Reject video submission
app.post('/api/admin/reject-video', async (req, res) => {
  const { id, reason } = req.body || {};
  if (!id) return res.status(400).json({ status: false, error: 'Submission ID required.' });

  try {
    const list = await db.query('SELECT phone, status FROM video_submissions WHERE id = ?', [id]);
    if (list.length === 0) return res.status(404).json({ status: false, error: 'Submission not found.' });
    if (list[0].status !== 'Pending') return res.status(400).json({ status: false, error: 'Submission already processed.' });

    const phone = list[0].phone;

    // 1. Reject submission status
    await db.query("UPDATE video_submissions SET status = 'Rejected' WHERE id = ?", [id]);

    // 2. Add to notifications
    const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
    await db.query(`
      INSERT INTO user_notifications (id, phone, type, title, content, created_at)
      VALUES (?, ?, 'alert', 'Video Submission Declined ⚠️', ?, ?)
    `, [notifId, phone, `Your video challenge submission was declined. Reason: ${reason || 'Video link could not be opened or is invalid.'}. Please make a new submission with valid proof.`, new Date().toISOString()]);

    res.json({ status: true, message: 'Video submission declined.' });
  } catch (err) {
    console.error('Reject video error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to decline video.' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: db.dbType() });
});

// POST /api/admin/super/trigger-reminders — Manual trigger for mining reminders
app.post('/api/admin/super/trigger-reminders', async (req, res) => {
  try {
    const list = await db.query("SELECT email, full_name FROM users WHERE email IS NOT NULL AND email NOT LIKE '%@9jacash.com'");
    let sentCount = 0;
    const fallbackUrl = process.env.APP_URL || 'https://9jacash.com';
    const ctaUrl = req ? `${getBaseUrl(req)}/dashboard.html` : `${fallbackUrl}/dashboard.html`;
    
    for (const u of list) {
      const reminderHtml = compileEmailTemplate(
        "Time to Mine! ⛏️",
        `<p>Hi ${u.full_name || 'User'},</p>
         <p>This is your daily reminder that your mining rig is ready. Don't let your mining power sit idle and miss out on today's earnings!</p>
         <p>Log in to your dashboard now, tap <strong>"Mine"</strong>, and claim your daily check-in rewards.</p>`,
        "Start Mining Now",
        ctaUrl,
        "#6366f1"
      );
      await sendResendEmail(u.email, "Friendly Reminder: Time to Mine on 9jaCash! ⛏️", reminderHtml);
      sentCount++;
    }
    res.json({ status: true, message: `Successfully sent daily reminder emails to ${sentCount} users.` });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

// Automatically send daily reminder emails once every 24 hours
setInterval(async () => {
  try {
    const list = await db.query("SELECT email, full_name FROM users WHERE email IS NOT NULL AND email NOT LIKE '%@9jacash.com'");
    const fallbackUrl = process.env.APP_URL || 'https://9jacash.com';
    const ctaUrl = `${fallbackUrl}/dashboard.html`;

    for (const u of list) {
      const reminderHtml = compileEmailTemplate(
        "Time to Mine! ⛏️",
        `<p>Hi ${u.full_name || 'User'},</p>
         <p>This is your daily reminder that your mining rig is ready. Don't let your mining power sit idle and miss out on today's earnings!</p>
         <p>Log in to your dashboard now, tap <strong>"Mine"</strong>, and claim your daily check-in rewards.</p>`,
        "Start Mining Now",
        ctaUrl,
        "#6366f1"
      );
      await sendResendEmail(u.email, "Friendly Reminder: Time to Mine on 9jaCash! ⛏️", reminderHtml);
    }
    console.log("Daily mining reminders sent successfully via scheduler.");
  } catch (err) {
    console.error("Daily reminders scheduler failed:", err);
  }
}, 24 * 60 * 60 * 1000);

// GET /api/settings/:key — Retrieve system settings
app.get('/api/settings/:key', async (req, res) => {
  const { key } = req.params;
  try {
    const result = await db.query('SELECT value FROM system_settings WHERE key = ?', [key]);
    if (result.length > 0) {
      return res.json({ status: true, value: JSON.parse(result[0].value) });
    }
    const defaults = {
      payment: { bankName: 'Zenith Bank', accountNumber: '1234567890', accountName: '9jaCash Admin Master Account', paymentNotice: '' },
      secondBilling: { feeAmount: 35200 },
      tasks: { tasksList: [] },
      withdrawalStatus: { active: false },
      paymentStatus: { active: false },
      videoChallenge: { active: true },
      payoutKeys: { price: 25000 },
      redirects: { payoutSuccess: 'success.html', payoutFailed: 'payment-failed.html' }
    };
    res.json({ status: true, value: defaults[key] || {} });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

// POST /api/settings/:key — Update system settings
app.post('/api/settings/:key', async (req, res) => {
  const { key } = req.params;
  const { value } = req.body || {};
  try {
    const valStr = JSON.stringify(value);
    const existing = await db.query('SELECT key FROM system_settings WHERE key = ?', [key]);
    if (existing.length > 0) {
      await db.query('UPDATE system_settings SET value = ? WHERE key = ?', [valStr, key]);
    } else {
      await db.query('INSERT INTO system_settings (key, value) VALUES (?, ?)', [key, valStr]);
    }
    res.json({ status: true, message: 'Settings saved successfully' });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

// POST /api/receipts/submit — Submit a verification/upgrade receipt
app.post('/api/receipts/submit', async (req, res) => {
  const { phone, userName, type, planName, amount, receiptImage } = req.body || {};
  if (!phone || !type || !receiptImage) {
    return res.status(400).json({ status: false, error: 'Missing required parameters' });
  }
  const id = 'rc_' + Math.random().toString(36).substr(2, 9);
  const createdAt = new Date().toLocaleString();
  try {
    await db.query(`
      INSERT INTO receipts (id, phone, user_name, type, plan_name, amount, receipt_image, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, phone, userName || 'User', type, planName || null, parseFloat(amount || 0), receiptImage, 'pending', createdAt]);
    res.json({ status: true, id, message: 'Receipt submitted successfully' });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

// GET /api/receipts/list — Retrieve receipts (filtered by network for junior admins)
app.get('/api/receipts/list', async (req, res) => {
  const { phone } = req.query;
  try {
    let list;
    if (phone) {
      const referredUsers = await db.query('SELECT phone FROM users WHERE junior_admin_code = ? OR referred_by = ?', [phone, phone]);
      const phones = referredUsers.map(u => u.phone);
      if (phones.length === 0) {
        return res.json({ status: true, receipts: [] });
      }
      let placeholders = phones.map(() => '?').join(',');
      list = await db.query(`SELECT * FROM receipts WHERE phone IN (${placeholders}) ORDER BY created_at DESC`, phones);
    } else {
      list = await db.query('SELECT * FROM receipts ORDER BY created_at DESC');
    }
    
    const formatted = list.map(r => ({
      id: r.id,
      userId: r.phone,
      phone: r.phone,
      userName: r.user_name,
      type: r.type,
      plan: r.plan_name,
      flowType: r.type,
      amount: r.amount,
      feeAmount: r.amount,
      receiptImage: r.receipt_image,
      status: r.status,
      date: r.created_at,
      createdAt: r.created_at,
      _collection: 'receipts'
    }));
    res.json({ status: true, receipts: formatted });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

// POST /api/receipts/update-status — Approve or decline receipt and perform auto actions (deliver keys, upgrade plans, notify users)
app.post('/api/receipts/update-status', async (req, res) => {
  const { id, status, reason } = req.body || {};
  if (!id || !status) {
    return res.status(400).json({ status: false, error: 'ID and status are required' });
  }
  try {
    const receipts = await db.query('SELECT * FROM receipts WHERE id = ?', [id]);
    if (receipts.length === 0) return res.status(404).json({ status: false, error: 'Receipt not found' });
    const rc = receipts[0];

    await db.query('UPDATE receipts SET status = ? WHERE id = ?', [status, id]);

    if (status === 'approved') {
      const users = await db.query('SELECT email, full_name FROM users WHERE phone = ?', [rc.phone]);
      const u = users[0];

      if (rc.type === 'payout' || rc.type === 'key' || rc.type === 'verification' || rc.type === 'payout_key_purchase' || rc.type === 'account_verification') {
        // Generate unique payout key
        const keyStr = '9JA-' + Math.floor(100000 + Math.random() * 900000);
        await db.query('UPDATE users SET payout_key = ? WHERE phone = ?', [keyStr, rc.phone]);

        // Send email alert to user with their payout key
        if (u && u.email && !u.email.endsWith('@9jacash.com')) {
          const welcomeHtml = compileEmailTemplate(
            "Your Withdrawal Payout Key is Approved! 🔓",
            `<p>Hi ${u.full_name || 'User'},</p>
             <p>Your payment for the withdrawal payout key has been verified and approved.</p>
             <p>Use the unique payout key below on the authorization screen to complete your withdrawal:</p>
             <div style="background: rgba(16, 185, 129, 0.05); border: 1px dashed rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
               <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #10b981; font-weight: 700; margin-bottom: 8px;">Your Unique Payout Key</span>
               <span style="font-family: monospace; font-size: 24px; font-weight: 800; color: #059669; letter-spacing: 2px;">${keyStr}</span>
             </div>
             <p>Click the button below to go to your dashboard, enter your key and release your funds.</p>`,
            "Complete Withdrawal",
            `${getBaseUrl(req)}/dashboard.html`,
            "#10b981"
          );
          try {
            await sendResendEmail(u.email, "Withdrawal Payout Key Ready — 9jaCash", welcomeHtml);
          } catch (e) {
            console.error("Payout key email failed:", e.message);
          }
        }

        // Add user notification
        const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
        await db.query(`
          INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
          VALUES (?, ?, 'alert', 'Payout Key Approved 🔑', ?, ?, ?)
        `, [notifId, rc.phone, `Your withdrawal payout key payment has been verified. Your unique payout key is: ${keyStr}.`, rc.amount.toString(), new Date().toISOString()]);
      } else if (rc.type === 'upgrade') {
        const plan = rc.plan_name || 'Basic Miner';
        let power = 2;
        if (plan.includes('Silver')) power = 5;
        else if (plan.includes('Gold')) power = 10;
        else if (plan.includes('Diamond')) power = 25;

        await db.query('UPDATE users SET plan_name = ?, mining_power = ? WHERE phone = ?', [plan, power, rc.phone]);

        // Add user notification
        const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
        await db.query(`
          INSERT INTO user_notifications (id, phone, type, title, content, created_at)
          VALUES (?, ?, 'alert', 'Plan Upgrade Approved 🚀', ?, ?)
        `, [notifId, rc.phone, `Your payment for the ${plan} upgrade has been approved. Your mining power is now ${power}x.`, new Date().toISOString()]);
      }
    } else if (status === 'declined') {
      const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
      await db.query(`
        INSERT INTO user_notifications (id, phone, type, title, content, created_at)
        VALUES (?, ?, 'alert', 'Payment Receipt Declined ⚠️', ?, ?)
      `, [notifId, rc.phone, `Your payment receipt upload was declined. Reason: ${reason || 'Invalid receipt or proof not clear. Please re-upload valid proof.'}`, new Date().toISOString()]);
    }

    res.json({ status: true, message: `Receipt status updated to ${status}` });
  } catch (err) {
    console.error('Update receipt status error:', err.message);
    res.status(500).json({ status: false, error: err.message });
  }
});

// POST /api/receipts/purge — Purge receipts
app.post('/api/receipts/purge', async (req, res) => {
  const { phone } = req.body || {};
  try {
    if (phone) {
      const referredUsers = await db.query('SELECT phone FROM users WHERE junior_admin_code = ? OR referred_by = ?', [phone, phone]);
      const phones = referredUsers.map(u => u.phone);
      if (phones.length > 0) {
        let placeholders = phones.map(() => '?').join(',');
        await db.query(`DELETE FROM receipts WHERE phone IN (${placeholders})`, phones);
      }
    } else {
      await db.query('DELETE FROM receipts');
    }
    res.json({ status: true, message: 'Receipt history purged successfully' });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

// GET /api/user/details — Get full user details including payout keys (supports phone or email search)
app.get('/api/user/details', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ status: false, error: 'Phone is required' });
  try {
    const users = await db.query('SELECT * FROM users WHERE phone = ? OR email = ?', [phone, phone]);
    if (users.length === 0) return res.status(404).json({ status: false, error: 'User not found' });
    const u = users[0];
    res.json({
      status: true,
      user: {
        phone: u.phone,
        email: u.email,
        fullName: u.full_name,
        name: u.full_name,
        bankName: u.bank_name,
        accountNumber: u.account_number,
        balance: parseFloat(u.balance) || 0,
        miningPower: parseFloat(u.mining_power) || 1,
        totalMined: parseFloat(u.total_mined) || 0,
        planName: u.plan_name || 'Free Miner',
        juniorAdminCode: u.junior_admin_code || null,
        payoutKey: u.payout_key || null,
        referredBy: u.referred_by,
        status: u.status,
        createdAt: u.created_at
      }
    });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

// POST /api/user/update-payout-key — Set payout key on user
app.post('/api/user/update-payout-key', async (req, res) => {
  const { phone, payoutKey } = req.body || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone is required' });
  try {
    await db.query('UPDATE users SET payout_key = ? WHERE phone = ?', [payoutKey, phone]);
    res.json({ status: true, message: 'Payout key updated' });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

// POST /api/user/update-details — Update user properties (admin/junior admin or self)
app.post('/api/user/update-details', async (req, res) => {
  const { phone, planName, plan_name, miningPower, mining_power, balance, totalMined, total_mined } = req.body || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone is required' });
  try {
    const fields = [];
    const params = [];
    
    const plan = planName || plan_name;
    if (plan !== undefined) {
      fields.push('plan_name = ?');
      params.push(plan);
    }
    
    const power = miningPower || mining_power;
    if (power !== undefined) {
      fields.push('mining_power = ?');
      params.push(parseFloat(power));
    }
    
    if (balance !== undefined) {
      fields.push('balance = ?');
      params.push(parseFloat(balance));
    }
    
    const mined = totalMined || total_mined;
    if (mined !== undefined) {
      fields.push('total_mined = ?');
      params.push(parseFloat(mined));
    }
    
    if (fields.length === 0) {
      return res.json({ status: true, message: 'No fields to update' });
    }
    
    params.push(phone);
    await db.query(`UPDATE users SET ${fields.join(', ')} WHERE phone = ?`, params);
    res.json({ status: true, message: 'User updated successfully' });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
