import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const allowedEvents = new Set(["incoming", "answer", "start", "end"]);
const safeProviderValues = new Set(["microsip", "jettel", "manual"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizePhone(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0090")) digits = digits.slice(4);
  if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? digits : null;
}

function cleanText(value: unknown, maxLength = 160) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function cleanUrl(value: unknown) {
  const text = cleanText(value, 500);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ success: false, error: "Only POST is supported." }, 405);

  const expectedSecret = Deno.env.get("CALL_BRIDGE_SECRET");
  const suppliedSecret = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
    return json({ success: false, error: "Unauthorized bridge." }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ success: false, error: "Invalid JSON." }, 400);
  }

  const eventType = String(payload.eventType || "").toLowerCase();
  const phone = normalizePhone(payload.phone);
  const deviceId = String(payload.deviceId || "").trim().slice(0, 120);
  const hasProvider = Boolean(cleanText(payload.provider, 40));
  const providerInput = String(payload.provider || "microsip").toLowerCase();
  const provider = safeProviderValues.has(providerInput) ? providerInput : "manual";
  const suppliedProfileId = String(payload.profileId || "").trim();
  const externalCallId = cleanText(payload.externalCallId || payload.callId, 160);
  const callerName = cleanText(payload.callerName || payload.caller_name, 160);
  const extension = cleanText(payload.extension || payload.dahili, 80);
  const transferTarget = cleanText(payload.transferTarget || payload.transfer_to, 120);
  const recordingUrl = cleanUrl(payload.recordingUrl || payload.recording_url);
  const rawEvent = cleanMetadata(payload.metadata);
  const validSuppliedProfileId = /^[0-9a-f-]{36}$/i.test(suppliedProfileId);
  if (!allowedEvents.has(eventType) || !phone || !deviceId || (!validSuppliedProfileId && provider !== "jettel")) {
    return json({ success: false, error: "Invalid call event." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: "Server configuration is incomplete." }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let profileId = validSuppliedProfileId ? suppliedProfileId : null;
  if (!profileId && provider === "jettel" && extension) {
    const { data: mappedExtension } = await supabase
      .from("jettel_extensions")
      .select("profile_id")
      .eq("extension", extension)
      .eq("is_active", true)
      .maybeSingle();
    profileId = mappedExtension?.profile_id ?? null;
  }

  let profile = null;
  if (profileId) {
    const profileResult = await supabase
      .from("profiles")
      .select("id")
      .eq("id", profileId)
      .eq("is_active", true)
      .maybeSingle();
    profile = profileResult.data;
  }
  if (!profile) return json({ success: false, error: "Active CRM profile not found." }, 403);

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .or(`phone.eq.${phone},phone_2.eq.${phone}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = new Date().toISOString();
  const { data: openCall } = await supabase
    .from("call_sessions")
    .select("*")
    .eq("device_id", deviceId)
    .eq("phone", phone)
    .is("ended_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (eventType === "incoming") {
    if (openCall) return json({ success: true, callId: openCall.id, duplicate: true });
    const { data, error } = await supabase.from("call_sessions").insert({
      customer_id: customer?.id ?? null,
      profile_id: profileId,
      device_id: deviceId,
      phone,
      direction: "incoming",
      status: "ringing",
      ringing_at: now,
      provider,
      external_call_id: externalCallId,
      caller_name: callerName,
      extension,
      transfer_target: transferTarget,
      recording_url: recordingUrl,
      raw_event: rawEvent,
    }).select("id").single();
    if (error) return json({ success: false, error: error.message }, 500);
    return json({ success: true, callId: data.id });
  }

  if (eventType === "answer") {
    if (!openCall) return json({ success: true, ignored: true });
    const { error } = await supabase.from("call_sessions").update({
      status: "answered",
      answered_at: openCall.answered_at || now,
      updated_at: now,
      provider: hasProvider ? provider : openCall.provider,
      external_call_id: externalCallId || openCall.external_call_id,
      caller_name: callerName || openCall.caller_name,
      extension: extension || openCall.extension,
      transfer_target: transferTarget || openCall.transfer_target,
      recording_url: recordingUrl || openCall.recording_url,
      raw_event: { ...(openCall.raw_event || {}), ...rawEvent },
    }).eq("id", openCall.id);
    if (error) return json({ success: false, error: error.message }, 500);
    return json({ success: true, callId: openCall.id });
  }

  if (eventType === "start") {
    if (openCall) {
      const { error } = await supabase.from("call_sessions").update({
        status: "answered",
        started_at: openCall.started_at || now,
        answered_at: openCall.answered_at || now,
        updated_at: now,
        provider: hasProvider ? provider : openCall.provider,
        external_call_id: externalCallId || openCall.external_call_id,
        caller_name: callerName || openCall.caller_name,
        extension: extension || openCall.extension,
        transfer_target: transferTarget || openCall.transfer_target,
        recording_url: recordingUrl || openCall.recording_url,
        raw_event: { ...(openCall.raw_event || {}), ...rawEvent },
      }).eq("id", openCall.id);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, callId: openCall.id });
    }
    const { data, error } = await supabase.from("call_sessions").insert({
      customer_id: customer?.id ?? null,
      profile_id: profileId,
      device_id: deviceId,
      phone,
      direction: "outgoing",
      status: "answered",
      answered_at: now,
      started_at: now,
      provider,
      external_call_id: externalCallId,
      caller_name: callerName,
      extension,
      transfer_target: transferTarget,
      recording_url: recordingUrl,
      raw_event: rawEvent,
    }).select("id").single();
    if (error) return json({ success: false, error: error.message }, 500);
    return json({ success: true, callId: data.id });
  }

  if (!openCall) return json({ success: true, ignored: true });
  const durationStart = openCall.started_at || openCall.answered_at;
  const durationSeconds = durationStart
    ? Math.max(0, Math.round((Date.now() - new Date(durationStart).getTime()) / 1000))
    : 0;
  const { error } = await supabase.from("call_sessions").update({
    status: durationStart ? "completed" : "missed",
    ended_at: now,
    duration_seconds: durationSeconds,
    updated_at: now,
    provider: hasProvider ? provider : openCall.provider,
    external_call_id: externalCallId || openCall.external_call_id,
    caller_name: callerName || openCall.caller_name,
    extension: extension || openCall.extension,
    transfer_target: transferTarget || openCall.transfer_target,
    recording_url: recordingUrl || openCall.recording_url,
    raw_event: { ...(openCall.raw_event || {}), ...rawEvent },
  }).eq("id", openCall.id);
  if (error) return json({ success: false, error: error.message }, 500);
  return json({ success: true, callId: openCall.id, durationSeconds });
});
