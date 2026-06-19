import { useState } from "react";
import { supabase } from "./lib/supabase";
import * as XLSX from "xlsx";

const COMPANY_MESSAGE = `
🏢 KILIÇ İNŞAAT MİMARLIK

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

Herhangi bir sorunuz olursa bize ulaşabilirsiniz.
`;

function App() {
  const [customerLogs, setCustomerLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkEmployee, setBulkEmployee] = useState("");
  const [importing, setImporting] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [profile, setProfile] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);

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
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) setCustomers(data || []);
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

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });

      const cleanDigits = (value) => String(value || "").replace(/\D/g, "");
      const isPhone = (value) => {
        const d = cleanDigits(value);
        return d.length === 10 && d.startsWith("5");
      };
      const isTc = (value) => {
        const d = cleanDigits(value);
        return d.length === 11 && !d.startsWith("05");
      };

      const mappedRows = rows
        .map((row, index) => {
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

          if (!fullName && !phoneValue) return null;

          const parts = String(fullName).trim().split(/\s+/);

          return {
            first_name: parts.slice(0, -1).join(" ") || String(fullName),
            last_name: parts.length > 1 ? parts.at(-1) : "",
            phone: phoneValue,
            phone_2: phone2Value,
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
          };
        })
        .filter(Boolean);

      const phoneList = mappedRows.map((r) => r.phone).filter(Boolean);
      const { data: existing } = await supabase
        .from("customers")
        .select("phone")
        .in("phone", phoneList);

      const existingPhones = new Set((existing || []).map((x) => x.phone));
      const cleanRows = mappedRows.filter((r) => !existingPhones.has(r.phone));

      let imported = 0;

      for (let i = 0; i < cleanRows.length; i += 100) {
        const chunk = cleanRows.slice(i, i + 100);
        const { error } = await supabase.from("customers").insert(chunk);

        if (error) {
          alert("Yükleme hatası: " + error.message);
          setImporting(false);
          return;
        }

        imported += chunk.length;
      }

      alert(`${imported} müşteri yüklendi. ${mappedRows.length - cleanRows.length} mükerrer atlandı.`);
      await loadCustomers();
    } catch (err) {
      alert("Excel okunamadı: " + err.message);
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }

  async function addCustomer(e) {
    e.preventDefault();
    if (!profile) return;

    const { error } = await supabase.from("customers").insert({
      ...form,
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

    const { error } = await supabase
      .from("customers")
      .update({
        assigned_employee: bulkEmployee,
        status: "assigned",
        assigned_at: new Date().toISOString(),
        last_action_by: profile.id,
      })
      .in("id", selectedIds);

    if (error) {
      alert("Toplu atama hatası: " + error.message);
      return;
    }

    alert(`${selectedIds.length} müşteri atandı.`);
    setSelectedIds([]);
    setBulkEmployee("");
    await loadCustomers();
  }

  async function updateCustomer(customerId, updates) {
    if (!profile) return;

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
    alert("Kaydedildi.");
  }

  function exportCustomersToExcel(data, fileName = "oss-crm-rapor.xlsx") {
    const rows = data.map((c) => ({
      "Ad Soyad": `${c.first_name || ""} ${c.last_name || ""}`.trim(),
      Telefon: c.phone || "",
      "Telefon 2": c.phone_2 || "",
      "TC No": c.tc_no || "",
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

  const employees = users.filter((u) => u.role === "employee");

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
    ["called", "appointment", "contract_appointment", "callback", "meeting_done", "not_approved"].includes(c.status)
  );

const welcomeName = profile.full_name || profile.email || "Kullanıcı";

const today = new Date();
const reminderCustomers = visibleCustomers
  .filter((c) => c.appointment_date && ["callback", "appointment", "contract_appointment"].includes(c.status))
  .sort((a, b) => new Date(a.appointment_date) - new Date(b.appointment_date));
const todayReminders = reminderCustomers.filter((c) => isSameDay(c.appointment_date, today));
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
  { key: "paid", title: "Satış", value: reportCustomers.filter((c) => c.status === "paid").length },
];

  return (
    <div style={appShell}>
      <aside style={{ ...sidebar, width: sidebarCollapsed ? 72 : 250, padding: sidebarCollapsed ? 12 : 24 }}>
        <div style={sidebarTopRow}>
          {!sidebarCollapsed && <div><h2 style={logoText}>OSS</h2><p style={sideEmail}>{roleName(profile.role)}</p></div>}
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

        <MenuButton icon="▦" title="Dashboard" page="dashboard" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        <MenuButton icon="◉" title="Müşteriler" page="customers" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} onClickExtra={() => setCustomerFilter("all")} />

{profile.role === "employee" && (
  <>
    <MenuButton icon="+" title="Yeni Müşteriler" page="rep_new" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
    <MenuButton icon="✓" title="Arandı" page="rep_called" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
    <MenuButton icon="◷" title="Randevu" page="rep_appointment" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
    <MenuButton icon="□" title="Sözleşmeli Randevu" page="rep_contract" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
    <MenuButton icon="↶" title="Tekrar Aranacak" page="rep_callback" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
    <MenuButton icon="×" title="Yapmayacak" page="rep_not_approved" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
    <MenuButton icon="₺" title="Satış" page="rep_paid" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
  </>
)}

        {profile.role !== "employee" && (
          <MenuButton icon="+" title="Yeni Müşteri Havuzu" page="pool" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        )}

        {profile.role !== "employee" && (
          <MenuButton icon="!" title={`Takip Gerekenler (${followUps.length})`} page="followups" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        )}

        <MenuButton icon="◷" title={`Hatırlatmalar (${todayReminders.length})`} page="reminders" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        <MenuButton icon="▣" title="Takvim" page="calendar" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />

        {profile.role !== "employee" && (
          <MenuButton icon="◎" title="Çalışanlar" page="employees" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        )}

        <MenuButton icon="▤" title="Raporlar" page="reports" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
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

            {profile.role === "boss" && (
              <div style={{ ...panelCard, marginTop: 20 }}>
                <h2>Excel / CSV Data Yükle</h2>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={importExcel} style={inputStyle} />
                {importing && <p>Yükleniyor, bekle kanka...</p>}
              </div>
            )}

            {(profile.role === "boss" || profile.role === "manager") && (
              <CustomerForm form={form} setForm={setForm} addCustomer={addCustomer} />
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

        {activePage === "reminders" && (
          <CustomerTable
            title="Bugünkü Hatırlatmalar"
            data={todayReminders}
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
                  <span style={roleBadge}>{roleName(u.role)}</span>
                </div>
              );
            })}
          </div>
        )}

        {activePage === "reports" && (
          <ReportsView
            profile={profile}
            customers={reportCustomers}
            reportStats={reportStats}
            repStats={repStats}
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
/>
        )}
      </main>
    </div>
  );
}

function ReportsView({ profile, customers, reportStats, repStats, exportCustomersToExcel }) {
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
  const days = Object.keys(grouped).sort((a, b) => new Date(a) - new Date(b));

  return (
    <div style={panelCard}>
      <h2 style={sectionTitle}>Takvim</h2>
      {days.length === 0 && <p style={mutedText}>Planlanmış geri arama veya randevu yok.</p>}
      <div style={calendarGrid}>
        {days.map((day) => (
          <div key={day} style={calendarDay}>
            <h3>{day}</h3>
            {grouped[day].map((customer) => (
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

function CustomerForm({ form, setForm, addCustomer }) {
  return (
    <form onSubmit={addCustomer} style={{ ...panelCard, marginTop: 20 }}>
      <h2>Manuel Müşteri Kartı Ekle</h2>
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

function CustomerModal({ selectedCustomer, setSelectedCustomer, customerLogs, updateCustomer, users }) {
  return (
    <div style={modalBg}>
      <div style={modalCard}>
        <button onClick={() => setSelectedCustomer(null)} style={closeButton}>X</button>

        <div style={customerHero}>
          <h2 style={customerHeroTitle}>
            {selectedCustomer.first_name} {selectedCustomer.last_name}
          </h2>
          <div style={customerInfoGrid}>
            <div style={infoPill}>📞 {selectedCustomer.phone || "-"}</div>
            <div style={infoPill}>📱 {selectedCustomer.phone_2 || "-"}</div>
            <div style={infoPill}>🪪 TC: {selectedCustomer.tc_no || "-"}</div>
            <div style={infoPill}>📁 {selectedCustomer.batch_name || "-"} / Sayfa {selectedCustomer.batch_page || "-"}</div>
          </div>
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

          <button type="button" style={quickActionButton}>Konum</button>
          <button type="button" style={quickActionButton}>Web Sitesi</button>
        </div>

        <label style={fieldLabel}>Tarihli not</label>
        <textarea defaultValue={selectedCustomer.info_note || ""} id="detailNote" placeholder="Müşteri notu..." style={{ ...inputStyle, height: 140 }} />

        <label style={fieldLabel}>Geri arama / randevu tarihi</label>
        <input
          id="detailAppointment"
          type="datetime-local"
          defaultValue={toDateTimeInputValue(selectedCustomer.appointment_date)}
          style={inputStyle}
        />

        <select id="detailStatus" defaultValue={selectedCustomer.status} style={inputStyle}>
          <option value="assigned">Yeni</option>
<option value="called">Arandı</option>
<option value="callback">Tekrar Aranacak</option>
<option value="appointment">Randevu</option>
<option value="contract_appointment">Sözleşmeli Randevu</option>
<option value="not_approved">Yapmayacak</option>
<option value="approved">Onaylandı</option>
<option value="paid">Para Alındı</option>
        </select>

        <button
          style={primaryButton}
          onClick={() =>
            updateCustomer(selectedCustomer.id, {
              info_note: document.getElementById("detailNote").value,
              appointment_date: document.getElementById("detailAppointment").value || null,
              status: document.getElementById("detailStatus").value,
              approved: ["approved", "paid"].includes(document.getElementById("detailStatus").value),
              payment_received: document.getElementById("detailStatus").value === "paid",
            })
          }
        >
          Kaydet
        </button>

        <h3 style={{ marginTop: 20 }}>İşlem Geçmişi</h3>

        {customerLogs.length === 0 && <p style={{ opacity: 0.7 }}>Henüz işlem yok.</p>}

        {customerLogs.map((log) => (
          <div key={log.id} style={logBox}>
            <strong>
  İşlem yapan: {
    users.find((u) => u.id === log.user_id)?.full_name ||
    users.find((u) => u.id === log.user_id)?.email ||
    "Bilinmeyen kullanıcı"
  }
</strong>
            <p style={{ margin: "6px 0" }}>Durum: {statusLabel(log.old_status)} → {statusLabel(log.new_status)}</p>
            <p style={{ margin: "6px 0" }}>Not: {log.note || "-"}</p>
            <small>{new Date(log.created_at).toLocaleString("tr-TR")}</small>
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
      <option value="">Rep seç</option>
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
        <div style={tableHeader}>
          <div>{canManage ? "Seç" : ""}</div>
          <div>Müşteri</div>
          <div>Telefon</div>
          <div>Telefon 2</div>
          <div>TC No</div>
          <div>Data</div>
          <div>Takip</div>
          <div>Durum</div>
          <div>Atanan</div>
          <div>İşlem</div>
        </div>

        {data.map((c) => (
          <div key={c.id} style={tableRow}>
            <div>
            {canManage && (
              <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelected(c.id)} />
            )}
            </div>

            <div style={{ fontWeight: "bold" }}>{c.first_name} {c.last_name}</div>

            <div>{c.phone ? <a href={`tel:${c.phone}`} style={phoneLink}>{c.phone}</a> : "-"}</div>
            <div>{c.phone_2 ? <a href={`tel:${c.phone_2}`} style={phoneLink}>{c.phone_2}</a> : "-"}</div>
            <div>{c.tc_no || "-"}</div>
            <div>{c.batch_name || "-"}</div>
            <div>{formatDateTime(c.appointment_date)}</div>
            <div><span style={statusBadge(c.status)}>{statusLabel(c.status)}</span></div>

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
          </div>
        ))}
      </div>
    </div>
  );
}

function MenuButton({ icon, title, page, activePage, setActivePage, onClickExtra, collapsed }) {
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
      <span style={menuIcon}>{icon}</span>
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
    appointment: "Randevu",
    contract_appointment: "Sözleşmeli Randevu",
callback: "Tekrar Aranacak",
    meeting_done: "Görüşüldü",
    not_approved: "Yapmayacak",
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
  callback: "#a855f7",
  appointment: "#eab308",
  contract_appointment: "#06b6d4",
  not_approved: "#ef4444",
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

const parliament = "#123b7a";
const parliamentDark = "#061834";
const parliamentMid = "#0b2b5f";
const cardBlue = "#10284f";

const appShell = { minHeight: "100vh", background: `linear-gradient(135deg, ${parliamentDark}, #0f172a)`, color: "white", display: "flex", fontFamily: "Arial" };
const sidebar = { background: `linear-gradient(180deg, ${parliamentDark}, #020617)`, padding: 24, borderRight: "1px solid rgba(147,197,253,0.25)", transition: "width 180ms ease, padding 180ms ease", flexShrink: 0 };
const sidebarTopRow = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, minHeight: 46, marginBottom: 18 };
const logoText = { fontSize: 32, letterSpacing: 2, marginBottom: 8 };
const sideEmail = { fontSize: 12, opacity: 0.65, marginBottom: 25 };
const mainArea = { flex: 1, padding: 28, overflowX: "hidden" };
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
const logoutButton = { padding: "12px 22px", borderRadius: 12, border: "none", cursor: "pointer", fontWeight: "bold" };
const statsGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16, marginBottom: 24 };
const statCard = { background: `linear-gradient(135deg, ${cardBlue}, ${parliament})`, padding: 20, borderRadius: 18, border: "1px solid rgba(147,197,253,0.25)", cursor: "pointer", boxShadow: "0 12px 30px rgba(0,0,0,0.2)" };
const dashboardGrid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 };
const panelCard = { background: "rgba(16,40,79,0.88)", padding: 22, borderRadius: 18, border: "1px solid rgba(147,197,253,0.22)", boxShadow: "0 20px 45px rgba(0,0,0,0.22)" };
const formGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 };
const inputStyle = { width: "100%", padding: 12, marginBottom: 12, boxSizing: "border-box", borderRadius: 10, border: "1px solid #cbd5e1" };
const searchInput = { width: "100%", padding: 13, marginBottom: 15, borderRadius: 12, border: "1px solid rgba(147,197,253,0.25)", background: "#071a36", color: "white", boxSizing: "border-box" };
const primaryButton = { width: "100%", padding: 13, borderRadius: 10, border: "none", cursor: "pointer", fontWeight: "bold", background: "linear-gradient(135deg,#e0f2fe,#ffffff)" };
const tableWrapper = { width: "100%", overflowX: "auto", background: "#071a36", borderRadius: 14 };
const tableHeader = {
  display: "grid",
  gridTemplateColumns: "62px 150px 112px 112px 112px 130px 135px 115px 130px 80px",
  gap: 6,
  padding: 10,
  background: parliamentMid,
  fontWeight: "bold",
  minWidth: 1140,
  fontSize: 12,
};

const tableRow = {
  display: "grid",
  gridTemplateColumns: "62px 150px 112px 112px 112px 130px 135px 115px 130px 80px",
  gap: 6,
  alignItems: "center",
  padding: 10,
  background: "#10284f",
  borderBottom: "1px solid rgba(147,197,253,0.16)",
  minWidth: 1140,
  fontSize: 12,
};
const selectStyle = { width: "100%", padding: 8, borderRadius: 8 };
const smallButton = { padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: "bold" };
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
const staffFormBox = { background: "#071a36", padding: 18, borderRadius: 14, marginBottom: 20, border: "1px solid rgba(147,197,253,0.18)" };
const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 999 };
const modalCard = { width: 760, maxWidth: "92%", maxHeight: "90vh", overflowY: "auto", background: `linear-gradient(135deg, ${cardBlue}, #0f172a)`, padding: 25, borderRadius: 20, border: "1px solid rgba(147,197,253,0.25)" };
const closeButton = { float: "right", padding: 8, cursor: "pointer", borderRadius: 8, border: "none" };
const customerHero = { background: `linear-gradient(135deg, ${parliamentDark}, ${parliament})`, padding: 18, borderRadius: 16, marginBottom: 16, border: "1px solid #60a5fa" };
const customerHeroTitle = { color: "white", textAlign: "center", marginBottom: 15, fontSize: 28 };
const customerInfoGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 };
const infoPill = { background: "rgba(7,26,54,0.85)", padding: 12, borderRadius: 12, color: "#e0f2fe", textAlign: "center", border: "1px solid rgba(147,197,253,0.22)" };
const quickActions = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, margin: "15px 0" };
const quickActionButton = { padding: 11, borderRadius: 10, border: "none", background: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "white", textAlign: "center", textDecoration: "none", cursor: "pointer", fontWeight: "bold" };
const logBox = { background: "#071a36", padding: 12, borderRadius: 12, marginBottom: 10, border: "1px solid rgba(147,197,253,0.18)" };
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
