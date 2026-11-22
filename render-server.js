import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = Number(process.env.PORT || 10000);
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
// Telegram only accepts A-Z, a-z, 0-9, _ and - in webhook secret tokens.
const SECRET = (process.env.WEBHOOK_SECRET || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 256);
const ADMIN_IDS = new Set((process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
const DATA = process.env.DATA_DIR || './data';
const FILE = path.join(DATA, 'expenses.json');
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
let driveTokenCache = null;
const digits = s => String(s || '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const fa = n => String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
async function readExpenses() { try { return JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(FILE, '[]'); return []; } }
async function writeExpenses(rows) { await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(FILE, JSON.stringify(rows, null, 2)); }
async function tg(method, body) { const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) }); const payload = await r.json().catch(() => ({})); if (!r.ok || payload.ok === false) throw new Error(`${method}: ${r.status} ${payload.description || ''}`); return payload; }
function b64url(v) { return Buffer.from(v).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
async function driveAccessToken() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  if (driveTokenCache && driveTokenCache.exp > Date.now() + 60000) return driveTokenCache.value;
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON); const now = Math.floor(Date.now()/1000);
  const head = b64url(JSON.stringify({ alg:'RS256', typ:'JWT' })); const claim = b64url(JSON.stringify({ iss: sa.client_email, scope:'https://www.googleapis.com/auth/drive.file', aud:'https://oauth2.googleapis.com/token', iat:now, exp:now+3600 }));
  const sign = crypto.createSign('RSA-SHA256'); sign.update(`${head}.${claim}`); const jwt = `${head}.${claim}.${b64url(sign.sign(sa.private_key))}`;
  const r = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion:jwt }) }); const j = await r.json(); if (!r.ok) throw new Error(`Google auth failed: ${j.error_description || r.status}`); driveTokenCache = { value:j.access_token, exp:Date.now()+3500000 }; return j.access_token;
}
async function driveCreateFolder(name, parent) { const token = await driveAccessToken(); if (!token || !DRIVE_FOLDER_ID) return null; const r = await fetch('https://www.googleapis.com/drive/v3/files', { method:'POST', headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'}, body:JSON.stringify({ name, mimeType:'application/vnd.google-apps.folder', parents:[parent] }) }); const j=await r.json(); if(!r.ok) throw new Error(`Drive folder failed: ${j.error?.message || r.status}`); return j.id; }
async function driveUpload(name, data, mime, parent) { const token = await driveAccessToken(); if (!token || !DRIVE_FOLDER_ID) return null; const meta = { name, parents:[parent] }; const form = new FormData(); form.append('metadata', new Blob([JSON.stringify(meta)], {type:'application/json'})); form.append('file', new Blob([data], {type:mime}), name); const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', { method:'POST', headers:{Authorization:`Bearer ${token}`}, body:form }); const j=await r.json(); if(!r.ok) throw new Error(`Drive upload failed: ${j.error?.message || r.status}`); return j; }
async function telegramFile(fileId) { const info = await tg('getFile', { file_id:fileId }); const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${info.result.file_path}`); if (!r.ok) throw new Error(`Telegram file download failed: ${r.status}`); return { data:Buffer.from(await r.arrayBuffer()), path:info.result.file_path }; }
async function archiveToDrive(item) { if (!DRIVE_FOLDER_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return; const parent = await driveCreateFolder(item.id, DRIVE_FOLDER_ID); const meta = JSON.stringify(item, null, 2); await driveUpload('metadata.json', meta, 'application/json', parent); await driveUpload('description.txt', item.description || '', 'text/plain;charset=utf-8', parent); if (item.receiptFileId) { const f=await telegramFile(item.receiptFileId); await driveUpload('receipt.' + ((f.path.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi,'')), f.data, 'image/jpeg', parent); } if (item.voiceFileId) { const f=await telegramFile(item.voiceFileId); await driveUpload('voice.' + ((f.path.split('.').pop() || 'ogg').replace(/[^a-z0-9]/gi,'')), f.data, 'audio/ogg', parent); } console.log(`Drive archived ${item.id}`); }
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
  rows.push(item); await writeExpenses(rows); try { await archiveToDrive(item); } catch (e) { console.error('Drive archive failed:', e.message); }
  return tg('sendMessage', { chat_id: chat, text: `✅ هزینه دریافت شد\nشناسه: ${item.id}\nمبلغ: ${item.amount ? fa(item.amount) : 'نامشخص'} ${item.currency}\nروش پرداخت: ${item.payment || 'نامشخص'}\nوضعیت: ${item.status === 'PENDING_REVIEW' ? 'در انتظار بررسی' : 'نیازمند تکمیل'}` });
}
const server = http.createServer(async (req, res) => { if (req.url === '/health') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({ ok: true })); } if (req.method !== 'POST' || !req.url.startsWith('/telegram/webhook')) { res.writeHead(404); return res.end('Not found'); } if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) { res.writeHead(401); return res.end('Unauthorized'); } let body=''; for await (const chunk of req) body += chunk; try { await handle(JSON.parse(body)); res.writeHead(200); res.end('ok'); } catch (e) { console.error(e); res.writeHead(500); res.end('error'); } });
async function configureWebhook() { if (!TOKEN || !PUBLIC_URL) return; const body = { url: `${PUBLIC_URL.replace(/\/$/, '')}/telegram/webhook`, allowed_updates: ['message'] }; if (SECRET) body.secret_token = SECRET; for (let attempt = 1; attempt <= 5; attempt++) { try { await tg('setWebhook', body); console.log('Webhook configured'); return; } catch (e) { console.error(`Webhook setup attempt ${attempt}/5 failed:`, e.message); if (attempt < 5) await new Promise(r => setTimeout(r, attempt * 5000)); } } }
server.listen(PORT, () => { console.log(`Expense bot listening on ${PORT}`); setTimeout(configureWebhook, 5000); });
