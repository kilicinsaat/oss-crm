import { useState } from "react";
import { supabase } from "./lib/supabase";
import * as XLSX from "xlsx";

const COMPANY_MESSAGE = `
🏢 KILIÇ İNŞAAT MİMARLIK

📞 İletişim:
0 (530) 350 12 76

📧 Mail:
info@kilicinsaatmimarlik.com

📍 Adres:
Namık Kemal Mah. 68. Sokak No:34513
Lotus Çarşı Kat: 8 Daire: 36
Esenyurt / İstanbul

Herhangi bir sorunuz olursa bize ulaşabilirsiniz.
`;
const COMPANY_LOCATION_URL = "https://maps.app.goo.gl/c8cCAtc2671RzBZC9";

function App() {
  const [customerLogs, setCustomerLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkEmployee, setBulkEmployee] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [profile, setProfile] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [saleCelebration, setSaleCelebration] = useState(null);

  const [loading, setLoading] = useState(false);
  const [activePage, setActivePage] = useState("dashboard");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

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
    website: "",
    address: "",
  });

  const [staffForm, setStaffForm] = useState({
    id: "",
    email: "",
    full_name: "",
    role: "employee",
  });

  async function login(e) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setLoading(false);
      alert("Giriş hatası: " + error.message);
      return;
    }

    const { data: userProfile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();

    setLoading(false);

    if (profileError || !userProfile) {
      alert("Profil bulunamadı.");
      return;
    }

    setProfile(userProfile);
    await loadCustomers();
    await loadUsers();
  }

  async function logout() {
    await supabase.auth.signOut();
    setProfile(null);
    setCustomers([]);
    setUsers([]);
    setCustomerLogs([]);
    setSelectedIds([]);
  }

  async function loadCustomers() {
    const pageSize = 1000;
    const allCustomers = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) {
        alert("Müşteriler yüklenemedi: " + error.message);
        return;
      }

      allCustomers.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }

    setCustomers(allCustomers);
  }

  async function loadUsers() {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) setUsers(data || []);
  }

  async function loadCustomerLogs(customerId) {
  const { data, error } = await supabase
    .from("customer_logs")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) {
    alert("Geçmiş okunamadı: " + error.message);
    return;
  }

  setCustomerLogs(data || []);
}
  async function importExcel(e) {
    const file = e.target.files[0];
    if (!file || !profile) return;

    try {
      setImporting(true);
      setImportProgress({ phase: "Excel okunuyor", current: 0, total: 0 });

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });

      const isPhone = (value) => {
        const d = normalizePhone(value);
        return d.length === 10 && d.startsWith("5");
      };
      const isTc = (value) => {
        const d = String(value || "").replace(/\D/g, "");
        return d.length === 11 && !d.startsWith("05");
      };
      const cleanDigits = (value) => String(value || "").replace(/\D/g, "");

      const preparedRows = [];
      const filePhones = new Set();
      const currentPhones = new Set(
        customers.flatMap((customer) => [customer.phone, customer.phone_2]).map(normalizePhone).filter(Boolean)
      );
      let incompleteRows = 0;
      let duplicateRows = 0;

      setImportProgress({ phase: "Satırlar kontrol ediliyor", current: 0, total: rows.length });

      rows.forEach((row, index) => {
          const values = Object.values(row);
          const keys = Object.keys(row);

          const getByHeader = (names) => {
            const key = keys.find((k) =>
              names.some((n) =>
                k.toString().toLowerCase().includes(n.toLowerCase())
              )
            );
            return key ? row[key] : "";
          };

          const fullName =
            getByHeader(["adı soyadı", "adi soyadi", "ad soyad", "müşteri", "musteri"]) ||
            values.find((v) => {
              const text = String(v || "").trim();
              return text && /[a-zA-ZğüşöçıİĞÜŞÖÇ]/.test(text);
            }) ||
            "";

          const phoneValues = values
            .map((v) => cleanDigits(v))
            .filter((v) => isPhone(v));

          const headerPhone = cleanDigits(
            getByHeader(["cep tel", "cep", "telefon", "tel"])
          );

          const phoneValue = isPhone(headerPhone) ? headerPhone : phoneValues[0] || "";
          const phone2Value = phoneValues.find((p) => p !== phoneValue) || "";

          const tcValue =
            cleanDigits(getByHeader(["tc", "t.c", "kimlik"])) ||
            values.map((v) => cleanDigits(v)).find((v) => isTc(v)) ||
            "";

          const normalizedPhone = normalizePhone(phoneValue);
          if (normalizedPhone && (filePhones.has(normalizedPhone) || currentPhones.has(normalizedPhone))) {
            duplicateRows += 1;
            return;
          }

          if (!fullName || !normalizedPhone) incompleteRows += 1;
          if (normalizedPhone) filePhones.add(normalizedPhone);

          const parts = String(fullName).trim().split(/\s+/);

          preparedRows.push({
            first_name: parts.slice(0, -1).join(" ") || String(fullName),
            last_name: parts.length > 1 ? parts.at(-1) : "",
            phone: normalizedPhone || null,
            phone_2: normalizePhone(phone2Value) || null,
            tc_no: tcValue,
            email: "",
            batch_name: file.name,
            batch_page: index + 1,
            info_note: "",
            status: "pool",
            approved: false,
            payment_received: false,
            created_by: profile.id,
            last_action_by: profile.id,
          });

          if ((index + 1) % 1000 === 0 || index === rows.length - 1) {
            setImportProgress({ phase: "Satırlar kontrol ediliyor", current: index + 1, total: rows.length });
          }
        });

      let imported = 0;
      const batchSize = 500;

      for (let i = 0; i < preparedRows.length; i += batchSize) {
        const chunk = preparedRows.slice(i, i + batchSize);
        setImportProgress({ phase: "Supabase'e kaydediliyor", current: i, total: preparedRows.length });
        const { error } = await supabase
          .from("customers")
          .upsert(chunk, { onConflict: "phone", ignoreDuplicates: true });

        if (error) {
          alert("Yükleme durdu: " + error.message);
          return;
        }

        imported += chunk.length;
        setImportProgress({ phase: "Supabase'e kaydediliyor", current: imported, total: preparedRows.length });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      alert(`${imported} müşteri yükleme için işlendi. ${incompleteRows} satırda eksik ad veya telefon var; yine de yüklendi. ${duplicateRows} mükerrer satır atlandı.`);
      await loadCustomers();
    } catch (err) {
      alert("Excel okunamadı: " + err.message);
    } finally {
      setImporting(false);
      setImportProgress(null);
      e.target.value = "";
    }
  }

  async function addCustomer(e) {
    e.preventDefault();
    if (!profile) return;

    const duplicate = findDuplicateCustomer(customers, form.phone);
    if (duplicate) {
      alert(`Bu telefon zaten ${duplicate.first_name || ""} ${duplicate.last_name || ""} adına kayıtlı.`);
      return;
    }

    const { error } = await supabase.from("customers").insert({
      ...form,
      phone: normalizePhone(form.phone) || null,
      phone_2: normalizePhone(form.phone_2) || null,
      batch_page: form.batch_page ? Number(form.batch_page) : null,
      appointment_date: form.appointment_date || null,
      status: "pool",
      approved: false,
      payment_received: false,
      created_by: profile.id,
      last_action_by: profile.id,
    });

    if (error) {
      alert("Müşteri eklenemedi: " + error.message);
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
      website: "",
      address: "",
    });

    await loadCustomers();
  }

  async function addStaff(e) {
    e.preventDefault();
    if (!profile) return;

    const { error } = await supabase.from("profiles").insert({
      id: staffForm.id,
      email: staffForm.email,
      full_name: staffForm.full_name,
      role: staffForm.role,
      is_active: true,
      created_by: profile.id,
    });

    if (error) {
      alert("Kullanıcı eklenemedi: " + error.message);
      return;
    }

    alert("Kullanıcı profili eklendi.");
    setStaffForm({ id: "", email: "", full_name: "", role: "employee" });
    await loadUsers();
  }

  async function deleteStaff(staff) {
    if (!profile || profile.role !== "boss" || staff.role !== "employee") return;
    if (!window.confirm(`${staff.full_name || staff.email} adlı rep profili silinsin mi? Atanmış müşterileri havuza geri dönecek.`)) return;

    const assignedCustomerIds = customers
      .filter((customer) => customer.assigned_employee === staff.id)
      .map((customer) => customer.id);

    if (assignedCustomerIds.length > 0) {
      const { error: customerError } = await supabase
        .from("customers")
        .update({ assigned_employee: null, status: "pool", assigned_at: null, last_action_by: profile.id })
        .in("id", assignedCustomerIds);

      if (customerError) {
        alert("Rep müşterileri havuza alınamadı: " + customerError.message);
        return;
      }
    }

    const { error } = await supabase.from("profiles").delete().eq("id", staff.id);
    if (error) {
      alert("Rep profili silinemedi: " + error.message);
      return;
    }

    alert("Rep profili silindi, atanmış müşteriler havuza döndü.");
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

    const { error: logError } = await supabase
      .from("customer_logs")
      .delete()
      .not("id", "is", null);

    if (logError) {
      alert("İşlem geçmişi silinemedi: " + logError.message);
      return;
    }

    const { error } = await supabase
      .from("customers")
      .delete()
      .not("id", "is", null);

    if (error) {
      alert("Müşteriler silinemedi: " + error.message);
      return;
    }

    setSelectedCustomer(null);
    setCustomerLogs([]);
    setSelectedIds([]);
    await loadCustomers();
    alert("Tüm müşteri verisi temizlendi.");
  }

  async function assignCustomer(customerId, employeeId) {
  if (!profile) return;

  if (!employeeId) {
    alert("Rep seçilmedi.");
    return;
  }

  const { data, error } = await supabase
    .from("customers")
    .update({
      assigned_employee: employeeId,
      status: "assigned",
      assigned_at: new Date().toISOString(),
      last_action_by: profile.id,
    })
    .eq("id", customerId)
    .select();

  if (error) {
    alert("Atama hatası: " + error.message);
    return;
  }

  console.log("ATAMA SONUCU:", data);
  alert("Müşteri rep'e atandı.");
  await loadCustomers();
}

  async function bulkAssignCustomers() {
    if (!bulkEmployee || selectedIds.length === 0 || !profile) {
      alert("Müşteri ve rep seç.");
      return;
    }

    const batchSize = 100;
    let assigned = 0;

    try {
      for (let index = 0; index < selectedIds.length; index += batchSize) {
        const customerIds = selectedIds.slice(index, index + batchSize);
        const { error } = await supabase
          .from("customers")
          .update({
            assigned_employee: bulkEmployee,
            status: "assigned",
            assigned_at: new Date().toISOString(),
            last_action_by: profile.id,
          })
          .in("id", customerIds);

        if (error) throw error;
        assigned += customerIds.length;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      alert(`Toplu atama ${assigned} müşteri sonrasında durdu: ${error.message || "Bağlantı hatası"}`);
      await loadCustomers();
      return;
    }

    alert(`${assigned} müşteri atandı.`);
    setSelectedIds([]);
    setBulkEmployee("");
    await loadCustomers();
  }

  async function updateCustomer(customerId, updates) {
    if (!profile) return;
    const becamePaid = updates.status === "paid" && selectedCustomer?.status !== "paid";

    const { error } = await supabase
      .from("customers")
      .update({ ...updates, last_action_by: profile.id })
      .eq("id", customerId);

    if (error) {
      alert("Müşteri güncellenemedi: " + error.message);
      return;
    }

    console.log("LOG INSERT TEST", {
  customer_id: customerId,
  user_id: profile.id,
  old_status: selectedCustomer?.status,
  new_status: updates.status,
  note: updates.info_note,
});

    const { error: logError } = await supabase
  .from("customer_logs")
  .insert({
    customer_id: customerId,
    user_id: profile.id,
    old_status: selectedCustomer?.status || null,
    new_status: updates.status || null,
    note: updates.info_note || "",
  });

console.log("LOG ERROR", logError);

    if (logError) {
      alert("Log kaydedilemedi: " + logError.message);
      return;
    }

    await loadCustomers();
    await loadCustomerLogs(customerId);

    setSelectedCustomer((prev) => prev ? { ...prev, ...updates } : prev);
    if (becamePaid) {
      setSaleCelebration({
        name: `${selectedCustomer?.first_name || ""} ${selectedCustomer?.last_name || ""}`.trim() || "Müşteri",
      });
    } else {
      alert("Kaydedildi.");
    }
  }

  function exportCustomersToExcel(data, fileName = "oss-crm-rapor.xlsx") {
    const rows = data.map((c) => ({
      "Ad Soyad": `${c.first_name || ""} ${c.last_name || ""}`.trim(),
      Telefon: c.phone || "",
      "Telefon 2": c.phone_2 || "",
      ...(profile.role !== "employee" ? { "TC No": c.tc_no || "" } : {}),
      Data: c.batch_name || "",
      "Sayfa No": c.batch_page || "",
      Durum: statusLabel(c.status),
      "Takip Tarihi": formatDateTime(c.appointment_date),
      "Atanan": users.find((u) => u.id === c.assigned_employee)?.full_name || "",
      Not: c.info_note || "",
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Musteriler");
    XLSX.writeFile(workbook, fileName);
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

        <form onSubmit={login} style={loginCard}>
          <h2>Hoş geldin</h2>
          <p style={{ opacity: 0.65 }}>OSS paneline giriş yap</p>
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={loginInput} />
          <input placeholder="Şifre" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={loginInput} />
          <button disabled={loading} style={loginButton}>
            {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>
        </form>
      </div>
    );
  }

  const employees = users.filter((u) => ["employee", "manager"].includes(u.role));
  const managerCustomers = profile.role === "manager"
    ? customers.filter((customer) => customer.assigned_employee === profile.id)
    : [];

  const visibleCustomers =
    profile.role === "employee"
      ? customers.filter((c) => c.assigned_employee === profile.id)
      : customers;

  const filteredCustomers = visibleCustomers
    .filter((c) => {
      if (customerFilter === "all") return true;
      if (customerFilter === "pool") return c.status === "pool";
      if (customerFilter === "assigned") return !!c.assigned_employee;
      if (customerFilter === "approved") return c.approved;
      if (customerFilter === "paid") return c.payment_received;
      return true;
    })
    .filter((c) =>
      `${c.first_name || ""} ${c.last_name || ""} ${c.phone || ""} ${c.phone_2 || ""} ${c.tc_no || ""} ${c.batch_name || ""}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    );

  const followUps = customers.filter((c) =>
    ["called", "no_answer", "busy", "appointment", "contract_appointment", "callback", "meeting_done", "not_approved"].includes(c.status)
  );

const welcomeName = profile.full_name || profile.email || "Kullanıcı";

const today = new Date();
const reminderCustomers = visibleCustomers
  .filter((c) => c.appointment_date && ["callback", "appointment", "contract_appointment"].includes(c.status))
  .sort((a, b) => new Date(a.appointment_date) - new Date(b.appointment_date));
const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
const overdueReminders = reminderCustomers.filter((c) => new Date(c.appointment_date) < todayStart);
const todayWorkItems = reminderCustomers.filter((c) => isSameDay(c.appointment_date, today) || new Date(c.appointment_date) < todayStart);
const reportCustomers = profile.role === "employee" ? visibleCustomers : customers;
const repStats = users
  .filter((u) => u.role === "employee")
  .map((u) => ({ ...u, stats: getUserStats(customers, u.id) }))
  .sort((a, b) => b.stats.paid - a.stats.paid || b.stats.appointment - a.stats.appointment);
const reportStats = [
  { key: "pool", title: "Havuz", value: reportCustomers.filter((c) => c.status === "pool").length },
  { key: "called", title: "Aranan", value: reportCustomers.filter((c) => c.status === "called").length },
  { key: "callback", title: "Tekrar Aranacak", value: reportCustomers.filter((c) => c.status === "callback").length },
  { key: "appointment", title: "Randevu", value: reportCustomers.filter((c) => c.status === "appointment").length },
  { key: "contract_appointment", title: "Sözleşmeli Randevu", value: reportCustomers.filter((c) => c.status === "contract_appointment").length },
  { key: "not_approved", title: "Yapmayacak", value: reportCustomers.filter((c) => c.status === "not_approved").length },
  { key: "wrong_number", title: "Numara yanlış", value: reportCustomers.filter((c) => c.status === "wrong_number").length },
  { key: "paid", title: "Satış", value: reportCustomers.filter((c) => c.status === "paid").length },
];
const dataStats = getDataStats(reportCustomers);
const manualDuplicate = findDuplicateCustomer(customers, form.phone);

  return (
    <div style={appShell}>
      <aside style={{ ...sidebar, width: sidebarCollapsed ? 72 : 250, padding: sidebarCollapsed ? 12 : 24 }}>
        <div style={sidebarTopRow}>
          {!sidebarCollapsed && (
            <div style={brandBlock}>
              <img src="/oss-center-logo.png" alt="OSS Center" style={brandLogo} />
              <p style={sideEmail}>{roleName(profile.role)}</p>
            </div>
          )}
          <button
            type="button"
            title={sidebarCollapsed ? "Menüyü aç" : "Menüyü kapat"}
            aria-label={sidebarCollapsed ? "Menüyü aç" : "Menüyü kapat"}
            onClick={() => setSidebarCollapsed((value) => !value)}
            style={menuToggle}
          >
            ☰
          </button>
        </div>
        {sidebarCollapsed && (
          <div style={brandMarkFrame} title="OSS Center">
            <img src="/oss-center-mark.png" alt="OSS Center" style={brandMark} />
          </div>
        )}

        <MenuButton icon="▦" title="Dashboard" page="dashboard" tone="dashboard" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        <MenuButton icon="◉" title="Müşteriler" page="customers" tone="customers" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} onClickExtra={() => setCustomerFilter("all")} />

{profile.role === "employee" && (
  <>
    <MenuButton icon="+" title="Yeni Müşteriler" page="rep_new" tone="new" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
    <MenuButton icon="✓" title="Arandı" page="rep_called" tone="called" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
    <MenuButton icon="◷" title="Randevu" page="rep_appointment" tone="appointment" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
    <MenuButton icon="□" title="Sözleşmeli Randevu" page="rep_contract" tone="contract" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
    <MenuButton icon="↶" title="Tekrar Aranacak" page="rep_callback" tone="callback" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
    <MenuButton icon="×" title="Yapmayacak" page="rep_not_approved" tone="closed" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
    <MenuButton icon="₺" title="Satış" page="rep_paid" tone="paid" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
  </>
)}

        {profile.role === "manager" && (
          <MenuButton icon="◉" title={`Müşterilerim (${managerCustomers.length})`} page="manager_customers" tone="customers" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        )}

        {profile.role !== "employee" && (
          <MenuButton icon="+" title="Yeni Müşteri Havuzu" page="pool" tone="pool" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        )}

        {profile.role !== "employee" && (
          <MenuButton icon="!" title={`Takip Gerekenler (${followUps.length})`} page="followups" tone="urgent" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        )}

        <MenuButton icon="◷" title={`Bugünkü İşler (${todayWorkItems.length})`} page="today_work" tone="today" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        <MenuButton icon="▣" title="Takvim" page="calendar" tone="calendar" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        <MenuButton icon="!" title="Numara Yanlış" page="wrong_number" tone="wrong" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />

        {profile.role !== "employee" && (
          <MenuButton icon="◎" title="Çalışanlar" page="employees" tone="employees" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        )}

        <MenuButton icon="▤" title="Raporlar" page="reports" tone="reports" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
      </aside>

      <main style={mainArea}>
        <header style={topbar}>
          <div style={welcomeBlock}>
            <span style={welcomeEyebrow}>Hoş geldiniz</span>
            <h1 style={welcomeTitle}>{welcomeName}</h1>
            <p style={welcomeMeta}>{roleName(profile.role)}</p>
          </div>
          <button onClick={logout} style={logoutButton}>Çıkış</button>
        </header>

        {activePage === "dashboard" && (
          <>
            <div style={statsGrid}>
              <ClickStat title={profile.role === "employee" ? "Benim Müşterilerim" : "Toplam Müşteri"} value={visibleCustomers.length} onClick={() => { setCustomerFilter("all"); setActivePage("customers"); }} />
              {profile.role !== "employee" && <ClickStat title="Yeni Müşteriler" value={visibleCustomers.filter((c) => c.status === "pool").length} onClick={() => { setCustomerFilter("pool"); setActivePage("pool"); }} />}
              <ClickStat title="Atanmış" value={visibleCustomers.filter((c) => c.assigned_employee).length} onClick={() => { setCustomerFilter("assigned"); setActivePage("customers"); }} />
              <ClickStat title="Onaylandı" value={visibleCustomers.filter((c) => c.approved).length} onClick={() => { setCustomerFilter("approved"); setActivePage("customers"); }} />
              <ClickStat title="Para Alındı" value={visibleCustomers.filter((c) => c.payment_received).length} onClick={() => { setCustomerFilter("paid"); setActivePage("customers"); }} />
            </div>

            <div style={dashboardGrid}>
              <div style={panelCard}>
                <h2>Operasyon Pipeline</h2>
                {profile.role !== "employee" && <p>Yeni Müşteriler: {customers.filter(c => c.status === "pool").length}</p>}
                <p>Atandı: {customers.filter(c => c.status === "assigned").length}</p>
                <p>Arandı: {customers.filter(c => c.status === "called").length}</p>
                <p>Randevu: {customers.filter(c => c.status === "appointment").length}</p>
                <p>Yapmayacak: {customers.filter(c => c.status === "not_approved").length}</p>
                <p>Onaylandı: {customers.filter(c => c.status === "approved").length}</p>
                <p>Para Alındı: {customers.filter(c => c.status === "paid").length}</p>
              </div>

              <div style={panelCard}>
                <h2>🏆 Top Rep</h2>
                {users
                  .filter((u) => u.role === "employee")
                  .map((u) => ({ ...u, stats: getUserStats(customers, u.id) }))
                  .sort((a, b) => b.stats.paid - a.stats.paid)
                  .slice(0, 5)
                  .map((u, index) => (
                    <div key={u.id} style={topRepRow}>
                      <strong>#{index + 1} {u.full_name || u.email}</strong>
                      <span>Satış: {u.stats.paid}</span>
                    </div>
                  ))}
              </div>
            </div>

            {profile.role === "employee" && (
              <RepDailyOverview customers={visibleCustomers} todayItems={todayWorkItems} onNavigate={setActivePage} />
            )}

            {profile.role === "boss" && (
              <div style={{ ...panelCard, marginTop: 20 }}>
                <h2>Excel / CSV Data Yükle</h2>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={importExcel} disabled={importing} style={inputStyle} />
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
                <div style={dataActions}>
                  <span style={mutedText}>Yeniden yükleme öncesi mevcut müşteri listesini temizleyebilirsin.</span>
                  <button type="button" onClick={deleteAllCustomerData} style={deleteAllButton}>Tüm Müşteri Datasını Sil</button>
                </div>
              </div>
            )}

            {(profile.role === "boss" || profile.role === "manager") && (
              <CustomerForm form={form} setForm={setForm} addCustomer={addCustomer} duplicateCustomer={manualDuplicate} />
            )}
          </>
        )}

        {activePage === "customers" && (
          <CustomerTable
            title="Müşteriler"
            data={filteredCustomers}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={setSelectedCustomer}
            loadCustomerLogs={loadCustomerLogs}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
          />
        )}

        {activePage === "manager_customers" && (
          <CustomerTable
            title="Müşterilerim"
            data={managerCustomers}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={setSelectedCustomer}
            loadCustomerLogs={loadCustomerLogs}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
          />
        )}

        {activePage === "rep_new" && (
  <CustomerTable
    title="Yeni Gelen Müşteriler"
    data={visibleCustomers.filter((c) => c.status === "assigned")}
    employees={employees}
    profile={profile}
    assignCustomer={assignCustomer}
    setSelectedCustomer={setSelectedCustomer}
    loadCustomerLogs={loadCustomerLogs}
    searchTerm={searchTerm}
    setSearchTerm={setSearchTerm}
    selectedIds={selectedIds}
    setSelectedIds={setSelectedIds}
    bulkEmployee={bulkEmployee}
    setBulkEmployee={setBulkEmployee}
    bulkAssignCustomers={bulkAssignCustomers}
  />
)}

{activePage === "rep_called" && (
  <CustomerTable
    title="Aranan Müşteriler"
    data={visibleCustomers.filter((c) => c.status === "called")}
    employees={employees}
    profile={profile}
    assignCustomer={assignCustomer}
    setSelectedCustomer={setSelectedCustomer}
    loadCustomerLogs={loadCustomerLogs}
    searchTerm={searchTerm}
    setSearchTerm={setSearchTerm}
    selectedIds={selectedIds}
    setSelectedIds={setSelectedIds}
    bulkEmployee={bulkEmployee}
    setBulkEmployee={setBulkEmployee}
    bulkAssignCustomers={bulkAssignCustomers}
  />
)}

{activePage === "rep_appointment" && (
  <CustomerTable
    title="Randevulu Müşteriler"
    data={visibleCustomers.filter((c) => c.status === "appointment")}
    employees={employees}
    profile={profile}
    assignCustomer={assignCustomer}
    setSelectedCustomer={setSelectedCustomer}
    loadCustomerLogs={loadCustomerLogs}
    searchTerm={searchTerm}
    setSearchTerm={setSearchTerm}
    selectedIds={selectedIds}
    setSelectedIds={setSelectedIds}
    bulkEmployee={bulkEmployee}
    setBulkEmployee={setBulkEmployee}
    bulkAssignCustomers={bulkAssignCustomers}
  />
)}

{activePage === "rep_not_approved" && (
  <CustomerTable
    title="Yapmayacak Müşteriler"
    data={visibleCustomers.filter((c) => c.status === "not_approved")}
    employees={employees}
    profile={profile}
    assignCustomer={assignCustomer}
    setSelectedCustomer={setSelectedCustomer}
    loadCustomerLogs={loadCustomerLogs}
    searchTerm={searchTerm}
    setSearchTerm={setSearchTerm}
    selectedIds={selectedIds}
    setSelectedIds={setSelectedIds}
    bulkEmployee={bulkEmployee}
    setBulkEmployee={setBulkEmployee}
    bulkAssignCustomers={bulkAssignCustomers}
  />
)}

{activePage === "wrong_number" && (
  <CustomerTable
    title="Numarası Yanlış Müşteriler"
    data={visibleCustomers.filter((c) => c.status === "wrong_number")}
    employees={employees}
    profile={profile}
    assignCustomer={assignCustomer}
    setSelectedCustomer={setSelectedCustomer}
    loadCustomerLogs={loadCustomerLogs}
    searchTerm={searchTerm}
    setSearchTerm={setSearchTerm}
    selectedIds={selectedIds}
    setSelectedIds={setSelectedIds}
    bulkEmployee={bulkEmployee}
    setBulkEmployee={setBulkEmployee}
    bulkAssignCustomers={bulkAssignCustomers}
  />
)}

{activePage === "rep_contract" && (
  <CustomerTable
    title="Sözleşmeli Randevular"
    data={visibleCustomers.filter((c) => c.status === "contract_appointment")}
    employees={employees}
    profile={profile}
    assignCustomer={assignCustomer}
    setSelectedCustomer={setSelectedCustomer}
    loadCustomerLogs={loadCustomerLogs}
    searchTerm={searchTerm}
    setSearchTerm={setSearchTerm}
    selectedIds={selectedIds}
    setSelectedIds={setSelectedIds}
    bulkEmployee={bulkEmployee}
    setBulkEmployee={setBulkEmployee}
    bulkAssignCustomers={bulkAssignCustomers}
  />
)}

{activePage === "rep_callback" && (
  <CustomerTable
    title="Tekrar Aranacaklar"
    data={visibleCustomers.filter((c) => c.status === "callback")}
    employees={employees}
    profile={profile}
    assignCustomer={assignCustomer}
    setSelectedCustomer={setSelectedCustomer}
    loadCustomerLogs={loadCustomerLogs}
    searchTerm={searchTerm}
    setSearchTerm={setSearchTerm}
    selectedIds={selectedIds}
    setSelectedIds={setSelectedIds}
    bulkEmployee={bulkEmployee}
    setBulkEmployee={setBulkEmployee}
    bulkAssignCustomers={bulkAssignCustomers}
  />
)}

{activePage === "rep_paid" && (
  <CustomerTable
    title="Satış Yapılan Müşteriler"
    data={visibleCustomers.filter((c) => c.status === "paid")}
    employees={employees}
    profile={profile}
    assignCustomer={assignCustomer}
    setSelectedCustomer={setSelectedCustomer}
    loadCustomerLogs={loadCustomerLogs}
    searchTerm={searchTerm}
    setSearchTerm={setSearchTerm}
    selectedIds={selectedIds}
    setSelectedIds={setSelectedIds}
    bulkEmployee={bulkEmployee}
    setBulkEmployee={setBulkEmployee}
    bulkAssignCustomers={bulkAssignCustomers}
  />
)}

        {activePage === "pool" && (
          <CustomerTable
            title="Yeni Müşteri Havuzu"
            data={customers.filter((c) => c.status === "pool")}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={setSelectedCustomer}
            loadCustomerLogs={loadCustomerLogs}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
          />
        )}

        {activePage === "followups" && (
          <CustomerTable
            title="Takip Gerekenler"
            data={followUps}
            employees={employees}
            profile={profile}
            assignCustomer={assignCustomer}
            setSelectedCustomer={setSelectedCustomer}
            loadCustomerLogs={loadCustomerLogs}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            bulkEmployee={bulkEmployee}
            setBulkEmployee={setBulkEmployee}
            bulkAssignCustomers={bulkAssignCustomers}
          />
        )}

        {activePage === "today_work" && (
          <>
            <TodayWorkView todayItems={todayWorkItems} overdueItems={overdueReminders} />
            <CustomerTable
              title="Bugünkü İşler"
              data={todayWorkItems}
              employees={employees}
              profile={profile}
              assignCustomer={assignCustomer}
              setSelectedCustomer={setSelectedCustomer}
              loadCustomerLogs={loadCustomerLogs}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              bulkEmployee={bulkEmployee}
              setBulkEmployee={setBulkEmployee}
              bulkAssignCustomers={bulkAssignCustomers}
            />
          </>
        )}

        {activePage === "calendar" && (
          <CalendarView
            customers={reminderCustomers}
            setSelectedCustomer={setSelectedCustomer}
            loadCustomerLogs={loadCustomerLogs}
          />
        )}

        {activePage === "employees" && (
          <div style={panelCard}>
            <h2>Çalışanlar ve Managerlar</h2>

            {profile.role === "boss" && (
              <form onSubmit={addStaff} style={staffFormBox}>
                <h3>Yeni Kullanıcı Profili Ekle</h3>
                <div style={formGrid}>
                  <input placeholder="Auth UID" value={staffForm.id} onChange={(e) => setStaffForm({ ...staffForm, id: e.target.value })} style={inputStyle} />
                  <input placeholder="Ad Soyad" value={staffForm.full_name} onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })} style={inputStyle} />
                  <input placeholder="Email" value={staffForm.email} onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} style={inputStyle} />
                  <select value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })} style={inputStyle}>
                    <option value="employee">Rep</option>
                    <option value="manager">Manager</option>
                  </select>
                </div>
                <button style={primaryButton}>Kullanıcı Profili Ekle</button>
              </form>
            )}

            {users.map((u) => {
              const stats = getUserStats(customers, u.id);
              return (
                <div key={u.id} style={employeeRow}>
                  <div>
                    <strong>{u.full_name || "İsimsiz kullanıcı"}</strong>
                    <p style={{ margin: 0, opacity: 0.7 }}>{u.email}</p>
                    <p style={{ margin: "6px 0 0", opacity: 0.75, fontSize: 13 }}>
                      Müşteri: {stats.total} | Aranan: {stats.called} | Randevu: {stats.appointment} | Satış: {stats.paid}
                    </p>
                  </div>
                  <div style={staffActions}>
                    <span style={roleBadge}>{roleName(u.role)}</span>
                    {profile.role === "boss" && u.role === "employee" && (
                      <button type="button" onClick={() => deleteStaff(u)} style={deleteStaffButton}>Rep Sil</button>
                    )}
                  </div>
                </div>
              );
            })}

            {profile.role !== "employee" && (
              <AssignmentOverview employees={employees} customers={customers} />
            )}
          </div>
        )}

        {activePage === "reports" && (
          <ReportsView
            profile={profile}
            customers={reportCustomers}
            reportStats={reportStats}
            repStats={repStats}
            dataStats={dataStats}
            exportCustomersToExcel={exportCustomersToExcel}
          />
        )}

        {selectedCustomer && (
         <CustomerModal
  selectedCustomer={selectedCustomer}
  setSelectedCustomer={setSelectedCustomer}
  customerLogs={customerLogs}
  updateCustomer={updateCustomer}
  users={users}
  customers={customers}
  profile={profile}
/>
        )}

        {saleCelebration && (
          <SaleCelebration customerName={saleCelebration.name} onClose={() => setSaleCelebration(null)} />
        )}
      </main>
    </div>
  );
}

function ReportsView({ profile, customers, reportStats, repStats, dataStats, exportCustomersToExcel }) {
  const maxValue = Math.max(...reportStats.map((item) => item.value), 1);

  return (
    <div style={reportsLayout}>
      <section style={panelCard}>
        <div style={sectionHeader}>
          <div>
            <h2 style={sectionTitle}>Rapor Merkezi</h2>
            <p style={mutedText}>{profile.role === "employee" ? "Kendi müşteri performansın" : "Genel operasyon özeti"}</p>
          </div>
          <button type="button" onClick={() => exportCustomersToExcel(customers)} style={smallButton}>
            Excel Dışa Aktar
          </button>
        </div>

        <div style={chartList}>
          {reportStats.map((item) => (
            <div key={item.key} style={chartRow}>
              <div style={chartLabel}>
                <strong>{item.title}</strong>
                <span>{item.value}</span>
              </div>
              <div style={chartTrack}>
                <div style={{ ...chartBar, width: `${Math.max((item.value / maxValue) * 100, item.value ? 8 : 0)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {profile.role !== "employee" && (
        <section style={panelCard}>
          <h2 style={sectionTitle}>En İyi Rep Tablosu</h2>
          {repStats.length === 0 && <p style={mutedText}>Henüz rep bulunmuyor.</p>}
          {repStats.map((rep, index) => (
            <div key={rep.id} style={leaderRow}>
              <strong>#{index + 1} {rep.full_name || rep.email}</strong>
              <span>Müşteri: {rep.stats.total}</span>
              <span>Randevu: {rep.stats.appointment}</span>
              <span>Satış: {rep.stats.paid}</span>
            </div>
          ))}
        </section>
      )}

      {profile.role !== "employee" && (
        <section style={panelCard}>
          <h2 style={sectionTitle}>Data Kaynağı Performansı</h2>
          <p style={mutedText}>Hangi datanın daha çok randevu ve satış getirdiğini karşılaştır.</p>
          {dataStats.length === 0 && <p style={{ ...mutedText, marginTop: 14 }}>Henüz data kaynağı bulunmuyor.</p>}
          {dataStats.slice(0, 8).map((data) => (
            <div key={data.name} style={dataSourceRow}>
              <strong>{data.name}</strong>
              <span>Müşteri: {data.total}</span>
              <span>Randevu: {data.appointment}</span>
              <span>Satış: {data.paid}</span>
              <span>Hatalı: {data.wrongNumber}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
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

function RepDailyOverview({ customers, todayItems, onNavigate }) {
  const called = customers.filter((customer) => customer.status === "called").length;
  const appointments = customers.filter((customer) => ["appointment", "contract_appointment"].includes(customer.status)).length;
  const paid = customers.filter((customer) => customer.status === "paid").length;
  const maxValue = Math.max(called, appointments, paid, todayItems.length, 1);
  const metrics = [
    { label: "Bugün sırada", value: todayItems.length, color: "#60a5fa", page: "today_work", background: "linear-gradient(135deg, rgba(14,116,144,0.35), rgba(12,74,110,0.22))" },
    { label: "Arandı", value: called, color: "#fb923c", page: "rep_called", background: "linear-gradient(135deg, rgba(194,65,12,0.36), rgba(124,45,18,0.2))" },
    { label: "Randevu", value: appointments, color: "#fbbf24", page: "rep_appointment", background: "linear-gradient(135deg, rgba(161,98,7,0.36), rgba(113,63,18,0.2))" },
    { label: "Satış", value: paid, color: "#34d399", page: "rep_paid", background: "linear-gradient(135deg, rgba(4,120,87,0.38), rgba(6,78,59,0.2))" },
  ];

  return (
    <section style={{ ...panelCard, marginTop: 20 }}>
      <div style={sectionHeader}>
        <div>
          <h2 style={sectionTitle}>Günlük Görünüm</h2>
          <p style={mutedText}>Bugünkü iş yoğunluğun ve müşteri durumların.</p>
        </div>
        <span style={dailyFocusBadge}>{todayItems.length ? "Öncelik: takipler" : "Planın temiz"}</span>
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

function AssignmentOverview({ employees, customers }) {
  const poolCount = customers.filter((customer) => customer.status === "pool" || !customer.assigned_employee).length;
  const assignedCount = customers.filter((customer) => customer.assigned_employee).length;
  const suggestedLoad = employees.length ? Math.ceil((assignedCount + poolCount) / employees.length) : 0;

  return (
    <div style={assignmentSection}>
      <div style={sectionHeader}>
        <div>
          <h3 style={{ ...sectionTitle, fontSize: 18 }}>Dengeli Dağıtım</h3>
          <p style={mutedText}>Havuz: {poolCount} müşteri | Hedef yük: rep başına yaklaşık {suggestedLoad}</p>
        </div>
      </div>
      {employees.map((employee) => {
        const load = customers.filter((customer) => customer.assigned_employee === employee.id).length;
        const isLight = load < suggestedLoad;
        return (
          <div key={employee.id} style={workloadRow}>
            <strong>{employee.full_name || employee.email}</strong>
            <span style={isLight ? workloadAvailable : workloadBusy}>{load} müşteri {isLight ? "- uygun" : "- yoğun"}</span>
          </div>
        );
      })}
    </div>
  );
}

function CalendarView({ customers, setSelectedCustomer, loadCustomerLogs }) {
  const grouped = customers.reduce((acc, customer) => {
    const key = formatDate(customer.appointment_date);
    if (!acc[key]) acc[key] = [];
    acc[key].push(customer);
    return acc;
  }, {});
  const days = Object.entries(grouped).sort(([, firstDayCustomers], [, secondDayCustomers]) =>
    new Date(firstDayCustomers[0].appointment_date) - new Date(secondDayCustomers[0].appointment_date)
  );

  return (
    <div style={panelCard}>
      <h2 style={sectionTitle}>Takvim</h2>
      {days.length === 0 && <p style={mutedText}>Planlanmış geri arama veya randevu yok.</p>}
      <div style={calendarGrid}>
        {days.map(([day, dayCustomers]) => (
          <div key={day} style={calendarDay}>
            <h3>{day}</h3>
            {dayCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                style={calendarItem}
                onClick={() => {
                  setSelectedCustomer(customer);
                  loadCustomerLogs(customer.id);
                }}
              >
                <strong>{customer.first_name} {customer.last_name}</strong>
                <span>{formatTime(customer.appointment_date)} - {statusLabel(customer.status)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
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
        <input placeholder="Sayfa no" value={form.batch_page} onChange={(e) => setForm({ ...form, batch_page: e.target.value })} style={inputStyle} />
        <input placeholder="Ad" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} style={inputStyle} />
        <input placeholder="Soyad" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} style={inputStyle} />
        <input placeholder="TC No" value={form.tc_no} onChange={(e) => setForm({ ...form, tc_no: e.target.value })} style={inputStyle} />
        <input placeholder="Telefon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={inputStyle} />
        <input placeholder="Telefon 2" value={form.phone_2} onChange={(e) => setForm({ ...form, phone_2: e.target.value })} style={inputStyle} />
        <input placeholder="Web Sitesi" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} style={inputStyle} />
        <input placeholder="Adres" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} style={inputStyle} />
        <input type="datetime-local" value={form.appointment_date} onChange={(e) => setForm({ ...form, appointment_date: e.target.value })} style={inputStyle} />
      </div>
      <textarea placeholder="Not" value={form.info_note} onChange={(e) => setForm({ ...form, info_note: e.target.value })} style={{ ...inputStyle, height: 100 }} />
      <button style={primaryButton}>Müşteri Ekle</button>
    </form>
  );
}

function CustomerModal({ selectedCustomer, setSelectedCustomer, customerLogs, updateCustomer, users, customers, profile }) {
  const [detailStatus, setDetailStatus] = useState(selectedCustomer.status || "assigned");
  const [detailNote, setDetailNote] = useState("");
  const [notApprovedReason, setNotApprovedReason] = useState("");
  const [appointmentDate, setAppointmentDate] = useState(toDateTimeInputValue(selectedCustomer.appointment_date));
  const needsAppointment = ["appointment", "contract_appointment"].includes(detailStatus);
  const needsFollowUpDate = ["callback", "appointment", "contract_appointment"].includes(detailStatus);
  const heat = customerHeat(detailStatus);
  const duplicateCustomer = findDuplicateCustomer(customers, selectedCustomer.phone, selectedCustomer.id);

  function saveCustomer() {
    if (detailStatus === "not_approved" && !notApprovedReason) {
      alert("Yapmayacak durumu için bir neden seçin.");
      return;
    }

    if (detailStatus === "not_approved" && notApprovedReason === "Diğer" && !detailNote.trim()) {
      alert("Diğer nedeni seçildiğinde kısa bir açıklama yazın.");
      return;
    }

    if (needsFollowUpDate && !appointmentDate) {
      alert(needsAppointment ? "Randevu kaydı için randevu tarihi ve saati zorunlu." : "Geri arama için tarih ve saat zorunlu.");
      return;
    }

    const updates = {
      appointment_date: appointmentDate || null,
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
    updateCustomer(selectedCustomer.id, updates);
  }

  return (
    <div
      style={modalBg}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setSelectedCustomer(null);
      }}
    >
      <div style={modalCard} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => setSelectedCustomer(null)} style={closeButton} aria-label="Detayı kapat">X</button>

        <div style={customerHero}>
          <div style={{ ...customerHeatBar, background: heat.color }} />
          <h2 style={customerHeroTitle}>
            {selectedCustomer.first_name} {selectedCustomer.last_name}
          </h2>
          <div style={customerSummary}>
            <span style={{ ...heatBadge, background: heat.background, color: heat.color }}>{heat.label}</span>
            <span style={customerSummaryText}>{customerLogs.length ? `${customerLogs.length} işlem kaydı var` : "Henüz işlem kaydı yok"}</span>
          </div>
          <div style={customerInfoGrid}>
            <div style={infoPill}>📞 {selectedCustomer.phone || "-"}</div>
            <div style={infoPill}>📱 {selectedCustomer.phone_2 || "-"}</div>
            {profile.role !== "employee" && <div style={infoPill}>🪪 TC: {selectedCustomer.tc_no || "-"}</div>}
            <div style={infoPill}>📁 {selectedCustomer.batch_name || "-"} / Sayfa {selectedCustomer.batch_page || "-"}</div>
          </div>
          {duplicateCustomer && (
            <div style={duplicateWarning}>
              Aynı telefon {duplicateCustomer.first_name} {duplicateCustomer.last_name} adına da kayıtlı.
            </div>
          )}
        </div>

        <div style={quickActions}>
          <a href={`tel:${selectedCustomer.phone}`} style={quickActionButton}>Ara</a>

          <a
            href={`https://wa.me/90${String(selectedCustomer.phone || "").replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            style={quickActionButton}
          >
            WhatsApp
          </a>

          <button
            type="button"
            style={quickActionButton}
            onClick={() => {
              const phone = String(selectedCustomer.phone || "").replace(/\D/g, "");
              window.open(`https://wa.me/90${phone}?text=${encodeURIComponent(COMPANY_MESSAGE)}`, "_blank");
            }}
          >
            Bilgileri Gönder
          </button>

          <a href={COMPANY_LOCATION_URL} target="_blank" rel="noreferrer" style={quickActionButton}>Konum</a>
          <button type="button" onClick={() => setDetailStatus("wrong_number")} style={{ ...quickActionButton, ...wrongNumberButton }}>
            Numara yanlış
          </button>
        </div>

        <div style={quickOutcomeBar}>
          <span style={quickOutcomeLabel}>Arama sonucu</span>
          <button type="button" onClick={() => setDetailStatus("no_answer")} style={{ ...quickOutcomeButton, ...noAnswerButton }}>Ulaşılamadı</button>
          <button type="button" onClick={() => setDetailStatus("busy")} style={{ ...quickOutcomeButton, ...busyButton }}>Meşgul</button>
          <button type="button" onClick={() => setDetailStatus("callback")} style={{ ...quickOutcomeButton, ...callbackButton }}>Sonra ara</button>
          <button type="button" onClick={() => setDetailStatus("appointment")} style={{ ...quickOutcomeButton, ...appointmentButton }}>Randevu</button>
        </div>

        {detailStatus === "not_approved" && (
          <>
            <label style={fieldLabel}>Yapmama nedeni (zorunlu)</label>
            <select value={notApprovedReason} onChange={(e) => setNotApprovedReason(e.target.value)} style={inputStyle}>
              <option value="">Neden seçin</option>
              <option value="Fiyat uygun değil">Fiyat uygun değil</option>
              <option value="Ulaşılamadı">Ulaşılamadı</option>
              <option value="Vazgeçti">Vazgeçti</option>
              <option value="İlgilenmiyor">İlgilenmiyor</option>
              <option value="Hizmet uygun değil">Hizmet uygun değil</option>
              <option value="Diğer">Diğer</option>
            </select>
          </>
        )}

        <label style={fieldLabel}>{detailStatus === "not_approved" ? "Ek açıklama" : "İşlem notu"}</label>
        <textarea
          value={detailNote}
          onChange={(e) => setDetailNote(e.target.value)}
          placeholder={detailStatus === "not_approved" ? "Gerekirse kısa bir açıklama ekleyin..." : "Bu işlem için yeni not bırakın..."}
          style={{ ...inputStyle, height: 140 }}
        />

        <label style={fieldLabel}>
          {needsAppointment
            ? "Randevu tarihi ve saati (zorunlu)"
            : detailStatus === "callback"
              ? "Geri arama tarihi ve saati (zorunlu)"
              : "Geri arama / randevu tarihi"}
        </label>
        <input
          id="detailAppointment"
          type="datetime-local"
          value={appointmentDate}
          onChange={(e) => setAppointmentDate(e.target.value)}
          required={needsFollowUpDate}
          style={{ ...inputStyle, borderColor: needsFollowUpDate ? "#fbbf24" : "#cbd5e1" }}
        />

        <select value={detailStatus} onChange={(e) => setDetailStatus(e.target.value)} style={inputStyle}>
<option value="assigned">Yeni</option>
<option value="called">Arandı</option>
<option value="no_answer">Ulaşılamadı</option>
<option value="busy">Meşgul</option>
<option value="callback">Tekrar Aranacak</option>
<option value="appointment">Randevu</option>
<option value="contract_appointment">Sözleşmeli Randevu</option>
<option value="not_approved">Yapmayacak</option>
<option value="wrong_number">Numara yanlış</option>
<option value="approved">Onaylandı</option>
<option value="paid">Para Alındı</option>
        </select>

        <button
          style={primaryButton}
          onClick={saveCustomer}
        >
          Kaydet
        </button>

        <h3 style={historyTitle}>İşlem Geçmişi</h3>

        {customerLogs.length === 0 && <p style={{ opacity: 0.7 }}>Henüz işlem yok.</p>}

        {customerLogs.map((log) => (
          <div key={log.id} style={{ ...logBox, borderLeft: `4px solid ${customerHeat(log.new_status).color}` }}>
            <strong style={logUser}>
  İşlem yapan: {
    users.find((u) => u.id === log.user_id)?.full_name ||
    users.find((u) => u.id === log.user_id)?.email ||
    "Bilinmeyen kullanıcı"
  }
</strong>
            <p style={logStatusRow}>Durum: {statusLabel(log.old_status)} → <span style={statusBadge(log.new_status)}>{statusLabel(log.new_status)}</span></p>
            {log.note ? <p style={logNote}>{log.note}</p> : <p style={logEmptyNote}>Not bırakılmadı.</p>}
            <small style={logTime}>{formatDateTime(log.created_at)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomerTable({
  title,
  data,
  employees,
  profile,
  assignCustomer,
  setSelectedCustomer,
  loadCustomerLogs,
  searchTerm,
  setSearchTerm,
  selectedIds,
  setSelectedIds,
  bulkEmployee,
  setBulkEmployee,
  bulkAssignCustomers,
}) {
  const canManage = profile.role === "boss" || profile.role === "manager";
  const canViewTc = profile.role !== "employee";

  function toggleSelected(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <div style={panelCard}>
      <h2>{title}</h2>

      <input
        placeholder="Müşteri ara: isim, telefon, TC, data adı..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        style={searchInput}
      />

      {canManage && (
  <div style={bulkBar}>
    <strong>Seçili: {selectedIds.length}</strong>

    <button
      type="button"
      style={smallButton}
      onClick={() => {
        const ids = data.map((c) => c.id);
        const allSelected = ids.every((id) => selectedIds.includes(id));
        setSelectedIds(allSelected ? [] : ids);
      }}
    >
      Tümünü Seç
    </button>

    <select
      value={bulkEmployee}
      onChange={(e) => setBulkEmployee(e.target.value)}
      style={selectStyle}
    >
      <option value="">Rep / manager seç</option>
      {employees.map((emp) => (
        <option key={emp.id} value={emp.id}>
          {emp.full_name || emp.email}
        </option>
      ))}
    </select>

    <button onClick={bulkAssignCustomers} style={smallButton}>
      Seçilenleri Ata
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

        {data.map((c) => (
          <div key={c.id} style={{ ...tableRow, ...(canViewTc ? {} : tableWithoutTc), borderLeft: `4px solid ${customerHeat(c.status).color}` }}>
            <div>
            {canManage && (
              <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelected(c.id)} />
            )}
            </div>

            <div style={customerNameCell}>
              <strong>{c.first_name} {c.last_name}</strong>
              <div style={{ ...customerStatusLine, background: customerHeat(c.status).color }}>
                <span>{statusLabel(c.status)}</span>
              </div>
            </div>

            <div>
              <button
                onClick={() => {
                  setSelectedCustomer(c);
                  loadCustomerLogs(c.id);
                }}
                style={smallButton}
              >
                Detay
              </button>
            </div>

            <div>{c.phone ? <a href={`tel:${c.phone}`} style={phoneLink}>{c.phone}</a> : "-"}</div>
            <div>{c.phone_2 ? <a href={`tel:${c.phone_2}`} style={phoneLink}>{c.phone_2}</a> : "-"}</div>
            {canViewTc && <div>{c.tc_no || "-"}</div>}
            <div>{c.batch_name || "-"}</div>
            <div>{formatDateTime(c.appointment_date)}</div>

            <div>
              {canManage ? (
                <select value={c.assigned_employee || ""} onChange={(e) => assignCustomer(c.id, e.target.value)} style={selectStyle}>
                  <option value="">Havuzda</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.full_name || emp.email}</option>
                  ))}
                </select>
              ) : "Ben"}
            </div>

          </div>
        ))}
      </div>
    </div>
  );
}

function MenuButton({ icon, title, page, tone, activePage, setActivePage, onClickExtra, collapsed }) {
  const iconTone = menuIconTones[tone] || menuIcon;
  return (
    <button
      onClick={() => {
        if (onClickExtra) onClickExtra();
        setActivePage(page);
      }}
      title={title}
      aria-label={title}
      style={{ ...(activePage === page ? menuButtonActive : menuButton), ...(collapsed ? menuButtonCollapsed : {}) }}
    >
      <span style={{ ...menuIcon, ...iconTone }}>{icon}</span>
      {!collapsed && <span>{title}</span>}
    </button>
  );
}

function ClickStat({ title, value, onClick }) {
  return (
    <div style={statCard} onClick={onClick}>
      <p style={{ opacity: 0.75 }}>{title}</p>
      <h2>{value}</h2>
    </div>
  );
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

function isSameDay(value, date) {
  if (!value) return false;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return false;
  return target.getFullYear() === date.getFullYear() &&
    target.getMonth() === date.getMonth() &&
    target.getDate() === date.getDate();
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function findDuplicateCustomer(customers, phone, excludeId) {
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 10) return null;
  return customers.find((customer) =>
    customer.id !== excludeId &&
    [customer.phone, customer.phone_2].some((item) => normalizePhone(item) === normalizedPhone)
  ) || null;
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

function getUserStats(customers, userId) {
  const myCustomers = customers.filter((c) => c.assigned_employee === userId);
  return {
    total: myCustomers.length,
    called: myCustomers.filter((c) => c.status === "called").length,
    appointment: myCustomers.filter((c) => c.status === "appointment").length,
    approved: myCustomers.filter((c) => c.approved).length,
    paid: myCustomers.filter((c) => c.payment_received).length,
  };
}

function roleName(role) {
  if (role === "boss") return "👑 Boss";
  if (role === "manager") return "📋 Manager";
  if (role === "employee") return "📞 Rep";
  return role;
}

function statusLabel(status) {
  const labels = {
    pool: "Aranmadı",
    assigned: "Yeni",
    called: "Arandı",
    no_answer: "Ulaşılamadı",
    busy: "Meşgul",
    appointment: "Randevu",
    contract_appointment: "Sözleşmeli Randevu",
callback: "Tekrar Aranacak",
    meeting_done: "Görüşüldü",
    not_approved: "Yapmayacak",
    wrong_number: "Numara yanlış",
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
  busy: "#f59e0b",
  callback: "#a855f7",
  appointment: "#eab308",
  contract_appointment: "#06b6d4",
  not_approved: "#ef4444",
  wrong_number: "#64748b",
  approved: "#22c55e",
  paid: "#059669",
};

  return {
    background: colors[status] || "#334155",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    color: "white",
    fontWeight: "bold",
    display: "inline-block",
  };
}

function customerHeat(status) {
  const levels = {
    pool: { label: "Soğuk müşteri", color: "#60a5fa", background: "rgba(96,165,250,0.14)" },
    assigned: { label: "Soğuk müşteri", color: "#60a5fa", background: "rgba(96,165,250,0.14)" },
    called: { label: "Ilık müşteri", color: "#fb923c", background: "rgba(251,146,60,0.14)" },
    no_answer: { label: "Ulaşılamadı", color: "#94a3b8", background: "rgba(148,163,184,0.14)" },
    busy: { label: "Meşgul", color: "#fbbf24", background: "rgba(251,191,36,0.14)" },
    callback: { label: "Ilık müşteri", color: "#c084fc", background: "rgba(192,132,252,0.14)" },
    appointment: { label: "Sıcak müşteri", color: "#fbbf24", background: "rgba(251,191,36,0.14)" },
    contract_appointment: { label: "Çok sıcak", color: "#f97316", background: "rgba(249,115,22,0.14)" },
    approved: { label: "Onaylandı", color: "#4ade80", background: "rgba(74,222,128,0.14)" },
    paid: { label: "Satış tamamlandı", color: "#34d399", background: "rgba(52,211,153,0.14)" },
    not_approved: { label: "Kapandı", color: "#f87171", background: "rgba(248,113,113,0.14)" },
    wrong_number: { label: "Numara yanlış", color: "#94a3b8", background: "rgba(148,163,184,0.14)" },
  };
  return levels[status] || { label: "Yeni müşteri", color: "#94a3b8", background: "rgba(148,163,184,0.14)" };
}

const parliament = "#123b7a";
const parliamentDark = "#061834";
const parliamentMid = "#0b2b5f";
const cardBlue = "#10284f";

const appShell = { width: "100%", minWidth: 0, minHeight: "100vh", background: `linear-gradient(135deg, ${parliamentDark}, #0f172a)`, color: "white", display: "flex", fontFamily: "Segoe UI, Arial, sans-serif" };
const sidebar = { background: `linear-gradient(180deg, ${parliamentDark}, #020617)`, padding: 24, borderRight: "1px solid rgba(147,197,253,0.25)", transition: "width 180ms ease, padding 180ms ease", flexShrink: 0 };
const sidebarTopRow = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, minHeight: 46, marginBottom: 18 };
const brandBlock = { width: 150, minWidth: 0, padding: "7px 8px", boxSizing: "border-box", borderRadius: 8, background: "linear-gradient(135deg,#f0f9ff,#bae6fd)", border: "1px solid rgba(125,211,252,0.72)", boxShadow: "0 8px 20px rgba(2,6,23,0.2)" };
const brandLogo = { display: "block", width: "100%", height: "auto" };
const brandMarkFrame = { width: 46, height: 48, display: "grid", placeItems: "center", margin: "-4px auto 14px" };
const brandMark = { display: "block", width: 42, height: "auto" };
const sideEmail = { fontSize: 12, color: "#bfdbfe", margin: "6px 0 16px" };
const mainArea = { flex: 1, minWidth: 0, padding: "24px 32px", overflowX: "hidden" };
const topbar = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, marginBottom: 24 };
const welcomeBlock = { minWidth: 0 };
const welcomeEyebrow = { display: "block", fontSize: 13, opacity: 0.65, marginBottom: 4 };
const welcomeTitle = { margin: 0, fontSize: 28, lineHeight: 1.15, maxWidth: 760, overflowWrap: "anywhere" };
const welcomeMeta = { margin: "6px 0 0", opacity: 0.7 };
const menuToggle = { width: 42, height: 42, flexShrink: 0, display: "grid", placeItems: "center", background: "#122647", color: "white", border: "1px solid rgba(147,197,253,0.22)", borderRadius: 8, cursor: "pointer", fontSize: 20 };
const menuButton = { width: "100%", minHeight: 46, display: "flex", alignItems: "center", gap: 11, padding: 13, marginBottom: 9, background: "#122647", color: "white", border: "1px solid rgba(147,197,253,0.12)", borderRadius: 8, cursor: "pointer", textAlign: "left", fontWeight: "bold" };
const menuButtonActive = { ...menuButton, background: `linear-gradient(135deg, ${parliament}, #2563eb)`, border: "1px solid #93c5fd", boxShadow: "0 0 0 2px rgba(37,99,235,0.18)" };
const menuButtonCollapsed = { justifyContent: "center", padding: 10 };
const menuIcon = { width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: 6, background: "rgba(125,211,252,0.14)", color: "#bae6fd", fontSize: 14, lineHeight: 1 };
const menuIconTones = {
  dashboard: { background: "rgba(56,189,248,0.16)", color: "#7dd3fc" },
  customers: { background: "rgba(96,165,250,0.16)", color: "#93c5fd" },
  new: { background: "rgba(59,130,246,0.16)", color: "#60a5fa" },
  called: { background: "rgba(251,146,60,0.16)", color: "#fdba74" },
  appointment: { background: "rgba(251,191,36,0.16)", color: "#fde68a" },
  contract: { background: "rgba(34,211,238,0.16)", color: "#67e8f9" },
  callback: { background: "rgba(192,132,252,0.16)", color: "#d8b4fe" },
  closed: { background: "rgba(248,113,113,0.16)", color: "#fca5a5" },
  paid: { background: "rgba(52,211,153,0.16)", color: "#6ee7b7" },
  pool: { background: "rgba(45,212,191,0.16)", color: "#5eead4" },
  urgent: { background: "rgba(248,113,113,0.16)", color: "#f87171" },
  today: { background: "rgba(251,146,60,0.16)", color: "#fdba74" },
  calendar: { background: "rgba(129,140,248,0.16)", color: "#a5b4fc" },
  wrong: { background: "rgba(148,163,184,0.18)", color: "#cbd5e1" },
  employees: { background: "rgba(74,222,128,0.16)", color: "#86efac" },
  reports: { background: "rgba(45,212,191,0.16)", color: "#5eead4" },
};
const logoutButton = { padding: "12px 22px", borderRadius: 10, border: "1px solid rgba(147,197,253,0.35)", cursor: "pointer", fontWeight: 700, background: "#16345f", color: "#e0f2fe" };
const statsGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16, marginBottom: 24 };
const statCard = { background: `linear-gradient(135deg, ${cardBlue}, ${parliament})`, padding: 20, borderRadius: 18, border: "1px solid rgba(147,197,253,0.25)", cursor: "pointer", boxShadow: "0 12px 30px rgba(0,0,0,0.2)" };
const dashboardGrid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 };
const panelCard = { background: "rgba(16,40,79,0.88)", padding: 22, borderRadius: 18, border: "1px solid rgba(147,197,253,0.22)", boxShadow: "0 20px 45px rgba(0,0,0,0.22)" };
const formGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 };
const inputStyle = { width: "100%", padding: 12, marginBottom: 12, boxSizing: "border-box", borderRadius: 10, border: "1px solid #bfdbfe", background: "#f8fafc", color: "#0b2b5f" };
const searchInput = { width: "100%", padding: 13, marginBottom: 15, borderRadius: 12, border: "1px solid rgba(147,197,253,0.25)", background: "#071a36", color: "white", boxSizing: "border-box" };
const primaryButton = { width: "100%", padding: 13, borderRadius: 10, border: "1px solid #7dd3fc", cursor: "pointer", fontWeight: 700, background: "linear-gradient(135deg,#38bdf8,#2563eb)", color: "#ffffff", boxShadow: "0 8px 18px rgba(37,99,235,0.28)" };
const tableWrapper = { width: "100%", overflowX: "auto", background: "#071a36", borderRadius: 14 };
const tableHeader = {
  display: "grid",
  gridTemplateColumns: "52px minmax(180px, 1.4fr) 78px minmax(110px, 0.9fr) minmax(110px, 0.9fr) minmax(100px, 0.8fr) minmax(130px, 1fr) minmax(135px, 1fr) minmax(130px, 1fr)",
  gap: 6,
  padding: 10,
  background: parliamentMid,
  fontWeight: "bold",
  minWidth: 970,
  fontSize: 12,
};

const tableRow = {
  display: "grid",
  gridTemplateColumns: "52px minmax(180px, 1.4fr) 78px minmax(110px, 0.9fr) minmax(110px, 0.9fr) minmax(100px, 0.8fr) minmax(130px, 1fr) minmax(135px, 1fr) minmax(130px, 1fr)",
  gap: 6,
  alignItems: "center",
  padding: 10,
  background: "#10284f",
  borderBottom: "1px solid rgba(147,197,253,0.16)",
  minWidth: 970,
  fontSize: 12,
};
const tableWithoutTc = {
  gridTemplateColumns: "52px minmax(180px, 1.4fr) 78px minmax(110px, 0.9fr) minmax(110px, 0.9fr) minmax(130px, 1fr) minmax(135px, 1fr) minmax(130px, 1fr)",
  minWidth: 850,
};
const selectStyle = { width: "100%", padding: 8, borderRadius: 8 };
const smallButton = { padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(125,211,252,0.4)", cursor: "pointer", fontWeight: 700, background: "#dbeafe", color: "#0b2b5f" };
const phoneLink = { color: "#7dd3fc", fontWeight: "bold" };
const bulkBar = {
  display: "grid",
  gridTemplateColumns: "120px 150px 1fr 150px",
  gap: 10,
  alignItems: "center",
  marginBottom: 12,
  background: "#071a36",
  padding: 12,
  borderRadius: 12,
};
const employeeRow = { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#071a36", padding: 14, borderRadius: 12, marginBottom: 10, border: "1px solid rgba(147,197,253,0.18)" };
const roleBadge = { background: "#2563eb", padding: "6px 12px", borderRadius: 999, fontSize: 13 };
const staffActions = { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 };
const deleteStaffButton = { padding: "7px 10px", borderRadius: 7, border: "1px solid rgba(252,165,165,0.55)", background: "rgba(127,29,29,0.5)", color: "#fecaca", cursor: "pointer", fontWeight: 700 };
const staffFormBox = { background: "#071a36", padding: 18, borderRadius: 14, marginBottom: 20, border: "1px solid rgba(147,197,253,0.18)" };
const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 999 };
const modalCard = { width: 760, maxWidth: "92%", maxHeight: "90vh", overflowY: "auto", background: `linear-gradient(135deg, ${cardBlue}, #0f172a)`, padding: 25, borderRadius: 20, border: "1px solid rgba(147,197,253,0.25)" };
const closeButton = { float: "right", padding: 8, cursor: "pointer", borderRadius: 8, border: "1px solid rgba(147,197,253,0.38)", background: "#16345f", color: "#e0f2fe" };
const customerHero = { background: `linear-gradient(135deg, ${parliamentDark}, ${parliament})`, padding: 18, borderRadius: 16, marginBottom: 16, border: "1px solid #60a5fa" };
const customerHeroTitle = { color: "white", textAlign: "center", marginBottom: 15, fontSize: 28 };
const customerInfoGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 };
const infoPill = { background: "rgba(7,26,54,0.85)", padding: 12, borderRadius: 12, color: "#e0f2fe", textAlign: "center", border: "1px solid rgba(147,197,253,0.22)" };
const quickActions = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, margin: "15px 0" };
const quickActionButton = { padding: 11, borderRadius: 10, border: "none", background: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "white", textAlign: "center", textDecoration: "none", cursor: "pointer", fontWeight: "bold" };
const wrongNumberButton = { background: "linear-gradient(135deg,#ef4444,#b91c1c)" };
const quickOutcomeBar = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, margin: "0 0 16px", padding: 10, borderRadius: 10, background: "rgba(7,26,54,0.68)", border: "1px solid rgba(147,197,253,0.15)" };
const quickOutcomeLabel = { color: "#bfdbfe", fontSize: 13, fontWeight: 600, marginRight: 2 };
const quickOutcomeButton = { padding: "7px 10px", borderRadius: 7, border: "1px solid transparent", background: "#17355f", color: "white", cursor: "pointer", fontSize: 12, fontWeight: 600 };
const noAnswerButton = { borderColor: "rgba(148,163,184,0.55)", color: "#cbd5e1" };
const busyButton = { borderColor: "rgba(251,191,36,0.55)", color: "#fde68a" };
const callbackButton = { borderColor: "rgba(192,132,252,0.55)", color: "#d8b4fe" };
const appointmentButton = { borderColor: "rgba(251,191,36,0.6)", background: "rgba(180,83,9,0.32)", color: "#fde68a" };
const duplicateWarning = { marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.38)", color: "#fde68a", fontSize: 13, lineHeight: 1.45 };
const dataActions = { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 8, paddingTop: 14, borderTop: "1px solid rgba(147,197,253,0.16)" };
const deleteAllButton = { padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(252,165,165,0.6)", background: "rgba(127,29,29,0.56)", color: "#fecaca", cursor: "pointer", fontWeight: 700 };
const importProgressBox = { display: "grid", gap: 8, margin: "4px 0 14px", padding: 12, borderRadius: 8, background: "rgba(7,26,54,0.62)", border: "1px solid rgba(125,211,252,0.2)", fontSize: 13 };
const customerHeatBar = { height: 4, borderRadius: 999, marginBottom: 16, opacity: 0.95 };
const customerSummary = { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 9, margin: "-4px 0 16px" };
const heatBadge = { padding: "5px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 };
const customerSummaryText = { color: "#cbd5e1", fontSize: 13 };
const historyTitle = { margin: "24px 0 12px", fontSize: 18, fontWeight: 600, letterSpacing: 0 };
const logBox = { background: "rgba(7,26,54,0.72)", padding: "14px 16px", borderRadius: 10, marginBottom: 10, border: "1px solid rgba(147,197,253,0.16)", boxShadow: "0 6px 18px rgba(0,0,0,0.12)" };
const logUser = { display: "block", fontSize: 14, fontWeight: 600, color: "#e0f2fe" };
const logStatusRow = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, margin: "10px 0 0", color: "#cbd5e1", fontSize: 13 };
const logNote = { margin: "12px 0 0", color: "#f1f5f9", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" };
const logEmptyNote = { margin: "12px 0 0", color: "#94a3b8", fontSize: 13, fontStyle: "italic" };
const logTime = { display: "block", marginTop: 10, color: "#94a3b8", fontSize: 12 };
const fieldLabel = { display: "block", margin: "12px 0 6px", fontWeight: "bold", fontSize: 13, color: "#bfdbfe" };
const reportsLayout = { display: "grid", gap: 18 };
const sectionHeader = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, marginBottom: 18 };
const sectionTitle = { marginTop: 0, marginBottom: 6 };
const mutedText = { margin: 0, opacity: 0.7 };
const chartList = { display: "grid", gap: 14 };
const chartRow = { display: "grid", gap: 8 };
const chartLabel = { display: "flex", justifyContent: "space-between", gap: 12 };
const chartTrack = { height: 12, borderRadius: 999, background: "#071a36", overflow: "hidden", border: "1px solid rgba(147,197,253,0.18)" };
const chartBar = { height: "100%", borderRadius: 999, background: "linear-gradient(90deg,#38bdf8,#22c55e)" };
const leaderRow = { display: "grid", gridTemplateColumns: "1fr 110px 110px 90px", gap: 10, alignItems: "center", background: "#071a36", padding: 12, borderRadius: 12, marginTop: 10, border: "1px solid rgba(147,197,253,0.18)" };
const dataSourceRow = { display: "grid", gridTemplateColumns: "minmax(170px, 1fr) repeat(4, auto)", gap: 16, alignItems: "center", background: "#071a36", padding: 12, borderRadius: 10, marginTop: 10, border: "1px solid rgba(147,197,253,0.15)", fontSize: 13 };
const workSummaryGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 };
const workSummaryItem = { display: "grid", gap: 6, padding: 14, borderLeft: "3px solid", background: "rgba(7,26,54,0.62)", borderRadius: 8 };
const workSummaryLabel = { color: "#cbd5e1", fontSize: 13 };
const workSummaryValue = { fontSize: 26, lineHeight: 1 };
const todayDateBadge = { padding: "7px 10px", borderRadius: 999, background: "rgba(56,189,248,0.14)", color: "#bae6fd", fontSize: 13, fontWeight: 600 };
const dailyFocusBadge = { padding: "7px 10px", borderRadius: 999, background: "rgba(52,211,153,0.14)", color: "#a7f3d0", fontSize: 13, fontWeight: 600 };
const dailyMetricGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 };
const dailyMetricItem = { display: "grid", gap: 9, padding: 14, borderRadius: 8, border: "1px solid rgba(147,197,253,0.22)", color: "#e0f2fe", cursor: "pointer", textAlign: "left", font: "inherit", boxShadow: "0 10px 22px rgba(0,0,0,0.16)" };
const assignmentSection = { marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(147,197,253,0.18)" };
const workloadRow = { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(147,197,253,0.12)" };
const workloadAvailable = { color: "#86efac", fontSize: 13, fontWeight: 600 };
const workloadBusy = { color: "#fcd34d", fontSize: 13, fontWeight: 600 };
const customerNameCell = { display: "grid", gap: 6, minWidth: 0 };
const customerStatusLine = { width: "100%", minHeight: 18, display: "flex", alignItems: "center", padding: "2px 8px", boxSizing: "border-box", borderRadius: 4, color: "#082f49", fontSize: 10, fontWeight: 800, letterSpacing: 0 };
const celebrationBackdrop = { position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: 20, background: "rgba(2,6,23,0.78)", backdropFilter: "blur(5px)" };
const celebrationCard = { width: 380, maxWidth: "100%", position: "relative", overflow: "hidden", padding: 32, borderRadius: 12, textAlign: "center", background: "linear-gradient(145deg,#123b7a,#064e3b)", border: "1px solid rgba(167,243,208,0.5)", boxShadow: "0 24px 70px rgba(0,0,0,0.48)" };
const celebrationConfetti = { height: 26, display: "flex", justifyContent: "space-around", alignItems: "center", marginBottom: 14 };
const confettiPiece = { width: 9, height: 20, display: "block", borderRadius: 2 };
const celebrationEyebrow = { color: "#a7f3d0", fontSize: 12, fontWeight: 800, letterSpacing: 1.2 };
const celebrationTitle = { margin: "12px 0 4px", color: "#f8fafc", fontSize: 32 };
const celebrationCustomer = { margin: "0 0 10px", color: "#fde68a", fontSize: 18, fontWeight: 700 };
const calendarGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 16 };
const calendarDay = { background: "#071a36", padding: 14, borderRadius: 14, border: "1px solid rgba(147,197,253,0.18)" };
const calendarItem = { width: "100%", display: "grid", gap: 4, textAlign: "left", marginTop: 10, padding: 10, borderRadius: 10, border: "1px solid rgba(147,197,253,0.18)", background: "#10284f", color: "white", cursor: "pointer" };

const loginPage = { minHeight: "100vh", background: `radial-gradient(circle at top left, ${parliament} 0, ${parliamentDark} 38%, #020617 100%)`, display: "grid", gridTemplateColumns: "1.2fr 420px", alignItems: "center", gap: 50, padding: "60px 9%", color: "white", fontFamily: "Arial" };
const loginLeft = { maxWidth: 620 };
const brandBadge = { display: "inline-block", background: "rgba(37,99,235,0.25)", border: "1px solid rgba(147,197,253,0.35)", padding: "8px 14px", borderRadius: 999, fontSize: 13, letterSpacing: 1, marginBottom: 22 };
const loginHeroTitle = { fontSize: 56, lineHeight: 1.05, margin: "0 0 20px 0" };
const loginHeroText = { fontSize: 18, lineHeight: 1.6, opacity: 0.9, maxWidth: 520 };
const loginFeatureGrid = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginTop: 35, maxWidth: 500 };
const loginFeature = { background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", padding: 16, borderRadius: 16 };
const loginCard = { background: "rgba(15,23,42,0.82)", border: "1px solid rgba(148,163,184,0.25)", boxShadow: "0 30px 80px rgba(0,0,0,0.45)",  backdropFilter: "blur(16px)", padding: 34, borderRadius: 24 ,color: "white", };
const loginInput = { width: "100%", padding: "14px 15px", marginBottom: 16, boxSizing: "border-box", borderRadius: 12, border: "1px solid #334155", background: "#020617", color: "white" };
const loginButton = { width: "100%", padding: 14, borderRadius: 12, border: "none", background: "linear-gradient(135deg,#2563eb,#123b7a)", color: "white", fontWeight: "bold", cursor: "pointer" };
const topRepRow = { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#071a36", padding: 12, borderRadius: 10, marginBottom: 10, border: "1px solid rgba(147,197,253,0.18)" };

export default App;
