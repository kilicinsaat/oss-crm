import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const managerActions = new Set([
  "active-calls",
  "extension-status",
  "call-report",
  "callback",
  "play-record",
  "queue-call-status",
  "dnd-status",
]);

const bossOnlyActions = new Set(["two-way-callback", "spy-call"]);

class JettelRequestError extends Error {
  details: JsonRecord;

  constructor(message: string, details: JsonRecord = {}) {
    super(message);
    this.name = "JettelRequestError";
    this.details = details;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function cleanText(value: unknown, maxLength = 240) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : "";
}

function normalizeCustomerPhone(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0090")) digits = digits.slice(4);
  if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? digits : "";
}

function normalizeJettelPhone(value: unknown) {
  const customerPhone = normalizeCustomerPhone(value);
  return customerPhone ? `90${customerPhone}` : "";
}

function parseProviderPayload(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function asRows(payload: unknown) {
  if (Array.isArray(payload)) return payload as JsonRecord[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as JsonRecord;
  for (const key of ["data", "Data", "rows", "Rows", "result", "Result", "records", "Records", "calls", "Calls", "extensions", "Extensions", "extensionStatus", "ExtensionStatus"]) {
    const value = record[key];
    if (Array.isArray(value)) return value as JsonRecord[];
    if (value && typeof value === "object") {
      const nestedRows = asRows(value);
      if (nestedRows.length > 0) return nestedRows;
    }
  }
  return [record];
}

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function buildExtId(extension: string) {
  const suffix = cleanText(Deno.env.get("JETTEL_PBX_SUFFIX") || "pbx349", 80);
  return extension.includes("-") ? extension : `${extension}-${suffix}`;
}

function getEnvConfig() {
  const rawBaseUrl = cleanText(Deno.env.get("JETTEL_BASE_URL") || Deno.env.get("JETTEL_POST_URL") || "https://vip.jettel.com.tr", 500);
  const baseUrl = rawBaseUrl.replace(/\/+$/, "").replace(/\/api\/v1\.php$/i, "");
  const config = {
    baseUrl,
    username: cleanText(Deno.env.get("JETTEL_USERNAME") || Deno.env.get("JETTEL_API_USERNAME")),
    password: cleanText(Deno.env.get("JETTEL_PASSWORD") || Deno.env.get("JETTEL_API_PASSWORD")),
    token: cleanText(Deno.env.get("JETTEL_TOKEN")),
    apicode: cleanText(Deno.env.get("JETTEL_APICODE")),
  };
  const missing = Object.entries(config)
    .filter(([key, value]) => key !== "baseUrl" && !value)
    .map(([key]) => key);
  return { config, missing };
}

async function writeActionLog(supabase: ReturnType<typeof createClient>, row: JsonRecord) {
  try {
    await supabase.from("jettel_action_logs").insert(row);
  } catch {
    // Logging must never block call control.
  }
}

async function jettelPost(mode: string, fields: JsonRecord) {
  const { config, missing } = getEnvConfig();
  if (missing.length > 0) {
    throw new JettelRequestError(`Missing Jettel secrets: ${missing.join(", ")}`, {
      mode,
      missing,
      baseUrl: config.baseUrl,
    });
  }

  const body = new URLSearchParams();
  body.set("token", config.token);
  body.set("apicode", config.apicode);
  body.set("username", config.username);
  body.set("password", config.password);
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      body.set(key, String(value));
    }
  }

  const url = `${config.baseUrl}/api/v1.php?mode=${encodeURIComponent(mode)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed before reaching Jettel.";
    throw new JettelRequestError(`Jettel ${mode} request could not be sent: ${message}`, {
      mode,
      url,
      error_name: error instanceof Error ? error.name : "UnknownError",
      error_message: message,
      request_fields: Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
      ),
    });
  }
  const text = await response.text();
  const payload = parseProviderPayload(text);
  if (!response.ok) {
    throw new JettelRequestError(`Jettel ${mode} HTTP ${response.status}: ${text.slice(0, 500)}`, {
      mode,
      url,
      http_status: response.status,
      http_status_text: response.statusText,
      raw_text: text.slice(0, 5000),
      parsed_body: payload as JsonRecord,
    });
  }
  return payload;
}

function getRowValue(row: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function normalizeExtension(value: unknown) {
  const text = cleanText(value, 120);
  const match = text.match(/\d{2,6}/);
  return match ? match[0] : "";
}

function isExtensionConnected(row: JsonRecord) {
  const rawStatus = getRowValue(row, [
    "durum",
    "Durum",
    "status",
    "Status",
    "connected",
    "Connected",
    "is_connected",
    "isConnected",
  ]);
  const normalizedStatus = String(rawStatus).trim().toLocaleLowerCase("tr-TR");
  if (["0", "true", "online", "registered", "connected", "aktif", "bagli", "bağlı"].includes(normalizedStatus)) return true;
  if (normalizedStatus.includes("değil") || normalizedStatus.includes("degil") || normalizedStatus.includes("not")) return false;
  if (normalizedStatus.includes("bağlı") || normalizedStatus.includes("bagli")) return true;

  const extStatus = String(getRowValue(row, ["ext_status", "ExtStatus", "EXT_STATUS"])).trim();
  if (extStatus && extStatus !== "4") return true;

  const ip = cleanText(getRowValue(row, [
    "ip",
    "IP",
    "ip_adresi",
    "IP Adresi",
    "ext_last_registered_ip",
    "ExtLastRegisteredIp",
  ]), 120);
  return Boolean(ip);
}

function mapCallReportRow(row: JsonRecord, extensionMap: Map<string, JsonRecord>, customerMap: Map<string, JsonRecord>) {
  const type = cleanText(getRowValue(row, ["tipi", "type"]));
  const caller = getRowValue(row, ["arayan", "caller", "CLI"]);
  const callee = getRowValue(row, ["aranan", "called", "CLID"]);
  const extension = cleanText(getRowValue(row, ["dahili", "extension"]));
  const direction = type.toLocaleLowerCase("tr-TR").includes("gelen") ? "incoming" : "outgoing";
  const customerPhone = direction === "incoming" ? normalizeCustomerPhone(caller) : normalizeCustomerPhone(callee);
  const startedAt = cleanText(getRowValue(row, ["tarih", "date", "created_at"])) || new Date().toISOString();
  const callUuid = cleanText(getRowValue(row, ["call_uuid", "uuid"]), 160) || null;
  const externalCallId = cleanText(getRowValue(row, ["callID", "call_id", "id"]), 160) || callUuid;
  const status = String(getRowValue(row, ["durum", "status"])) === "1" ? "completed" : "missed";
  const durationSeconds = toNumber(getRowValue(row, ["konusma", "duration", "duration_seconds"]));
  const waitingSeconds = toNumber(getRowValue(row, ["bekleme", "waiting", "waiting_seconds"]));
  const mappedExtension = extensionMap.get(extension);
  const customer = customerPhone ? customerMap.get(customerPhone) : null;

  return {
    customer_id: customer?.id ?? null,
    profile_id: mappedExtension?.profile_id ?? null,
    device_id: extension || "jettel",
    phone: customerPhone || normalizeCustomerPhone(caller) || normalizeCustomerPhone(callee) || "0000000000",
    direction,
    status,
    ringing_at: startedAt,
    answered_at: status === "completed" ? startedAt : null,
    started_at: status === "completed" ? startedAt : null,
    ended_at: startedAt,
    duration_seconds: durationSeconds,
    waiting_seconds: waitingSeconds,
    provider: "jettel",
    external_call_id: externalCallId,
    call_uuid: callUuid,
    caller_name: cleanText(getRowValue(row, ["caller_name", "name"]), 160) || null,
    extension: extension || null,
    raw_event: row,
    updated_at: new Date().toISOString(),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Only POST is supported." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ success: false, error: "Supabase function secrets are incomplete." }, 500);
  }

  const authorization = request.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ success: false, error: "Unauthorized." }, 401);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile?.is_active) return json({ success: false, error: "Active CRM profile not found." }, 403);

  let payload: JsonRecord;
  try {
    payload = await request.json();
  } catch {
    return json({ success: false, error: "Invalid JSON." }, 400);
  }

  const action = cleanText(payload.action, 80);
  const role = cleanText(profile.role, 40);
  const allowed = managerActions.has(action)
    ? ["boss", "manager"].includes(role)
    : bossOnlyActions.has(action) && role === "boss";
  if (!allowed) return json({ success: false, error: "This Jettel action is not allowed for your role." }, 403);

  const rawRequest = { ...payload };
  delete rawRequest.password;
  delete rawRequest.token;
  delete rawRequest.apicode;

  try {
    if (action === "extension-status") {
      const providerPayload = await jettelPost("ExtensionStatus", {});
      const rows = asRows(providerPayload);
      const updates: JsonRecord[] = [];
      for (const row of rows) {
        const extension = normalizeExtension(getRowValue(row, [
          "dahili",
          "Dahili",
          "extension",
          "Extension",
          "ext",
          "Ext",
          "ext_id",
          "ExtId",
          "extId",
        ]));
        if (!extension) continue;
        updates.push({
          extension,
          ext_id: cleanText(getRowValue(row, ["ext_id"])) || buildExtId(extension),
          is_connected: isExtensionConnected(row),
          last_seen_at: new Date().toISOString(),
          raw_status: row,
          updated_at: new Date().toISOString(),
        });
      }
      if (updates.length > 0) {
        await admin.from("jettel_extensions").upsert(updates, { onConflict: "extension" });
      }
      await writeActionLog(admin, {
        user_id: profile.id,
        action,
        status: "success",
        raw_request: rawRequest,
        raw_response: providerPayload as JsonRecord,
      });
      return json({ success: true, extensions: updates, raw: providerPayload });
    }

    if (action === "active-calls") {
      const providerPayload = await jettelPost("ActiveCalls", {});
      await writeActionLog(admin, {
        user_id: profile.id,
        action,
        status: "success",
        raw_request: rawRequest,
        raw_response: providerPayload as JsonRecord,
      });
      return json({ success: true, calls: asRows(providerPayload), raw: providerPayload });
    }

    if (action === "call-report") {
      const fields = {
        first_day: cleanText(payload.firstDay || payload.first_day),
        last_day: cleanText(payload.lastDay || payload.last_day),
        tipi: cleanText(payload.type || payload.tipi),
        arayan: normalizeJettelPhone(payload.caller || payload.arayan) || cleanText(payload.caller || payload.arayan),
        aranan: normalizeJettelPhone(payload.called || payload.aranan) || cleanText(payload.called || payload.aranan),
        durum: cleanText(payload.status || payload.durum),
        callbackID: cleanText(payload.callbackID || payload.callbackId),
        call_uuid: cleanText(payload.callUuid || payload.call_uuid),
      };
      const providerPayload = await jettelPost("CallReport", fields);
      const rows = asRows(providerPayload);

      const { data: extensions } = await admin.from("jettel_extensions").select("extension,profile_id");
      const extensionMap = new Map((extensions || []).map((item: JsonRecord) => [String(item.extension), item]));

      const phones = Array.from(new Set(rows.flatMap((row) => [
        normalizeCustomerPhone(getRowValue(row, ["arayan", "caller", "CLI"])),
        normalizeCustomerPhone(getRowValue(row, ["aranan", "called", "CLID"])),
      ]).filter(Boolean)));
      const customerMap = new Map<string, JsonRecord>();
      for (const phone of phones) {
        const { data: customer } = await admin
          .from("customers")
          .select("id,phone,phone_2")
          .or(`phone.eq.${phone},phone_2.eq.${phone}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (customer) customerMap.set(phone, customer as JsonRecord);
      }

      const mappedCalls = rows
        .map((row) => mapCallReportRow(row, extensionMap, customerMap))
        .filter((row) => row.external_call_id || row.call_uuid);
      if (mappedCalls.length > 0) {
        for (const call of mappedCalls) {
          const { data: existingCall } = await admin
            .from("call_sessions")
            .select("id")
            .eq("provider", "jettel")
            .eq("external_call_id", call.external_call_id)
            .limit(1)
            .maybeSingle();
          if (existingCall?.id) {
            await admin.from("call_sessions").update(call).eq("id", existingCall.id);
          } else {
            await admin.from("call_sessions").insert(call);
          }
        }
      }
      await writeActionLog(admin, {
        user_id: profile.id,
        action,
        status: "success",
        raw_request: rawRequest,
        raw_response: providerPayload as JsonRecord,
      });
      return json({ success: true, imported: mappedCalls.length, calls: mappedCalls, raw: providerPayload });
    }

    if (action === "callback") {
      const extension = cleanText(payload.extension);
      const number = normalizeJettelPhone(payload.phone || payload.number);
      if (!extension || !number) return json({ success: false, error: "extension and phone are required." }, 400);
      const extId = cleanText(payload.extId || payload.ext_id) || buildExtId(extension);
      const providerPayload = await jettelPost("CallBack", { ext_id: extId, number });
      const externalCallId = cleanText((providerPayload as JsonRecord).ActionID || (providerPayload as JsonRecord).actionID, 160);
      const customerPhone = normalizeCustomerPhone(number);
      const { data: customer } = await admin
        .from("customers")
        .select("id")
        .or(`phone.eq.${customerPhone},phone_2.eq.${customerPhone}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: mappedExtension } = await admin
        .from("jettel_extensions")
        .select("profile_id")
        .eq("extension", extension)
        .maybeSingle();
      await admin.from("call_sessions").insert({
        customer_id: customer?.id ?? null,
        profile_id: mappedExtension?.profile_id ?? profile.id,
        device_id: extension,
        phone: customerPhone,
        direction: "outgoing",
        status: "ringing",
        ringing_at: new Date().toISOString(),
        provider: "jettel",
        external_call_id: externalCallId || null,
        extension,
        raw_event: providerPayload,
      });
      await writeActionLog(admin, {
        user_id: profile.id,
        action,
        target_extension: extension,
        target_phone: customerPhone,
        status: "success",
        raw_request: rawRequest,
        raw_response: providerPayload as JsonRecord,
      });
      return json({ success: true, actionId: externalCallId, raw: providerPayload });
    }

    if (action === "play-record") {
      const callID = cleanText(payload.callId || payload.callID);
      const call_uuid = cleanText(payload.callUuid || payload.call_uuid);
      if (!callID && !call_uuid) return json({ success: false, error: "callId or callUuid is required." }, 400);
      const providerPayload = await jettelPost("PlayRecord", callID ? { callID } : { call_uuid });
      await writeActionLog(admin, {
        user_id: profile.id,
        action,
        status: "success",
        raw_request: rawRequest,
        raw_response: { has_wav: Boolean((providerPayload as JsonRecord).wav) },
      });
      return json({ success: true, record: providerPayload });
    }

    if (action === "queue-call-status") {
      const extension = cleanText(payload.extension);
      const status = cleanText(payload.status);
      if (!extension || !["0", "1"].includes(status)) {
        return json({ success: false, error: "extension and status 0/1 are required." }, 400);
      }
      const extId = cleanText(payload.extId || payload.ext_id) || buildExtId(extension);
      const providerPayload = await jettelPost("ExtensionQueuesCallStatus", {
        ext_id: extId,
        ext_queues_call_status: status,
      });
      await writeActionLog(admin, {
        user_id: profile.id,
        action,
        target_extension: extension,
        status: "success",
        raw_request: rawRequest,
        raw_response: providerPayload as JsonRecord,
      });
      return json({ success: true, raw: providerPayload });
    }

    if (action === "dnd-status") {
      const extension = cleanText(payload.extension);
      const status = cleanText(payload.status);
      if (!extension || !["0", "1"].includes(status)) {
        return json({ success: false, error: "extension and status 0/1 are required." }, 400);
      }
      const extId = cleanText(payload.extId || payload.ext_id) || buildExtId(extension);
      const providerPayload = await jettelPost("ExtensionDNDStatus", {
        ext_id: extId,
        ext_dnd_status: status,
      });
      await writeActionLog(admin, {
        user_id: profile.id,
        action,
        target_extension: extension,
        status: "success",
        raw_request: rawRequest,
        raw_response: providerPayload as JsonRecord,
      });
      return json({ success: true, raw: providerPayload });
    }

    if (action === "two-way-callback") {
      const sourceNumber = normalizeJettelPhone(payload.sourceNumber);
      const destinationNumber = normalizeJettelPhone(payload.destinationNumber);
      const trunkCallerID = cleanText(payload.trunkCallerID || Deno.env.get("JETTEL_DEFAULT_TRUNK_CALLER_ID"));
      if (!sourceNumber || !destinationNumber || !trunkCallerID) {
        return json({ success: false, error: "sourceNumber, destinationNumber and trunkCallerID are required." }, 400);
      }
      const providerPayload = await jettelPost("TwoWayCallback", {
        SourceNumber: sourceNumber,
        DestinationNumber: destinationNumber,
        TrunkCallerID: trunkCallerID,
        CallDuration: toNumber(payload.callDuration, 60),
        VoiceRecord: payload.voiceRecord === 0 || payload.voiceRecord === "0" ? 0 : 1,
      });
      await writeActionLog(admin, {
        user_id: profile.id,
        action,
        target_phone: destinationNumber,
        status: "success",
        raw_request: rawRequest,
        raw_response: providerPayload as JsonRecord,
      });
      return json({ success: true, raw: providerPayload });
    }

    if (action === "spy-call") {
      if (Deno.env.get("JETTEL_ENABLE_SPY_CALL") !== "true") {
        return json({ success: false, error: "SpyCall is disabled. Enable JETTEL_ENABLE_SPY_CALL only after adding audit and consent rules." }, 403);
      }
      const spyTip = cleanText(payload.spyTip || payload.SpyTip);
      const spyDahili = cleanText(payload.spyExtension || payload.SpyDahili);
      const hedefDahili = cleanText(payload.targetExtension || payload.HedefDahili);
      if (!["listen", "whisper", "barge"].includes(spyTip) || !spyDahili || !hedefDahili) {
        return json({ success: false, error: "spyTip, spyExtension and targetExtension are required." }, 400);
      }
      const providerPayload = await jettelPost("SpyCall", {
        SpyTip: spyTip,
        SpyDahili: spyDahili,
        HedefDahili: hedefDahili,
      });
      await writeActionLog(admin, {
        user_id: profile.id,
        action,
        target_extension: hedefDahili,
        status: "success",
        raw_request: rawRequest,
        raw_response: providerPayload as JsonRecord,
      });
      return json({ success: true, raw: providerPayload });
    }

    return json({ success: false, error: "Unknown Jettel action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Jettel request failed.";
    const errorDetails = error instanceof JettelRequestError
      ? error.details
      : {
          error_name: error instanceof Error ? error.name : "UnknownError",
          error_message: message,
        };
    await writeActionLog(admin, {
      user_id: profile.id,
      action,
      status: "failed",
      raw_request: rawRequest,
      raw_response: errorDetails,
      error_message: message,
    });
    return json({ success: false, error: message }, 502);
  }
});
