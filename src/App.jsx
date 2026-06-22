import { useEffect, useRef, useState } from "react";
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

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

    if (attempt < attempts - 1) await wait(400 * (attempt + 1));
  }

  return { data: null, error: lastError || new Error("Bağlantı kurulamadı.") };
}

function parseExcelInWorker(buffer, fileName, existingPhones, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./workers/excelImport.worker.js", import.meta.url), { type: "module" });
    const cleanup = () => worker.terminate();

    worker.onmessage = ({ data }) => {
      if (data.type === "progress") {
        onProgress(data.current, data.total);
        return;
      }
      cleanup();
      if (data.type === "result") resolve(data.result);
      else reject(new Error(data.message || "Excel işlenemedi."));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "Excel işleme servisi başlatılamadı."));
    };
    worker.postMessage({ buffer, fileName, existingPhones }, [buffer]);
  });
}

function App() {
  const [customerLogs, setCustomerLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkEmployee, setBulkEmployee] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [profile, setProfile] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [saleCelebration, setSaleCelebration] = useState(null);
  const [messages, setMessages] = useState([]);
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [messageTarget, setMessageTarget] = useState("general");
  const [messageBody, setMessageBody] = useState("");
  const [messageAttachment, setMessageAttachment] = useState(null);
  const [replyToMessage, setReplyToMessage] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messagingError, setMessagingError] = useState("");
  const [profileForm, setProfileForm] = useState({ full_name: "", job_title: "", phone: "", bio: "", avatar_url: "", availability_status: "online" });
  const [newPassword, setNewPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [loading, setLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
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

  useEffect(() => {
    let mounted = true;

    async function restoreSession() {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const sessionUser = sessionData.session?.user;
        if (!sessionUser) return;

        const { data: userProfile, error: profileError } = await runWithRetry(() =>
          supabase.from("profiles").select("*").eq("id", sessionUser.id).maybeSingle()
        );

        if (profileError || !userProfile || userProfile.is_active === false) {
          await supabase.auth.signOut();
          return;
        }

        const restoredCustomers = [];
        const pageSize = 1000;
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await runWithRetry(() =>
            supabase
              .from("customers")
              .select("*")
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .range(from, from + pageSize - 1)
          );
          if (error) throw error;
          restoredCustomers.push(...(data || []));
          if (!data || data.length < pageSize) break;
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
          job_title: userProfile.job_title || "",
          phone: userProfile.phone || "",
          bio: userProfile.bio || "",
          avatar_url: userProfile.avatar_url || "",
          availability_status: userProfile.availability_status || "online",
        });
        setCustomers(restoredCustomers);
        setUsers(restoredUsers || []);
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
  }, []);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape") return;
      if (selectedCustomer) {
        setSelectedCustomer(null);
        return;
      }
      if (activePage !== "dashboard") setActivePage("dashboard");
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [activePage, selectedCustomer]);

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
    const channel = supabase
      .channel(`crm-messages-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_messages" }, refreshMessages)
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [profile]);

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

  async function login(e) {
    e.preventDefault();
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
        alert(userProfile?.is_active === false ? "Bu kullanıcı hesabı pasif durumda." : "Profil bulunamadı.");
        return;
      }

      setProfile(userProfile);
      setProfileForm({
        full_name: userProfile.full_name || "",
        job_title: userProfile.job_title || "",
        phone: userProfile.phone || "",
        bio: userProfile.bio || "",
        avatar_url: userProfile.avatar_url || "",
        availability_status: userProfile.availability_status || "online",
      });
      await Promise.all([loadCustomers(), loadUsers()]);
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
    setProfile(null);
    setCustomers([]);
    setUsers([]);
    setCustomerLogs([]);
    setSelectedIds([]);
    setMessages([]);
  }

  async function loadCustomers() {
    const pageSize = 1000;
    const allCustomers = [];
    setDataLoading(true);

    try {
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await runWithRetry(() =>
          supabase
            .from("customers")
            .select("*")
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, from + pageSize - 1)
        );

        if (error) {
          alert("Müşteriler yüklenemedi: " + error.message);
          return;
        }

        allCustomers.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }

      setCustomers(allCustomers);
    } finally {
      setDataLoading(false);
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

  async function saveOwnProfile(event) {
    event.preventDefault();
    if (!profile) return;
    const payload = {
      full_name: profileForm.full_name.trim(),
      job_title: profileForm.job_title.trim(),
      phone: profileForm.phone.trim(),
      bio: profileForm.bio.trim(),
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
    alert("Profil bilgilerin güncellendi.");
  }

  async function uploadAvatar(event) {
    const file = event.target.files?.[0];
    if (!file || !profile) return;
    if (!file.type.startsWith("image/")) {
      alert("Lütfen bir görsel dosyası seç.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("Profil fotoğrafı en fazla 5 MB olabilir.");
      return;
    }

    setUploadingAvatar(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${profile.id}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { cacheControl: "3600" });

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
    alert("Şifren başarıyla değiştirildi.");
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

  async function loadCustomerLogs(customerId) {
  const { data, error } = await runWithRetry(() =>
    supabase
      .from("customer_logs")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
  );

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
      const existingPhones = customers
        .flatMap((customer) => [customer.phone, customer.phone_2])
        .map(normalizePhone)
        .filter(Boolean);
      const parsed = await parseExcelInWorker(buffer, file.name, existingPhones, (current, total) => {
        setImportProgress({ phase: "Satırlar arka planda kontrol ediliyor", current, total });
      });
      const { sheetName, rejectedRows, duplicateRows } = parsed;
      const preparedRows = parsed.rows.map((row) => ({
        ...row,
        created_by: profile.id,
        last_action_by: profile.id,
      }));

      if (preparedRows.length === 0) {
        throw new Error(`Geçerli kayıt bulunamadı. ${rejectedRows} eksik/hatalı, ${duplicateRows} mükerrer satır tespit edildi.`);
      }

      const confirmed = window.confirm(
        `'${sheetName}' sayfası kontrol edildi.\n\n` +
        `${preparedRows.length} geçerli kayıt yüklenecek.\n` +
        `${rejectedRows} eksik ad/telefon satırı yüklenmeyecek.\n` +
        `${duplicateRows} mükerrer satır yüklenmeyecek.\n\nDevam edilsin mi?`
      );
      if (!confirmed) return;

      let imported = 0;
      const batchSize = 200;

      for (let i = 0; i < preparedRows.length; i += batchSize) {
        const chunk = preparedRows.slice(i, i + batchSize);
        setImportProgress({ phase: "Supabase'e kaydediliyor", current: i, total: preparedRows.length });
        const { error } = await runWithRetry(() =>
          supabase
            .from("customers")
            .upsert(chunk, { onConflict: "phone", ignoreDuplicates: true })
        );

        if (error) {
          alert(`Yükleme ${imported} müşteri sonrasında durdu: ${error.message}`);
          return;
        }

        imported += chunk.length;
        setImportProgress({ phase: "Supabase'e kaydediliyor", current: imported, total: preparedRows.length });
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      alert(`${imported} müşteri güvenle yüklendi. ${rejectedRows} eksik/hatalı ve ${duplicateRows} mükerrer satır atlandı.`);
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

    let error;
    try {
      ({ error } = await supabase.from("customers").insert({
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
      }));
    } catch (requestError) {
      error = requestError;
    }

    if (error) {
      alert("Müşteri eklenemedi: " + (error.message || "Bağlantı kurulamadı."));
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

    if (!staffForm.id.trim() || !staffForm.email.trim() || !staffForm.full_name.trim()) {
      alert("Auth UID, ad soyad ve e-posta zorunlu.");
      return;
    }

    let error;
    try {
      ({ error } = await supabase.from("profiles").insert({
        id: staffForm.id.trim(),
        email: staffForm.email.trim(),
        full_name: staffForm.full_name.trim(),
        role: staffForm.role,
        is_active: true,
        created_by: profile.id,
      }));
    } catch (requestError) {
      error = requestError;
    }

    if (error) {
      const isRlsError = error.code === "42501" || error.message?.includes("row-level security");
      alert(isRlsError
        ? "Kullanıcı ekleme yetkisi henüz kurulmamış. Supabase SQL Editor'da BOSS_PROFILE_MANAGEMENT.sql dosyasını bir kez çalıştır."
        : "Kullanıcı eklenemedi: " + (error.message || "Bağlantı kurulamadı."));
      return;
    }

    alert("Kullanıcı profili eklendi.");
    setStaffForm({ id: "", email: "", full_name: "", role: "employee" });
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
        : "Rep pasife alınamadı; hiçbir müşteri kaydı değiştirilmedi: " + error.message);
      return;
    }

    alert(`Rep pasife alındı, ${Number(releasedCount) || 0} müşteri havuza döndü.`);
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
    setSelectedIds([]);
    await loadCustomers();
    alert("Tüm müşteri verisi temizlendi.");
  }

  async function assignCustomer(customerId, employeeId) {
  if (!profile) return;

  const moveToPool = !employeeId;

  const { error } = await runWithRetry(() =>
    supabase
      .from("customers")
      .update({
        assigned_employee: moveToPool ? null : employeeId,
        status: moveToPool ? "pool" : "assigned",
        assigned_at: moveToPool ? null : new Date().toISOString(),
        last_action_by: profile.id,
      })
      .eq("id", customerId)
  );

  if (error) {
    alert("Atama hatası: " + error.message);
    return;
  }

  alert(moveToPool ? "Müşteri havuza alındı." : "Müşteri rep'e atandı.");
  await loadCustomers();
}

  async function bulkAssignCustomers(customerIdsOverride, employeeOverride, sourceEmployeeOverride) {
    const customerIdsToUpdate = sourceEmployeeOverride
      ? customers.filter((customer) => customer.assigned_employee === sourceEmployeeOverride).map((customer) => customer.id)
      : Array.isArray(customerIdsOverride) ? customerIdsOverride : selectedIds;
    const targetEmployee = typeof employeeOverride === "string" ? employeeOverride : bulkEmployee;
    const moveToPool = targetEmployee === "__pool__";

    if (!targetEmployee || customerIdsToUpdate.length === 0 || !profile) {
      alert("Müşteri ve rep seç.");
      return;
    }

    if (moveToPool && !window.confirm(`${customerIdsToUpdate.length} müşteri havuza geri alınsın mı?`)) return;

    const batchSize = 100;
    let processed = 0;

    try {
      for (let index = 0; index < customerIdsToUpdate.length; index += batchSize) {
        const customerIds = customerIdsToUpdate.slice(index, index + batchSize);
        const { error } = await runWithRetry(() =>
          supabase
            .from("customers")
            .update({
              assigned_employee: moveToPool ? null : targetEmployee,
              status: moveToPool ? "pool" : "assigned",
              assigned_at: moveToPool ? null : new Date().toISOString(),
              last_action_by: profile.id,
            })
            .in("id", customerIds)
        );

        if (error) throw error;
        processed += customerIds.length;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      alert(`Toplu işlem ${processed} müşteri sonrasında durdu: ${error.message || "Bağlantı hatası"}`);
      await loadCustomers();
      return;
    }

    alert(moveToPool ? `${processed} müşteri havuza alındı.` : `${processed} müşteri atandı.`);
    setSelectedIds([]);
    setBulkEmployee("");
    await loadCustomers();
  }

  async function updateCustomer(customerId, updates) {
    if (!profile) return;
    const becamePaid = updates.status === "paid" && selectedCustomer?.status !== "paid";

    const { error } = await runWithRetry(() =>
      supabase
        .from("customers")
        .update({ ...updates, last_action_by: profile.id })
        .eq("id", customerId)
    );

    if (error) {
      alert("Müşteri güncellenemedi: " + error.message);
      return;
    }

    let logError;
    try {
      ({ error: logError } = await supabase
        .from("customer_logs")
        .insert({
          customer_id: customerId,
          user_id: profile.id,
          old_status: selectedCustomer?.status || null,
          new_status: updates.status || null,
          note: updates.info_note || "",
        }));
    } catch (requestError) {
      logError = requestError;
    }

    if (logError) {
      await loadCustomers();
      setSelectedCustomer((prev) => prev ? { ...prev, ...updates } : prev);
      alert("Müşteri kaydedildi fakat işlem geçmişi kaydedilemedi: " + (logError.message || "Bağlantı kurulamadı."));
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
const unreadMessageCount = messages.filter((message) => message.recipient_id === profile.id && !message.read_at).length;

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

        <MenuButton icon="●" title="Hesabım" page="account" tone="account" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
        <MenuButton icon="✉" title={`Mesajlar${unreadMessageCount ? ` (${unreadMessageCount})` : ""}`} page="messages" tone="messages" activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />
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
          <button onClick={logout} style={logoutButton}>Çıkış</button>
        </header>

        {dataLoading && <div style={syncNotice}>Veriler güncelleniyor, lütfen bekleyin.</div>}

        {activePage === "dashboard" && (
          <>
            <div style={statsGrid}>
              <ClickStat tone="total" title={profile.role === "employee" ? "Benim Müşterilerim" : "Toplam Müşteri"} value={visibleCustomers.length} onClick={() => { setCustomerFilter("all"); setActivePage("customers"); }} />
              {profile.role !== "employee" && <ClickStat tone="new" title="Yeni Müşteriler" value={visibleCustomers.filter((c) => c.status === "pool").length} onClick={() => { setCustomerFilter("pool"); setActivePage("pool"); }} />}
              <ClickStat tone="assigned" title="Atanmış" value={visibleCustomers.filter((c) => c.assigned_employee).length} onClick={() => { setCustomerFilter("assigned"); setActivePage("customers"); }} />
              <ClickStat tone="approved" title="Onaylandı" value={visibleCustomers.filter((c) => c.approved).length} onClick={() => { setCustomerFilter("approved"); setActivePage("customers"); }} />
              <ClickStat tone="paid" title="Para Alındı" value={visibleCustomers.filter((c) => c.payment_received).length} onClick={() => { setCustomerFilter("paid"); setActivePage("customers"); }} />
            </div>

            <div style={dashboardGrid}>
              <div style={{ ...panelCard, ...pipelinePanel }}>
                <h2>Operasyon Pipeline</h2>
                <div style={pipelineList}>
                  {profile.role !== "employee" && <PipelineRow label="Yeni Müşteriler" value={customers.filter(c => c.status === "pool").length} color="#38bdf8" />}
                  {profile.role !== "employee" && <PipelineRow label="Atandı" value={customers.filter(c => c.status === "assigned").length} color="#818cf8" />}
                  <PipelineRow label="Arandı" value={visibleCustomers.filter(c => c.status === "called").length} color="#fb923c" />
                  <PipelineRow label="Randevu" value={visibleCustomers.filter(c => c.status === "appointment").length} color="#fbbf24" />
                  <PipelineRow label="Yapmayacak" value={visibleCustomers.filter(c => c.status === "not_approved").length} color="#f87171" />
                  <PipelineRow label="Onaylandı" value={visibleCustomers.filter(c => c.status === "approved").length} color="#4ade80" />
                  <PipelineRow label="Para Alındı" value={visibleCustomers.filter(c => c.status === "paid").length} color="#34d399" />
                </div>
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
                      <span style={rankMedal(index)}>{index + 1}</span>
                      <strong style={{ flex: 1 }}>{u.full_name || u.email}</strong>
                      <span style={salesFigure}>₺ {u.stats.paid}</span>
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
                  <div style={employeeIdentity}>
                    <ProfileAvatar user={u} size={46} />
                    <div>
                      <strong>{u.full_name || "İsimsiz kullanıcı"}</strong>
                      <p style={{ margin: 0, opacity: 0.7 }}>{u.email}</p>
                      <p style={{ margin: "6px 0 0", opacity: 0.75, fontSize: 13 }}>
                        Müşteri: {stats.total} | Aranan: {stats.called} | Randevu: {stats.appointment} | Satış: {stats.paid}
                      </p>
                      <PresenceBadge user={u} onlineUserIds={onlineUserIds} />
                    </div>
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

        <div className="report-chart-grid" style={chartList}>
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

      {profile.role !== "employee" && (
        <section style={panelCard}>
          <h2 style={sectionTitle}>En İyi Rep Tablosu</h2>
          {repStats.length === 0 && <p style={mutedText}>Henüz rep bulunmuyor.</p>}
          {repStats.map((rep, index) => (
            <div key={rep.id} style={leaderRow}>
              <strong>#{index + 1} {rep.full_name || rep.email}</strong>
              <span style={leaderFigure}><b>◉</b> {rep.stats.total}</span>
              <span style={leaderFigure}><b>◷</b> {rep.stats.appointment}</span>
              <span style={{ ...leaderFigure, color: "#6ee7b7" }}><b>₺</b> {rep.stats.paid}</span>
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
              <span style={{ ...dataMetric, color: "#93c5fd" }}>◉ {data.total}</span>
              <span style={{ ...dataMetric, color: "#fde68a" }}>◷ {data.appointment}</span>
              <span style={{ ...dataMetric, color: "#6ee7b7" }}>₺ {data.paid}</span>
              <span style={{ ...dataMetric, color: "#fca5a5" }}>! {data.wrongNumber}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function AccountView({ profile, profileForm, setProfileForm, saveOwnProfile, uploadAvatar, uploadingAvatar, savingProfile, newPassword, setNewPassword, changePassword, onlineUserIds }) {
  return (
    <div style={accountLayout}>
      <section style={accountHero}>
        <ProfileAvatar user={{ ...profile, ...profileForm }} size={96} />
        <div style={{ minWidth: 0 }}>
          <span style={welcomeEyebrow}>Hesabım</span>
          <h2 style={{ ...sectionTitle, fontSize: 26 }}>{profileForm.full_name || profile.email}</h2>
          <p style={mutedText}>{profileForm.job_title || roleName(profile.role)}</p>
          <PresenceBadge user={{ ...profile, ...profileForm }} onlineUserIds={onlineUserIds} />
        </div>
        <label style={avatarUploadButton}>
          {uploadingAvatar ? "Yükleniyor..." : "Fotoğraf Seç"}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadAvatar} disabled={uploadingAvatar} hidden />
        </label>
      </section>

      <div className="account-grid" style={accountGrid}>
        <form onSubmit={saveOwnProfile} style={panelCard}>
          <h2 style={sectionTitle}>Profil Bilgileri</h2>
          <label style={fieldLabel}>Ad Soyad</label>
          <input value={profileForm.full_name} onChange={(event) => setProfileForm({ ...profileForm, full_name: event.target.value })} style={inputStyle} />
          <label style={fieldLabel}>Unvan</label>
          <input placeholder="Örn. Satış Temsilcisi" value={profileForm.job_title} onChange={(event) => setProfileForm({ ...profileForm, job_title: event.target.value })} style={inputStyle} />
          <label style={fieldLabel}>Telefon</label>
          <input placeholder="Telefon numarası" value={profileForm.phone} onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })} style={inputStyle} />
          <label style={fieldLabel}>Çalışma Durumu</label>
          <div style={availabilityControl}>
            <button type="button" onClick={() => setProfileForm({ ...profileForm, availability_status: "online" })} style={profileForm.availability_status === "online" ? availabilityOnlineActive : availabilityButton}>Çevrimiçi</button>
            <button type="button" onClick={() => setProfileForm({ ...profileForm, availability_status: "busy" })} style={profileForm.availability_status === "busy" ? availabilityBusyActive : availabilityButton}>Meşgul</button>
          </div>
          <label style={fieldLabel}>Hakkımda</label>
          <textarea rows={4} maxLength={300} value={profileForm.bio} onChange={(event) => setProfileForm({ ...profileForm, bio: event.target.value })} style={{ ...inputStyle, resize: "vertical" }} />
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

function MessagingView({ profile, users, messages, messageTarget, selectConversation, messageBody, setMessageBody, sendMessage, messagingError, onlineUserIds, messageAttachment, setMessageAttachment, replyToMessage, setReplyToMessage, editingMessage, setEditingMessage, beginEditMessage, deleteMessage, sendingMessage }) {
  const [contactSearch, setContactSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
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

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messageTarget, visibleMessages.length]);

  function cancelComposerMode() {
    setReplyToMessage(null);
    setEditingMessage(null);
    setMessageBody("");
  }

  return (
    <div className="messaging-layout" style={messagingLayout}>
      <aside className="conversation-sidebar" style={conversationSidebar}>
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
                        <small style={messageTime}>{message.edited_at ? "düzenlendi · " : ""}{formatTime(message.created_at)}{mine && message.recipient_id ? (message.read_at ? " · Okundu" : " · İletildi") : ""}</small>
                        <span style={messageActions}>
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

function ProfileAvatar({ user, size = 44 }) {
  const name = user?.full_name || user?.email || "?";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const style = { ...avatarBase, width: size, height: size, minWidth: size, fontSize: Math.max(Math.round(size * 0.32), 12) };
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
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const filteredData = assigneeFilter === "all"
    ? data
    : assigneeFilter === "pool"
      ? data.filter((customer) => !customer.assigned_employee)
      : data.filter((customer) => customer.assigned_employee === assigneeFilter);
  const pageCount = Math.max(Math.ceil(filteredData.length / pageSize), 1);
  const currentPage = Math.min(page, pageCount);
  const pageData = filteredData.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function toggleSelected(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function renderPagination(position = "bottom") {
    if (pageCount <= 1) return null;
    return (
      <div style={{ ...paginationBar, ...(position === "top" ? topPaginationBar : {}) }}>
        <button type="button" style={paginationButton} disabled={currentPage === 1} onClick={() => setPage(1)}>İlk</button>
        <button type="button" style={paginationButton} disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(value - 1, 1))}>Önceki</button>
        <strong>{currentPage} / {pageCount}</strong>
        <button type="button" style={paginationButton} disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(value + 1, pageCount))}>Sonraki 100</button>
        <button type="button" style={paginationButton} disabled={currentPage === pageCount} onClick={() => setPage(pageCount)}>Son</button>
      </div>
    );
  }

  return (
    <div style={panelCard}>
      <h2>{title}</h2>

      <div style={customerToolbar}>
        <input
          placeholder="Müşteri ara: isim, telefon, TC, data adı..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
          style={{ ...searchInput, marginBottom: 0 }}
        />
        {canManage && (
          <select value={assigneeFilter} onChange={(event) => { setAssigneeFilter(event.target.value); setPage(1); }} style={toolbarSelect}>
            <option value="all">Tüm sorumlular</option>
            <option value="pool">Atanmamış müşteriler</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.full_name || employee.email}</option>
            ))}
          </select>
        )}
      </div>

      <div style={tableSummary}>
        <span>{filteredData.length.toLocaleString("tr-TR")} müşteri</span>
        <span>{currentPage}. sayfa / {pageCount}</span>
      </div>

      {renderPagination("top")}

      {canManage && !["all", "pool"].includes(assigneeFilter) && filteredData.length > 0 && (
        <div style={releaseRepBar}>
          <span>Seçili Rep’in üzerindeki bütün müşterileri havuza geri alabilirsin.</span>
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
        const ids = pageData.map((c) => c.id);
        const allSelected = ids.every((id) => selectedIds.includes(id));
        setSelectedIds(allSelected ? [] : ids);
      }}
    >
      Sayfadakileri Seç
    </button>

    <select
      value={bulkEmployee}
      onChange={(e) => setBulkEmployee(e.target.value)}
      style={selectStyle}
    >
      <option value="">Rep / manager seç</option>
      <option value="__pool__">↩ Seçilenleri Havuza Al</option>
      {employees.map((emp) => (
        <option key={emp.id} value={emp.id}>
          {emp.full_name || emp.email}
        </option>
      ))}
    </select>

    <button onClick={() => bulkAssignCustomers()} style={smallButton}>
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

        {pageData.map((c) => (
          <div key={c.id} style={{ ...tableRow, ...(canViewTc ? {} : tableWithoutTc), borderLeft: `4px solid ${customerHeat(c.status).color}` }}>
            <div>
            {canManage && (
              <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelected(c.id)} />
            )}
            </div>

            <div style={customerNameCell}>
              <strong>{c.first_name} {c.last_name}</strong>
              <div title={statusLabel(c.status)} aria-label={statusLabel(c.status)} style={{ ...customerStatusLine, background: customerHeat(c.status).color }} />
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
      {renderPagination()}
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

function ClickStat({ title, value, onClick, tone = "total" }) {
  return (
    <button type="button" style={{ ...statCard, ...statCardTones[tone] }} onClick={onClick}>
      <p style={{ opacity: 0.75 }}>{title}</p>
      <h2>{value}</h2>
    </button>
  );
}

function PipelineRow({ label, value, color }) {
  return (
    <div style={pipelineRow}>
      <span style={{ ...pipelineDot, background: color }} />
      <span style={pipelineLabel}>{label}</span>
      <strong style={{ ...pipelineValue, color }}>{value.toLocaleString("tr-TR")}</strong>
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

const appShell = { width: "100%", minWidth: 0, minHeight: "100vh", background: `linear-gradient(135deg, ${parliamentDark}, #0f172a)`, color: "white", display: "flex", fontFamily: "var(--sans)" };
const sidebar = { background: `linear-gradient(180deg, ${parliamentDark}, #020617)`, padding: 24, borderRight: "1px solid rgba(147,197,253,0.25)", transition: "width 180ms ease, padding 180ms ease", flexShrink: 0 };
const sidebarTopRow = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, minHeight: 46, marginBottom: 18 };
const brandBlock = { width: 150, minWidth: 0, padding: "7px 8px", boxSizing: "border-box", borderRadius: 8, background: "linear-gradient(135deg,#f0f9ff,#bae6fd)", border: "1px solid rgba(125,211,252,0.72)", boxShadow: "0 8px 20px rgba(2,6,23,0.2)" };
const brandLogo = { display: "block", width: "100%", height: "auto" };
const brandMarkFrame = { width: 46, height: 48, display: "grid", placeItems: "center", margin: "-4px auto 14px" };
const brandMark = { display: "block", width: 42, height: "auto" };
const sideEmail = { fontSize: 12, color: "#bfdbfe", margin: "6px 0 16px" };
const mainArea = { flex: 1, minWidth: 0, padding: "24px 32px", overflowX: "hidden" };
const topbar = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, marginBottom: 24 };
const topbarIdentity = { display: "flex", alignItems: "center", gap: 12, minWidth: 0 };
const backButton = { width: 40, height: 40, display: "grid", placeItems: "center", flexShrink: 0, borderRadius: 8, border: "1px solid rgba(125,211,252,0.38)", background: "#10284f", color: "#e0f2fe", fontSize: 28, lineHeight: 1, cursor: "pointer" };
const welcomeBlock = { minWidth: 0 };
const welcomeEyebrow = { display: "block", fontSize: 13, opacity: 0.65, marginBottom: 4 };
const welcomeTitle = { margin: 0, fontSize: 28, lineHeight: 1.15, maxWidth: 760, overflowWrap: "anywhere" };
const welcomeMeta = { margin: "6px 0 0", opacity: 0.7 };
const welcomeStatusRow = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 6 };
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
  account: { background: "rgba(129,140,248,0.18)", color: "#c7d2fe" },
  messages: { background: "rgba(34,211,238,0.18)", color: "#67e8f9" },
};
const logoutButton = { padding: "12px 22px", borderRadius: 10, border: "1px solid rgba(147,197,253,0.35)", cursor: "pointer", fontWeight: 700, background: "#16345f", color: "#e0f2fe" };
const syncNotice = { margin: "-8px 0 16px", padding: "10px 12px", borderRadius: 8, background: "rgba(56,189,248,0.12)", border: "1px solid rgba(125,211,252,0.32)", color: "#bae6fd", fontSize: 13, fontWeight: 600 };
const statsGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16, marginBottom: 24 };
const statCard = { width: "100%", minHeight: 116, display: "grid", alignContent: "center", gap: 7, padding: 20, borderRadius: 8, border: "1px solid rgba(147,197,253,0.25)", color: "#f8fafc", cursor: "pointer", textAlign: "left", font: "inherit", boxShadow: "0 12px 30px rgba(0,0,0,0.2)" };
const statCardTones = {
  total: { background: "linear-gradient(135deg,#164e8a,#123b7a)", borderColor: "rgba(125,211,252,0.48)" },
  new: { background: "linear-gradient(135deg,#0e7490,#155e75)", borderColor: "rgba(103,232,249,0.42)" },
  assigned: { background: "linear-gradient(135deg,#4338ca,#3730a3)", borderColor: "rgba(165,180,252,0.42)" },
  approved: { background: "linear-gradient(135deg,#15803d,#166534)", borderColor: "rgba(134,239,172,0.42)" },
  paid: { background: "linear-gradient(135deg,#047857,#065f46)", borderColor: "rgba(110,231,183,0.46)" },
};
const dashboardGrid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 };
const panelCard = { background: "rgba(16,40,79,0.88)", padding: 22, borderRadius: 18, border: "1px solid rgba(147,197,253,0.22)", boxShadow: "0 20px 45px rgba(0,0,0,0.22)" };
const pipelinePanel = { background: "linear-gradient(145deg,rgba(16,40,79,0.96),rgba(7,26,54,0.94))" };
const pipelineList = { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginTop: 18 };
const pipelineRow = { minHeight: 44, display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", borderRadius: 8, background: "rgba(2,16,39,0.58)", border: "1px solid rgba(147,197,253,0.12)" };
const pipelineDot = { width: 8, height: 24, flexShrink: 0, borderRadius: 4 };
const pipelineLabel = { flex: 1, color: "#cbd5e1", fontSize: 13 };
const pipelineValue = { fontSize: 18 };
const formGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 };
const inputStyle = { width: "100%", padding: 12, marginBottom: 12, boxSizing: "border-box", borderRadius: 10, border: "1px solid #bfdbfe", background: "#f8fafc", color: "#0b2b5f" };
const searchInput = { width: "100%", padding: 13, marginBottom: 15, borderRadius: 12, border: "1px solid rgba(147,197,253,0.25)", background: "#071a36", color: "white", boxSizing: "border-box" };
const customerToolbar = { display: "grid", gridTemplateColumns: "minmax(240px,1fr) minmax(210px,280px)", gap: 10, marginBottom: 10 };
const toolbarSelect = { width: "100%", padding: 12, borderRadius: 8, border: "1px solid rgba(147,197,253,0.28)", background: "#071a36", color: "#e0f2fe" };
const tableSummary = { display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10, color: "#94a3b8", fontSize: 12 };
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
const paginationBar = { display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 16 };
const topPaginationBar = { marginTop: 0, marginBottom: 14, padding: "10px 12px", borderRadius: 9, background: "rgba(7,26,54,0.55)", border: "1px solid rgba(147,197,253,0.16)" };
const releaseRepBar = { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12, padding: "10px 12px", borderRadius: 9, background: "rgba(180,83,9,0.18)", border: "1px solid rgba(251,191,36,0.35)", color: "#fde68a", fontSize: 13 };
const releaseToPoolButton = { padding: "8px 11px", borderRadius: 7, border: "1px solid rgba(125,211,252,0.5)", background: "rgba(14,116,144,0.35)", color: "#cffafe", cursor: "pointer", fontWeight: 800 };
const paginationButton = { minWidth: 66, padding: "8px 10px", borderRadius: 7, border: "1px solid rgba(125,211,252,0.35)", background: "#10284f", color: "#e0f2fe", cursor: "pointer", fontWeight: 700 };
const employeeRow = { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#071a36", padding: 14, borderRadius: 12, marginBottom: 10, border: "1px solid rgba(147,197,253,0.18)" };
const employeeIdentity = { display: "flex", alignItems: "center", gap: 12, minWidth: 0 };
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
const chartList = { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 };
const chartRow = { display: "grid", gap: 12, padding: 14, borderRadius: 8, border: "1px solid" };
const chartLabel = { display: "flex", justifyContent: "space-between", gap: 12 };
const chartTrack = { height: 12, borderRadius: 999, background: "#071a36", overflow: "hidden", border: "1px solid rgba(147,197,253,0.18)" };
const chartBar = { height: "100%", borderRadius: 999, background: "linear-gradient(90deg,#38bdf8,#22c55e)" };
const reportChartHeader = { display: "flex", alignItems: "center", gap: 10, minWidth: 0 };
const reportIcon = { width: 34, height: 34, display: "grid", placeItems: "center", flexShrink: 0, borderRadius: 7, fontWeight: 900 };
const reportChartTitle = { flex: 1, minWidth: 0, color: "#e2e8f0" };
const reportFigure = { minWidth: 52, textAlign: "right", fontSize: 22, fontWeight: 900 };
const reportVisuals = {
  pool: { icon: "+", color: "#7dd3fc", background: "linear-gradient(135deg,rgba(14,116,144,0.3),rgba(7,26,54,0.62))", border: "rgba(125,211,252,0.3)", iconBackground: "rgba(56,189,248,0.16)", bar: "linear-gradient(90deg,#0ea5e9,#67e8f9)" },
  called: { icon: "✓", color: "#fdba74", background: "linear-gradient(135deg,rgba(154,52,18,0.3),rgba(7,26,54,0.62))", border: "rgba(251,146,60,0.3)", iconBackground: "rgba(251,146,60,0.16)", bar: "linear-gradient(90deg,#f97316,#fdba74)" },
  callback: { icon: "↶", color: "#d8b4fe", background: "linear-gradient(135deg,rgba(107,33,168,0.3),rgba(7,26,54,0.62))", border: "rgba(192,132,252,0.3)", iconBackground: "rgba(192,132,252,0.16)", bar: "linear-gradient(90deg,#9333ea,#d8b4fe)" },
  appointment: { icon: "◷", color: "#fde68a", background: "linear-gradient(135deg,rgba(161,98,7,0.3),rgba(7,26,54,0.62))", border: "rgba(251,191,36,0.3)", iconBackground: "rgba(251,191,36,0.16)", bar: "linear-gradient(90deg,#eab308,#fde68a)" },
  contract_appointment: { icon: "□", color: "#67e8f9", background: "linear-gradient(135deg,rgba(14,116,144,0.3),rgba(7,26,54,0.62))", border: "rgba(34,211,238,0.3)", iconBackground: "rgba(34,211,238,0.16)", bar: "linear-gradient(90deg,#0891b2,#67e8f9)" },
  not_approved: { icon: "×", color: "#fca5a5", background: "linear-gradient(135deg,rgba(153,27,27,0.3),rgba(7,26,54,0.62))", border: "rgba(248,113,113,0.3)", iconBackground: "rgba(248,113,113,0.16)", bar: "linear-gradient(90deg,#dc2626,#fca5a5)" },
  wrong_number: { icon: "!", color: "#cbd5e1", background: "linear-gradient(135deg,rgba(71,85,105,0.32),rgba(7,26,54,0.62))", border: "rgba(148,163,184,0.3)", iconBackground: "rgba(148,163,184,0.16)", bar: "linear-gradient(90deg,#64748b,#cbd5e1)" },
  paid: { icon: "₺", color: "#6ee7b7", background: "linear-gradient(135deg,rgba(4,120,87,0.32),rgba(7,26,54,0.62))", border: "rgba(52,211,153,0.3)", iconBackground: "rgba(52,211,153,0.16)", bar: "linear-gradient(90deg,#059669,#6ee7b7)" },
};
const leaderRow = { display: "grid", gridTemplateColumns: "1fr 110px 110px 90px", gap: 10, alignItems: "center", background: "#071a36", padding: 12, borderRadius: 8, marginTop: 10, border: "1px solid rgba(147,197,253,0.18)" };
const leaderFigure = { display: "flex", alignItems: "center", gap: 7, color: "#bfdbfe", fontSize: 13 };
const dataSourceRow = { display: "grid", gridTemplateColumns: "minmax(170px, 1fr) repeat(4, auto)", gap: 16, alignItems: "center", background: "#071a36", padding: 12, borderRadius: 10, marginTop: 10, border: "1px solid rgba(147,197,253,0.15)", fontSize: 13 };
const dataMetric = { minWidth: 64, padding: "5px 8px", borderRadius: 6, background: "rgba(15,35,68,0.9)", fontWeight: 800, textAlign: "center" };
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
const customerStatusLine = { width: "100%", height: 4, borderRadius: 4, opacity: 0.95 };
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

const loginPage = { minHeight: "100vh", background: `radial-gradient(circle at top left, ${parliament} 0, ${parliamentDark} 38%, #020617 100%)`, display: "grid", gridTemplateColumns: "1.2fr 420px", alignItems: "center", gap: 50, padding: "60px 9%", color: "white", fontFamily: "var(--sans)" };
const loginLeft = { maxWidth: 620 };
const brandBadge = { display: "inline-block", background: "rgba(37,99,235,0.25)", border: "1px solid rgba(147,197,253,0.35)", padding: "8px 14px", borderRadius: 999, fontSize: 13, letterSpacing: 1, marginBottom: 22 };
const loginHeroTitle = { fontSize: 56, lineHeight: 1.05, margin: "0 0 20px 0" };
const loginHeroText = { fontSize: 18, lineHeight: 1.6, opacity: 0.9, maxWidth: 520 };
const loginFeatureGrid = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginTop: 35, maxWidth: 500 };
const loginFeature = { background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", padding: 16, borderRadius: 16 };
const loginCard = { background: "rgba(15,23,42,0.82)", border: "1px solid rgba(148,163,184,0.25)", boxShadow: "0 30px 80px rgba(0,0,0,0.45)",  backdropFilter: "blur(16px)", padding: 34, borderRadius: 24 ,color: "white", };
const loginCardStack = { display: "grid", gap: 14 };
const poweredByVercel = { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, color: "#94a3b8", fontSize: 12, fontWeight: 600 };
const vercelMark = { color: "#e2e8f0", fontSize: 11, lineHeight: 1 };
const loginInput = { width: "100%", padding: "14px 15px", marginBottom: 16, boxSizing: "border-box", borderRadius: 12, border: "1px solid #334155", background: "#020617", color: "white" };
const loginButton = { width: "100%", padding: 14, borderRadius: 12, border: "none", background: "linear-gradient(135deg,#2563eb,#123b7a)", color: "white", fontWeight: "bold", cursor: "pointer" };
const topRepRow = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#071a36", padding: 12, borderRadius: 8, marginBottom: 10, border: "1px solid rgba(147,197,253,0.18)" };
const salesFigure = { minWidth: 54, padding: "5px 8px", borderRadius: 6, background: "rgba(5,150,105,0.16)", color: "#6ee7b7", fontWeight: 800, textAlign: "center" };
const avatarBase = { display: "grid", placeItems: "center", overflow: "hidden", boxSizing: "border-box", borderRadius: "50%", background: "linear-gradient(135deg,#2563eb,#0891b2)", color: "#f8fafc", border: "2px solid rgba(125,211,252,0.48)", fontWeight: 800 };
const accountLayout = { display: "grid", gap: 18 };
const accountHero = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, padding: 22, borderRadius: 8, background: "linear-gradient(135deg,rgba(30,64,175,0.72),rgba(8,145,178,0.42))", border: "1px solid rgba(125,211,252,0.36)" };
const avatarUploadButton = { marginLeft: "auto", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(186,230,253,0.48)", background: "rgba(7,26,54,0.68)", color: "#e0f2fe", cursor: "pointer", fontWeight: 700 };
const accountGrid = { display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(280px,0.8fr)", gap: 18, alignItems: "start" };
const accountEmailBox = { display: "grid", gap: 5, margin: "18px 0", padding: 14, borderRadius: 8, background: "rgba(7,26,54,0.68)", border: "1px solid rgba(147,197,253,0.18)", overflowWrap: "anywhere" };
const securityButton = { ...primaryButton, background: "linear-gradient(135deg,#4338ca,#2563eb)" };
const availabilityControl = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 };
const availabilityButton = { padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(147,197,253,0.2)", background: "#071a36", color: "#cbd5e1", cursor: "pointer", fontWeight: 700 };
const availabilityOnlineActive = { ...availabilityButton, background: "rgba(5,150,105,0.24)", borderColor: "rgba(52,211,153,0.58)", color: "#6ee7b7" };
const availabilityBusyActive = { ...availabilityButton, background: "rgba(194,65,12,0.24)", borderColor: "rgba(251,146,60,0.58)", color: "#fdba74" };
const messagingLayout = { height: "calc(100vh - 142px)", minHeight: 560, display: "grid", gridTemplateColumns: "280px minmax(0,1fr)", overflow: "hidden", borderRadius: 8, border: "1px solid rgba(147,197,253,0.22)", background: "rgba(7,26,54,0.72)" };
const conversationSidebar = { minWidth: 0, overflowY: "auto", padding: 12, borderRight: "1px solid rgba(147,197,253,0.18)", background: "rgba(5,20,43,0.88)" };
const conversationHeading = { padding: "6px 8px 14px" };
const contactSearchInput = { width: "100%", boxSizing: "border-box", marginBottom: 10, padding: "9px 10px", borderRadius: 7, border: "1px solid rgba(147,197,253,0.2)", background: "#061834", color: "#e0f2fe" };
const conversationButton = { width: "100%", minHeight: 58, display: "flex", alignItems: "center", gap: 10, padding: 9, marginBottom: 6, borderRadius: 8, border: "1px solid transparent", background: "transparent", color: "#e0f2fe", textAlign: "left", cursor: "pointer", font: "inherit" };
const conversationButtonActive = { ...conversationButton, background: "rgba(37,99,235,0.28)", borderColor: "rgba(125,211,252,0.36)" };
const generalAvatar = { width: 38, height: 38, minWidth: 38, display: "grid", placeItems: "center", borderRadius: 8, background: "rgba(13,148,136,0.32)", color: "#5eead4", fontSize: 20, fontWeight: 900, border: "1px solid rgba(94,234,212,0.34)" };
const contactCopy = { minWidth: 0, flex: 1, display: "grid", overflow: "hidden" };
const contactRole = { display: "block", color: "#94a3b8", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const lastMessagePreview = { display: "block", marginTop: 2, color: "#64748b", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const contactDivider = { margin: "14px 8px 8px", color: "#64748b", fontSize: 11, fontWeight: 800, textTransform: "uppercase" };
const unreadBadge = { minWidth: 21, height: 21, display: "grid", placeItems: "center", padding: "0 5px", boxSizing: "border-box", borderRadius: 999, background: "#22d3ee", color: "#082f49", fontSize: 11, fontWeight: 900 };
const chatPanel = { minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0,1fr) auto", background: "linear-gradient(145deg,rgba(16,40,79,0.7),rgba(2,16,39,0.76))" };
const chatHeader = { display: "flex", alignItems: "center", gap: 11, padding: "13px 16px", borderBottom: "1px solid rgba(147,197,253,0.16)", background: "rgba(7,26,54,0.74)" };
const messageSearchInput = { width: "min(240px,35%)", marginLeft: "auto", padding: "8px 10px", boxSizing: "border-box", borderRadius: 7, border: "1px solid rgba(147,197,253,0.2)", background: "#061834", color: "#e0f2fe" };
const messageStream = { minHeight: 0, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 9 };
const messageLine = { display: "flex", width: "100%" };
const messageBubble = { maxWidth: "min(72%,680px)", padding: "9px 12px", borderRadius: "8px 8px 8px 2px", background: "#17355f", border: "1px solid rgba(147,197,253,0.18)", boxShadow: "0 5px 14px rgba(0,0,0,0.14)" };
const ownMessageBubble = { ...messageBubble, borderRadius: "8px 8px 2px 8px", background: "linear-gradient(135deg,#1d4ed8,#155e75)", borderColor: "rgba(125,211,252,0.3)" };
const messageSender = { display: "block", marginBottom: 4, color: "#67e8f9", fontSize: 11 };
const messageText = { color: "#f8fafc", lineHeight: 1.4, whiteSpace: "pre-wrap", overflowWrap: "anywhere" };
const messageTime = { color: "rgba(226,232,240,0.66)", fontSize: 10 };
const messageDateDivider = { display: "flex", alignItems: "center", justifyContent: "center", margin: "5px 0 12px", color: "#94a3b8", fontSize: 10 };
const replyPreview = { display: "grid", gap: 2, marginBottom: 7, padding: "6px 8px", borderLeft: "3px solid #67e8f9", borderRadius: 4, background: "rgba(2,16,39,0.35)", color: "#cbd5e1", fontSize: 10, overflow: "hidden" };
const messageImage = { display: "block", width: "min(320px,100%)", maxHeight: 240, objectFit: "cover", marginTop: 8, borderRadius: 7, border: "1px solid rgba(186,230,253,0.28)" };
const fileAttachment = { display: "block", marginTop: 8, padding: "8px 10px", borderRadius: 7, background: "rgba(2,16,39,0.42)", color: "#bae6fd", textDecoration: "none", overflowWrap: "anywhere" };
const messageMetaRow = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 5 };
const messageActions = { display: "flex", alignItems: "center", gap: 3 };
const messageActionButton = { width: 24, height: 24, display: "grid", placeItems: "center", padding: 0, borderRadius: 5, border: "1px solid rgba(147,197,253,0.15)", background: "rgba(2,16,39,0.28)", color: "#bfdbfe", cursor: "pointer", fontSize: 12 };
const messageComposer = { padding: 12, borderTop: "1px solid rgba(147,197,253,0.16)", background: "rgba(7,26,54,0.84)" };
const composerRow = { display: "grid", gridTemplateColumns: "42px minmax(0,1fr) 48px", gap: 9, alignItems: "end" };
const composerContext = { display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8, padding: "7px 9px", borderRadius: 7, borderLeft: "3px solid #67e8f9", background: "rgba(8,145,178,0.12)", color: "#cbd5e1", fontSize: 11, overflow: "hidden" };
const composerCloseButton = { width: 26, height: 26, flexShrink: 0, borderRadius: 5, border: 0, background: "rgba(148,163,184,0.16)", color: "#e2e8f0", cursor: "pointer" };
const attachmentSelection = { display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8, padding: "7px 9px", borderRadius: 7, background: "rgba(37,99,235,0.13)", color: "#bfdbfe", fontSize: 11, overflowWrap: "anywhere" };
const attachButton = { width: 42, height: 48, display: "grid", placeItems: "center", boxSizing: "border-box", borderRadius: 8, border: "1px solid rgba(125,211,252,0.35)", background: "#10284f", color: "#67e8f9", cursor: "pointer", fontSize: 23, fontWeight: 700 };
const messageInput = { width: "100%", minHeight: 46, maxHeight: 110, resize: "vertical", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(147,197,253,0.26)", background: "#061834", color: "#f8fafc" };
const sendMessageButton = { width: 48, height: 48, alignSelf: "end", borderRadius: 8, border: "1px solid rgba(103,232,249,0.46)", background: "linear-gradient(135deg,#2563eb,#0891b2)", color: "white", cursor: "pointer", fontSize: 19 };
const emptyConversation = { margin: "auto", color: "#64748b", fontSize: 14 };
const messageSetupNotice = { alignSelf: "center", justifySelf: "center", margin: 24, padding: 16, borderRadius: 8, background: "rgba(180,83,9,0.2)", border: "1px solid rgba(251,191,36,0.38)", color: "#fde68a", textAlign: "center" };
const presenceVisuals = {
  online: { label: "Çevrimiçi", color: "#34d399" },
  busy: { label: "Meşgul", color: "#fb923c" },
  offline: { label: "Çevrimdışı", color: "#64748b" },
};
const presenceBadge = { display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, color: "#cbd5e1", fontSize: 12, fontWeight: 700 };
const presenceBadgeCompact = { marginTop: 2, fontSize: 10 };
const presenceDot = { width: 8, height: 8, flexShrink: 0, borderRadius: "50%" };

function rankMedal(index) {
  const tones = [
    { background: "#fbbf24", color: "#422006" },
    { background: "#cbd5e1", color: "#1e293b" },
    { background: "#fb923c", color: "#431407" },
  ];
  return { width: 28, height: 28, display: "grid", placeItems: "center", flexShrink: 0, borderRadius: "50%", fontSize: 12, fontWeight: 900, ...(tones[index] || { background: "#1e3a5f", color: "#bae6fd" }) };
}

export default App;
