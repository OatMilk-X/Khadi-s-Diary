# Khadi's Diary — notes for Claude

Personal planner PWA (Russian UI) for Vee and his girlfriend. Live at https://oatmilk-x.github.io/Khadi-s-Diary/ (GitHub Pages from `main`).

## Files
- `index.html` — the whole app: inline CSS + JS in one IIFE. Clicks go through `data-act` attributes and an `ACT` map.
- `sw.js` — service worker. Navigation is network-first; static files, CDN and Google Fonts are cache-first. **Bump `VERSION` on every release** (and the "Версия" label in Settings).
- `manifest.webmanifest`, `manifest-test.webmanifest` (test copy), `icon-*.png`.
- `beta/` — old beta; now only redirects to `/` and unregisters its own service worker.
- `supabase/supabase-setup.sql` — tables `user_data`, `ai_usage`, RPC `bump_ai_usage`, RLS.
- `supabase/functions/rostok-ai/index.ts` — Edge Function for the Росток AI chat (Gemini, retry + fallback model). Deployed by hand in the Supabase dashboard.

## Navigation
Bottom tabs: Колесо, Фокус, Главная, Планер, Меню. Меню (`tab-menu`) is a hub: `#menuHub` rows open `.mpage` pages (`menu-page-<name>`) via `openMenuPage`. Settings lives at Меню › Настройки. To add a section: one `.hub-row` + one `.mpage`.

## Test copy
Any address other than `oatmilk-x.github.io/Khadi-s-Diary/` runs in test mode (`window.KD_TEST`): localStorage keys get a `kdtest:` prefix, the service worker uses `kdtest-` caches, sync is pull-only (never writes to Supabase), "Удалить облачные данные" only clears the test copy, and a «Тестовая копия» badge shows.

## Data (localStorage, `pwa_*` keys)
- Tasks `{id,title,category(work|study|gym|personal),date,deadline,comment,priority,done,updatedAt}`
- Habits v2 `{id,title,icon,repeat[7],target,log{ymd:1},updatedAt}`
- Goals `{id,title,category,deadline,done}`
- Events `{id,title,category,priority,repeat,day|date,startTime,endTime,icon?,color?,doneDates?}`
- Garden in `pwa_pet_state` (v:2): gold, active plant, seeds, garden[], pots, decor, focusLog, streak.
- Pomodoro `{cfg{focus,rest,rounds},phase,round,endAt,remaining}`
- Theme `pwa_theme_beta` (default `daylight`).
- Dates are local `ymd`, never UTC.

## Sync (Supabase)
- Project `jiwqxzsjkcslplqunzfj`, publishable key is in index.html (safe to be public). supabase-js 2.45.4 UMD.
- Email OTP sign-in (`signInWithOtp` → `verifyOtp` type `email`).
- Row `user_data(email, payload)`; merge per item by `updatedAt` with tombstones; wheel per date; garden/profile last-write-wins.
- AI: `supabase.functions.invoke('rostok-ai')`. Secrets live only in Supabase: `GEMINI_API_KEY`, `ALLOWED_EMAILS`, `DAILY_LIMIT` (40), `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`. **Never put a key in this repo or in chat.**

## Design (Daylight)
bg #F7F5F1, surface #FFF, field #F1F0F6, navy #2E3A66, accent #6E78C8, sun #F2CF63, text #26304F, sub #8A8FA6. Categories: work #E3A06F, study #8FA6D0, gym #9DB59A, personal #E3A3A6. Fonts Manrope + Caveat. Calm, soft, rounded, line icons. Mascot "Росток" is an SVG sprout drawn by `sprout(expr)`.

## Shipping
1. Edit `index.html`, bump `sw.js` VERSION and the Settings version.
2. Test in a phone-sized viewport (Playwright, 390px wide) incl. Safari-width layout.
3. Commit and push to `main`. Pages deploys in about a minute.
4. On the phone: swipe the app away and reopen. Data stays: updates replace code only.
