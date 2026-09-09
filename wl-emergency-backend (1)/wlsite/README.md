# WL Emergency — المرحلة الثانية (ربط حقيقي + سجل أمان)

## وش تغيّر عن المرحلة الأولى؟

- ✅ **ربط Discord و Roblox حقيقي بالكامل (OAuth)** — مو تجريبي بعد الحين. يحتاج منك تسوي تطبيق على Discord وعلى Roblox وتحط بياناتهم بالسيرفر (اشرح تحت بالتفصيل).
- ✅ **سجل أمان كامل** — كل تسجيل دخول، تسجيل خروج، ربط، إلغاء ربط، وتغيير صلاحية يُسجَّل تلقائيًا بالتاريخ والوقت.
- ✅ **تبويب "سجل الأمان" بلوحة الإدارة** (تحت "إعدادات الاختبار") — يعرض كل هذي الأحداث لكل المستخدمين بمكان واحد.
- ✅ **تأكيد قبل تسجيل الخروج** — ما راح يسجّل خروجك مباشرة، أول لازم تأكيد بنافذة منبثقة.

## كيف تفعّل الربط الحقيقي مع Discord

1. روح [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**.
2. من تبويب **OAuth2**، انسخ **Client ID** و **Client Secret**.
3. بنفس الصفحة، تحت **Redirects**، ضيف: `https://your-domain.com/auth/discord/callback` (أو `http://localhost:3000/auth/discord/callback` وانت تجرب محليًا).
4. بالسيرفر تبعك، ضيف متغيرات البيئة:
   ```
   DISCORD_CLIENT_ID=...
   DISCORD_CLIENT_SECRET=...
   DISCORD_REDIRECT_URI=https://your-domain.com/auth/discord/callback
   ```
5. أعد تشغيل السيرفر. زر "ربط حساب Discord الحقيقي" بالملف الشخصي بيشتغل من هنا.

## كيف تفعّل الربط الحقيقي مع Roblox

1. روح [create.roblox.com/credentials](https://create.roblox.com/credentials) → **OAuth 2.0 Apps** → أنشئ تطبيق جديد.
2. حط **Redirect URI**: `https://your-domain.com/auth/roblox/callback`
3. فعّل صلاحية (Scope): `openid` و `profile`.
4. انسخ **Client ID** و **Client Secret**.
5. بالسيرفر، ضيف متغيرات البيئة:
   ```
   ROBLOX_CLIENT_ID=...
   ROBLOX_CLIENT_SECRET=...
   ROBLOX_REDIRECT_URI=https://your-domain.com/auth/roblox/callback
   ```
6. أعد تشغيل السيرفر.

### إذا ما حطيت البيانات هذي؟
ولا مشكلة — زر الربط بيوديك لصفحة توضّح إنه الإعداد ناقص، بدل ما يصير خطأ غريب أو ربط وهمي.

### كيف تضيف متغيرات البيئة على Render (أو أي استضافة)؟
بلوحة تحكم الخدمة (Service) عندك بـ Render، فيه قسم اسمه **Environment**، تضيف فيه كل متغير بهذا الشكل: الاسم (`DISCORD_CLIENT_ID` مثلاً) والقيمة، وتحفظ. السيرفر يعيد التشغيل تلقائيًا ويصير جاهز.

---

## وش باقي (المرحلة الجاية)
- حفظ نتائج اختبار التفعيل بقاعدة البيانات.
- Discord Bot يستقبل حدث النجاح ويعطي الرتبة تلقائيًا + يرسل Embed لقناة السجلات.
- الانتقال لقاعدة بيانات دائمة (PostgreSQL) بدل ملف JSON.

---

## تشغيله عندك (على جهازك)
1. ثبّت [Node.js](https://nodejs.org).
2. افتح Terminal جوا مجلد المشروع واكتب: `node server.js`
3. افتح `http://localhost:3000`

ما يحتاج `npm install` — كل شي مبرمج بدون أي مكتبات خارجية.

## كيف تصير Owner
أول حساب تسجّله بالموقع يصير Admin/Owner تلقائيًا. سجّل حسابك انت أول واحد.

## كيف تنزّله على الإنترنت برابط حقيقي
شرحناها بالتفصيل بالمرحلة السابقة — استخدم **Render.com** (مجاني، بدون بطاقة ائتمان):
1. سوّي حساب على render.com وربطه بـ GitHub.
2. ارفع هذا المجلد كـ Repository على GitHub.
3. Render: **New → Web Service** → اختر الـ Repository.
4. Build Command: فاضي. Start Command: `node server.js`
5. Deploy، وبتاخذ رابط حقيقي زي: `https://wl-emergency.onrender.com`

⚠️ لما يصير عندك رابط حقيقي (مو localhost)، لازم ترجع تحدّث `DISCORD_REDIRECT_URI` و`ROBLOX_REDIRECT_URI` (بمتغيرات البيئة) وبإعدادات تطبيقي Discord/Roblox نفسها، عشان يطابقوا الرابط الجديد.

### ملاحظة عن التخزين
البيانات بملف `data.json`. بعض الاستضافات المجانية تمسحه لو السيرفر أعاد التشغيل بعد خمول — مقبول بهذي المرحلة، وبنستبدلها بقاعدة بيانات دائمة قريبًا.

## بنية المشروع
```
wlsite/
  server.js       ← الباكند (تسجيل دخول، جلسات، OAuth حقيقي، سجل أمان، API الإدارة)
  data.json       ← "قاعدة البيانات" (يتكوّن تلقائيًا)
  public/
    index.html    ← الواجهة كاملة
```

قلي أي وحدة من "الباقي" تبي تبدأ فيها.

