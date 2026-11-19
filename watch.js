// Star Cineplex watcher: alerts on Telegram when "Avengers: Doomsday" shows up.
//
// Two alerts, each sent once:
//   1. "listed"  - the movie appears anywhere on cineplexbd.com (e.g. Coming Soon)
//   2. "on_sale" - the movie appears on the ticketing site (ticket.cineplexbd.com)
//
// Pages are rendered in a real browser (the sites are JavaScript apps), and every
// JSON/XHR response they load is also searched, so it works whether the movie
// list comes from HTML or from a hidden API.
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (required to send)
//      STATE_FILE (default state.json), TEST_MESSAGE=1 to just send a test ping
//      MAIN_URLS / TICKET_URLS (comma-separated, optional overrides)

const fs = require('fs');
const { chromium } = require('playwright');

const MOVIE = /avengers?\s*[:\-–]?\s*dooms\s*day|\bdoomsday\b/i;
const MAIN_URLS = (process.env.MAIN_URLS || 'https://www.cineplexbd.com/').split(',');
const TICKET_URLS = (process.env.TICKET_URLS || 'https://ticket.cineplexbd.com/').split(',');
const STATE_FILE = process.env.STATE_FILE || 'state.json';
const ERROR_ALERT_AFTER = 9; // consecutive failed runs (~3 hours at 20 min) before a warning

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n'); }

async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.log('[no Telegram creds] would send:', text); return; }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: false }),
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}: ${await r.text()}`);
}

// Render a URL, return { ok, text, hits: [snippet...] }
async function scan(browser, url) {
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  });
  const bodies = [];
  page.on('response', async (res) => {
    const type = res.request().resourceType();
    const ct = res.headers()['content-type'] || '';
    if (type === 'xhr' || type === 'fetch' || ct.includes('json')) {
      try { bodies.push(await res.text()); } catch {}
    }
  });
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    // scroll so lazy-loaded movie cards render
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(3000);
    const html = await page.content();
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    const status = res ? res.status() : 0;
    const hits = [];
    for (const src of [text, html, ...bodies]) {
      const m = src.match(MOVIE);
      if (m) hits.push(src.slice(Math.max(0, m.index - 80), m.index + 120).replace(/\s+/g, ' '));
    }
    const ok = status > 0 && status < 400 && text.length > 100;
    console.log(`${url} -> HTTP ${status}, ${text.length} chars text, ${bodies.length} API responses, ${hits.length} hits`);
    return { ok, hits };
  } catch (e) {
    console.log(`${url} -> ERROR ${e.message}`);
    return { ok: false, hits: [] };
  } finally {
    await page.close();
  }
}

async function scanAll(browser, urls) {
  const out = { ok: false, hits: [], url: null };
  for (const u of urls) {
    const r = await scan(browser, u.trim());
    out.ok ||= r.ok;
    if (r.hits.length && !out.url) out.url = u.trim();
    out.hits.push(...r.hits);
  }
  return out;
}

(async () => {
  if (process.env.TEST_MESSAGE === '1') {
    await telegram('✅ Star Cineplex watcher is connected. You will get a message here when Avengers: Doomsday tickets open.');
    console.log('Test message sent.');
    return;
  }

  const state = loadState();
  if (state.on_sale) { console.log('Already alerted that tickets are on sale; nothing to do.'); return; }

  const browser = await chromium.launch();
  let main, ticket;
  try {
    main = await scanAll(browser, MAIN_URLS);
    ticket = await scanAll(browser, TICKET_URLS);
  } finally {
    await browser.close();
  }

  const now = new Date().toISOString();
  state.last_check = now;

  if (ticket.hits.length) {
    state.on_sale = now;
    await telegram(
      `🎟️ Avengers: Doomsday tickets look LIVE on Star Cineplex!\n\nBook now: ${ticket.url}\n\nSeen: "${ticket.hits[0].slice(0, 180)}"`
    );
  } else if (main.hits.length && !state.listed) {
    state.listed = now;
    await telegram(
      `👀 Avengers: Doomsday just appeared on the Star Cineplex site (probably Coming Soon). ` +
      `Tickets aren't on the booking site yet; I'll message again the moment they are.\n\n${main.url}`
    );
  }

  // Warn (once per outage) if the sites can't be read, so silence doesn't mean "broken"
  if (!main.ok && !ticket.ok) {
    state.error_streak = (state.error_streak || 0) + 1;
    if (state.error_streak === ERROR_ALERT_AFTER) {
      await telegram('⚠️ Star Cineplex watcher could not load cineplexbd.com for a few hours. It will keep trying.');
    }
  } else {
    state.error_streak = 0;
  }

  saveState(state);
  console.log('State:', JSON.stringify(state));
})().catch((e) => { console.error(e); process.exit(1); });
