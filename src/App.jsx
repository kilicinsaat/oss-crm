import { Component, useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseConfigMissing } from "./lib/supabase";
import accountIcon from "./assets/sistem-icon/account.png";
import appointmentIcon from "./assets/sistem-icon/appointment.png";
import calendarIcon from "./assets/sistem-icon/calendar.png";
import callbackIcon from "./assets/sistem-icon/callback.png";
import contractIcon from "./assets/sistem-icon/contract.png";
import customersIcon from "./assets/sistem-icon/customers.png";
import dashboardIcon from "./assets/sistem-icon/dashboard.png";
import messagesIcon from "./assets/sistem-icon/messages.png";
import newCustomersIcon from "./assets/sistem-icon/new-customers.png";
import noAnswerIcon from "./assets/sistem-icon/no-answer.png";
import notApprovedIcon from "./assets/sistem-icon/not-approved.png";
import notesIcon from "./assets/sistem-icon/notes.png";
import paidIcon from "./assets/sistem-icon/paid.png";
import reportsIcon from "./assets/sistem-icon/reports.png";
import followupsIcon from "./assets/sistem-icon/followups.png";
import todayWorkIcon from "./assets/sistem-icon/today-work.png";
import wrongNumberIcon from "./assets/sistem-icon/wrong-number.png";

const COMPANY_MESSAGE = `
KILIÇ İNŞAAT MİMARLIK

İletişim:
0 (530) 350 12 76

Mail:
info@kilicinsaatmimarlik.com

Adres:
Namık Kemal Mah. 68. Sokak No:34513
Lotus Çarşı Kat: 8 Daire: 36
Esenyurt / İstanbul

Herhangi bir sorunuz olursa bize ulaşabilirsiniz.
`;

const DEFAULT_SMS_MESSAGE = `🏢 KILIÇ İNŞAAT MİMARLIK

📞 İletişim:
0 (530) 350 12 76

🌐 Web Sitesi:
https://www.kilicinsaatmimarlik.com

📧 Mail:
info@kilicinsaatmimarlik.com

📍 Adres:
Namık Kemal Mah. 68. Sokak No:34513
Lotus Çarşı Kat: 8 Daire: 36
Esenyurt / İstanbul

Herhangi bir sorunuz olursa bize ulaşabilirsiniz.`;

const COMPANY_LOCATION_URL = "https://maps.app.goo.gl/c8cCAtc2671RzBZC9";
const CUSTOMER_STATUSES = new Set([
  "pool",
  "assigned",
  "no_answer",
  "busy",
  "callback",
  "appointment",
  "contract_appointment",
  "meeting_done",
  "not_approved",
  "wrong_number",
  "using",
  "approved",
  "paid",
]);

const brandRed = "#e24407";
const brandRedDark = "#b73505";
const brandRedSoft = "#fff1eb";
const brandRedBorder = "rgba(226,68,7,0.24)";
const appTextColor = brandRed;
const mutedRedText = "#8a2a08";
const IMPORTANT_CUSTOMER_STATUSES = ["assigned", "appointment", "contract_appointment", "callback"];
const FOLLOW_UP_CUSTOMER_STATUSES = ["no_answer", "busy", "appointment", "contract_appointment", "callback", "meeting_done", "not_approved"];
const REP_NEGATIVE_CUSTOMER_STATUSES = new Set(["no_answer", "busy", "not_approved", "wrong_number"]);
const APPOINTMENT_REMINDER_STATUSES = ["appointment", "contract_appointment"];
const CALENDAR_REMINDER_STATUSES = ["callback", "appointment", "contract_appointment"];
const CUSTOMER_SELECT_COLUMNS = "id,first_name,last_name,email,phone,appointment_date,info_note,status,approved,payment_received,assigned_manager,assigned_employee,created_by,created_at,updated_at,batch_name,batch_page,assigned_at,last_action_by,website,address,tc_no,phone_2";
const REMOTE_CUSTOMER_COUNT_MODE = "exact";
const APP_VERSION_CHECK_INTERVAL = 60_000;
const APP_VERSION_STORAGE_KEY = "oss-crm-app-version";
const SESSION_STARTED_AT_KEY = "oss-crm-session-started-at";
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const SESSION_CHECK_INTERVAL = 60_000;
const CUSTOMER_PRELOAD_PAGE_SIZE = 1000;
const REP_MONITOR_PAGE_SIZE = 1000;
const REP_MONITOR_RECONCILE_INTERVAL = 30_000;
const APPOINTMENT_RECONCILE_INTERVAL = 60_000;
const APPOINTMENT_DAY_ALERT_MS = 24 * 60 * 60 * 1000;
const APPOINTMENT_SOON_ALERT_MS = 30 * 60 * 1000;
const INITIAL_CUSTOMER_PAGES = 1;
const MAX_PRIORITY_PRELOAD_PAGES = 1;

function sortAppointmentCustomers(customers) {
  return [...customers].sort((first, second) =>
    new Date(first.appointment_date || 0) - new Date(second.appointment_date || 0)
  );
}

function isCalendarCustomer(customer) {
  return Boolean(customer?.appointment_date && CALENDAR_REMINDER_STATUSES.includes(customer.status));
}

function mergeCustomersById(...groups) {
  const customerMap = new Map();
  groups.flat().forEach((customer) => {
    if (!customer?.id) return;
    customerMap.set(String(customer.id), {
      ...(customerMap.get(String(customer.id)) || {}),
      ...customer,
    });
  });
  return Array.from(customerMap.values());
}

const menuIconAssets = {
  account: accountIcon,
  appointment: appointmentIcon,
  calendar: calendarIcon,
  callback: callbackIcon,
  contract: contractIcon,
  customers: customersIcon,
  dashboard: dashboardIcon,
  employees: customersIcon,
  managerCustomers: customersIcon,
  managerNewCustomers: newCustomersIcon,
  followups: followupsIcon,
  messages: messagesIcon,
  newCustomers: newCustomersIcon,
  noAnswer: noAnswerIcon,
  notApproved: notApprovedIcon,
  notes: notesIcon,
  paid: paidIcon,
  pool: newCustomersIcon,
  reports: reportsIcon,
  todayWork: todayWorkIcon,
  wrongNumber: wrongNumberIcon,
};
const SEARCH_DEBOUNCE_MS = 300;
const CUSTOMER_SEARCH_MIN_LENGTH = 3;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getFunctionErrorMessage(error) {
  if (!error) return "";
  const context = error.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    } catch {
      // Fall back to text/message below.
    }
  }
  if (context && typeof context.text === "function") {
    try {
      const text = await context.text();
      if (text) return text.slice(0, 500);
    } catch {
      // Fall back to regular error message.
    }
  }
  return error.message || "";
}

function readSessionStartedAt() {
  try {
    const value = window.sessionStorage.getItem(SESSION_STARTED_AT_KEY);
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

function markSessionStarted() {
  try {
    window.sessionStorage.setItem(SESSION_STARTED_AT_KEY, String(Date.now()));
  } catch {
    // Session duration tracking is best effort when storage is blocked.
  }
}

function clearSessionStarted() {
  try {
    window.sessionStorage.removeItem(SESSION_STARTED_AT_KEY);
  } catch {
    // Best effort cleanup.
  }
}

function clearLegacyLocalAuthStorage() {
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith("sb-") && key.includes("auth-token"))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Old persistent auth cleanup is best effort.
  }
}

function isSessionTooOld() {
  const startedAt = readSessionStartedAt();
  if (!startedAt) return true;
  return Date.now() - startedAt > SESSION_MAX_AGE_MS;
}

function useDebouncedValue(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

async function runWithRetry(operation, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await operation();
      if (!result?.error) return result;
      lastError = result.error;
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) await wait(150 * (attempt + 1));
  }

  return { data: null, error: lastError };
}

async function loadUserNotes({
  userId,
  setMyNotes,
  setMyNotesLoading,
  setMyNotesError,
}) {
  if (!userId) return;
  setMyNotesLoading(true);
  const { data, error } = await runWithRetry(() =>
    supabase
      .from("user_notes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200)
  );
  setMyNotesLoading(false);

  if (error) {
    const setupMissing = error.code === "PGRST202" || error.message?.includes("user_notes");
    setMyNotesError(setupMissing
      ? "Notlarım kurulumu eksik. Supabase SQL Editor'da MY_NOTES.sql dosyasını bir kez çalıştır."
      : "Notlar yüklenemedi: " + error.message);
    return;
  }

  setMyNotesError("");
  setMyNotes(data || []);
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizeCustomerSearch(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";
  if (/^[\d\s()+-]+$/.test(rawValue)) return normalizePhone(rawValue);
  return rawValue
    .toLocaleLowerCase("tr-TR")
    .replace(/[%_,]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function isNumericCustomerSearch(value) {
  const rawValue = String(value || "").trim();
  return Boolean(rawValue) && /^[\d\s()+-]+$/.test(rawValue);
}

function isTurkishMobile(value) {
  return /^5\d{9}$/.test(normalizePhone(value));
}

function formatPhoneDisplay(value) {
  const digits = normalizePhone(value);
  if (isTurkishMobile(value)) return `0${digits}`;
  return String(value || "").trim() || "-";
}

function phoneDialValue(value) {
  const digits = normalizePhone(value);
  if (isTurkishMobile(value)) return `0${digits}`;
  return digits;
}

function whatsappPhone(value) {
  const digits = normalizePhone(value);
  return digits.length === 10 ? `90${digits}` : "";
}

function toDateTimeInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLongDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function isSameDay(value, date) {
  if (!value) return false;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return false;
  return target.getFullYear() === date.getFullYear()
    && target.getMonth() === date.getMonth()
    && target.getDate() === date.getDate();
}

function getNoteDayLabel(value, referenceDate = new Date()) {
  if (!value) return "Tarih bilinmiyor";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tarih bilinmiyor";
  if (isSameDay(date, referenceDate)) return "Bugün";

  const yesterday = new Date(referenceDate);
  yesterday.setDate(referenceDate.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Dün";

  return date.toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function groupNotesByDay(notes = []) {
  const buckets = new Map();

  notes.forEach((note) => {
    const date = new Date(note.created_at);
    const key = Number.isNaN(date.getTime()) ? "unknown" : date.toDateString();
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: getNoteDayLabel(note.created_at),
        dateText: formatDate(note.created_at),
        notes: [],
      });
    }
    buckets.get(key).notes.push(note);
  });

  return [...buckets.values()];
}

function buildCustomerNoteShareMessage(customer, note) {
  const fullName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Müşteri";
  const lines = [
    "Müşteri notu paylaşıldı",
    `Müşteri: ${fullName}`,
    `Telefon: ${formatPhoneDisplay(customer.phone)}`,
  ];

  if (customer.phone_2) lines.push(`Telefon 2: ${formatPhoneDisplay(customer.phone_2)}`);
  lines.push(`Durum: ${statusLabel(customer.status)}`);
  if (customer.appointment_date) lines.push(`Takip: ${formatDateTime(customer.appointment_date)}`);
  if (customer.batch_name) lines.push(`Data: ${customer.batch_name}${customer.batch_page ? ` / Sayfa ${customer.batch_page}` : ""}`);
  lines.push("", "Not:", note.trim());

  return lines.join("\n").slice(0, 2000);
}

function customerFullName(customer) {
  return `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "-";
}

function userDisplayName(users, userId) {
  const user = users.find((item) => item.id === userId);
  return user?.full_name || user?.email || "-";
}

function callStatusLabel(call) {
  if (call?.status === "ringing") return "Çalıyor";
  if (call?.status === "answered") return "Görüşme devam ediyor";
  if (call?.status === "missed") return "Cevapsız";
  return "Tamamlandı";
}

function callProviderLabel(call) {
  if (call?.provider === "jettel") return "Jettel";
  if (call?.provider === "manual") return "Manuel";
  return "MicroSIP";
}

function formatCallDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function customerCallStatusLabel(calls = []) {
  const latestCall = calls[0];
  if (!latestCall) return "Henüz arama yok";
  if (latestCall.status === "ringing") return "Şu an çalıyor";
  if (latestCall.status === "answered" && !latestCall.ended_at) return "Görüşme devam ediyor";
  if (latestCall.status === "missed") return "Son arama: Cevapsız";
  if (latestCall.status === "completed") return `Son arama: Görüşüldü (${formatCallDuration(latestCall.duration_seconds)})`;
  return `Son arama: ${callStatusLabel(latestCall)}`;
}

function customerCallStatusTone(calls = []) {
  const latestCall = calls[0];
  if (!latestCall) return { color: "#94a3b8", background: "rgba(148,163,184,0.14)" };
  if (latestCall.status === "ringing" || (latestCall.status === "answered" && !latestCall.ended_at)) {
    return { color: "#38bdf8", background: "rgba(56,189,248,0.16)" };
  }
  if (latestCall.status === "missed") return { color: "#f87171", background: "rgba(248,113,113,0.16)" };
  return { color: "#34d399", background: "rgba(52,211,153,0.16)" };
}

function customerLogSourceLabel(log, selectedCustomer, customers) {
  if (String(log.customer_id) === String(selectedCustomer.id)) return "";
  const sourceCustomer = customers.find((customer) => String(customer.id) === String(log.customer_id));
  if (!sourceCustomer) return "Aynı telefon geçmişinden";
  const pageText = sourceCustomer.batch_page ? ` / Sayfa ${sourceCustomer.batch_page}` : "";
  return `Aynı telefon kartı: ${customerFullName(sourceCustomer)}${sourceCustomer.batch_name ? ` - ${sourceCustomer.batch_name}${pageText}` : ""}`;
}

function roleName(role) {
  if (role === "boss") return "Boss";
  if (role === "manager") return "Manager";
  if (role === "employee") return "Rep";
  return role || "-";
}

function statusLabel(status) {
  const labels = {
    pool: "Aranmadı",
    assigned: "Yeni",
    called: "Arandı",
    no_answer: "Ulaşılamadı",
    busy: "Meşgul",
    callback: "Tekrar Aranacak",
    appointment: "Randevu",
    contract_appointment: "Sözleşmeli Randevu",
    meeting_done: "Görüşüldü",
    not_approved: "Yapmayacak",
    wrong_number: "Numara yanlış",
    using: "Kullanıyor",
    approved: "Onaylandı",
    paid: "Para Alındı",
  };
  return labels[status] || status || "-";
}

function statusBadge(status) {
  const colors = {
    pool: "#64748b",
    assigned: "#2563eb",
    called: "#f97316",
    no_answer: "#64748b",
    busy: "#c2410c",
    callback: "#a855f7",
    appointment: "#eab308",
    contract_appointment: "#06b6d4",
    not_approved: "#ef4444",
    wrong_number: "#64748b",
    using: "#14b8a6",
    approved: "#22c55e",
    paid: "#059669",
  };

  return {
    background: colors[status] || "#334155",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    color: "white",
    fontWeight: 700,
    display: "inline-block",
  };
}

function customerHeat(status) {
  const levels = {
    pool: { label: "Soğuk müşteri", color: "#60a5fa", background: "rgba(96,165,250,0.14)" },
    assigned: { label: "Soğuk müşteri", color: "#60a5fa", background: "rgba(96,165,250,0.14)" },
    called: { label: "Ilık müşteri", color: "#fb923c", background: "rgba(251,146,60,0.14)" },
    no_answer: { label: "Ulaşılamadı", color: "#94a3b8", background: "rgba(148,163,184,0.14)" },
    busy: { label: "Meşgul", color: "#c2410c", background: "rgba(194,65,12,0.18)" },
    callback: { label: "Ilık müşteri", color: "#c084fc", background: "rgba(192,132,252,0.14)" },
    appointment: { label: "Sıcak müşteri", color: "#fbbf24", background: "rgba(251,191,36,0.14)" },
    contract_appointment: { label: "Çok sıcak", color: "#f97316", background: "rgba(249,115,22,0.14)" },
    approved: { label: "Onaylandı", color: "#4ade80", background: "rgba(74,222,128,0.14)" },
    paid: { label: "Satış tamamlandı", color: "#34d399", background: "rgba(52,211,153,0.14)" },
    not_approved: { label: "Kapandı", color: "#f87171", background: "rgba(248,113,113,0.14)" },
    wrong_number: { label: "Numara yanlış", color: "#94a3b8", background: "rgba(148,163,184,0.14)" },
    using: { label: "Kullanıyor", color: "#2dd4bf", background: "rgba(45,212,191,0.14)" },
  };
  return levels[status] || { label: "Yeni müşteri", color: "#94a3b8", background: "rgba(148,163,184,0.14)" };
}

function findDuplicateCustomer(customers, phone, excludeId) {
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 10) return null;
  return customers.find((customer) =>
    customer.id !== excludeId
    && [customer.phone, customer.phone_2].some((item) => normalizePhone(item) === normalizedPhone)
  ) || null;
}

function getUserStats(customers, userId) {
  const myCustomers = customers.filter((c) => c.assigned_employee === userId);
  return {
    total: myCustomers.length,
    called: myCustomers.filter((c) => c.status === "called").length,
    appointment: myCustomers.filter((c) => c.status === "appointment").length,
    negative: myCustomers.filter((c) => REP_NEGATIVE_CUSTOMER_STATUSES.has(c.status)).length,
    approved: myCustomers.filter((c) => c.approved).length,
    paid: myCustomers.filter((c) => c.payment_received).length,
  };
}

function isFreshAssignedCustomer(customer) {
  return Boolean(customer?.assigned_employee)
    && customer.status === "assigned"
    && customer.last_action_by !== customer.assigned_employee;
}

const FEMALE_FIRST_NAMES = new Set([
  "ada", "adile", "afra", "ahu", "alev", "aleyna", "asena", "asli", "asuman", "ayca", "aydan", "ayfer", "ayla", "aylin", "aynur", "ayse", "aysel", "aysen", "aysenur", "aysegul", "azra", "bahar", "banu", "begum", "belgin", "bengisu", "berfin", "beril", "betul", "beyza", "birgul", "burcu", "buse", "canan", "cansu", "ceyda", "ceylan", "cigdem", "damla", "defne", "derin", "didem", "dilara", "dilek", "doga", "duygu", "ece", "eda", "ela", "elif", "elvan", "emine", "esin", "esma", "esra", "evrim", "eylul", "ezgi", "fatma", "feride", "feyza", "filiz", "fulya", "funda", "gamze", "gaye", "gokce", "gonca", "gonul", "gul", "gulay", "gulbahar", "gulcan", "gulden", "guler", "gulin", "gulizar", "gulsah", "gulsen", "gulsum", "hacer", "handan", "hande", "hatice", "havva", "hayriye", "hazal", "hilal", "hulya", "ilayda", "ilknur", "ipek", "irem", "isil", "jale", "kadriye", "kamile", "kardelen", "kevser", "kubra", "lale", "lamia", "leyla", "melda", "melek", "melike", "melis", "melisa", "meral", "merve", "meryem", "mine", "muge", "nalan", "nazan", "nazife", "nazli", "neslihan", "nevin", "nida", "nil", "nilay", "nilufer", "nisa", "nur", "nuran", "nurgul", "nursel", "nursena", "oya", "ozge", "ozlem", "pelin", "pinar", "rabia", "rana", "reyhan", "ruya", "sabahat", "safiye", "seda", "sedef", "selda", "selen", "selin", "selma", "sema", "semra", "senay", "serap", "sevda", "sevgi", "sevil", "sevim", "seyma", "sibel", "sinem", "songul", "sukran", "sule", "sumeyra", "tuba", "tugba", "tulin", "turkan", "ulku", "yasemin", "yagmur", "yaren", "yeliz", "yesim", "yildiz", "zeliha", "zerrin", "zehra", "zeynep", "zumra",
]);
const MALE_FIRST_NAMES = new Set([
  "abdullah", "abdurrahman", "abidin", "adem", "adnan", "ahmet", "akin", "akif", "alican", "ali", "alparslan", "alper", "alperen", "alp", "arda", "arif", "atilla", "aydin", "ayhan", "bahadir", "baran", "baris", "batuhan", "bayram", "bedirhan", "bekir", "berat", "berkan", "bektas", "bilal", "bora", "bulent", "burak", "burhan", "cagdas", "caglar", "can", "caner", "celal", "cem", "cemal", "cengiz", "cihan", "coskun", "cuneyt", "davut", "dogan", "doruk", "efe", "ekrem", "emin", "emir", "emrah", "emre", "enes", "engin", "ercan", "erdem", "erdogan", "erhan", "erkan", "erol", "ersin", "ertan", "ertugrul", "eyup", "faruk", "fatih", "ferdi", "ferhat", "fevzi", "fikret", "firat", "furkan", "galip", "gokay", "gokhan", "gorkem", "gursel", "hakan", "halil", "halit", "hamdi", "hamza", "harun", "hasan", "haydar", "hikmet", "huseyin", "ibrahim", "ilhami", "ilhan", "ilker", "ilyas", "irfan", "isa", "iskender", "ismail", "kadir", "kaan", "kamil", "kemal", "kerem", "kivanc", "koray", "kubilay", "levent", "lokman", "mahmut", "melih", "mehmet", "mesut", "metin", "mert", "muhammed", "murat", "musa", "mustafa", "naci", "namik", "nedim", "necip", "nevzat", "nihat", "nurullah", "oguz", "oguzhan", "oktay", "okan", "omer", "onur", "orhan", "osman", "ozan", "ozcan", "ramazan", "rasim", "recep", "ridvan", "riza", "saban", "sadi", "sahin", "sait", "salih", "samet", "sedat", "selcuk", "serdar", "serhat", "serkan", "seyfettin", "sinan", "sukru", "suleyman", "tahir", "talha", "tarik", "tayfun", "tekin", "teoman", "tolga", "tuncay", "turan", "ufuk", "ugur", "umit", "veli", "volkan", "yasin", "yavuz", "yilmaz", "yunus", "yusuf", "zafer", "zeki",
]);

function normalizeTurkishName(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z]/g, "");
}

function inferCustomerGender(customer) {
  const nameParts = String(customer?.first_name || "").split(/\s+/).map(normalizeTurkishName).filter(Boolean);
  const femaleMatches = nameParts.filter((name) => FEMALE_FIRST_NAMES.has(name)).length;
  const maleMatches = nameParts.filter((name) => MALE_FIRST_NAMES.has(name)).length;
  if (femaleMatches > maleMatches) return "female";
  if (maleMatches > femaleMatches) return "male";
  return "unknown";
}

function customerMatchesSearch(customer, term) {
  const query = normalizeCustomerSearch(term);
  if (!query) return true;

  const numericQuery = isNumericCustomerSearch(term);
  if (numericQuery) {
    const rawDigits = digitsOnly(term);
    const phoneQuery = normalizePhone(term);
    return [customer.phone, customer.phone_2].some((phone) => normalizePhone(phone).includes(phoneQuery))
      || digitsOnly(customer.tc_no).includes(rawDigits);
  }

  return `${customer.first_name || ""} ${customer.last_name || ""} ${customer.email || ""} ${customer.phone || ""} ${customer.phone_2 || ""} ${customer.tc_no || ""} ${customer.batch_name || ""}`
    .toLocaleLowerCase("tr-TR")
    .includes(query);
}

function getDataStats(customers) {
  const grouped = customers.reduce((result, customer) => {
    const name = customer.batch_name || "Manuel kayıt";
    if (!result[name]) result[name] = { name, total: 0, appointment: 0, paid: 0, wrongNumber: 0 };
    result[name].total += 1;
    if (["appointment", "contract_appointment"].includes(customer.status)) result[name].appointment += 1;
    if (customer.status === "paid") result[name].paid += 1;
    if (customer.status === "wrong_number") result[name].wrongNumber += 1;
    return result;
  }, {});

  return Object.values(grouped).sort((a, b) => b.paid - a.paid || b.appointment - a.appointment || b.total - a.total);
}

function parseExcelInWorker(buffer, fileName, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./workers/excelImport.worker.js", import.meta.url), {
      type: "module",
    });

    const cleanup = () => worker.terminate();
    worker.onmessage = (event) => {
      const { type } = event.data || {};
      if (type === "progress") {
        onProgress?.(event.data.current, event.data.total);
        return;
      }
      cleanup();
      if (type === "result") {
        resolve(event.data.result);
        return;
      }
      reject(new Error(event.data.message || "Excel işlenemedi."));
    };
    worker.onerror = (error) => {
      cleanup();
      reject(error);
    };

    worker.postMessage({ buffer, fileName }, [buffer]);
  });
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("OSS CRM render error", error, info);
  }

  clearSessionAndReload = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // If sign out fails, still clear local app state and reload.
    }
    clearSessionStarted();
    clearLegacyLocalAuthStorage();
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={errorFallbackPage}>
        <div style={errorFallbackCard}>
          <div style={brandBadge}>OSS CONTROL CENTER</div>
          <h1 style={errorFallbackTitle}>Panel güvenli moda geçti</h1>
          <p style={errorFallbackText}>
            Sayfa açılırken bir hata yakalandı. Beyaz ekran yerine buradan yenileyebilir veya oturumu sıfırlayıp tekrar giriş yapabilirsin.
          </p>
          <code style={errorFallbackCode}>{this.state.error?.message || "Bilinmeyen ekran hatası"}</code>
          <div style={errorFallbackActions}>
            <button type="button" style={primaryButton} onClick={() => window.location.reload()}>Sayfayı yenile</button>
            <button type="button" style={{ ...deleteAllButton, minHeight: 44 }} onClick={this.clearSessionAndReload}>Oturumu sıfırla</button>
          </div>
        </div>
      </div>
    );
  }
}

function App() {
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [profileForm, setProfileForm] = useState({
    full_name: "",
    phone: "",
    avatar_url: "",
    availability_status: "online",
  });
  const [newPassword, setNewPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [customers, setCustomers] = useState([]);
  const [customerLogs, setCustomerLogs] = useState([]);
  const [customerLogsLoading, setCustomerLogsLoading] = useState(false);
  const [customerCalls, setCustomerCalls] = useState([]);
  const [customerCallsLoading, setCustomerCallsLoading] = useState(false);
  const [customerSmsLogs, setCustomerSmsLogs] = useState([]);
  const [customerSmsLogsLoading, setCustomerSmsLogsLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedCustomerAccess, setSelectedCustomerAccess] = useState({ readOnly: false, callId: "", reason: "" });
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkEmployee, setBulkEmployee] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [activePage, setActivePage] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [customerSummary, setCustomerSummary] = useState(null);
  const [ownCustomerSummary, setOwnCustomerSummary] = useState(null);
  const [ownCustomerSummaryError, setOwnCustomerSummaryError] = useState("");
  const [bossLiveReport, setBossLiveReport] = useState(null);
  const [bossLiveReportError, setBossLiveReportError] = useState("");
  const [customerDataVersion, setCustomerDataVersion] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [lastImportSummary, setLastImportSummary] = useState(null);
  const [cleaningData, setCleaningData] = useState(false);
  const [cleanProgress, setCleanProgress] = useState(null);
  const [lastCleanSummary, setLastCleanSummary] = useState(null);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    phone_2: "",
    tc_no: "",
    appointment_date: "",
    info_note: "",
    batch_name: "",
    batch_page: "",
  });
  const [staffForm, setStaffForm] = useState({
    id: "",
    email: "",
    full_name: "",
    role: "employee",
  });

  const [messages, setMessages] = useState([]);
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [messageTarget, setMessageTarget] = useState("general");
  const [messageBody, setMessageBody] = useState("");
  const [messageAttachment, setMessageAttachment] = useState(null);
  const [replyToMessage, setReplyToMessage] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messagingError, setMessagingError] = useState("");

  const [myNotes, setMyNotes] = useState([]);
  const [myNoteBody, setMyNoteBody] = useState("");
  const [myNotesLoading, setMyNotesLoading] = useState(false);
  const [myNotesError, setMyNotesError] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [systemToast, setSystemToast] = useState(null);
  const [messageNotices, setMessageNotices] = useState([]);
  const [appointmentCustomers, setAppointmentCustomers] = useState([]);
  const [appointmentNotices, setAppointmentNotices] = useState([]);
  const [callNotice, setCallNotice] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  const toastTimerRef = useRef(null);
  const customerLogsRequestRef = useRef(0);
  const customerCallsRequestRef = useRef(0);
  const customerSmsLogsRequestRef = useRef(0);
  const dismissedAppointmentNoticeIdsRef = useRef(new Set());
  const announcedAppointmentNoticeIdsRef = useRef(new Set());
  const dismissedCallNoticeIdsRef = useRef(new Set());
  const announcedCallNoticeIdsRef = useRef(new Set());
  const appointmentAudioContextRef = useRef(null);
  const selectedCustomerRelatedIdsRef = useRef(new Set());
  const usersRef = useRef([]);
  const customersRef = useRef([]);
  const selectedCustomerAccessRef = useRef({ readOnly: false, callId: "", reason: "" });
  const [saleCelebration, setSaleCelebration] = useState(null);
  const summaryProfileId = profile?.id || "";

  useEffect(() => {
    selectedCustomerAccessRef.current = selectedCustomerAccess;
  }, [selectedCustomerAccess]);

  useEffect(() => {
    let cancelled = false;
    let currentVersion = "";

    try {
      currentVersion = window.sessionStorage.getItem(APP_VERSION_STORAGE_KEY) || "";
    } catch {
      currentVersion = "";
    }

    async function checkAppVersion() {
      try {
        const response = await fetch(`/app-version.json?ts=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;

        const data = await response.json();
        const nextVersion = data?.version || data?.commit;
        if (cancelled || !nextVersion) return;

        if (!currentVersion) {
          currentVersion = nextVersion;
          window.sessionStorage.setItem(APP_VERSION_STORAGE_KEY, nextVersion);
          return;
        }

        if (currentVersion !== nextVersion) {
          window.sessionStorage.setItem(APP_VERSION_STORAGE_KEY, nextVersion);
          window.location.reload();
        }
      } catch {
        // Version checks are best effort; the CRM should keep working if the file is unavailable.
      }
    }

    function checkWhenVisible() {
      if (document.visibilityState === "visible") checkAppVersion();
    }

    checkAppVersion();
    const timer = window.setInterval(checkAppVersion, APP_VERSION_CHECK_INTERVAL);
    window.addEventListener("focus", checkAppVersion);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", checkAppVersion);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function restoreSession() {
      if (supabaseConfigMissing) {
        if (mounted) setAuthReady(true);
        return;
      }

      try {
        clearLegacyLocalAuthStorage();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const session = sessionData.session;
        if (session && isSessionTooOld()) {
          await supabase.auth.signOut();
          clearSessionStarted();
          return;
        }

        const sessionUser = session?.user;
        if (!sessionUser) return;

        const { data: userProfile, error: profileError } = await runWithRetry(() =>
          supabase.from("profiles").select("*").eq("id", sessionUser.id).maybeSingle()
        );

        if (profileError || !userProfile || userProfile.is_active === false) {
          await supabase.auth.signOut();
          clearSessionStarted();
          return;
        }

        const { data: restoredUsers, error: usersError } = await runWithRetry(() =>
          supabase
            .from("profiles")
            .select("*")
            .eq("is_active", true)
            .order("created_at", { ascending: false })
        );
        if (usersError) throw usersError;

        if (!mounted) return;

        setProfile(userProfile);
        setProfileForm({
          full_name: userProfile.full_name || "",
          phone: userProfile.phone || "",
          avatar_url: userProfile.avatar_url || "",
          availability_status: userProfile.availability_status || "online",
        });
        setActivePage(userProfile.role === "employee" ? "today_work" : "dashboard");
        setUsers(restoredUsers || []);
        await loadUserNotes({
          userId: userProfile.id,
          setMyNotes,
          setMyNotesLoading,
          setMyNotesError,
        });
        loadCustomers(userProfile);
      } catch (error) {
        if (mounted) console.error("Oturum geri yüklenemedi:", error);
      } finally {
        if (mounted) setAuthReady(true);
      }
    }

    restoreSession();
    return () => {
      mounted = false;
    };
  // Session restoration runs once on app boot; customer loading is intentionally kicked off after profile hydration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!profile || supabaseConfigMissing) return undefined;
    let cancelled = false;

    async function enforceSessionAge() {
      if (!isSessionTooOld()) return;
      await supabase.auth.signOut();
      clearSessionStarted();
      clearLegacyLocalAuthStorage();
      if (cancelled) return;
      resetAuthenticatedState();
      showSystemToast("Oturum suresi doldu. Lutfen tekrar giris yap.", "warning");
    }

    const timer = window.setInterval(enforceSessionAge, SESSION_CHECK_INTERVAL);
    window.addEventListener("focus", enforceSessionAge);
    document.addEventListener("visibilitychange", enforceSessionAge);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", enforceSessionAge);
      document.removeEventListener("visibilitychange", enforceSessionAge);
    };
  }, [profile]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    customersRef.current = customers;
  }, [customers]);

  useEffect(() => {
    if (!summaryProfileId) return undefined;

    let cancelled = false;

    async function refreshCustomerSummary() {
      const { data, error } = await runWithRetry(() => supabase.rpc("crm_customer_summary"), 2);
      if (cancelled) return;
      if (error) {
        console.error("Musteri ozeti okunamadi:", error);
        if (["employee", "manager"].includes(profile?.role)) {
          setOwnCustomerSummaryError("Rep rapor özeti okunamadı: " + (error?.message || "Bilinmeyen hata"));
        }
        return;
      }
      setCustomerSummary(data || {});
      if (["employee", "manager"].includes(profile?.role)) {
        setOwnCustomerSummary(data || {});
        setOwnCustomerSummaryError("");
      }
    }

    const timer = window.setTimeout(refreshCustomerSummary, 250);
    const reconcileTimer = window.setInterval(refreshCustomerSummary, REP_MONITOR_RECONCILE_INTERVAL);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(reconcileTimer);
    };
  }, [summaryProfileId, profile?.role, customerDataVersion]);

  useEffect(() => {
    if (!["boss", "manager"].includes(profile?.role)) return undefined;

    let cancelled = false;
    async function refreshBossLiveReport() {
      const { data, error } = await runWithRetry(() => supabase.rpc("crm_live_reporting"), 2);
      if (cancelled) return;
      if (error) {
        const setupMissing = error.code === "PGRST202" || error.message?.includes("crm_live_reporting");
        setBossLiveReportError(setupMissing
          ? "Eksiksiz canlı rapor için Supabase SQL Editor'da LIVE_REPORTING.sql dosyasını bir kez çalıştır."
          : "Canlı rapor özeti okunamadı: " + error.message);
        return;
      }
      setBossLiveReport(data || null);
      setBossLiveReportError("");
    }

    const timer = window.setTimeout(refreshBossLiveReport, 300);
    const reconcileTimer = window.setInterval(refreshBossLiveReport, REP_MONITOR_RECONCILE_INTERVAL);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(reconcileTimer);
    };
  }, [profile, customerDataVersion]);

  useEffect(() => {
    if (!["boss", "manager"].includes(profile?.role)) return undefined;
    const profileChannel = supabase
      .channel(`crm-profiles-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadUsers())
      .subscribe();
    return () => supabase.removeChannel(profileChannel);
  }, [profile]);

  useEffect(() => {
    if (!profile) return undefined;

    const canSeeAllCustomers = ["boss", "manager"].includes(profile.role);
    const channel = supabase.channel(`crm-customers-${profile.id}`);

    function handleCustomerChange(payload) {
      if (payload.eventType === "DELETE") {
        removeCustomerRows(payload.old?.id);
        setCustomerDataVersion((version) => version + 1);
        return;
      }

      const customer = payload.new;
      if (!customer?.id) return;

      if (canSeeAllCustomers || customer.assigned_employee === profile.id) {
        upsertCustomerRows(customer);
        setCustomerDataVersion((version) => version + 1);
        if (!canSeeAllCustomers && customer.assigned_employee === profile.id && customer.last_action_by !== profile.id) {
          showSystemToast("Yeni mÃ¼ÅŸteri atandÄ±");
        }
      } else {
        removeCustomerRows(customer.id);
      }
    }

    if (canSeeAllCustomers) {
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "customers" }, handleCustomerChange)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "customers" }, handleCustomerChange)
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "customers" }, handleCustomerChange);
    } else {
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "customers", filter: `assigned_employee=eq.${profile.id}` }, handleCustomerChange)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "customers", filter: `assigned_employee=eq.${profile.id}` }, handleCustomerChange);
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile]);

  useEffect(() => {
    if (!profile) return undefined;
    let cancelled = false;

    async function loadAppointmentCustomers(showWarnings = false) {
      const rows = [];
      try {
        for (let from = 0; !cancelled; from += REP_MONITOR_PAGE_SIZE) {
          let query = supabase
            .from("customers")
            .select(CUSTOMER_SELECT_COLUMNS)
            .in("status", CALENDAR_REMINDER_STATUSES)
            .not("appointment_date", "is", null)
            .order("appointment_date", { ascending: true, nullsFirst: false })
            .range(from, from + REP_MONITOR_PAGE_SIZE - 1);
          if (profile.role === "employee") {
            query = query.eq("assigned_employee", profile.id);
          }
          const { data, error } = await runWithRetry(() => query, 3);
          if (error) throw error;
          const page = data || [];
          rows.push(...page);
          if (page.length < REP_MONITOR_PAGE_SIZE) break;
        }
        if (!cancelled) {
          setAppointmentCustomers(sortAppointmentCustomers(mergeCustomersById(rows)));
        }
      } catch (error) {
        if (!cancelled && showWarnings) {
          showSystemToast("Randevu takvimi eksiksiz okunamadi: " + (error.message || "Baglanti hatasi"), "warning");
        }
      }
    }

    loadAppointmentCustomers(true);
    const reconcileTimer = window.setInterval(() => loadAppointmentCustomers(false), APPOINTMENT_RECONCILE_INTERVAL);
    const customerChannel = supabase
      .channel(`crm-appointments-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, () => {
        window.setTimeout(() => loadAppointmentCustomers(false), 250);
      })
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(reconcileTimer);
      supabase.removeChannel(customerChannel);
    };
  }, [profile]);

  useEffect(() => {
    if (!profile) return undefined;

    function refreshAppointmentNotices() {
      const now = Date.now();
      const upcomingNotices = appointmentCustomers
        .filter((customer) => customer.appointment_date && APPOINTMENT_REMINDER_STATUSES.includes(customer.status))
        .map((customer) => {
          const appointmentTime = new Date(customer.appointment_date).getTime();
          const remainingMs = appointmentTime - now;
          if (remainingMs <= 0 || remainingMs > APPOINTMENT_DAY_ALERT_MS) return null;
          const level = remainingMs <= APPOINTMENT_SOON_ALERT_MS ? "soon" : "day";
          const id = `${customer.id}-${level}-${customer.appointment_date}`;
          if (dismissedAppointmentNoticeIdsRef.current.has(id)) return null;
          const rep = usersRef.current.find((user) => user.id === customer.assigned_employee);
          const repName = rep?.full_name || rep?.email || "Atanmamis rep";
          const customerName = customerFullName(customer);
          const title = level === "soon" ? "Randevu yaklasiyor" : "Yarin / gun ici randevu";
          const body = `${formatDateTime(customer.appointment_date)} · ${customerName} · ${repName}`;
          return { id, level, customer, title, body, appointmentTime, repName };
        })
        .filter(Boolean)
        .sort((a, b) => a.appointmentTime - b.appointmentTime)
        .slice(0, 5);

      setAppointmentNotices(upcomingNotices);
      upcomingNotices.forEach(announceAppointmentNotice);
    }

    refreshAppointmentNotices();
    const timer = window.setInterval(refreshAppointmentNotices, 60_000);
    return () => window.clearInterval(timer);
  // Notification functions intentionally use the latest refs and stable setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, appointmentCustomers]);

  useEffect(() => {
    if (!profile) return undefined;
    let mounted = true;

    async function refreshMessages() {
      const { data, error } = await supabase
        .from("app_messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(500);

      if (!mounted) return;
      if (error) {
        setMessagingError("Mesajlaşma kurulumu için SQL dosyasını Supabase'te çalıştır.");
        return;
      }
      setMessagingError("");
      setMessages(data || []);
    }

    refreshMessages();
    function announceIncomingMessage(message) {
      if (!message || message.sender_id === profile.id) return;
      if (message.recipient_id && message.recipient_id !== profile.id) return;

      const sender = usersRef.current.find((user) => user.id === message.sender_id);
      const isGeneralMessage = !message.recipient_id;
      const senderName = sender?.full_name || sender?.email || "Bir çalışan";
      const rawBody = message.body || message.attachment_name || "Yeni mesaj";
      const notice = {
        id: message.id || `${Date.now()}-${Math.random()}`,
        title: isGeneralMessage ? "Ofis Genel Kanalı" : senderName,
        body: isGeneralMessage ? `${senderName}: ${rawBody}` : rawBody,
        target: message.recipient_id ? message.sender_id : "general",
        tone: isGeneralMessage ? "broadcast" : "direct",
      };
      setMessageNotices((current) => [...current.filter((item) => item.id !== notice.id), notice].slice(-4));
      window.setTimeout(() => setMessageNotices((current) => current.filter((item) => item.id !== notice.id)), isGeneralMessage ? 4000 : 7000);
      playMessageNoticeSound(isGeneralMessage);

      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const browserNotice = new Notification(`OSS CRM · ${notice.title}`, {
          body: notice.body.slice(0, 180),
          icon: "/oss-center-mark.png",
          tag: `crm-message-${notice.id}`,
        });
        browserNotice.onclick = () => {
          window.focus();
          setMessageTarget(notice.target);
          setActivePage("messages");
          browserNotice.close();
        };
      }
    }

    const channel = supabase
      .channel(`crm-messages-${profile.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "app_messages" }, (payload) => {
        announceIncomingMessage(payload.new);
        refreshMessages();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "app_messages" }, refreshMessages)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "app_messages" }, refreshMessages)
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [profile]);

  useEffect(() => {
    if (!profile || messageTarget === "general") return undefined;
    const hasUnread = messages.some((message) =>
      message.sender_id === messageTarget
      && message.recipient_id === profile.id
      && !message.read_at
    );

    if (!hasUnread) return undefined;
    let cancelled = false;

    (async () => {
      await supabase.rpc("mark_messages_read", { p_sender_id: messageTarget });
      if (cancelled) return;
      setMessages((current) => current.map((message) =>
        message.sender_id === messageTarget && message.recipient_id === profile.id
          ? { ...message, read_at: message.read_at || new Date().toISOString() }
          : message
      ));
    })();

    return () => {
      cancelled = true;
    };
  }, [profile, messageTarget, messages]);

  useEffect(() => {
    if (!profile) return undefined;
    const presenceChannel = supabase.channel("office-presence", {
      config: { presence: { key: profile.id } },
    });

    presenceChannel
      .on("presence", { event: "sync" }, () => {
        setOnlineUserIds(Object.keys(presenceChannel.presenceState()));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presenceChannel.track({ user_id: profile.id, online_at: new Date().toISOString() });
        }
      });

    return () => {
      supabase.removeChannel(presenceChannel);
    };
  }, [profile]);

  useEffect(() => {
    if (!profile) return undefined;
    const callChannel = supabase
      .channel(`crm-call-events-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_sessions" }, async (payload) => {
        const call = payload.new?.id ? payload.new : payload.old;
        const canMonitorAllCalls = ["boss", "manager"].includes(profile.role);
        if (!call?.id || (!canMonitorAllCalls && call.profile_id !== profile.id)) return;
        const callAccess = selectedCustomerAccessRef.current;
        if (
          callAccess?.readOnly
          && callAccess.callId
          && String(callAccess.callId) === String(call.id)
          && !isLiveCallForNotice(call)
        ) {
          closeCustomerModal();
          showSystemToast("Çağrı kapandığı için bilgi amaçlı müşteri kartı kapatıldı.", "warning");
        }
        const customer = customersRef.current.find((item) =>
          item.id === call.customer_id
          || [item.phone, item.phone_2].some((phone) => normalizePhone(phone) === normalizePhone(call.phone))
        );
        const selectedCustomerMatches = selectedCustomer && (
          String(selectedCustomer.id) === String(call.customer_id)
          || [selectedCustomer.phone, selectedCustomer.phone_2]
            .some((phone) => normalizePhone(phone) && normalizePhone(phone) === normalizePhone(call.phone))
        );

        if (selectedCustomerMatches || (payload.eventType === "DELETE" && selectedCustomer)) {
          loadCustomerCalls(selectedCustomer);
        }
        const callBelongsToCurrentUser = String(call.profile_id || "") === String(profile.id || "");
        if (payload.eventType !== "DELETE" && callBelongsToCurrentUser && isLiveCallForNotice(call)) {
          const noticeId = callNoticeId(call);
          if (!dismissedCallNoticeIdsRef.current.has(noticeId) && !announcedCallNoticeIdsRef.current.has(noticeId)) {
            const resolvedCustomer = customer || await fetchCustomerForCall(call);
            const assignedUser = usersRef.current.find((user) => String(user.id) === String(call.profile_id));
            const ownerUser = resolvedCustomer?.assigned_employee
              ? usersRef.current.find((user) => String(user.id) === String(resolvedCustomer.assigned_employee))
              : null;
            const canOpenCustomer = Boolean(resolvedCustomer);
            const readOnlyCustomer = Boolean(resolvedCustomer?.assigned_employee)
              && String(resolvedCustomer.assigned_employee) !== String(profile.id)
              && !["boss", "manager"].includes(profile.role);
            const notice = {
              id: noticeId,
              call,
              customer: resolvedCustomer,
              assignedUser,
              ownerUser,
              canOpenCustomer,
              readOnlyCustomer,
              createdAt: new Date().toISOString(),
            };
            announcedCallNoticeIdsRef.current.add(noticeId);
            setCallNotice(notice);
            playCallNoticeSound();
            showSystemToast(resolvedCustomer
              ? `${call.direction === "incoming" ? "Gelen" : "Giden"} çağrı: ${customerFullName(resolvedCustomer)}`
              : `${call.direction === "incoming" ? "Gelen" : "Giden"} çağrı: ${formatPhoneDisplay(call.phone)}`, "warning");
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(callChannel);
    };
  // The loaders intentionally use the latest customer refs; resubscribing on every render would duplicate channels.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, selectedCustomer]);

  useEffect(() => {
    if (!profile || !selectedCustomer) return undefined;
    const logChannel = supabase
      .channel(`crm-customer-detail-logs-${profile.id}-${selectedCustomer.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_logs" }, (payload) => {
        const log = payload.new?.id ? payload.new : payload.old;
        if (!log?.customer_id || !selectedCustomerRelatedIdsRef.current.has(String(log.customer_id))) return;
        loadCustomerLogs(selectedCustomer);
      })
      .subscribe();
    return () => supabase.removeChannel(logChannel);
  // The selected customer's related IDs are hydrated by loadCustomerLogs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, selectedCustomer]);

  useEffect(() => {
    if (!profile || !selectedCustomer) return undefined;
    const phones = [selectedCustomer.phone, selectedCustomer.phone_2].map(normalizePhone).filter(Boolean);
    const smsChannel = supabase
      .channel(`crm-customer-detail-sms-${profile.id}-${selectedCustomer.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sms_logs" }, (payload) => {
        const log = payload.new?.id ? payload.new : payload.old;
        if (!log?.phone) return;
        if (!phones.includes(normalizePhone(log.phone))) return;
        loadCustomerSmsLogs(selectedCustomer);
      })
      .subscribe();
    return () => supabase.removeChannel(smsChannel);
  // The loader intentionally uses the selected customer snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, selectedCustomer]);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  function showSystemToast(message, tone = "success") {
    setSystemToast({ message, tone });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setSystemToast(null), 2500);
  }

  function callNoticeId(call) {
    return String(call?.external_call_id || call?.call_uuid || call?.id || "");
  }

  function isLiveCallForNotice(call) {
    if (!call?.id || call.ended_at) return false;
    return call.direction === "incoming" && ["ringing", "answered"].includes(call.status);
  }

  async function fetchCustomerForCall(call) {
    if (!call) return null;
    if (call.customer_id) {
      const cachedById = customersRef.current.find((customer) => String(customer.id) === String(call.customer_id));
      if (cachedById) return cachedById;
      const { data } = await runWithRetry(() => supabase
        .from("customers")
        .select(CUSTOMER_SELECT_COLUMNS)
        .eq("id", call.customer_id)
        .maybeSingle(), 1);
      if (data) return data;
    }
    const callPhone = normalizePhone(call.phone);
    if (!callPhone) return null;
    const cachedByPhone = customersRef.current.find((customer) =>
      [customer.phone, customer.phone_2].some((phone) => normalizePhone(phone) === callPhone)
    );
    if (cachedByPhone) return cachedByPhone;
    return null;
  }

  function dismissCallNotice(noticeId) {
    dismissedCallNoticeIdsRef.current.add(noticeId);
    setCallNotice((current) => current?.id === noticeId ? null : current);
  }

  function openCallNoticeCustomer(notice) {
    if (!notice?.customer || !notice.canOpenCustomer) return;
    loadMessageHistoryForCustomer(notice.customer, {
      readOnly: notice.readOnlyCustomer,
      callId: notice.call?.id || "",
      reason: notice.readOnlyCustomer
        ? `Bu müşteri ${notice.ownerUser?.full_name || notice.ownerUser?.email || "başka rep"} üzerinde. Çağrı sana düştüğü için kart sadece bu çağrı için bilgi amaçlı açıldı.`
        : "",
    });
    dismissCallNotice(notice.id);
  }

  function playCallNoticeSound() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = appointmentAudioContextRef.current || new AudioContextClass();
      appointmentAudioContextRef.current = audioContext;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(740, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(980, audioContext.currentTime + 0.12);
      oscillator.frequency.setValueAtTime(740, audioContext.currentTime + 0.24);
      gain.gain.setValueAtTime(0.001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, audioContext.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.55);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.58);
    } catch {
      // Browser audio can be blocked until the user interacts with the page.
    }
  }

  function playMessageNoticeSound(isBroadcast = false) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = appointmentAudioContextRef.current || new AudioContextClass();
      appointmentAudioContextRef.current = audioContext;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = isBroadcast ? "square" : "sine";
      oscillator.frequency.setValueAtTime(isBroadcast ? 620 : 720, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(isBroadcast ? 820 : 880, audioContext.currentTime + 0.1);
      gain.gain.setValueAtTime(0.001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(isBroadcast ? 0.16 : 0.1, audioContext.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.34);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.36);
    } catch {
      // Browser audio can be blocked until the user interacts with the page.
    }
  }

  function dismissAppointmentNotice(noticeId) {
    dismissedAppointmentNoticeIdsRef.current.add(noticeId);
    setAppointmentNotices((current) => current.filter((notice) => notice.id !== noticeId));
  }

  function playAppointmentReminderSound() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = appointmentAudioContextRef.current || new AudioContextClass();
      appointmentAudioContextRef.current = audioContext;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(660, audioContext.currentTime + 0.16);
      gain.gain.setValueAtTime(0.001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.42);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.45);
    } catch {
      // Browser audio can be blocked until the user interacts with the page.
    }
  }

  function announceAppointmentNotice(notice) {
    if (announcedAppointmentNoticeIdsRef.current.has(notice.id)) return;
    announcedAppointmentNoticeIdsRef.current.add(notice.id);
    playAppointmentReminderSound();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const browserNotice = new Notification(`OSS CRM · ${notice.title}`, {
        body: notice.body,
        icon: "/oss-center-mark.png",
        tag: `crm-appointment-${notice.id}`,
      });
      browserNotice.onclick = () => {
        window.focus();
        setSelectedCustomer(notice.customer);
        loadMessageHistoryForCustomer(notice.customer);
        browserNotice.close();
      };
    }
  }

  function resetAuthenticatedState() {
    setProfile(null);
    setCustomers([]);
    setUsers([]);
    setCustomerLogs([]);
    setCustomerLogsLoading(false);
    setCustomerCalls([]);
    setCustomerCallsLoading(false);
    setCustomerSmsLogs([]);
    setCustomerSmsLogsLoading(false);
    setSelectedCustomer(null);
    setSelectedCustomerAccess({ readOnly: false, callId: "", reason: "" });
    setSelectedIds([]);
    setBulkEmployee("");
    setMessages([]);
    setMessageNotices([]);
    setAppointmentCustomers([]);
    setAppointmentNotices([]);
    setCallNotice(null);
    dismissedAppointmentNoticeIdsRef.current = new Set();
    announcedAppointmentNoticeIdsRef.current = new Set();
    dismissedCallNoticeIdsRef.current = new Set();
    announcedCallNoticeIdsRef.current = new Set();
    setMyNotes([]);
    setActivePage("dashboard");
    setCustomerFilter("all");
    setCustomerSummary(null);
    setOwnCustomerSummary(null);
    setOwnCustomerSummaryError("");
    setBossLiveReport(null);
    setBossLiveReportError("");
  }

  function upsertCustomerRows(rows) {
    const cleanRows = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
    if (cleanRows.length === 0) return;
    setCustomers((current) => {
      const customerMap = new Map(current.map((customer) => [String(customer.id), customer]));
      cleanRows.forEach((customer) => customerMap.set(String(customer.id), customer));
      return Array.from(customerMap.values()).sort((first, second) =>
        new Date(second.created_at || 0) - new Date(first.created_at || 0)
      );
    });
    setAppointmentCustomers((current) => {
      const customerMap = new Map(current.map((customer) => [String(customer.id), customer]));
      cleanRows.forEach((customer) => {
        const id = String(customer.id);
        if (isCalendarCustomer(customer)) {
          customerMap.set(id, { ...(customerMap.get(id) || {}), ...customer });
        } else {
          customerMap.delete(id);
        }
      });
      return sortAppointmentCustomers(Array.from(customerMap.values()));
    });
  }

  function removeCustomerRows(ids) {
    const idSet = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String));
    if (idSet.size === 0) return;
    setCustomers((current) => current.filter((customer) => !idSet.has(String(customer.id))));
    setAppointmentCustomers((current) => current.filter((customer) => !idSet.has(String(customer.id))));
  }

  async function enableMessageNotifications() {
    if (typeof Notification === "undefined") {
      showSystemToast("Bu tarayıcı masaüstü bildirimlerini desteklemiyor.", "warning");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    showSystemToast(permission === "granted" ? "Mesaj bildirimleri açıldı" : "Bildirim izni verilmedi", permission === "granted" ? "success" : "warning");
  }

  async function loadCustomers(activeProfile = profile) {
    const pageSize = CUSTOMER_PRELOAD_PAGE_SIZE;
    const initialPages = INITIAL_CUSTOMER_PAGES;
    const priorityStatuses = IMPORTANT_CUSTOMER_STATUSES;
    const shouldPreloadFollowUps = activeProfile?.role === "employee";

    try {
      const pageResults = [];
      let priorityCustomers = [];

      function mergeCustomerRows(rowGroups) {
        const customerMap = new Map();
        rowGroups.flat().forEach((customer) => {
          if (customer?.id) customerMap.set(String(customer.id), customer);
        });
        return Array.from(customerMap.values());
      }

      async function fetchCustomerPage(pageIndex) {
        const from = pageIndex * pageSize;
        const { data, error } = await runWithRetry(() =>
          supabase
            .from("customers")
            .select(CUSTOMER_SELECT_COLUMNS)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, from + pageSize - 1)
        );
        if (error) throw error;
        return data || [];
      }

      async function fetchPriorityFollowUps() {
        const priorityRows = [];
        for (let pageIndex = 0; pageIndex < MAX_PRIORITY_PRELOAD_PAGES; pageIndex += 1) {
          const from = pageIndex * pageSize;
          const { data, error } = await runWithRetry(() =>
            supabase
              .from("customers")
              .select(CUSTOMER_SELECT_COLUMNS)
              .in("status", priorityStatuses)
              .order("assigned_at", { ascending: false })
              .order("appointment_date", { ascending: true })
              .order("created_at", { ascending: false })
              .range(from, from + pageSize - 1)
          );
          if (error) throw error;
          const rows = data || [];
          priorityRows.push(...rows);
          if (rows.length < pageSize) break;
        }
        return priorityRows;
      }

      if (shouldPreloadFollowUps) {
        priorityCustomers = await fetchPriorityFollowUps();
        if (priorityCustomers.length) {
          setCustomers(priorityCustomers);
        }
      }

      const firstPages = await Promise.all(
        Array.from({ length: initialPages }, (_, pageIndex) => fetchCustomerPage(pageIndex))
      );

      firstPages.forEach((rows, pageIndex) => {
        pageResults[pageIndex] = rows;
      });
      const initialCustomers = mergeCustomerRows([priorityCustomers, pageResults.flat()]);
      setCustomers(initialCustomers);

    } catch {
      showSystemToast("Müşteri listesi arka planda kısmen yüklendi. Yenileme tekrar denenebilir.", "warning");
    }
  }

  async function loadUsers() {
    const { data, error } = await runWithRetry(() =>
      supabase
        .from("profiles")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
    );

    if (error) {
      alert("Kullanıcılar yüklenemedi: " + error.message);
      return;
    }

    setUsers(data || []);
  }

  async function login(event) {
    event.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        alert("Giriş hatası: " + error.message);
        return;
      }

      const { data: userProfile, error: profileError } = await runWithRetry(() =>
        supabase
          .from("profiles")
          .select("*")
          .eq("id", data.user.id)
          .maybeSingle()
      );

      if (profileError || !userProfile || userProfile.is_active === false) {
        await supabase.auth.signOut();
        clearSessionStarted();
        alert(userProfile?.is_active === false ? "Bu kullanıcı hesabı pasif durumda." : "Profil bulunamadı.");
        return;
      }

      markSessionStarted();
      clearLegacyLocalAuthStorage();
      setProfile(userProfile);
      setProfileForm({
        full_name: userProfile.full_name || "",
        phone: userProfile.phone || "",
        avatar_url: userProfile.avatar_url || "",
        availability_status: userProfile.availability_status || "online",
      });
      setActivePage(userProfile.role === "employee" ? "today_work" : "dashboard");
      await Promise.all([
        loadUsers(),
        loadUserNotes({
          userId: userProfile.id,
          setMyNotes,
          setMyNotesLoading,
          setMyNotesError,
        }),
      ]);
      loadCustomers(userProfile);
    } catch (error) {
      alert("Giriş sırasında bağlantı kurulamadı: " + (error.message || "Tekrar dene."));
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      alert("Çıkış yapılamadı: " + error.message);
      return;
    }
    clearSessionStarted();
    clearLegacyLocalAuthStorage();
    resetAuthenticatedState();
  }

  async function saveOwnProfile(event) {
    event.preventDefault();
    if (!profile) return;

    const payload = {
      full_name: profileForm.full_name.trim(),
      phone: profileForm.phone.trim(),
      avatar_url: profileForm.avatar_url || null,
      availability_status: profileForm.availability_status || "online",
      updated_at: new Date().toISOString(),
    };

    if (!payload.full_name) {
      alert("Ad soyad boş bırakılamaz.");
      return;
    }

    setSavingProfile(true);
    const { data, error } = await runWithRetry(() =>
      supabase.from("profiles").update(payload).eq("id", profile.id).select("*").single()
    );
    setSavingProfile(false);

    if (error) {
      alert("Profil kaydedilemedi: " + error.message);
      return;
    }

    setProfile(data);
    setUsers((current) => current.map((user) => user.id === data.id ? data : user));
    showSystemToast("Profil güncellendi");
  }

  async function uploadAvatar(event) {
    const file = event.target.files?.[0];
    if (!file || !profile) return;

    setUploadingAvatar(true);
    const path = `${profile.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (uploadError) {
      setUploadingAvatar(false);
      alert("Fotoğraf yüklenemedi: " + uploadError.message);
      return;
    }

    const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(path);
    const avatarUrl = publicData.publicUrl;
    const { error: profileError } = await runWithRetry(() =>
      supabase.from("profiles").update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() }).eq("id", profile.id)
    );
    setUploadingAvatar(false);

    if (profileError) {
      alert("Fotoğraf profil bilgisine eklenemedi: " + profileError.message);
      return;
    }

    setProfile((current) => ({ ...current, avatar_url: avatarUrl }));
    setProfileForm((current) => ({ ...current, avatar_url: avatarUrl }));
    setUsers((current) => current.map((user) => user.id === profile.id ? { ...user, avatar_url: avatarUrl } : user));
  }

  async function changePassword(event) {
    event.preventDefault();
    if (newPassword.length < 6) {
      alert("Yeni şifre en az 6 karakter olmalı.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      alert("Şifre değiştirilemedi: " + error.message);
      return;
    }
    setNewPassword("");
    showSystemToast("Şifre güncellendi");
  }

  async function updateCustomer(customerId, updates) {
    if (!profile) return false;
    const targetCustomer = selectedCustomer && String(selectedCustomer.id) === String(customerId)
      ? selectedCustomer
      : customers.find((customer) => String(customer.id) === String(customerId));
    let customerIdsToUpdate = [customerId];
    if (updates.status) {
      try {
        customerIdsToUpdate = await fetchRelatedCustomerIds(targetCustomer || customerId);
      } catch (relatedError) {
        alert("Musteri guncellenemedi: " + relatedError.message);
        return false;
      }
    }
    customerIdsToUpdate = [...new Set(customerIdsToUpdate.filter(Boolean))];
    if (customerIdsToUpdate.length === 0) {
      alert("Musteri guncellenemedi: secili musteri id bulunamadi.");
      return false;
    }
    const updateIdSet = new Set(customerIdsToUpdate.map(String));
    const beforeStatus = targetCustomer?.status || null;
    const becamePaid = updates.status === "paid" && beforeStatus !== "paid";

    const { count: updatedCount, error } = await runWithRetry(() =>
      supabase
        .from("customers")
        .update({ ...updates, last_action_by: profile.id }, { count: "exact" })
        .in("id", customerIdsToUpdate)
    );

    if (error) {
      const statusRuleError = error.code === "23514"
        || error.message?.includes("invalid input value for enum")
        || error.message?.includes("customers_status_check");
      alert(statusRuleError
        ? "Supabase musteri durumlari guncel degil. SQL Editor'da CUSTOMER_STATUS_UPGRADE.sql dosyasini bir kez calistir."
        : "Musteri guncellenemedi: " + error.message);
      return false;
    }

    if (updatedCount === 0) {
      alert("Musteri guncellenemedi: kayit bulunamadi veya bu islem icin yetki yok.");
      return false;
    }

    const { data: updatedCustomers } = await runWithRetry(() =>
      supabase
        .from("customers")
        .select(CUSTOMER_SELECT_COLUMNS)
        .in("id", customerIdsToUpdate)
    );

    const refreshedCustomers = updatedCustomers?.length
      ? updatedCustomers
      : customerIdsToUpdate.map((id) => {
          const currentCustomer = customers.find((customer) => String(customer.id) === String(id))
            || (String(targetCustomer?.id) === String(id) ? targetCustomer : null);
          return currentCustomer
            ? { ...currentCustomer, ...updates, last_action_by: profile.id }
            : null;
        }).filter(Boolean);

    const updatedCustomerMap = new Map(refreshedCustomers.map((customer) => [String(customer.id), customer]));

    upsertCustomerRows(refreshedCustomers);
    setSelectedIds((current) => current.filter((id) => !updateIdSet.has(String(id))));
    setSelectedCustomer((current) => {
      if (!current || !updateIdSet.has(String(current.id))) return current;
      return updatedCustomerMap.get(String(current.id)) || { ...current, ...updates, last_action_by: profile.id };
    });

    let logError;
    const logRows = customerIdsToUpdate.map((id) => {
      const beforeCustomer = customers.find((customer) => String(customer.id) === String(id)) || (String(targetCustomer?.id) === String(id) ? targetCustomer : null);
      return {
        customer_id: id,
        user_id: profile.id,
        old_status: beforeCustomer?.status || null,
        new_status: updates.status || beforeCustomer?.status || null,
        note: updates.info_note || "",
      };
    });

    try {
      ({ error: logError } = await supabase
        .from("customer_logs")
        .insert(logRows));
    } catch (requestError) {
      logError = requestError;
    }

    if (!logError) {
      const createdAt = new Date().toISOString();
      const visibleLogRows = logRows.map((row, index) => ({
        ...row,
        id: `tmp-${Date.now()}-${index}`,
        created_at: createdAt,
      }));
      setCustomerLogs((current) => [...visibleLogRows, ...current]);
    }

    if (becamePaid) {
      setSaleCelebration({
        name: `${selectedCustomer?.first_name || ""} ${selectedCustomer?.last_name || ""}`.trim() || "Musteri",
      });
    }

    showSystemToast("Kaydedildi");
    if (logError) {
      showSystemToast("Musteri kaydedildi, ancak gecmis yazilamadi.", "warning");
    }
    setCustomerDataVersion((version) => version + 1);
    return true;
  }

  function getRelatedCustomerIds(customerOrId) {
    const customerId = typeof customerOrId === "object" ? customerOrId?.id : customerOrId;
    const customer = typeof customerOrId === "object"
      ? customerOrId
      : customers.find((item) => String(item.id) === String(customerId));

    const relatedIds = [];
    const seenIds = new Set();
    function addRelatedId(id) {
      if (id === null || id === undefined || id === "") return;
      const key = String(id);
      if (seenIds.has(key)) return;
      seenIds.add(key);
      relatedIds.push(id);
    }

    addRelatedId(customerId);
    if (!customer) return relatedIds;

    const phones = [customer.phone, customer.phone_2].map(normalizePhone).filter(Boolean);
    customers.forEach((item) => {
      if (!item?.id) return;
      if (String(item.id) === String(customer.id)) {
        addRelatedId(item.id);
        return;
      }
      const itemPhones = [item.phone, item.phone_2].map(normalizePhone).filter(Boolean);
      if (phones.some((phone) => itemPhones.includes(phone))) addRelatedId(item.id);
    });

    return relatedIds;
  }

  async function fetchRelatedCustomerIds(customerOrId) {
    const customerId = typeof customerOrId === "object" ? customerOrId?.id : customerOrId;
    if (!customerId) return [];

    const { data, error } = await runWithRetry(
      () => supabase.rpc("crm_related_customer_ids", { p_customer_id: customerId }),
      2
    );

    if (error) {
      const setupMissing = error.code === "PGRST202" || error.message?.includes("crm_related_customer_ids");
      throw new Error(setupMissing
        ? "Supabase SQL Editor'da CUSTOMER_CRM_OPTIMIZATION.sql dosyasini bir kez calistir."
        : (error.message || "Iliskili musteri kartlari okunamadi."));
    }

    const relatedIds = (data || []).map((row) => row?.customer_id || row).filter(Boolean);
    return relatedIds.length > 0 ? relatedIds : [customerId];
  }

  async function loadCustomerLogs(customerOrId) {
    const requestId = customerLogsRequestRef.current + 1;
    customerLogsRequestRef.current = requestId;
    setCustomerLogsLoading(true);

    let relatedCustomerIds;
    try {
      relatedCustomerIds = await fetchRelatedCustomerIds(customerOrId);
    } catch {
      relatedCustomerIds = getRelatedCustomerIds(customerOrId);
    }

    if (relatedCustomerIds.length === 0) {
      selectedCustomerRelatedIdsRef.current = new Set();
      setCustomerLogs([]);
      setCustomerLogsLoading(false);
      return;
    }
    selectedCustomerRelatedIdsRef.current = new Set(relatedCustomerIds.map(String));

    const allLogs = [];
    let beforeId = null;
    let loadError = null;
    while (customerLogsRequestRef.current === requestId) {
      let query = supabase
        .from("customer_logs")
        .select("*")
        .in("customer_id", relatedCustomerIds)
        .order("id", { ascending: false })
        .limit(REP_MONITOR_PAGE_SIZE);
      if (beforeId !== null) query = query.lt("id", beforeId);
      const { data, error } = await runWithRetry(() => query, 3);
      if (error) {
        loadError = error;
        break;
      }
      const page = data || [];
      allLogs.push(...page);
      if (page.length < REP_MONITOR_PAGE_SIZE) break;
      beforeId = page[page.length - 1].id;
    }

    if (customerLogsRequestRef.current !== requestId) return;
    setCustomerLogsLoading(false);

    if (loadError) {
      setCustomerLogs([]);
      showSystemToast("Geçmiş okunamadı, kart yine de açıldı.", "warning");
      return;
    }

    setCustomerLogs(allLogs);
  }

  async function loadCustomerCalls(customerOrId) {
    const requestId = customerCallsRequestRef.current + 1;
    customerCallsRequestRef.current = requestId;
    const customer = typeof customerOrId === "object"
      ? customerOrId
      : customersRef.current.find((item) => item.id === customerOrId);
    const phones = [customer?.phone, customer?.phone_2].map(normalizePhone).filter(Boolean);
    if (phones.length === 0) {
      setCustomerCalls([]);
      setCustomerCallsLoading(false);
      return;
    }

    setCustomerCallsLoading(true);
    const allCalls = [];
    let loadError = null;
    for (let from = 0; customerCallsRequestRef.current === requestId; from += REP_MONITOR_PAGE_SIZE) {
      const { data, error } = await runWithRetry(() => supabase
        .from("call_sessions")
        .select("*")
        .in("phone", [...new Set(phones)])
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + REP_MONITOR_PAGE_SIZE - 1), 3);
      if (error) {
        loadError = error;
        break;
      }
      const page = data || [];
      allCalls.push(...page);
      if (page.length < REP_MONITOR_PAGE_SIZE) break;
    }
    if (customerCallsRequestRef.current !== requestId) return;
    setCustomerCallsLoading(false);
    setCustomerCalls(loadError ? [] : Array.from(
      new Map(allCalls.map((call) => [String(call.id), call])).values()
    ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    if (loadError && loadError.code !== "42P01") {
      showSystemToast("Arama geçmişi okunamadı.", "warning");
    }
  }

  async function loadCustomerSmsLogs(customerOrId) {
    const requestId = customerSmsLogsRequestRef.current + 1;
    customerSmsLogsRequestRef.current = requestId;
    const customer = typeof customerOrId === "object"
      ? customerOrId
      : customersRef.current.find((item) => item.id === customerOrId);
    const phones = [customer?.phone, customer?.phone_2]
      .map(normalizePhone)
      .filter(Boolean)
      .flatMap((phone) => [phone, `90${phone}`]);
    if (phones.length === 0) {
      setCustomerSmsLogs([]);
      setCustomerSmsLogsLoading(false);
      return;
    }

    setCustomerSmsLogsLoading(true);
    const allLogs = [];
    let loadError = null;
    for (let from = 0; customerSmsLogsRequestRef.current === requestId; from += REP_MONITOR_PAGE_SIZE) {
      const { data, error } = await runWithRetry(() => supabase
        .from("sms_logs")
        .select("*")
        .in("phone", [...new Set(phones)])
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + REP_MONITOR_PAGE_SIZE - 1), 3);
      if (error) {
        loadError = error;
        break;
      }
      const page = data || [];
      allLogs.push(...page);
      if (page.length < REP_MONITOR_PAGE_SIZE) break;
    }
    if (customerSmsLogsRequestRef.current !== requestId) return;
    setCustomerSmsLogsLoading(false);
    setCustomerSmsLogs(loadError ? [] : Array.from(
      new Map(allLogs.map((log) => [String(log.id), log])).values()
    ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    if (loadError && !["42P01", "PGRST205"].includes(loadError.code)) {
      showSystemToast("SMS gecmisi okunamadi.", "warning");
    }
  }

  async function importExcel(event) {
    const file = event.target.files?.[0];
    if (!file || !profile) return;

    try {
      setImporting(true);
      setImportProgress({ phase: "Excel okunuyor", current: 0, total: 0 });

      const buffer = await file.arrayBuffer();
      const parsed = await parseExcelInWorker(buffer, file.name, (current, total) => {
        setImportProgress({ phase: "Satırlar arka planda kontrol ediliyor", current, total });
      });
      const { sheetName, rejectedRows, duplicateRows = 0 } = parsed;
      const preparedRows = parsed.rows.map((row) => ({
        ...row,
        created_by: profile.id,
        last_action_by: profile.id,
      }));

      if (preparedRows.length === 0) {
        throw new Error(`Geçerli kayıt bulunamadı. ${rejectedRows} eksik/hatalı satır tespit edildi.`);
      }

      const confirmed = window.confirm(
        `'${sheetName}' sayfası kontrol edildi.\n\n`
        + `${preparedRows.length} benzersiz geçerli kayıt kontrol edilecek.\n`
        + `${rejectedRows} eksik ad/telefon satırı yüklenmeyecek.\n`
        + `${duplicateRows} dosya içi mükerrer satır atlandı.\n`
        + "Sistemde mevcut telefon veya TC numaraları yeni kart açmadan mevcut müşteriye data kaynağı olarak bağlanacak.\n\nDevam edilsin mi?"
      );
      if (!confirmed) return;

      let imported = 0;
      let matchedExisting = 0;
      let sourceRows = 0;
      let alreadyTracked = 0;
      let skipped = duplicateRows;
      const batchSize = 200;

      for (let i = 0; i < preparedRows.length; i += batchSize) {
        const chunk = preparedRows.slice(i, i + batchSize);
        setImportProgress({ phase: "Supabase'e kaydediliyor", current: i, total: preparedRows.length });
        const { data: importResult, error } = await runWithRetry(() =>
          supabase.rpc("crm_import_customers", { p_rows: chunk })
        );

        if (error) {
          const setupMissing = error.code === "PGRST202" || error.message?.includes("crm_import_customers");
          alert(setupMissing
            ? "Mükerrer engelleme kurulumu eksik. Supabase SQL Editor'da CUSTOMER_POOL_DEDUP_HARDENING.sql dosyasını bir kez çalıştır."
            : `Yükleme ${imported} müşteri sonrasında durdu: ${error.message}`);
          return;
        }

        imported += Number(importResult?.inserted) || 0;
        matchedExisting += Number(importResult?.matched_existing) || 0;
        sourceRows += Number(importResult?.source_rows) || 0;
        alreadyTracked += Number(importResult?.already_tracked) || 0;
        skipped += Number(importResult?.skipped) || 0;
        setImportProgress({ phase: "Supabase'e kaydediliyor", current: Math.min(i + chunk.length, preparedRows.length), total: preparedRows.length });
        await wait(25);
      }

      setCustomerDataVersion((version) => version + 1);

      setLastImportSummary({
        fileName: file.name,
        sheetName,
        checked: preparedRows.length,
        inserted: imported,
        matchedExisting,
        sourceRows,
        alreadyTracked,
        fileDuplicates: duplicateRows,
        skipped,
        rejectedRows,
      });
      showSystemToast(`Excel yüklendi: ${imported} yeni müşteri, ${matchedExisting} mevcut müşteriye bağlandı, ${sourceRows} yeni data kaynağı işlendi, ${alreadyTracked} zaten takipte, ${skipped} dosya içi/atlanan kayıt`);
      await loadCustomers();
    } catch (error) {
      alert("Excel okunamadı: " + error.message);
    } finally {
      setImporting(false);
      setImportProgress(null);
      event.target.value = "";
    }
  }

  async function cleanCustomerDataFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setCleaningData(true);
      setCleanProgress({ phase: "Data okunuyor", current: 0, total: 0 });

      const buffer = await file.arrayBuffer();
      const parsed = await parseExcelInWorker(buffer, file.name, (current, total) => {
        setCleanProgress({ phase: "Satırlar temizleniyor", current, total });
      });

      if (!parsed.rows.length) {
        throw new Error(`Temizlenecek geçerli kayıt bulunamadı. ${parsed.rejectedRows} eksik/hatalı satır tespit edildi.`);
      }

      const XLSX = await import("xlsx");
      const cleanedRows = parsed.rows.map((row) => ({
        "Ad Soyad": `${row.first_name || ""} ${row.last_name || ""}`.trim(),
        "Telefon": row.phone ? `0${row.phone}` : "",
        "Telefon 2": row.phone_2 ? `0${row.phone_2}` : "",
        "TC No": row.tc_no || "",
        "E-Posta": row.email || "",
        "Data": row.batch_name || file.name,
        "Excel Sayfası": row.source_extra?.sheet_name || parsed.sheetName || "",
        "Excel Satırı": row.batch_page || "",
        "Ek Bilgi": row.info_note || "",
      }));

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(cleanedRows);
      worksheet["!cols"] = [
        { wch: 34 },
        { wch: 14 },
        { wch: 14 },
        { wch: 13 },
        { wch: 26 },
        { wch: 32 },
        { wch: 18 },
        { wch: 12 },
        { wch: 48 },
      ];
      XLSX.utils.book_append_sheet(workbook, worksheet, "Temiz Data");

      const safeBaseName = file.name
        .replace(/\.[^.]+$/, "")
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        || "data";
      const outputName = `${safeBaseName}-TEMIZ-CRM.xlsx`;
      XLSX.writeFile(workbook, outputName);

      setLastCleanSummary({
        fileName: file.name,
        outputName,
        sheetName: parsed.sheetName,
        cleaned: cleanedRows.length,
        rejectedRows: parsed.rejectedRows,
        duplicateRows: parsed.duplicateRows || 0,
        secondPhones: cleanedRows.filter((row) => row["Telefon 2"]).length,
      });
      showSystemToast(`${cleanedRows.length.toLocaleString("tr-TR")} kayıt temizlendi ve Excel indirildi.`);
    } catch (error) {
      alert("Data temizlenemedi: " + error.message);
    } finally {
      setCleaningData(false);
      setCleanProgress(null);
      event.target.value = "";
    }
  }

  async function addCustomer(event) {
    event.preventDefault();
    if (!profile) return;

    const normalizedPhone = normalizePhone(form.phone);
    if (!/^5\d{9}$/.test(normalizedPhone)) {
      alert("Gecerli bir telefon numarasi gir.");
      return;
    }

    let duplicate = findDuplicateCustomer(customers, form.phone);
    if (!duplicate) {
      const { data: duplicateRows, error: duplicateError } = await runWithRetry(
        () => supabase
          .from("customers")
          .select("id,first_name,last_name")
          .eq("phone_key", normalizedPhone)
          .limit(1),
        2
      );
      if (duplicateError) {
        alert("Musteri kontrol edilemedi: " + duplicateError.message);
        return;
      }
      duplicate = duplicateRows?.[0] || null;
    }
    if (duplicate) {
      alert(`Bu telefon zaten ${duplicate.first_name || ""} ${duplicate.last_name || ""} adına kayıtlı.`);
      return;
    }

    const assignedToSelf = ["employee", "manager"].includes(profile.role);
    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: normalizedPhone,
      phone_2: normalizePhone(form.phone_2) || null,
      tc_no: form.tc_no.trim(),
      info_note: form.info_note.trim(),
      batch_name: form.batch_name.trim(),
      batch_page: form.batch_page ? Number(form.batch_page) : null,
      appointment_date: form.appointment_date || null,
      status: assignedToSelf ? "assigned" : "pool",
      assigned_employee: assignedToSelf ? profile.id : null,
      assigned_at: assignedToSelf ? new Date().toISOString() : null,
      approved: false,
      payment_received: false,
      created_by: profile.id,
      last_action_by: profile.id,
    };

    const { data, error } = await runWithRetry(() =>
      supabase.from("customers").insert(payload).select(CUSTOMER_SELECT_COLUMNS).single()
    );

    if (error) {
      const errorDetail = [error.message, error.details, error.hint, error.code].filter(Boolean).join(" ");
      alert("Müşteri eklenemedi: " + (errorDetail || "Bağlantı kurulamadı."));
      return;
    }

    setForm({
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      phone_2: "",
      tc_no: "",
      appointment_date: "",
      info_note: "",
      batch_name: "",
      batch_page: "",
    });

    upsertCustomerRows(data);
    setCustomerDataVersion((version) => version + 1);
    showSystemToast("Müşteri eklendi");
  }

  async function addStaff(event) {
    event.preventDefault();
    if (!profile) return;

    if (!staffForm.id.trim() || !staffForm.email.trim() || !staffForm.full_name.trim()) {
      alert("Auth UID, ad soyad ve e-posta zorunlu.");
      return;
    }

    const { error } = await runWithRetry(() =>
      supabase.from("profiles").insert({
        id: staffForm.id.trim(),
        email: staffForm.email.trim(),
        full_name: staffForm.full_name.trim(),
        role: staffForm.role,
        is_active: true,
        created_by: profile.id,
      })
    );

    if (error) {
      const isRlsError = error.code === "42501" || error.message?.includes("row-level security");
      alert(isRlsError
        ? "Kullanıcı ekleme yetkisi henüz kurulmamış. Supabase SQL Editor'da BOSS_PROFILE_MANAGEMENT.sql dosyasını bir kez çalıştır."
        : "Kullanıcı eklenemedi: " + (error.message || "Bağlantı kurulamadı."));
      return;
    }

    setStaffForm({ id: "", email: "", full_name: "", role: "employee" });
    showSystemToast("Kullanıcı eklendi");
    await loadUsers();
  }

  async function deleteStaff(staff) {
    if (!profile || profile.role !== "boss" || staff.role !== "employee") return;
    if (!window.confirm(`${staff.full_name || staff.email} adlı Rep pasife alınsın mı? Atanmış müşterilerinin tamamı güvenli şekilde havuza dönecek.`)) return;

    const { data: releasedCount, error } = await runWithRetry(() =>
      supabase.rpc("deactivate_rep_and_release_customers", { target_rep_id: staff.id })
    );
    if (error) {
      const setupMissing = error.code === "PGRST202" || error.message?.includes("deactivate_rep_and_release_customers");
      alert(setupMissing
        ? "Güvenli Rep silme kurulumu eksik. Supabase SQL Editor'da SAFE_REP_REMOVAL.sql dosyasını bir kez çalıştır."
        : "Rep pasife alınamadı; hiçbir müşteri kaydı değişmedi: " + error.message);
      return;
    }

    showSystemToast(`Rep pasife alındı, ${Number(releasedCount) || 0} müşteri havuza döndü.`);
    await loadUsers();
    await loadCustomers();
  }

  async function deleteAllCustomerData() {
    if (!profile || profile.role !== "boss") return;
    if (customers.length === 0) {
      alert("Silinecek müşteri kaydı yok.");
      return;
    }

    if (!window.confirm(`${customers.length} müşteri ve tüm işlem geçmişi kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`)) return;

    const { error: logError } = await runWithRetry(() =>
      supabase
        .from("customer_logs")
        .delete()
        .not("id", "is", null)
    );

    if (logError) {
      alert("İşlem geçmişi silinemedi: " + logError.message);
      return;
    }

    const { error } = await runWithRetry(() =>
      supabase
        .from("customers")
        .delete()
        .not("id", "is", null)
    );

    if (error) {
      alert("Müşteriler silinemedi: " + error.message);
      return;
    }

    setSelectedCustomer(null);
    setCustomerLogs([]);
    setCustomerLogsLoading(false);
    setSelectedIds([]);
    await loadCustomers();
    showSystemToast("Tüm müşteri verisi temizlendi");
  }

  async function deleteCustomersWithoutPhone() {
    if (!profile || profile.role !== "boss") return;
    const missingPhoneCount = customers.filter((customer) =>
      ![customer.phone, customer.phone_2].some((phone) => isTurkishMobile(phone))
    ).length;

    if (missingPhoneCount === 0) {
      alert("Geçerli cep telefonu olmayan müşteri kartı bulunamadı.");
      return;
    }

    if (!window.confirm(`${missingPhoneCount} müşteri kartında 5 ile başlayan 10 haneli cep telefonu yok. Bu kartlar ve işlem geçmişleri kalıcı olarak silinsin mi?`)) return;

    const { data: deletedCount, error } = await runWithRetry(() =>
      supabase.rpc("delete_customers_without_phone")
    );
    if (error) {
      const setupMissing = error.code === "PGRST202" || error.message?.includes("delete_customers_without_phone");
      alert(setupMissing
        ? "Temizlik kurulumu eksik. Supabase SQL Editor'da CLEAN_CUSTOMERS_WITHOUT_PHONE.sql dosyasını bir kez çalıştır."
        : "Numarasız müşteri kartları silinemedi; hiçbir kayıt değiştirilmedi: " + error.message);
      return;
    }

    setSelectedCustomer(null);
    setCustomerLogs([]);
    setCustomerLogsLoading(false);
    setSelectedIds([]);
    await loadCustomers();
    showSystemToast(`${Number(deletedCount) || 0} geçersiz veya numarasız müşteri kartı silindi.`);
  }

  async function repairPhoneTcMixups() {
    if (!profile || profile.role !== "boss") return;
    const mixupCount = customers.filter((customer) => {
      const phone = String(customer.phone || "").replace(/\D/g, "");
      const tc = String(customer.tc_no || "").replace(/\D/g, "");
      const malformedTc = tc.length > 0 && !/^[1-9]\d{10}$/.test(tc);
      return malformedTc || (tc.length === 11 && phone === tc.slice(-10));
    }).length;

    if (mixupCount === 0) {
      alert("TC ile karışmış telefon kaydı bulunamadı.");
      return;
    }

    if (!window.confirm(`${mixupCount} kayıtta TC alanı bozuk veya telefonla karışmış. Bozuk TC alanlar temizlenecek; Telefon 2'de geçerli cep varsa korunacak. Devam edilsin mi?`)) return;

    const { data: affectedCount, error } = await runWithRetry(() =>
      supabase.rpc("repair_phone_tc_mixups")
    );
    if (error) {
      const setupMissing = error.code === "PGRST202" || error.message?.includes("repair_phone_tc_mixups");
      alert(setupMissing
        ? "Düzeltme kurulumu eksik. Supabase SQL Editor'da FIX_PHONE_TC_MIXUPS.sql dosyasını bir kez çalıştır."
        : "TC/telefon karışıklığı düzeltilemedi; hiçbir kayıt değiştirilmedi: " + error.message);
      return;
    }

    await loadCustomers();
    showSystemToast(`${Number(affectedCount) || 0} karışmış kayıt düzeltildi veya güvenle silindi.`);
  }

  async function assignCustomer(customerOrId, employeeId) {
    if (!profile || !["boss", "manager"].includes(profile.role)) return false;
    const customerId = typeof customerOrId === "object" ? customerOrId?.id : customerOrId;
    const currentCustomer = typeof customerOrId === "object"
      ? customerOrId
      : customersRef.current.find((customer) => String(customer.id) === String(customerId));
    if (!customerId) return false;
    const moveToPool = !employeeId;
    const assignedAt = moveToPool ? null : new Date().toISOString();
    const nextStatus = moveToPool
      ? currentCustomer?.status || "pool"
      : currentCustomer?.status && currentCustomer.status !== "pool"
        ? currentCustomer.status
        : "assigned";

    const { data: affectedCount, error } = await runWithRetry(() =>
      supabase.rpc("crm_assign_customers", {
        p_customer_ids: [customerId],
        p_employee_id: moveToPool ? null : employeeId,
      })
    );

    if (error) {
      const setupMissing = error.code === "PGRST202" || error.message?.includes("crm_assign_customers");
      alert(setupMissing
        ? "Atama sistemi eksik. Supabase SQL Editor'da CUSTOMER_CRM_OPTIMIZATION.sql dosyasını çalıştır."
        : "Atama hatası: " + error.message);
      return false;
    }

    const optimisticCustomer = currentCustomer ? {
      ...currentCustomer,
      assigned_employee: moveToPool ? null : employeeId,
      status: nextStatus,
      assigned_at: assignedAt,
      last_action_by: profile.id,
    } : null;
    if (optimisticCustomer) upsertCustomerRows(optimisticCustomer);
    if (String(selectedCustomer?.id) === String(customerId)) {
      setSelectedCustomer((current) => current ? {
        ...current,
        ...optimisticCustomer,
      } : current);
    }

    const affected = Number(affectedCount) || 1;
    showSystemToast(moveToPool
      ? `${affected} müşteri kartı havuza alındı`
      : `${affected} müşteri kartı rep'e atandı`);
    setCustomerDataVersion((version) => version + 1);
    return true;
  }

  async function bulkAssignCustomers(customerIdsOverride, employeeOverride, sourceEmployeeOverride) {
    const targetEmployee = typeof employeeOverride === "string" ? employeeOverride : bulkEmployee;
    const moveToPool = targetEmployee === "__pool__";
    const customerIdsToUpdate = Array.isArray(customerIdsOverride) ? customerIdsOverride : selectedIds;

    if (sourceEmployeeOverride) {
      if (!profile || !["boss", "manager"].includes(profile.role)) return false;
      if (!window.confirm("Repteki tüm müşteriler havuza geri alınsın mı?")) return false;

      const { data: releasedCount, error: releaseError } = await runWithRetry(() =>
        supabase.rpc("crm_release_employee_customers", { p_employee_id: sourceEmployeeOverride })
      );
      if (releaseError) {
        const setupMissing = releaseError.code === "PGRST202" || releaseError.message?.includes("crm_release_employee_customers");
        alert(setupMissing
          ? "Atama sistemi eksik. Supabase SQL Editor'da CUSTOMER_CRM_OPTIMIZATION.sql dosyasını çalıştır."
          : "Rep müşterileri havuza alınamadı: " + releaseError.message);
        return false;
      }

      const released = Number(releasedCount) || 0;
      setCustomers((current) => current.map((customer) =>
        customer.assigned_employee === sourceEmployeeOverride
          ? { ...customer, assigned_employee: null, assigned_at: null, status: customer.status, last_action_by: profile.id }
          : customer
      ));
      setSelectedIds([]);
      setBulkEmployee("");
      setCustomerDataVersion((version) => version + 1);
      showSystemToast(`${released} müşteri havuza alındı.`);
      return true;
    }

    if (!targetEmployee || customerIdsToUpdate.length === 0 || !profile) {
      alert("Müşteri ve rep seç.");
      return false;
    }

    if (moveToPool && !window.confirm(`${customerIdsToUpdate.length} müşteri havuza geri alınsın mı?`)) return false;

    const { data: affectedCount, error } = await runWithRetry(() =>
      supabase.rpc("crm_assign_customers", {
        p_customer_ids: customerIdsToUpdate,
        p_employee_id: moveToPool ? null : targetEmployee,
      })
    );
    if (error) {
      const setupMissing = error.code === "PGRST202" || error.message?.includes("crm_assign_customers");
      alert(setupMissing
        ? "Atama sistemi eksik. Supabase SQL Editor'da CUSTOMER_CRM_OPTIMIZATION.sql dosyasını çalıştır."
        : "Toplu atama tamamlanamadı: " + (error.message || "Bağlantı hatası"));
      return false;
    }

    const processed = Number(affectedCount) || customerIdsToUpdate.length;

    const idSet = new Set(customerIdsToUpdate.map(String));
    const assignedAt = moveToPool ? null : new Date().toISOString();
    setCustomers((current) => current.map((customer) =>
      idSet.has(String(customer.id))
        ? {
            ...customer,
            assigned_employee: moveToPool ? null : targetEmployee,
            status: moveToPool
              ? customer.status
              : customer.status === "pool" ? "assigned" : customer.status,
            assigned_at: assignedAt,
            last_action_by: profile.id,
          }
        : customer
    ));
    setSelectedIds([]);
    setBulkEmployee("");
    setCustomerDataVersion((version) => version + 1);
    showSystemToast(moveToPool ? `${processed} müşteri havuza alındı.` : `${processed} müşteri atandı.`);
    return true;
  }

  async function shareCustomerNote({ customer, note, targetId }) {
    const cleanNote = note.trim();
    if (!profile || !customer || !cleanNote) return false;

    const recipientId = targetId === "general" ? null : targetId;
    if (recipientId === profile.id) {
      showSystemToast("Kendi hesabına mesaj gönderilemez.", "warning");
      return false;
    }

    const { data, error } = await supabase
      .from("app_messages")
      .insert({
        sender_id: profile.id,
        recipient_id: recipientId,
        body: buildCustomerNoteShareMessage(customer, cleanNote),
      })
      .select("*")
      .single();

    if (error) {
      setMessagingError("Müşteri notu gönderilemedi: " + error.message);
      showSystemToast("Müşteri notu gönderilemedi.", "warning");
      return false;
    }

    setMessagingError("");
    if (data) setMessages((current) => current.some((message) => message.id === data.id) ? current : [...current, data]);
    showSystemToast(recipientId ? "Müşteri notu çalışana gönderildi." : "Müşteri notu genel mesaja gönderildi.");
    return true;
  }

  async function exportContractAppointments(customersToExport) {
    if (!customersToExport.length) {
      showSystemToast("Dışa aktarılacak sözleşmeli randevu yok.", "warning");
      return;
    }

    try {
      const XLSX = await import("xlsx");
      const rows = customersToExport.map((customer, index) => ({
        "Sıra": index + 1,
        "Müşteri": customerFullName(customer),
        "Telefon": formatPhoneDisplay(customer.phone),
        "Telefon 2": formatPhoneDisplay(customer.phone_2),
        "TC No": customer.tc_no || "",
        "Randevu Tarihi": formatDateTime(customer.appointment_date),
        "Durum": statusLabel(customer.status),
        "Atanan Rep": userDisplayName(users, customer.assigned_employee),
        "Data": customer.batch_name || "",
        "Sayfa": customer.batch_page || "",
        "Not": customer.info_note || "",
        "Kayıt Tarihi": formatDateTime(customer.created_at),
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet["!cols"] = [
        { wch: 8 },
        { wch: 30 },
        { wch: 16 },
        { wch: 16 },
        { wch: 14 },
        { wch: 18 },
        { wch: 22 },
        { wch: 24 },
        { wch: 24 },
        { wch: 10 },
        { wch: 42 },
        { wch: 18 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Sözleşmeli Randevular");
      XLSX.writeFile(workbook, `sozlesmeli-randevular-${new Date().toISOString().slice(0, 10)}.xlsx`);
      showSystemToast(`${customersToExport.length} sözleşmeli randevu Excel'e aktarıldı.`);
    } catch (error) {
      alert("Excel dışa aktarılamadı: " + (error.message || "Bilinmeyen hata"));
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const body = messageBody.trim();
    if ((!body && !messageAttachment) || !profile) return;
    setSendingMessage(true);

    if (editingMessage) {
      const { data, error } = await supabase
        .from("app_messages")
        .update({ body, edited_at: new Date().toISOString() })
        .eq("id", editingMessage.id)
        .eq("sender_id", profile.id)
        .select("*")
        .single();
      setSendingMessage(false);
      if (error) {
        setMessagingError("Mesaj düzenlenemedi: " + error.message);
        return;
      }
      setMessages((current) => current.map((message) => message.id === data.id ? data : message));
      setMessageBody("");
      setEditingMessage(null);
      return;
    }

    let attachment = {};
    if (messageAttachment) {
      if (messageAttachment.size > 10 * 1024 * 1024) {
        setSendingMessage(false);
        alert("Mesaj eki en fazla 10 MB olabilir.");
        return;
      }
      const safeName = messageAttachment.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${profile.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("chat-files").upload(path, messageAttachment, { cacheControl: "3600" });
      if (uploadError) {
        setSendingMessage(false);
        setMessagingError("Dosya yüklenemedi: " + uploadError.message);
        return;
      }
      const { data: publicData } = supabase.storage.from("chat-files").getPublicUrl(path);
      attachment = {
        attachment_url: publicData.publicUrl,
        attachment_name: messageAttachment.name,
        attachment_type: messageAttachment.type || "application/octet-stream",
      };
    }

    const recipientId = messageTarget === "general" ? null : messageTarget;
    const { data, error } = await supabase
      .from("app_messages")
      .insert({
        sender_id: profile.id,
        recipient_id: recipientId,
        body: body || messageAttachment?.name || "Dosya",
        reply_to_id: replyToMessage?.id || null,
        ...attachment,
      })
      .select("*")
      .single();
    setSendingMessage(false);

    if (error) {
      setMessagingError("Mesaj gönderilemedi: " + error.message);
      return;
    }
    setMessageBody("");
    setMessageAttachment(null);
    setReplyToMessage(null);
    setMessages((current) => current.some((message) => message.id === data.id) ? current : [...current, data]);
  }

  function beginEditMessage(message) {
    setEditingMessage(message);
    setReplyToMessage(null);
    setMessageAttachment(null);
    setMessageBody(message.body);
  }

  async function deleteMessage(message) {
    if (!profile || message.sender_id !== profile.id) return;
    if (!confirm("Bu mesaj silinsin mi?")) return;
    const { error } = await supabase
      .from("app_messages")
      .delete()
      .eq("id", message.id)
      .eq("sender_id", profile.id);
    if (error) {
      setMessagingError("Mesaj silinemedi: " + error.message);
      return;
    }
    setMessages((current) => current.filter((item) => item.id !== message.id));
    if (replyToMessage?.id === message.id) setReplyToMessage(null);
    if (editingMessage?.id === message.id) {
      setEditingMessage(null);
      setMessageBody("");
    }
  }

  async function selectConversation(targetId) {
    setMessageTarget(targetId);
    if (targetId === "general" || !profile) return;
    await supabase.rpc("mark_messages_read", { p_sender_id: targetId });
    setMessages((current) => current.map((message) =>
      message.recipient_id === profile.id && message.sender_id === targetId
        ? { ...message, read_at: message.read_at || new Date().toISOString() }
        : message
    ));
  }

  async function addMyNote(event) {
    event.preventDefault();
    const body = myNoteBody.trim();
    if (!body || !profile) return;
    setSavingNote(true);
    const { data, error } = await supabase
      .from("user_notes")
      .insert({ user_id: profile.id, body })
      .select("*")
      .single();
    setSavingNote(false);

    if (error) {
      const setupMissing = error.code === "PGRST202" || error.message?.includes("user_notes");
      setMyNotesError(setupMissing
        ? "Notlarım kurulumu eksik. Supabase SQL Editor'da MY_NOTES.sql dosyasını bir kez çalıştır."
        : "Not eklenemedi: " + error.message);
      return;
    }

    setMyNotesError("");
    setMyNoteBody("");
    if (data) setMyNotes((current) => [data, ...current]);
    showSystemToast("Not kaydedildi");
  }

  async function deleteMyNote(noteId) {
    if (!profile) return;
    if (!window.confirm("Bu not silinsin mi?")) return;
    const { error } = await supabase
      .from("user_notes")
      .delete()
      .eq("id", noteId)
      .eq("user_id", profile.id);
    if (error) {
      setMyNotesError("Not silinemedi: " + error.message);
      return;
    }
    setMyNotes((current) => current.filter((note) => note.id !== noteId));
  }

  async function loadMessageHistoryForCustomer(customerOrId, accessOptions = {}) {
    const customerId = typeof customerOrId === "object" ? customerOrId?.id : customerOrId;
    const customer = typeof customerOrId === "object"
      ? customerOrId
      : customers.find((item) => item.id === customerId);

    if (!customerId || !customer) return;
    setCustomerLogs([]);
    setCustomerLogsLoading(true);
    setCustomerCalls([]);
    setCustomerSmsLogs([]);
    setSelectedCustomer(customer);
    setSelectedCustomerAccess({
      readOnly: Boolean(accessOptions.readOnly),
      callId: accessOptions.callId || "",
      reason: accessOptions.reason || "",
    });
    await Promise.all([loadCustomerLogs(customer), loadCustomerCalls(customer), loadCustomerSmsLogs(customer)]);
  }

  function closeCustomerModal() {
    customerLogsRequestRef.current += 1;
    customerCallsRequestRef.current += 1;
    customerSmsLogsRequestRef.current += 1;
    selectedCustomerRelatedIdsRef.current = new Set();
    setCustomerLogsLoading(false);
    setCustomerLogs([]);
    setCustomerCallsLoading(false);
    setCustomerCalls([]);
    setCustomerSmsLogsLoading(false);
    setCustomerSmsLogs([]);
    setSelectedCustomer(null);
    setSelectedCustomerAccess({ readOnly: false, callId: "", reason: "" });
  }

  const profileRole = profile?.role || "employee";
  const profileId = profile?.id || "";
  const profileFullName = profile?.full_name || "";
  const profileEmail = profile?.email || "";
  const isManagementProfile = ["boss", "manager"].includes(profileRole);
  const metricSummary = profileRole === "employee" ? ownCustomerSummary || customerSummary : customerSummary;
  const customersStillLoading = metricSummary === null;
  const customerMetric = (key, fallback = 0) => {
    const value = metricSummary?.[key];
    return value === null || value === undefined ? fallback : Number(value) || 0;
  };
  const ownCustomerMetric = (key, fallback = 0) => {
    const value = ownCustomerSummary?.[key];
    return value === null || value === undefined ? fallback : Number(value) || 0;
  };
  const employees = users.filter((user) => ["employee", "manager"].includes(user.role));
  const ownAssignedCustomers = ["employee", "manager"].includes(profileRole)
    ? customers.filter((customer) => customer.assigned_employee === profileId)
    : customers;
  const managerCustomers = profileRole === "manager" ? ownAssignedCustomers : [];
  const visibleCustomers = isManagementProfile ? customers : ownAssignedCustomers;
  const newIncomingCustomers = visibleCustomers.filter(isFreshAssignedCustomer);
  const ownNewIncomingCustomers = ownAssignedCustomers.filter(isFreshAssignedCustomer);
  const repNewIncomingCustomers = profileRole === "manager" ? ownNewIncomingCustomers : newIncomingCustomers;
  const completeCustomers = profileRole === "employee"
    ? visibleCustomers.filter((customer) => customer.assigned_employee === profileId)
    : visibleCustomers;
  const filteredCustomers = visibleCustomers
    .filter((customer) => {
      if (customerFilter === "all") return true;
      if (customerFilter === "pool") return customer.status === "pool";
      if (customerFilter === "assigned") return !!customer.assigned_employee;
      if (customerFilter === "approved") return customer.approved;
      if (customerFilter === "paid") return customer.payment_received;
      if (CUSTOMER_STATUSES.has(customerFilter)) return customer.status === customerFilter;
      return true;
    })
    .filter((customer) => customerMatchesSearch(customer, searchTerm));

  const followUps = visibleCustomers.filter((customer) =>
    ["no_answer", "busy", "appointment", "contract_appointment", "callback", "meeting_done", "not_approved"].includes(customer.status)
  );

  const welcomeName = profileFullName || profileEmail || "Kullanıcı";
  const today = new Date();
  const reminderCustomers = visibleCustomers
    .filter(isCalendarCustomer);
  const calendarCustomers = sortAppointmentCustomers(
    mergeCustomersById(appointmentCustomers, reminderCustomers).filter(isCalendarCustomer)
  );
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const overdueReminders = calendarCustomers.filter((customer) => new Date(customer.appointment_date) < todayStart);
  const todayWorkItems = calendarCustomers.filter((customer) => isSameDay(customer.appointment_date, today) || new Date(customer.appointment_date) < todayStart);
  const reportCustomers = isManagementProfile ? customers : visibleCustomers;
  const bossReportSummary = isManagementProfile ? bossLiveReport?.summary : null;
  const reportSummary = isManagementProfile ? bossReportSummary : metricSummary;
  const reportMetric = (key, fallback = 0) => {
    const value = reportSummary?.[key];
    return value === null || value === undefined ? fallback : Number(value) || 0;
  };
  const liveRepStatsById = new Map((bossLiveReport?.rep_stats || []).map((item) => [item.id, item]));
  const repStats = users
    .filter((user) => user.role === "employee")
    .map((user) => {
      const liveStats = liveRepStatsById.get(user.id);
      return {
        ...user,
        stats: liveStats ? {
          total: Number(liveStats.total) || 0,
          called: Number(liveStats.called) || 0,
          appointment: Number(liveStats.appointment) || 0,
          negative: Number(liveStats.negative) || customers.filter((customer) => customer.assigned_employee === user.id && REP_NEGATIVE_CUSTOMER_STATUSES.has(customer.status)).length,
          approved: Number(liveStats.approved) || 0,
          paid: Number(liveStats.paid) || 0,
          untouched: Number(liveStats.untouched) || 0,
          delayed: Number(liveStats.delayed) || 0,
        } : getUserStats(customers, user.id),
      };
    })
    .sort((a, b) => b.stats.paid - a.stats.paid || b.stats.appointment - a.stats.appointment);
  const reportStats = isManagementProfile ? [
    { key: "pool", title: "Havuz", value: reportMetric("pool", reportCustomers.filter((customer) => customer.status === "pool").length) },
    { key: "assigned", title: "Atanmış", value: reportMetric("assigned_total", reportCustomers.filter((customer) => customer.assigned_employee).length) },
    { key: "no_answer", title: "Ulaşılamadı", value: reportMetric("no_answer", reportCustomers.filter((customer) => customer.status === "no_answer").length) },
    { key: "busy", title: "Meşgul", value: reportMetric("busy", reportCustomers.filter((customer) => customer.status === "busy").length) },
    { key: "callback", title: "Tekrar Aranacak", value: reportMetric("callback", reportCustomers.filter((customer) => customer.status === "callback").length) },
    { key: "appointment", title: "Randevu", value: reportMetric("appointment", reportCustomers.filter((customer) => customer.status === "appointment").length) },
    { key: "contract_appointment", title: "Sözleşmeli Randevu", value: reportMetric("contract_appointment", reportCustomers.filter((customer) => customer.status === "contract_appointment").length) },
    { key: "not_approved", title: "Yapmayacak", value: reportMetric("not_approved", reportCustomers.filter((customer) => customer.status === "not_approved").length) },
    { key: "wrong_number", title: "Numara yanlış", value: reportMetric("wrong_number", reportCustomers.filter((customer) => customer.status === "wrong_number").length) },
    { key: "using", title: "Kullanıyor", value: reportMetric("using", reportCustomers.filter((customer) => customer.status === "using").length) },
    { key: "approved", title: "Onaylandı", value: reportMetric("approved", reportCustomers.filter((customer) => customer.approved).length) },
    { key: "paid", title: "Satış", value: reportMetric("paid", reportCustomers.filter((customer) => customer.payment_received).length) },
  ] : [
    { key: "total", title: "Komple Müşterilerim", value: reportMetric("total", reportCustomers.length) },
    { key: "fresh_assigned", title: "Yeni Gelenler", value: reportMetric("fresh_assigned", reportCustomers.filter(isFreshAssignedCustomer).length) },
    { key: "followups", title: "Takip Gerekenler", value: reportMetric("followups", followUps.length) },
    { key: "today_work", title: "Bugünkü İşler", value: reportMetric("today_work", todayWorkItems.length) },
    { key: "no_answer", title: "Ulaşılamadı", value: reportMetric("no_answer", reportCustomers.filter((customer) => customer.status === "no_answer").length) },
    { key: "busy", title: "Meşgul", value: reportMetric("busy", reportCustomers.filter((customer) => customer.status === "busy").length) },
    { key: "callback", title: "Tekrar Aranacak", value: reportMetric("callback", reportCustomers.filter((customer) => customer.status === "callback").length) },
    { key: "appointment", title: "Randevu", value: reportMetric("appointment", reportCustomers.filter((customer) => customer.status === "appointment").length) },
    { key: "contract_appointment", title: "Sözleşmeli Randevu", value: reportMetric("contract_appointment", reportCustomers.filter((customer) => customer.status === "contract_appointment").length) },
    { key: "not_approved", title: "Yapmayacak", value: reportMetric("not_approved", reportCustomers.filter((customer) => customer.status === "not_approved").length) },
    { key: "wrong_number", title: "Numara yanlış", value: reportMetric("wrong_number", reportCustomers.filter((customer) => customer.status === "wrong_number").length) },
    { key: "using", title: "Kullanıyor", value: reportMetric("using", reportCustomers.filter((customer) => customer.status === "using").length) },
    { key: "approved", title: "Onaylandı", value: reportMetric("approved", reportCustomers.filter((customer) => customer.approved).length) },
    { key: "paid", title: "Satış", value: reportMetric("paid", reportCustomers.filter((customer) => customer.payment_received).length) },
  ];
  const dataStats = isManagementProfile && bossLiveReport?.data_stats
    ? bossLiveReport.data_stats.map((item) => ({
        ...item,
        total: Number(item.total) || 0,
        appointment: Number(item.appointment) || 0,
        paid: Number(item.paid) || 0,
        wrongNumber: Number(item.wrongNumber) || 0,
      }))
    : getDataStats(reportCustomers);
  const totalCustomerCount = customerMetric("total", completeCustomers.length);
  const freshCustomerCount = profileRole === "manager"
    ? ownCustomerMetric("fresh_assigned", ownNewIncomingCustomers.length)
    : customerMetric("fresh_assigned", newIncomingCustomers.length);
  const managerCustomerCount = ownCustomerMetric("total", managerCustomers.length);
  const assignedCustomerCount = customerMetric("assigned_total", visibleCustomers.filter((customer) => customer.assigned_employee).length);
  const poolCustomerCount = customerMetric("pool", visibleCustomers.filter((customer) => customer.status === "pool").length);
  const approvedCustomerCount = customerMetric("approved", visibleCustomers.filter((customer) => customer.approved).length);
  const paidCustomerCount = customerMetric("paid", visibleCustomers.filter((customer) => customer.payment_received).length);
  const followUpCustomerCount = customerMetric("followups", followUps.length);
  const todayWorkCount = customerMetric("today_work", todayWorkItems.length);
  const manualDuplicate = findDuplicateCustomer(customers, form.phone);
  const ownCustomerRemoteScope = ["employee", "manager"].includes(profileRole) ? { fixedAssignee: profileId } : {};
  const customerListBaseRemoteScope = profileRole === "employee" ? ownCustomerRemoteScope : {};
  const customerListRemoteScope = {
    ...customerListBaseRemoteScope,
    assignmentScope: customerFilter === "pool" ? "pool" : customerFilter === "assigned" ? "assigned" : "all",
    approvedOnly: customerFilter === "approved",
    paidOnly: customerFilter === "paid",
  };
  const tomorrowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const todayWorkRemoteScope = {
    ...ownCustomerRemoteScope,
    fixedStatuses: ["callback", "appointment", "contract_appointment"],
    appointmentBefore: tomorrowStart.toISOString(),
    orderByAppointment: true,
  };
  const unreadMessageCount = profileId
    ? messages.filter((message) => message.recipient_id === profileId && !message.read_at).length
    : 0;

  if (!authReady) {
    return (
      <div style={loginPage}>
        <div style={{ ...loginCard, textAlign: "center" }}>
          <h2>Oturum açılıyor...</h2>
          <p style={{ opacity: 0.65 }}>Panel hazırlanıyor</p>
        </div>
      </div>
    );
  }

  if (supabaseConfigMissing) {
    return (
      <div style={loginPage}>
        <div style={{ ...loginCard, textAlign: "center" }}>
          <h2>Supabase ayarlari eksik</h2>
          <p style={{ opacity: 0.75, lineHeight: 1.6 }}>
            Local .env dosyasinda VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY bulunmali.
            Dosya su an silinmis gorunuyor; geri geldiginde sayfayi yenilemen yeterli.
          </p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={loginPage}>
        <div style={loginLeft}>
          <div style={brandBadge}>OSS CONTROL CENTER</div>
          <h1 style={loginHeroTitle}>Müşteri takip sistemi.</h1>
          <p style={loginHeroText}>
            Müşterilerinizi, görüşme notlarını, randevuları ve satış süreçlerini tek ekrandan takip edin.
          </p>
          <div style={loginFeatureGrid}>
            <div style={loginFeature}>Müşteri Takibi</div>
            <div style={loginFeature}>Görüşme Notları</div>
            <div style={loginFeature}>Randevu Yönetimi</div>
            <div style={loginFeature}>Güvenli Giriş</div>
          </div>
        </div>

        <div style={loginCardStack}>
          <form onSubmit={login} style={loginCard}>
            <h2>Hoş geldin</h2>
            <p style={{ opacity: 0.65 }}>OSS paneline giriş yap</p>
            <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={loginInput} />
            <input placeholder="Şifre" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={loginInput} />
            <button disabled={loading} style={loginButton}>
              {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
            </button>
          </form>
          <div style={poweredByVercel}>
            <span style={vercelMark}>▲</span>
            <span>Powered by Vercel</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={appShell}>
      {systemToast && (
        <div style={{ ...toastStyle, ...(systemToast.tone === "warning" ? toastWarning : toastSuccess) }}>
          {systemToast.message}
        </div>
      )}
      <div style={messageNoticeStack}>
        {messageNotices.map((notice) => (
          <button key={notice.id} type="button" style={notice.tone === "broadcast" ? messageBroadcastNoticeCard : messageNoticeCard} onClick={() => {
            setMessageTarget(notice.target);
            setActivePage("messages");
            setMessageNotices((current) => current.filter((item) => item.id !== notice.id));
          }}>
            <span style={notice.tone === "broadcast" ? messageBroadcastNoticeIcon : messageNoticeIcon}>{notice.tone === "broadcast" ? "#" : "✉"}</span>
            <span style={messageNoticeCopy}><strong>{notice.title}</strong><small>{notice.body}</small></span>
            <span style={messageNoticeClose} onClick={(event) => {
              event.stopPropagation();
              setMessageNotices((current) => current.filter((item) => item.id !== notice.id));
            }}>×</span>
          </button>
        ))}
      </div>
      <div style={appointmentNoticeStack}>
        {appointmentNotices.map((notice) => (
          <button key={notice.id} type="button" style={appointmentNoticeCard(notice.level)} onClick={() => loadMessageHistoryForCustomer(notice.customer)}>
            <span style={appointmentNoticeIcon}>{notice.level === "soon" ? "!" : "◷"}</span>
            <span style={messageNoticeCopy}>
              <strong>{notice.title}</strong>
              <small>{notice.body}</small>
            </span>
            <span style={messageNoticeClose} onClick={(event) => {
              event.stopPropagation();
              dismissAppointmentNotice(notice.id);
            }}>×</span>
          </button>
        ))}
      </div>

      <aside style={{ ...sidebar, ...(sidebarCollapsed ? sidebarCollapsedStyle : sidebarExpandedStyle) }}>
        <div style={sidebarTopRow}>
          <div style={{ ...brandBlock, ...(sidebarCollapsed ? brandBlockCollapsed : {}) }}>
            <img src="/oss-center-logo.png" alt="OSS Center" style={brandLogo} />
            <p style={sideEmail}>{roleName(profile.role)}</p>
          </div>
          <button
            type="button"
            title={sidebarCollapsed ? "Menüyü aç" : "Menüyü kapat"}
            aria-label={sidebarCollapsed ? "Menüyü aç" : "Menüyü kapat"}
            onClick={() => setSidebarCollapsed((value) => !value)}
            style={{ ...menuToggle, ...(sidebarCollapsed ? menuToggleCollapsed : menuToggleExpanded) }}
          >
            <span style={menuToggleIcon} aria-hidden="true">
              <span style={{ ...menuToggleLine, ...menuToggleLineTop, ...(sidebarCollapsed ? {} : menuToggleLineTopOpen) }} />
              <span style={{ ...menuToggleLine, ...menuToggleLineMiddle, ...(sidebarCollapsed ? {} : menuToggleLineMiddleOpen) }} />
              <span style={{ ...menuToggleLine, ...menuToggleLineBottom, ...(sidebarCollapsed ? {} : menuToggleLineBottomOpen) }} />
            </span>
          </button>
        </div>
        {sidebarCollapsed && (
          <div style={brandMarkFrame} title="OSS Center">
            <img src="/oss-center-mark.png" alt="OSS Center" style={brandMark} />
          </div>
        )}

        <MenuButton icon="♙" iconSrc={menuIconAssets.account} title="Hesabım" page="account" tone="account" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        <MenuButton icon="✉" iconSrc={menuIconAssets.messages} title={`Mesajlar${unreadMessageCount ? ` (${unreadMessageCount})` : ""}`} page="messages" tone="messages" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        <MenuButton icon="▦" iconSrc={menuIconAssets.dashboard} title="Dashboard" page="dashboard" tone="dashboard" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        <MenuButton icon="♟" iconSrc={menuIconAssets.customers} title={profile.role === "employee" ? "Komple Müşteriler" : "Müşteriler"} page="customers" tone="customers" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} onClickExtra={() => setCustomerFilter("all")} />
        {profile.role === "employee" && (
          <>
            <MenuButton icon="✦" iconSrc={menuIconAssets.newCustomers} title={`Yeni Gelenler (${freshCustomerCount})`} page="rep_new" tone="new" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
            <MenuButton icon="…" iconSrc={menuIconAssets.noAnswer} title="Ulaşılamadı" page="rep_no_answer" tone="wrong" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
            <MenuButton icon="◷" iconSrc={menuIconAssets.appointment} title="Randevu" page="rep_appointment" tone="appointment" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
            <MenuButton icon="▤" iconSrc={menuIconAssets.contract} title="Sözleşmeli Randevu" page="rep_contract" tone="contract" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
            <MenuButton icon="↻" iconSrc={menuIconAssets.callback} title="Tekrar Aranacak" page="rep_callback" tone="callback" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
            <MenuButton icon="⊘" iconSrc={menuIconAssets.notApproved} title="Yapmayacak" page="rep_not_approved" tone="closed" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
            <MenuButton icon="₺" iconSrc={menuIconAssets.paid} title="Satış" page="rep_paid" tone="paid" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
          </>
        )}

        {profile.role === "manager" && (
          <>
            <MenuButton icon="◉" iconSrc={menuIconAssets.managerCustomers} title={`Müşterilerim (${managerCustomerCount.toLocaleString("tr-TR")})`} page="manager_customers" tone="customers" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
            <MenuButton icon="✦" iconSrc={menuIconAssets.managerNewCustomers} title={`Yeni Gelenler (${freshCustomerCount})`} page="rep_new" tone="new" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
          </>
        )}

        <MenuButton icon="✎" iconSrc={menuIconAssets.notes} title="Notlarım" page="notes" tone="notes" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />

        {isManagementProfile && (
          <>
            <MenuButton icon="+" iconSrc={menuIconAssets.pool} title="Yeni Müşteri Havuzu" page="pool" tone="pool" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
            <MenuButton icon="!" iconSrc={menuIconAssets.followups} title={`Takip Gerekenler (${followUpCustomerCount})`} page="followups" tone="urgent" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
          </>
        )}

        <MenuButton icon="◷" iconSrc={menuIconAssets.todayWork} title={`Bugünkü İşler (${todayWorkCount})`} page="today_work" tone="today" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        <MenuButton icon="▣" iconSrc={menuIconAssets.calendar} title="Takvim" page="calendar" tone="calendar" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        <MenuButton icon="!" iconSrc={menuIconAssets.wrongNumber} title="Numara Yanlış" page="wrong_number" tone="wrong" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />

        {isManagementProfile && (
          <MenuButton icon="◎" iconSrc={menuIconAssets.employees} title="Rep Takip Merkezi" page="employees" tone="employees" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        )}

        <MenuButton icon="▤" iconSrc={menuIconAssets.reports} title="Raporlar" page="reports" tone="reports" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
      </aside>

      <main style={mainArea}>
        <header style={topbar}>
          <div style={topbarIdentity}>
            {activePage !== "dashboard" && (
              <button type="button" title="Dashboard'a dön" aria-label="Dashboard'a dön" style={backButton} onClick={() => setActivePage("dashboard")}>‹</button>
            )}
            <ProfileAvatar user={profile} size={48} />
            <div style={welcomeBlock}>
              <span style={welcomeEyebrow}>Hoş geldiniz</span>
              <h1 style={welcomeTitle}>{welcomeName}</h1>
              <div style={welcomeStatusRow}>
                <p style={welcomeMeta}>{roleName(profile.role)}</p>
                <PresenceBadge user={profile} onlineUserIds={onlineUserIds} />
              </div>
            </div>
          </div>
          <div style={topbarActions}>
            {notificationPermission !== "granted" && notificationPermission !== "unsupported" && (
              <button type="button" onClick={enableMessageNotifications} style={notificationButton}>🔔 Bildirimleri Aç</button>
            )}
            <button onClick={logout} style={logoutButton}>Çıkış</button>
          </div>
        </header>

        {activePage === "dashboard" && (
          <>
            <div style={statsGrid}>
              <ClickStat tone="total" title={customersStillLoading ? "Müşteriler hazırlanıyor" : profile.role === "employee" ? "Komple Müşterilerim" : "Toplam Müşteri"} value={totalCustomerCount} onClick={() => { setCustomerFilter("all"); setActivePage("customers"); }} />
              {profile.role === "employee" && <ClickStat tone="new" title="Yeni Gelenler" value={freshCustomerCount} onClick={() => { setActivePage("rep_new"); }} />}
              {isManagementProfile && <ClickStat tone="new" title="Yeni Müşteriler" value={poolCustomerCount} onClick={() => { setCustomerFilter("pool"); setActivePage("pool"); }} />}
              <ClickStat tone="assigned" title="Atanmış" value={assignedCustomerCount} onClick={() => { setCustomerFilter("assigned"); setActivePage("customers"); }} />
              <ClickStat tone="approved" title="Onaylandı" value={approvedCustomerCount} onClick={() => { setCustomerFilter("approved"); setActivePage("customers"); }} />
              <ClickStat tone="paid" title="Para Alındı" value={paidCustomerCount} onClick={() => { setCustomerFilter("paid"); setActivePage("customers"); }} />
            </div>

            <div style={dashboardGrid}>
              <div style={{ ...panelCard, ...pipelinePanel }}>
                <h2>Operasyon Pipeline</h2>
                <div style={pipelineList}>
                  {isManagementProfile && <PipelineRow label="Yeni Müşteriler" value={poolCustomerCount} color="#38bdf8" onClick={() => { setCustomerFilter("pool"); setActivePage("pool"); }} />}
                  {isManagementProfile && <PipelineRow label="Atandı" value={customerMetric("assigned", customers.filter((customer) => customer.status === "assigned").length)} color="#818cf8" onClick={() => { setCustomerFilter("assigned"); setActivePage("customers"); }} />}
                  <PipelineRow label="Ulaşılamadı" value={customerMetric("no_answer", visibleCustomers.filter((customer) => customer.status === "no_answer").length)} color="#94a3b8" onClick={() => { setCustomerFilter("no_answer"); setActivePage(profile.role === "employee" ? "rep_no_answer" : "customers"); }} />
                  <PipelineRow label="Randevu" value={customerMetric("appointment", visibleCustomers.filter((customer) => customer.status === "appointment").length)} color="#fbbf24" onClick={() => { setCustomerFilter("appointment"); setActivePage(profile.role === "employee" ? "rep_appointment" : "customers"); }} />
                  <PipelineRow label="Yapmayacak" value={customerMetric("not_approved", visibleCustomers.filter((customer) => customer.status === "not_approved").length)} color="#f87171" onClick={() => { setCustomerFilter("not_approved"); setActivePage(profile.role === "employee" ? "rep_not_approved" : "customers"); }} />
                  <PipelineRow label="Kullanıyor" value={customerMetric("using", visibleCustomers.filter((customer) => customer.status === "using").length)} color="#2dd4bf" onClick={() => { setCustomerFilter("using"); setActivePage("customers"); }} />
                  <PipelineRow label="Onaylandı" value={approvedCustomerCount} color="#4ade80" onClick={() => { setCustomerFilter("approved"); setActivePage("customers"); }} />
                  <PipelineRow label="Para Alındı" value={paidCustomerCount} color="#34d399" onClick={() => { setCustomerFilter("paid"); setActivePage(profile.role === "employee" ? "rep_paid" : "customers"); }} />
                </div>
              </div>
            </div>

            {profile.role === "employee" && (
              <RepDailyOverview customers={visibleCustomers} todayItems={todayWorkItems} summary={metricSummary} onNavigate={setActivePage} />
            )}

            {profile.role === "employee" && (
              <CustomerForm form={form} setForm={setForm} addCustomer={addCustomer} duplicateCustomer={manualDuplicate} />
            )}

            {(profile.role === "boss" || profile.role === "manager") && (
              <CustomerForm form={form} setForm={setForm} addCustomer={addCustomer} duplicateCustomer={manualDuplicate} />
            )}

            {profile.role === "boss" && (
              <section style={{ ...panelCard, marginTop: 20 }}>
                <h2 style={sectionTitle}>Data Düzenleyici</h2>
                <p style={mutedText}>Ham Excel/CSV dosyasını seç; sistem veritabanına dokunmadan isim, telefon, ikinci telefon, TC ve ek bilgileri ayıklayıp temiz Excel olarak indirir.</p>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={cleanCustomerDataFile} disabled={cleaningData || importing} style={inputStyle} />
                {cleaningData && (
                  <div style={importProgressBox}>
                    <div style={chartLabel}>
                      <span>{cleanProgress?.phase || "Temizleniyor"}</span>
                      <strong>{cleanProgress?.total ? `${cleanProgress.current.toLocaleString("tr-TR")} / ${cleanProgress.total.toLocaleString("tr-TR")}` : "Hazırlanıyor"}</strong>
                    </div>
                    <div style={chartTrack}>
                      <div style={{ ...chartBar, width: `${cleanProgress?.total ? Math.max((cleanProgress.current / cleanProgress.total) * 100, 2) : 12}%` }} />
                    </div>
                  </div>
                )}
                {lastCleanSummary && (
                  <div style={cleanSummaryBox}>
                    <strong>{lastCleanSummary.outputName}</strong>
                    <span>{lastCleanSummary.sheetName} · Temiz dosya indirildi, henüz CRM'e kayıt atılmadı.</span>
                    <div style={importSummaryGrid}>
                      <span>Temiz kayıt: <strong>{lastCleanSummary.cleaned.toLocaleString("tr-TR")}</strong></span>
                      <span>İkinci telefon: <strong>{lastCleanSummary.secondPhones.toLocaleString("tr-TR")}</strong></span>
                      <span>Dosya içi mükerrer: <strong>{lastCleanSummary.duplicateRows.toLocaleString("tr-TR")}</strong></span>
                      <span>Eksik/hatalı: <strong>{lastCleanSummary.rejectedRows.toLocaleString("tr-TR")}</strong></span>
                    </div>
                    <span style={mutedText}>İnen temiz dosyayı aşağıdaki “Excel / CSV Data Yükle” alanından manuel yükleyebilirsin.</span>
                  </div>
                )}

                <h2 style={sectionTitle}>Excel / CSV Data Yükle</h2>
                <p style={mutedText}>Bu alan seçtiğin dosyayı doğrudan CRM'e kaydeder. Önce temizlemek istiyorsan yukarıdaki Data Düzenleyici'yi kullan.</p>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={importExcel} disabled={importing || cleaningData} style={inputStyle} />
                {importing && (
                  <div style={importProgressBox}>
                    <div style={chartLabel}>
                      <span>{importProgress?.phase || "Yükleniyor"}</span>
                      <strong>{importProgress?.total ? `${importProgress.current.toLocaleString("tr-TR")} / ${importProgress.total.toLocaleString("tr-TR")}` : "Hazırlanıyor"}</strong>
                    </div>
                    <div style={chartTrack}>
                      <div style={{ ...chartBar, width: `${importProgress?.total ? Math.max((importProgress.current / importProgress.total) * 100, 2) : 12}%` }} />
                    </div>
                  </div>
                )}
                {lastImportSummary && (
                  <div style={importSummaryBox}>
                    <strong>{lastImportSummary.fileName}</strong>
                    <span>{lastImportSummary.sheetName} · {lastImportSummary.checked.toLocaleString("tr-TR")} geçerli benzersiz satır kontrol edildi</span>
                    <div style={importSummaryGrid}>
                      <span>Yeni müşteri: <strong>{lastImportSummary.inserted.toLocaleString("tr-TR")}</strong></span>
                      <span>Mevcuda bağlandı: <strong>{lastImportSummary.matchedExisting.toLocaleString("tr-TR")}</strong></span>
                      <span>Yeni data kaynağı: <strong>{lastImportSummary.sourceRows.toLocaleString("tr-TR")}</strong></span>
                      <span>Zaten takipte: <strong>{lastImportSummary.alreadyTracked.toLocaleString("tr-TR")}</strong></span>
                      <span>Dosya içi mükerrer: <strong>{lastImportSummary.fileDuplicates.toLocaleString("tr-TR")}</strong></span>
                      <span>Eksik/hatalı: <strong>{lastImportSummary.rejectedRows.toLocaleString("tr-TR")}</strong></span>
                    </div>
                  </div>
                )}
                <div style={dataActions}>
                  <span style={mutedText}>Yeniden yükleme öncesi mevcut müşteri listesini temizleyebilirsin.</span>
                  <div style={cleanupButtons}>
                    <button type="button" onClick={repairPhoneTcMixups} style={cleanInvalidButton}>TC/Telefon Karışanları Düzelt</button>
                    <button type="button" onClick={deleteCustomersWithoutPhone} style={cleanInvalidButton}>Geçersiz/Numarasız Kartları Temizle</button>
                    <button type="button" onClick={deleteAllCustomerData} style={deleteAllButton}>Tüm Müşteri Datasını Sil</button>
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        {activePage === "customers" && (
          <CustomerTable
            title={profile.role === "employee" ? "Komple Müşteriler" : "Müşteriler"}
            data={profile.role === "employee" && customerFilter === "all" ? completeCustomers : filteredCustomers}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={loadMessageHistoryForCustomer}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
            remoteScope={customerListRemoteScope}
            dataVersion={customerDataVersion}
          />
        )}

        {activePage === "manager_customers" && (
          <CustomerTable
            title="Müşterilerim"
            data={managerCustomers}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={loadMessageHistoryForCustomer}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
            remoteScope={{ ...ownCustomerRemoteScope, orderByAssigned: true }}
            dataVersion={customerDataVersion}
          />
        )}

        {activePage === "rep_new" && (
          <CustomerTable
            title="Yeni Gelen Müşteriler"
            data={repNewIncomingCustomers}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={loadMessageHistoryForCustomer}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
            remoteScope={{ ...ownCustomerRemoteScope, fixedStatuses: ["assigned"], freshAssignedFor: profileId, orderByAssigned: true }}
            dataVersion={customerDataVersion}
          />
        )}

        {activePage === "rep_no_answer" && (
          <CustomerTable
            title="Ulaşılamayan Müşteriler"
            data={visibleCustomers.filter((customer) => customer.status === "no_answer")}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={loadMessageHistoryForCustomer}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
            remoteScope={{ ...ownCustomerRemoteScope, fixedStatuses: ["no_answer"] }}
            dataVersion={customerDataVersion}
          />
        )}

        {activePage === "rep_appointment" && (
          <CustomerTable
            title="Randevulu Müşteriler"
            data={visibleCustomers.filter((customer) => customer.status === "appointment")}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={loadMessageHistoryForCustomer}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
            remoteScope={{ ...ownCustomerRemoteScope, fixedStatuses: ["appointment"], orderByAppointment: true }}
            dataVersion={customerDataVersion}
          />
        )}

        {activePage === "rep_not_approved" && (
          <CustomerTable
            title="Yapmayacak Müşteriler"
            data={visibleCustomers.filter((customer) => customer.status === "not_approved")}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={loadMessageHistoryForCustomer}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
            remoteScope={{ ...ownCustomerRemoteScope, fixedStatuses: ["not_approved"] }}
            dataVersion={customerDataVersion}
          />
        )}

        {activePage === "wrong_number" && (
          <CustomerTable
            title="Numara Yanlış"
            data={visibleCustomers.filter((customer) => customer.status === "wrong_number")}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={loadMessageHistoryForCustomer}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
            remoteScope={{ ...ownCustomerRemoteScope, fixedStatuses: ["wrong_number"] }}
            dataVersion={customerDataVersion}
          />
        )}

        {activePage === "rep_contract" && (
          <CustomerTable
            title="Sözleşmeli Randevular"
            data={visibleCustomers.filter((customer) => customer.status === "contract_appointment")}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={loadMessageHistoryForCustomer}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
            exportLabel="Excel'e Aktar"
            onExport={exportContractAppointments}
            remoteScope={{ ...ownCustomerRemoteScope, fixedStatuses: ["contract_appointment"], orderByAppointment: true }}
            dataVersion={customerDataVersion}
          />
        )}

        {activePage === "rep_callback" && (
          <CustomerTable
            title="Tekrar Aranacaklar"
            data={visibleCustomers.filter((customer) => customer.status === "callback")}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={loadMessageHistoryForCustomer}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
            remoteScope={{ ...ownCustomerRemoteScope, fixedStatuses: ["callback"], orderByAppointment: true }}
            dataVersion={customerDataVersion}
          />
        )}

        {activePage === "rep_paid" && (
          <CustomerTable
            title="Satışlar"
            data={visibleCustomers.filter((customer) => customer.status === "paid")}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={loadMessageHistoryForCustomer}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
            remoteScope={{ ...ownCustomerRemoteScope, fixedStatuses: ["paid"] }}
            dataVersion={customerDataVersion}
          />
        )}

        {isManagementProfile && activePage === "pool" && (
          <CustomerTable
            title="Müşteri Havuzu"
            data={customers.filter((customer) => customer.status === "pool")}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={loadMessageHistoryForCustomer}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
            remoteScope={{ assignmentScope: "pool", fixedStatuses: ["pool"] }}
            dataVersion={customerDataVersion}
          />
        )}

        {isManagementProfile && activePage === "followups" && (
          <CustomerTable
            title="Takip Gerekenler"
            data={followUps}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={loadMessageHistoryForCustomer}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
            remoteScope={{ fixedStatuses: FOLLOW_UP_CUSTOMER_STATUSES, orderByAppointment: true }}
            dataVersion={customerDataVersion}
          />
        )}

        {activePage === "today_work" && (
          <>
            <TodayWorkView todayItems={todayWorkItems} overdueItems={overdueReminders} />
            {profile.role === "employee" && (
              <CustomerForm form={form} setForm={setForm} addCustomer={addCustomer} duplicateCustomer={manualDuplicate} />
            )}
            <CustomerTable
              title="Bugünkü İşler"
              data={todayWorkItems}
              employees={employees}
              profile={profile}
              assignCustomer={assignCustomer}
              setSelectedCustomer={loadMessageHistoryForCustomer}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              bulkEmployee={bulkEmployee}
              setBulkEmployee={setBulkEmployee}
              bulkAssignCustomers={bulkAssignCustomers}
              remoteScope={todayWorkRemoteScope}
              dataVersion={customerDataVersion}
              defaultSortMode="appointment_asc"
            />
          </>
        )}

        {activePage === "calendar" && (
          <CalendarView
            customers={calendarCustomers}
            users={users}
            profile={profile}
            setSelectedCustomer={loadMessageHistoryForCustomer}
          />
        )}

        {activePage === "notes" && (
          <NotesView
            myNotes={myNotes}
            myNoteBody={myNoteBody}
            setMyNoteBody={setMyNoteBody}
            addMyNote={addMyNote}
            deleteMyNote={deleteMyNote}
            notesLoading={myNotesLoading}
            notesError={myNotesError}
            savingNote={savingNote}
          />
        )}

        {isManagementProfile && activePage === "employees" && (
          <EmployeesView
            profile={profile}
            users={users}
            customers={customers}
            customerSummary={customerSummary}
            customerDataVersion={customerDataVersion}
            liveReport={bossLiveReport}
            liveReportError={bossLiveReportError}
            onlineUserIds={onlineUserIds}
            staffForm={staffForm}
            setStaffForm={setStaffForm}
            addStaff={addStaff}
            deleteStaff={deleteStaff}
            showSystemToast={showSystemToast}
          />
        )}

        {activePage === "reports" && (
          <ReportsView
            profile={profile}
            customers={reportCustomers}
            reportStats={reportStats}
            repStats={repStats}
            dataStats={dataStats}
            totalCustomers={customerMetric("total", reportCustomers.length)}
            liveReportError={isManagementProfile ? bossLiveReportError : ownCustomerSummaryError}
            generatedAt={isManagementProfile ? bossLiveReport?.generated_at : ownCustomerSummary?.generated_at}
          />
        )}

        {activePage === "account" && (
          <AccountView
            profile={profile}
            profileForm={profileForm}
            setProfileForm={setProfileForm}
            saveOwnProfile={saveOwnProfile}
            uploadAvatar={uploadAvatar}
            uploadingAvatar={uploadingAvatar}
            savingProfile={savingProfile}
            newPassword={newPassword}
            setNewPassword={setNewPassword}
            changePassword={changePassword}
            onlineUserIds={onlineUserIds}
          />
        )}

        {activePage === "messages" && (
          <MessagingView
            profile={profile}
            users={users}
            messages={messages}
            messageTarget={messageTarget}
            selectConversation={selectConversation}
            messageBody={messageBody}
            setMessageBody={setMessageBody}
            sendMessage={sendMessage}
            messagingError={messagingError}
            onlineUserIds={onlineUserIds}
            messageAttachment={messageAttachment}
            setMessageAttachment={setMessageAttachment}
            replyToMessage={replyToMessage}
            setReplyToMessage={setReplyToMessage}
            editingMessage={editingMessage}
            setEditingMessage={setEditingMessage}
            beginEditMessage={beginEditMessage}
            deleteMessage={deleteMessage}
            sendingMessage={sendingMessage}
            customers={visibleCustomers}
            shareCustomerNote={shareCustomerNote}
          />
        )}

        {selectedCustomer && (
          <CustomerModal
            key={selectedCustomer.id}
            selectedCustomer={selectedCustomer}
            closeCustomerModal={closeCustomerModal}
            customerLogs={customerLogs}
            customerLogsLoading={customerLogsLoading}
            customerCalls={customerCalls}
            customerCallsLoading={customerCallsLoading}
            customerSmsLogs={customerSmsLogs}
            customerSmsLogsLoading={customerSmsLogsLoading}
            reloadCustomerSmsLogs={loadCustomerSmsLogs}
            updateCustomer={updateCustomer}
            users={users}
            customers={visibleCustomers}
            profile={profile}
            readOnly={selectedCustomerAccess.readOnly}
            accessReason={selectedCustomerAccess.reason}
          />
        )}

        {callNotice && (
          <CallNoticePopup
            notice={callNotice}
            onOpenCustomer={() => openCallNoticeCustomer(callNotice)}
            onDismiss={() => dismissCallNotice(callNotice.id)}
          />
        )}

        {saleCelebration && (
          <SaleCelebration customerName={saleCelebration.name} onClose={() => setSaleCelebration(null)} />
        )}
      </main>
    </div>
  );
}

function MenuButton({ icon, iconSrc, title, page, tone, activePage, setActivePage, onClickExtra, collapsed }) {
  const toneMap = menuIconTones[tone] || menuIconTones.default;
  const isActive = activePage === page;
  return (
    <button
      onClick={() => {
        if (onClickExtra) onClickExtra();
        setActivePage(page);
      }}
      title={title}
      aria-label={title}
      style={{ ...menuButton, ...(isActive ? menuButtonActive : {}), ...(collapsed ? menuButtonCollapsed : {}) }}
    >
      <span style={{ ...menuIcon, ...(iconSrc ? menuIconWithImage : toneMap), ...(isActive ? menuIconActive : {}) }}>
        {iconSrc ? <img src={iconSrc} alt="" aria-hidden="true" style={{ ...menuIconImage, ...(isActive ? menuIconImageActive : {}) }} /> : icon}
      </span>
      <span style={{ ...menuButtonLabel, ...(collapsed ? menuButtonLabelCollapsed : {}) }}>{title}</span>
    </button>
  );
}

function ClickStat({ title, value, onClick, tone = "total" }) {
  return (
    <button type="button" style={{ ...statCard, ...statCardTones[tone] }} onClick={onClick}>
      <p style={{ opacity: 0.75, margin: 0 }}>{title}</p>
      <h2 style={{ margin: 0 }}>{value}</h2>
    </button>
  );
}

function PipelineRow({ label, value, color, onClick }) {
  return (
    <button type="button" style={pipelineRow} onClick={onClick}>
      <span style={{ ...pipelineDot, background: color }} />
      <span style={pipelineLabel}>{label}</span>
      <strong style={{ ...pipelineValue, color }}>{value.toLocaleString("tr-TR")}</strong>
    </button>
  );
}

function ProfileAvatar({ user, size = 44 }) {
  const name = user?.full_name || user?.email || "?";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const style = {
    ...avatarBase,
    width: size,
    height: size,
    minWidth: size,
    fontSize: Math.max(Math.round(size * 0.32), 12),
  };
  return user?.avatar_url
    ? <img src={user.avatar_url} alt={name} style={{ ...style, objectFit: "cover" }} />
    : <span style={style}>{initials || "?"}</span>;
}

function PresenceBadge({ user, onlineUserIds, compact = false }) {
  const isOnline = !!user?.id && onlineUserIds.includes(user.id);
  const status = !isOnline ? "offline" : user?.availability_status === "busy" ? "busy" : "online";
  const visual = presenceVisuals[status];
  return (
    <span style={{ ...presenceBadge, ...(compact ? presenceBadgeCompact : {}) }} title={visual.label}>
      <span style={{ ...presenceDot, background: visual.color, boxShadow: isOnline ? `0 0 8px ${visual.color}` : "none" }} />
      {visual.label}
    </span>
  );
}

function CustomerForm({ form, setForm, addCustomer, duplicateCustomer }) {
  return (
    <form onSubmit={addCustomer} style={{ ...panelCard, marginTop: 20 }}>
      <h2>Manuel Müşteri Kartı Ekle</h2>
      {duplicateCustomer && (
        <div style={duplicateWarning}>
          Bu telefon zaten {duplicateCustomer.first_name} {duplicateCustomer.last_name} adına kayıtlı.
        </div>
      )}
      <div style={formGrid}>
        <input placeholder="Data adı / parti adı" value={form.batch_name} onChange={(e) => setForm({ ...form, batch_name: e.target.value })} style={inputStyle} />
        <input placeholder="Ad" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} style={inputStyle} />
        <input placeholder="Soyad" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} style={inputStyle} />
        <input placeholder="TC No" value={form.tc_no} onChange={(e) => setForm({ ...form, tc_no: e.target.value })} style={inputStyle} />
        <input placeholder="Telefon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={inputStyle} />
        <input placeholder="Telefon 2" value={form.phone_2} onChange={(e) => setForm({ ...form, phone_2: e.target.value })} style={inputStyle} />
        <input type="datetime-local" value={form.appointment_date} onChange={(e) => setForm({ ...form, appointment_date: e.target.value })} style={inputStyle} />
      </div>
      <textarea placeholder="Not" value={form.info_note} onChange={(e) => setForm({ ...form, info_note: e.target.value })} style={{ ...inputStyle, height: 100 }} />
      <button style={primaryButton}>Müşteri Ekle</button>
    </form>
  );
}

function CustomerTable({
  title,
  data,
  employees,
  profile,
  assignCustomer,
  setSelectedCustomer,
  searchTerm,
  setSearchTerm,
  selectedIds,
  setSelectedIds,
  bulkEmployee,
  setBulkEmployee,
  bulkAssignCustomers,
  exportLabel,
  onExport,
  remoteScope,
  dataVersion,
  defaultSortMode = "newest",
}) {
  const canManage = ["boss", "manager"].includes(profile.role);
  const canViewTc = profile.role !== "employee";
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dataFilter, setDataFilter] = useState("");
  const [appointmentDateFilter, setAppointmentDateFilter] = useState("");
  const [sortMode, setSortMode] = useState(defaultSortMode);
  const [page, setPage] = useState(1);
  const [hiddenAfterAssignIds, setHiddenAfterAssignIds] = useState([]);
  const [remoteRows, setRemoteRows] = useState([]);
  const [remoteTotal, setRemoteTotal] = useState(0);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState("");
  const pageSize = 200;
  const isRemote = Boolean(remoteScope);
  const remoteScopeKey = JSON.stringify(remoteScope || {});
  const remoteScopeConfig = useMemo(() => JSON.parse(remoteScopeKey), [remoteScopeKey]);
  const hiddenAfterAssignSet = useMemo(() => new Set(hiddenAfterAssignIds), [hiddenAfterAssignIds]);
  const debouncedSearchTerm = useDebouncedValue(searchTerm, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    const resetTimer = window.setTimeout(() => {
      setSelectedIds([]);
      setBulkEmployee("");
      setHiddenAfterAssignIds([]);
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [searchTerm, assigneeFilter, genderFilter, statusFilter, dataFilter, appointmentDateFilter, sortMode, remoteScopeKey, page, setSelectedIds, setBulkEmployee]);

  useEffect(() => {
    if (!isRemote) return undefined;
    let cancelled = false;

    async function loadRemotePage() {
      setRemoteLoading(true);
      setRemoteError("");
      const cleanSearch = normalizeCustomerSearch(debouncedSearchTerm);
      const cleanDataFilter = normalizeCustomerSearch(dataFilter);
      const searchDigits = digitsOnly(debouncedSearchTerm);
      const numericSearch = isNumericCustomerSearch(debouncedSearchTerm);
      const exactPhoneSearch = numericSearch && normalizePhone(debouncedSearchTerm).length === 10;

      if (cleanSearch && cleanSearch.length < CUSTOMER_SEARCH_MIN_LENGTH) {
        setRemoteRows([]);
        setRemoteTotal(0);
        setRemoteLoading(false);
        setRemoteError("Arama için en az 3 karakter gir.");
        return;
      }

      let query = supabase
        .from("customers")
        .select(CUSTOMER_SELECT_COLUMNS, { count: cleanSearch && !exactPhoneSearch ? "planned" : REMOTE_CUSTOMER_COUNT_MODE });

      if (remoteScopeConfig.fixedAssignee) query = query.eq("assigned_employee", remoteScopeConfig.fixedAssignee);
      if (remoteScopeConfig.assignmentScope === "pool") query = query.is("assigned_employee", null);
      if (remoteScopeConfig.assignmentScope === "assigned") query = query.not("assigned_employee", "is", null);
      if (remoteScopeConfig.approvedOnly) query = query.eq("approved", true);
      if (remoteScopeConfig.paidOnly) query = query.eq("payment_received", true);
      if (remoteScopeConfig.appointmentBefore) query = query.lt("appointment_date", remoteScopeConfig.appointmentBefore);
      if (remoteScopeConfig.freshAssignedFor) {
        query = query.or(`last_action_by.is.null,last_action_by.neq.${remoteScopeConfig.freshAssignedFor}`);
      }

      if (Array.isArray(remoteScopeConfig.fixedStatuses) && remoteScopeConfig.fixedStatuses.length > 0) {
        query = remoteScopeConfig.fixedStatuses.length === 1
          ? query.eq("status", remoteScopeConfig.fixedStatuses[0])
          : query.in("status", remoteScopeConfig.fixedStatuses);
      }

      if (canManage && !remoteScopeConfig.fixedAssignee) {
        if (assigneeFilter === "pool") query = query.is("assigned_employee", null);
        if (!["all", "pool"].includes(assigneeFilter)) query = query.eq("assigned_employee", assigneeFilter);
      }

      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (cleanDataFilter) query = query.ilike("batch_name", `%${cleanDataFilter}%`);
      if (appointmentDateFilter) {
        const selectedStart = new Date(`${appointmentDateFilter}T00:00:00`);
        const selectedEnd = new Date(selectedStart);
        selectedEnd.setDate(selectedStart.getDate() + 1);
        query = query
          .gte("appointment_date", selectedStart.toISOString())
          .lt("appointment_date", selectedEnd.toISOString());
      }

      if (cleanSearch) {
        if (exactPhoneSearch) {
          const phoneKey = normalizePhone(debouncedSearchTerm);
          const phoneFilters = [`phone_key.eq.${phoneKey}`, `phone_2_key.eq.${phoneKey}`];
          if (searchDigits.length >= 11) phoneFilters.push(`search_text.ilike.%${searchDigits}%`);
          query = query.or(phoneFilters.join(","));
        } else if (numericSearch) {
          query = query.ilike("search_text", `%${searchDigits}%`);
        } else {
          query = query.ilike("search_text", `%${cleanSearch}%`);
        }
      }

      if (sortMode === "appointment_asc" || sortMode === "appointment_desc") {
        query = query
          .order("appointment_date", { ascending: sortMode === "appointment_asc", nullsFirst: false })
          .order("created_at", { ascending: false });
      } else if (sortMode === "data_asc") {
        query = query
          .order("batch_name", { ascending: true, nullsFirst: false })
          .order("batch_page", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false });
      } else if (sortMode === "data_desc") {
        query = query
          .order("batch_name", { ascending: false, nullsFirst: true })
          .order("batch_page", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false });
      } else if (sortMode === "oldest") {
        query = query
          .order("created_at", { ascending: true })
          .order("id", { ascending: true });
      } else if (remoteScopeConfig.orderByAppointment) {
        query = query
          .order("appointment_date", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false });
      } else if (remoteScopeConfig.orderByAssigned) {
        query = query
          .order("assigned_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });
      } else {
        query = query
          .order("created_at", { ascending: false })
          .order("id", { ascending: false });
      }

      const from = (page - 1) * pageSize;
      const { data: rows, error, count } = await runWithRetry(() => query.range(from, from + pageSize - 1), 2);

      if (cancelled) return;
      setRemoteLoading(false);

      if (error) {
        setRemoteRows([]);
        setRemoteTotal(0);
        const timedOut = error.message?.includes("statement timeout") || error.message?.includes("canceling statement");
        setRemoteError(timedOut
          ? "Arama zaman aşımına uğradı. Lütfen daha ayrıntılı bir arama yap."
          : (error.message || "Müşteriler yüklenemedi."));
        return;
      }

      const visibleRows = genderFilter === "all"
        ? rows || []
        : (rows || []).filter((customer) => inferCustomerGender(customer) === genderFilter);
      setRemoteRows(visibleRows);
      setRemoteTotal(Number.isFinite(count) ? count : from + visibleRows.length);
    }

    const refreshTimer = window.setTimeout(loadRemotePage, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
    };
  }, [isRemote, remoteScopeConfig, page, pageSize, assigneeFilter, genderFilter, statusFilter, dataFilter, appointmentDateFilter, sortMode, debouncedSearchTerm, dataVersion, canManage]);

  const searchedData = data
    .filter((customer) => assigneeFilter === "all" ? !hiddenAfterAssignSet.has(customer.id) : true)
    .filter((customer) => customerMatchesSearch(customer, searchTerm));
  const assigneeFilteredData = assigneeFilter === "all"
    ? searchedData
    : assigneeFilter === "pool"
      ? searchedData.filter((customer) => !customer.assigned_employee)
      : searchedData.filter((customer) => customer.assigned_employee === assigneeFilter);
  const genderFilteredData = genderFilter === "all"
    ? assigneeFilteredData
    : assigneeFilteredData.filter((customer) => inferCustomerGender(customer) === genderFilter);
  const filteredData = statusFilter === "all"
    ? genderFilteredData
    : genderFilteredData.filter((customer) => customer.status === statusFilter);
  const cleanLocalDataFilter = normalizeCustomerSearch(dataFilter);
  const dataFilteredData = cleanLocalDataFilter
    ? filteredData.filter((customer) => normalizeCustomerSearch(customer.batch_name).includes(cleanLocalDataFilter))
    : filteredData;
  const showAppointmentSortOptions = Boolean(remoteScopeConfig.orderByAppointment)
    || dataFilteredData.some((customer) => customer.appointment_date);
  const appointmentDateFilteredData = appointmentDateFilter
    ? dataFilteredData.filter((customer) => formatDateInputValue(customer.appointment_date) === appointmentDateFilter)
    : dataFilteredData;
  const sortedData = [...appointmentDateFilteredData].sort((first, second) => {
    if (sortMode === "appointment_asc" || sortMode === "appointment_desc") {
      const firstAppointmentTime = new Date(first.appointment_date || 8640000000000000).getTime();
      const secondAppointmentTime = new Date(second.appointment_date || 8640000000000000).getTime();
      const appointmentCompare = firstAppointmentTime - secondAppointmentTime;
      if (appointmentCompare !== 0) {
        return sortMode === "appointment_asc" ? appointmentCompare : -appointmentCompare;
      }
    }
    if (sortMode === "data_asc" || sortMode === "data_desc") {
      const direction = sortMode === "data_asc" ? 1 : -1;
      const dataCompare = String(first.batch_name || "").localeCompare(String(second.batch_name || ""), "tr-TR", { numeric: true, sensitivity: "base" });
      if (dataCompare !== 0) return dataCompare * direction;
      const pageCompare = (Number(first.batch_page) || 0) - (Number(second.batch_page) || 0);
      if (pageCompare !== 0) return pageCompare;
    }
    const firstTime = new Date(first.created_at || 0).getTime() || 0;
    const secondTime = new Date(second.created_at || 0).getTime() || 0;
    return sortMode === "oldest" ? firstTime - secondTime : secondTime - firstTime;
  });
  const remoteVisibleRows = remoteRows.filter((customer) => !hiddenAfterAssignSet.has(customer.id));
  const displayedTotal = isRemote ? remoteTotal : sortedData.length;
  const pageCount = Math.max(Math.ceil(displayedTotal / pageSize), 1);
  const currentPage = Math.min(page, pageCount);
  const pageData = isRemote
    ? remoteVisibleRows
    : sortedData.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const exportRows = isRemote ? pageData : sortedData;
  const hasDisplayedRows = pageData.length > 0;

  function clearAssignmentHiding() {
    setHiddenAfterAssignIds([]);
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleAssignCustomer(customer, employeeId) {
    const assigned = await assignCustomer(customer, employeeId);
    if (assigned && assigneeFilter === "all" && !customer.assigned_employee && employeeId) {
      setHiddenAfterAssignIds((current) => current.includes(customer.id) ? current : [...current, customer.id]);
    }
  }

  async function handleBulkAssignCustomers() {
    const idsToHide = bulkEmployee && bulkEmployee !== "__pool__" && assigneeFilter === "all"
      ? selectedIds
      : [];
    const assigned = await bulkAssignCustomers();
    if (assigned && idsToHide.length > 0) {
      setHiddenAfterAssignIds((current) => [...new Set([...current, ...idsToHide])]);
    }
  }

  function renderPagination(position = "bottom") {
    if (pageCount <= 1) return null;
    return (
      <div style={{ ...paginationBar, ...(position === "top" ? topPaginationBar : {}) }}>
        <button type="button" style={paginationButton} disabled={currentPage === 1} onClick={() => setPage(1)}>İlk</button>
        <button type="button" style={paginationButton} disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(value - 1, 1))}>Önceki</button>
        <strong>{currentPage} / {pageCount}</strong>
        <button type="button" style={paginationButton} disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(value + 1, pageCount))}>Sonraki {pageSize}</button>
        <button type="button" style={paginationButton} disabled={currentPage === pageCount} onClick={() => setPage(pageCount)}>Son</button>
      </div>
    );
  }

  return (
    <div style={panelCard}>
      <div style={tableTitleRow}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {onExport && (
          <button
            type="button"
            disabled={exportRows.length === 0}
            onClick={() => onExport(exportRows)}
            style={{ ...exportExcelButton, opacity: exportRows.length === 0 ? 0.6 : 1 }}
          >
            {exportLabel || "Excel'e Aktar"}
          </button>
        )}
      </div>

      <div style={customerToolbar}>
        <input
          placeholder="Müşteri ara: isim, telefon, TC, data adı..."
          value={searchTerm}
          onChange={(event) => {
            setSearchTerm(event.target.value);
            clearAssignmentHiding();
            setPage(1);
          }}
          style={{ ...searchInput, marginBottom: 0 }}
        />
        {canManage && (
          <select value={assigneeFilter} onChange={(event) => { setAssigneeFilter(event.target.value); clearAssignmentHiding(); setPage(1); }} style={toolbarSelect}>
            <option value="all">Tüm sorumlular</option>
            <option value="pool">Atanmamış müşteriler</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.full_name || employee.email}</option>
            ))}
          </select>
        )}
        <select value={genderFilter} onChange={(event) => { setGenderFilter(event.target.value); clearAssignmentHiding(); setPage(1); }} style={toolbarSelect}>
          <option value="all">Kadın / erkek: Tümü</option>
          <option value="female">Kadın (isim tahmini)</option>
          <option value="male">Erkek (isim tahmini)</option>
          <option value="unknown">Unisex isimler</option>
        </select>
        <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); clearAssignmentHiding(); setPage(1); }} style={toolbarSelect}>
          <option value="all">Tüm durumlar</option>
          {[...CUSTOMER_STATUSES].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </select>
        <input
          placeholder="Data filtrele: data100, Hitit Ayaş..."
          value={dataFilter}
          onChange={(event) => {
            setDataFilter(event.target.value);
            clearAssignmentHiding();
            setPage(1);
          }}
          style={{ ...toolbarSelect, minWidth: 220 }}
        />
        {showAppointmentSortOptions && (
          <input
            type="date"
            value={appointmentDateFilter}
            onChange={(event) => {
              setAppointmentDateFilter(event.target.value);
              clearAssignmentHiding();
              setPage(1);
            }}
            title="Takip / randevu tarihi seç"
            style={{ ...toolbarSelect, minWidth: 170 }}
          />
        )}
        <select value={sortMode} onChange={(event) => { setSortMode(event.target.value); clearAssignmentHiding(); setPage(1); }} style={toolbarSelect}>
          {showAppointmentSortOptions && <option value="appointment_asc">Sıralama: Takip tarihi yakın</option>}
          {showAppointmentSortOptions && <option value="appointment_desc">Sıralama: Takip tarihi uzak</option>}
          <option value="newest">Sıralama: Yeni eklenenler</option>
          <option value="oldest">Sıralama: Eski eklenenler</option>
          <option value="data_asc">Sıralama: Data A-Z</option>
          <option value="data_desc">Sıralama: Data Z-A</option>
        </select>
      </div>

      <div style={tableSummary}>
        <span>{displayedTotal.toLocaleString("tr-TR")} müşteri</span>
        <span>{currentPage}. sayfa / {pageCount}</span>
      </div>

      {remoteLoading && <div style={syncNotice}>Müşteriler yükleniyor...</div>}
      {remoteError && <div style={duplicateWarning}>{remoteError}</div>}

      {renderPagination("top")}

      {canManage && !["all", "pool"].includes(assigneeFilter) && displayedTotal > 0 && (
        <div style={releaseRepBar}>
          <span>Seçili Rep'in üzerindeki bütün müşterileri havuza geri alabilirsin.</span>
          <button
            type="button"
            style={releaseToPoolButton}
            onClick={() => bulkAssignCustomers(null, "__pool__", assigneeFilter)}
          >
            Repteki Tümünü Havuza Al
          </button>
        </div>
      )}

      {canManage && (
        <div style={bulkBar}>
          <strong>Seçili: {selectedIds.length}</strong>
          <button
            type="button"
            style={smallButton}
            onClick={() => {
              const ids = pageData.map((customer) => customer.id);
              const allSelected = ids.every((id) => selectedIds.includes(id));
              setSelectedIds(allSelected ? [] : ids);
            }}
          >
            Sayfadaki {pageData.length.toLocaleString("tr-TR")} Kişiyi Seç
          </button>
          <select value={bulkEmployee} onChange={(event) => setBulkEmployee(event.target.value)} style={selectStyle}>
            <option value="">Rep / manager seç</option>
            <option value="__pool__">↩ Seçilenleri Havuza Al</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.full_name || employee.email}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleBulkAssignCustomers} style={smallButton}>
            {bulkEmployee === "__pool__" ? "Seçilenleri Havuza Al" : "Seçilenleri Ata"}
          </button>
        </div>
      )}

      <div style={tableWrapper}>
        <div style={{ ...tableHeader, ...(canViewTc ? {} : tableWithoutTc) }}>
          <div>{canManage ? "Seç" : ""}</div>
          <div>Müşteri</div>
          <div>Detay</div>
          <div>Telefon</div>
          <div>Telefon 2</div>
          {canViewTc && <div>TC No</div>}
          <div>Data</div>
          <div>Takip</div>
          <div>Atanan</div>
        </div>

        {pageData.map((customer) => (
          <div key={customer.id} style={{ ...tableRow, ...(canViewTc ? {} : tableWithoutTc), borderLeft: `4px solid ${customerHeat(customer.status).color}` }}>
            <div>
              {canManage && (
                <input type="checkbox" checked={selectedIds.includes(customer.id)} onChange={() => toggleSelected(customer.id)} />
              )}
            </div>
            <div style={customerNameCell}>
              <div style={customerNameLine}>
                <strong>{customer.first_name} {customer.last_name}</strong>
                {isFreshAssignedCustomer(customer) && <span style={freshCustomerBadge}>Yeni</span>}
              </div>
              <div title={statusLabel(customer.status)} aria-label={statusLabel(customer.status)} style={{ ...customerStatusLine, background: customerHeat(customer.status).color }} />
            </div>
            <div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(customer)}
                style={smallButton}
              >
                Detay
              </button>
            </div>
            <div><a href={`tel:${phoneDialValue(customer.phone)}`} style={phoneLink}>{formatPhoneDisplay(customer.phone)}</a></div>
            <div>{customer.phone_2 ? <a href={`tel:${phoneDialValue(customer.phone_2)}`} style={phoneLink}>{formatPhoneDisplay(customer.phone_2)}</a> : "-"}</div>
            {canViewTc && <div>{customer.tc_no || "-"}</div>}
            <div>{customer.batch_name || "-"}</div>
            <div>{formatDateTime(customer.appointment_date)}</div>
            <div>
              {canManage ? (
                <select value={customer.assigned_employee || ""} onChange={(event) => handleAssignCustomer(customer, event.target.value)} style={selectStyle}>
                  <option value="">Havuzda</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.full_name || employee.email}</option>
                  ))}
                </select>
              ) : "Ben"}
            </div>
          </div>
        ))}

        {!hasDisplayedRows && !remoteLoading && (
          <div style={emptyTableState}>Bu filtrede müşteri yok.</div>
        )}
      </div>

      {renderPagination("bottom")}
    </div>
  );
}

function CustomerModal({ selectedCustomer, closeCustomerModal, customerLogs, customerLogsLoading, customerCalls, customerCallsLoading, customerSmsLogs, customerSmsLogsLoading, reloadCustomerSmsLogs, updateCustomer, users, customers, profile, readOnly = false, accessReason = "" }) {
  const [detailStatus, setDetailStatus] = useState(selectedCustomer.status || "assigned");
  const [detailNote, setDetailNote] = useState("");
  const [notApprovedReason, setNotApprovedReason] = useState("");
  const [appointmentDate, setAppointmentDate] = useState(toDateTimeInputValue(selectedCustomer.appointment_date));
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [smsComposerOpen, setSmsComposerOpen] = useState(false);
  const [smsMessage, setSmsMessage] = useState(DEFAULT_SMS_MESSAGE);
  const [sendingSms, setSendingSms] = useState(false);
  const needsAppointment = detailStatus === "appointment";
  const needsFollowUpDate = needsAppointment;
  const heat = customerHeat(detailStatus);
  const callTone = customerCallStatusTone(customerCalls);
  const duplicateCustomer = findDuplicateCustomer(customers, selectedCustomer.phone, selectedCustomer.id);
  const hasRelatedPhoneLogs = customerLogs.some((log) => String(log.customer_id) !== String(selectedCustomer.id));
  const showSmsComposer = smsComposerOpen && !readOnly;

  async function sendCustomerSms() {
    if (readOnly) {
      alert("Bu müşteri kartı sadece bilgi amaçlı açıldı. SMS göndermek için müşteri sahibi rep işlem yapmalı.");
      return;
    }
    if (sendingSms) return;
    const phone = normalizePhone(selectedCustomer.phone);
    const message = smsMessage.trim();

    if (!isTurkishMobile(phone)) {
      alert("SMS göndermek için müşterinin geçerli bir cep telefonu olmalı.");
      return;
    }
    if (!message) {
      alert("SMS metnini yazın.");
      return;
    }

    setSendingSms(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-sms", {
        body: { phone, message, customerId: selectedCustomer.id },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error) || error.message);
      if (!data?.success) throw new Error(data?.error || "SMS sağlayıcısı gönderimi kabul etmedi.");

      setSmsMessage(DEFAULT_SMS_MESSAGE);
      setSmsComposerOpen(false);
      await reloadCustomerSmsLogs(selectedCustomer);
      alert(`SMS gönderildi. Gönderim no: ${data.messageId || "-"}`);
    } catch (error) {
      await reloadCustomerSmsLogs(selectedCustomer);
      alert("SMS gönderilemedi: " + (error?.message || "Bilinmeyen hata"));
    } finally {
      setSendingSms(false);
    }
  }

  async function saveCustomer() {
    if (readOnly) {
      alert("Bu müşteri kartı sadece bilgi amaçlı açıldı. Durum/not değişikliği müşteri sahibi rep tarafından yapılmalı.");
      return;
    }
    if (savingCustomer) return;
    if (!CUSTOMER_STATUSES.has(detailStatus)) {
      alert("Geçersiz müşteri durumu seçildi. Sayfayı yenileyip tekrar dene.");
      return;
    }
    if (detailStatus === "not_approved" && !notApprovedReason) {
      alert("Yapmayacak durumu için bir neden seçin.");
      return;
    }
    if (detailStatus === "not_approved" && notApprovedReason === "Diğer" && !detailNote.trim()) {
      alert("Diğer nedeni seçildiğinde kısa bir açıklama yazın.");
      return;
    }
    if (needsAppointment && !appointmentDate) {
      alert("Randevu kaydı için randevu tarihi ve saati zorunlu.");
      return;
    }

    const updates = {
      appointment_date: needsFollowUpDate ? appointmentDate || null : null,
      status: detailStatus,
      approved: ["approved", "paid"].includes(detailStatus),
      payment_received: detailStatus === "paid",
    };

    const note = detailStatus === "not_approved"
      ? [notApprovedReason, detailNote.trim()].filter(Boolean).join(": ")
      : detailStatus === "wrong_number"
        ? "Numara yanlış"
        : detailNote.trim();

    if (note) updates.info_note = note;
    setSavingCustomer(true);
    try {
      const saved = await updateCustomer(selectedCustomer.id, updates);
      if (saved) {
        setDetailNote("");
        closeCustomerModal();
      }
    } finally {
      setSavingCustomer(false);
    }
  }

  function handleSaveShortcut(event) {
    if (readOnly) return;
    if (event.key !== "Enter" || savingCustomer) return;
    const tagName = event.target?.tagName?.toLowerCase();
    const isTextarea = tagName === "textarea";
    if (isTextarea && !(event.ctrlKey || event.metaKey)) return;
    if (tagName === "select") return;

    event.preventDefault();
    saveCustomer();
  }

  const statusButtons = [
    ["assigned", "Yeni", "new"],
    ["no_answer", "Ulaşılamadı", "muted"],
    ["busy", "Meşgul", "warn"],
    ["callback", "Sonra ara", "callback"],
    ["appointment", "Randevu", "appointment"],
    ["contract_appointment", "Sözleşmeli", "contract"],
    ["not_approved", "Yapmayacak", "danger"],
    ["wrong_number", "Numara yanlış", "muted"],
    ["using", "Kullanıyor", "using"],
    ["approved", "Onaylandı", "success"],
    ["paid", "Satış", "paid"],
  ];

  return (
    <div
      style={modalBg}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeCustomerModal();
      }}
    >
      <div style={modalCard} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={closeCustomerModal} style={closeButton} aria-label="Detayı kapat">X</button>

        <div style={customerHero}>
          <div style={{ ...customerHeatBar, background: heat.color }} />
          <h2 style={customerHeroTitle}>
            {selectedCustomer.first_name} {selectedCustomer.last_name}
          </h2>
          <div style={customerSummary}>
            <span style={{ ...heatBadge, background: callTone.background, color: callTone.color }}>{customerCallStatusLabel(customerCalls)}</span>
            <span style={{ ...heatBadge, background: heat.background, color: heat.color }}>Durum: {statusLabel(detailStatus)}</span>
            <span style={customerSummaryText}>
              {customerLogsLoading
                ? "İşlem geçmişi yükleniyor..."
                : customerLogs.length ? `${customerLogs.length} işlem kaydı var${hasRelatedPhoneLogs ? " (aynı telefon dahil)" : ""}` : "Henüz işlem kaydı yok"}
            </span>
          </div>
          <div style={customerInfoGrid}>
            <div style={infoPill}>📞 {formatPhoneDisplay(selectedCustomer.phone)}</div>
            <div style={infoPill}>📱 {formatPhoneDisplay(selectedCustomer.phone_2)}</div>
            {profile?.role !== "employee" && <div style={infoPill}>🪪 TC: {selectedCustomer.tc_no || "-"}</div>}
            <div style={infoPill}>📁 {selectedCustomer.batch_name || "-"} / Sayfa {selectedCustomer.batch_page || "-"}</div>
          </div>
          {duplicateCustomer && (
            <div style={duplicateWarning}>
              Aynı telefon {duplicateCustomer.first_name} {duplicateCustomer.last_name} adına da kayıtlı.
            </div>
          )}
        </div>

        <div style={quickActions}>
          {readOnly
            ? <span style={{ ...quickActionButton, opacity: 0.55, cursor: "not-allowed" }}>Ara</span>
            : <a href={`tel:${phoneDialValue(selectedCustomer.phone)}`} style={quickActionButton}>Ara</a>}
          <button type="button" disabled={readOnly} style={{ ...quickActionButton, opacity: readOnly ? 0.55 : 1 }} onClick={() => setSmsComposerOpen((value) => !value)}>
            SMS Gönder
          </button>
          {readOnly
            ? <span style={{ ...quickActionButton, opacity: 0.55, cursor: "not-allowed" }}>WhatsApp</span>
            : (
              <a
                href={`https://wa.me/${whatsappPhone(selectedCustomer.phone)}`}
                target="_blank"
                rel="noreferrer"
                style={quickActionButton}
              >
                WhatsApp
              </a>
            )}
          <button
            type="button"
            disabled={readOnly}
            style={{ ...quickActionButton, opacity: readOnly ? 0.55 : 1 }}
            onClick={() => {
              const phone = normalizePhone(selectedCustomer.phone);
              window.open(`https://wa.me/90${phone}?text=${encodeURIComponent(COMPANY_MESSAGE)}`, "_blank");
            }}
          >
            Bilgileri Gönder
          </button>
          <a href={COMPANY_LOCATION_URL} target="_blank" rel="noreferrer" style={quickActionButton}>Konum</a>
          <button type="button" disabled={readOnly} onClick={() => setDetailStatus("wrong_number")} style={{ ...quickActionButton, ...wrongNumberButton, opacity: readOnly ? 0.55 : 1 }}>
            Numara yanlış
          </button>
        </div>

        {readOnly && accessReason && (
          <div style={messageSetupNotice}>
            {accessReason}
          </div>
        )}

        {showSmsComposer && (
          <div style={{ ...panelCard, margin: "0 0 18px", padding: 16 }}>
            <label style={fieldLabel}>SMS — {formatPhoneDisplay(selectedCustomer.phone)}</label>
            <textarea
              value={smsMessage}
              onChange={(event) => setSmsMessage(event.target.value)}
              maxLength={1530}
              placeholder="Kurumsal mesajı düzenleyebilir, randevu tarih ve saatini ekleyebilirsiniz..."
              style={{ ...inputStyle, minHeight: 110, resize: "vertical" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 10 }}>
              <small style={{ opacity: 0.7 }}>{smsMessage.length} / 1530 karakter</small>
              <button
                type="button"
                disabled={sendingSms || !smsMessage.trim()}
                onClick={sendCustomerSms}
                style={{ ...primaryButton, opacity: sendingSms || !smsMessage.trim() ? 0.6 : 1 }}
              >
                {sendingSms ? "Gönderiliyor..." : "SMS'i Gönder"}
              </button>
            </div>
          </div>
        )}

        <div style={detailLayout} onKeyDown={handleSaveShortcut}>
          <div style={statusRail}>
            <h3 style={railTitle}>Durum Menüsü</h3>
            {statusButtons.map(([value, label, tone]) => (
              <button
                key={value}
                type="button"
                aria-pressed={detailStatus === value}
                disabled={readOnly}
                onClick={() => setDetailStatus(value)}
                style={{ ...statusMenuButton, ...statusMenuTone[tone], ...(detailStatus === value ? statusMenuActive : {}), opacity: readOnly ? 0.58 : 1 }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={detailFormColumn}>
            {detailStatus === "not_approved" && (
              <>
                <label style={fieldLabel}>Yapmama nedeni (zorunlu)</label>
                <select value={notApprovedReason} onChange={(event) => setNotApprovedReason(event.target.value)} disabled={readOnly} style={{ ...inputStyle, opacity: readOnly ? 0.7 : 1 }}>
                  <option value="">Neden seçin</option>
                  <option value="Satılmış">Satılmış</option>
                  <option value="Davalı / Avukatlık">Davalı / Avukatlık</option>
                  <option value="İlgilenmiyor">İlgilenmiyor</option>
                  <option value="Vazgeçti">Vazgeçti</option>
                  <option value="Diğer">Diğer</option>
                </select>
              </>
            )}

            <label style={fieldLabel}>{detailStatus === "not_approved" ? "Ek açıklama" : "İşlem notu"}</label>
            <textarea
              value={detailNote}
              onChange={(event) => setDetailNote(event.target.value)}
              disabled={readOnly}
              placeholder={detailStatus === "not_approved" ? "Gerekirse kısa bir açıklama ekleyin..." : "Bu işlem için yeni not bırakın..."}
              style={{ ...inputStyle, minHeight: 140, resize: "vertical", opacity: readOnly ? 0.7 : 1 }}
            />

            {needsFollowUpDate && (
              <>
                <label style={fieldLabel}>Randevu tarihi ve saati (zorunlu)</label>
                <input
                  id="detailAppointment"
                  type="datetime-local"
                  value={appointmentDate}
                  onChange={(event) => setAppointmentDate(event.target.value)}
                  disabled={readOnly}
                  required={needsFollowUpDate}
                  style={{ ...inputStyle, borderColor: "#fbbf24", opacity: readOnly ? 0.7 : 1 }}
                />
              </>
            )}

            <button
              type="button"
              disabled={savingCustomer || readOnly}
              style={{ ...primaryButton, opacity: savingCustomer || readOnly ? 0.65 : 1, marginTop: 8 }}
              onClick={saveCustomer}
            >
              {readOnly ? "Sadece görüntüleme" : savingCustomer ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </div>

        <h3 style={historyTitle}>Arama Geçmişi</h3>
        {customerCallsLoading && <p style={logLoadingText}>Arama geçmişi yükleniyor...</p>}
        {!customerCallsLoading && customerCalls.length === 0 && <p style={{ opacity: 0.7 }}>Henüz arama kaydı bulunamadı.</p>}
        <h3 style={historyTitle}>SMS Gecmisi</h3>
        {customerSmsLogsLoading && <p style={logLoadingText}>SMS gecmisi yukleniyor...</p>}
        {!customerSmsLogsLoading && customerSmsLogs.length === 0 && <p style={{ opacity: 0.7 }}>Henuz SMS kaydi bulunamadi.</p>}
        {!customerSmsLogsLoading && customerSmsLogs.map((sms) => (
          <div key={sms.id} style={{ ...logBox, borderLeft: `4px solid ${sms.status === "sent" ? "#22c55e" : "#ef4444"}` }}>
            <strong style={logUser}>SMS {sms.status === "sent" ? "gonderildi" : "basarisiz"}</strong>
            <p style={logStatusRow}>
              {formatPhoneDisplay(sms.phone)} · Kod: {sms.provider_code || "-"} · Gonderim no: {sms.provider_message_id || "-"}
            </p>
            <p style={logNote}>Temsilci: {users.find((user) => user.id === sms.user_id)?.full_name || "Bilinmeyen kullanici"}</p>
            {sms.error_message && <p style={logEmptyNote}>{sms.error_message}</p>}
            <p style={logNote}>{sms.message}</p>
            <small style={logTime}>{formatDateTime(sms.created_at)}</small>
          </div>
        ))}

        {!customerCallsLoading && customerCalls.map((call) => (
          <div key={call.id} style={{ ...logBox, borderLeft: `4px solid ${call.status === "missed" ? "#ef4444" : call.ended_at ? "#22c55e" : "#38bdf8"}` }}>
            <strong style={logUser}>
              {call.direction === "incoming" ? "Gelen arama" : "Giden arama"} · {callStatusLabel(call)}
            </strong>
            <p style={logStatusRow}>
              {formatPhoneDisplay(call.phone)} · Süre: {formatCallDuration(call.duration_seconds)}
            </p>
            <p style={logNote}>
              Temsilci: {users.find((user) => user.id === call.profile_id)?.full_name || "Bilinmeyen kullanıcı"}
            </p>
            {(call.caller_name || call.extension || call.transfer_target || call.provider) && (
              <p style={logNote}>
                Kaynak: {callProviderLabel(call)}
                {call.caller_name ? ` · Arayan: ${call.caller_name}` : ""}
                {call.extension ? ` · Dahili: ${call.extension}` : ""}
                {call.transfer_target ? ` · Yonlendirme: ${call.transfer_target}` : ""}
              </p>
            )}
            {call.recording_url && (
              <a href={call.recording_url} target="_blank" rel="noreferrer" style={phoneLink}>Arama kaydini dinle</a>
            )}
            <small style={logTime}>{formatDateTime(call.ringing_at || call.started_at || call.created_at)}</small>
          </div>
        ))}

        <h3 style={historyTitle}>İşlem Geçmişi</h3>
        {customerLogsLoading && <p style={logLoadingText}>İşlem geçmişi yükleniyor...</p>}
        {!customerLogsLoading && customerLogs.length === 0 && <p style={{ opacity: 0.7 }}>Henüz işlem kaydı bulunamadı.</p>}

        {!customerLogsLoading && customerLogs.map((log) => {
          const sourceLabel = customerLogSourceLabel(log, selectedCustomer, customers);
          return (
            <div key={log.id} style={{ ...logBox, borderLeft: `4px solid ${customerHeat(log.new_status).color}` }}>
              <strong style={logUser}>
                İşlem yapan: {
                  users.find((user) => user.id === log.user_id)?.full_name
                  || users.find((user) => user.id === log.user_id)?.email
                  || "Bilinmeyen kullanıcı"
                }
              </strong>
              {sourceLabel && <small style={logSourceText}>{sourceLabel}</small>}
              <p style={logStatusRow}>Durum: {statusLabel(log.old_status)} → <span style={statusBadge(log.new_status)}>{statusLabel(log.new_status)}</span></p>
              {log.note ? <p style={logNote}>{log.note}</p> : <p style={logEmptyNote}>Not bırakılmadı.</p>}
              <small style={logTime}>{formatDateTime(log.created_at)}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NotesView({ myNotes, myNoteBody, setMyNoteBody, addMyNote, deleteMyNote, notesLoading, notesError, savingNote }) {
  const orderedNotes = [...myNotes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const groupedNotes = groupNotesByDay(orderedNotes);
  const latestNote = orderedNotes[0];
  const todayLabel = formatLongDate(new Date());
  const latestLabel = latestNote ? getNoteDayLabel(latestNote.created_at) : "Bugün";
  const latestDateText = latestNote ? formatLongDate(latestNote.created_at) : todayLabel;
  const setupMissing = notesError?.includes("kurulumu eksik");

  return (
    <section style={panelCard}>
      <div style={notesHeader}>
        <div>
          <span style={notesEyebrow}>Kişisel alan</span>
          <h2 style={{ ...sectionTitle, fontSize: 28, marginBottom: 4 }}>Notlarım</h2>
          <p style={mutedText}>Kendi kişisel notlarını burada sakla. Notlar gün bazlı gruplanır.</p>
        </div>
        <div style={notesHeaderStats}>
          <div style={notesStatCard}>
            <span style={notesStatLabel}>Toplam not</span>
            <strong style={notesStatValue}>{notesLoading ? "..." : myNotes.length}</strong>
          </div>
          <div style={notesStatCardSoft}>
            <span style={notesStatLabel}>Son kayıt günü</span>
            <strong style={notesStatValue}>{latestLabel}</strong>
            <small style={notesStatSubValue}>{latestDateText}</small>
          </div>
        </div>
      </div>

      {notesError && (
        <div style={notesSetupNotice}>
          <div style={notesSetupIcon}>⚠</div>
          <div style={{ flex: 1 }}>
            <strong style={notesSetupTitle}>Notlar kurulumu eksik</strong>
            <p style={notesSetupText}>{notesError}</p>
            {setupMissing && (
              <ul style={notesSetupList}>
                <li>Supabase'te <strong>MY_NOTES.sql</strong> dosyasını bir kez çalıştır.</li>
                <li>Kurulumdan sonra sayfayı yenile.</li>
                <li>İlk not eklendiğinde aşağıda gün başlığı otomatik görünür.</li>
              </ul>
            )}
          </div>
        </div>
      )}

      <form onSubmit={addMyNote} style={notesComposer}>
        <div style={notesComposerHeader}>
          <strong>Yeni not</strong>
          <span style={notesComposerHint}>Tarih ve saat otomatik kaydedilir</span>
        </div>
        <textarea
          value={myNoteBody}
          onChange={(event) => setMyNoteBody(event.target.value)}
          placeholder="Yeni not yaz..."
          style={{ ...inputStyle, minHeight: 120, resize: "vertical", marginBottom: 0 }}
        />
        <div style={notesComposerActions}>
          <span style={mutedText}>{notesLoading ? "Notlar yükleniyor..." : `${myNotes.length} not`}</span>
          <button type="submit" disabled={savingNote || !myNoteBody.trim()} style={primaryButton}>
            {savingNote ? "Kaydediliyor..." : "Not Ekle"}
          </button>
        </div>
      </form>

      <div style={notesGrid}>
        {orderedNotes.length === 0 && !notesLoading && (
          <div style={notesEmptyState}>
            <strong>Henüz not yok.</strong>
            <p style={mutedText}>İlk notunu yukarıdan ekleyebilirsin. Sonra notlar gün gün gruplanmış halde burada görünür.</p>
          </div>
        )}

        {groupedNotes.map((group) => (
          <section key={group.key} style={notesDaySection}>
            <div style={notesDayHeader}>
              <div>
                <strong style={notesDayLabel}>{group.label}</strong>
                <p style={notesDayDate}>{group.dateText}</p>
              </div>
              <span style={notesDayCount}>{group.notes.length} not</span>
            </div>

            <div style={notesDayList}>
              {group.notes.map((note, index) => (
                <article key={note.id} style={noteCard}>
                  <div style={noteCardTop}>
                    <div style={noteMetaRow}>
                      <span style={noteBadge}>#{index + 1}</span>
                      <span style={noteMetaChip}>{formatTime(note.created_at)}</span>
                    </div>
                    <button type="button" onClick={() => deleteMyNote(note.id)} style={noteDeleteButton}>Sil</button>
                  </div>
                  <p style={noteBody}>{note.body}</p>
                  <small style={noteMeta}>{formatDateTime(note.created_at)}</small>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function AccountView({ profile, profileForm, setProfileForm, saveOwnProfile, uploadAvatar, uploadingAvatar, savingProfile, newPassword, setNewPassword, changePassword, onlineUserIds }) {
  return (
    <div style={accountLayout}>
      <section style={accountHero}>
        <ProfileAvatar user={profile} size={88} />
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{profile.full_name || profile.email}</h2>
          <p style={{ margin: "6px 0 0", opacity: 0.75 }}>{profile.email}</p>
          <PresenceBadge user={profile} onlineUserIds={onlineUserIds} />
        </div>
        <label style={avatarUploadButton}>
          {uploadingAvatar ? "Yükleniyor..." : "Profil Fotoğrafı"}
          <input type="file" accept="image/*" hidden onChange={uploadAvatar} disabled={uploadingAvatar} />
        </label>
      </section>

      <div style={accountGrid}>
        <form onSubmit={saveOwnProfile} style={panelCard}>
          <h2 style={sectionTitle}>Profil Bilgileri</h2>
          <label style={fieldLabel}>Ad Soyad</label>
          <input placeholder="Ad soyad" value={profileForm.full_name} onChange={(event) => setProfileForm({ ...profileForm, full_name: event.target.value })} style={inputStyle} />
          <label style={fieldLabel}>Telefon</label>
          <input placeholder="Telefon numarası" value={profileForm.phone} onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })} style={inputStyle} />
          <label style={fieldLabel}>Çalışma Durumu</label>
          <div style={availabilityControl}>
            <button type="button" onClick={() => setProfileForm({ ...profileForm, availability_status: "online" })} style={profileForm.availability_status === "online" ? availabilityOnlineActive : availabilityButton}>Çevrimiçi</button>
            <button type="button" onClick={() => setProfileForm({ ...profileForm, availability_status: "busy" })} style={profileForm.availability_status === "busy" ? availabilityBusyActive : availabilityButton}>Meşgul</button>
          </div>
          <button type="submit" disabled={savingProfile} style={primaryButton}>{savingProfile ? "Kaydediliyor..." : "Profili Kaydet"}</button>
        </form>

        <form onSubmit={changePassword} style={panelCard}>
          <h2 style={sectionTitle}>Güvenlik</h2>
          <div style={accountEmailBox}>
            <span style={workSummaryLabel}>Giriş e-postası</span>
            <strong>{profile.email}</strong>
          </div>
          <label style={fieldLabel}>Yeni Şifre</label>
          <input type="password" autoComplete="new-password" placeholder="En az 6 karakter" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} style={inputStyle} />
          <button type="submit" style={securityButton}>Şifreyi Değiştir</button>
        </form>
      </div>
    </div>
  );
}

function MessagingView({ profile, users, messages, messageTarget, selectConversation, messageBody, setMessageBody, sendMessage, messagingError, onlineUserIds, messageAttachment, setMessageAttachment, replyToMessage, setReplyToMessage, editingMessage, setEditingMessage, beginEditMessage, deleteMessage, sendingMessage, customers, shareCustomerNote }) {
  const [contactSearch, setContactSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [customerShareQuery, setCustomerShareQuery] = useState("");
  const [selectedShareCustomerId, setSelectedShareCustomerId] = useState("");
  const [sharingCustomerId, setSharingCustomerId] = useState("");
  const messageEndRef = useRef(null);
  const allContacts = users.filter((user) => user.id !== profile.id);
  const contacts = allContacts
    .filter((user) => `${user.full_name || ""} ${user.email || ""}`.toLowerCase().includes(contactSearch.toLowerCase()))
    .sort((a, b) => {
      const lastFor = (id) => messages.filter((message) =>
        (message.sender_id === profile.id && message.recipient_id === id)
        || (message.sender_id === id && message.recipient_id === profile.id)
      ).at(-1)?.created_at || "";
      return lastFor(b.id).localeCompare(lastFor(a.id));
    });
  const activeContact = allContacts.find((user) => user.id === messageTarget);
  const visibleMessages = messages
    .filter((message) => {
      if (messageTarget === "general") return message.recipient_id === null;
      return (message.sender_id === profile.id && message.recipient_id === messageTarget)
        || (message.sender_id === messageTarget && message.recipient_id === profile.id);
    })
    .filter((message) => `${message.body} ${message.attachment_name || ""}`.toLowerCase().includes(messageSearch.toLowerCase()));
  const userMap = new Map([...users, profile].map((user) => [user.id, user]));
  const messageMap = new Map(messages.map((message) => [message.id, message]));
  const shareCustomerOptions = customers
    .filter((customer) => {
      const haystack = `${customerFullName(customer)} ${customer.phone || ""} ${customer.phone_2 || ""} ${customer.tc_no || ""} ${customer.batch_name || ""}`.toLowerCase();
      return haystack.includes(customerShareQuery.toLowerCase());
    })
    .slice(0, 80);
  const selectedShareCustomer = customers.find((customer) => String(customer.id) === selectedShareCustomerId);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messageTarget, visibleMessages.length]);

  function cancelComposerMode() {
    setReplyToMessage(null);
    setEditingMessage(null);
    setMessageBody("");
  }

  async function shareSelectedCustomer() {
    if (!selectedShareCustomer) return;
    const note = selectedShareCustomer.info_note?.trim() || "Müşteri kartı paylaşıldı.";

    setSharingCustomerId(String(selectedShareCustomer.id));
    try {
      const sent = await shareCustomerNote({
        customer: selectedShareCustomer,
        note,
        targetId: messageTarget,
      });
      if (sent) {
        setSelectedShareCustomerId("");
        setCustomerShareQuery("");
      }
    } finally {
      setSharingCustomerId("");
    }
  }

  return (
    <div style={messagingLayout}>
      <aside style={conversationSidebar}>
        <div style={conversationHeading}>
          <span style={welcomeEyebrow}>İletişim</span>
          <h2 style={sectionTitle}>Mesajlar</h2>
        </div>
        <input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Çalışan ara..." style={contactSearchInput} />
        <button type="button" onClick={() => selectConversation("general")} style={messageTarget === "general" ? conversationButtonActive : conversationButton}>
          <span style={generalAvatar}>#</span>
          <span><strong>Genel</strong><small style={contactRole}>Tüm ofis</small></span>
        </button>
        <div style={contactDivider}>Çalışanlar</div>
        {contacts.map((contact) => {
          const unread = messages.filter((message) => message.sender_id === contact.id && message.recipient_id === profile.id && !message.read_at).length;
          const lastMessage = messages.filter((message) =>
            (message.sender_id === profile.id && message.recipient_id === contact.id)
            || (message.sender_id === contact.id && message.recipient_id === profile.id)
          ).at(-1);
          return (
            <button key={contact.id} type="button" onClick={() => selectConversation(contact.id)} style={messageTarget === contact.id ? conversationButtonActive : conversationButton}>
              <ProfileAvatar user={contact} size={38} />
              <span style={contactCopy}>
                <strong>{contact.full_name || contact.email}</strong>
                <small style={contactRole}>{contact.job_title || roleName(contact.role)}</small>
                {lastMessage && <small style={lastMessagePreview}>{lastMessage.sender_id === profile.id ? "Sen: " : ""}{lastMessage.body}</small>}
                <PresenceBadge user={contact} onlineUserIds={onlineUserIds} compact />
              </span>
              {unread > 0 && <span style={unreadBadge}>{unread}</span>}
            </button>
          );
        })}
      </aside>

      <section style={chatPanel}>
        <header style={chatHeader}>
          {messageTarget === "general" ? <span style={generalAvatar}>#</span> : <ProfileAvatar user={activeContact} size={42} />}
          <div>
            <h2 style={{ ...sectionTitle, fontSize: 18 }}>{messageTarget === "general" ? "Genel" : activeContact?.full_name || activeContact?.email || "Kullanıcı"}</h2>
            {messageTarget === "general"
              ? <p style={mutedText}>Ofis kanalı</p>
              : <PresenceBadge user={activeContact} onlineUserIds={onlineUserIds} />}
          </div>
          <input value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} placeholder="Mesajlarda ara..." style={messageSearchInput} />
        </header>

        {messagingError ? (
          <div style={messageSetupNotice}>{messagingError}</div>
        ) : (
          <div style={messageStream}>
            {visibleMessages.length === 0 && <div style={emptyConversation}>Henüz mesaj yok.</div>}
            {visibleMessages.map((message, index) => {
              const mine = message.sender_id === profile.id;
              const sender = userMap.get(message.sender_id);
              const repliedMessage = message.reply_to_id ? messageMap.get(message.reply_to_id) : null;
              const previous = visibleMessages[index - 1];
              const showDate = !previous || formatDate(previous.created_at) !== formatDate(message.created_at);
              return (
                <div key={message.id}>
                  {showDate && <div style={messageDateDivider}><span>{formatDate(message.created_at)}</span></div>}
                  <div style={{ ...messageLine, justifyContent: mine ? "flex-end" : "flex-start" }}>
                    <div style={mine ? ownMessageBubble : messageBubble}>
                      {messageTarget === "general" && !mine && <strong style={messageSender}>{sender?.full_name || sender?.email || "Kullanıcı"}</strong>}
                      {repliedMessage && <div style={replyPreview}><strong>{userMap.get(repliedMessage.sender_id)?.full_name || "Mesaj"}</strong><span>{repliedMessage.body}</span></div>}
                      <p style={messageText}>{message.body}</p>
                      {message.attachment_url && (
                        message.attachment_type?.startsWith("image/")
                          ? <a href={message.attachment_url} target="_blank" rel="noreferrer"><img src={message.attachment_url} alt={message.attachment_name || "Mesaj görseli"} style={messageImage} /></a>
                          : <a href={message.attachment_url} target="_blank" rel="noreferrer" style={fileAttachment}>▤ {message.attachment_name || "Dosyayı aç"}</a>
                      )}
                      <div style={messageMetaRow}>
                        <small style={messageTime}>{message.edited_at ? "düzenlendi · " : ""}{formatTime(message.created_at)}</small>
                        <span style={messageActions}>
                          {mine && message.recipient_id && (
                            <span style={messageReceipt}>{message.read_at ? "✓✓ Okundu" : "✓ İletildi"}</span>
                          )}
                          <button type="button" title="Yanıtla" style={messageActionButton} onClick={() => { setReplyToMessage(message); setEditingMessage(null); }}>↩</button>
                          {mine && <button type="button" title="Düzenle" style={messageActionButton} onClick={() => beginEditMessage(message)}>✎</button>}
                          {mine && <button type="button" title="Sil" style={{ ...messageActionButton, color: "#fca5a5" }} onClick={() => deleteMessage(message)}>×</button>}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messageEndRef} />
          </div>
        )}

        <form onSubmit={sendMessage} style={messageComposer}>
          {(replyToMessage || editingMessage) && (
            <div style={composerContext}>
              <div><strong>{editingMessage ? "Mesaj düzenleniyor" : "Yanıtlanıyor"}</strong><span>{(editingMessage || replyToMessage).body}</span></div>
              <button type="button" onClick={cancelComposerMode} style={composerCloseButton}>×</button>
            </div>
          )}
          {messageAttachment && <div style={attachmentSelection}><span>▤ {messageAttachment.name}</span><button type="button" style={composerCloseButton} onClick={() => setMessageAttachment(null)}>×</button></div>}
          <div style={customerShareComposer}>
            <input
              value={customerShareQuery}
              onChange={(event) => setCustomerShareQuery(event.target.value)}
              placeholder="Paylaşılacak müşteri ara..."
              style={customerShareSearch}
              disabled={!!messagingError || !!editingMessage || sendingMessage}
            />
            <select
              value={selectedShareCustomerId}
              onChange={(event) => setSelectedShareCustomerId(event.target.value)}
              style={customerShareSelect}
              disabled={!!messagingError || !!editingMessage || sendingMessage}
            >
              <option value="">Müşteri kartı seç</option>
              {shareCustomerOptions.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customerFullName(customer)} - {formatPhoneDisplay(customer.phone)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={shareSelectedCustomer}
              disabled={!selectedShareCustomer || !!messagingError || !!editingMessage || !!sharingCustomerId}
              style={{ ...customerShareButton, opacity: !selectedShareCustomer || messagingError || editingMessage || sharingCustomerId ? 0.6 : 1 }}
            >
              {sharingCustomerId ? "Paylaşılıyor..." : "Kartı Paylaş"}
            </button>
          </div>
          <div style={composerRow}>
            <label style={attachButton} title="Dosya ekle">
              +
              <input type="file" accept="image/*,.pdf,.txt,.csv,.xls,.xlsx,.doc,.docx" hidden disabled={!!messagingError || !!editingMessage} onChange={(event) => setMessageAttachment(event.target.files?.[0] || null)} />
            </label>
            <textarea rows={2} maxLength={2000} placeholder="Mesaj yaz..." value={messageBody} onChange={(event) => setMessageBody(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} style={messageInput} disabled={!!messagingError || sendingMessage} />
            <button type="submit" style={sendMessageButton} disabled={(!messageBody.trim() && !messageAttachment) || !!messagingError || sendingMessage} title="Gönder" aria-label="Mesaj gönder">➤</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ReportsView({ profile, reportStats, repStats, dataStats, totalCustomers, liveReportError, generatedAt }) {
  const maxValue = Math.max(...reportStats.map((item) => item.value), 1);
  const isManagementProfile = ["boss", "manager"].includes(profile.role);
  return (
    <div style={reportsLayout}>
      <section style={panelCard}>
        <div style={sectionHeader}>
          <div>
            <h2 style={sectionTitle}>Rapor Merkezi</h2>
            <p style={mutedText}>{profile.role === "employee" ? "Kendi müşteri performansın" : "Genel operasyon özeti"}</p>
            <p style={mutedText}>Toplam görünür müşteri: {totalCustomers.toLocaleString("tr-TR")}</p>
            {generatedAt && <p style={mutedText}>Canlı özet: {formatDateTime(generatedAt)}</p>}
          </div>
        </div>
        {liveReportError && <div style={messageSetupNotice}>{liveReportError}</div>}

        <div style={chartList}>
          {reportStats.map((item) => {
            const visual = reportVisuals[item.key] || reportVisuals.pool;
            return (
              <div key={item.key} style={{ ...chartRow, background: visual.background, borderColor: visual.border }}>
                <div style={reportChartHeader}>
                  <span style={{ ...reportIcon, background: visual.iconBackground, color: visual.color }}>{visual.icon}</span>
                  <strong style={reportChartTitle}>{item.title}</strong>
                  <span style={{ ...reportFigure, color: visual.color }}>{item.value.toLocaleString("tr-TR")}</span>
                </div>
                <div style={chartTrack}>
                  <div style={{ ...chartBar, width: `${Math.max((item.value / maxValue) * 100, item.value ? 8 : 0)}%`, background: visual.bar }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {isManagementProfile && (
        <section style={panelCard}>
          <h2 style={sectionTitle}>En İyi Rep Tablosu</h2>
          {repStats.length === 0 && <p style={mutedText}>Henüz rep bulunmuyor.</p>}
          {repStats.map((rep, index) => (
            <div key={rep.id} style={leaderRow}>
              <strong>#{index + 1} {rep.full_name || rep.email}</strong>
              <span style={leaderFigure}><b>◉</b> {rep.stats.total.toLocaleString("tr-TR")}</span>
              <span style={leaderFigure}><b>◦</b> {rep.stats.appointment.toLocaleString("tr-TR")}</span>
              <span style={{ ...leaderFigure, color: "#fca5a5" }}><b>!</b> {(rep.stats.negative || 0).toLocaleString("tr-TR")}</span>
              <span style={{ ...leaderFigure, color: "#6ee7b7" }}><b>₺</b> {rep.stats.paid.toLocaleString("tr-TR")}</span>
            </div>
          ))}
        </section>
      )}

      {isManagementProfile && (
        <section style={panelCard}>
          <h2 style={sectionTitle}>Data Kaynağı Performansı</h2>
          <p style={mutedText}>Hangi datanın daha çok randevu ve satış getirdiğini karşılaştır.</p>
          {dataStats.length === 0 && <p style={{ ...mutedText, marginTop: 14 }}>Henüz data kaynağı bulunmuyor.</p>}
          {dataStats.map((data) => (
            <div key={data.name} style={dataSourceRow}>
              <strong>{data.name}</strong>
              <span style={{ ...dataMetric, color: "#93c5fd" }}>◉ {data.total.toLocaleString("tr-TR")}</span>
              <span style={{ ...dataMetric, color: "#fde68a" }}>◦ {data.appointment.toLocaleString("tr-TR")}</span>
              <span style={{ ...dataMetric, color: "#6ee7b7" }}>₺ {data.paid.toLocaleString("tr-TR")}</span>
              <span style={{ ...dataMetric, color: "#fca5a5" }}>! {data.wrongNumber.toLocaleString("tr-TR")}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function EmployeesView({ profile, users, customers, customerSummary, customerDataVersion, liveReport, liveReportError, onlineUserIds, staffForm, setStaffForm, addStaff, deleteStaff, showSystemToast }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedRep, setSelectedRep] = useState("all");
  const [datePreset, setDatePreset] = useState("today");
  const [activityLogs, setActivityLogs] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [repCustomers, setRepCustomers] = useState(() => customers.filter((customer) => customer.assigned_employee));
  const [availableCustomerCount, setAvailableCustomerCount] = useState(null);
  const [distributionStats, setDistributionStats] = useState(new Map());
  const [distributionStatsLoading, setDistributionStatsLoading] = useState(false);
  const [distributionStatsError, setDistributionStatsError] = useState("");
  const [repCustomersLoading, setRepCustomersLoading] = useState(true);
  const [repCustomersError, setRepCustomersError] = useState("");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [jettelExtensions, setJettelExtensions] = useState([]);
  const [jettelExtensionsLoading, setJettelExtensionsLoading] = useState(false);
  const [jettelExtensionsError, setJettelExtensionsError] = useState("");
  const [jettelSavingExtension, setJettelSavingExtension] = useState("");
  const [jettelSyncing, setJettelSyncing] = useState(false);
  const reps = useMemo(() => users.filter((user) => ["employee", "manager"].includes(user.role)), [users]);
  const liveRepStats = useMemo(() => new Map((liveReport?.rep_stats || []).map((item) => [item.id, item])), [liveReport]);
  const exactDistributionStats = distributionStats.size ? distributionStats : liveRepStats;
  const customerMap = useMemo(() => new Map([...customers, ...repCustomers].map((customer) => [String(customer.id), customer])), [customers, repCustomers]);
  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (profile.role !== "boss") return undefined;
    let cancelled = false;

    async function loadJettelExtensions(showLoading = false) {
      if (showLoading) setJettelExtensionsLoading(true);
      setJettelExtensionsError("");
      const { data, error } = await runWithRetry(() => supabase
        .from("jettel_extensions")
        .select("extension,ext_id,profile_id,display_name,line_number,group_name,is_active,is_connected,last_seen_at")
        .order("extension", { ascending: true }), 2);

      if (cancelled) return;
      setJettelExtensionsLoading(false);
      if (error) {
        const setupMissing = error.code === "PGRST205" || error.code === "42P01" || error.message?.includes("jettel_extensions");
        setJettelExtensionsError(setupMissing
          ? "Dahili yÃ¶netimi kurulumu eksik. Supabase SQL Editor'da JETTEL_CALL_INTEGRATION.sql dosyasÄ±nÄ± bir kez Ã§alÄ±ÅŸtÄ±r."
          : "Dahili listesi okunamadÄ±: " + error.message);
        setJettelExtensions([]);
        return;
      }
      setJettelExtensions(data || []);
    }

    const channel = supabase
      .channel(`jettel-extensions-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jettel_extensions" }, () => loadJettelExtensions(false))
      .subscribe();
    loadJettelExtensions(true);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [profile.id, profile.role]);

  useEffect(() => {
    if (!["boss", "manager"].includes(profile.role)) return undefined;
    if (reps.length === 0) {
      const resetTimer = window.setTimeout(() => {
        setDistributionStats(new Map());
        setDistributionStatsLoading(false);
        setDistributionStatsError("");
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }

    let cancelled = false;

    async function loadDistributionStats(showLoading = false) {
      if (showLoading) setDistributionStatsLoading(true);
      setDistributionStatsError("");

      const nextStats = new Map();
      const { count: availableCount, error: availableCountError } = await runWithRetry(() => supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .or("status.eq.pool,assigned_employee.is.null"), 3);

      if (cancelled) return;
      if (availableCountError) {
        setDistributionStatsError("Dengeli dağıtım havuzu eksiksiz sayılamadı: " + (availableCountError.message || "Bağlantı hatası"));
        if (showLoading) setDistributionStatsLoading(false);
        return;
      }
      setAvailableCustomerCount(Number(availableCount) || 0);

      const results = await Promise.all(reps.map(async (rep) => {
        const [totalResult, freshResult] = await Promise.all([
          runWithRetry(() => supabase
            .from("customers")
            .select("id", { count: "exact", head: true })
            .eq("assigned_employee", rep.id), 3),
          runWithRetry(() => supabase
            .from("customers")
            .select("id", { count: "exact", head: true })
            .eq("assigned_employee", rep.id)
            .eq("status", "assigned")
            .or(`last_action_by.is.null,last_action_by.neq.${rep.id}`), 3),
        ]);
        return { rep, totalResult, freshResult };
      }));

      if (cancelled) return;

      const failed = results.find((item) => item.totalResult.error || item.freshResult.error);
      if (failed) {
        const error = failed.totalResult.error || failed.freshResult.error;
        setDistributionStatsError("Dengeli dağıtım rep yükleri eksiksiz sayılamadı: " + (error.message || "Bağlantı hatası"));
        if (showLoading) setDistributionStatsLoading(false);
        return;
      }

      results.forEach(({ rep, totalResult, freshResult }) => {
        nextStats.set(rep.id, {
          id: rep.id,
          total: Number(totalResult.count) || 0,
          untouched: Number(freshResult.count) || 0,
        });
      });
      setDistributionStats(nextStats);
      setDistributionStatsError("");
      if (showLoading) setDistributionStatsLoading(false);
    }

    const refreshTimer = window.setTimeout(() => loadDistributionStats(true), 180);
    const reconcileTimer = window.setInterval(() => loadDistributionStats(false), REP_MONITOR_RECONCILE_INTERVAL);
    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
      window.clearInterval(reconcileTimer);
    };
  }, [profile.role, reps, customerDataVersion]);

  async function syncJettelExtensionStatus() {
    if (profile.role !== "boss" || jettelSyncing) return;
    setJettelSyncing(true);
    setJettelExtensionsError("");
    const { data, error } = await runWithRetry(() => supabase
      .from("jettel_extensions")
      .select("extension,ext_id,profile_id,display_name,line_number,group_name,is_active,is_connected,last_seen_at")
      .order("extension", { ascending: true }), 2);
    setJettelSyncing(false);
    if (error) {
      setJettelExtensionsError("Bridge verisi okunamadi: " + (error.message || "Bilinmeyen hata"));
      return;
    }
    const rows = data || [];
    setJettelExtensions(rows);
    const rowsWithSync = rows.filter((row) => row.last_seen_at);
    const freshRows = rowsWithSync.filter((row) => Date.now() - new Date(row.last_seen_at).getTime() < 10 * 60_000);
    if (rows.length > 0 && rowsWithSync.length === 0) {
      setJettelExtensionsError("Bridge verisi henuz gelmemis. Ofis PC'deki OSS Jettel Local Sync calisiyor mu kontrol et.");
      return;
    }
    showSystemToast(freshRows.length > 0 ? "Bridge verisi yenilendi." : "Bridge son verisi okundu; yeni sync bekleniyor.");
  }

  useEffect(() => {
    let cancelled = false;

    function applyCustomerChange(payload) {
      const customerId = payload.eventType === "DELETE" ? payload.old?.id : payload.new?.id;
      if (!customerId) return;
      setRepCustomers((current) => {
        if (payload.eventType === "DELETE" || !payload.new?.assigned_employee) {
          return current.filter((customer) => String(customer.id) !== String(customerId));
        }
        const next = payload.new;
        const existingIndex = current.findIndex((customer) => String(customer.id) === String(customerId));
        if (existingIndex === -1) return [next, ...current];
        const updated = [...current];
        updated[existingIndex] = next;
        return updated;
      });
    }

    async function loadAllRepCustomers(showLoading = false) {
      if (showLoading) setRepCustomersLoading(true);
      setRepCustomersError("");
      const rows = [];

      try {
        for (let from = 0; ; from += REP_MONITOR_PAGE_SIZE) {
          const { data, error } = await runWithRetry(() => supabase
            .from("customers")
            .select(CUSTOMER_SELECT_COLUMNS)
            .not("assigned_employee", "is", null)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, from + REP_MONITOR_PAGE_SIZE - 1), 3);
          if (error) throw error;
          const page = data || [];
          rows.push(...page);
          if (page.length < REP_MONITOR_PAGE_SIZE) break;
        }

        const { count: availableCount, error: availableCountError } = await runWithRetry(() => supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .or("status.eq.pool,assigned_employee.is.null"), 3);
        if (availableCountError) throw availableCountError;

        if (!cancelled) {
          const uniqueRows = Array.from(new Map(rows.map((customer) => [String(customer.id), customer])).values());
          setRepCustomers(uniqueRows);
          setAvailableCustomerCount(Number(availableCount) || 0);
        }
      } catch (error) {
        if (!cancelled) setRepCustomersError("Rep müşteri yükleri eksiksiz okunamadı: " + (error.message || "Bağlantı hatası"));
      } finally {
        if (!cancelled) setRepCustomersLoading(false);
      }
    }

    const customerChannel = supabase
      .channel(`rep-customer-monitor-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, applyCustomerChange)
      .subscribe();
    loadAllRepCustomers(true);
    const reconcileTimer = window.setInterval(() => loadAllRepCustomers(false), REP_MONITOR_RECONCILE_INTERVAL);

    return () => {
      cancelled = true;
      window.clearInterval(reconcileTimer);
      supabase.removeChannel(customerChannel);
    };
  }, [profile.id]);

  useEffect(() => {
    let cancelled = false;
    const liveLogs = [];
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (datePreset === "yesterday") start.setDate(start.getDate() - 1);
    if (datePreset === "7days") start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (datePreset === "30days") start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const end = datePreset === "yesterday" ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : null;

    async function loadRepActivity() {
      setActivityLoading(true);
      setActivityError("");
      const allLogs = [];
      let beforeId = null;
      let loadError = null;

      while (!cancelled) {
        let query = supabase
          .from("customer_logs")
          .select("id, customer_id, user_id, old_status, new_status, note, created_at")
          .gte("created_at", start.toISOString())
          .order("id", { ascending: false })
          .limit(REP_MONITOR_PAGE_SIZE);
        if (datePreset === "yesterday") query = query.lt("created_at", end.toISOString());
        if (beforeId !== null) query = query.lt("id", beforeId);
        const { data, error } = await runWithRetry(() => query, 3);
        if (error) {
          loadError = error;
          break;
        }
        const page = data || [];
        allLogs.push(...page);
        if (page.length < REP_MONITOR_PAGE_SIZE) break;
        beforeId = page[page.length - 1].id;
      }

      if (cancelled) return;
      setActivityLoading(false);
      if (loadError) {
        setActivityError("Rep işlem kayıtları eksiksiz okunamadı: " + loadError.message);
        setActivityLogs([]);
        return;
      }
      setActivityLogs(Array.from(
        new Map([...liveLogs, ...allLogs].map((log) => [String(log.id), log])).values()
      ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    }

    loadRepActivity();
    const activityChannel = supabase
      .channel(`rep-activity-${datePreset}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "customer_logs" }, (payload) => {
        const logTime = new Date(payload.new.created_at);
        if (logTime < start || (end && logTime >= end)) return;
        liveLogs.push(payload.new);
        setActivityLogs((current) => [payload.new, ...current.filter((log) => log.id !== payload.new.id)]);
      })
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(activityChannel);
    };
  }, [datePreset]);

  const visibleLogs = useMemo(() => selectedRep === "all"
    ? activityLogs
    : activityLogs.filter((log) => log.user_id === selectedRep), [activityLogs, selectedRep]);

  const repRows = useMemo(() => reps.map((rep) => {
    const logs = activityLogs.filter((log) => log.user_id === rep.id);
    const assigned = repCustomers.filter((customer) => customer.assigned_employee === rep.id);
    const exactStats = liveRepStats.get(rep.id);
    const callActions = logs.filter((log) => ["no_answer", "busy", "callback"].includes(log.new_status)).length;
    const negative = assigned.filter((customer) => REP_NEGATIVE_CUSTOMER_STATUSES.has(customer.status)).length;
    const appointments = logs.filter((log) => ["appointment", "contract_appointment"].includes(log.new_status)).length;
    const sales = logs.filter((log) => log.new_status === "paid").length;
    const untouched = assigned.filter(isFreshAssignedCustomer).length;
    const lastLog = logs[0];
    return {
      rep,
      logs,
      assigned: exactStats ? Number(exactStats.total) || 0 : assigned.length,
      callActions,
      negative,
      appointments,
      sales,
      untouched: exactStats ? Number(exactStats.untouched) || 0 : untouched,
      conversion: callActions ? Math.round((appointments / callActions) * 100) : 0,
      lastAction: lastLog?.created_at || null,
    };
  }).sort((a, b) => b.logs.length - a.logs.length), [reps, activityLogs, repCustomers, liveRepStats]);

  const delayedCustomers = useMemo(() => repCustomers
    .filter((customer) => selectedRep === "all" || customer.assigned_employee === selectedRep)
    .filter((customer) => {
      if (!customer.assigned_employee) return false;
      const reminderLate = customer.appointment_date
        && ["callback", "appointment", "contract_appointment"].includes(customer.status)
        && new Date(customer.appointment_date).getTime() < clockNow;
      const assignedAt = customer.assigned_at ? new Date(customer.assigned_at) : null;
      const untouchedLate = isFreshAssignedCustomer(customer) && assignedAt && clockNow - assignedAt.getTime() > 24 * 60 * 60 * 1000;
      return reminderLate || untouchedLate;
    })
    .sort((a, b) => new Date(a.appointment_date || a.assigned_at) - new Date(b.appointment_date || b.assigned_at)), [repCustomers, selectedRep, clockNow]);

  const totalActions = repRows.reduce((sum, row) => sum + row.logs.length, 0);
  const totalAppointments = repRows.reduce((sum, row) => sum + row.appointments, 0);
  const totalNegative = repRows.reduce((sum, row) => sum + row.negative, 0);
  const totalSales = repRows.reduce((sum, row) => sum + row.sales, 0);
  const totalUntouched = repRows.reduce((sum, row) => sum + row.untouched, 0);
  const totalDelayed = liveRepStats.size
    ? selectedRep === "all"
      ? Array.from(liveRepStats.values()).reduce((sum, stats) => sum + (Number(stats.delayed) || 0), 0)
      : Number(liveRepStats.get(selectedRep)?.delayed) || 0
    : delayedCustomers.length;

  async function updateJettelExtension(extension, profileId) {
    if (profile.role !== "boss") return;
    setJettelSavingExtension(extension);
    setJettelExtensionsError("");
    const assignedRep = reps.find((rep) => rep.id === profileId);
    const { error } = await runWithRetry(() => supabase
      .from("jettel_extensions")
      .update({
        profile_id: profileId || null,
        display_name: assignedRep?.full_name || assignedRep?.email || extension,
        updated_at: new Date().toISOString(),
      })
      .eq("extension", extension), 2);
    setJettelSavingExtension("");
    if (error) {
      setJettelExtensionsError("Dahili eÅŸlemesi kaydedilemedi: " + error.message);
      return;
    }
    setJettelExtensions((current) => current.map((item) => item.extension === extension
      ? { ...item, profile_id: profileId || null, display_name: assignedRep?.full_name || assignedRep?.email || item.extension }
      : item));
  }

  return (
    <div style={repCenterLayout}>
      <section style={panelCard}>
        <div style={repCenterHeader}>
          <div>
            <span style={notesEyebrow}>YÖNETİM PANELİ</span>
            <h2 style={sectionTitle}>Rep Takip Merkezi</h2>
            <p style={mutedText}>Çalışanların gerçek işlem kayıtlarını, takip kalitesini ve geciken işlerini tek ekrandan izle.</p>
          </div>
          <div style={repCenterFilters}>
            <select value={selectedRep} onChange={(event) => setSelectedRep(event.target.value)} style={toolbarSelect}>
              <option value="all">Tüm çalışanlar</option>
              {reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.full_name || rep.email}</option>)}
            </select>
            <select value={datePreset} onChange={(event) => setDatePreset(event.target.value)} style={toolbarSelect}>
              <option value="today">Bugün</option>
              <option value="yesterday">Dün</option>
              <option value="7days">Son 7 gün</option>
              <option value="30days">Son 30 gün</option>
            </select>
          </div>
        </div>

        <div style={repCenterTabs}>
          {[["overview", "Genel Bakış"], ["stream", "Canlı İşlem Akışı"], ["delayed", `Geciken İşler (${totalDelayed.toLocaleString("tr-TR")})`], ["staff", "Çalışan Yönetimi"]].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setActiveTab(key)} style={activeTab === key ? repTabActive : repTabButton}>{label}</button>
          ))}
        </div>

        {profile.role === "boss" && (
          <div style={{ margin: "-8px 0 16px" }}>
            <button type="button" onClick={() => setActiveTab("extensions")} style={activeTab === "extensions" ? repTabActive : repTabButton}>Dahili Yonetimi</button>
          </div>
        )}

        {activityError && <div style={messageSetupNotice}>{activityError}</div>}
        {repCustomersError && <div style={messageSetupNotice}>{repCustomersError}</div>}
        {distributionStatsError && <div style={messageSetupNotice}>{distributionStatsError}</div>}
        {jettelExtensionsError && <div style={messageSetupNotice}>{jettelExtensionsError}</div>}
        {liveReportError && activeTab !== "extensions" && <div style={messageSetupNotice}>{liveReportError}</div>}
        {activityLoading && <div style={syncNotice}>Rep işlem kayıtları yükleniyor...</div>}
        {repCustomersLoading && <div style={syncNotice}>Tüm rep müşteri yükleri eksiksiz sayılıyor...</div>}
        {distributionStatsLoading && <div style={syncNotice}>Dengeli dağıtım sayaçları canlı okunuyor...</div>}

        {activeTab === "overview" && (
          <>
            <div style={repMetricGrid}>
              <RepMetric label="Toplam işlem" value={totalActions} tone="#38bdf8" />
              <RepMetric label="Randevu" value={totalAppointments} tone="#fbbf24" />
              <RepMetric label="Negatif" value={totalNegative} tone="#f87171" />
              <RepMetric label="Satış" value={totalSales} tone="#34d399" />
              <RepMetric label="İşlem bekleyen" value={totalUntouched} tone="#f87171" />
            </div>
            <div style={repComparisonTable}>
              <div style={repComparisonHeader}>
                <span>Çalışan</span><span>İşlem</span><span>Üzerindeki</span><span>Arama</span><span>Randevu</span><span>Negatif</span><span>Satış</span><span>Dönüşüm</span><span>Bekleyen</span><span>Son işlem</span>
              </div>
              {repRows.filter((row) => selectedRep === "all" || row.rep.id === selectedRep).map((row) => (
                <button key={row.rep.id} type="button" style={repComparisonRow} onClick={() => { setSelectedRep(row.rep.id); setActiveTab("stream"); }}>
                  <span style={repTableIdentity}><ProfileAvatar user={row.rep} size={34} /><span><strong>{row.rep.full_name || row.rep.email}</strong><PresenceBadge user={row.rep} onlineUserIds={onlineUserIds} compact /></span></span>
                  <strong>{row.logs.length}</strong><span>{row.assigned.toLocaleString("tr-TR")}</span><span>{row.callActions}</span><span>{row.appointments}</span><span style={{ color: row.negative ? "#fca5a5" : "#86efac" }}>{row.negative}</span><span>{row.sales}</span><span>%{row.conversion}</span><span style={{ color: row.untouched ? "#fca5a5" : "#86efac" }}>{row.untouched}</span><small>{formatDateTime(row.lastAction)}</small>
                </button>
              ))}
            </div>
          </>
        )}

        {activeTab === "stream" && (
          <div style={activityStream}>
            {visibleLogs.length === 0 && !activityLoading && <p style={mutedText}>Seçilen aralıkta işlem kaydı yok.</p>}
            {visibleLogs.map((log) => {
              const customer = customerMap.get(String(log.customer_id));
              const rep = userMap.get(log.user_id);
              return (
                <div key={log.id} style={{ ...activityStreamRow, borderLeftColor: customerHeat(log.new_status).color }}>
                  <span style={activityTime}>{formatDateTime(log.created_at)}</span>
                  <span style={activityRep}>{rep?.full_name || rep?.email || "Bilinmeyen çalışan"}</span>
                  <span style={activityCustomer}>{customer ? customerFullName(customer) : `Müşteri #${log.customer_id}`}</span>
                  <span style={statusBadge(log.new_status)}>{statusLabel(log.new_status)}</span>
                  <span style={activityNote}>{log.note || "Not bırakılmadı"}</span>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "delayed" && (
          <div style={activityStream}>
            {delayedCustomers.length === 0 && <p style={mutedText}>Geciken veya 24 saattir işlem yapılmayan müşteri yok.</p>}
            {delayedCustomers.map((customer) => {
              const rep = userMap.get(customer.assigned_employee);
              const isReminder = customer.appointment_date && new Date(customer.appointment_date).getTime() < clockNow;
              return (
                <div key={customer.id} style={{ ...activityStreamRow, borderLeftColor: isReminder ? "#f87171" : "#fbbf24" }}>
                  <span style={activityTime}>{isReminder ? formatDateTime(customer.appointment_date) : formatDateTime(customer.assigned_at)}</span>
                  <span style={activityRep}>{rep?.full_name || rep?.email || "Atanmamış"}</span>
                  <span style={activityCustomer}>{customerFullName(customer)}</span>
                  <span style={isReminder ? overdueBadge : waitingBadge}>{isReminder ? "Takip gecikti" : "24 saattir işlem yok"}</span>
                  <span style={activityNote}>{formatPhoneDisplay(customer.phone)}</span>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "extensions" && profile.role === "boss" && (
          <div style={jettelExtensionPanel}>
            <div style={sectionHeader}>
              <div>
                <h3 style={{ margin: 0 }}>Dahili - Rep Eslemesi</h3>
                <p style={mutedText}>Jettel'den gelen arama 101, 102 gibi dahiliyle gelirse CRM burada secili rep hesabina yazar.</p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {jettelExtensionsLoading && <span style={mutedText}>Dahililer yukleniyor...</span>}
                <button type="button" onClick={syncJettelExtensionStatus} disabled={jettelSyncing} style={smallButton}>
                  {jettelSyncing ? "Bridge okunuyor..." : "Bridge verisini yenile"}
                </button>
              </div>
            </div>
            <div style={jettelExtensionTable}>
              <div style={jettelExtensionHeader}>
                <span>Dahili</span><span>Ext ID</span><span>Hat</span><span>Durum</span><span>Bagli Rep</span>
              </div>
              {jettelExtensions.length === 0 && !jettelExtensionsLoading && (
                <div style={emptyTableState}>Dahili kaydi yok. JETTEL_CALL_INTEGRATION.sql dosyasini Supabase'de calistirdigindan emin ol.</div>
              )}
              {jettelExtensions.map((extension) => {
                const assignedRep = reps.find((rep) => rep.id === extension.profile_id);
                const lastSeenAt = extension.last_seen_at ? new Date(extension.last_seen_at).getTime() : 0;
                const hasSync = Boolean(lastSeenAt);
                const isStale = hasSync && clockNow - lastSeenAt > 10 * 60 * 1000;
                const lastSeenLabel = lastSeenAt ? new Date(lastSeenAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "";
                const statusLabel = !hasSync
                  ? "Sync yok"
                  : extension.is_connected
                    ? "Bagli"
                    : "Bagli degil";
                return (
                  <div key={extension.extension} style={jettelExtensionRow}>
                    <strong>{extension.extension}</strong>
                    <span>{extension.ext_id || `${extension.extension}-pbx349`}</span>
                    <span>{extension.line_number || "-"}</span>
                    <span style={!hasSync ? offlineBadgeStyle : extension.is_connected ? onlineBadgeStyle : waitingBadge}>
                      {statusLabel}{lastSeenLabel ? ` · ${lastSeenLabel}${isStale ? " eski" : ""}` : ""}
                    </span>
                    <div style={jettelExtensionSelectWrap}>
                      <select
                        value={extension.profile_id || ""}
                        onChange={(event) => updateJettelExtension(extension.extension, event.target.value)}
                        disabled={jettelSavingExtension === extension.extension}
                        style={inputStyle}
                      >
                        <option value="">Bosta / rep yok</option>
                        {reps.map((rep) => (
                          <option key={rep.id} value={rep.id}>{rep.full_name || rep.email}</option>
                        ))}
                      </select>
                      <small style={mutedText}>{jettelSavingExtension === extension.extension ? "Kaydediliyor..." : assignedRep ? `Aktif: ${assignedRep.full_name || assignedRep.email}` : "Bu dahili bosta"}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "staff" && (
          <>
            {profile.role === "boss" && (
              <form onSubmit={addStaff} style={staffFormBox}>
                <h3>Yeni Kullanıcı Profili Ekle</h3>
                <div style={formGrid}>
                  <input placeholder="Auth UID" value={staffForm.id} onChange={(e) => setStaffForm({ ...staffForm, id: e.target.value })} style={inputStyle} />
                  <input placeholder="Ad Soyad" value={staffForm.full_name} onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })} style={inputStyle} />
                  <input placeholder="Email" value={staffForm.email} onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} style={inputStyle} />
                  <select value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })} style={inputStyle}><option value="employee">Rep</option><option value="manager">Manager</option></select>
                </div>
                <button style={primaryButton}>Kullanıcı Profili Ekle</button>
              </form>
            )}
            {users.map((user) => (
              <div key={user.id} style={employeeRow}>
                <div style={employeeIdentity}><ProfileAvatar user={user} size={46} /><div><strong>{user.full_name || "İsimsiz kullanıcı"}</strong><p style={{ margin: 0, opacity: 0.7 }}>{user.email}</p><PresenceBadge user={user} onlineUserIds={onlineUserIds} /></div></div>
                <div style={staffActions}><span style={roleBadge}>{roleName(user.role)}</span>{profile.role === "boss" && user.role === "employee" && <button type="button" onClick={() => deleteStaff(user)} style={deleteStaffButton}>Rep Sil</button>}</div>
              </div>
            ))}
            <AssignmentOverview employees={reps} customers={repCustomers} exactPoolCount={availableCustomerCount ?? liveReport?.summary?.available ?? customerSummary?.pool} exactRepStats={exactDistributionStats} />
          </>
        )}
      </section>
    </div>
  );
}

function RepMetric({ label, value, tone }) {
  return <div style={{ ...repMetricCard, borderColor: tone }}><span style={workSummaryLabel}>{label}</span><strong style={{ ...workSummaryValue, color: tone }}>{value.toLocaleString("tr-TR")}</strong></div>;
}

function TodayWorkView({ todayItems, overdueItems }) {
  const appointments = todayItems.filter((customer) => ["appointment", "contract_appointment"].includes(customer.status)).length;
  const callbacks = todayItems.filter((customer) => customer.status === "callback").length;

  return (
    <section style={{ ...panelCard, marginBottom: 20 }}>
      <div style={sectionHeader}>
        <div>
          <h2 style={sectionTitle}>Bugünkü İş Planı</h2>
          <p style={mutedText}>Önce geciken takipleri, sonra bugünkü randevuları tamamla.</p>
        </div>
        <span style={todayDateBadge}>{formatDate(new Date())}</span>
      </div>
      <div style={workSummaryGrid}>
        <div style={{ ...workSummaryItem, borderColor: "rgba(248,113,113,0.45)" }}>
          <span style={workSummaryLabel}>Geciken takip</span>
          <strong style={{ ...workSummaryValue, color: "#fca5a5" }}>{overdueItems.length}</strong>
        </div>
        <div style={{ ...workSummaryItem, borderColor: "rgba(251,191,36,0.45)" }}>
          <span style={workSummaryLabel}>Randevu</span>
          <strong style={{ ...workSummaryValue, color: "#fde68a" }}>{appointments}</strong>
        </div>
        <div style={{ ...workSummaryItem, borderColor: "rgba(192,132,252,0.45)" }}>
          <span style={workSummaryLabel}>Geri arama</span>
          <strong style={{ ...workSummaryValue, color: "#d8b4fe" }}>{callbacks}</strong>
        </div>
        <div style={{ ...workSummaryItem, borderColor: "rgba(96,165,250,0.45)" }}>
          <span style={workSummaryLabel}>Toplam iş</span>
          <strong style={{ ...workSummaryValue, color: "#93c5fd" }}>{todayItems.length}</strong>
        </div>
      </div>
    </section>
  );
}

function RepDailyOverview({ customers, todayItems, summary, onNavigate }) {
  const exactMetric = (key, fallback = 0) => {
    const value = summary?.[key];
    return value === null || value === undefined ? fallback : Number(value) || 0;
  };
  const todayTotal = exactMetric("today_work", todayItems.length);
  const noAnswer = exactMetric("no_answer", customers.filter((customer) => customer.status === "no_answer").length);
  const appointments = exactMetric(
    "appointment",
    customers.filter((customer) => ["appointment", "contract_appointment"].includes(customer.status)).length
  ) + exactMetric("contract_appointment", 0);
  const paid = exactMetric("paid", customers.filter((customer) => customer.payment_received || customer.status === "paid").length);
  const maxValue = Math.max(noAnswer, appointments, paid, todayTotal, 1);
  const metrics = [
    { label: "Bugün sırada", value: todayTotal, color: brandRed, page: "today_work", background: brandRedSoft },
    { label: "Ulaşılamadı", value: noAnswer, color: brandRed, page: "rep_no_answer", background: brandRedSoft },
    { label: "Randevu", value: appointments, color: brandRed, page: "rep_appointment", background: brandRedSoft },
    { label: "Satış", value: paid, color: brandRed, page: "rep_paid", background: brandRedSoft },
  ];

  return (
    <section style={{ ...panelCard, marginTop: 20 }}>
      <div style={sectionHeader}>
        <div>
          <h2 style={sectionTitle}>Günlük Görünüm</h2>
          <p style={mutedText}>Bugünkü iş yoğunluğun ve müşteri durumların.</p>
        </div>
        <span style={dailyFocusBadge}>{todayTotal ? "Öncelik: takipler" : "Planın temiz"}</span>
      </div>
      <div style={dailyMetricGrid}>
        {metrics.map((metric) => (
          <button key={metric.label} type="button" onClick={() => onNavigate(metric.page)} style={{ ...dailyMetricItem, background: metric.background }}>
            <div style={chartLabel}><span>{metric.label}</span><strong>{metric.value}</strong></div>
            <div style={chartTrack}>
              <div style={{ ...chartBar, width: `${Math.max((metric.value / maxValue) * 100, metric.value ? 8 : 0)}%`, background: metric.color }} />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function CallNoticePopup({ notice, onOpenCustomer, onDismiss }) {
  const call = notice.call || {};
  const customer = notice.customer;
  const title = customer ? customerFullName(customer) : formatPhoneDisplay(call.phone);
  const subtitle = `${call.direction === "incoming" ? "Gelen çağrı" : "Giden çağrı"} · ${callStatusLabel(call)}`;
  const foreignCustomer = customer && notice.readOnlyCustomer;
  return (
    <div style={callNoticePopup}>
      <div style={callNoticeHeader}>
        <span style={callNoticePulse}>☎</span>
        <div>
          <strong>{title || "Bilinmeyen müşteri"}</strong>
          <small>{subtitle}</small>
        </div>
        <button type="button" onClick={onDismiss} style={callNoticeClose} aria-label="Çağrı bildirimini kapat">×</button>
      </div>
      <div style={callNoticeMeta}>
        <span>Numara: {formatPhoneDisplay(call.phone)}</span>
        <span>Dahili: {call.extension || call.device_id || "-"}</span>
        <span>Rep: {notice.assignedUser?.full_name || notice.assignedUser?.email || "-"}</span>
        {foreignCustomer ? <span>Müşteri sahibi: {notice.ownerUser?.full_name || notice.ownerUser?.email || "Başka rep"}</span> : null}
        {call.duration_seconds ? <span>Süre: {call.duration_seconds}s</span> : null}
      </div>
      <div style={callNoticeActions}>
        <button type="button" onClick={onOpenCustomer} disabled={!customer} style={{ ...smallButton, opacity: customer ? 1 : 0.55 }}>
          {!customer ? "Kart eşleşmedi" : foreignCustomer ? "Bilgi kartını aç" : "Müşteri kartını aç"}
        </button>
        <button type="button" onClick={onDismiss} style={smallGhostButton}>Kapat</button>
      </div>
    </div>
  );
}

function SaleCelebration({ customerName, onClose }) {
  const colors = ["#38bdf8", "#fbbf24", "#34d399", "#c084fc", "#fb7185", "#60a5fa"];
  return (
    <div style={celebrationBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div style={celebrationCard} onMouseDown={(event) => event.stopPropagation()}>
        <div style={celebrationConfetti}>
          {colors.map((color, index) => <span key={color} style={{ ...confettiPiece, background: color, transform: `rotate(${index * 27}deg)` }} />)}
        </div>
        <span style={celebrationEyebrow}>SATIŞ TAMAMLANDI</span>
        <h2 style={celebrationTitle}>Tebrikler</h2>
        <p style={celebrationCustomer}>{customerName}</p>
        <p style={mutedText}>Müşteri başarıyla satışa dönüştürüldü.</p>
        <button type="button" style={{ ...primaryButton, marginTop: 22 }} onClick={onClose}>Devam et</button>
      </div>
    </div>
  );
}

function AssignmentOverview({ employees, customers, exactPoolCount, exactRepStats }) {
  const poolCount = exactPoolCount === null || exactPoolCount === undefined
    ? customers.filter((customer) => customer.status === "pool" || !customer.assigned_employee).length
    : Number(exactPoolCount) || 0;
  const assignedCount = exactRepStats?.size
    ? Array.from(exactRepStats.values()).reduce((sum, stats) => sum + (Number(stats.total) || 0), 0)
    : customers.filter((customer) => customer.assigned_employee).length;
  const suggestedLoad = employees.length ? Math.ceil((assignedCount + poolCount) / employees.length) : 0;

  return (
    <div style={assignmentSection}>
      <div style={sectionHeader}>
        <div>
          <h3 style={{ ...sectionTitle, fontSize: 18 }}>Dengeli Dağıtım</h3>
          <p style={mutedText}>Havuz: {poolCount.toLocaleString("tr-TR")} müşteri | Hedef yük: rep başına yaklaşık {suggestedLoad.toLocaleString("tr-TR")}</p>
        </div>
      </div>
      {employees.map((employee) => {
        const exactStats = exactRepStats?.get(employee.id);
        const employeeCustomers = customers.filter((customer) => customer.assigned_employee === employee.id);
        const totalLoad = exactStats
          ? Number(exactStats.total) || 0
          : employeeCustomers.length;
        const freshLoad = exactStats
          ? Number(exactStats.untouched) || 0
          : employeeCustomers.filter(isFreshAssignedCustomer).length;
        const isLight = totalLoad < suggestedLoad;
        return (
          <div key={employee.id} style={workloadRow}>
            <strong>{employee.full_name || employee.email}</strong>
            <span style={isLight ? workloadAvailable : workloadBusy}>
              Yeni gelenler: {freshLoad.toLocaleString("tr-TR")} | Komple: {totalLoad.toLocaleString("tr-TR")} müşteri {isLight ? "- uygun" : "- yoğun"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CalendarView({ customers, users, profile, setSelectedCustomer }) {
  const [sortMode, setSortMode] = useState("date_asc");
  const [selectedDate, setSelectedDate] = useState("");
  const userMap = new Map((users || []).map((user) => [user.id, user]));
  const sortDirection = sortMode === "date_desc" ? -1 : 1;
  const visibleCustomers = selectedDate
    ? customers.filter((customer) => formatDateInputValue(customer.appointment_date) === selectedDate)
    : customers;
  const grouped = visibleCustomers.reduce((acc, customer) => {
    const key = formatDate(customer.appointment_date);
    if (!acc[key]) acc[key] = [];
    acc[key].push(customer);
    return acc;
  }, {});
  const days = Object.entries(grouped).sort(([, firstDayCustomers], [, secondDayCustomers]) =>
    (new Date(firstDayCustomers[0].appointment_date) - new Date(secondDayCustomers[0].appointment_date)) * sortDirection
  );

  return (
    <div style={panelCard}>
      <div style={tableTitleRow}>
        <h2 style={sectionTitle}>Takvim</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            title="Takvim tarihi seç"
            style={{ ...toolbarSelect, maxWidth: 190 }}
          />
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} style={{ ...toolbarSelect, maxWidth: 260 }}>
            <option value="date_asc">Tarih sıralaması: Yakın tarih</option>
            <option value="date_desc">Tarih sıralaması: Uzak tarih</option>
          </select>
        </div>
      </div>
      {days.length === 0 && <p style={mutedText}>Planlanmış geri arama veya randevu yok.</p>}
      <div style={calendarGrid}>
        {days.map(([day, dayCustomers]) => (
          <div key={day} style={calendarDay}>
            <h3>{day}</h3>
            {[...dayCustomers].sort((first, second) =>
              (new Date(first.appointment_date) - new Date(second.appointment_date)) * sortDirection
            ).map((customer) => (
              <button
                key={customer.id}
                type="button"
                style={calendarItem}
                onClick={() => setSelectedCustomer(customer)}
              >
                <strong>{customer.first_name} {customer.last_name}</strong>
                <span>{formatTime(customer.appointment_date)} - {statusLabel(customer.status)}</span>
                {["boss", "manager"].includes(profile?.role) && (
                  <small style={calendarItemMeta}>
                    Alan rep: {userMap.get(customer.assigned_employee)?.full_name || userMap.get(customer.assigned_employee)?.email || "Atanmamis"}
                  </small>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const menuIconTones = {
  default: { background: "#fff1eb", color: "#e24407" },
  dashboard: { background: "#fff1eb", color: "#e24407" },
  customers: { background: "#fff1eb", color: "#e24407" },
  new: { background: "#fff1eb", color: "#e24407" },
  called: { background: "rgba(251,146,60,0.16)", color: "#fdba74" },
  appointment: { background: "rgba(251,191,36,0.16)", color: "#fde68a" },
  contract: { background: "#fff1eb", color: "#e24407" },
  callback: { background: "rgba(192,132,252,0.16)", color: "#d8b4fe" },
  closed: { background: "rgba(248,113,113,0.16)", color: "#fca5a5" },
  paid: { background: "rgba(52,211,153,0.16)", color: "#6ee7b7" },
  pool: { background: "rgba(45,212,191,0.16)", color: "#5eead4" },
  urgent: { background: "rgba(248,113,113,0.16)", color: "#f87171" },
  today: { background: "rgba(251,146,60,0.16)", color: "#fdba74" },
  calendar: { background: "#fff1eb", color: "#e24407" },
  wrong: { background: "rgba(148,163,184,0.18)", color: "#cbd5e1" },
  employees: { background: "rgba(74,222,128,0.16)", color: "#86efac" },
  reports: { background: "#fff1eb", color: "#e24407" },
  account: { background: "#fff1eb", color: "#e24407" },
  messages: { background: "#fff1eb", color: "#e24407" },
  notes: { background: "#fff1eb", color: "#e24407" },
};

const appShell = {
  width: "100%",
  minWidth: 0,
  height: "100vh",
  minHeight: "100vh",
  background: "#ffffff",
  color: appTextColor,
  display: "flex",
  overflow: "hidden",
};
const sidebar = {
  background: "#ffffff",
  padding: 24,
  borderRight: `1px solid ${brandRedBorder}`,
  transition: "width 280ms cubic-bezier(0.22, 1, 0.36, 1), padding 280ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 280ms ease",
  flexShrink: 0,
  boxShadow: "10px 0 30px rgba(226,68,7,0.08)",
  height: "100vh",
  boxSizing: "border-box",
  overflowX: "hidden",
  overflowY: "auto",
  overscrollBehavior: "contain",
  willChange: "width, padding",
};
const sidebarExpandedStyle = { width: 260, padding: 24, boxShadow: "14px 0 38px rgba(226,68,7,0.10)" };
const sidebarCollapsedStyle = { width: 82, padding: 14, boxShadow: "8px 0 24px rgba(226,68,7,0.07)" };
const sidebarTopRow = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, minHeight: 46, marginBottom: 18 };
const brandBlock = { width: 150, minWidth: 0, padding: "7px 8px", boxSizing: "border-box", borderRadius: 12, background: "#ffffff", border: `1px solid ${brandRedBorder}`, opacity: 1, transform: "translateX(0)", overflow: "hidden", transition: "width 260ms cubic-bezier(0.22, 1, 0.36, 1), padding 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease, transform 260ms ease, border-color 220ms ease" };
const brandBlockCollapsed = { width: 0, padding: 0, opacity: 0, transform: "translateX(-10px)", borderColor: "transparent" };
const brandLogo = { display: "block", width: "100%", height: "auto" };
const brandMarkFrame = { width: 46, height: 48, display: "grid", placeItems: "center", margin: "-4px auto 14px" };
const brandMark = { display: "block", width: 42, height: "auto" };
const sideEmail = { fontSize: 12, color: mutedRedText, margin: "6px 0 16px" };
const mainArea = { flex: 1, minWidth: 0, height: "100vh", minHeight: "100vh", padding: "24px 32px", boxSizing: "border-box", overflowX: "hidden", overflowY: "auto", background: "#ffffff" };
const topbar = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, marginBottom: 24, padding: "15px 18px", borderRadius: 16, background: "#ffffff", border: `1px solid ${brandRedBorder}`, boxShadow: "0 12px 30px rgba(226,68,7,0.08)" };
const topbarActions = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" };
const notificationButton = { padding: "10px 13px", borderRadius: 9, border: `1px solid ${brandRedBorder}`, background: brandRedSoft, color: brandRed, cursor: "pointer", fontWeight: 800 };
const topbarIdentity = { display: "flex", alignItems: "center", gap: 12, minWidth: 0 };
const backButton = { width: 40, height: 40, display: "grid", placeItems: "center", flexShrink: 0, borderRadius: 8, border: `1px solid ${brandRed}`, background: brandRed, color: "#ffffff", fontSize: 28, lineHeight: 1, cursor: "pointer" };
const welcomeBlock = { minWidth: 0 };
const welcomeEyebrow = { display: "block", fontSize: 13, color: mutedRedText, marginBottom: 4 };
const welcomeTitle = { margin: 0, color: brandRed, fontSize: 28, lineHeight: 1.15, maxWidth: 760, overflowWrap: "anywhere" };
const welcomeMeta = { margin: "6px 0 0", color: mutedRedText };
const welcomeStatusRow = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 6 };
const menuToggle = { width: 42, height: 42, flexShrink: 0, display: "grid", placeItems: "center", background: brandRed, color: "white", border: `1px solid ${brandRed}`, borderRadius: 14, cursor: "pointer", boxShadow: "0 12px 24px rgba(226,68,7,0.18)", transition: "border-radius 240ms ease, transform 220ms ease, box-shadow 240ms ease, background 240ms ease" };
const menuToggleCollapsed = { transform: "translateX(0)", borderRadius: 14 };
const menuToggleExpanded = { transform: "translateX(2px)", borderRadius: 12, boxShadow: "0 14px 30px rgba(226,68,7,0.24)" };
const menuToggleIcon = { width: 18, height: 14, position: "relative", display: "block" };
const menuToggleLine = { position: "absolute", left: 0, width: 18, height: 2, borderRadius: 999, background: "#ffffff", transformOrigin: "center", transition: "top 220ms cubic-bezier(0.22, 1, 0.36, 1), transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease" };
const menuToggleLineTop = { top: 0 };
const menuToggleLineMiddle = { top: 6, left: 2, width: 14 };
const menuToggleLineBottom = { top: 12 };
const menuToggleLineTopOpen = { top: 6, transform: "rotate(45deg)" };
const menuToggleLineMiddleOpen = { top: 6, opacity: 0, transform: "scaleX(0.4)" };
const menuToggleLineBottomOpen = { top: 6, transform: "rotate(-45deg)" };
const menuButton = { width: "100%", minHeight: 50, display: "flex", alignItems: "center", gap: 11, padding: "9px 11px", marginBottom: 9, background: "#ffffff", color: brandRed, border: `1px solid ${brandRedBorder}`, borderRadius: 12, cursor: "pointer", textAlign: "left", fontWeight: 700, overflow: "hidden", transition: "transform 180ms ease, border-color 180ms ease, background 180ms ease, box-shadow 180ms ease" };
const menuButtonActive = { ...menuButton, background: brandRed, color: "#ffffff", border: `1px solid ${brandRed}`, boxShadow: "0 8px 22px rgba(226,68,7,0.24)" };
const menuButtonCollapsed = { justifyContent: "center", padding: 6, minHeight: 58, gap: 0 };
const menuIcon = { width: 46, height: 46, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: 12, background: "transparent", color: brandRed, border: "1px solid transparent", fontSize: 17, fontWeight: 900, lineHeight: 1, overflow: "visible" };
const menuIconWithImage = { background: "transparent", border: "0 solid transparent", boxShadow: "none" };
const menuIconActive = { filter: "drop-shadow(0 6px 12px rgba(255,255,255,0.16))" };
const menuIconImage = { width: 46, height: 46, display: "block", objectFit: "contain", objectPosition: "center", transform: "none", transformOrigin: "center", filter: "drop-shadow(0 4px 8px rgba(226,68,7,0.12))" };
const menuIconImageActive = { filter: "brightness(0) invert(1) drop-shadow(0 4px 8px rgba(255,255,255,0.18))" };
const menuButtonLabel = { minWidth: 0, whiteSpace: "nowrap", opacity: 1, transform: "translateX(0)", transition: "opacity 180ms ease 60ms, transform 220ms cubic-bezier(0.22, 1, 0.36, 1) 40ms" };
const menuButtonLabelCollapsed = { opacity: 0, transform: "translateX(-8px)", transitionDelay: "0ms", pointerEvents: "none" };
const logoutButton = { padding: "12px 22px", borderRadius: 10, border: `1px solid ${brandRed}`, cursor: "pointer", fontWeight: 700, background: brandRed, color: "#ffffff" };
const syncNotice = { margin: "-8px 0 16px", padding: "10px 12px", borderRadius: 8, background: brandRedSoft, border: `1px solid ${brandRedBorder}`, color: brandRed, fontSize: 13, fontWeight: 600 };
const statsGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16, marginBottom: 24 };
const statCard = { width: "100%", minHeight: 116, display: "grid", alignContent: "center", gap: 7, padding: 20, borderRadius: 8, border: `1px solid ${brandRed}`, color: "#ffffff", cursor: "pointer", textAlign: "left", font: "inherit" };
const statCardTones = {
  total: { background: `linear-gradient(135deg,${brandRed},${brandRedDark})`, borderColor: brandRed },
  new: { background: `linear-gradient(135deg,${brandRed},#f06a30)`, borderColor: brandRed },
  assigned: { background: `linear-gradient(135deg,${brandRedDark},${brandRed})`, borderColor: brandRed },
  approved: { background: "linear-gradient(135deg,#15803d,#166534)", borderColor: "rgba(134,239,172,0.42)" },
  paid: { background: "linear-gradient(135deg,#047857,#065f46)", borderColor: "rgba(110,231,183,0.46)" },
};
const dashboardGrid = { display: "grid", gridTemplateColumns: "1fr", gap: 18 };
const panelCard = { background: "#ffffff", color: brandRed, padding: 22, borderRadius: 18, border: `1px solid ${brandRedBorder}`, boxShadow: "0 16px 34px rgba(226,68,7,0.08)" };
const pipelinePanel = { background: "#ffffff" };
const pipelineList = { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginTop: 18 };
const pipelineRow = { width: "100%", minHeight: 44, display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", borderRadius: 8, background: brandRedSoft, border: `1px solid ${brandRedBorder}`, cursor: "pointer", textAlign: "left", font: "inherit" };
const pipelineDot = { width: 8, height: 24, flexShrink: 0, borderRadius: 4 };
const pipelineLabel = { flex: 1, color: mutedRedText, fontSize: 13 };
const pipelineValue = { fontSize: 18 };
const formGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 };
const inputStyle = { width: "100%", padding: 12, marginBottom: 12, boxSizing: "border-box", borderRadius: 10, border: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed };
const searchInput = { width: "100%", padding: 13, marginBottom: 15, borderRadius: 12, border: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed, boxSizing: "border-box" };
const tableTitleRow = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 };
const exportExcelButton = { minHeight: 40, padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(134,239,172,0.42)", background: "linear-gradient(135deg,#059669,#0891b2)", color: "white", cursor: "pointer", fontWeight: 800 };
const customerToolbar = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 10 };
const toolbarSelect = { width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed };
const tableSummary = { display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10, color: mutedRedText, fontSize: 12 };
const primaryButton = { width: "100%", padding: 13, borderRadius: 10, border: `1px solid ${brandRed}`, cursor: "pointer", fontWeight: 700, background: brandRed, color: "#ffffff" };
const importProgressBox = { display: "grid", gap: 8, margin: "4px 0 14px", padding: 12, borderRadius: 8, background: brandRedSoft, border: `1px solid ${brandRedBorder}`, fontSize: 13 };
const importSummaryBox = { display: "grid", gap: 8, margin: "10px 0 14px", padding: 12, borderRadius: 10, background: "#fff7ed", border: "1px solid rgba(226,68,7,0.25)", color: "#7c2d12", fontSize: 13 };
const cleanSummaryBox = { ...importSummaryBox, background: "#ecfeff", border: "1px solid rgba(8,145,178,0.28)", color: "#164e63" };
const importSummaryGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8 };
const dataActions = { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 8, paddingTop: 14, borderTop: `1px solid ${brandRedBorder}` };
const cleanupButtons = { display: "flex", flexWrap: "wrap", gap: 8 };
const cleanInvalidButton = { padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(251,191,36,0.55)", background: "rgba(180,83,9,0.38)", color: "#fde68a", cursor: "pointer", fontWeight: 700 };
const deleteAllButton = { padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(252,165,165,0.6)", background: "rgba(127,29,29,0.56)", color: "#fecaca", cursor: "pointer", fontWeight: 700 };
const tableWrapper = { width: "100%", overflowX: "auto", background: "#ffffff", borderRadius: 14, border: `1px solid ${brandRedBorder}` };
const emptyTableState = { minWidth: 850, padding: 18, color: mutedRedText, background: "#ffffff", borderTop: `1px solid ${brandRedBorder}`, fontWeight: 700 };
const tableHeader = {
  display: "grid",
  gridTemplateColumns: "52px minmax(180px, 1.4fr) 78px minmax(110px, 0.9fr) minmax(110px, 0.9fr) minmax(100px, 0.8fr) minmax(130px, 1fr) minmax(135px, 1fr) minmax(130px, 1fr)",
  gap: 6,
  padding: 10,
  background: brandRed,
  color: "#ffffff",
  fontWeight: 700,
  minWidth: 970,
  fontSize: 12,
};
const tableRow = {
  display: "grid",
  gridTemplateColumns: "52px minmax(180px, 1.4fr) 78px minmax(110px, 0.9fr) minmax(110px, 0.9fr) minmax(100px, 0.8fr) minmax(130px, 1fr) minmax(135px, 1fr) minmax(130px, 1fr)",
  gap: 6,
  alignItems: "center",
  padding: 10,
  background: "#ffffff",
  color: brandRed,
  borderBottom: `1px solid ${brandRedBorder}`,
  minWidth: 970,
  fontSize: 14,
};
const tableWithoutTc = {
  gridTemplateColumns: "52px minmax(180px, 1.4fr) 78px minmax(110px, 0.9fr) minmax(110px, 0.9fr) minmax(130px, 1fr) minmax(135px, 1fr) minmax(130px, 1fr)",
  minWidth: 850,
};
const selectStyle = { width: "100%", padding: 8, borderRadius: 8 };
const smallButton = { padding: "8px 12px", borderRadius: 8, border: `1px solid ${brandRedBorder}`, cursor: "pointer", fontWeight: 700, background: brandRedSoft, color: brandRed };
const smallGhostButton = { padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.32)", cursor: "pointer", fontWeight: 800, background: "rgba(255,255,255,0.08)", color: "#ffffff" };
const phoneLink = { color: brandRed, fontWeight: 800, fontSize: 15 };
const bulkBar = { display: "grid", gridTemplateColumns: "120px 150px 1fr 150px", gap: 10, alignItems: "center", marginBottom: 12, background: brandRedSoft, padding: 12, borderRadius: 12 };
const paginationBar = { display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 16 };
const topPaginationBar = { marginTop: 0, marginBottom: 14, padding: "10px 12px", borderRadius: 9, background: brandRedSoft, border: `1px solid ${brandRedBorder}` };
const releaseRepBar = { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12, padding: "10px 12px", borderRadius: 9, background: "rgba(180,83,9,0.18)", border: "1px solid rgba(251,191,36,0.35)", color: "#fde68a", fontSize: 13 };
const releaseToPoolButton = { padding: "8px 11px", borderRadius: 7, border: "1px solid rgba(125,211,252,0.5)", background: "rgba(14,116,144,0.35)", color: "#cffafe", cursor: "pointer", fontWeight: 800 };
const paginationButton = { minWidth: 66, padding: "8px 10px", borderRadius: 7, border: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed, cursor: "pointer", fontWeight: 700 };
const employeeRow = { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#ffffff", color: brandRed, padding: 14, borderRadius: 12, marginBottom: 10, border: `1px solid ${brandRedBorder}` };
const employeeIdentity = { display: "flex", alignItems: "center", gap: 12, minWidth: 0 };
const roleBadge = { background: brandRed, color: "#ffffff", padding: "6px 12px", borderRadius: 999, fontSize: 13 };
const onlineBadgeStyle = { display: "inline-flex", width: "fit-content", padding: "5px 8px", borderRadius: 999, background: "rgba(34,197,94,0.16)", color: "#15803d", fontSize: 12, fontWeight: 800 };
const offlineBadgeStyle = { ...onlineBadgeStyle, background: "rgba(148,163,184,0.16)", color: "#64748b" };
const staffActions = { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 };
const deleteStaffButton = { padding: "7px 10px", borderRadius: 7, border: "1px solid rgba(252,165,165,0.55)", background: "rgba(127,29,29,0.5)", color: "#fecaca", cursor: "pointer", fontWeight: 700 };
const staffFormBox = { background: "#ffffff", color: brandRed, padding: 18, borderRadius: 14, marginBottom: 20, border: `1px solid ${brandRedBorder}` };
const repCenterLayout = { display: "grid", gap: 18 };
const repCenterHeader = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, flexWrap: "wrap" };
const repCenterFilters = { display: "grid", gridTemplateColumns: "minmax(200px,1fr) minmax(150px,190px)", gap: 10, minWidth: "min(100%,410px)" };
const repCenterTabs = { display: "flex", gap: 8, flexWrap: "wrap", margin: "22px 0 18px", paddingBottom: 12, borderBottom: `1px solid ${brandRedBorder}` };
const repTabButton = { padding: "9px 13px", borderRadius: 9, border: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed, cursor: "pointer", fontWeight: 700 };
const repTabActive = { ...repTabButton, background: brandRed, color: "white", borderColor: brandRed, boxShadow: "0 8px 20px rgba(226,68,7,0.22)" };
const repMetricGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 18 };
const repMetricCard = { display: "grid", gap: 7, minHeight: 92, alignContent: "center", padding: 15, borderRadius: 12, border: "1px solid", background: "#ffffff" };
const repComparisonTable = { overflowX: "auto", borderRadius: 12, border: `1px solid ${brandRedBorder}`, background: "#ffffff" };
const repComparisonHeader = { minWidth: 1120, display: "grid", gridTemplateColumns: "minmax(210px,1.6fr) repeat(8,minmax(72px,.65fr)) minmax(135px,1fr)", gap: 8, padding: "11px 13px", background: brandRed, color: "#ffffff", fontSize: 11, fontWeight: 800 };
const repComparisonRow = { width: "100%", minWidth: 1120, display: "grid", gridTemplateColumns: "minmax(210px,1.6fr) repeat(8,minmax(72px,.65fr)) minmax(135px,1fr)", gap: 8, alignItems: "center", padding: "11px 13px", border: 0, borderBottom: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed, cursor: "pointer", textAlign: "left" };
const repTableIdentity = { display: "flex", alignItems: "center", gap: 9, minWidth: 0 };
const activityStream = { display: "grid", gap: 8, maxHeight: "68vh", overflowY: "auto", paddingRight: 4 };
const activityStreamRow = { display: "grid", gridTemplateColumns: "145px minmax(140px,.8fr) minmax(180px,1fr) 150px minmax(180px,1.2fr)", gap: 10, alignItems: "center", padding: "11px 12px", borderRadius: 10, border: `1px solid ${brandRedBorder}`, borderLeft: "4px solid", background: "#ffffff", minWidth: 830 };
const activityTime = { color: mutedRedText, fontSize: 11 };
const activityRep = { color: brandRed, fontWeight: 800, fontSize: 12 };
const activityCustomer = { color: brandRed, fontWeight: 700, fontSize: 12 };
const activityNote = { color: mutedRedText, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const overdueBadge = { padding: "5px 8px", borderRadius: 999, background: "rgba(239,68,68,0.2)", color: "#fca5a5", fontSize: 11, fontWeight: 800, textAlign: "center" };
const waitingBadge = { ...overdueBadge, background: "rgba(245,158,11,0.18)", color: "#fde68a" };
const jettelExtensionPanel = { display: "grid", gap: 14 };
const jettelExtensionTable = { display: "grid", gap: 0, borderRadius: 12, overflow: "hidden", border: `1px solid ${brandRedBorder}`, background: "#ffffff" };
const jettelExtensionHeader = { display: "grid", gridTemplateColumns: "100px 150px 120px 120px minmax(240px,1fr)", gap: 10, padding: "11px 13px", background: brandRed, color: "#ffffff", fontSize: 12, fontWeight: 800, minWidth: 760 };
const jettelExtensionRow = { display: "grid", gridTemplateColumns: "100px 150px 120px 120px minmax(240px,1fr)", gap: 10, alignItems: "center", padding: "11px 13px", borderBottom: `1px solid ${brandRedBorder}`, minWidth: 760, color: brandRed };
const jettelExtensionSelectWrap = { display: "grid", gap: 2 };
const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 999 };
const modalCard = { width: 860, maxWidth: "94%", maxHeight: "90vh", overflowY: "auto", background: "#ffffff", color: brandRed, padding: 25, borderRadius: 20, border: `1px solid ${brandRedBorder}` };
const closeButton = { float: "right", padding: 8, cursor: "pointer", borderRadius: 8, border: `1px solid ${brandRed}`, background: brandRed, color: "#ffffff" };
const customerHero = { background: brandRed, color: "#ffffff", padding: 18, borderRadius: 16, marginBottom: 16, border: `1px solid ${brandRed}` };
const customerHeroTitle = { color: "white", textAlign: "center", marginBottom: 15, fontSize: 28 };
const customerInfoGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 };
const infoPill = { background: "rgba(255,255,255,0.14)", padding: 12, borderRadius: 12, color: "#ffffff", textAlign: "center", border: "1px solid rgba(255,255,255,0.32)" };
const quickActions = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, margin: "15px 0" };
const quickActionButton = { padding: 11, borderRadius: 10, border: "none", background: brandRed, color: "white", textAlign: "center", textDecoration: "none", cursor: "pointer", fontWeight: 700 };
const wrongNumberButton = { background: "linear-gradient(135deg,#ef4444,#b91c1c)" };
const detailLayout = { display: "grid", gridTemplateColumns: "250px minmax(0,1fr)", gap: 14, marginBottom: 16 };
const statusRail = { background: "#ffffff", borderRadius: 14, border: `1px solid ${brandRedBorder}`, padding: 12 };
const railTitle = { margin: "0 0 10px", fontSize: 14, color: brandRed };
const statusMenuButton = { width: "100%", display: "block", marginBottom: 8, padding: "10px 12px", borderRadius: 10, border: `1px solid ${brandRedBorder}`, cursor: "pointer", fontWeight: 700, color: brandRed, background: "#ffffff" };
const statusMenuTone = {
  new: { background: "rgba(37,99,235,0.4)" },
  called: { background: "rgba(251,146,60,0.28)" },
  muted: { background: "rgba(71,85,105,0.35)" },
  warn: { background: "rgba(194,65,12,0.32)" },
  using: { background: "rgba(20,184,166,0.28)" },
  callback: { background: "rgba(168,85,247,0.28)" },
  appointment: { background: "rgba(234,179,8,0.3)" },
  contract: { background: "rgba(6,182,212,0.28)" },
  danger: { background: "rgba(239,68,68,0.3)" },
  success: { background: "rgba(34,197,94,0.26)" },
  paid: { background: "rgba(5,150,105,0.3)" },
};
const statusMenuActive = { outline: `2px solid ${brandRed}`, outlineOffset: 2 };
const detailFormColumn = { background: "#ffffff", borderRadius: 14, border: `1px solid ${brandRedBorder}`, padding: 16 };
const duplicateWarning = { marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.38)", color: "#fde68a", fontSize: 13, lineHeight: 1.45 };
const customerHeatBar = { height: 4, borderRadius: 999, marginBottom: 16, opacity: 0.95 };
const customerSummary = { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 9, margin: "-4px 0 16px" };
const heatBadge = { padding: "5px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700 };
const customerSummaryText = { color: mutedRedText, fontSize: 13 };
const historyTitle = { margin: "24px 0 12px", fontSize: 18, fontWeight: 600, letterSpacing: 0 };
const logBox = { background: "#ffffff", color: brandRed, padding: "14px 16px", borderRadius: 10, marginBottom: 10, border: `1px solid ${brandRedBorder}` };
const logUser = { display: "block", fontSize: 14, fontWeight: 600, color: brandRed };
const logSourceText = { display: "inline-block", marginTop: 8, padding: "4px 8px", borderRadius: 999, background: brandRedSoft, color: brandRed, fontSize: 12, fontWeight: 700 };
const logStatusRow = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, margin: "10px 0 0", color: mutedRedText, fontSize: 13 };
const logNote = { margin: "12px 0 0", color: brandRed, fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" };
const logEmptyNote = { margin: "12px 0 0", color: "#94a3b8", fontSize: 13, fontStyle: "italic" };
const logTime = { display: "block", marginTop: 10, color: "#94a3b8", fontSize: 12 };
const logLoadingText = { padding: "14px 16px", borderRadius: 10, background: brandRedSoft, border: `1px solid ${brandRedBorder}`, color: brandRed };
const fieldLabel = { display: "block", margin: "12px 0 6px", fontWeight: 700, fontSize: 13, color: brandRed };
const reportsLayout = { display: "grid", gap: 18 };
const sectionHeader = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, marginBottom: 18 };
const chartList = { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 };
const chartRow = { display: "grid", gap: 12, padding: 14, borderRadius: 8, border: "1px solid" };
const chartLabel = { display: "flex", justifyContent: "space-between", gap: 12 };
const chartTrack = { height: 12, borderRadius: 999, background: brandRedSoft, overflow: "hidden", border: `1px solid ${brandRedBorder}` };
const chartBar = { height: "100%", borderRadius: 999, background: brandRed };
const reportChartHeader = { display: "flex", alignItems: "center", gap: 10, minWidth: 0 };
const reportIcon = { width: 34, height: 34, display: "grid", placeItems: "center", flexShrink: 0, borderRadius: 7, fontWeight: 900 };
const reportChartTitle = { flex: 1, minWidth: 0, color: brandRed };
const reportFigure = { minWidth: 52, textAlign: "right", fontSize: 22, fontWeight: 900 };
const reportVisuals = {
  total: { icon: "◎", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  pool: { icon: "+", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  assigned: { icon: "→", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  fresh_assigned: { icon: "+", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  followups: { icon: "!", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  today_work: { icon: "☑", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  called: { icon: "✓", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  no_answer: { icon: "…", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  busy: { icon: "●", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  callback: { icon: "↶", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  appointment: { icon: "◦", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  contract_appointment: { icon: "▢", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  not_approved: { icon: "×", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  wrong_number: { icon: "!", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  using: { icon: "✓", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  approved: { icon: "✓", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
  paid: { icon: "₺", color: brandRed, background: brandRedSoft, border: brandRedBorder, iconBackground: "#ffffff", bar: brandRed },
};
const leaderRow = { display: "grid", gridTemplateColumns: "1fr 110px 110px 90px 90px", gap: 10, alignItems: "center", background: "#ffffff", color: brandRed, padding: 12, borderRadius: 8, marginTop: 10, border: `1px solid ${brandRedBorder}` };
const leaderFigure = { display: "flex", alignItems: "center", gap: 7, color: brandRed, fontSize: 13 };
const dataSourceRow = { display: "grid", gridTemplateColumns: "minmax(170px, 1fr) repeat(4, auto)", gap: 16, alignItems: "center", background: "#ffffff", color: brandRed, padding: 12, borderRadius: 10, marginTop: 10, border: `1px solid ${brandRedBorder}`, fontSize: 13 };
const dataMetric = { minWidth: 64, padding: "5px 8px", borderRadius: 6, background: brandRedSoft, fontWeight: 800, textAlign: "center" };
const workSummaryGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 };
const workSummaryItem = { display: "grid", gap: 6, padding: 14, borderLeft: "3px solid", background: "#ffffff", borderRadius: 8 };
const workSummaryLabel = { color: mutedRedText, fontSize: 13 };
const workSummaryValue = { fontSize: 26, lineHeight: 1 };
const todayDateBadge = { padding: "7px 10px", borderRadius: 999, background: brandRedSoft, color: brandRed, fontSize: 13, fontWeight: 600 };
const dailyFocusBadge = { padding: "7px 10px", borderRadius: 999, background: "rgba(52,211,153,0.14)", color: "#a7f3d0", fontSize: 13, fontWeight: 600 };
const dailyMetricGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 };
const dailyMetricItem = { display: "grid", gap: 9, padding: 14, borderRadius: 8, border: `1px solid ${brandRedBorder}`, color: brandRed, cursor: "pointer", textAlign: "left", font: "inherit" };
const assignmentSection = { marginTop: 24, paddingTop: 20, borderTop: `1px solid ${brandRedBorder}` };
const workloadRow = { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${brandRedBorder}` };
const workloadAvailable = { color: "#86efac", fontSize: 13, fontWeight: 600 };
const workloadBusy = { color: "#fcd34d", fontSize: 13, fontWeight: 600 };
const customerNameCell = { display: "grid", gap: 6, minWidth: 0 };
const customerNameLine = { display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" };
const freshCustomerBadge = { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "3px 8px", borderRadius: 999, background: brandRed, color: "white", fontSize: 11, fontWeight: 900, boxShadow: "0 0 14px rgba(226,68,7,0.28)", letterSpacing: 0.2 };
const customerStatusLine = { width: "100%", height: 4, borderRadius: 4, opacity: 0.95 };
const celebrationBackdrop = { position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: 20, background: "rgba(2,6,23,0.78)", backdropFilter: "blur(5px)" };
const celebrationCard = { width: 380, maxWidth: "100%", position: "relative", overflow: "hidden", padding: 32, borderRadius: 12, textAlign: "center", background: brandRed, color: "#ffffff", border: `1px solid ${brandRed}` };
const celebrationConfetti = { height: 26, display: "flex", justifyContent: "space-around", alignItems: "center", marginBottom: 14 };
const confettiPiece = { width: 9, height: 20, display: "block", borderRadius: 2 };
const celebrationEyebrow = { color: "#a7f3d0", fontSize: 12, fontWeight: 800, letterSpacing: 1.2 };
const celebrationTitle = { margin: "12px 0 4px", color: "#f8fafc", fontSize: 32 };
const celebrationCustomer = { margin: "0 0 10px", color: "#fde68a", fontSize: 18, fontWeight: 700 };
const callNoticePopup = { position: "fixed", right: 22, bottom: 22, width: 360, maxWidth: "calc(100vw - 32px)", zIndex: 1300, display: "grid", gap: 12, padding: 16, borderRadius: 18, border: "1px solid rgba(253,186,116,0.46)", background: "linear-gradient(145deg,rgba(127,29,29,0.98),rgba(226,68,7,0.96))", color: "#ffffff", boxShadow: "0 22px 60px rgba(0,0,0,0.42)" };
const callNoticeHeader = { display: "grid", gridTemplateColumns: "42px 1fr 28px", gap: 10, alignItems: "center" };
const callNoticePulse = { width: 42, height: 42, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#ffffff", color: brandRed, fontSize: 22, fontWeight: 900, boxShadow: "0 0 0 8px rgba(255,255,255,0.12)" };
const callNoticeClose = { width: 28, height: 28, border: "none", borderRadius: "50%", background: "rgba(255,255,255,0.16)", color: "#ffffff", cursor: "pointer", fontSize: 20, lineHeight: 1 };
const callNoticeMeta = { display: "grid", gap: 4, fontSize: 12, color: "rgba(255,255,255,0.84)" };
const callNoticeActions = { display: "flex", gap: 8, flexWrap: "wrap" };
const calendarGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 16 };
const calendarDay = { background: "#ffffff", color: brandRed, padding: 14, borderRadius: 14, border: `1px solid ${brandRedBorder}` };
const calendarItem = { width: "100%", display: "grid", gap: 4, textAlign: "left", marginTop: 10, padding: 10, borderRadius: 10, border: `1px solid ${brandRedBorder}`, background: brandRedSoft, color: brandRed, cursor: "pointer" };
const calendarItemMeta = { color: mutedRedText, fontSize: 12, opacity: 0.86 };
const loginPage = { minHeight: "100vh", background: "#ffffff", display: "grid", gridTemplateColumns: "1.2fr 420px", alignItems: "center", gap: 50, padding: "60px 9%", color: brandRed };
const loginLeft = { maxWidth: 620 };
const brandBadge = { display: "inline-block", background: brandRedSoft, border: `1px solid ${brandRedBorder}`, padding: "8px 14px", borderRadius: 999, fontSize: 13, letterSpacing: 1, marginBottom: 22 };
const loginHeroTitle = { fontSize: 56, lineHeight: 1.05, margin: "0 0 20px 0" };
const loginHeroText = { fontSize: 18, lineHeight: 1.6, opacity: 0.9, maxWidth: 520 };
const loginFeatureGrid = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginTop: 35, maxWidth: 500 };
const loginFeature = { background: "#ffffff", border: `1px solid ${brandRedBorder}`, padding: 16, borderRadius: 16 };
const loginCard = { background: "#ffffff", border: `1px solid ${brandRedBorder}`, boxShadow: "0 30px 80px rgba(226,68,7,0.16)", backdropFilter: "blur(16px)", padding: 34, borderRadius: 24, color: brandRed };
const loginCardStack = { display: "grid", gap: 14 };
const poweredByVercel = { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, color: "#94a3b8", fontSize: 12, fontWeight: 600 };
const vercelMark = { color: "#e2e8f0", fontSize: 11, lineHeight: 1 };
const loginInput = { width: "100%", padding: "14px 15px", marginBottom: 16, boxSizing: "border-box", borderRadius: 12, border: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed };
const loginButton = { width: "100%", padding: 14, borderRadius: 12, border: "none", background: brandRed, color: "white", fontWeight: 700, cursor: "pointer" };
const avatarBase = { display: "grid", placeItems: "center", overflow: "hidden", boxSizing: "border-box", borderRadius: "50%", background: brandRed, color: "#ffffff", border: `2px solid ${brandRedBorder}`, fontWeight: 800 };
const accountLayout = { display: "grid", gap: 18 };
const accountHero = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, padding: 22, borderRadius: 8, background: brandRed, color: "#ffffff", border: `1px solid ${brandRed}` };
const avatarUploadButton = { marginLeft: "auto", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.48)", background: "rgba(255,255,255,0.14)", color: "#ffffff", cursor: "pointer", fontWeight: 700 };
const accountGrid = { display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(280px,0.8fr)", gap: 18, alignItems: "start" };
const accountEmailBox = { display: "grid", gap: 5, margin: "18px 0", padding: 14, borderRadius: 8, background: brandRedSoft, border: `1px solid ${brandRedBorder}`, overflowWrap: "anywhere" };
const securityButton = { ...primaryButton, background: brandRed };
const availabilityControl = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 };
const availabilityButton = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed, cursor: "pointer", fontWeight: 700 };
const availabilityOnlineActive = { ...availabilityButton, background: "rgba(5,150,105,0.24)", borderColor: "rgba(52,211,153,0.58)", color: "#6ee7b7" };
const availabilityBusyActive = { ...availabilityButton, background: "rgba(194,65,12,0.24)", borderColor: "rgba(251,146,60,0.58)", color: "#fdba74" };
const messagingLayout = { height: "calc(100vh - 142px)", minHeight: 560, display: "grid", gridTemplateColumns: "280px minmax(0,1fr)", overflow: "hidden", borderRadius: 8, border: `1px solid ${brandRedBorder}`, background: "#ffffff" };
const conversationSidebar = { minWidth: 0, overflowY: "auto", padding: 12, borderRight: `1px solid ${brandRedBorder}`, background: "#ffffff" };
const conversationHeading = { padding: "6px 8px 14px" };
const contactSearchInput = { width: "100%", boxSizing: "border-box", marginBottom: 10, padding: "9px 10px", borderRadius: 7, border: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed };
const conversationButton = { width: "100%", minHeight: 58, display: "flex", alignItems: "center", gap: 10, padding: 9, marginBottom: 6, borderRadius: 8, border: "1px solid transparent", background: "transparent", color: brandRed, textAlign: "left", cursor: "pointer", font: "inherit" };
const conversationButtonActive = { ...conversationButton, background: brandRedSoft, borderColor: brandRedBorder };
const generalAvatar = { width: 38, height: 38, minWidth: 38, display: "grid", placeItems: "center", borderRadius: 8, background: "rgba(13,148,136,0.32)", color: "#5eead4", fontSize: 20, fontWeight: 900, border: "1px solid rgba(94,234,212,0.34)" };
const contactCopy = { minWidth: 0, flex: 1, display: "grid", overflow: "hidden" };
const contactRole = { display: "block", color: "#94a3b8", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const lastMessagePreview = { display: "block", marginTop: 2, color: "#64748b", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const contactDivider = { margin: "14px 8px 8px", color: "#64748b", fontSize: 11, fontWeight: 800, textTransform: "uppercase" };
const unreadBadge = { minWidth: 21, height: 21, display: "grid", placeItems: "center", padding: "0 5px", boxSizing: "border-box", borderRadius: 999, background: "#22d3ee", color: "#082f49", fontSize: 11, fontWeight: 900 };
const chatPanel = { minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0,1fr) auto", background: "#ffffff" };
const chatHeader = { display: "flex", alignItems: "center", gap: 11, padding: "13px 16px", borderBottom: `1px solid ${brandRedBorder}`, background: "#ffffff" };
const messageSearchInput = { width: "min(240px,35%)", marginLeft: "auto", padding: "8px 10px", boxSizing: "border-box", borderRadius: 7, border: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed };
const messageStream = { minHeight: 0, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 9 };
const messageLine = { display: "flex", width: "100%" };
const messageBubble = { maxWidth: "min(72%,680px)", padding: "9px 12px", borderRadius: "8px 8px 8px 2px", background: brandRedSoft, border: `1px solid ${brandRedBorder}` };
const ownMessageBubble = { ...messageBubble, borderRadius: "8px 8px 2px 8px", background: brandRed, borderColor: brandRed, color: "#ffffff" };
const messageSender = { display: "block", marginBottom: 4, color: "inherit", opacity: 0.72, fontSize: 11 };
const messageText = { color: "inherit", lineHeight: 1.4, whiteSpace: "pre-wrap", overflowWrap: "anywhere" };
const messageTime = { color: "inherit", opacity: 0.62, fontSize: 10 };
const messageDateDivider = { display: "flex", alignItems: "center", justifyContent: "center", margin: "5px 0 12px", color: "#94a3b8", fontSize: 10 };
const replyPreview = { display: "grid", gap: 2, marginBottom: 7, padding: "6px 8px", borderLeft: `3px solid ${brandRed}`, borderRadius: 4, background: brandRedSoft, color: brandRed, fontSize: 10, overflow: "hidden" };
const messageImage = { display: "block", width: "min(320px,100%)", maxHeight: 240, objectFit: "cover", marginTop: 8, borderRadius: 7, border: "1px solid rgba(186,230,253,0.28)" };
const fileAttachment = { display: "block", marginTop: 8, padding: "8px 10px", borderRadius: 7, background: brandRedSoft, color: brandRed, textDecoration: "none", overflowWrap: "anywhere" };
const messageMetaRow = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 5 };
const messageActions = { display: "flex", alignItems: "center", gap: 3 };
const messageActionButton = { width: 24, height: 24, display: "grid", placeItems: "center", padding: 0, borderRadius: 5, border: `1px solid ${brandRedBorder}`, background: brandRedSoft, color: brandRed, cursor: "pointer", fontSize: 12 };
const messageReceipt = { padding: "4px 8px", borderRadius: 999, background: brandRedSoft, color: brandRed, fontSize: 10, fontWeight: 700 };
const messageComposer = { padding: 12, borderTop: `1px solid ${brandRedBorder}`, background: "#ffffff" };
const customerShareComposer = { display: "grid", gridTemplateColumns: "minmax(180px, 1fr) minmax(220px, 1.2fr) 132px", gap: 8, alignItems: "center", marginBottom: 9 };
const customerShareSearch = { width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8, border: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed };
const customerShareSelect = { width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8, border: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed };
const customerShareButton = { minHeight: 38, padding: "9px 10px", borderRadius: 8, border: `1px solid ${brandRed}`, background: brandRed, color: "white", cursor: "pointer", fontWeight: 800 };
const composerRow = { display: "grid", gridTemplateColumns: "42px minmax(0,1fr) 48px", gap: 9, alignItems: "end" };
const composerContext = { display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8, padding: "7px 9px", borderRadius: 7, borderLeft: `3px solid ${brandRed}`, background: brandRedSoft, color: brandRed, fontSize: 11, overflow: "hidden" };
const composerCloseButton = { width: 26, height: 26, flexShrink: 0, borderRadius: 5, border: 0, background: "rgba(148,163,184,0.16)", color: "#e2e8f0", cursor: "pointer" };
const attachmentSelection = { display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8, padding: "7px 9px", borderRadius: 7, background: brandRedSoft, color: brandRed, fontSize: 11, overflowWrap: "anywhere" };
const attachButton = { width: 42, height: 48, display: "grid", placeItems: "center", boxSizing: "border-box", borderRadius: 8, border: `1px solid ${brandRedBorder}`, background: brandRedSoft, color: brandRed, cursor: "pointer", fontSize: 23, fontWeight: 700 };
const messageInput = { width: "100%", minHeight: 46, maxHeight: 110, resize: "vertical", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: `1px solid ${brandRedBorder}`, background: "#ffffff", color: brandRed };
const sendMessageButton = { width: 48, height: 48, alignSelf: "end", borderRadius: 8, border: `1px solid ${brandRed}`, background: brandRed, color: "white", cursor: "pointer", fontSize: 19 };
const emptyConversation = { margin: "auto", color: "#64748b", fontSize: 14 };
const notesHeader = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, flexWrap: "wrap", marginBottom: 18 };
const notesEyebrow = { display: "inline-block", marginBottom: 6, fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: brandRed };
const notesHeaderStats = { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" };
const notesStatCard = { minWidth: 150, padding: "12px 14px", borderRadius: 14, border: `1px solid ${brandRedBorder}`, background: "#ffffff", display: "grid", gap: 3 };
const notesStatCardSoft = { minWidth: 190, padding: "12px 14px", borderRadius: 14, border: `1px solid ${brandRedBorder}`, background: brandRedSoft, display: "grid", gap: 3 };
const notesStatLabel = { fontSize: 12, color: mutedRedText };
const notesStatValue = { fontSize: 20, color: brandRed, lineHeight: 1.1 };
const notesStatSubValue = { color: "#94a3b8", fontSize: 12 };
const notesComposer = { display: "grid", gap: 10, padding: 16, borderRadius: 16, border: `1px solid ${brandRedBorder}`, background: "#ffffff" };
const notesComposerHeader = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" };
const notesComposerHint = { color: "#94a3b8", fontSize: 12 };
const notesComposerActions = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" };
const notesGrid = { display: "grid", gap: 16, marginTop: 18 };
const notesEmptyState = { padding: 18, borderRadius: 14, border: `1px dashed ${brandRedBorder}`, background: brandRedSoft };
const notesSetupNotice = { display: "flex", alignItems: "flex-start", gap: 12, padding: 16, margin: "16px 0 18px", borderRadius: 14, background: "rgba(180,83,9,0.18)", border: "1px solid rgba(251,191,36,0.38)", color: "#fde68a" };
const notesSetupIcon = { width: 36, height: 36, flexShrink: 0, borderRadius: 10, display: "grid", placeItems: "center", background: "rgba(251,191,36,0.12)", color: "#fde68a", fontWeight: 900 };
const notesSetupTitle = { display: "block", marginBottom: 4, fontSize: 16, color: "#fff7ed" };
const notesSetupText = { margin: 0, color: "#fde68a", lineHeight: 1.55 };
const notesSetupList = { margin: "10px 0 0", paddingLeft: 18, color: "#fffbeb", lineHeight: 1.6 };
const notesDaySection = { display: "grid", gap: 10 };
const notesDayHeader = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", paddingBottom: 4, borderBottom: `1px solid ${brandRedBorder}` };
const notesDayLabel = { display: "block", fontSize: 18, color: brandRed };
const notesDayDate = { margin: "4px 0 0", color: "#94a3b8", fontSize: 13 };
const notesDayCount = { padding: "7px 10px", borderRadius: 999, background: brandRedSoft, color: brandRed, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" };
const notesDayList = { display: "grid", gap: 12 };
const noteCard = { background: "#ffffff", color: brandRed, borderRadius: 14, padding: 16, border: `1px solid ${brandRedBorder}`, boxShadow: "0 12px 24px rgba(226,68,7,0.08)" };
const noteCardTop = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" };
const noteMetaRow = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const noteBadge = { padding: "5px 9px", borderRadius: 999, background: brandRedSoft, color: brandRed, fontSize: 12, fontWeight: 800 };
const noteMetaChip = { padding: "5px 9px", borderRadius: 999, background: "rgba(148,163,184,0.12)", color: "#cbd5e1", fontSize: 12, fontWeight: 700 };
const noteDeleteButton = { padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(252,165,165,0.4)", background: "rgba(127,29,29,0.48)", color: "#fecaca", cursor: "pointer", fontWeight: 700 };
const noteBody = { margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6, color: brandRed };
const noteMeta = { display: "block", marginTop: 10, color: "#94a3b8", fontSize: 12 };
const toastStyle = { position: "fixed", top: 18, left: "50%", transform: "translateX(-50%)", zIndex: 1201, padding: "12px 18px", borderRadius: 999, color: "white", fontWeight: 800, boxShadow: "0 18px 40px rgba(0,0,0,0.35)" };
const toastSuccess = { background: "linear-gradient(135deg,rgba(37,99,235,0.96),rgba(8,145,178,0.92))", border: "1px solid rgba(125,211,252,0.35)" };
const toastWarning = { background: "linear-gradient(135deg,rgba(180,83,9,0.96),rgba(127,29,29,0.92))", border: "1px solid rgba(251,191,36,0.35)" };
const errorFallbackPage = { minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "linear-gradient(145deg,#fff7ed,#ffffff)", color: brandRed };
const errorFallbackCard = { width: "min(560px,100%)", display: "grid", gap: 14, padding: 28, borderRadius: 22, border: `1px solid ${brandRedBorder}`, background: "#ffffff", boxShadow: "0 24px 70px rgba(226,68,7,0.16)" };
const errorFallbackTitle = { margin: "4px 0 0", fontSize: 30, lineHeight: 1.1, color: brandRed };
const errorFallbackText = { margin: 0, color: mutedRedText, lineHeight: 1.55 };
const errorFallbackCode = { display: "block", padding: 12, borderRadius: 10, background: brandRedSoft, color: brandRedDark, whiteSpace: "pre-wrap", overflowWrap: "anywhere" };
const errorFallbackActions = { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 };
const messageNoticeStack = { position: "fixed", top: 18, right: 18, zIndex: 1300, width: "min(390px,calc(100vw - 36px))", display: "grid", gap: 10 };
const messageNoticeCard = { width: "100%", display: "grid", gridTemplateColumns: "42px minmax(0,1fr) 24px", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, border: "1px solid rgba(103,232,249,0.42)", background: "linear-gradient(135deg,rgba(9,35,72,0.98),rgba(15,76,92,0.98))", color: "white", boxShadow: "0 18px 45px rgba(0,0,0,0.4)", cursor: "pointer", textAlign: "left" };
const messageBroadcastNoticeCard = { ...messageNoticeCard, border: "1px solid rgba(253,186,116,0.62)", background: "linear-gradient(135deg,rgba(127,29,29,0.98),rgba(226,68,7,0.96))" };
const messageNoticeIcon = { width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: 11, background: "rgba(34,211,238,0.16)", color: "#67e8f9", fontSize: 20 };
const messageBroadcastNoticeIcon = { ...messageNoticeIcon, background: "rgba(255,255,255,0.18)", color: "#fff7ed", fontWeight: 900 };
const messageNoticeCopy = { minWidth: 0, display: "grid", gap: 3 };
const messageNoticeClose = { width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: 7, background: "rgba(255,255,255,0.08)", color: "#cbd5e1", fontSize: 18 };
const appointmentNoticeStack = { position: "fixed", right: 18, bottom: 18, zIndex: 1300, width: "min(430px,calc(100vw - 36px))", display: "grid", gap: 10 };
const appointmentNoticeCard = (level) => ({ width: "100%", display: "grid", gridTemplateColumns: "42px minmax(0,1fr) 24px", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, border: level === "soon" ? "1px solid rgba(252,165,165,0.62)" : "1px solid rgba(251,191,36,0.5)", background: level === "soon" ? "linear-gradient(135deg,rgba(127,29,29,0.98),rgba(194,65,12,0.96))" : "linear-gradient(135deg,rgba(120,53,15,0.98),rgba(217,119,6,0.94))", color: "white", boxShadow: "0 18px 45px rgba(0,0,0,0.38)", cursor: "pointer", textAlign: "left" });
const appointmentNoticeIcon = { width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: 11, background: "rgba(255,255,255,0.16)", color: "#fff7ed", fontSize: 20, fontWeight: 900 };
const messageSetupNotice = { alignSelf: "center", justifySelf: "center", margin: 24, padding: 16, borderRadius: 8, background: "rgba(180,83,9,0.2)", border: "1px solid rgba(251,191,36,0.38)", color: "#fde68a", textAlign: "center" };
const presenceVisuals = {
  online: { label: "Çevrimiçi", color: "#34d399" },
  busy: { label: "Meşgul", color: "#c2410c" },
  offline: { label: "Çevrimdışı", color: "#64748b" },
};
const presenceBadge = { display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, color: "#cbd5e1", fontSize: 12, fontWeight: 700 };
const presenceBadgeCompact = { marginTop: 2, fontSize: 10 };
const presenceDot = { width: 8, height: 8, flexShrink: 0, borderRadius: "50%" };
const sectionTitle = { marginTop: 0, marginBottom: 6 };
const mutedText = { margin: 0, opacity: 0.7 };

function RootApp() {
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}

export default RootApp;
