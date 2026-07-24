import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function asRows(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload as JsonRecord[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as JsonRecord;
  for (const key of ["data", "Data", "rows", "Rows", "result", "Result", "records", "Records", "extensions", "Extensions", "extensionStatus", "ExtensionStatus"]) {
    const value = record[key];
    if (Array.isArray(value)) return value as JsonRecord[];
    if (value && typeof value === "object") {
      const nestedRows = asRows(value);
      if (nestedRows.length > 0) return nestedRows;
    }
  }
  return [record];
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
  return Boolean(ip);
}

async function writeActionLog(supabase: ReturnType<typeof createClient>, row: JsonRecord) {
  try {
    await supabase.from("jettel_action_logs").insert(row);
  } catch {
    // Bridge logging must never block ingestion.
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Only POST is supported." }, 405);

  const expectedSecret = Deno.env.get("CALL_BRIDGE_SECRET");
  const suppliedSecret = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
    return json({ success: false, error: "Unauthorized bridge." }, 401);
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
  if (eventType !== "extension-status") {
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
      ext_id: cleanText(getRowValue(row, ["ext_id", "ExtId", "extId"])) || buildExtId(extension),
      is_connected: isExtensionConnected(row),
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
