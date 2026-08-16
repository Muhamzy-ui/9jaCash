// app.js — 9jaCash Express Application Router
// Contains all REST API endpoints for user and admin database management.
// Shared between local server.js and Netlify production serverless functions.
try { require('dotenv').config(); } catch (e) { }

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection (handled):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception (handled):', err.message);
});

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const db = require('./db');
const https = require('https');

// Helper to parse dates safely in different environments (handles ISO string, locale dates, and unix timestamps)
function safeParseDate(dateStr) {
  if (!dateStr) return new Date(0);
  if (dateStr instanceof Date) return dateStr;

  // If it's a numeric timestamp
  if (/^\d+$/.test(dateStr.toString().trim())) {
    const d = new Date(Number(dateStr.toString().trim()));
    if (!isNaN(d.getTime())) return d;
  }

  // Try standard parse first (handles ISO strings perfectly)
  let d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;

  try {
    const cleanStr = dateStr.toString().replace(/,/g, ' ').trim();
    // Try splitting by space to separate date and time
    const parts = cleanStr.split(/\s+/);
    if (parts.length >= 1) {
      // Try parsing date part. It could be split by '/' or '-'
      const datePart = parts[0];
      const sep = datePart.includes('/') ? '/' : (datePart.includes('-') ? '-' : null);
      if (sep) {
        const dateParts = datePart.split(sep);
        if (dateParts.length === 3) {
          let p1 = parseInt(dateParts[0]);
          let p2 = parseInt(dateParts[1]);
          let p3 = parseInt(dateParts[2]);

          let year, month, day;
          if (p1 > 1000) {
            // YYYY-MM-DD
            year = p1;
            month = p2;
            day = p3;
          } else if (p3 > 1000) {
            // DD/MM/YYYY or MM/DD/YYYY
            year = p3;
            if (p1 > 12) {
              // DD/MM/YYYY
              day = p1;
              month = p2;
            } else if (p2 > 12) {
              // MM/DD/YYYY
              month = p1;
              day = p2;
            } else {
              // Default to standard Nigerian style DD/MM/YYYY first
              day = p1;
              month = p2;
            }
          } else {
            // Two digit year
            year = 2000 + p3;
            day = p1;
            month = p2;
          }

          let hours = 0, minutes = 0, seconds = 0;
          if (parts.length >= 2) {
            const timeStr = parts[1];
            const timeParts = timeStr.split(':');
            hours = parseInt(timeParts[0] || 0);
            minutes = parseInt(timeParts[1] || 0);
            seconds = parseInt(timeParts[2] || 0);

            // Check AM/PM
            const ampm = cleanStr.toLowerCase();
            if (ampm.includes('pm') && hours < 12) hours += 12;
            if (ampm.includes('am') && hours === 12) hours = 0;
          }

          // Build date using Date.UTC for timezone independence
          d = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
          if (!isNaN(d.getTime())) return d;
        }
      }
    }
  } catch (e) {
    console.error('safeParseDate error:', e);
  }
  return new Date(0);
}


// Helper to send emails via Resend API or SMTP fallback
function sendResendEmail(to, subject, html, retries = 3, delay = 1000) {
  // Skip placeholder derived emails
  if (!to || to.endsWith('@9jacash.com') || !to.includes('@')) {
    console.log(`[EMAIL SKIP] Placeholder or invalid email address: ${to}`);
    return Promise.resolve({ success: false, reason: 'skipped_placeholder' });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM || '9jaCash <onboarding@resend.dev>';

  const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

  // Define fallback helper to SMTP
  function sendSmtpFallback() {
    // Simulation Fallback: If no credentials are set, simulate the email
    if (!smtpUser || !smtpPass || smtpUser.includes('placeholder') || smtpPass.includes('placeholder')) {
      console.log(`[EMAIL SIMULATION] To: ${to} | Subject: ${subject}`);
      return Promise.resolve({ success: true, simulated: true });
    }

    const nodemailer = require('nodemailer');
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
              console.warn(`[SMTP RETRY] Retrying in ${currentDelay}ms... (${remainingAttempts - 1} left)`);
              setTimeout(() => attempt(remainingAttempts - 1, currentDelay * 2), currentDelay);
            } else {
              reject(error);
            }
          } else {
            console.log(`[SMTP SUCCESS] Email successfully delivered! MsgId: ${info.messageId}`);
            resolve({ success: true, messageId: info.messageId });
          }
        });
      }
      attempt(retries, delay);
    });
  }

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
                console.warn(`[RESEND FAILURE] Resend API failed. Falling back to SMTP (Gmail)...`);
                sendSmtpFallback().then(resolve).catch(reject);
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
            console.warn(`[RESEND FAILURE] Resend connection failed. Falling back to SMTP (Gmail)...`);
            sendSmtpFallback().then(resolve).catch(reject);
          }
        });

        req.write(data);
        req.end();
      }

      attemptResend(retries, delay);
    });
  }

  // If no Resend API key is configured, go straight to SMTP
  return sendSmtpFallback();
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
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: function (res, filepath) {
    if (filepath.endsWith('.html') || filepath.includes('admin') || filepath.includes('junior')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// ─── ADMIN DASHBOARD STATISTICS CACHE ──────────────────────────────────────
let superStatsCache = null;
let superStatsCachedAt = 0;
const STATS_CACHE_TTL = 60 * 1000; // 60 seconds

let juniorAnalyticsCache = {}; // Key: juniorCode, Value: { data, cachedAt }

function invalidateDashboardCaches() {
  superStatsCache = null;
  superStatsCachedAt = 0;
  juniorAnalyticsCache = {};
  console.log('🔄 Dashboard statistics caches invalidated.');
}

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

// POST /api/auto-detect-bank — Try to automatically detect bank and name for a NUBAN
app.post('/api/auto-detect-bank', async (req, res) => {
  const { account_number } = req.body || {};
  if (!account_number || !/^\d{10}$/.test(account_number)) {
    return res.status(400).json({ status: false, error: 'Invalid account number.' });
  }

  const popularBanks = [
    { code: '999992', name: 'OPay Digital Services Limited (OPay)' },
    { code: '999991', name: 'PalmPay' },
    { code: '50515', name: 'Moniepoint Microfinance Bank' },
    { code: '50211', name: 'Kuda Microfinance Bank' },
    { code: '058', name: 'Guaranty Trust Bank' },
    { code: '044', name: 'Access Bank' },
    { code: '033', name: 'United Bank For Africa' },
    { code: '057', name: 'Zenith Bank' }
  ];

  // Developer Fallback: If no Paystack key is loaded locally, auto-generate a valid mock response
  if (!PAYSTACK_SECRET_KEY || PAYSTACK_SECRET_KEY.includes('YOUR_PAYSTACK') || PAYSTACK_SECRET_KEY.includes('placeholder') || PAYSTACK_SECRET_KEY === 'YOUR_PAYSTACK_KEY') {
    return res.json({
      status: true,
      bank_code: '999992',
      bank_name: 'OPay Digital Services Limited (OPay)',
      account_name: 'DEV TEST USER',
      account_number: account_number
    });
  }

  try {
    const promises = popularBanks.map(async (bank) => {
      try {
        const paystackRes = await fetch(
          `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank.code}`,
          { headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}` } }
        );
        if (paystackRes.ok) {
          const data = await paystackRes.json();
          if (data.status && data.data?.account_name) {
            return {
              status: true,
              bank_code: bank.code,
              bank_name: bank.name,
              account_name: data.data.account_name,
              account_number: data.data.account_number
            };
          }
        }
      } catch (e) {
        // Ignore single bank lookup error
      }
      return null;
    });

    const results = await Promise.all(promises);
    const successfulResult = results.find(r => r !== null);

    if (successfulResult) {
      return res.json(successfulResult);
    }

    return res.status(404).json({ status: false, error: 'Could not automatically detect bank. Please select bank manually.' });
  } catch (err) {
    return res.status(500).json({ status: false, error: 'Detection service offline.' });
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
  } catch (e) {
    console.error('Error in findJuniorAdminCode:', e.message);
  }
  return null;
}

// Helper to map database underscore properties to camelCase properties for frontend compatibility
function mapUserKeys(u) {
  if (!u) return null;
  const isVer = u.is_verified === 1 || u.is_verified === true || u.is_verified === '1';
  return {
    phone: u.phone,
    email: u.email,
    fullName: u.full_name,
    name: u.full_name,
    customName: u.custom_name || '',
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
    is_verified: isVer ? 1 : 0,
    isVerified: isVer,
    createdAt: u.created_at
  };
}

async function getJuniorLinks(u) {
  const empty = {
    juniorTelegram: null, juniorWhatsapp: null,
    juniorTelegramActive: 0, juniorWhatsappActive: 0,
    juniorCommunity: null, juniorCommunityActive: 0,
    juniorWhatsappCommunity: null, juniorWhatsappCommunityActive: 0,
    hasJuniorLinks: false
  };

  if (!u) return empty;

  try {
    let ja = null;

    // Strategy 1: Use junior_admin_code already stored on the user
    if (u.junior_admin_code) {
      const res = await db.query('SELECT * FROM junior_admins WHERE UPPER(referral_code) = ?', [u.junior_admin_code.trim().toUpperCase()]);
      if (res && res.length > 0) ja = res[0];
    }

    // Strategy 2: referred_by IS a referral code (e.g. "011" or "SMARTTECHH")
    if (!ja && u.referred_by) {
      const refUp = u.referred_by.trim().toUpperCase();
      const res = await db.query('SELECT * FROM junior_admins WHERE UPPER(referral_code) = ?', [refUp]);
      if (res && res.length > 0) {
        ja = res[0];
        // Persist it so next time Strategy 1 works
        await db.query('UPDATE users SET junior_admin_code = ? WHERE phone = ?', [ja.referral_code, u.phone]);
        u.junior_admin_code = ja.referral_code;
      }
    }

    // Strategy 3: referred_by IS the junior admin's email
    if (!ja && u.referred_by) {
      const refUp = u.referred_by.trim().toUpperCase();
      const res = await db.query('SELECT * FROM junior_admins WHERE UPPER(email) = ?', [refUp]);
      if (res && res.length > 0) {
        ja = res[0];
        await db.query('UPDATE users SET junior_admin_code = ? WHERE phone = ?', [ja.referral_code, u.phone]);
        u.junior_admin_code = ja.referral_code;
      }
    }

    // Strategy 4: find via referral chain (referredBy -> parent user -> junior_admin_code)
    if (!ja && u.referred_by) {
      const jaCode = await findJuniorAdminCode(u.referred_by);
      if (jaCode) {
        const res = await db.query('SELECT * FROM junior_admins WHERE UPPER(referral_code) = ?', [jaCode.trim().toUpperCase()]);
        if (res && res.length > 0) {
          ja = res[0];
          await db.query('UPDATE users SET junior_admin_code = ? WHERE phone = ?', [ja.referral_code, u.phone]);
          u.junior_admin_code = ja.referral_code;
        }
      }
    }

    if (!ja) {
      console.log(`[JuniorLinks] No junior admin found for user ${u.phone} | referred_by=${u.referred_by} | junior_admin_code=${u.junior_admin_code}`);
      return empty;
    }

    console.log(`[JuniorLinks] Found junior admin ${ja.referral_code} for user ${u.phone}`);

    const juniorTelegram = ja.telegram_link || null;
    const juniorWhatsapp = ja.whatsapp_link || null;
    const juniorTelegramActive = ja.telegram_active != null ? (ja.telegram_active == 1 || ja.telegram_active === true ? 1 : 0) : 1;
    const juniorWhatsappActive = ja.whatsapp_active != null ? (ja.whatsapp_active == 1 || ja.whatsapp_active === true ? 1 : 0) : 1;
    const juniorCommunity = ja.community_link || null;
    const juniorCommunityActive = ja.community_active != null ? (ja.community_active == 1 || ja.community_active === true ? 1 : 0) : 1;
    const juniorWhatsappCommunity = ja.whatsapp_community_link || null;
    const juniorWhatsappCommunityActive = ja.whatsapp_community_active != null ? (ja.whatsapp_community_active == 1 || ja.whatsapp_community_active === true ? 1 : 0) : 1;

    const hasJuniorLinks = !!(juniorTelegram || juniorWhatsapp || juniorCommunity || juniorWhatsappCommunity);

    return {
      juniorTelegram, juniorWhatsapp,
      juniorTelegramActive, juniorWhatsappActive,
      juniorCommunity, juniorCommunityActive,
      juniorWhatsappCommunity, juniorWhatsappCommunityActive,
      hasJuniorLinks
    };
  } catch (e) {
    console.error('[JuniorLinks] Error:', e.message);
    return empty;
  }
}

async function resolveReferrerUser(refString) {
  if (!refString) return null;
  const raw = refString.toString().trim();
  if (!raw) return null;

  const cleanPhone = normalizePhone(raw);
  const rawUpper = raw.toUpperCase();

  let users = await db.query(`
    SELECT phone, email, full_name, balance 
    FROM users 
    WHERE phone = ? 
       OR phone = ? 
       OR LOWER(email) = ? 
       OR UPPER(junior_admin_code) = ?
  `, [cleanPhone, raw, raw.toLowerCase(), rawUpper]);

  if (users && users.length > 0) return users[0];
  return null;
}

async function creditReferralBonus(newUserPhone, newUserName, referrerPhone) {
  if (!referrerPhone || !newUserPhone) return;
  const refClean = normalizePhone(referrerPhone);
  const newClean = normalizePhone(newUserPhone);
  if (!refClean || !newClean || refClean === newClean) return;

  try {
    // 1. Prevent duplicate referral bonus crediting using referral_credits table
    const existingCredit = await db.query('SELECT id FROM referral_credits WHERE referred_phone = ?', [newClean]);
    if (existingCredit && existingCredit.length > 0) {
      return; // Already credited!
    }

    // 2. Fetch referral bonus amount setting (default 10,000)
    let referralBonus = 10000;
    try {
      const refSet = await db.query("SELECT value FROM system_settings WHERE key = 'referral_bonus'");
      if (refSet && refSet.length > 0 && refSet[0].value) {
        const parsed = typeof refSet[0].value === 'string' ? JSON.parse(refSet[0].value) : refSet[0].value;
        if (parsed && parsed.amount !== undefined) referralBonus = parseFloat(parsed.amount || 10000);
      }
    } catch (e) {}

    // 3. Atomically record in referral_credits
    const creditId = 'ref_cred_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    try {
      await db.query(`
        INSERT INTO referral_credits (id, referrer_phone, referred_phone, amount, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, [creditId, refClean, newClean, referralBonus, new Date().toISOString()]);
    } catch (insertErr) {
      return; // Unique constraint hit
    }

    // 4. Add ₦10,000 to Referrer's account balance
    await db.query('UPDATE users SET balance = balance + ? WHERE phone = ?', [referralBonus, refClean]);

    // 5. Insert notification alert for referrer
    const refNotifId = 'nt_' + Math.random().toString(36).substr(2, 9);
    await db.query(`
      INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
      VALUES (?, ?, 'alert', 'Referral Bonus Credited! 🎁', ?, ?, ?)
    `, [
      refNotifId, 
      refClean, 
      `Congratulations! You earned ₦${referralBonus.toLocaleString()} referral bonus for inviting ${newUserName || 'a new user'} (${newClean}).`, 
      referralBonus.toString(), 
      new Date().toISOString()
    ]);
    console.log(`[ReferralBonus] Credited ₦${referralBonus} to referrer ${refClean} for inviting ${newClean}`);
  } catch (err) {
    console.error('[ReferralBonus] Error crediting referral bonus:', err.message);
  }
}

// POST /api/register — User signup
app.post('/api/register', async (req, res) => {
  const { phone, email, password, fullName, bankName, accountNumber, promoCode, promoBonus, referredBy } = req.body || {};

  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone || cleanPhone.length !== 11) {
    return res.status(400).json({ status: false, error: 'Phone must be 11 digits (e.g. 08012345678)' });
  }
  if (!password || password.trim().length < 6) {
    return res.status(400).json({ status: false, error: 'Password must be at least 6 characters' });
  }
  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ status: false, error: 'Full name is required' });
  }

  const cleanEmail = (email && email.trim()) ? email.trim().toLowerCase() : `${cleanPhone}@9jacash.com`;
  const cleanPassword = password.trim();
  const cleanFullName = fullName.trim();
  const cleanAccount = (accountNumber || '').toString().trim();
  const cleanBank = (bankName || '').trim();

  try {
    const createdAt = new Date().toISOString();
    const referrerUser = await resolveReferrerUser(referredBy);
    const referrerPhone = referrerUser ? referrerUser.phone : (referredBy ? (normalizePhone(referredBy) || referredBy) : null);
    const juniorAdminCode = await findJuniorAdminCode(referredBy || referrerPhone);

    // Check if user already exists
    const existing = await db.query('SELECT phone FROM users WHERE phone = ? OR LOWER(email) = ?', [cleanPhone, cleanEmail]);

    if (existing && existing.length > 0) {
      // Upsert: Update existing user record with latest password and details
      const existingUser = existing[0];
      const jCode = existingUser.junior_admin_code || await findJuniorAdminCode(referredBy || existingUser.referred_by);
      await db.query(`
        UPDATE users 
        SET password = ?, full_name = ?, bank_name = ?, account_number = ?, email = ?,
            referred_by = COALESCE(referred_by, ?),
            junior_admin_code = COALESCE(junior_admin_code, ?)
        WHERE phone = ? OR LOWER(email) = ?
      `, [cleanPassword, cleanFullName, cleanBank || null, cleanAccount || null, cleanEmail, referrerPhone || referredBy || null, jCode || null, cleanPhone, cleanEmail]);
    } else {
      // Insert new user record
      await db.query(`
        INSERT INTO users (
          phone, email, password, full_name, bank_name, account_number, 
          balance, mining_power, total_mined, referred_by, junior_admin_code, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 10000, 1, 0, ?, ?, 'active', ?)
      `, [cleanPhone, cleanEmail, cleanPassword, cleanFullName, cleanBank || null, cleanAccount || null, referrerPhone || referredBy || null, juniorAdminCode, createdAt]);

      // Credit ₦10,000 Referral Bonus to Referrer immediately
      if (referrerPhone) {
        await creditReferralBonus(cleanPhone, cleanFullName, referrerPhone);
      }
    }

    // Fetch user record
    const users = await db.query('SELECT * FROM users WHERE phone = ? OR LOWER(email) = ?', [cleanPhone, cleanEmail]);

    // Send welcome email if custom email
    if (cleanEmail && !cleanEmail.endsWith('@9jacash.com')) {
      try {
        const welcomeHtml = compileEmailTemplate(
          "Account Activated! 🎉",
          `<p>Hi ${cleanFullName || 'User'},</p>
           <p>Welcome to <strong>9jaCash</strong>! Your account has been successfully created and activated.</p>
           <p>You can now start mining, completing tasks, and earning daily rewards.</p>`,
          "Go to Dashboard",
          `${getBaseUrl(req)}/dashboard.html`,
          "#10b981"
        );
        await sendResendEmail(cleanEmail, "Welcome to 9jaCash — Account Activated! 🎉", welcomeHtml);
      } catch (emailErr) {
        console.error('Failed to send registration welcome email:', emailErr.message);
      }
    }

    const mappedUser = mapUserKeys(users[0]);
    const juniorLinks = await getJuniorLinks(users[0]);
    res.status(201).json({ status: true, user: Object.assign({}, mappedUser, juniorLinks) });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ status: false, error: 'Registration failed: ' + err.message });
  }
});

function normalizePhone(p) {
  if (!p) return '';
  let digits = p.toString().replace(/\D/g, '');
  if (digits.startsWith('234') && digits.length === 13) {
    digits = '0' + digits.substring(3);
  }
  return digits;
}

// POST /api/login — User login (supports Phone OR Email)
app.post('/api/login', async (req, res) => {
  const { phoneOrEmail, password } = req.body || {};
  if (!phoneOrEmail || !password) {
    return res.status(400).json({ status: false, error: 'Credentials are required' });
  }

  const cleanInput = phoneOrEmail.trim();
  const cleanLower = cleanInput.toLowerCase();
  const normPhone = normalizePhone(cleanInput);
  const cleanPass = password.trim();

  try {
    const adminPass = process.env.ADMIN_PASSWORD || 'admin1083';
    if (cleanLower === 'admin@9jacash.com' && cleanPass === adminPass) {
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

    const users = await db.query(`
      SELECT * FROM users 
      WHERE (phone = ? OR phone = ? OR LOWER(phone) = ? OR LOWER(email) = ?) 
      AND password = ?
    `, [cleanInput, normPhone, cleanLower, cleanLower, cleanPass]);

    if (!users || users.length === 0) {
      // Check if user exists to give precise feedback
      const checkUser = await db.query(`
        SELECT * FROM users 
        WHERE phone = ? OR phone = ? OR LOWER(phone) = ? OR LOWER(email) = ?
      `, [cleanInput, normPhone, cleanLower, cleanLower]);

      if (checkUser && checkUser.length > 0) {
        return res.status(401).json({ status: false, error: 'Incorrect password. Please try again.' });
      }
      return res.status(401).json({ status: false, error: 'Account not found. Please check your phone or email, or register.' });
    }

    const user = users[0];
    if (user.status === 'suspended') {
      return res.status(403).json({ status: false, error: 'Account suspended. Contact support.' });
    }

    const mappedUser = mapUserKeys(user);
    const juniorLinks = await getJuniorLinks(user);
    res.json({ status: true, user: Object.assign({}, mappedUser, juniorLinks) });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ status: false, error: 'Login execution failed' });
  }
});

// POST /api/user/sync — Fetch fresh user stats with recovery and verification checks
app.post('/api/user/sync', async (req, res) => {
  const { phone, balance, totalMined, withdrawalCount, referredBy } = req.body || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone required' });

  const cleanPhone = normalizePhone(phone);
  try {
    const users = await db.query('SELECT * FROM users WHERE phone = ?', [cleanPhone]);
    const localBalance = parseFloat(balance) || 0;
    const localTotalMined = parseFloat(totalMined) || 0;

    let dbUser = null;
    if (!users || users.length === 0) {
      // Auto-migrate: create user row with frontend's local stats if available
      await db.query(`
        INSERT INTO users (phone, email, password, full_name, balance, total_mined, status, created_at)
        VALUES (?, ?, '123456', '9jaCash User', ?, ?, 'active', ?)
      `, [cleanPhone, `${cleanPhone}@9jacash.com`, localBalance, localTotalMined, new Date().toISOString()]);
      const newUsers = await db.query('SELECT * FROM users WHERE phone = ?', [cleanPhone]);
      dbUser = newUsers && newUsers.length > 0 ? newUsers[0] : null;
    } else {
      dbUser = users[0];
      let dbBalance = parseFloat(dbUser.balance) || 0;
      let dbTotalMined = parseFloat(dbUser.total_mined) || 0;
      let dbReferredBy = dbUser.referred_by || null;
      let dbJuniorAdminCode = dbUser.junior_admin_code || null;
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

      // Dynamic referral linking: if they landed via a referral code, sync it to database
      if (!dbReferredBy && referredBy) {
        const refUser = await resolveReferrerUser(referredBy);
        dbReferredBy = refUser ? refUser.phone : (normalizePhone(referredBy) || referredBy.trim().toUpperCase());
        dbJuniorAdminCode = await findJuniorAdminCode(dbReferredBy);
        needsUpdate = true;

        if (dbReferredBy) {
          await creditReferralBonus(cleanPhone, dbUser.full_name || '9jaCash User', dbReferredBy);
        }
      }

      if (needsUpdate) {
        await db.query(`
          UPDATE users 
          SET balance = ?, total_mined = ?, referred_by = ?, junior_admin_code = ? 
          WHERE phone = ?
        `, [dbBalance, dbTotalMined, dbReferredBy, dbJuniorAdminCode, cleanPhone]);
        const updatedUsers = await db.query('SELECT * FROM users WHERE phone = ?', [cleanPhone]);
        dbUser = updatedUsers && updatedUsers.length > 0 ? updatedUsers[0] : dbUser;
      }
    }

    // Recover/restore withdrawalCount if database has reset (ephemeral SQLite)
    const localWithdrawalCount = parseInt(withdrawalCount) || 0;
    const countCheck = await db.query('SELECT COUNT(*) AS count FROM withdrawals WHERE phone = ?', [cleanPhone]);
    const getCnt = (arr) => (arr && arr[0]) ? (arr[0].count || arr[0]['count'] || arr[0]['COUNT(*)'] || 0) : 0;
    let dbWithdrawalCount = parseInt(getCnt(countCheck));

    if (localWithdrawalCount > dbWithdrawalCount) {
      const missingCount = localWithdrawalCount - dbWithdrawalCount;
      for (let i = 0; i < missingCount; i++) {
        const dummyId = 'W_DUMMY_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '_' + i;
        await db.query(`
          INSERT INTO withdrawals (
            id, phone, full_name, amount, bank_name, account_number, status, created_at
          ) VALUES (?, ?, '9jaCash User', 0, 'Placeholder Bank', '0000000000', 'Approved', ?)
        `, [dummyId, cleanPhone, new Date().toISOString()]);
      }
    }

    // Determine verification status, withdrawal count, and if they have bounced before
    const rejectedWithdrawals = await db.query("SELECT COUNT(*) AS count FROM withdrawals WHERE phone = ? AND status = 'Rejected'", [cleanPhone]);
    const hasBouncedBefore = parseInt(getCnt(rejectedWithdrawals)) > 0;

    const withdrawalsResult = await db.query('SELECT COUNT(*) AS count FROM withdrawals WHERE phone = ?', [cleanPhone]);
    const finalWithdrawalCount = parseInt(getCnt(withdrawalsResult));

    const verificationResult = await db.query(
      "SELECT COUNT(*) AS count FROM receipts WHERE phone = ? AND type = 'account_verification' AND status = 'approved'",
      [cleanPhone]
    );
    const verified = parseInt(getCnt(verificationResult)) > 0;

    // Fetch referrals statistics with flexible phone/code matching
    const rawPhone = cleanPhone;
    const phoneNoZero = rawPhone.startsWith('0') ? rawPhone.substring(1) : rawPhone;
    const phone234 = '234' + phoneNoZero;

    const refCountRes = await db.query(`
      SELECT COUNT(*) as count FROM users 
      WHERE (referred_by = ? OR referred_by = ? OR referred_by = ? OR referred_by = ?)
        AND phone != ?
    `, [cleanPhone, rawPhone, phoneNoZero, phone234, cleanPhone]);
    const referralsCount = parseInt(getCnt(refCountRes));

    const activeRefCountRes = await db.query(`
      SELECT COUNT(*) as count FROM users 
      WHERE (referred_by = ? OR referred_by = ? OR referred_by = ? OR referred_by = ?)
        AND (is_verified = 1 OR CAST(is_verified AS text) = '1')
        AND phone != ?
    `, [cleanPhone, rawPhone, phoneNoZero, phone234, cleanPhone]);
    const activeReferralsCount = parseInt(getCnt(activeRefCountRes));

    let referralBonus = 10000;
    try {
      const refSet = await db.query("SELECT value FROM system_settings WHERE key = 'referral_bonus'");
      if (refSet && refSet.length > 0) {
        const parsed = JSON.parse(refSet[0].value);
        referralBonus = parseFloat(parsed.amount || 10000);
      }
    } catch (e) {
      console.error("Error fetching referral bonus in sync:", e);
    }
    const referralEarnings = referralsCount * referralBonus;

    // Sanity balance normalization for inflated balances (> 10,000,000 without huge deposits)
    let currentBal = parseFloat(dbUser.balance) || 0;
    if (currentBal > 5000000) {
      const baseBal = 10000;
      const mined = parseFloat(dbUser.total_mined) || 0;
      const refEarn = referralsCount * referralBonus;
      const realisticBal = baseBal + mined + refEarn;
      if (currentBal > realisticBal + 1000000) {
        currentBal = realisticBal;
        await db.query('UPDATE users SET balance = ? WHERE phone = ?', [realisticBal, cleanPhone]);
        dbUser.balance = realisticBal;
      }
    }

    const mapped = mapUserKeys(dbUser) || {
      phone: cleanPhone,
      email: `${cleanPhone}@9jacash.com`,
      fullName: '9jaCash User',
      balance: localBalance,
      miningPower: 1,
      totalMined: localTotalMined,
      planName: 'Free Miner',
      status: 'active'
    };
    mapped.hasBouncedBefore = hasBouncedBefore;
    mapped.withdrawalCount = finalWithdrawalCount;
    mapped.verified = verified;
    mapped.referralsCount = referralsCount;
    mapped.activeReferralsCount = activeReferralsCount;
    mapped.referralEarnings = referralEarnings;

    const juniorLinks = await getJuniorLinks(dbUser);
    res.json({ status: true, user: Object.assign({}, mapped, juniorLinks) });
  } catch (err) {
    console.error('Sync failed:', err.message);
    res.status(500).json({ status: false, error: 'Sync failed: ' + err.message });
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
  const { phone, amount, bankName, accountNumber, fullName, withdrawalCount } = req.body || {};
  if (!phone || !amount || !bankName || !accountNumber || !fullName) {
    return res.status(400).json({ status: false, error: 'Missing withdrawal parameters' });
  }

  try {
    // Check user balance and retrieve email
    const users = await db.query('SELECT balance, email, referred_by, is_verified FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) return res.status(404).json({ status: false, error: 'User not found' });

    const user = users[0];
    const isUserVerified = user.is_verified === 1 || user.is_verified === true || user.is_verified === '1';

    // Recover/restore withdrawalCount if database has reset (ephemeral SQLite)
    const localWithdrawalCount = parseInt(withdrawalCount) || 0;
    const countCheck = await db.query('SELECT COUNT(*) AS count FROM withdrawals WHERE phone = ?', [phone]);
    let dbWithdrawalCount = parseInt(countCheck[0].count || countCheck[0]['COUNT(*)'] || 0);

    if (localWithdrawalCount > dbWithdrawalCount) {
      const missingCount = localWithdrawalCount - dbWithdrawalCount;
      for (let i = 0; i < missingCount; i++) {
        const dummyId = 'W_DUMMY_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '_' + i;
        await db.query(`
          INSERT INTO withdrawals (
            id, phone, full_name, amount, bank_name, account_number, status, created_at
          ) VALUES (?, ?, '9jaCash User', 0, 'Placeholder Bank', '0000000000', 'Approved', ?)
        `, [dummyId, phone, new Date().toISOString()]);
      }
    }

    // Enforce account verification on 2nd withdrawal (after 1 successful/requested withdrawal)
    const withdrawalCountResult = await db.query('SELECT COUNT(*) AS count FROM withdrawals WHERE phone = ?', [phone]);
    const finalWithdrawalCount = parseInt(withdrawalCountResult[0].count || withdrawalCountResult[0]['COUNT(*)'] || 0);

    if (finalWithdrawalCount >= 1 && !isUserVerified) {
      const verificationCountResult = await db.query(
        "SELECT COUNT(*) AS count FROM receipts WHERE phone = ? AND type = 'account_verification' AND status = 'approved'",
        [phone]
      );
      const verificationCount = parseInt(verificationCountResult[0].count || verificationCountResult[0]['COUNT(*)'] || 0);

      if (verificationCount === 0) {
        return res.status(403).json({
          status: false,
          error: 'verification_required',
          message: 'You have completed 1 withdrawal. Please verify your account before initiating your second withdrawal.'
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
      SELECT w.*, u.is_verified 
      FROM withdrawals w 
      LEFT JOIN users u ON w.phone = u.phone 
      WHERE w.referred_by = ? 
         OR w.phone IN (SELECT phone FROM users WHERE junior_admin_code = ? OR referred_by = ?)
      ORDER BY w.created_at DESC
    `, [referralCode, referralCode, referralCode]);
    res.json({ status: true, withdrawals: list });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to fetch withdrawals' });
  }
});

// GET /api/admin/junior/stats — Fetch statistics for Junior Admin's referred network
app.get('/api/admin/junior/stats', async (req, res) => {
  const { referralCode } = req.query || {};
  if (!referralCode) return res.status(400).json({ status: false, error: 'Referral code required' });

  try {
    // Auto-reset commission every 1 week (7 days), or manual reset_at, whichever is more recent
    const nowTime = Date.now();
    const sevenDaysAgo = nowTime - (7 * 24 * 60 * 60 * 1000);
    const jaList = await db.query('SELECT reset_at FROM junior_admins WHERE referral_code = ?', [referralCode]);
    const manualResetTime = (jaList.length > 0 && jaList[0].reset_at) ? safeParseDate(jaList[0].reset_at).getTime() : 0;
    const resetTime = Math.max(sevenDaysAgo, manualResetTime);

    // 1. Get referred users created after resetTime
    const referredUsers = await db.query('SELECT phone, created_at FROM users WHERE junior_admin_code = ? OR referred_by = ?', [referralCode, referralCode]);
    const filteredUsers = referredUsers.filter(u => {
      const createdTime = u.created_at ? safeParseDate(u.created_at).getTime() : 0;
      return createdTime >= resetTime;
    });
    const phones = filteredUsers.map(u => u.phone);

    if (phones.length === 0) {
      return res.json({
        status: true,
        totalUsers: 0,
        approvedReceiptsAmount: 0,
        approvedWithdrawalsAmount: 0,
        keysSold: 0
      });
    }

    // Placeholders for IN query
    let placeholders = phones.map(() => '?').join(',');

    // 2. Fetch receipts and filter in-memory
    const receiptsList = await db.query(`
      SELECT amount, type, created_at FROM receipts 
      WHERE phone IN (${placeholders}) AND LOWER(status) IN ('approved', 'verified', 'completed', 'success')
      AND (type != 'junior_settlement' OR type IS NULL)
    `, phones);
    
    const filteredReceipts = receiptsList.filter(r => {
      const createdTime = r.created_at ? safeParseDate(r.created_at).getTime() : 0;
      return createdTime >= resetTime;
    });

    let approvedReceiptsAmount = 0;
    let keysSold = 0;
    for (const r of filteredReceipts) {
      let amt = parseFloat(r.amount);
      if (isNaN(amt) || amt <= 0) amt = 35200;
      approvedReceiptsAmount += amt;
      const rType = (r.type || '').toLowerCase();
      if (['verification', 'payout_key_purchase', 'account_verification', 'payout', 'key'].includes(rType)) {
        keysSold++;
      }
    }

    // 3. Fetch withdrawals and filter in-memory
    const withdrawalsList = await db.query(`
      SELECT amount, created_at FROM withdrawals 
      WHERE phone IN (${placeholders}) AND LOWER(status) IN ('approved', 'completed', 'success')
    `, phones);
    
    const filteredWithdrawals = withdrawalsList.filter(w => {
      const createdTime = w.created_at ? safeParseDate(w.created_at).getTime() : 0;
      return createdTime >= resetTime;
    });
    
    const approvedWithdrawalsAmount = filteredWithdrawals.reduce((sum, w) => sum + parseFloat(w.amount || 0), 0);

    res.json({
      status: true,
      totalUsers: phones.length,
      approvedReceiptsAmount,
      approvedWithdrawalsAmount,
      keysSold
    });
  } catch (err) {
    console.error('Junior stats error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to fetch junior admin stats' });
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

    invalidateDashboardCaches();
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

    invalidateDashboardCaches();
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
    invalidateDashboardCaches();
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

// POST /api/admin/junior/bulk-approve-withdrawals — Bulk approve multiple payouts for junior admin
app.post('/api/admin/junior/bulk-approve-withdrawals', async (req, res) => {
  const { ids, juniorCode } = req.body || {};
  if (!ids || !Array.isArray(ids) || ids.length === 0 || !juniorCode) {
    return res.status(400).json({ status: false, error: 'IDs list and junior referral code are required' });
  }
  try {
    const referredUsers = await db.query('SELECT phone FROM users WHERE junior_admin_code = ? OR referred_by = ?', [juniorCode, juniorCode]);
    const phones = referredUsers.map(u => u.phone);

    for (const id of ids) {
      const list = await db.query('SELECT phone, amount, bank_name, account_number, status FROM withdrawals WHERE id = ?', [id]);
      if (list.length === 0) continue;
      const w = list[0];
      if (w.status !== 'Pending') continue;
      if (!phones.includes(w.phone)) continue; // ensure ownership

      await db.query("UPDATE withdrawals SET status = 'Approved' WHERE id = ?", [id]);

      // Email
      const users = await db.query('SELECT email, full_name FROM users WHERE phone = ?', [w.phone]);
      if (users.length > 0 && users[0].email) {
        const approvalHtml = compileEmailTemplate(
          "Withdrawal Successful 🎉",
          `<p>Hi ${users[0].full_name || 'User'},</p>
           <p>Great news! Your withdrawal request of <strong>₦${parseFloat(w.amount).toLocaleString()}</strong> has been approved and processed.</p>`,
          "Open Dashboard",
          `${getBaseUrl(req)}/dashboard.html`,
          "#10b981"
        );
        try {
          await sendResendEmail(users[0].email, "Withdrawal Approved & Paid Out! 🎉", approvalHtml);
        } catch (e) {}
      }
    }
    invalidateDashboardCaches();
    res.json({ status: true, message: `Successfully approved ${ids.length} withdrawals` });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Bulk approval failed' });
  }
});

// POST /api/admin/junior/bulk-reject-withdrawals — Bulk reject multiple payouts for junior admin
app.post('/api/admin/junior/bulk-reject-withdrawals', async (req, res) => {
  const { ids, reason, juniorCode } = req.body || {};
  if (!ids || !Array.isArray(ids) || ids.length === 0 || !juniorCode) {
    return res.status(400).json({ status: false, error: 'IDs list and junior referral code are required' });
  }
  try {
    const referredUsers = await db.query('SELECT phone FROM users WHERE junior_admin_code = ? OR referred_by = ?', [juniorCode, juniorCode]);
    const phones = referredUsers.map(u => u.phone);

    for (const id of ids) {
      const list = await db.query('SELECT phone, amount, status FROM withdrawals WHERE id = ?', [id]);
      if (list.length === 0) continue;
      const w = list[0];
      if (w.status !== 'Pending') continue;
      if (!phones.includes(w.phone)) continue; // ensure ownership

      await db.query("UPDATE withdrawals SET status = 'Rejected' WHERE id = ?", [id]);

      const users = await db.query('SELECT balance, email, full_name FROM users WHERE phone = ?', [w.phone]);
      if (users.length > 0) {
        const u = users[0];
        const refundedBalance = parseFloat(u.balance) + parseFloat(w.amount);
        await db.query('UPDATE users SET balance = ? WHERE phone = ?', [refundedBalance, w.phone]);

        if (u.email) {
          const bounceHtml = compileEmailTemplate(
            "Withdrawal Returned — Action Required ⚠️",
            `<p>Hi ${u.full_name || 'User'},</p>
             <p>Your withdrawal of <strong>₦${parseFloat(w.amount).toLocaleString()}</strong> was returned to your wallet balance.</p>
             <div style="background-color:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.2); border-radius:8px; padding:15px; margin:15px 0; color:#fca5a5;">
               <strong>Reason:</strong> ${reason || 'Bank details mismatch'}
             </div>`,
            "Verify Account Now",
            `${getBaseUrl(req)}/verify.html`,
            "#ef4444"
          );
          try {
            await sendResendEmail(u.email, "Withdrawal Returned — Action Required", bounceHtml);
          } catch (e) {}
        }
      }

      const msgId = 'nt_' + Math.random().toString(36).substr(2, 9);
      await db.query(`
        INSERT INTO user_notifications (id, phone, type, title, content, created_at)
        VALUES (?, ?, 'alert', 'Withdrawal Rejected', ?, ?)
      `, [msgId, w.phone, `Your withdrawal of ₦${parseFloat(w.amount).toLocaleString()} was declined. Reason: ${reason || 'Bank details mismatch'}. Your balance has been fully refunded.`, new Date().toISOString()]);
    }
    invalidateDashboardCaches();
    res.json({ status: true, message: `Successfully rejected ${ids.length} withdrawals` });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Bulk rejection failed' });
  }
});

// POST /api/admin/junior/bulk-delete-users — Bulk delete users in junior admin network
app.post('/api/admin/junior/bulk-delete-users', async (req, res) => {
  const { phones, juniorCode } = req.body || {};
  if (!phones || !Array.isArray(phones) || phones.length === 0 || !juniorCode) {
    return res.status(400).json({ status: false, error: 'Phones list and junior referral code are required' });
  }
  try {
    const referredUsers = await db.query('SELECT phone FROM users WHERE junior_admin_code = ? OR referred_by = ?', [juniorCode, juniorCode]);
    const allowedPhones = referredUsers.map(u => u.phone);

    for (const phone of phones) {
      if (!allowedPhones.includes(phone)) continue; // ensure ownership
      await db.query('DELETE FROM user_notifications WHERE phone = ?', [phone]);
      await db.query('DELETE FROM withdrawals WHERE phone = ?', [phone]);
      await db.query('DELETE FROM receipts WHERE phone = ?', [phone]);
      await db.query('DELETE FROM users WHERE phone = ?', [phone]);
    }
    invalidateDashboardCaches();
    res.json({ status: true, message: `Successfully deleted ${phones.length} users` });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Bulk deletion failed' });
  }
});

// POST /api/admin/junior/bulk-approve-receipts — Bulk approve receipts for junior admin
app.post('/api/admin/junior/bulk-approve-receipts', async (req, res) => {
  const { ids, juniorCode } = req.body || {};
  if (!ids || !Array.isArray(ids) || ids.length === 0 || !juniorCode) {
    return res.status(400).json({ status: false, error: 'IDs list and junior referral code are required' });
  }
  try {
    const referredUsers = await db.query('SELECT phone FROM users WHERE junior_admin_code = ? OR referred_by = ?', [juniorCode, juniorCode]);
    const phones = referredUsers.map(u => u.phone);

    for (const id of ids) {
      const receipts = await db.query('SELECT * FROM receipts WHERE id = ?', [id]);
      if (receipts.length === 0) continue;
      const rc = receipts[0];
      if (!phones.includes(rc.phone)) continue; // ensure ownership
      if (rc.status === 'Approved') continue;

      await db.query("UPDATE receipts SET status = 'Approved' WHERE id = ?", [id]);

      const users = await db.query('SELECT email, full_name, referred_by FROM users WHERE phone = ?', [rc.phone]);
      const u = users[0];

      if (rc.type === 'verification' || rc.type === 'account_verification') {
        await db.query('UPDATE users SET is_verified = 1, balance = balance + 35000 WHERE phone = ?', [rc.phone]);
        const keyStr = '9JA-' + Math.floor(100000 + Math.random() * 900000);
        await db.query('UPDATE users SET payout_key = ? WHERE phone = ?', [keyStr, rc.phone]);

        const referrerPhone = u ? u.referred_by : null;
        if (referrerPhone) {
          let referralBonus = 10000;
          try {
            const refSet = await db.query("SELECT value FROM system_settings WHERE key = 'referral_bonus'");
            if (refSet && refSet.length > 0 && refSet[0].value) {
              const parsed = typeof refSet[0].value === 'string' ? JSON.parse(refSet[0].value) : refSet[0].value;
              if (parsed && parsed.amount !== undefined) referralBonus = parseFloat(parsed.amount);
            }
          } catch (e) {}

          const referrerUser = await db.query('SELECT phone FROM users WHERE phone = ?', [referrerPhone]);
          if (referrerUser && referrerUser.length > 0) {
            await db.query('UPDATE users SET balance = balance + ? WHERE phone = ?', [referralBonus, referrerPhone]);
            const refNotifId = 'nt_' + Math.random().toString(36).substr(2, 9);
            await db.query(`
              INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
              VALUES (?, ?, 'alert', 'Referral Bonus Credited! 🎁', ?, ?, ?)
            `, [refNotifId, referrerPhone, `You have been credited with ₦${referralBonus.toLocaleString()} because your referral ${u.full_name || 'User'} (${rc.phone}) completed verification.`, referralBonus.toString(), new Date().toISOString()]);
          }
        }
      } else if (rc.type === 'upgrade') {
        const plan = rc.plan_name || 'Basic Miner';
        let power = 2;
        if (plan.includes('Silver')) power = 5;
        else if (plan.includes('Gold')) power = 10;
        else if (plan.includes('Diamond')) power = 25;

        await db.query('UPDATE users SET plan_name = ?, mining_power = ? WHERE phone = ?', [plan, power, rc.phone]);
      }
    }
    invalidateDashboardCaches();
    res.json({ status: true, message: `Successfully approved ${ids.length} receipts` });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Bulk receipt approval failed' });
  }
});

// POST /api/admin/junior/bulk-reject-receipts — Bulk reject receipts for junior admin
app.post('/api/admin/junior/bulk-reject-receipts', async (req, res) => {
  const { ids, reason, juniorCode } = req.body || {};
  if (!ids || !Array.isArray(ids) || ids.length === 0 || !juniorCode) {
    return res.status(400).json({ status: false, error: 'IDs list and junior referral code are required' });
  }
  try {
    const referredUsers = await db.query('SELECT phone FROM users WHERE junior_admin_code = ? OR referred_by = ?', [juniorCode, juniorCode]);
    const phones = referredUsers.map(u => u.phone);

    for (const id of ids) {
      const receipts = await db.query('SELECT * FROM receipts WHERE id = ?', [id]);
      if (receipts.length === 0) continue;
      const rc = receipts[0];
      if (!phones.includes(rc.phone)) continue; // ensure ownership
      if (rc.status === 'Declined' || rc.status === 'Declined ❌') continue;

      await db.query("UPDATE receipts SET status = 'Declined' WHERE id = ?", [id]);

      const msgId = 'nt_' + Math.random().toString(36).substr(2, 9);
      await db.query(`
        INSERT INTO user_notifications (id, phone, type, title, content, created_at)
        VALUES (?, ?, 'alert', 'Payment Declined ❌', ?, ?)
      `, [msgId, rc.phone, `Your payment receipt for ${rc.type || 'upgrade'} was declined. Reason: ${reason || 'Invalid bank reference'}.`, new Date().toISOString()]);
    }
    invalidateDashboardCaches();
    res.json({ status: true, message: `Successfully rejected ${ids.length} receipts` });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Bulk receipt rejection failed' });
  }
});

// POST /api/admin/junior/bulk-delete-receipts — Bulk delete receipts for junior admin
app.post('/api/admin/junior/bulk-delete-receipts', async (req, res) => {
  const { ids, juniorCode } = req.body || {};
  if (!ids || !Array.isArray(ids) || ids.length === 0 || !juniorCode) {
    return res.status(400).json({ status: false, error: 'IDs list and junior referral code are required' });
  }
  try {
    const referredUsers = await db.query('SELECT phone FROM users WHERE junior_admin_code = ? OR referred_by = ?', [juniorCode, juniorCode]);
    const phones = referredUsers.map(u => u.phone);

    const validIds = [];
    for (const id of ids) {
      const receipts = await db.query('SELECT phone FROM receipts WHERE id = ?', [id]);
      if (receipts.length === 0) continue;
      if (phones.includes(receipts[0].phone)) {
        validIds.push(id);
      }
    }

    if (validIds.length > 0) {
      const placeholders = validIds.map(() => '?').join(', ');
      await db.query(`DELETE FROM receipts WHERE id IN (${placeholders})`, validIds);
    }
    invalidateDashboardCaches();
    res.json({ status: true, message: `Successfully deleted ${validIds.length} receipts` });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Bulk receipts deletion failed' });
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
        const junior = await db.query('SELECT * FROM junior_admins WHERE referral_code = ?', [refCode]);
        if (junior.length > 0) {
          const ja = junior[0];
          return res.json({
            status: true,
            useGlobal: false,
            bankName: ja.bank_name || 'Contact Junior Admin',
            accNumber: ja.account_number || '—',
            accName: ja.account_name || '—',
            feeBankName: ja.fee_bank_name || ja.bank_name || 'Contact Junior Admin',
            feeAccNumber: ja.fee_account_number || ja.account_number || '—',
            feeAccName: ja.fee_account_name || ja.account_name || '—',
            feeAmount: ja.fee_amount !== null && ja.fee_amount !== undefined ? parseFloat(ja.fee_amount) : 35200,
            telegramLink: ja.telegram_link || null,
            whatsappLink: ja.whatsapp_link || null
          });
        } else {
          // Junior admin code exists but record not found, return empty placeholder for security
          return res.json({
            status: true,
            useGlobal: false,
            bankName: 'Contact Junior Admin',
            accNumber: '—',
            accName: '—',
            feeBankName: 'Contact Junior Admin',
            feeAccNumber: '—',
            feeAccName: '—',
            feeAmount: 35200,
            telegramLink: null,
            whatsappLink: null
          });
        }
      }
    }

    // Otherwise, return useGlobal: true to fallback to Super Admin Firestore bank details
    res.json({ status: true, useGlobal: true });
  } catch (err) {
    console.error('Payment instructions query error:', err.message);
    res.json({ status: true, useGlobal: true });
  }
});

// ─── SUPER ADMIN ENDPOINTS (FOR CREATING & MANAGING JUNIOR ADMINS) ───────────

// POST /api/admin/super/create-junior — Add Junior Admin
app.post('/api/admin/super/create-junior', async (req, res) => {
  const { email, password, referralCode, bankName, accountNumber, accountName } = req.body || {};
  console.log('[CREATE-JUNIOR] Request received:', { email, referralCode, bankName });
  if (!email || !password || !referralCode) {
    console.log('[CREATE-JUNIOR] Missing required fields');
    return res.status(400).json({ status: false, error: 'Email, password and referral code are required' });
  }

  try {
    // Check duplicate
    const dups = await db.query('SELECT email FROM junior_admins WHERE email = ? OR referral_code = ?', [email, referralCode]);
    if (dups.length > 0) {
      console.log('[CREATE-JUNIOR] Duplicate found:', dups[0]);
      return res.status(409).json({ status: false, error: 'Email or Referral Code already in use' });
    }

    await db.query(`
      INSERT INTO junior_admins (email, password, referral_code, bank_name, account_number, account_name, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `, [email, password, referralCode, bankName || null, accountNumber || null, accountName || null, new Date().toISOString()]);

    console.log('[CREATE-JUNIOR] Successfully created junior admin:', email, referralCode);
    res.status(201).json({ status: true, message: 'Junior admin created successfully' });
  } catch (err) {
    console.error('[CREATE-JUNIOR] Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to create junior admin: ' + err.message });
  }
});

// GET /api/admin/seed-junior?code=011&email=test@test.com&pass=pass123 — Emergency seed endpoint
app.get('/api/admin/seed-junior', async (req, res) => {
  const { code, email, pass } = req.query;
  if (!code || !email || !pass) {
    return res.status(400).json({ error: 'Provide code, email, and pass as query params' });
  }
  try {
    const existing = await db.query('SELECT email FROM junior_admins WHERE email = ? OR referral_code = ?', [email, code.toUpperCase()]);
    if (existing.length > 0) {
      return res.json({ status: 'already_exists', existing: existing[0] });
    }
    await db.query(`
      INSERT INTO junior_admins (email, password, referral_code, is_active, created_at)
      VALUES (?, ?, ?, 1, ?)
    `, [email, pass, code.toUpperCase(), new Date().toISOString()]);
    const check = await db.query('SELECT * FROM junior_admins WHERE email = ?', [email]);
    res.json({ status: 'created', record: check[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET /api/admin/super/withdrawals — Fetch withdrawals (paginated, filtered, searchable)
app.get('/api/admin/super/withdrawals', async (req, res) => {
  const { page, limit, status, search } = req.query || {};
  try {
    let queryStr = `
      SELECT w.*, u.is_verified 
      FROM withdrawals w 
      LEFT JOIN users u ON w.phone = u.phone
    `;
    let countStr = `
      SELECT COUNT(*) as count 
      FROM withdrawals w 
      LEFT JOIN users u ON w.phone = u.phone
    `;
    let params = [];
    let whereClauses = [];

    if (status) {
      whereClauses.push('LOWER(w.status) = ?');
      params.push(status.trim().toLowerCase());
    }

    if (search) {
      const term = search.trim();
      const termLower = term.toLowerCase();
      if (/^\+?[0-9]+$/.test(term)) {
        whereClauses.push('(w.phone LIKE ? OR w.account_number LIKE ?)');
        params.push(`${term}%`, `${term}%`);
      } else {
        const cleanSearch = `%${termLower}%`;
        whereClauses.push('(LOWER(w.full_name) LIKE ? OR LOWER(w.referred_by) LIKE ? OR w.id = ?)');
        params.push(cleanSearch, cleanSearch, term);
      }
    }

    if (whereClauses.length > 0) {
      const clause = ' WHERE ' + whereClauses.join(' AND ');
      queryStr += clause;
      countStr += clause;
    }

    queryStr += ' ORDER BY w.created_at DESC';

    if (page) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 50;
      const offsetNum = (pageNum - 1) * limitNum;

      const totalCountRes = await db.query(countStr, params);
      const getCnt = (arr) => (arr && arr[0]) ? (arr[0].count || arr[0]['count'] || arr[0]['COUNT(*)'] || 0) : 0;
      const total = parseInt(getCnt(totalCountRes));
      const pages = Math.ceil(total / limitNum);

      const paginatedParams = [...params, limitNum, offsetNum];
      const list = await db.query(queryStr + ' LIMIT ? OFFSET ?', paginatedParams);

      res.json({
        status: true,
        withdrawals: list || [],
        total,
        page: pageNum,
        pages,
        limit: limitNum
      });
    } else {
      const list = await db.query(queryStr, params);
      res.json({ status: true, withdrawals: list || [] });
    }
  } catch (err) {
    console.error('Failed to fetch withdrawals:', err.message);
    res.json({ status: true, withdrawals: [], total: 0, page: 1, pages: 1, limit: 50 });
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

    invalidateDashboardCaches();
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

    invalidateDashboardCaches();
    res.json({ status: true, message: 'Withdrawal rejected and refunded successfully' });
  } catch (err) {
    console.error('Super rejection error:', err.message);
    res.status(500).json({ status: false, error: 'Rejection failed' });
  }
});

// POST /api/admin/super/bulk-approve-withdrawals — Bulk approve multiple payouts
app.post('/api/admin/super/bulk-approve-withdrawals', async (req, res) => {
  const { ids } = req.body || {};
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ status: false, error: 'Withdrawal IDs are required' });
  }
  try {
    for (const id of ids) {
      const list = await db.query('SELECT phone, amount, bank_name, account_number, status FROM withdrawals WHERE id = ?', [id]);
      if (list.length === 0) continue;
      const w = list[0];
      if (w.status !== 'Pending') continue;
      
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
    }
    invalidateDashboardCaches();
    res.json({ status: true, message: `Successfully approved ${ids.length} withdrawals` });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Bulk approval failed' });
  }
});

// POST /api/admin/super/bulk-reject-withdrawals — Bulk reject multiple payouts with refund
app.post('/api/admin/super/bulk-reject-withdrawals', async (req, res) => {
  const { ids, reason } = req.body || {};
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ status: false, error: 'Withdrawal IDs are required' });
  }
  try {
    for (const id of ids) {
      const list = await db.query('SELECT phone, amount, status FROM withdrawals WHERE id = ?', [id]);
      if (list.length === 0) continue;
      const w = list[0];
      if (w.status !== 'Pending') continue;
      
      await db.query("UPDATE withdrawals SET status = 'Rejected' WHERE id = ?", [id]);
      
      // Refund user balance
      const users = await db.query('SELECT balance, email, full_name FROM users WHERE phone = ?', [w.phone]);
      if (users.length > 0) {
        const u = users[0];
        const refundedBalance = parseFloat(u.balance) + parseFloat(w.amount);
        await db.query('UPDATE users SET balance = ? WHERE phone = ?', [refundedBalance, w.phone]);
        
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
      
      // Send notification alert to user
      const msgId = 'nt_' + Math.random().toString(36).substr(2, 9);
      await db.query(`
        INSERT INTO user_notifications (id, phone, type, title, content, created_at)
        VALUES (?, ?, 'alert', 'Withdrawal Rejected', ?, ?)
      `, [msgId, w.phone, `Your withdrawal of ₦${parseFloat(w.amount).toLocaleString()} was declined. Reason: ${reason || 'Bank details mismatch'}. Your balance has been fully refunded.`, new Date().toISOString()]);
    }
    invalidateDashboardCaches();
    res.json({ status: true, message: `Successfully rejected ${ids.length} withdrawals` });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Bulk rejection failed' });
  }
});

// GET /api/admin/super/juniors — List all Junior Admins with Earnings & Commission stats
let superJuniorsCache = null;
let superJuniorsCachedAt = 0;

app.get('/api/admin/super/juniors', async (req, res) => {
  try {
    const nowTime = Date.now();
    if (superJuniorsCache && (nowTime - superJuniorsCachedAt < 10000)) {
      return res.json(superJuniorsCache);
    }

    const list = await db.query('SELECT email, referral_code, bank_name, account_number, account_name, is_active, created_at, reset_at FROM junior_admins ORDER BY created_at DESC');

    // Get setting for admin percentage
    let adminPercentage = 20;
    try {
      const settingRes = await db.query("SELECT value FROM system_settings WHERE key = 'admin_percentage'");
      if (settingRes && settingRes.length > 0 && settingRes[0].value) {
        const parsed = typeof settingRes[0].value === 'string' ? JSON.parse(settingRes[0].value) : settingRes[0].value;
        adminPercentage = parseFloat(parsed.percentage) ?? 20;
      }
    } catch (e) {}

    const juniorCodes = list.map(j => (j.referral_code || '').trim().toUpperCase()).filter(Boolean);

    // 1. Get users, receipts, and settlements in parallel
    const [users, receipts, settlements] = juniorCodes.length > 0
      ? await Promise.all([
          db.query('SELECT phone, junior_admin_code, referred_by, created_at FROM users WHERE junior_admin_code IS NOT NULL OR referred_by IS NOT NULL'),
          db.query(`SELECT phone, amount, created_at FROM receipts WHERE LOWER(status) IN ('approved', 'verified', 'completed', 'success') AND (type != 'junior_settlement' OR type IS NULL)`),
          db.query(`SELECT phone as email, status, amount, created_at FROM receipts WHERE type = 'junior_settlement'`)
        ])
      : [[], [], []];

    // Pre-index receipts by phone number for O(1) instant lookup
    const receiptsByPhoneMap = new Map();
    for (const r of receipts) {
      if (!receiptsByPhoneMap.has(r.phone)) receiptsByPhoneMap.set(r.phone, []);
      receiptsByPhoneMap.get(r.phone).push(r);
    }

    // Pre-index users by code for O(1) instant lookup
    const usersByCodeMap = new Map();
    for (const u of users) {
      const jaCode = (u.junior_admin_code || '').trim().toUpperCase();
      const refCode = (u.referred_by || '').trim().toUpperCase();
      if (jaCode) {
        if (!usersByCodeMap.has(jaCode)) usersByCodeMap.set(jaCode, []);
        usersByCodeMap.get(jaCode).push(u);
      }
      if (refCode && refCode !== jaCode) {
        if (!usersByCodeMap.has(refCode)) usersByCodeMap.set(refCode, []);
        usersByCodeMap.get(refCode).push(u);
      }
    }

    // Pre-index settlements by email
    const settlementsByEmailMap = new Map();
    for (const s of settlements) {
      const em = (s.email || '').trim().toLowerCase();
      if (!settlementsByEmailMap.has(em)) settlementsByEmailMap.set(em, []);
      settlementsByEmailMap.get(em).push(s);
    }

    const sevenDaysAgo = nowTime - (7 * 24 * 60 * 60 * 1000);
    const juniorsWithStats = [];

    for (const j of list) {
      const code = (j.referral_code || '').trim().toUpperCase();
      const manualResetTime = j.reset_at ? safeParseDate(j.reset_at).getTime() : 0;
      const resetTime = Math.max(sevenDaysAgo, manualResetTime);

      const candidateUsers = usersByCodeMap.get(code) || [];
      const juniorUsers = candidateUsers.filter(u => {
        const createdTime = u.created_at ? safeParseDate(u.created_at).getTime() : 0;
        return createdTime >= resetTime;
      });

      const totalUsers = juniorUsers.length;
      let totalEarnings = 0;

      for (const u of juniorUsers) {
        const userReceipts = receiptsByPhoneMap.get(u.phone) || [];
        for (const r of userReceipts) {
          const createdTime = r.created_at ? safeParseDate(r.created_at).getTime() : 0;
          if (createdTime >= resetTime) {
            let amt = parseFloat(r.amount);
            if (isNaN(amt) || amt <= 0) amt = 35200;
            totalEarnings += amt;
          }
        }
      }

      const commission = totalEarnings * ((100 - adminPercentage) / 100);

      let totalPaid = 0;
      let pendingSettlement = 0;
      const lowerEmail = j.email.trim().toLowerCase();
      const candidateSettlements = settlementsByEmailMap.get(lowerEmail) || [];

      for (const s of candidateSettlements) {
        const createdTime = s.created_at ? safeParseDate(s.created_at).getTime() : 0;
        if (createdTime >= resetTime) {
          const amt = parseFloat(s.amount) || 0;
          const status = (s.status || '').toLowerCase();
          if (status === 'approved' || status === 'verified' || status === 'completed' || status === 'success') {
            totalPaid += amt;
          } else if (status === 'pending') {
            pendingSettlement += amt;
          }
        }
      }

      juniorsWithStats.push({
        email: j.email,
        code: j.referral_code, // original mapped key
        referral_code: j.referral_code,
        bank_name: j.bank_name,
        account_number: j.account_number,
        account_name: j.account_name,
        is_active: j.is_active,
        created_at: j.created_at,
        reset_at: j.reset_at || null,
        stats: {
          totalGross: totalEarnings,
          adminShare: totalEarnings * (adminPercentage / 100),
          juniorShare: commission,
          totalUsers,
          totalPaid,
          pendingSettlement
        },
        totalUsers,
        totalEarnings,
        commission,
        totalPaid,
        pendingSettlement
      });
    }

    res.json({ status: true, juniors: juniorsWithStats });
  } catch (err) {
    console.error('Failed to fetch junior admins list with stats:', err.message);
    res.json({ status: false, error: err.message, juniors: [] });
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

// POST /api/admin/super/update-user-plan-manual — Manually upgrade or downgrade a user's plan
app.post('/api/admin/super/update-user-plan-manual', async (req, res) => {
  const { phone, plan } = req.body || {};
  if (!phone || !plan) {
    return res.status(400).json({ status: false, error: 'Phone and plan name are required' });
  }
  
  try {
    const users = await db.query('SELECT phone FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) return res.status(404).json({ status: false, error: 'User not found' });
    
    let power = 1;
    let cleanPlan = plan.trim();
    const planLower = cleanPlan.toLowerCase();
    
    if (planLower.includes('silver')) {
      power = 5;
    } else if (planLower.includes('gold')) {
      power = 10;
    } else if (planLower.includes('diamond')) {
      power = 25;
    } else if (planLower.includes('basic') || planLower.includes('key')) {
      power = 2;
    } else {
      cleanPlan = 'Free Miner';
      power = 1;
    }
    
    await db.query('UPDATE users SET plan_name = ?, mining_power = ? WHERE phone = ?', [cleanPlan, power, phone]);
    invalidateDashboardCaches();
    res.json({ status: true, message: `User plan successfully updated to ${cleanPlan} (${power}x power)` });
  } catch (err) {
    console.error('Manual plan update error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to update user plan manually' });
  }
});

// POST /api/admin/super/reset-junior-earnings — Reset a junior admin's commission baseline
app.post('/api/admin/super/reset-junior-earnings', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ status: false, error: 'Junior admin email required' });
  try {
    const nowIso = new Date().toISOString();
    await db.query('UPDATE junior_admins SET reset_at = ? WHERE email = ?', [nowIso, email]);
    res.json({ status: true, message: 'Junior admin earnings reset successfully' });
  } catch (err) {
    console.error('Reset junior earnings error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to reset junior admin earnings' });
  }
});

// POST /api/admin/junior/reset-my-earnings — Junior admin resets their OWN earnings baseline
app.post('/api/admin/junior/reset-my-earnings', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ status: false, error: 'Email and password required' });
  try {
    const list = await db.query('SELECT id FROM junior_admins WHERE email = ? AND password = ? AND is_active = 1', [email, password]);
    if (!list || list.length === 0) return res.status(401).json({ status: false, error: 'Invalid credentials' });
    const nowIso = new Date().toISOString();
    await db.query('UPDATE junior_admins SET reset_at = ? WHERE email = ?', [nowIso, email]);
    invalidateDashboardCaches();
    res.json({ status: true, message: 'Your earnings have been reset. Stats now count from today.' });
  } catch (err) {
    console.error('Junior self-reset earnings error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to reset earnings' });
  }
});

// POST /api/admin/super/reset-admin-stats — Reset super admin metrics baseline
app.post('/api/admin/super/reset-admin-stats', async (req, res) => {
  try {
    const nowIso = new Date().toISOString();
    const existing = await db.query("SELECT key FROM system_settings WHERE key = 'admin_stats_reset_at'");
    if (existing && existing.length > 0) {
      await db.query("UPDATE system_settings SET value = ? WHERE key = 'admin_stats_reset_at'", [nowIso]);
    } else {
      await db.query("INSERT INTO system_settings (key, value) VALUES ('admin_stats_reset_at', ?)", [nowIso]);
    }
    invalidateDashboardCaches();
    res.json({ status: true, message: 'Super admin stats reset successfully' });
  } catch (err) {
    console.error('Reset admin stats error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to reset admin stats' });
  }
});

// GET /api/admin/super/users — Fetch list of all registered users (paginated and searchable)
app.get('/api/admin/super/users', async (req, res) => {
  const { page, limit, search } = req.query || {};
  try {
    let queryStr = 'SELECT phone, email, full_name, bank_name, account_number, balance, mining_power, total_mined, referred_by, junior_admin_code, payout_key, status, is_verified, created_at FROM users';
    let countStr = 'SELECT COUNT(*) as count FROM users';
    let params = [];
    let whereClauses = [];

    if (search) {
      const term = search.trim();
      const termLower = term.toLowerCase();
      if (/^\+?[0-9]+$/.test(term)) {
        whereClauses.push('(phone LIKE ?)');
        params.push(`${term}%`);
      } else if (term.includes('@')) {
        whereClauses.push('(email LIKE ?)');
        params.push(`%${termLower}%`);
      } else {
        const cleanSearch = `%${termLower}%`;
        whereClauses.push('(LOWER(full_name) LIKE ? OR junior_admin_code = ? OR referred_by = ?)');
        params.push(cleanSearch, term.toUpperCase(), term.toUpperCase());
      }
    }

    if (whereClauses.length > 0) {
      const clause = ' WHERE ' + whereClauses.join(' AND ');
      queryStr += clause;
      countStr += clause;
    }

    queryStr += ' ORDER BY created_at DESC';

    if (page) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 50;
      const offsetNum = (pageNum - 1) * limitNum;

      const totalCountRes = await db.query(countStr, params);
      const getCnt = (arr) => (arr && arr[0]) ? (arr[0].count || arr[0]['count'] || arr[0]['COUNT(*)'] || 0) : 0;
      const total = parseInt(getCnt(totalCountRes));
      const pages = Math.ceil(total / limitNum);

      const paginatedParams = [...params, limitNum, offsetNum];
      const list = await db.query(queryStr + ' LIMIT ? OFFSET ?', paginatedParams);

      res.json({
        status: true,
        users: list || [],
        total,
        page: pageNum,
        pages,
        limit: limitNum
      });
    } else {
      const list = await db.query(queryStr, params);
      res.json({ status: true, users: list || [] });
    }
  } catch (err) {
    console.error('Failed to fetch users list:', err.message);
    res.json({ status: true, users: [], total: 0, page: 1, pages: 1, limit: 50 });
  }
});

// POST /api/admin/super/verify-user — Toggle user verified checkmark status
app.post('/api/admin/super/verify-user', async (req, res) => {
  const { phone, isVerified } = req.body || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone number required' });

  const digitsOnly = phone.toString().replace(/\D/g, '');
  const last10 = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;

  try {
    const users = await db.query(`
      SELECT phone FROM users 
      WHERE phone = ? 
         OR (LENGTH(?) > 5 AND phone LIKE ?)
         OR (LENGTH(?) > 5 AND REPLACE(REPLACE(phone, '+', ''), ' ', '') LIKE ?)
      ORDER BY created_at DESC LIMIT 1
    `, [phone, last10, '%' + last10, last10, '%' + last10]);

    if (users.length === 0) return res.status(404).json({ status: false, error: 'User not found' });
    const targetPhone = users[0].phone;

    const val = (isVerified === true || isVerified === 1 || isVerified === '1') ? 1 : 0;
    await db.query('UPDATE users SET is_verified = ? WHERE phone = ?', [val, targetPhone]);
    res.json({ status: true, message: `User verification mark updated (${val === 1 ? 'Verified' : 'Unverified'})` });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

// GET /api/admin/super/migrate-from-neon — Trigger one-click data migration from Neon to Render Postgres
app.get('/api/admin/super/migrate-from-neon', async (req, res) => {
  const { Pool } = require('pg');
  const neonUrl = 'postgresql://neondb_owner:npg_DJo20VrMUKam@ep-wild-smoke-ay0gdd4y-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require';

  try {
    const sourcePool = new Pool({ connectionString: neonUrl, ssl: { rejectUnauthorized: false } });

    const tablesRes = await sourcePool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const tables = tablesRes.rows.map(r => r.table_name);

    let report = {};

    for (const table of tables) {
      const colRes = await sourcePool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table]);
      const columns = colRes.rows.map(c => c.column_name);

      const rowsRes = await sourcePool.query(`SELECT * FROM "${table}"`);
      const rows = rowsRes.rows;

      let inserted = 0;
      if (rows.length > 0) {
        const colNames = columns.map(c => `"${c}"`).join(', ');
        for (const row of rows) {
          const values = columns.map(c => row[c]);
          const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
          const insertQuery = `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
          try {
            await db.query(insertQuery, values);
            inserted++;
          } catch (e) {
            console.warn(`Migration notice on ${table}:`, e.message);
          }
        }
      }
      report[table] = `${inserted}/${rows.length} records transferred`;
    }

    await sourcePool.end();
    res.json({ status: true, message: 'Data migration from Neon to Render Postgres completed successfully!', report });
  } catch (err) {
    console.error('Migration endpoint error:', err);
    res.status(500).json({ status: false, error: err.message });
  }
});

// GET /api/admin/super/stats — Fetch platform stats (total users, approved amounts, keys sold)
app.get('/api/admin/super/stats', async (req, res) => {
  try {
    const nowTime = Date.now();
    if (superStatsCache && (nowTime - superStatsCachedAt < STATS_CACHE_TTL)) {
      return res.json(superStatsCache);
    }

    // Get stats reset baseline timestamp
    let adminResetTime = 0;
    try {
      const resetSetting = await db.query("SELECT value FROM system_settings WHERE key = 'admin_stats_reset_at'");
      if (resetSetting && resetSetting.length > 0 && resetSetting[0].value) {
        adminResetTime = safeParseDate(resetSetting[0].value).getTime();
      }
    } catch (e) {
      console.error('Error fetching admin_stats_reset_at:', e);
    }

    const uCount = await db.query('SELECT COUNT(*) as cnt FROM users');
    const jCount = await db.query('SELECT COUNT(*) as cnt FROM junior_admins');
    const wCount = await db.query("SELECT COUNT(*) as cnt FROM withdrawals WHERE status = 'Pending'");

    // Fetch all approved receipts (excluding junior settlements)
    const receipts = await db.query(`
      SELECT amount, type, plan_name, created_at FROM receipts 
      WHERE LOWER(status) IN ('approved', 'verified', 'completed', 'success')
      AND (type != 'junior_settlement' OR type IS NULL)
    `);

    // Fetch all approved withdrawals
    const withdrawalsList = await db.query(`
      SELECT amount, created_at FROM withdrawals 
      WHERE LOWER(status) IN ('approved', 'completed', 'success')
    `);

    const getCnt = (arr) => (arr && arr[0]) ? (arr[0].cnt || arr[0]['cnt'] || arr[0]['COUNT(*)'] || 0) : 0;

    // Align timezone with WAT (UTC+1, Nigeria Time)
    const now = new Date();
    const watTime = new Date(now.getTime() + 1 * 60 * 60 * 1000);
    const y = watTime.getUTCFullYear();
    const m = watTime.getUTCMonth();
    const d = watTime.getUTCDate();

    const startOfToday = Date.UTC(y, m, d, 0, 0, 0) - 1 * 60 * 60 * 1000;
    const startOfYesterday = startOfToday - (24 * 60 * 60 * 1000);
    const endOfYesterday = startOfToday;
    const startOfSevenDays = startOfToday - (6 * 24 * 60 * 60 * 1000);
    const startOf30Days = startOfToday - (29 * 24 * 60 * 60 * 1000);
    const startOf1Year = startOfToday - (365 * 24 * 60 * 60 * 1000);

    let today = 0, yesterday = 0, sevenDays = 0, month = 0, year = 0, total = 0;
    let keysRevenue = { today: 0, yesterday: 0, sevenDays: 0, month: 0, year: 0, total: 0 };
    let verificationRevenue = { today: 0, yesterday: 0, sevenDays: 0, month: 0, year: 0, total: 0 };
    let upgradeRevenue = { today: 0, yesterday: 0, sevenDays: 0, month: 0, year: 0, total: 0 };
    let keysSold = { today: 0, yesterday: 0, sevenDays: 0, month: 0, year: 0, total: 0 };

    // Apply baseline adminResetTime to in-memory receipts sum
    const filteredReceipts = receipts.filter(r => safeParseDate(r.created_at).getTime() >= adminResetTime);

    filteredReceipts.forEach(r => {
      let amt = parseFloat(r.amount);
      if (isNaN(amt) || amt <= 0) {
        amt = 35200; // default verification fee if not specified
      }
      total += amt;
      const rTime = safeParseDate(r.created_at).getTime();

      // Total Deposits Revenue timeframe mapping
      if (rTime >= startOfToday) {
        today += amt;
      } else if (rTime >= startOfYesterday && rTime < endOfYesterday) {
        yesterday += amt;
      }
      if (rTime >= startOfSevenDays) sevenDays += amt;
      if (rTime >= startOf30Days) month += amt;
      if (rTime >= startOf1Year) year += amt;

      const rType = (r.type || '').toLowerCase();
      const isVer = (rType === 'verification' || rType === 'account_verification');
      const isKey = (rType === 'payout' || rType === 'key' || rType === 'payout_key_purchase' || rType === 'payout_key' || rType === 'payoutkey') || (r.plan_name && r.plan_name.toLowerCase().includes('key'));
      const isUpgrade = (rType === 'upgrade');

      if (isVer) {
        verificationRevenue.total += amt;
        if (rTime >= startOfToday) {
          verificationRevenue.today += amt;
        } else if (rTime >= startOfYesterday && rTime < endOfYesterday) {
          verificationRevenue.yesterday += amt;
        }
        if (rTime >= startOfSevenDays) verificationRevenue.sevenDays += amt;
        if (rTime >= startOf30Days) verificationRevenue.month += amt;
        if (rTime >= startOf1Year) verificationRevenue.year += amt;
      } else if (isKey) {
        keysRevenue.total += amt;
        if (rTime >= startOfToday) {
          keysRevenue.today += amt;
          keysSold.today++;
        } else if (rTime >= startOfYesterday && rTime < endOfYesterday) {
          keysRevenue.yesterday += amt;
          keysSold.yesterday++;
        }
        if (rTime >= startOfSevenDays) {
          keysRevenue.sevenDays += amt;
          keysSold.sevenDays++;
        }
        if (rTime >= startOf30Days) {
          keysRevenue.month += amt;
          keysSold.month++;
        }
        if (rTime >= startOf1Year) {
          keysRevenue.year += amt;
          keysSold.year++;
        }
        keysSold.total++;
      } else if (isUpgrade) {
        upgradeRevenue.total += amt;
        if (rTime >= startOfToday) {
          upgradeRevenue.today += amt;
        } else if (rTime >= startOfYesterday && rTime < endOfYesterday) {
          upgradeRevenue.yesterday += amt;
        }
        if (rTime >= startOfSevenDays) upgradeRevenue.sevenDays += amt;
        if (rTime >= startOf30Days) upgradeRevenue.month += amt;
        if (rTime >= startOf1Year) upgradeRevenue.year += amt;
      }
    });

    let keysSoldOffset = 67;
    try {
      const offsetRes = await db.query("SELECT value FROM system_settings WHERE key = 'keys_sold_offset'");
      if (offsetRes && offsetRes.length > 0 && offsetRes[0].value) {
        keysSoldOffset = parseInt(offsetRes[0].value) || 0;
      } else {
        await db.query("INSERT INTO system_settings (key, value) VALUES ('keys_sold_offset', '67')");
      }
    } catch (e) { }

    keysSold.total += keysSoldOffset;

    // Apply baseline adminResetTime to in-memory withdrawals sum
    const filteredWithdrawals = withdrawalsList.filter(w => safeParseDate(w.created_at).getTime() >= adminResetTime);
    const approvedWithdrawalsAmount = filteredWithdrawals.reduce((sum, w) => sum + parseFloat(w.amount || 0), 0);

    // Dynamic stats: total approved count, declined count, verified count, and plan breakdowns
    const approvedReceiptsList = await db.query("SELECT created_at FROM receipts WHERE LOWER(status) IN ('approved', 'verified', 'completed', 'success') AND (type != 'junior_settlement' OR type IS NULL)");
    const totalApprovedCount = approvedReceiptsList.filter(r => safeParseDate(r.created_at).getTime() >= adminResetTime).length;

    const declinedReceiptsList = await db.query("SELECT created_at FROM receipts WHERE LOWER(status) IN ('declined', 'rejected', 'failed', 'decline') AND (type != 'junior_settlement' OR type IS NULL)");
    const totalDeclinedCount = declinedReceiptsList.filter(r => safeParseDate(r.created_at).getTime() >= adminResetTime).length;

    const verifiedUsersRes = await db.query("SELECT COUNT(*) as cnt FROM users WHERE is_verified = 1 OR is_verified = '1'");
    const totalVerifiedUsersCount = parseInt(verifiedUsersRes[0].cnt || 0);

    const planCounts = { gold: 0, silver: 0, diamond: 0 };
    const plansList = await db.query("SELECT plan_name FROM users WHERE plan_name IS NOT NULL");
    for (const row of plansList) {
      const pName = (row.plan_name || '').toLowerCase();
      if (pName.includes('gold')) planCounts.gold++;
      else if (pName.includes('silver')) planCounts.silver++;
      else if (pName.includes('diamond')) planCounts.diamond++;
    }

    const joinedTodayRes = await db.query("SELECT COUNT(*) as cnt FROM users WHERE created_at >= ?", [new Date(startOfToday).toISOString()]);
    const totalUsersToday = parseInt(joinedTodayRes[0].cnt || 0);

    const statsResponse = {
      status: true,
      totalUsers: parseInt(getCnt(uCount)),
      totalJuniors: parseInt(getCnt(jCount)),
      totalPendingWithdrawals: parseInt(getCnt(wCount)),
      approvedReceiptsAmount: total,
      today,
      yesterday,
      sevenDays,
      month,
      year,
      keysRevenue,
      verificationRevenue,
      upgradeRevenue,
      approvedWithdrawalsAmount,
      keysSold: keysSold,
      totalApprovedCount,
      totalDeclinedCount,
      totalVerifiedUsers: totalVerifiedUsersCount,
      planCounts,
      joinedToday: totalUsersToday
    };
    superStatsCache = statsResponse;
    superStatsCachedAt = nowTime;
    res.json(statsResponse);
  } catch (err) {
    console.error('Failed to fetch stats:', err.message);
    res.json({
      status: true,
      totalUsers: 0,
      totalJuniors: 0,
      totalPendingWithdrawals: 0,
      approvedReceiptsAmount: 0,
      today: 0,
      sevenDays: 0,
      month: 0,
      year: 0,
      keysRevenue: { today: 0, sevenDays: 0, month: 0, year: 0, total: 0 },
      verificationRevenue: { today: 0, sevenDays: 0, month: 0, year: 0, total: 0 },
      upgradeRevenue: { today: 0, sevenDays: 0, month: 0, year: 0, total: 0 },
      approvedWithdrawalsAmount: 0,
      keysSold: 0
    });
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

// POST /api/admin/super/clear-balance — Clear a user's balance to 0 from the Super Admin console
app.post('/api/admin/super/clear-balance', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ status: false, error: 'Phone required' });

  try {
    const users = await db.query('SELECT phone FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) return res.status(404).json({ status: false, error: 'User not found' });

    await db.query('UPDATE users SET balance = 0 WHERE phone = ?', [phone]);

    // Add a notification alert for the user
    const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
    await db.query(`
      INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
      VALUES (?, ?, 'alert', 'Account Balance Reset ⚠️', 'Your account balance has been reset to ₦0 by the administration.', '0', ?)
    `, [notifId, phone, new Date().toISOString()]);

    res.json({ status: true, message: 'User balance cleared successfully' });
  } catch (err) {
    console.error('Clear user balance error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to clear user balance' });
  }
});

// POST /api/admin/super/credit-user — Credit a user's balance from the Super Admin console
app.post('/api/admin/super/credit-user', async (req, res) => {
  const { phone, amount, sendNotification } = req.body || {};
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

    const sendNotif = sendNotification !== false;
    if (sendNotif) {
      // Add a notification alert for the user
      const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
      await db.query(`
        INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
        VALUES (?, ?, 'alert', 'Account Credited 🎉', ?, ?, ?)
      `, [notifId, phone, `Your account has been credited with ₦${amtVal.toLocaleString()} by the administration.`, amtVal.toString(), new Date().toISOString()]);
    }

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

  const digitsOnly = phone.toString().replace(/\D/g, '');
  const last10 = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;

  try {
    const users = await db.query(`
      SELECT phone, email, full_name FROM users 
      WHERE phone = ? 
         OR (LENGTH(?) > 5 AND phone LIKE ?)
         OR (LENGTH(?) > 5 AND REPLACE(REPLACE(phone, '+', ''), ' ', '') LIKE ?)
      ORDER BY created_at DESC LIMIT 1
    `, [phone, last10, '%' + last10, last10, '%' + last10]);

    if (users.length === 0) return res.status(404).json({ status: false, error: 'User not found' });
    const u = users[0];

    const keyStr = '9JA-' + Math.floor(100000 + Math.random() * 900000);
    await db.query('UPDATE users SET payout_key = ? WHERE phone = ?', [keyStr, u.phone]);

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
    const digitsOnly = userPhone.toString().replace(/\D/g, '');
    const last10 = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;

    const users = await db.query(`
      SELECT phone, email, full_name, referred_by, junior_admin_code FROM users 
      WHERE phone = ? 
         OR (LENGTH(?) > 5 AND phone LIKE ?)
         OR (LENGTH(?) > 5 AND REPLACE(REPLACE(phone, '+', ''), ' ', '') LIKE ?)
      ORDER BY created_at DESC LIMIT 1
    `, [userPhone, last10, '%' + last10, last10, '%' + last10]);

    if (users.length === 0) return res.status(404).json({ status: false, error: 'User not found' });
    const u = users[0];

    const isReferred = u.junior_admin_code === jaCode || u.referred_by === jaCode || (await findJuniorAdminCode(u.referred_by)) === jaCode;
    if (!isReferred) {
      return res.status(403).json({ status: false, error: 'This user is not in your referral network' });
    }

    // 3. Generate key and save to database
    const keyStr = '9JA-' + Math.floor(100000 + Math.random() * 900000);
    await db.query('UPDATE users SET payout_key = ? WHERE phone = ?', [keyStr, u.phone]);

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
        const admins = await db.query('SELECT bank_name, account_number, account_name, crypto_address, crypto_network FROM junior_admins WHERE referral_code = ?', [refCode]);
        if (admins.length > 0) {
          return res.json({
            status: true,
            type: 'junior',
            accNumber: admins[0].account_number || '—',
            bank: admins[0].bank_name || 'Contact Junior Admin',
            accName: admins[0].account_name || '—',
            cryptoAddress: admins[0].crypto_address || 'Not available',
            cryptoNetwork: admins[0].crypto_network || '—'
          });
        } else {
          // Junior admin record not found in database, return placeholders
          return res.json({
            status: true,
            type: 'junior',
            accNumber: '—',
            bank: 'Contact Junior Admin',
            accName: '—',
            cryptoAddress: 'Not available',
            cryptoNetwork: '—'
          });
        }
      }
    }
    res.json({ status: true, type: 'global' });
  } catch (err) {
    console.error('Fetch payment details error:', err.message);
    res.json({ status: true, type: 'global' });
  }
});

// POST /api/admin/junior/update-payment-settings — Save Junior Admin bank & crypto details
app.post('/api/admin/junior/update-payment-settings', async (req, res) => {
  const {
    email, password, bankName, accountNumber, accountName, cryptoAddress, cryptoNetwork,
    feeBankName, feeAccountNumber, feeAccountName, feeAmount, telegramLink, whatsappLink,
    telegramActive, whatsappActive, communityLink, communityActive, whatsappCommunityLink, whatsappCommunityActive
  } = req.body || {};
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
      SET bank_name = ?, account_number = ?, account_name = ?, crypto_address = ?, crypto_network = ?,
          fee_bank_name = ?, fee_account_number = ?, fee_account_name = ?, fee_amount = ?,
          telegram_link = ?, whatsapp_link = ?,
          telegram_active = ?, whatsapp_active = ?,
          community_link = ?, community_active = ?,
          whatsapp_community_link = ?, whatsapp_community_active = ?
      WHERE email = ?
    `, [
      bankName || null, accountNumber || null, accountName || null, cryptoAddress || null, cryptoNetwork || null,
      feeBankName || null, feeAccountNumber || null, feeAccountName || null, feeAmount !== undefined && feeAmount !== null ? parseFloat(feeAmount) : null,
      telegramLink || null, whatsappLink || null,
      telegramActive !== undefined ? (telegramActive ? 1 : 0) : 1,
      whatsappActive !== undefined ? (whatsappActive ? 1 : 0) : 1,
      communityLink || null,
      communityActive !== undefined ? (communityActive ? 1 : 0) : 1,
      whatsappCommunityLink || null,
      whatsappCommunityActive !== undefined ? (whatsappCommunityActive ? 1 : 0) : 1,
      email
    ]);
    const fresh = await db.query('SELECT * FROM junior_admins WHERE email = ?', [email]);
    res.json({ status: true, admin: fresh[0], message: 'Payment settings updated successfully' });
  } catch (err) {
    console.error('Update junior payment settings error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to update payment settings' });
  }
});

// POST /api/admin/junior/submit-settlement — Submit a commission settlement receipt
app.post('/api/admin/junior/submit-settlement', async (req, res) => {
  const { code, email, amount, receiptImage } = req.body || {};
  if (!code || !amount || !receiptImage) {
    return res.status(400).json({ status: false, error: 'Missing required fields' });
  }
  try {
    const id = 'rc_set_' + Math.random().toString(36).substr(2, 9);
    const createdAt = new Date().toISOString();

    await db.query(`
      INSERT INTO receipts (id, phone, user_name, type, plan_name, amount, receipt_image, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, code, email || 'Junior Admin', 'junior_settlement', 'Commission Settlement', parseFloat(amount), receiptImage, 'pending', createdAt]);

    res.json({ status: true, message: 'Settlement receipt submitted successfully' });
  } catch (err) {
    console.error('Error submitting settlement receipt:', err.message);
    res.status(500).json({ status: false, error: err.message });
  }
});

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

// ─── PROMO LOGIN/SIGNUP VIDEOS (TIKTOK STYLE) ──────────────────────────────────
app.get('/api/login-videos', async (req, res) => {
  try {
    const list = await db.query('SELECT * FROM login_videos ORDER BY id ASC');
    res.json({ status: true, videos: list });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

app.post('/api/login-video/:id/like', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE login_videos SET likes_count = likes_count + 1 WHERE id = ?', [id]);
    const updated = await db.query('SELECT likes_count FROM login_videos WHERE id = ?', [id]);
    res.json({ status: true, likes: updated[0] ? updated[0].likes_count : 0 });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

app.post('/api/admin/login-video/update', async (req, res) => {
  const { id, videoUrl, videoData, likes, favorites, shares, caption } = req.body || {};
  if (!id) {
    return res.status(400).json({ status: false, error: 'Video ID is required' });
  }
  try {
    let finalUrl = videoUrl || '';

    // If base64 video data is provided, upload/save it
    if (videoData && videoData.startsWith('data:video/')) {
      const fs = require('fs');
      const path = require('path');
      const matches = videoData.match(/^data:(video\/[a-zA-Z0-9.-]+);base64,(.+)$/);
      if (!matches) {
        return res.status(400).json({ status: false, error: 'Invalid video file format.' });
      }
      const ext = matches[1].split('/')[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');

      const uploadsDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const uniqueName = `promo_video_${id}_${Date.now()}.${ext}`;
      const filePath = path.join(uploadsDir, uniqueName);
      fs.writeFileSync(filePath, buffer);
      finalUrl = `/uploads/${uniqueName}`;
    }

    // Update the DB entry
    const updateFields = [];
    const params = [];

    if (finalUrl !== undefined && finalUrl !== null) {
      updateFields.push('video_url = ?');
      params.push(finalUrl);
    }
    if (likes !== undefined && likes !== null) {
      updateFields.push('likes_count = ?');
      params.push(parseInt(likes) || 0);
    }
    if (favorites !== undefined && favorites !== null) {
      updateFields.push('favorites_count = ?');
      params.push(parseInt(favorites) || 0);
    }
    if (shares !== undefined && shares !== null) {
      updateFields.push('shares_count = ?');
      params.push(parseInt(shares) || 0);
    }
    if (caption !== undefined && caption !== null) {
      updateFields.push('caption = ?');
      params.push(caption.toString());
    }

    if (updateFields.length > 0) {
      params.push(id);
      await db.query(`UPDATE login_videos SET ${updateFields.join(', ')} WHERE id = ?`, params);
    }

    const fresh = await db.query('SELECT * FROM login_videos WHERE id = ?', [id]);
    res.json({ status: true, message: 'Promo video updated successfully', video: fresh[0] });
  } catch (err) {
    console.error('Update promo video error:', err.message);
    res.status(500).json({ status: false, error: err.message });
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

    let videoUrl = '';

    // If videoData is a direct web link (YouTube, TikTok, Cloudinary link, etc.)
    if (typeof videoData === 'string' && (videoData.startsWith('http://') || videoData.startsWith('https://') || !videoData.includes(';base64,'))) {
      videoUrl = videoData.trim();
    } else {
      // Ensure uploads directory exists (local fallback only)
      const uploadsDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      // Decode base64 video data
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

      videoUrl = `/uploads/${uniqueName}`;
    }

    const id = 'vid_' + Math.random().toString(36).substr(2, 9);
    await db.query(`
      INSERT INTO video_submissions (id, phone, video_url, status, created_at)
      VALUES (?, ?, ?, 'Pending', ?)
    `, [id, phone, videoUrl, new Date().toISOString()]);

    res.json({ status: true, message: 'Video submission received successfully!', videoUrl });
  } catch (err) {
    console.error('Video upload and submission error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to upload video: ' + err.message });
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

// GET /api/cloudinary-signature — Generate signature for direct Cloudinary uploads
app.get('/api/cloudinary-signature', (req, res) => {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dyinhcicj';
    const apiKey = process.env.CLOUDINARY_API_KEY || '713329398677614';
    const apiSecret = process.env.CLOUDINARY_API_SECRET || '6b7mEQNHwSLhXPXxCEwcwwTMllg';

    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(500).json({ status: false, error: 'Cloudinary credentials are not configured on the server.' });
    }

    const timestamp = Math.round(new Date().getTime() / 1000);
    const crypto = require('crypto');

    const folder = req.query.folder || 'video_challenges';

    // Sign parameters: folder and timestamp sorted alphabetically
    const stringToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(stringToSign).digest('hex');

    res.json({
      status: true,
      signature,
      timestamp,
      apiKey,
      cloudName,
      folder
    });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
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

// POST /api/admin/delete-video — Super Admin delete video submission record
app.post('/api/admin/delete-video', async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ status: false, error: 'Submission ID required.' });

  try {
    await db.query('DELETE FROM video_submissions WHERE id = ?', [id]);
    res.json({ status: true, message: 'Video submission deleted successfully.' });
  } catch (err) {
    res.status(500).json({ status: false, error: 'Failed to delete video submission: ' + err.message });
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

// GET /api/cron/reminders — Scheduled Vercel cron job for sending mining reminders
app.get('/api/cron/reminders', async (req, res) => {
  try {
    const list = await db.query("SELECT email, full_name FROM users WHERE email IS NOT NULL AND email NOT LIKE '%@9jacash.com'");
    let sentCount = 0;
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
      sentCount++;
    }
    console.log(`[CRON SUCCESS] Daily mining reminders sent successfully to ${sentCount} users.`);
    res.json({ status: true, message: `Successfully sent daily reminder emails to ${sentCount} users.` });
  } catch (err) {
    console.error('[CRON ERROR] Reminders failed:', err.message);
    res.status(500).json({ status: false, error: err.message });
  }
});

// POST /api/admin/super/trigger-reminders — Manual trigger for mining reminders
app.post('/api/admin/super/trigger-reminders', async (req, res) => {
  try {
    const list = await db.query("SELECT email, full_name FROM users WHERE email IS NOT NULL AND email NOT LIKE '%@9jacash.com'");
    let sentCount = 0;
    const fallbackUrl = process.env.APP_URL || 'https://9jacash.com';
    const ctaUrl = req ? `${getBaseUrl(req)}/dashboard.html` : `${fallbackUrl}/dashboard.html`;

    const CHUNK_SIZE = 5;
    for (let i = 0; i < list.length; i += CHUNK_SIZE) {
      const chunk = list.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (u) => {
          try {
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
          } catch (e) {
            console.error(`Failed to send daily reminder to ${u.email}:`, e.message);
          }
        })
      );
      await new Promise(resolve => setTimeout(resolve, 200));
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

    const CHUNK_SIZE = 5;
    for (let i = 0; i < list.length; i += CHUNK_SIZE) {
      const chunk = list.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (u) => {
          try {
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
          } catch (e) {
            console.error(`Failed to send daily scheduler reminder to ${u.email}:`, e.message);
          }
        })
      );
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    console.log("Daily mining reminders sent successfully via scheduler.");
  } catch (err) {
    console.error("Daily reminders scheduler failed:", err);
  }
}, 24 * 60 * 60 * 1000);

// GET /api/settings/:key — Retrieve system settings
app.get('/api/settings/:key', async (req, res) => {
  const { key } = req.params;
  const { phone } = req.query || {};
  const defaults = {
    payment: { bankName: 'Kuda MFB', accountNumber: '2088598772', accountName: 'Christian|Ts Agent', paymentNotice: '' },
    secondBilling: { feeAmount: 35200 },
    tasks: { tasksList: [] },
    withdrawalStatus: { active: false },
    paymentStatus: { active: false },
    videoChallenge: { active: true },
    payoutKeys: { price: 25000 },
    redirects: { payoutSuccess: 'success.html', payoutFailed: 'payment-failed.html' },
    admin_percentage: { percentage: 20 },
    referral_bonus: { amount: 10000 },
    verificationVideo: { videoUrl: '', active: false }
  };
  try {
    let value = defaults[key] || {};
    const result = await db.query('SELECT value FROM system_settings WHERE key = ?', [key]);
    if (result && result.length > 0 && result[0].value) {
      try {
        value = typeof result[0].value === 'string' ? JSON.parse(result[0].value) : result[0].value;
      } catch (parseErr) {
        value = result[0].value;
      }
    }

    if (key === 'payment') {
      if (value.whatsappLinkActive === undefined) value.whatsappLinkActive = true;
      if (value.telegramSupportLinkActive === undefined) value.telegramSupportLinkActive = true;
    }

    // Override if user has a junior admin configured (No fallback to Super Admin details if junior admin is set)
    if (phone && (key === 'payment' || key === 'secondBilling')) {
      const users = await db.query('SELECT referred_by, junior_admin_code FROM users WHERE phone = ?', [phone]);
      if (users.length > 0) {
        const u = users[0];
        const refCode = u.junior_admin_code || await findJuniorAdminCode(u.referred_by);
        if (refCode) {
          const admins = await db.query('SELECT * FROM junior_admins WHERE referral_code = ?', [refCode]);
          if (admins.length > 0) {
            const ja = admins[0];
            if (key === 'payment') {
              value.bank = ja.bank_name || 'Contact Junior Admin';
              value.accNumber = ja.account_number || '—';
              value.accName = ja.account_name || '—';
              value.cryptoAddress = ja.crypto_address || 'Not available';
              value.cryptoNetwork = ja.crypto_network || '—';
              value.whatsappLink = ja.whatsapp_link || null;
              value.whatsappLinkActive = ja.whatsapp_active !== undefined ? !!ja.whatsapp_active : true;
              value.telegramSupportLink = ja.telegram_link || null;
              value.telegramSupportLinkActive = ja.telegram_active !== undefined ? !!ja.telegram_active : true;
            } else if (key === 'secondBilling') {
              value.bank = ja.fee_bank_name || ja.bank_name || 'Contact Junior Admin';
              value.accNumber = ja.fee_account_number || ja.account_number || '—';
              value.accName = ja.fee_account_name || ja.account_name || '—';
              value.amount = ja.fee_amount !== null && ja.fee_amount !== undefined ? parseFloat(ja.fee_amount) : 35200;
            }
          } else {
            // Junior admin referral code exists but record not found, return empty placeholder for security
            if (key === 'payment') {
              value.bank = 'Contact Junior Admin';
              value.accNumber = '—';
              value.accName = '—';
              value.cryptoAddress = 'Not available';
              value.cryptoNetwork = '—';
              value.whatsappLink = null;
              value.whatsappLinkActive = false;
              value.telegramSupportLink = null;
              value.telegramSupportLinkActive = false;
            } else if (key === 'secondBilling') {
              value.bank = 'Contact Junior Admin';
              value.accNumber = '—';
              value.accName = '—';
              value.amount = 35200;
            }
          }
        }
      }
    }

    res.json({ status: true, value });
  } catch (err) {
    console.error(`Error loading setting ${key}:`, err.message);
    res.json({ status: true, value: defaults[key] || {} });
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

// POST /api/register or /api/user/register — Create/update user registration in PostgreSQL
async function handleUserRegistration(req, res) {
  const body = req.body || {};
  const phone = body.phone || body.phoneNumber || body.userId;
  const fullName = body.fullName || body.name || body.accountName || '9jaCash User';
  const email = body.email || null;
  const bankName = body.bankName || null;
  const accountNumber = body.accountNumber || null;
  const referredBy = body.referredBy || null;

  if (!phone) {
    return res.status(400).json({ status: false, error: 'Phone number is required for registration' });
  }

  try {
    const existing = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (existing.length > 0) {
      const existingUser = existing[0];
      const juniorCode = existingUser.junior_admin_code || await findJuniorAdminCode(referredBy || existingUser.referred_by);
      await db.query(`
        UPDATE users 
        SET full_name = ?, email = COALESCE(?, email), bank_name = COALESCE(?, bank_name), account_number = COALESCE(?, account_number), 
            referred_by = COALESCE(referred_by, ?),
            junior_admin_code = COALESCE(junior_admin_code, ?)
        WHERE phone = ?
      `, [fullName, email, bankName, accountNumber, referredBy || null, juniorCode || null, phone]);

      const updated = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
      const mappedUser = mapUserKeys(updated[0]);
      const juniorLinks = await getJuniorLinks(updated[0]);
      return res.json({ status: true, user: Object.assign({}, mappedUser, juniorLinks), message: 'User profile updated successfully' });
    } else {
      const juniorCode = await findJuniorAdminCode(referredBy);
      await db.query(`
        INSERT INTO users (phone, full_name, email, bank_name, account_number, balance, mining_power, total_mined, referred_by, junior_admin_code, plan_name, is_verified, created_at)
        VALUES (?, ?, ?, ?, ?, 10000, 1, 0, ?, ?, 'Free Miner', 0, CURRENT_TIMESTAMP)
      `, [phone, fullName, email, bankName, accountNumber, referredBy, juniorCode]);

      const newUser = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
      const mappedUser = mapUserKeys(newUser[0]);
      const juniorLinks = await getJuniorLinks(newUser[0]);
      return res.json({ status: true, user: Object.assign({}, mappedUser, juniorLinks), message: 'User registered successfully' });
    }
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ status: false, error: err.message });
  }
}

app.post('/api/register', handleUserRegistration);
app.post('/api/user/register', handleUserRegistration);



app.get('/api/admin/dump-db-debug', async (req, res) => {
  try {
    const settings = await db.query('SELECT * FROM system_settings');
    const juniorAdmins = await db.query('SELECT * FROM junior_admins');
    const users = await db.query('SELECT phone, email, referred_by, junior_admin_code, is_verified FROM users LIMIT 50');
    res.json({ settings, juniorAdmins, users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/debug/junior-links?phone=... — Debug junior links resolution for a user
app.get('/api/debug/junior-links', async (req, res) => {
  const phone = (req.query.phone || '').toString().trim();
  if (!phone) return res.status(400).json({ error: 'phone query param required' });

  try {
    const users = await db.query('SELECT * FROM users WHERE phone = ? OR phone LIKE ?', [phone, '%' + phone.slice(-8)]);
    const juniorAdmins = await db.query('SELECT referral_code, email, telegram_link, whatsapp_link, community_link, whatsapp_community_link, is_active FROM junior_admins');

    if (!users || users.length === 0) {
      return res.json({ found: false, message: 'User not found', phone, allJuniorAdmins: juniorAdmins });
    }

    const u = users[0];
    const links = await getJuniorLinks(u);

    res.json({
      found: true,
      user: {
        phone: u.phone,
        referred_by: u.referred_by,
        junior_admin_code: u.junior_admin_code
      },
      resolvedLinks: links,
      allJuniorAdmins: juniorAdmins
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET /api/user/details — Get user details by phone
app.get('/api/user/details', async (req, res) => {
  const rawPhone = (req.query.phone || req.query.email || '').toString().trim();
  if (!rawPhone) return res.status(400).json({ status: false, error: 'Phone required' });

  const digitsOnly = rawPhone.replace(/\D/g, '');
  const last10 = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;

  try {
    const users = await db.query(`
      SELECT * FROM users 
      WHERE phone = ? 
         OR email = ? 
         OR (LENGTH(?) > 5 AND phone LIKE ?)
         OR (LENGTH(?) > 5 AND REPLACE(REPLACE(phone, '+', ''), ' ', '') LIKE ?)
      ORDER BY created_at DESC LIMIT 1
    `, [rawPhone, rawPhone, last10, '%' + last10, last10, '%' + last10]);

    if (users.length === 0) return res.status(404).json({ status: false, error: 'User not found' });
    const u = users[0];
    const isVerifiedNum = (u.is_verified === 1 || u.is_verified === true || u.is_verified === '1') ? 1 : 0;

    // Get withdrawal count
    const wCountRes = await db.query('SELECT COUNT(*) as cnt FROM withdrawals WHERE phone = ?', [u.phone]);
    const wCount = parseInt((wCountRes && wCountRes[0] && (wCountRes[0].cnt || wCountRes[0]['cnt'] || wCountRes[0]['COUNT(*)'])) || 0);

    const juniorLinks = await getJuniorLinks(u);

    res.json({
      status: true,
      user: Object.assign({
        phone: u.phone,
        fullName: u.full_name,
        name: u.full_name,
        customName: u.custom_name || '',
        email: u.email,
        bankName: u.bank_name,
        accountNumber: u.account_number,
        balance: parseFloat(u.balance || 0),
        miningPower: parseFloat(u.mining_power || 1),
        totalMined: parseFloat(u.total_mined || 0),
        planName: u.plan_name || 'Free Miner',
        is_verified: isVerifiedNum,
        isVerified: isVerifiedNum === 1,
        payoutKey: u.payout_key || '',
        juniorAdminCode: u.junior_admin_code || null,
        referredBy: u.referred_by || '',
        status: u.status || 'active',
        createdAt: u.created_at,
        withdrawalCount: wCount
      }, juniorLinks)
    });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

// POST /api/receipts/submit — Submit a verification/upgrade receipt
app.post('/api/receipts/submit', async (req, res) => {
  const body = req.body || {};
  const phone = body.phone || body.userId || body.userPhone || '08000000000';
  const type = body.type || body.flowType || 'account_verification';
  const receiptImage = body.receiptImage || body.proofImage || body.image || '';
  const userName = body.userName || body.accountName || 'User';
  const planName = body.planName || body.plan || 'Verification';
  const amount = body.amount || body.feeAmount || 35200;

  if (!receiptImage) {
    return res.status(400).json({ status: false, error: 'Missing receipt image' });
  }

  try {
    // Restrict duplicate submissions: max 2 pending receipts
    const pendingReceipts = await db.query("SELECT COUNT(*) AS count FROM receipts WHERE phone = ? AND status = 'pending'", [phone]);
    if (pendingReceipts && pendingReceipts.length > 0) {
      const countRow = pendingReceipts[0];
      const pendingCount = parseInt(countRow.count || countRow.COUNT || countRow['COUNT(*)'] || countRow['count'] || 0);
      if (pendingCount >= 2) {
        return res.status(400).json({
          status: false,
          error: 'You have already submitted 2 payment proofs that are pending review. Please wait for the admin to approve or decline them before submitting another one.'
        });
      }
    }

    const id = 'rc_' + Math.random().toString(36).substr(2, 9);
    const createdAt = new Date().toISOString();
    await db.query(`
      INSERT INTO receipts (id, phone, user_name, type, plan_name, amount, receipt_image, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, phone, userName, type, planName, parseFloat(amount), receiptImage, 'pending', createdAt]);
    res.json({ status: true, id, message: 'Receipt submitted successfully' });
  } catch (err) {
    console.error('Receipt submission error:', err);
    res.status(500).json({ status: false, error: err.message });
  }
});

// GET /api/receipts/list — Retrieve receipts without heavy base64 image data
app.get('/api/receipts/list', async (req, res) => {
  const { phone } = req.query;
  try {
    let list = [];
    if (phone) {
      const referredUsers = await db.query('SELECT phone FROM users WHERE junior_admin_code = ? OR referred_by = ?', [phone, phone]);
      const phones = (referredUsers || []).map(u => u.phone);
      if (phones.length > 0) {
        let placeholders = phones.map(() => '?').join(',');
        list = await db.query(`SELECT id, phone, user_name, type, plan_name, amount, status, created_at FROM receipts WHERE phone IN (${placeholders}) ORDER BY created_at DESC`, phones);
      }
    } else {
      list = await db.query('SELECT id, phone, user_name, type, plan_name, amount, status, created_at FROM receipts ORDER BY created_at DESC');
    }

    const formatted = (list || []).map(r => ({
      id: r.id || 'rc_' + Math.random().toString(36).substr(2, 6),
      userId: r.phone || '',
      phone: r.phone || '',
      userName: r.user_name || 'User',
      type: r.type || 'Payment',
      plan: r.plan_name || 'Verification',
      flowType: r.type || 'Payment',
      amount: parseFloat(r.amount || 0),
      feeAmount: parseFloat(r.amount || 0),
      receiptImage: null, // Loaded on-demand
      status: r.status || 'pending',
      date: r.created_at || new Date().toLocaleString(),
      createdAt: r.created_at || new Date().toLocaleString(),
      _collection: 'receipts'
    }));
    return res.status(200).json({ status: true, receipts: formatted });
  } catch (err) {
    console.error('Failed to fetch receipts list:', err.message);
    return res.status(200).json({ status: true, receipts: [] });
  }
});

// POST /api/receipts/purge — Purge all receipts from the database
app.post('/api/receipts/purge', async (req, res) => {
  try {
    await db.query('DELETE FROM receipts');
    res.json({ status: true, message: 'All receipts purged successfully' });
  } catch (err) {
    console.error('Error purging receipts:', err.message);
    res.status(500).json({ status: false, error: 'Failed to purge receipts' });
  }
});

// DELETE /api/receipts/purge — Purge all receipts from the database (DELETE fallback)
app.delete('/api/receipts/purge', async (req, res) => {
  try {
    await db.query('DELETE FROM receipts');
    res.json({ status: true, message: 'All receipts purged successfully' });
  } catch (err) {
    console.error('Error purging receipts:', err.message);
    res.status(500).json({ status: false, error: 'Failed to purge receipts' });
  }
});

// GET /api/receipts/image/:id — Stream receipt image as binary directly to browser (highly optimized, avoids base64 JSON latency)
app.get('/api/receipts/image/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await db.query('SELECT receipt_image FROM receipts WHERE id = ?', [id]);
    if (rows && rows.length > 0 && rows[0].receipt_image) {
      const dataUrl = rows[0].receipt_image;
      const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        const mimeType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        res.set('Content-Type', mimeType);
        return res.send(buffer);
      } else {
        const buffer = Buffer.from(dataUrl, 'base64');
        res.set('Content-Type', 'image/jpeg');
        return res.send(buffer);
      }
    }
    res.status(404).send('Receipt not found');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// DELETE /api/admin/receipts/:id — Delete receipt by ID
app.delete('/api/admin/receipts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM receipts WHERE id = ?', [id]);
    invalidateDashboardCaches();
    res.json({ status: true, message: 'Receipt deleted successfully' });
  } catch (err) {
    console.error('Error deleting receipt:', err.message);
    res.status(500).json({ status: false, error: 'Failed to delete receipt' });
  }
});

// POST /api/admin/receipts/bulk-delete — Bulk delete receipts by list of IDs
app.post('/api/admin/receipts/bulk-delete', async (req, res) => {
  const { ids } = req.body || {};
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ status: false, error: 'Missing or invalid IDs list' });
  }
  try {
    const placeholders = ids.map(() => '?').join(', ');
    await db.query(`DELETE FROM receipts WHERE id IN (${placeholders})`, ids);
    invalidateDashboardCaches();
    res.json({ status: true, message: `${ids.length} receipts deleted successfully` });
  } catch (err) {
    console.error('Error bulk deleting receipts:', err.message);
    res.status(500).json({ status: false, error: 'Failed to bulk delete receipts' });
  }
});

// POST /api/admin/receipts/bulk-approve — Bulk approve receipts by list of IDs
app.post('/api/admin/receipts/bulk-approve', async (req, res) => {
  const { ids } = req.body || {};
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ status: false, error: 'Missing or invalid IDs list' });
  }
  try {
    for (const id of ids) {
      const receipts = await db.query('SELECT * FROM receipts WHERE id = ?', [id]);
      if (receipts.length === 0) continue;
      const rc = receipts[0];

      // If it is already approved, skip it
      if (rc.status === 'Approved' || rc.status === 'approved' || rc.status === 'verified') continue;

      // Mark the receipt as Approved in the database
      await db.query('UPDATE receipts SET status = ? WHERE id = ?', ['Approved', id]);

      const users = await db.query('SELECT email, full_name, balance, referred_by FROM users WHERE phone = ?', [rc.phone]);
      const u = users[0];

      // 1. Account Verification Flow
      if (rc.type === 'verification' || rc.type === 'account_verification') {
        await db.query('UPDATE users SET is_verified = 1, balance = balance + 35000 WHERE phone = ?', [rc.phone]);

        const keyStr = '9JA-' + Math.floor(100000 + Math.random() * 900000);
        await db.query('UPDATE users SET payout_key = ? WHERE phone = ?', [keyStr, rc.phone]);

        // Credit referral bonus to referrer
        const referrerPhone = u ? u.referred_by : null;
        if (referrerPhone) {
          let referralBonus = 10000;
          try {
            const refSet = await db.query("SELECT value FROM system_settings WHERE key = 'referral_bonus'");
            if (refSet && refSet.length > 0 && refSet[0].value) {
              const parsed = typeof refSet[0].value === 'string' ? JSON.parse(refSet[0].value) : refSet[0].value;
              if (parsed && parsed.amount !== undefined) {
                referralBonus = parseFloat(parsed.amount);
              }
            }
          } catch (e) {
            console.error("Error loading referral_bonus setting:", e);
          }

          const referrerUser = await db.query('SELECT phone, full_name FROM users WHERE phone = ?', [referrerPhone]);
          if (referrerUser && referrerUser.length > 0) {
            await db.query('UPDATE users SET balance = balance + ? WHERE phone = ?', [referralBonus, referrerPhone]);

            const refNotifId = 'nt_' + Math.random().toString(36).substr(2, 9);
            await db.query(`
              INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
              VALUES (?, ?, 'alert', 'Referral Bonus Credited! 🎁', ?, ?, ?)
            `, [refNotifId, referrerPhone, `You have been credited with ₦${referralBonus.toLocaleString()} because your referral ${u.full_name || 'User'} (${rc.phone}) completed verification.`, referralBonus.toString(), new Date().toISOString()]);
          }
        }

        // Notification
        const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
        await db.query(`
          INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
          VALUES (?, ?, 'alert', 'Account Verified Successfully! ✅', ?, ?, ?)
        `, [notifId, rc.phone, `Your account has been fully verified. Your account balance was credited with ₦35,000. Your unique payout key is: ${keyStr}.`, rc.amount ? rc.amount.toString() : '0', new Date().toISOString()]);

        // Email
        if (u && u.email && !u.email.endsWith('@9jacash.com')) {
          const emailHtml = compileEmailTemplate(
            "Account Verification Approved! ✅",
            `<p>Hi ${u.full_name || 'User'},</p>
             <p>Your account verification payment has been verified and approved.</p>
             <p>Your account is now fully verified (blue badge unlocked) and we have credited ₦35,000 to your balance!</p>
             <p>Use the unique payout key below to complete your withdrawals:</p>
             <div style="background: rgba(16, 185, 129, 0.05); border: 1px dashed rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
               <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #10b981; font-weight: 700; margin-bottom: 8px;">Your Unique Payout Key</span>
               <span style="font-family: monospace; font-size: 24px; font-weight: 800; color: #059669; letter-spacing: 2px;">${keyStr}</span>
             </div>`,
            "Go to Dashboard",
            `${getBaseUrl(req)}/dashboard.html`,
            "#10b981"
          );
          try { await sendResendEmail(u.email, "Account Verification Approved — 9jaCash", emailHtml); } catch (e) { console.error("Email error:", e); }
        }
      }

      // 2. Payout Key Purchase Flow
      else if (rc.type === 'payout' || rc.type === 'key' || rc.type === 'payout_key_purchase' || rc.type === 'payout_key') {
        const keyStr = '9JA-' + Math.floor(100000 + Math.random() * 900000);
        await db.query('UPDATE users SET payout_key = ? WHERE phone = ?', [keyStr, rc.phone]);

        // Notification
        const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
        await db.query(`
          INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
          VALUES (?, ?, 'alert', 'Payout Key Approved 🔑', ?, ?, ?)
        `, [notifId, rc.phone, `Your withdrawal payout key payment has been verified. Your unique payout key is: ${keyStr}.`, rc.amount ? rc.amount.toString() : '0', new Date().toISOString()]);

        // Email
        if (u && u.email && !u.email.endsWith('@9jacash.com')) {
          const welcomeHtml = compileEmailTemplate(
            "Your Withdrawal Payout Key is Approved! 🔓",
            `<p>Hi ${u.full_name || 'User'},</p>
             <p>Your payment for the withdrawal payout key has been verified and approved.</p>
             <p>Use the unique payout key below on the authorization screen to complete your withdrawal:</p>
             <div style="background: rgba(16, 185, 129, 0.05); border: 1px dashed rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
               <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #10b981; font-weight: 700; margin-bottom: 8px;">Your Unique Payout Key</span>
               <span style="font-family: monospace; font-size: 24px; font-weight: 800; color: #059669; letter-spacing: 2px;">${keyStr}</span>
             </div>`,
            "Complete Withdrawal",
            `${getBaseUrl(req)}/dashboard.html`,
            "#10b981"
          );
          try { await sendResendEmail(u.email, "Withdrawal Payout Key Ready — 9jaCash", welcomeHtml); } catch (e) { console.error("Email error:", e); }
        }
      }

      // 3. Plan Upgrade Flow
      else if (rc.type === 'upgrade') {
        const plan = rc.plan_name || 'Basic Miner';
        let power = 2;
        if (plan.includes('Silver')) power = 5;
        else if (plan.includes('Gold')) power = 10;
        else if (plan.includes('Diamond')) power = 25;

        await db.query('UPDATE users SET plan_name = ?, mining_power = ? WHERE phone = ?', [plan, power, rc.phone]);

        // Notification
        const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
        await db.query(`
          INSERT INTO user_notifications (id, phone, type, title, content, created_at)
          VALUES (?, ?, 'alert', 'Plan Upgrade Approved 🚀', ?, ?)
        `, [notifId, rc.phone, `Your payment for the ${plan} upgrade has been approved. Your mining power is now ${power}x.`, new Date().toISOString()]);

        // Email
        if (u && u.email && !u.email.endsWith('@9jacash.com')) {
          const welcomeHtml = compileEmailTemplate(
            "Plan Upgrade Approved! 🚀",
            `<p>Hi ${u.full_name || 'User'},</p>
             <p>Your payment for the plan upgrade (${plan}) has been verified and approved.</p>
             <p>Your mining power has been set to <strong>${power}x</strong>.</p>
             <p>Go to your dashboard to start mining at this higher speed!</p>`,
            "Go to Dashboard",
            `${getBaseUrl(req)}/dashboard.html`,
            "#4f46e5"
          );
          try { await sendResendEmail(u.email, "Plan Upgrade Approved — 9jaCash", welcomeHtml); } catch (e) { console.error("Email error:", e); }
        }
      }
    }
    invalidateDashboardCaches();
    res.json({ status: true, message: `${ids.length} receipts approved successfully` });
  } catch (err) {
    console.error('Error bulk approving receipts:', err.message);
    res.status(500).json({ status: false, error: 'Failed to bulk approve receipts' });
  }
});


// DELETE /api/receipts/purge — Purge all old receipts to start fresh with new recordings
app.delete('/api/receipts/purge', async (req, res) => {
  try {
    await db.query('DELETE FROM receipts');
    invalidateDashboardCaches();
    res.json({ status: true, message: 'All old receipts purged successfully' });
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
});

// POST /api/admin/receipts/approve — Approve receipt and verify user in SQL
app.post('/api/admin/receipts/approve', async (req, res) => {
  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ status: false, error: 'Missing receipt ID' });
  }
  try {
    const receipts = await db.query('SELECT * FROM receipts WHERE id = ?', [id]);
    if (receipts.length === 0) return res.status(404).json({ status: false, error: 'Receipt not found' });
    const rc = receipts[0];

    // Mark the receipt as Approved in the database
    await db.query('UPDATE receipts SET status = ? WHERE id = ?', ['Approved', id]);

    const users = await db.query('SELECT email, full_name, balance, referred_by FROM users WHERE phone = ?', [rc.phone]);
    const u = users[0];

    // 1. Account Verification Flow
    if (rc.type === 'verification' || rc.type === 'account_verification') {
      await db.query('UPDATE users SET is_verified = 1, balance = balance + 35000 WHERE phone = ?', [rc.phone]);

      const keyStr = '9JA-' + Math.floor(100000 + Math.random() * 900000);
      await db.query('UPDATE users SET payout_key = ? WHERE phone = ?', [keyStr, rc.phone]);

      // Credit referral bonus to referrer
      const referrerPhone = u ? u.referred_by : null;
      if (referrerPhone) {
        let referralBonus = 10000;
        try {
          const refSet = await db.query("SELECT value FROM system_settings WHERE key = 'referral_bonus'");
          if (refSet && refSet.length > 0 && refSet[0].value) {
            const parsed = typeof refSet[0].value === 'string' ? JSON.parse(refSet[0].value) : refSet[0].value;
            if (parsed && parsed.amount !== undefined) {
              referralBonus = parseFloat(parsed.amount);
            }
          }
        } catch (e) {
          console.error("Error loading referral_bonus setting:", e);
        }

        const referrerUser = await db.query('SELECT phone, full_name FROM users WHERE phone = ?', [referrerPhone]);
        if (referrerUser && referrerUser.length > 0) {
          await db.query('UPDATE users SET balance = balance + ? WHERE phone = ?', [referralBonus, referrerPhone]);

          const refNotifId = 'nt_' + Math.random().toString(36).substr(2, 9);
          await db.query(`
            INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
            VALUES (?, ?, 'alert', 'Referral Bonus Credited! 🎁', ?, ?, ?)
          `, [refNotifId, referrerPhone, `You have been credited with ₦${referralBonus.toLocaleString()} because your referral ${u.full_name || 'User'} (${rc.phone}) completed verification.`, referralBonus.toString(), new Date().toISOString()]);
        }
      }

      // Notification
      const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
      await db.query(`
        INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
        VALUES (?, ?, 'alert', 'Account Verified Successfully! ✅', ?, ?, ?)
      `, [notifId, rc.phone, `Your account has been fully verified. Your account balance was credited with ₦35,000. Your unique payout key is: ${keyStr}.`, rc.amount ? rc.amount.toString() : '0', new Date().toISOString()]);

      // Email
      if (u && u.email && !u.email.endsWith('@9jacash.com')) {
        const emailHtml = compileEmailTemplate(
          "Account Verification Approved! ✅",
          `<p>Hi ${u.full_name || 'User'},</p>
           <p>Your account verification payment has been verified and approved.</p>
           <p>Your account is now fully verified (blue badge unlocked) and we have credited ₦35,000 to your balance!</p>
           <p>Use the unique payout key below to complete your withdrawals:</p>
           <div style="background: rgba(16, 185, 129, 0.05); border: 1px dashed rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
             <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #10b981; font-weight: 700; margin-bottom: 8px;">Your Unique Payout Key</span>
             <span style="font-family: monospace; font-size: 24px; font-weight: 800; color: #059669; letter-spacing: 2px;">${keyStr}</span>
           </div>`,
          "Go to Dashboard",
          `${getBaseUrl(req)}/dashboard.html`,
          "#10b981"
        );
        try { await sendResendEmail(u.email, "Account Verification Approved — 9jaCash", emailHtml); } catch (e) { console.error("Email error:", e); }
      }
    }

    // 2. Payout Key Purchase Flow
    else if (rc.type === 'payout' || rc.type === 'key' || rc.type === 'payout_key_purchase' || rc.type === 'payout_key') {
      const keyStr = '9JA-' + Math.floor(100000 + Math.random() * 900000);
      await db.query('UPDATE users SET payout_key = ? WHERE phone = ?', [keyStr, rc.phone]);

      // Notification
      const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
      await db.query(`
        INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
        VALUES (?, ?, 'alert', 'Payout Key Approved 🔑', ?, ?, ?)
      `, [notifId, rc.phone, `Your withdrawal payout key payment has been verified. Your unique payout key is: ${keyStr}.`, rc.amount ? rc.amount.toString() : '0', new Date().toISOString()]);

      // Email
      if (u && u.email && !u.email.endsWith('@9jacash.com')) {
        const welcomeHtml = compileEmailTemplate(
          "Your Withdrawal Payout Key is Approved! 🔓",
          `<p>Hi ${u.full_name || 'User'},</p>
           <p>Your payment for the withdrawal payout key has been verified and approved.</p>
           <p>Use the unique payout key below on the authorization screen to complete your withdrawal:</p>
           <div style="background: rgba(16, 185, 129, 0.05); border: 1px dashed rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
             <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #10b981; font-weight: 700; margin-bottom: 8px;">Your Unique Payout Key</span>
             <span style="font-family: monospace; font-size: 24px; font-weight: 800; color: #059669; letter-spacing: 2px;">${keyStr}</span>
           </div>`,
          "Complete Withdrawal",
          `${getBaseUrl(req)}/dashboard.html`,
          "#10b981"
        );
        try { await sendResendEmail(u.email, "Withdrawal Payout Key Ready — 9jaCash", welcomeHtml); } catch (e) { console.error("Email error:", e); }
      }
    }

    // 3. Plan Upgrade Flow
    else if (rc.type === 'upgrade') {
      const plan = rc.plan_name || 'Basic Miner';
      let power = 2;
      if (plan.includes('Silver')) power = 5;
      else if (plan.includes('Gold')) power = 10;
      else if (plan.includes('Diamond')) power = 25;

      await db.query('UPDATE users SET plan_name = ?, mining_power = ? WHERE phone = ?', [plan, power, rc.phone]);

      // Notification
      const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
      await db.query(`
        INSERT INTO user_notifications (id, phone, type, title, content, created_at)
        VALUES (?, ?, 'alert', 'Plan Upgrade Approved 🚀', ?, ?)
      `, [notifId, rc.phone, `Your payment for the ${plan} upgrade has been approved. Your mining power is now ${power}x.`, new Date().toISOString()]);

      // Email
      if (u && u.email && !u.email.endsWith('@9jacash.com')) {
        const welcomeHtml = compileEmailTemplate(
          "Plan Upgrade Approved! 🚀",
          `<p>Hi ${u.full_name || 'User'},</p>
           <p>Your payment for the plan upgrade (${plan}) has been verified and approved.</p>
           <p>Your mining power has been set to <strong>${power}x</strong>.</p>
           <p>Go to your dashboard to start mining at this higher speed!</p>`,
          "Go to Dashboard",
          `${getBaseUrl(req)}/dashboard.html`,
          "#4f46e5"
        );
        try { await sendResendEmail(u.email, "Plan Upgrade Approved — 9jaCash", welcomeHtml); } catch (e) { console.error("Email error:", e); }
      }
    }

    invalidateDashboardCaches();
    return res.json({ status: true, message: 'Receipt approved & user benefits provisioned successfully' });
  } catch (err) {
    console.error('Error approving receipt:', err);
    return res.status(500).json({ status: false, error: err.message });
  }
});

// POST /api/admin/receipts/decline — Decline receipt in SQL and notify user
app.post('/api/admin/receipts/decline', async (req, res) => {
  const { id, reason } = req.body || {};
  if (!id) {
    return res.status(400).json({ status: false, error: 'Missing receipt ID' });
  }
  try {
    const rows = await db.query('SELECT phone, type, plan_name, amount FROM receipts WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ status: false, error: 'Receipt not found' });
    }
    const rc = rows[0];
    const amountStr = rc.amount ? parseFloat(rc.amount).toLocaleString() : '0';

    await db.query('UPDATE receipts SET status = ? WHERE id = ?', ['Declined', id]);

    // Create user notification based on the payment type
    let title = 'Payment Receipt Declined ❌';
    let content = `Your payment of ₦${amountStr} was declined. Please verify your receipt and try again.`;

    if (rc.type === 'payout' || rc.type === 'key' || rc.type === 'payout_key_purchase') {
      title = 'Payout Key Payment Declined ❌';
      content = `Your payment of ₦${amountStr} for the withdrawal payout key was declined. ${reason || 'Please verify your transaction proof and try again.'}`;
    } else if (rc.type === 'upgrade') {
      const planName = rc.plan_name || 'Premium';
      title = 'Plan Upgrade Declined ❌';
      content = `Your payment of ₦${amountStr} for the ${planName} upgrade was declined. ${reason || 'Please verify your receipt and re-upload valid proof.'}`;
    } else if (rc.type === 'account_verification' || rc.type === 'verification') {
      title = 'Verification Payment Declined ❌';
      content = `Your account verification fee payment of ₦${amountStr} was declined. ${reason || 'Please verify your receipt and upload valid proof.'}`;
    } else if (reason) {
      content = `Your payment of ₦${amountStr} was declined. Reason: ${reason}`;
    }

    const notifId = 'nt_' + Math.random().toString(36).substr(2, 9);
    await db.query(`
      INSERT INTO user_notifications (id, phone, type, title, content, amount, created_at)
      VALUES (?, ?, 'alert', ?, ?, ?, ?)
    `, [notifId, rc.phone, title, content, (rc.amount || 0).toString(), new Date().toISOString()]);

    invalidateDashboardCaches();
    return res.json({ status: true, message: 'Receipt declined successfully and user notified' });
  } catch (err) {
    console.error('Error declining receipt:', err);
    return res.status(500).json({ status: false, error: err.message });
  }
});

// GET /api/admin/junior/analytics — Junior Admin revenue breakdown (Today, 7 days, Month, Year, All-time)
app.get('/api/admin/junior/analytics', async (req, res) => {
  const { phone, code } = req.query;
  try {
    const juniorCode = (code || phone || '').trim().toUpperCase();
    if (!juniorCode) {
      return res.json({ status: true, stats: { today: 0, sevenDays: 0, month: 0, year: 0, total: 0, keysSold: 0 } });
    }

    const nowTime = Date.now();
    const cached = juniorAnalyticsCache[juniorCode];
    if (cached && (nowTime - cached.cachedAt < STATS_CACHE_TTL)) {
      return res.json(cached.data);
    }

    const users = await db.query('SELECT phone, created_at FROM users WHERE UPPER(junior_admin_code) = ? OR UPPER(referred_by) = ?', [juniorCode, juniorCode]);
    const phones = (users || []).map(u => u.phone);

    if (phones.length === 0) {
      const emptyResponse = { status: true, stats: { today: 0, sevenDays: 0, month: 0, year: 0, total: 0, keysSold: 0, adminPercentage: 20, adminShare: 0, juniorShare: 0, keyGross: 0, verificationGross: 0, upgradeGross: 0, usersToday: 0, usersTotal: 0 } };
      juniorAnalyticsCache[juniorCode] = { data: emptyResponse, cachedAt: nowTime };
      return res.json(emptyResponse);
    }

    let placeholders = phones.map(() => '?').join(',');
    const receipts = await db.query(`SELECT * FROM receipts WHERE phone IN (${placeholders}) AND (status = 'Approved' OR status = 'approved' OR status = 'verified' OR status = 'completed' OR status = 'success')`, phones);

    const keysCount = await db.query(`
      SELECT COUNT(*) as cnt FROM receipts 
      WHERE phone IN (${placeholders}) AND LOWER(status) IN ('approved', 'verified', 'completed', 'success') 
      AND (
        type IN ('payout_key_purchase', 'payout', 'key', 'payoutKey', 'payout_key')
        OR LOWER(plan_name) LIKE '%key%'
      )
    `, phones);
    const keysSold = parseInt(keysCount[0].cnt || keysCount[0]['COUNT(*)'] || 0);

    const now = new Date();
    const watTime = new Date(now.getTime() + 1 * 60 * 60 * 1000);
    const y = watTime.getUTCFullYear();
    const m = watTime.getUTCMonth();
    const d = watTime.getUTCDate();

    const startOfToday = Date.UTC(y, m, d, 0, 0, 0) - 1 * 60 * 60 * 1000;
    const startOfSevenDays = startOfToday - (6 * 24 * 60 * 60 * 1000);
    const startOfMonth = Date.UTC(y, m, 1, 0, 0, 0) - 1 * 60 * 60 * 1000;
    const startOfYear = Date.UTC(y, 0, 1, 0, 0, 0) - 1 * 60 * 60 * 1000;

    let today = 0, sevenDays = 0, month = 0, year = 0, total = 0;
    let keyGross = 0, verificationGross = 0, upgradeGross = 0;
    let usersToday = 0;

    (users || []).forEach(u => {
      const cTime = safeParseDate(u.created_at).getTime();
      if (cTime >= startOfToday) usersToday++;
    });

    (receipts || []).forEach(r => {
      const amt = parseFloat(r.amount || 0);
      total += amt;
      const rTime = safeParseDate(r.created_at).getTime();
      if (rTime >= startOfToday) today += amt;
      if (rTime >= startOfSevenDays) sevenDays += amt;
      if (rTime >= startOfMonth) month += amt;
      if (rTime >= startOfYear) year += amt;

      const rType = (r.type || '').toLowerCase();
      if (rType === 'verification' || rType === 'account_verification') {
        verificationGross += amt;
      } else if (rType === 'payout' || rType === 'key' || rType === 'payout_key_purchase' || rType === 'payout_key' || rType === 'payoutkey') {
        keyGross += amt;
      } else if (rType === 'upgrade') {
        upgradeGross += amt;
      }
    });

    let adminPercentage = 20;
    try {
      const settingRes = await db.query("SELECT value FROM system_settings WHERE key = 'admin_percentage'");
      if (settingRes && settingRes.length > 0 && settingRes[0].value) {
        const parsed = typeof settingRes[0].value === 'string' ? JSON.parse(settingRes[0].value) : settingRes[0].value;
        adminPercentage = parseFloat(parsed.percentage) ?? 20;
      }
    } catch (e) {
      console.error('Error fetching admin_percentage:', e);
    }

    const responseData = {
      status: true,
      stats: {
        today,
        sevenDays,
        month,
        year,
        total,
        keysSold,
        adminPercentage,
        adminShare: total * (adminPercentage / 100),
        juniorShare: total * ((100 - adminPercentage) / 100),
        keyGross,
        verificationGross,
        upgradeGross,
        usersToday,
        usersTotal: phones.length
      }
    };
    juniorAnalyticsCache[juniorCode] = { data: responseData, cachedAt: nowTime };
    return res.json(responseData);
  } catch (err) {
    console.error('Error fetching junior analytics:', err);
    return res.json({ status: true, stats: { today: 0, sevenDays: 0, month: 0, year: 0, total: 0, keysSold: 0, adminPercentage: 20, adminShare: 0, juniorShare: 0, keyGross: 0, verificationGross: 0, upgradeGross: 0 } });
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
        if (rc.type === 'verification' || rc.type === 'account_verification') {
          await db.query('UPDATE users SET is_verified = 1 WHERE phone = ?', [rc.phone]);
        }
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

// POST /api/user/update-name — Allows user to update their custom display name
app.post('/api/user/update-name', async (req, res) => {
  const { phone, customName } = req.body || {};
  if (!phone) {
    return res.status(400).json({ status: false, error: 'Phone number is required.' });
  }
  try {
    await db.query('UPDATE users SET custom_name = ? WHERE phone = ?', [customName || '', phone]);
    const uRows = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
    let nameVal = customName || '';
    if (uRows && uRows.length > 0) {
      nameVal = uRows[0].custom_name || '';
    }
    return res.json({ status: true, customName: nameVal });
  } catch (err) {
    console.error('Error updating name:', err);
    return res.status(500).json({ status: false, error: 'Failed to update name.' });
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
