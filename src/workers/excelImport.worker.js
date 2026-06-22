import * as XLSX from "xlsx";

const normalizeHeader = (value) => String(value || "")
  .toLocaleLowerCase("tr-TR")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]/g, "");

const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

const spreadsheetPhone = (value) => {
  let text = String(value ?? "").trim();
  if (/^\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(text)) {
    text = Number(text.replace(",", ".")).toFixed(0);
  }

  let digits = text.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("90")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[2345]\d{9}$/.test(digits) ? digits : "";
};

const isPhoneHeader = (value) => /^(telefon|phone|gsm|cep|ceptel|ceptelefon|tel)/.test(normalizeHeader(value));
const isNameHeader = (value) => ["hesapad", "adisoyad", "adsoyad", "musteri", "unvan"]
  .some((name) => normalizeHeader(value).includes(name));
const cleanDigits = (value) => String(value || "").replace(/\D/g, "");
const validTurkishTc = (value) => {
  const digits = cleanDigits(value);
  if (!/^[1-9]\d{10}$/.test(digits)) return "";
  const numbers = [...digits].map(Number);
  const tenthRaw = (numbers[0] + numbers[2] + numbers[4] + numbers[6] + numbers[8]) * 7 -
    (numbers[1] + numbers[3] + numbers[5] + numbers[7]);
  const tenth = ((tenthRaw % 10) + 10) % 10;
  const eleventh = numbers.slice(0, 10).reduce((sum, number) => sum + number, 0) % 10;
  return tenth === numbers[9] && eleventh === numbers[10] ? digits : "";
};

self.onmessage = ({ data: { buffer, fileName, existingPhones } }) => {
  try {
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetCandidates = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      const headerRowIndex = matrix.slice(0, 30).findIndex((row) =>
        row.some(isPhoneHeader) && row.some(isNameHeader)
      );
      return { sheetName, sheet, rowCount: matrix.length, headerRowIndex };
    }).filter((candidate) => candidate.headerRowIndex >= 0)
      .sort((a, b) => (b.rowCount - b.headerRowIndex) - (a.rowCount - a.headerRowIndex));

    const selectedSheet = sheetCandidates[0];
    if (!selectedSheet) {
      throw new Error("Telefon ve müşteri adı başlıkları bulunamadı. Sütunlarda 'Telefon-1' ve 'Hesap Adı' gibi başlıklar olmalı.");
    }

    const rows = XLSX.utils.sheet_to_json(selectedSheet.sheet, {
      defval: "",
      raw: false,
      range: selectedSheet.headerRowIndex,
    });
    if (rows.length === 0) throw new Error(`'${selectedSheet.sheetName}' sayfasında yüklenecek satır bulunamadı.`);

    const currentPhones = new Set(existingPhones.map(normalizePhone).filter(Boolean));
    const filePhones = new Set();
    const preparedRows = [];
    let rejectedRows = 0;
    let duplicateRows = 0;

    rows.forEach((row, index) => {
      const values = Object.values(row);
      const keys = Object.keys(row);
      const getByHeader = (names) => {
        const key = keys.find((candidate) =>
          names.some((name) => normalizeHeader(candidate).includes(normalizeHeader(name)))
        );
        return key ? row[key] : "";
      };

      const fullName =
        getByHeader(["hesap adı", "hesap adi", "adı soyadı", "adi soyadi", "ad soyad", "müşteri", "musteri"]) ||
        values.find((value) => {
          const text = String(value || "").trim();
          return text && /[a-zA-ZğüşöçıİĞÜŞÖÇ]/.test(text);
        }) || "";

      const phoneKeys = keys.filter(isPhoneHeader);
      const orderedPhoneValues = [
        ...phoneKeys.filter((key) => !/2$/.test(normalizeHeader(key))).map((key) => row[key]),
        ...phoneKeys.filter((key) => /2$/.test(normalizeHeader(key))).map((key) => row[key]),
      ];
      const phoneValues = [...new Set(orderedPhoneValues.map(spreadsheetPhone).filter(Boolean))];
      const normalizedPhone = normalizePhone(phoneValues[0]);
      const normalizedPhone2 = normalizePhone(phoneValues[1]);
      const rowPhones = [normalizedPhone, normalizedPhone2].filter(Boolean);

      if (!String(fullName).trim() || !normalizedPhone) {
        rejectedRows += 1;
      } else if (rowPhones.some((phone) => filePhones.has(phone) || currentPhones.has(phone))) {
        duplicateRows += 1;
      } else {
        rowPhones.forEach((phone) => filePhones.add(phone));
        const parts = String(fullName).trim().split(/\s+/);
        const tcValue = validTurkishTc(getByHeader(["tc", "t.c", "kimlik"]));

        preparedRows.push({
          first_name: parts.slice(0, -1).join(" ") || String(fullName),
          last_name: parts.length > 1 ? parts.at(-1) : "",
          phone: normalizedPhone,
          phone_2: normalizedPhone2 || null,
          tc_no: tcValue,
          email: "",
          batch_name: fileName,
          batch_page: selectedSheet.headerRowIndex + index + 2,
          info_note: "",
          status: "pool",
          approved: false,
          payment_received: false,
        });
      }

      if ((index + 1) % 250 === 0 || index === rows.length - 1) {
        self.postMessage({ type: "progress", current: index + 1, total: rows.length });
      }
    });

    self.postMessage({
      type: "result",
      result: {
        rows: preparedRows,
        sheetName: selectedSheet.sheetName,
        rejectedRows,
        duplicateRows,
      },
    });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || "Excel işlenemedi." });
  }
};
