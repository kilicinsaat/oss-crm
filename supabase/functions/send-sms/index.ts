import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const responseMessages: Record<string, string> = {
  "00": "Basarili",
  "87": "SMS kullanici adi veya API sifresi hatali.",
  "88": "SMS gonderici basligi hatali veya onaysiz.",
  "89": "SMS metni hatali.",
  "90": "Telefon numarasi hatali.",
  "91": "Yetersiz SMS kredisi.",
  "93": "SMS isteginde eksik alan var.",
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

function validCustomerId(value: unknown) {
  const id = String(value ?? "").trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Yalnizca POST desteklenir." }, 405);

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return json({ success: false, error: "Oturum gerekli." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnonKey) return json({ success: false, error: "Sunucu ayari eksik." }, 500);

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceSupabase = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ success: false, error: "Gecersiz oturum." }, 401);

  let payload: { phone?: unknown; message?: unknown; customerId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ success: false, error: "Gecersiz istek." }, 400);
  }

  const phone = normalizeTurkishPhone(payload.phone);
  const message = String(payload.message ?? "").trim();
  if (!phone) return json({ success: false, error: "Gecerli bir Turkiye cep telefonu girin." }, 400);
  if (!message || message.length > 1530) return json({ success: false, error: "SMS metni 1-1530 karakter olmali." }, 400);

  async function writeSmsLog(input: {
    status: "sent" | "failed";
    providerCode?: string | null;
    providerMessageId?: string | null;
    providerStatus?: number | null;
    errorMessage?: string | null;
    rawResponse?: string | null;
  }) {
    if (!serviceSupabase) return;
    const { error } = await serviceSupabase.from("sms_logs").insert({
      customer_id: validCustomerId(payload.customerId),
      user_id: user.id,
      phone,
      message,
      provider: "interaktif_sms",
      provider_code: input.providerCode || null,
      provider_message_id: input.providerMessageId || null,
      provider_status: input.providerStatus || null,
      status: input.status,
      error_message: input.errorMessage || null,
      raw_response: input.rawResponse || null,
    });
    if (error) console.error("SMS log insert failed", { error: error.message, userId: user.id });
  }

  const username = Deno.env.get("INTERAKTIF_SMS_USERNAME");
  const password = Deno.env.get("INTERAKTIF_SMS_PASSWORD");
  const header = Deno.env.get("INTERAKTIF_SMS_HEADER");
  const hostname = (Deno.env.get("INTERAKTIF_SMS_HOSTNAME") || "https://api.1sms.com.tr").replace(/\/$/, "");
  if (!username || !password || !header) {
    await writeSmsLog({ status: "failed", errorMessage: "Interaktif SMS server settings are incomplete." });
    return json({ success: false, error: "Interaktif SMS sunucu ayarlari tamamlanmamis." }, 500);
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
      await writeSmsLog({
        status: "failed",
        providerCode: code || null,
        providerMessageId: messageId || null,
        providerStatus: providerResponse.status,
        errorMessage: providerError,
        rawResponse: providerBody,
      });
      console.error("Interaktif SMS error", { code, status: providerResponse.status, userId: user.id });
      return json({ success: false, error: providerError }, 502);
    }

    await writeSmsLog({
      status: "sent",
      providerCode: code,
      providerMessageId: messageId || null,
      providerStatus: providerResponse.status,
      rawResponse: providerBody,
    });
    console.log("Interaktif SMS sent", { messageId, userId: user.id, customerId: payload.customerId ?? null });
    return json({ success: true, messageId: messageId || null });
  } catch (error) {
    await writeSmsLog({ status: "failed", errorMessage: String(error) });
    console.error("Interaktif SMS request failed", { error: String(error), userId: user.id });
    return json({ success: false, error: "SMS servisine ulasilamadi." }, 502);
  }
});
