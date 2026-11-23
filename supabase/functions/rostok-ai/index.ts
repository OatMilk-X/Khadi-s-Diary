// Khadi's Diary — Росток (rostok-ai): shared AI for the helper chat. Deploy with the function name: rostok-ai
// Holds the Gemini key server-side; only signed-in (and optionally allow-listed) users can call it,
// with a per-user daily message limit.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   GEMINI_API_KEY   required — your key from Google AI Studio
//   ALLOWED_EMAILS   optional — comma-separated, e.g. "you@gmail.com,her@gmail.com" (recommended)
//   DAILY_LIMIT      optional — messages per user per day, default 40
//   GEMINI_MODEL     optional — default "gemini-flash-latest"
//   GEMINI_FALLBACK_MODEL optional — used when the main model is overloaded, default "gemini-flash-lite-latest"
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Turn = { role: "user" | "model"; parts: { text: string }[] };

function cleanContents(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-12).flatMap((t: any) => {
    const role = t?.role === "model" ? "model" : t?.role === "user" ? "user" : null;
    const text = Array.isArray(t?.parts) ? t.parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("") : "";
    return role && text ? [{ role, parts: [{ text: text.slice(0, 2000) }] }] : [];
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) return json({ error: "На сервере не задан GEMINI_API_KEY" }, 500);

    // service key: legacy name, or the newer SUPABASE_SECRET_KEYS (JSON map) on new projects
    let serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!serviceKey) {
      try {
        const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
        serviceKey = keys.default ?? Object.values(keys)[0] ?? "";
      } catch { /* ignore */ }
    }
    if (!serviceKey) return json({ error: "На сервере нет служебного ключа Supabase" }, 500);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey as string, {
      auth: { persistSession: false },
    });

    // who is calling?
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const email = userData?.user?.email?.toLowerCase();
    if (userErr || !email) return json({ error: "Нужно войти в аккаунт (Настройки → Синхронизация)" }, 401);

    const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(email)) return json({ error: "У этого аккаунта нет доступа к общему AI" }, 403);

    const body = await req.json().catch(() => ({}));
    const contents = cleanContents(body?.contents);
    if (!contents.length || contents[contents.length - 1].role !== "user") return json({ error: "Пустое сообщение" }, 400);
    const system = typeof body?.system === "string" ? body.system.slice(0, 6000) : "";

    // per-user daily limit (atomic)
    const limit = Number(Deno.env.get("DAILY_LIMIT") ?? "40") || 40;
    const { data: used, error: usageErr } = await admin.rpc("bump_ai_usage", { p_email: email, p_limit: limit });
    if (usageErr) return json({ error: "Не настроена таблица лимитов: " + usageErr.message }, 500);
    if (used === -1) return json({ error: `Дневной лимит (${limit} сообщений) исчерпан — до завтра! 🐾` }, 429);

    // primary model, then a lighter fallback; retry briefly when Google is overloaded
    const models = [Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest", Deno.env.get("GEMINI_FALLBACK_MODEL") ?? "gemini-flash-lite-latest"];
    const payload = JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { maxOutputTokens: 700, temperature: 0.8 },
    });
    let j: any = null, firstErr = "";
    outer: for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey }, body: payload,
        });
        const body: any = await r.json().catch(() => ({}));
        if (r.ok) { j = body; break outer; }
        firstErr ||= body?.error?.message ?? `Gemini HTTP ${r.status}`;
        if (![429, 500, 503].includes(r.status)) break;        // not a temporary problem: try the next model
        await new Promise((res) => setTimeout(res, 900 * (attempt + 1)));
      }
    }
    if (!j) return json({ error: /high demand|overloaded|unavailable|exhausted/i.test(firstErr) ? "Gemini сейчас перегружен — попробуйте через минуту 🌱" : firstErr }, 502);

    const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("").trim();
    if (!text) return json({ error: "Пустой ответ (возможно, сработал фильтр безопасности)" }, 502);
    return json({ text, used, limit });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
