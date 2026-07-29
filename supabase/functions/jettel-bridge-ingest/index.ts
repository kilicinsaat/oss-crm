import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-bridge-secret, x-client-info, apikey, content-type",
};

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

function isPlainRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isScalarValue(value: unknown) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function normalizeCustomerPhone(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0090")) digits = digits.slice(4);
  if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? digits : "";
}

function asRows(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) {
    const items = payload.filter((item) => item !== undefined && item !== null && String(item).trim?.() !== "");
    if (items.length === 1 && Array.isArray(items[0])) {
      return asRows(items[0]);
    }
    const firstText = cleanText(items[0], 80).toLocaleLowerCase("tr-TR");
    if (["success", "ok", "true", "basarili", "başarılı"].includes(firstText) && items.length > 1) {
      return asRows(items[1]);
    }
    if (items.every(Array.isArray) && items.some((item) => ["success", "ok", "true", "basarili", "başarılı"].includes(cleanText(item[0], 80).toLocaleLowerCase("tr-TR")))) {
      return items.flatMap((item) => asRows(item));
    }
    if (items.every(Array.isArray)) return items as unknown as JsonRecord[];
    if (items.every(isPlainRecord)) return items as JsonRecord[];
    if (items.every(isScalarValue)) return [items as unknown as JsonRecord];

    const nestedRows = items.flatMap((item) => asRows(item));
    return nestedRows.length > 0 ? nestedRows : [items as unknown as JsonRecord];
  }

  if (!isPlainRecord(payload)) return [];
  const record = payload as JsonRecord;
  for (const key of ["success", "Success", "data", "Data", "rows", "Rows", "result", "Result", "records", "Records", "calls", "Calls", "extensions", "Extensions", "extensionStatus", "ExtensionStatus", "list", "List"]) {
    const value = record[key];
    if (Array.isArray(value) || isPlainRecord(value)) {
      const nestedRows = asRows(value);
      if (nestedRows.length > 0) return nestedRows;
    }
  }

  const extensionEntries = Object.entries(record)
    .filter(([key, value]) => /^\d{2,6}$/.test(key) && (isPlainRecord(value) || Array.isArray(value)));
  if (extensionEntries.length > 0) {
    return extensionEntries.map(([extension, value]) => ({
      ...(isPlainRecord(value) ? value : { values: value }),
      extension,
    }));
  }

  return [record];
}

function getRowValue(row: JsonRecord, keys: string[]) {
  if (Array.isArray(row)) {
    for (const key of keys) {
      const numericIndex = Number(key);
      if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < row.length) {
        const value = row[numericIndex];
        if (value !== undefined && value !== null && String(value).trim() !== "") return value;
      }
    }
  }
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function rowValues(row: unknown) {
  if (Array.isArray(row)) return row.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (row && typeof row === "object") return Object.values(row as JsonRecord).map((value) => String(value ?? "").trim()).filter(Boolean);
  return [];
}

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeExtension(value: unknown) {
  const text = cleanText(value, 120);
  const match = text.match(/\d{2,6}/);
  return match ? match[0] : "";
}

function detectExtension(row: JsonRecord) {
  if (isPlainRecord(row)) {
    for (const key of Object.keys(row)) {
      if (/^\d{2,6}$/.test(key)) return key;
    }
  }

  const direct = normalizeExtension(getRowValue(row, [
    "dahili",
    "Dahili",
    "extension",
    "Extension",
    "ext",
    "Ext",
    "ext_id",
    "ExtId",
    "extId",
    "0",
    "1",
  ]));
  if (direct) return direct;

  for (const value of rowValues(row)) {
    const extIdMatch = value.match(/\b(\d{2,6})-[a-z0-9_-]+\b/i);
    if (extIdMatch) return extIdMatch[1];
  }
  for (const value of rowValues(row)) {
    if (/^9?0?\d{10,12}$/.test(value.replace(/\D/g, ""))) continue;
    const match = value.match(/\b\d{2,6}\b/);
    if (match) return match[0];
  }
  return "";
}

function buildExtId(extension: string) {
  const suffix = cleanText(Deno.env.get("JETTEL_PBX_SUFFIX") || "pbx349", 80);
  return extension.includes("-") ? extension : `${extension}-${suffix}`;
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
  if (ip) return true;

  const values = rowValues(row).map((value) => value.toLocaleLowerCase("tr-TR"));
  if (values.some((value) => value.includes("bağlı değil") || value.includes("bagli degil") || value.includes("not connected"))) return false;
  if (values.some((value) => value.includes("bağlı") || value.includes("bagli") || value.includes("connected") || value.includes("aktif"))) return true;
  if (values.some((value) => /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(value))) return true;
  return false;
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

function detectCallPartyPhone(row: JsonRecord, preferredKeys: string[]) {
  const directPhone = normalizeCustomerPhone(getRowValue(row, preferredKeys));
  if (directPhone) return directPhone;

  for (const value of rowValues(row)) {
    const phone = normalizeCustomerPhone(value);
    if (phone) return phone;
  }
  return "";
}

function detectCallDirection(row: JsonRecord, extension: string, callerPhone: string, calledPhone: string) {
  const valuesText = rowValues(row).join(" ").toLocaleLowerCase("tr-TR");
  if (valuesText.includes("gelen") || valuesText.includes("incoming")) return "incoming";
  if (valuesText.includes("giden") || valuesText.includes("outgoing")) return "outgoing";

  const callerText = cleanText(getRowValue(row, [
    "arayan",
    "caller",
    "CLI",
    "from",
    "src",
    "source",
    "callerid",
    "caller_id",
    "caller_number",
    "calling",
    "calling_number",
  ]), 180);
  const calledText = cleanText(getRowValue(row, [
    "aranan",
    "called",
    "CLID",
    "to",
    "dst",
    "destination",
    "called_number",
    "dialed",
    "dialed_number",
  ]), 180);

  if (extension && callerText.includes(extension) && calledPhone) return "outgoing";
  if (extension && calledText.includes(extension) && callerPhone) return "incoming";
  if (callerPhone && !calledPhone) return "incoming";
  if (calledPhone && !callerPhone) return "outgoing";
  return "incoming";
}

function detectActiveStatus(row: JsonRecord) {
  const rawStatus = cleanText(getRowValue(row, ["durum", "Durum", "status", "Status", "call_status", "CallStatus"]), 80).toLocaleLowerCase("tr-TR");
  if (["1", "answered", "connected", "cevaplandi", "cevaplandı", "konusuyor", "konuşuyor"].includes(rawStatus)) return "answered";
  if (["0", "ringing", "calling", "dialing", "caliyor", "çalıyor", "ariyor", "arıyor"].includes(rawStatus)) return "ringing";

  const valuesText = rowValues(row).join(" ").toLocaleLowerCase("tr-TR");
  if (valuesText.includes("cevap") || valuesText.includes("answer") || valuesText.includes("connected") || valuesText.includes("konuş") || valuesText.includes("konus")) {
    return "answered";
  }
  return "ringing";
}

function mapActiveCallRow(row: JsonRecord, extensionMap: Map<string, JsonRecord>, customerMap: Map<string, JsonRecord>) {
  const extension = detectExtension(row);
  const callerPhone = detectCallPartyPhone(row, [
    "arayan",
    "caller",
    "CLI",
    "from",
    "src",
    "source",
    "callerid",
    "caller_id",
    "caller_number",
    "calling",
    "calling_number",
    "0",
    "1",
    "2",
  ]);
  const calledPhone = detectCallPartyPhone(row, [
    "aranan",
    "called",
    "CLID",
    "to",
    "dst",
    "destination",
    "called_number",
    "dialed",
    "dialed_number",
    "3",
    "4",
    "5",
  ]);
  const direction = detectCallDirection(row, extension, callerPhone, calledPhone);
  const customerPhone = direction === "incoming" ? callerPhone || calledPhone : calledPhone || callerPhone;
  if (!customerPhone && !extension) return null;

  const now = new Date().toISOString();
  const mappedExtension = extensionMap.get(extension);
  const customer = customerPhone ? customerMap.get(customerPhone) : null;
  const callUuid = cleanText(getRowValue(row, ["call_uuid", "uuid", "uniqueid", "unique_id"]), 160) || null;
  const externalCallId = cleanText(getRowValue(row, ["callID", "call_id", "id", "ActionID", "actionID", "linkedid", "linked_id"]), 160)
    || callUuid
    || `active:${extension || "jettel"}:${customerPhone || "unknown"}`;
  const status = detectActiveStatus(row);

  return {
    customer_id: customer?.id ?? null,
    profile_id: mappedExtension?.profile_id ?? null,
    device_id: extension || "jettel",
    phone: customerPhone || "0000000000",
    direction,
    status,
    ringing_at: now,
    answered_at: status === "answered" ? now : null,
    started_at: status === "answered" ? now : null,
    ended_at: null,
    duration_seconds: toNumber(getRowValue(row, ["duration", "duration_seconds", "konusma", "süre", "sure"])),
    waiting_seconds: toNumber(getRowValue(row, ["waiting", "waiting_seconds", "bekleme"])),
    provider: "jettel",
    external_call_id: externalCallId,
    call_uuid: callUuid,
    caller_name: cleanText(getRowValue(row, ["caller_name", "name", "isim", "ad"]), 160) || null,
    extension: extension || null,
    raw_event: row,
    updated_at: now,
  };
}

async function writeActionLog(supabase: ReturnType<typeof createClient>, row: JsonRecord) {
  try {
    await supabase.from("jettel_action_logs").insert(row);
  } catch {
    // Bridge logging must never block ingestion.
  }
}

async function secretFingerprint(value: string) {
  if (!value) return "empty";
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Only POST is supported." }, 405);

  const expectedSecret = cleanText(Deno.env.get("CALL_BRIDGE_SECRET"), 2000);
  const suppliedSecret = cleanText(
    request.headers.get("X-Bridge-Secret")
      || request.headers.get("Authorization")?.replace(/^Bearer\s+/i, ""),
    2000
  );
  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
    return json({
      success: false,
      error: "Unauthorized bridge.",
      expectedSet: Boolean(expectedSecret),
      suppliedSet: Boolean(suppliedSecret),
      expectedLength: expectedSecret.length,
      suppliedLength: suppliedSecret.length,
      expectedFingerprint: await secretFingerprint(expectedSecret),
      suppliedFingerprint: await secretFingerprint(suppliedSecret),
    }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: "Server configuration is incomplete." }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let payload: JsonRecord;
  try {
    payload = await request.json();
  } catch {
    return json({ success: false, error: "Invalid JSON." }, 400);
  }

  const eventType = cleanText(payload.eventType || payload.type, 80);
  const raw = payload.raw ?? payload.data ?? payload.rows ?? payload;
  if (!["extension-status", "active-calls", "call-report"].includes(eventType)) {
    await writeActionLog(supabase, {
      action: eventType || "unknown",
      status: "failed",
      raw_request: payload,
      raw_response: {},
      error_message: "Unsupported Jettel bridge event type.",
    });
    return json({ success: false, error: "Unsupported event type." }, 400);
  }

  const rows = asRows(raw);
  if (eventType === "active-calls") {
    const { data: extensions } = await supabase.from("jettel_extensions").select("extension,profile_id");
    const extensionMap = new Map((extensions || []).map((item: JsonRecord) => [String(item.extension), item]));

    const phones = Array.from(new Set(rows.flatMap((row) => [
      detectCallPartyPhone(row, ["arayan", "caller", "CLI", "from", "src", "source", "callerid", "caller_id", "caller_number", "calling", "calling_number", "0", "1", "2"]),
      detectCallPartyPhone(row, ["aranan", "called", "CLID", "to", "dst", "destination", "called_number", "dialed", "dialed_number", "3", "4", "5"]),
    ]).filter(Boolean)));
    const customerMap = new Map<string, JsonRecord>();
    for (const phone of phones) {
      const { data: customer } = await supabase
        .from("customers")
        .select("id,phone,phone_2")
        .or(`phone.eq.${phone},phone_2.eq.${phone}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (customer) customerMap.set(phone, customer as JsonRecord);
    }

    const mappedCalls = rows
      .map((row) => mapActiveCallRow(row, extensionMap, customerMap))
      .filter((row): row is NonNullable<ReturnType<typeof mapActiveCallRow>> => Boolean(row));

    let inserted = 0;
    let updated = 0;
    for (const call of mappedCalls) {
      const { data: existingCall } = await supabase
        .from("call_sessions")
        .select("id,status")
        .eq("provider", "jettel")
        .eq("external_call_id", call.external_call_id)
        .limit(1)
        .maybeSingle();

      if ((existingCall as JsonRecord | null)?.id) {
        const { error } = await supabase.from("call_sessions").update(call).eq("id", (existingCall as JsonRecord).id);
        if (!error) updated += 1;
      } else {
        const { error } = await supabase.from("call_sessions").insert(call);
        if (!error) inserted += 1;
      }
    }

    const activeIds = mappedCalls.map((call) => call.external_call_id).filter(Boolean);
    const staleCutoff = new Date(Date.now() - 90_000).toISOString();
    let closeQuery = supabase
      .from("call_sessions")
      .update({
        status: "missed",
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("provider", "jettel")
      .in("status", ["ringing", "answered"])
      .lt("updated_at", staleCutoff);
    if (activeIds.length > 0) closeQuery = closeQuery.not("external_call_id", "in", `(${activeIds.map((id) => `"${String(id).replaceAll('"', '\\"')}"`).join(",")})`);
    await closeQuery;

    await writeActionLog(supabase, {
      action: "active-calls",
      status: "success",
      raw_request: {
        eventType,
        sourceDevice: payload.sourceDevice || null,
        occurredAt: payload.occurredAt || null,
      },
      raw_response: {
        rows_seen: rows.length,
        mapped: mappedCalls.length,
        inserted,
        updated,
        active_ids: activeIds,
        sample_rows: rows.slice(0, 10),
      },
    });

    return json({ success: true, rowsSeen: rows.length, mapped: mappedCalls.length, inserted, updated });
  }

  if (eventType === "call-report") {
    const { data: extensions } = await supabase.from("jettel_extensions").select("extension,profile_id");
    const extensionMap = new Map((extensions || []).map((item: JsonRecord) => [String(item.extension), item]));

    const phones = Array.from(new Set(rows.flatMap((row) => [
      normalizeCustomerPhone(getRowValue(row, ["arayan", "caller", "CLI"])),
      normalizeCustomerPhone(getRowValue(row, ["aranan", "called", "CLID"])),
    ]).filter(Boolean)));
    const customerMap = new Map<string, JsonRecord>();
    for (const phone of phones) {
      const { data: customer } = await supabase
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

    let inserted = 0;
    let updated = 0;
    for (const call of mappedCalls) {
      let existingCall: JsonRecord | null = null;
      if (call.external_call_id) {
        const { data } = await supabase
          .from("call_sessions")
          .select("id")
          .eq("provider", "jettel")
          .eq("external_call_id", call.external_call_id)
          .limit(1)
          .maybeSingle();
        existingCall = data as JsonRecord | null;
      }
      if (!existingCall?.id && call.call_uuid) {
        const { data } = await supabase
          .from("call_sessions")
          .select("id")
          .eq("provider", "jettel")
          .eq("call_uuid", call.call_uuid)
          .limit(1)
          .maybeSingle();
        existingCall = data as JsonRecord | null;
      }
      if (existingCall?.id) {
        const { error } = await supabase.from("call_sessions").update(call).eq("id", existingCall.id);
        if (!error) updated += 1;
      } else {
        const { error } = await supabase.from("call_sessions").insert(call);
        if (!error) inserted += 1;
      }
    }

    await writeActionLog(supabase, {
      action: "call-report",
      status: "success",
      raw_request: {
        eventType,
        sourceDevice: payload.sourceDevice || null,
        occurredAt: payload.occurredAt || null,
        meta: payload.meta || {},
      },
      raw_response: {
        rows_seen: rows.length,
        mapped: mappedCalls.length,
        inserted,
        updated,
      },
    });

    return json({ success: true, rowsSeen: rows.length, imported: inserted, updated, mapped: mappedCalls.length });
  }

  const updates: JsonRecord[] = [];
  for (const row of rows) {
    const extension = detectExtension(row);
    if (!extension) continue;
    const statusRow = isPlainRecord(row) && isPlainRecord(row.response) ? row.response : row;
    updates.push({
      extension,
      ext_id: cleanText(getRowValue(row, ["ext_id", "ExtId", "extId"])) || buildExtId(extension),
      is_connected: isExtensionConnected(statusRow),
      last_seen_at: new Date().toISOString(),
      raw_status: row,
      updated_at: new Date().toISOString(),
    });
  }

  if (updates.length > 0) {
    const { error } = await supabase.from("jettel_extensions").upsert(updates, { onConflict: "extension" });
    if (error) {
      await writeActionLog(supabase, {
        action: "extension-status",
        status: "failed",
        raw_request: { eventType, sourceDevice: payload.sourceDevice || null },
        raw_response: { rows, updates },
        error_message: error.message,
      });
      return json({ success: false, error: error.message }, 500);
    }
  }

  await writeActionLog(supabase, {
    action: "extension-status",
    status: "success",
    raw_request: {
      eventType,
      sourceDevice: payload.sourceDevice || null,
      occurredAt: payload.occurredAt || null,
    },
    raw_response: {
      imported: updates.length,
      rows_seen: rows.length,
      rows,
    },
  });

  return json({ success: true, imported: updates.length, rowsSeen: rows.length });
});
