import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = Number(process.env.PORT || 10000);
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
const SECRET = process.env.WEBHOOK_SECRET || '';
const ADMIN_IDS = new Set((process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
const DATA = process.env.DATA_DIR || './data';
const FILE = path.join(DATA, 'expenses.json');
const digits = s => String(s || '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const fa = n => String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
async function readExpenses() { try { return JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(FILE, '[]'); return []; } }
async function writeExpenses(rows) { await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(FILE, JSON.stringify(rows, null, 2)); }
async function tg(method, body) { const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) }); const payload = await r.json().catch(() => ({})); if (!r.ok || payload.ok === false) throw new Error(`${method}: ${r.status} ${payload.description || ''}`); return payload; }
function parse(text) { const n = digits(text); const m = n.match(/([0-9][0-9,،.\s]*)\s*(تومان|ریال)?/); return { amount: m ? Number(m[1].replace(/[،,\s]/g,'')) : null, currency: m?.[2] === 'ریال' ? 'IRR' : 'TOMAN', payment: text.includes('تنخواه') ? 'کارت تنخواه' : text.includes('شرکت') ? 'کارت شرکت' : null }; }
async function handle(update) {
  const m = update.message; if (!m || !TOKEN) return;
  const id = String(m.from.id), chat = m.chat.id, text = m.text || m.caption || '';
  if (text === '/start') return tg('sendMessage', { chat_id: chat, text: `سلام!\nشناسه شما: ${fa(id)}\n\nتوضیح هزینه را همراه مبلغ و روش پرداخت بفرستید.\nمثال: خرید لوازم اداری مبلغ ۲۵۰۰۰۰ تومان کارت شرکت` });
  if (ADMIN_IDS.size && !ADMIN_IDS.has(id)) return tg('sendMessage', { chat_id: chat, text: `دسترسی فعال نیست. شناسه شما: ${fa(id)}` });
  if (text === 'راهنما') return tg('sendMessage', { chat_id: chat, text: 'مثال: خرید لوازم اداری مبلغ ۲۵۰۰۰۰ تومان کارت شرکت' });
  const rows = await readExpenses();
  if (text === 'گزارش من') { const mine = rows.filter(x => x.telegramId === id).slice(-20); return tg('sendMessage', { chat_id: chat, text: mine.length ? mine.map(x => `${x.description} — ${fa(x.amount || 'نامشخص')} ${x.currency}`).join('\n') : 'هنوز هزینه‌ای ثبت نشده است.' }); }
  const p = parse(text); const item = { id: `EXP-${Date.now()}`, telegramId: id, employee: m.from.first_name || id, description: text, ...p, status: p.amount && p.payment ? 'PENDING_REVIEW' : 'NEEDS_COMPLETION', createdAt: new Date().toISOString(), receiptFileId: m.photo?.at(-1)?.file_id || null, voiceFileId: m.voice?.file_id || null };
  rows.push(item); await writeExpenses(rows);
  return tg('sendMessage', { chat_id: chat, text: `✅ هزینه دریافت شد\nشناسه: ${item.id}\nمبلغ: ${item.amount ? fa(item.amount) : 'نامشخص'} ${item.currency}\nروش پرداخت: ${item.payment || 'نامشخص'}\nوضعیت: ${item.status === 'PENDING_REVIEW' ? 'در انتظار بررسی' : 'نیازمند تکمیل'}` });
}
const server = http.createServer(async (req, res) => { if (req.url === '/health') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({ ok: true })); } if (req.method !== 'POST' || !req.url.startsWith('/telegram/webhook')) { res.writeHead(404); return res.end('Not found'); } if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) { res.writeHead(401); return res.end('Unauthorized'); } let body=''; for await (const chunk of req) body += chunk; try { await handle(JSON.parse(body)); res.writeHead(200); res.end('ok'); } catch (e) { console.error(e); res.writeHead(500); res.end('error'); } });
async function configureWebhook() { if (!TOKEN || !PUBLIC_URL) return; const body = { url: `${PUBLIC_URL.replace(/\/$/, '')}/telegram/webhook`, allowed_updates: ['message'] }; if (SECRET) body.secret_token = SECRET; for (let attempt = 1; attempt <= 5; attempt++) { try { await tg('setWebhook', body); console.log('Webhook configured'); return; } catch (e) { console.error(`Webhook setup attempt ${attempt}/5 failed:`, e.message); if (attempt < 5) await new Promise(r => setTimeout(r, attempt * 5000)); } } }
server.listen(PORT, () => { console.log(`Expense bot listening on ${PORT}`); setTimeout(configureWebhook, 5000); });
