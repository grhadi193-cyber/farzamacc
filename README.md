# ربات ثبت و مدیریت هزینه شرکت

این پروژه بر پایه‌ی **Telegram Serverless** ساخته شده است. کد ربات در `tgcloud/` قرار دارد و با `npx tgcloud push` روی زیرساخت تلگرام اجرا می‌شود؛ برای اجرا نیازی به VPS، webhook دستی یا polling دائمی نیست. Telegram Serverless دیتابیس SQLite داخلی، Bot API و HTTP خروجی را در اختیار ماژول‌ها می‌گذارد. مستندات رسمی: <https://core.telegram.org/bots/serverless>.

## معماری کوتاه

- `handlers/message.js`: پیام متنی، کپشن، ویس و عکس را دریافت می‌کند و پیش‌نویس می‌سازد.
- `handlers/callback_query.js`: تأیید یا اصلاح هزینه.
- `schema.js`: کاربران، هزینه‌ها، پیش‌نویس‌ها و لاگ حسابرسی.
- `lib/parse.js`, `lib/time.js`, `lib/i18n.js`: اعداد فارسی/عربی/انگلیسی، تاریخ شمسی و پیام فارسی.
- `lib/ai.js`: استخراج اختیاری متن ویس و OCR رسید با OpenAI؛ بدون کلید، ربات همچنان ثبت دستی را انجام می‌دهد.
- `endpoints/listExpenses.js`: هزینه‌های کاربر داخل Mini App.
- `endpoints/report.js`: گزارش مدیر با کنترل نقش.

وضعیت‌ها: `NEEDS_COMPLETION`، `PENDING_REVIEW`، `APPROVED`، `REJECTED`، `SUSPICIOUS`.

## راه‌اندازی سریع Telegram Serverless

۱. در BotFather یک bot بسازید و در مسیر `Serverless` آن را فعال کنید.

۲. Node.js نسخه ۱۸ یا جدیدتر نصب کنید و وابستگی‌ها را بگیرید:

```bash
npm install
```

۳. پروژه را به bot وصل کنید. توکن این مرحله «CLI Access Token» است، نه Bot API Token:

```bash
npx tgcloud login
```

۴. در BotFather کاربران مجاز را در جدول `users` اضافه کنید. ساده‌ترین راه، اجرای SQL/دستور seed در پنل دیتابیس Serverless است. نمونه:

```sql
INSERT INTO users (telegram_id, full_name, role, active)
VALUES (123456789, 'علی رضایی', 'admin', 1);
```

۵. schema و ماژول‌ها را منتشر و migration را اجرا کنید:

```bash
npx tgcloud push
npx tgcloud migrate
```

`push` کد را deploy می‌کند و `migrate` جدول‌ها را می‌سازد. این دو مرحله عمداً جدا هستند.

## تست محلی

```bash
npm test
npx tgcloud run handlers/message '{ chat: { id: 123 }, from: { id: 123 }, text: "/start" }'
npx tgcloud run handlers/message '{ chat: { id: 123 }, from: { id: 123 }, text: "خرید لوازم اداری مبلغ ۲۵۰۰۰۰ تومان کارت شرکت" }'
```

برای تست واقعی عکس/ویس باید یک bot فعال، کاربر مجاز و فایل واقعی در تلگرام داشته باشید.

## صوت، OCR و ذخیره فایل

`lib/ai.js` در صورت وجود `OPENAI_API_KEY` به API صوت و تصویر OpenAI درخواست می‌فرستد. اگر کلید تنظیم نشده باشد، ویس و عکس ذخیره‌ی منطقی می‌شوند اما استخراج خودکار انجام نمی‌شود و هزینه در وضعیت «نیازمند تکمیل» می‌ماند.

برای فایل‌های رسید و صوت، `lib/storage.js` یک adapter دارد. با تنظیم `STORAGE_UPLOAD_URL` می‌توان یک endpoint آپلود S3-compatible یا Google Drive gateway قرار داد. مسیر استاندارد:

```text
company-expenses/incoming/
company-expenses/processed/
company-expenses/needs-review/
company-expenses/rejected/
company-expenses/reports/
```

در نسخه‌ی Serverless، داده‌ی متادیتا داخل دیتابیس داخلی می‌ماند و `file_id` تلگرام برای دریافت امن فایل استفاده می‌شود. برای نگهداری بلندمدت باینری‌ها، endpoint آپلود را به فضای خصوصی S3 وصل کنید؛ فایل‌ها public نشوند.

## اتصال Muse

دو endpoint آماده هستند و از Mini App SDK صدا زده می‌شوند:

- `listExpenses`: هزینه‌های همان کاربر.
- `report`: فقط کاربر با `role=admin`؛ فیلتر `status` و `telegramId` و مجموع را برمی‌گرداند.

در Muse، این عملیات را به عنوان ابزار ثبت کنید: `list_expenses`, `get_report`, `search_by_status`, `mark_processed`, `move_to_needs_review`. برای عملیات نوشتنی، endpoint جدا با همان الگوی `ctx.initData.user` اضافه کنید و حتماً role را سمت سرور بررسی کنید؛ توکن یا شناسه کاربر را از کلاینت اعتماد نکنید.

## زمان‌بندی ساعتی

Telegram Serverless اجرای on-demand دارد. برای بررسی ساعتی، یک Cron خارجی (GitHub Actions، Supabase Scheduled Function یا cron سرویس Railway/Render) تنظیم کنید که endpoint گزارش/پردازش را با احراز هویت سرویس فراخوانی کند. زمان‌بندی را روی `Asia/Tehran` بگذارید. در این repo منطق پردازش idempotent و وضعیت‌محور است؛ بنابراین اجرای دوباره نباید هزینه را دوباره ثبت کند.

## Docker / استقرار جایگزین

Dockerfile و `docker-compose.yml` برای محیط توسعه و CI قرار داده شده‌اند. مسیر اصلی deploy همچنان `tgcloud push` است؛ Docker صرفاً CLI و تست را استاندارد می‌کند. اگر Telegram Serverless برای حساب شما فعال نباشد، همین schema و منطق را می‌توان در یک worker معمولی Node/FastAPI با SQLite/Postgres و webhook تلگرام اجرا کرد.

## مسیر جایگزین سریع: Render

اگر Serverless برای حساب شما فعال نیست، فایل `render.yaml` و `render-server.js` آماده‌اند:

1. کل پروژه را در GitHub قرار دهید.
2. در Render گزینه‌ی **New → Blueprint** را بزنید و Repository را انتخاب کنید.
3. مقدار `TELEGRAM_BOT_TOKEN` را وارد کنید.
4. مقدار `ADMIN_TELEGRAM_IDS` را با شناسه مدیر پر کنید.
5. Deploy را بزنید.

Render متغیر `RENDER_EXTERNAL_URL` را در اختیار سرویس می‌گذارد و برنامه هنگام startup، webhook تلگرام را خودکار تنظیم می‌کند. مسیر `/health` برای health check آماده است. نسخه‌ی Free دیسک پایدار ندارد؛ برای نگهداری دائمی داده‌ها از Supabase/Postgres استفاده کنید یا یک Persistent Disk در پلن پولی Render متصل کنید.

### اتصال مستقیم Google Drive

برای فعال‌کردن آرشیو فایل‌ها در Drive، یک Google Cloud Service Account بسازید، Google Drive API را فعال کنید و یک پوشه‌ی والد را با ایمیل Service Account به‌صورت Editor به اشتراک بگذارید. خود ربات داخل این پوشه، `company-expenses` و زیرپوشه‌های `incoming`، `processed`، `needs-review` و `reports` را می‌سازد.

```text
GOOGLE_DRIVE_FOLDER_ID=شناسه پوشه والد Drive
GOOGLE_SERVICE_ACCOUNT_JSON=کل محتوای JSON حساب سرویس در یک خط
```

ربات برای هر هزینه در `incoming` پوشه‌ای با قالب `1405-09-01_1830_ali-rezaei_123456789` می‌سازد و داخل آن فقط `metadata.json`، `description.txt` و در صورت وجود `receipt.jpg`، `voice.ogg` و `transcript.txt` قرار می‌دهد. اگر این دو متغیر تنظیم نباشند، ربات همچنان کار می‌کند و فقط آرشیو Drive را رد می‌کند.

## امنیت و محدودیت‌های تست

- bot token و کلید OpenAI در کد نیستند و باید در Secret Manager قرار بگیرند.
- فقط کاربران جدول `users` وارد جریان هزینه می‌شوند؛ گزارش فقط برای `role=admin` است.
- محدودیت فایل واقعی Bot API: دانلود از تلگرام حداکثر ۲۰MB است؛ عکس‌ها و ویس‌های بزرگ باید رد یا کوچک شوند.
- بدون دسترسی به BotFather، حساب Telegram Serverless، فضای ذخیره‌سازی و کلید OpenAI، deploy واقعی، OCR، transcription و آپلود ابری قابل‌تأیید نیست؛ تست‌های pure logic در `tests/` اجرا می‌شوند.
