const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const path = require('path');
const fs = require('fs');

chromium.use(StealthPlugin());

const EMAIL          = process.env.NAUKRI_EMAIL;
const PASSWORD       = process.env.NAUKRI_PASSWORD;
const GMAIL_APP_PASS = process.env.GMAIL_APP_PASSWORD;
const RESUME_PATH    = path.resolve(__dirname, '../resume/resume.pdf');
const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots');

function log(msg) {
  console.log('[' + new Date().toISOString() + '] ' + msg);
}

function ensureDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function saveScreenshot(page, name) {
  ensureDir();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, name + '.png'), fullPage: true });
  log('Screenshot: ' + name);
}

// ── Strip HTML tags to plain text ───────────────────────────────────────────
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Decode base64url MIME part ──────────────────────────────────────────────
function decodeBase64(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

// ── Extract all text from raw email source ──────────────────────────────────
function extractTextFromRawEmail(rawSource) {
  const parts = [];

  const base64Pattern = /Content-Transfer-Encoding:\s*base64[\r\n]+([A-Za-z0-9+/=\r\n_-]+)/gi;
  let match;
  while ((match = base64Pattern.exec(rawSource)) !== null) {
    try {
      const decoded = decodeBase64(match[1].replace(/\s+/g, ''));
      parts.push(decoded);
    } catch (e) {}
  }

  const qpPattern = /Content-Transfer-Encoding:\s*quoted-printable[\r\n]+([\s\S]*?)(?=--|\r\n--)/gi;
  while ((match = qpPattern.exec(rawSource)) !== null) {
    parts.push(match[1].replace(/=\r\n/g, '').replace(/=[0-9A-Fa-f]{2}/g, ''));
  }

  return parts.join('\n');
}

// ── Extract 6-digit OTP ─────────────────────────────────────────────────────
function extractOTP(allText) {
  log('Extracted text length: ' + allText.length);
  log('Text sample: ' + allText.substring(0, 500).replace(/\n/g, '|'));

  // Strategy 1: "below OTP" then digits nearby
  const s1 = allText.match(/below\s+OTP[^0-9]{0,100}([0-9]{6})/i);
  if (s1) { log('OTP via strategy 1: ' + s1[1]); return s1[1]; }

  // Strategy 2: standalone 6-digit on its own line
  const s2 = allText.match(/^\s*([0-9]{6})\s*$/m);
  if (s2) { log('OTP via strategy 2: ' + s2[1]); return s2[1]; }

  // Strategy 3: after "password." or "account."
  const s3 = allText.match(/(?:password|account)\.\s*([0-9]{6})/i);
  if (s3) { log('OTP via strategy 3: ' + s3[1]); return s3[1]; }

  // Strategy 4: 6-digit surrounded by spaces/newlines
  const s4 = allText.match(/[\s\n]([0-9]{6})[\s\n]/);
  if (s4) { log('OTP via strategy 4: ' + s4[1]); return s4[1]; }

  // Strategy 5: last 6-digit number anywhere
  const all6 = allText.match(/[0-9]{6}/g);
  if (all6 && all6.length > 0) {
    const otp = all6[all6.length - 1];
    log('OTP via strategy 5 (last): ' + otp);
    return otp;
  }

  return null;
}

// ── Fetch OTP from Gmail via IMAP ───────────────────────────────────────────
// Resolves to the plain OTP string. Deletion is handled separately by
// searching INBOX for the OTP subject after the run completes.
async function getOTPFromGmail(maxWaitMs) {
  log('Polling Gmail for OTP...');

  const TARGET_SUBJECT = 'Your OTP for logging in Naukri account';
  const deadline = Date.now() + maxWaitMs;
  const searchSince = new Date(Date.now() - 5 * 60 * 1000); // last 5 minutes only

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 6000));

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: EMAIL, pass: GMAIL_APP_PASS },
      logger: false,
    });

    try {
      await client.connect();
      await client.mailboxOpen('INBOX');

      const messages = await client.search({ since: searchSince });
      log('Emails in last 5 mins: ' + messages.length);

      if (!messages.length) { await client.logout(); continue; }

      // Newest first
      messages.sort((a, b) => b - a);

      for (const uid of messages) {
        const envelope = await client.fetchOne(uid, { envelope: true });
        const subject = (envelope.envelope && envelope.envelope.subject)
          ? envelope.envelope.subject.trim() : '';

        log('Subject: "' + subject + '"');
        if (subject !== TARGET_SUBJECT) continue;

        log('Matched! Fetching full message...');
        const full = await client.fetchOne(uid, { source: true });
        const rawSource = full.source.toString('utf-8');

        ensureDir();
        fs.writeFileSync(path.join(SCREENSHOT_DIR, 'raw-email.txt'), rawSource);
        log('Raw email saved (' + rawSource.length + ' chars)');

        const parsed = await simpleParser(full.source);
        const parsedText = parsed.text || '';
        const parsedHtml = parsed.html || '';

        log('mailparser text length: ' + parsedText.length);
        log('mailparser html length: ' + parsedHtml.length);

        // Layer 1: mailparser plain text
        if (parsedText.length > 0) {
          const otp = extractOTP(parsedText);
          if (otp) { await client.logout(); return otp; }
        }

        // Layer 2: strip HTML tags from mailparser html
        if (parsedHtml.length > 0) {
          const stripped = stripHtml(parsedHtml);
          fs.writeFileSync(path.join(SCREENSHOT_DIR, 'email-stripped.txt'), stripped);
          const otp = extractOTP(stripped);
          if (otp) { await client.logout(); return otp; }
        }

        // Layer 3: decode raw MIME source directly
        const rawText = extractTextFromRawEmail(rawSource);
        fs.writeFileSync(path.join(SCREENSHOT_DIR, 'email-raw-extracted.txt'), rawText);
        const strippedRaw = stripHtml(rawText);
        const otp = extractOTP(strippedRaw.length > 10 ? strippedRaw : rawText);
        if (otp) { await client.logout(); return otp; }

        log('Could not extract OTP from this email, retrying...');
      }

      await client.logout();
      log('Retrying...');

    } catch (e) {
      log('IMAP error: ' + e.message);
      try { await client.logout(); } catch (_) {}
    }
  }

  throw new Error('OTP not received within ' + (maxWaitMs / 1000) + 's.');
}

// ── Delete OTP email(s) by subject once the run has finished successfully ──
// Instead of tracking a UID from earlier in the run, this just searches
// INBOX directly for messages matching the OTP subject and deletes whatever
// it finds. Restricted to recent messages (last `sinceMinutes`) so it never
// touches old, unrelated history.
//
// Gmail IMAP notes:
// - A plain \Deleted flag + EXPUNGE on INBOX just removes the INBOX label
//   (the message still lives in All Mail) — it does NOT trash it.
// - Moving to "[Gmail]/Trash" is the proper way to actually trash it, but
//   only works if that label has "Show in IMAP" enabled in Gmail Settings →
//   Labels, and the exact path can vary by account, so it's looked up via
//   its \Trash special-use flag rather than hardcoded.
// - Either way, we verify the message is actually gone from INBOX afterward
//   and fall back to a hard flag+expunge if the Trash move didn't take.
const OTP_SUBJECT_MATCH = 'Your OTP for logging in Naukri account';

async function deleteOTPEmail(sinceMinutes = 60) {
  log('Looking for OTP email(s) matching subject: "' + OTP_SUBJECT_MATCH + '"...');

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: EMAIL, pass: GMAIL_APP_PASS },
    logger: false,
  });

  try {
    await client.connect();

    // Find the real Trash mailbox by special-use flag rather than guessing
    // its display name (varies by account language/label setup).
    let trashPath = '[Gmail]/Trash';
    try {
      const mailboxes = await client.list();
      const trashBox = mailboxes.find(mb => mb.specialUse === '\\Trash');
      if (trashBox) {
        trashPath = trashBox.path;
        log('Resolved Trash mailbox to: ' + trashPath);
      } else {
        log('No \\Trash special-use mailbox advertised; will try default path: ' + trashPath);
      }
    } catch (e) {
      log('Could not list mailboxes (' + e.message + '), using default Trash path.');
    }

    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - sinceMinutes * 60 * 1000);

      // IMAP SEARCH SUBJECT does a substring match, so the full target
      // subject works fine here.
      const uids = await client.search(
        { subject: OTP_SUBJECT_MATCH, since },
        { uid: true }
      );

      if (!uids || !uids.length) {
        log('No matching OTP emails found in the last ' + sinceMinutes + ' minutes — nothing to delete.');
        return;
      }

      log('Found ' + uids.length + ' matching email(s): ' + uids.join(', '));

      let moved = false;
      try {
        await client.messageMove(uids, trashPath, { uid: true });
        moved = true;
      } catch (e) {
        log('messageMove failed (' + e.message + '), will fall back to hard delete.');
      }

      // Verify they actually left the inbox — don't just trust a non-throwing call.
      const stillPresent = await client.search(
        { subject: OTP_SUBJECT_MATCH, since },
        { uid: true }
      );

      if (moved && (!stillPresent || !stillPresent.length)) {
        log('Confirmed: ' + uids.length + ' OTP email(s) moved out of INBOX into ' + trashPath + '.');
      } else {
        if (moved) {
          log('WARNING: messageMove reported success but message(s) still in INBOX ' +
              '(likely "Show in IMAP" is disabled for the Trash label). Falling back to hard delete.');
        }
        const remaining = stillPresent && stillPresent.length ? stillPresent : uids;
        // Guaranteed removal from INBOX regardless of Trash/label quirks.
        await client.messageFlagsAdd(remaining, ['\\Deleted'], { uid: true });
        await client.messageDelete(remaining, { uid: true }); // expunges flagged messages

        const finalCheck = await client.search(
          { subject: OTP_SUBJECT_MATCH, since },
          { uid: true }
        );
        if (!finalCheck || !finalCheck.length) {
          log('Confirmed: OTP email(s) removed from INBOX via flag+expunge fallback.');
        } else {
          log('WARNING: OTP email(s) still appear present after delete attempt. Check Gmail IMAP settings.');
        }
      }
    } finally {
      lock.release();
    }

  } catch (e) {
    log('Failed to delete OTP email: ' + e.message);
    // Don't throw — this is a best-effort cleanup step and shouldn't fail the run.
  } finally {
    try { await client.logout(); } catch (_) {}
  }
}

// ── Enter OTP into Naukri boxes ─────────────────────────────────────────────
async function enterOTP(page, otp) {
  log('Entering OTP: ' + otp);

  const boxes = await page.$$('input[maxlength="1"]');
  if (boxes.length >= 6) {
    log('Found ' + boxes.length + ' OTP boxes');
    for (let i = 0; i < 6; i++) {
      await boxes[i].click();
      await boxes[i].fill(otp[i]);
      await page.waitForTimeout(150);
    }
  } else {
    const single = await page.$('input[placeholder*="OTP"], input[name*="otp"], input[id*="otp"], input[type="number"]');
    if (single) {
      await single.fill(otp);
      log('Filled single OTP input');
    } else {
      const allInputs = await page.$$('input:not([type="hidden"])');
      for (let i = 0; i < Math.min(allInputs.length, 6); i++) {
        if (await allInputs[i].isVisible()) {
          await allInputs[i].fill(otp[i]);
          await page.waitForTimeout(150);
        }
      }
    }
  }

  await saveScreenshot(page, '05-otp-entered');

  const verifyBtns = ['button:has-text("Verify")', 'button:has-text("Submit")', 'button[type="submit"]'];
  for (const sel of verifyBtns) {
    try { await page.click(sel, { timeout: 3000 }); log('Clicked: ' + sel); break; } catch (e) {}
  }
}

// ── Build dated resume filename ─────────────────────────────────────────────
// Uses Asia/Kolkata (IST, UTC+5:30) explicitly rather than getUTCDate()/
// getUTCMonth(), since UTC and IST dates disagree for the first 5.5 hours of
// each IST day (e.g. it can be 22 Jun in IST while still 21 Jun in UTC).
function getRenamedResumePath() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).formatToParts(now);

  const day = parts.find(p => p.type === 'day').value;
  const month = parts.find(p => p.type === 'month').value; // e.g. "Jun"
  const year = parts.find(p => p.type === 'year').value;

  const dateStr = day + month + year;  // e.g. 22Jun2026
  const filename = 'Dhirendra_Singh_Updated_Resume_' + dateStr + '.pdf';
  return path.join(path.dirname(RESUME_PATH), filename);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!EMAIL || !PASSWORD) { console.error('NAUKRI_EMAIL and NAUKRI_PASSWORD required.'); process.exit(1); }
  if (!GMAIL_APP_PASS) { console.error('GMAIL_APP_PASSWORD required.'); process.exit(1); }
  if (!fs.existsSync(RESUME_PATH)) { console.error('Resume not found: ' + RESUME_PATH); process.exit(1); }

  log('Starting Naukri resume updater...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });

  await context.addInitScript(function() {
    Object.defineProperty(navigator, 'webdriver', { get: function() { return false; } });
    Object.defineProperty(navigator, 'plugins', { get: function() { return [1, 2, 3]; } });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    // ── Step 1: Login ──────────────────────────────────────────────────────
    log('Opening Naukri login...');
    await page.goto('https://www.naukri.com/nlogin/login', {
      waitUntil: 'domcontentloaded', timeout: 60000
    });
    await page.waitForTimeout(8000);
    await saveScreenshot(page, '01-login-page');
    await page.waitForSelector('input', { timeout: 30000, state: 'visible' });

    // Fill email
    const emailSelectors = [
      'input[name="username"]', 'input#usernameField',
      'input[type="email"]', 'input[placeholder*="Email"]', 'input[type="text"]',
    ];
    let emailField = null;
    for (const sel of emailSelectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) { emailField = el; log('Email field: ' + sel); break; }
      } catch (e) {}
    }
    if (!emailField) { await saveScreenshot(page, 'error-no-email'); throw new Error('Email field not found.'); }
    await emailField.click();
    await emailField.fill(EMAIL);

    // Fill password
    const passField = await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await passField.click();
    await passField.fill(PASSWORD);
    await saveScreenshot(page, '02-credentials-filled');

    // Click login
    const loginBtns = [
      'button[type="submit"]', 'button:has-text("Login")',
      'button:has-text("Sign In")', '.loginButton',
    ];
    let clicked = false;
    for (const sel of loginBtns) {
      try { await page.click(sel, { timeout: 3000 }); clicked = true; log('Login btn: ' + sel); break; } catch (e) {}
    }
    if (!clicked) { await passField.press('Enter'); log('Pressed Enter'); }

    await page.waitForTimeout(6000);
    await saveScreenshot(page, '03-after-login');
    log('URL after login: ' + page.url());

    // ── Step 2: Handle OTP ─────────────────────────────────────────────────
    const bodyText = await page.innerText('body').catch(() => '');
    const isOTPPage = bodyText.toLowerCase().includes('otp') || bodyText.includes('Enter the OTP');

    if (isOTPPage) {
      log('OTP page detected!');
      await saveScreenshot(page, '04-otp-page');
      log('Waiting 12s for OTP email to arrive...');
      await page.waitForTimeout(12000);

      const otp = await getOTPFromGmail(90000);
      await enterOTP(page, otp);
      await page.waitForTimeout(5000);
      await saveScreenshot(page, '06-after-otp');
      log('URL after OTP: ' + page.url());
    } else {
      log('No OTP required, continuing...');
    }

    if (page.url().includes('/login') || page.url().includes('/nlogin')) {
      throw new Error('Still on login page after OTP step.');
    }
    log('Logged in successfully!');

    // ── Step 3: Go to profile ──────────────────────────────────────────────
    log('Going to profile page...');
    await page.goto('https://www.naukri.com/mnjuser/profile', {
      waitUntil: 'domcontentloaded', timeout: 60000
    });
    await page.waitForTimeout(6000);
    await saveScreenshot(page, '07-profile');

    // ── Step 4: Find upload input ──────────────────────────────────────────
    const uploadSelectors = [
      'input[type="file"][name="resume"]',
      'input[type="file"].fileUpload',
      '#attachCV input[type="file"]',
      '.resumeUpload input[type="file"]',
      'input[type="file"]',
    ];

    let fileInput = null;
    for (const sel of uploadSelectors) {
      try { const el = await page.$(sel); if (el) { fileInput = el; log('File input: ' + sel); break; } } catch (e) {}
    }

    if (!fileInput) {
      const triggers = [
        'text=Update Resume', 'text=Upload Resume', 'text=Add Resume',
        '.updateResumeBtn', 'label[for*="resume"]',
      ];
      for (const sel of triggers) {
        try { await page.click(sel, { timeout: 4000 }); log('Trigger: ' + sel); await page.waitForTimeout(2000); break; } catch (e) {}
      }
      for (const sel of uploadSelectors) {
        try { const el = await page.$(sel); if (el) { fileInput = el; break; } } catch (e) {}
      }
    }

    if (!fileInput) { await saveScreenshot(page, '08-no-upload'); throw new Error('Resume upload input not found.'); }

    // ── Step 5: Rename resume with today's date and upload ─────────────────
    const renamedPath = getRenamedResumePath();
    fs.copyFileSync(RESUME_PATH, renamedPath);
    log('Resume renamed to: ' + path.basename(renamedPath));

    log('Uploading...');
    await fileInput.setInputFiles(renamedPath);
    await page.waitForTimeout(4000);
    await saveScreenshot(page, '09-after-upload');

    // Confirm if needed
    const confirmBtns = [
      'button:has-text("Save")', 'button:has-text("Upload")',
      'button:has-text("Submit")', '.saveBtn',
    ];
    for (const sel of confirmBtns) {
      try { await page.click(sel, { timeout: 4000 }); log('Confirm: ' + sel); await page.waitForTimeout(2000); break; } catch (e) {}
    }

    await saveScreenshot(page, '10-done');
    log('Resume updated successfully as: ' + path.basename(renamedPath));

    // ── Step 6: Clean up the OTP email ──────────────────────────────────────
    // Only runs once we've reached this point without throwing, i.e. the
    // resume upload is confirmed done.
    await deleteOTPEmail();

  } catch (err) {
    log('ERROR: ' + err.message);
    await saveScreenshot(page, 'error-final');
    await browser.close();
    process.exit(1);
  }

  await browser.close();
  log('Done.');
}

main();
