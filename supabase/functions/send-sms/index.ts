import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const responseMessages: Record<string, string> = {
  "00": "Başarılı",
  "87": "SMS kullanıcı adı veya API şifresi hatalı.",
  "88": "SMS gönderici başlığı hatalı veya onaysız.",
  "89": "SMS metni hatalı.",
  "90": "Telefon numarası hatalı.",
  "91": "Yetersiz SMS kredisi.",
  "93": "SMS isteğinde eksik alan var.",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeTurkishPhone(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0090")) digits = digits.slice(4);
  if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? `90${digits}` : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Yalnızca POST desteklenir." }, 405);

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return json({ success: false, error: "Oturum gerekli." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) return json({ success: false, error: "Sunucu ayarı eksik." }, 500);

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ success: false, error: "Geçersiz oturum." }, 401);

  let payload: { phone?: unknown; message?: unknown; customerId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ success: false, error: "Geçersiz istek." }, 400);
  }

  const phone = normalizeTurkishPhone(payload.phone);
  const message = String(payload.message ?? "").trim();
  if (!phone) return json({ success: false, error: "Geçerli bir Türkiye cep telefonu girin." }, 400);
  if (!message || message.length > 1530) return json({ success: false, error: "SMS metni 1-1530 karakter olmalı." }, 400);

  const username = Deno.env.get("INTERAKTIF_SMS_USERNAME");
  const password = Deno.env.get("INTERAKTIF_SMS_PASSWORD");
  const header = Deno.env.get("INTERAKTIF_SMS_HEADER");
  const hostname = (Deno.env.get("INTERAKTIF_SMS_HOSTNAME") || "https://api.1sms.com.tr").replace(/\/$/, "");
  if (!username || !password || !header) {
    return json({ success: false, error: "İnteraktif SMS sunucu ayarları tamamlanmamış." }, 500);
  }

  const url = new URL(`${hostname}/api/smsget/v1`);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  url.searchParams.set("header", header);
  url.searchParams.set("gsm", phone);
  url.searchParams.set("message", message);

  try {
    const providerResponse = await fetch(url, { method: "GET", signal: AbortSignal.timeout(12_000) });
    const providerBody = (await providerResponse.text()).trim();
    const [code, messageId] = providerBody.split(/\s+/, 2);
    if (!providerResponse.ok || code !== "00") {
      const providerError = responseMessages[code] || `SMS servisi hata verdi (${code || providerResponse.status}).`;
      console.error("Interaktif SMS error", { code, status: providerResponse.status, userId: user.id });
      return json({ success: false, error: providerError }, 502);
    }

    console.log("Interaktif SMS sent", { messageId, userId: user.id, customerId: payload.customerId ?? null });
    return json({ success: true, messageId: messageId || null });
  } catch (error) {
    console.error("Interaktif SMS request failed", { error: String(error), userId: user.id });
    return json({ success: false, error: "SMS servisine ulaşılamadı." }, 502);
  }
});
