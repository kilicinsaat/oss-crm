import * as XLSX from "xlsx";

const normalizeHeader = (value) => String(value || "")
  .toLocaleLowerCase("tr-TR")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\u0131/g, "i")
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
  return /^5\d{9}$/.test(digits) ? digits : "";
};

const isPhoneHeader = (value) => /^(telefon|phone|gsm|cep|ceptel|ceptelefon|tel)/.test(normalizeHeader(value));
const isNameHeader = (value) => ["hesapad", "adisoyad", "adsoyad", "musteri", "unvan", "isimsoyisim", "advesoyad"]
  .some((name) => normalizeHeader(value).includes(name));
const isTcHeader = (value) => ["tc", "tckimlik", "kimlikno"].some((name) => normalizeHeader(value).includes(name));

const cleanDigits = (value) => String(value || "").replace(/\D/g, "");
const validTurkishTc = (value) => {
  const digits = cleanDigits(value);
  if (!/^[1-9]\d{10}$/.test(digits)) return "";
  const numbers = [...digits].map(Number);
  const tenthRaw = (numbers[0] + numbers[2] + numbers[4] + numbers[6] + numbers[8]) * 7
    - (numbers[1] + numbers[3] + numbers[5] + numbers[7]);
  const tenth = ((tenthRaw % 10) + 10) % 10;
  const eleventh = numbers.slice(0, 10).reduce((sum, number) => sum + number, 0) % 10;
  return tenth === numbers[9] && eleventh === numbers[10] ? digits : "";
};

const cleanName = (value) => String(value || "").replace(/\s+/g, " ").trim();
const hasReadableName = (value) => {
  const text = cleanName(value);
  return text.length >= 2 && text.length <= 160 && /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(text);
};
const isPlausibleName = (value) => {
  const text = cleanName(value);
  if (!hasReadableName(text) || /\d/.test(text)) return false;
  const normalized = normalizeHeader(text);
  if (!normalized || isPhoneHeader(text) || isNameHeader(text) || isTcHeader(text)) return false;
  return !["tarih", "adres", "aciklama", "bolge", "sube", "sayfa"].includes(normalized);
};

const splitName = (fullName) => {
  const parts = cleanName(fullName).split(/\s+/).filter(Boolean);
  return {
    first_name: parts.slice(0, -1).join(" ") || parts[0] || "Müşteri",
    last_name: parts.length > 1 ? parts.at(-1) : "",
  };
};

self.onmessage = ({ data: { buffer, fileName, existingPhones } }) => {
  try {
    const workbook = XLSX.read(buffer, { type: "array" });
    const currentPhones = new Set((existingPhones || []).map(normalizePhone).filter(Boolean));
    const filePhones = new Set();
    const preparedRows = [];
    const processedSheets = [];
    let rejectedRows = 0;
    let duplicateRows = 0;
    let processedRowCount = 0;

    const sheets = workbook.SheetNames.map((sheetName) => {
      const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: "",
        raw: false,
        blankrows: false,
      });
      return { sheetName, matrix };
    }).filter(({ matrix }) => matrix.some((row) => row.some((cell) => String(cell || "").trim())));

    const totalRows = sheets.reduce((sum, sheet) => sum + sheet.matrix.length, 0);

    const addCustomer = ({ fullName, phones, tcValue = "", sheetName, rowNumber, trustedNameColumn = false }) => {
      const uniquePhones = [...new Set(phones.map(spreadsheetPhone).filter(Boolean))];
      const primaryPhone = uniquePhones[0];
      if (!(trustedNameColumn ? hasReadableName(fullName) : isPlausibleName(fullName)) || !primaryPhone) {
        rejectedRows += 1;
        return;
      }
      if (filePhones.has(primaryPhone) || currentPhones.has(primaryPhone)) {
        duplicateRows += 1;
        return;
      }

      const secondPhone = uniquePhones.slice(1).find((phone) => !filePhones.has(phone) && !currentPhones.has(phone)) || null;
      filePhones.add(primaryPhone);
      if (secondPhone) filePhones.add(secondPhone);
      const names = splitName(fullName);
      preparedRows.push({
        ...names,
        phone: primaryPhone,
        phone_2: secondPhone,
        tc_no: validTurkishTc(tcValue),
        email: "",
        batch_name: fileName,
        batch_page: rowNumber,
        info_note: sheetName === workbook.SheetNames[0] ? "" : `Excel sayfası: ${sheetName}`,
        status: "pool",
        approved: false,
        payment_received: false,
      });
    };

    sheets.forEach(({ sheetName, matrix }) => {
      const headerRowIndex = matrix.slice(0, 30).findIndex((row) => row.some(isPhoneHeader) && row.some(isNameHeader));
      let extractedFromSheet = 0;

      if (headerRowIndex >= 0) {
        const headers = matrix[headerRowIndex];
        const nameColumn = headers.findIndex(isNameHeader);
        const phoneColumns = headers.map((header, index) => isPhoneHeader(header) ? index : -1).filter((index) => index >= 0);
        const tcColumn = headers.findIndex(isTcHeader);

        matrix.slice(headerRowIndex + 1).forEach((row, index) => {
          const before = preparedRows.length;
          addCustomer({
            fullName: row[nameColumn],
            phones: phoneColumns.map((column) => row[column]),
            tcValue: tcColumn >= 0 ? row[tcColumn] : "",
            sheetName,
            rowNumber: headerRowIndex + index + 2,
            trustedNameColumn: true,
          });
          if (preparedRows.length > before) extractedFromSheet += 1;
          processedRowCount += 1;
          if (processedRowCount % 250 === 0) self.postMessage({ type: "progress", current: processedRowCount, total: totalRows });
        });
      } else {
        matrix.forEach((row, rowIndex) => {
          const usedPhoneColumns = new Set();
          row.forEach((cell, columnIndex) => {
            if (!isPlausibleName(cell)) return;
            const phoneCandidates = [];
            for (let offset = 1; offset <= 2; offset += 1) {
              const phoneColumn = columnIndex + offset;
              const phone = spreadsheetPhone(row[phoneColumn]);
              if (!phone || usedPhoneColumns.has(phoneColumn)) continue;
              phoneCandidates.push(phone);
              usedPhoneColumns.add(phoneColumn);
            }
            if (!phoneCandidates.length) return;
            const before = preparedRows.length;
            addCustomer({ fullName: cell, phones: phoneCandidates, sheetName, rowNumber: rowIndex + 1 });
            if (preparedRows.length > before) extractedFromSheet += 1;
          });
          processedRowCount += 1;
          if (processedRowCount % 250 === 0) self.postMessage({ type: "progress", current: processedRowCount, total: totalRows });
        });
      }

      if (extractedFromSheet > 0) processedSheets.push(sheetName);
    });

    self.postMessage({ type: "progress", current: totalRows, total: totalRows });
    if (preparedRows.length === 0) {
      throw new Error("Dosyada geçerli isim + GSM eşleşmesi bulunamadı. Telefonlar 5 ile başlayan 10 haneli GSM olmalıdır.");
    }

    self.postMessage({
      type: "result",
      result: {
        rows: preparedRows,
        sheetName: processedSheets.join(", ") || workbook.SheetNames[0],
        rejectedRows,
        duplicateRows,
      },
    });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || "Excel işlenemedi." });
  }
};
