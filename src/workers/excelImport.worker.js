import * as XLSX from "xlsx";

const normalizeHeader = (value) => String(value || "")
  .toLocaleLowerCase("tr-TR")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\u0131/g, "i")
  .replace(/[^a-z0-9]/g, "");

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

const isPhoneHeader = (value) => /^(telefon|phone|gsm|cep|ceptel|ceptelefon|tel|numara|telno|gsmno|cepno)/.test(normalizeHeader(value));
const isNameHeader = (value) => {
  const header = normalizeHeader(value);
  if (["ad", "adi", "isim", "unvan"].includes(header)) return true;
  return ["hesapad", "adisoyad", "adsoyad", "musteri", "musteriad", "isimsoyisim", "advesoyad"]
    .some((name) => header.includes(name));
};
const isTcHeader = (value) => {
  const header = normalizeHeader(value);
  if (["tc", "tckn"].includes(header)) return true;
  return ["tckimlik", "kimlikno"].some((name) => header.includes(name));
};
const isEmailHeader = (value) => ["email", "eposta", "mail"].some((name) => normalizeHeader(value).includes(name));

const ignoredInfoHeaders = new Set([
  "sira",
  "no",
  "id",
  "telefon",
  "telefon1",
  "telefon2",
  "numara",
  "telno",
  "gsmno",
  "cepno",
  "phone",
  "phone1",
  "phone2",
  "gsm",
  "cep",
  "ceptel",
  "ceptelefon",
  "tel",
  "tc",
  "tckn",
  "tckimlik",
  "kimlikno",
  "hesapad",
  "adisoyad",
  "adsoyad",
  "musteri",
  "musteriad",
  "unvan",
  "isim",
  "isimsoyisim",
  "advesoyad",
  "ad",
  "adi",
  "email",
  "eposta",
  "mail",
]);

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
const HEADERLESS_LOOKAHEAD_COLUMNS = 6;

const uniqueValues = (values) => [...new Set(values.filter(Boolean))];

const friendlyHeader = (header, index) => cleanName(header) || `Kolon ${index + 1}`;
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

const findHeaderlessPhones = (row, nameColumn, usedPhoneColumns = new Set()) => {
  const candidates = [];
  const candidateColumns = [];

  for (let offset = 1; offset <= HEADERLESS_LOOKAHEAD_COLUMNS; offset += 1) {
    const phoneColumn = nameColumn + offset;
    const phone = spreadsheetPhone(row[phoneColumn]);
    if (!phone || usedPhoneColumns.has(phoneColumn)) continue;
    candidates.push(phone);
    candidateColumns.push(phoneColumn);
  }

  return {
    phones: uniqueValues(candidates),
    columns: candidateColumns,
  };
};

const findHeaderlessTcColumn = (row, nameColumn, phoneColumns = []) => row.findIndex((candidate, candidateIndex) => (
  candidateIndex !== nameColumn
  && !phoneColumns.includes(candidateIndex)
  && validTurkishTc(candidate)
));

const findHeaderlessEmailColumn = (row, nameColumn, phoneColumns = [], tcColumn = -1) => row.findIndex((candidate, candidateIndex) => (
  candidateIndex !== nameColumn
  && candidateIndex !== tcColumn
  && !phoneColumns.includes(candidateIndex)
  && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanName(candidate))
));

const buildRowInfo = ({ headers = [], row = [], sheetName, rowNumber, usedColumns = new Set() }) => {
  const columns = {};
  const noteLines = [];

  row.forEach((value, index) => {
    const text = cleanName(value);
    if (!text || usedColumns.has(index)) return;
    const header = friendlyHeader(headers[index], index);
    const normalized = normalizeHeader(header);
    if (ignoredInfoHeaders.has(normalized) || isPhoneHeader(header) || isNameHeader(header) || isTcHeader(header) || isEmailHeader(header)) return;
    if (spreadsheetPhone(text) || validTurkishTc(text)) return;
    columns[header] = text;
    noteLines.push(`${header}: ${text}`);
  });

  const contextLines = [];
  if (sheetName) contextLines.push(`Excel sayfasi: ${sheetName}`);
  if (rowNumber) contextLines.push(`Excel satiri: ${rowNumber}`);

  return {
    infoNote: [...contextLines, ...noteLines].join("\n"),
    sourceExtra: {
      sheet_name: sheetName || "",
      row_number: rowNumber || null,
      columns,
    },
  };
};

self.onmessage = ({ data: { buffer, fileName } }) => {
  try {
    const workbook = XLSX.read(buffer, { type: "array" });
    const preparedRows = [];
    const importedContactKeys = new Set();
    const importedTcKeys = new Set();
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
    const sheetStats = [];

    const addCustomer = ({
      fullName,
      phones,
      tcValue = "",
      emailValue = "",
      rowNumber,
      trustedNameColumn = false,
      infoNote = "",
      sourceExtra = null,
    }) => {
      const uniquePhones = [...new Set(phones.map(spreadsheetPhone).filter(Boolean))];
      const primaryPhone = uniquePhones[0];
      if (!(trustedNameColumn ? hasReadableName(fullName) : isPlausibleName(fullName)) || !primaryPhone) {
        rejectedRows += 1;
        return;
      }
      const secondPhone = uniquePhones.slice(1)[0] || null;
      const tcNo = validTurkishTc(tcValue);
      const contactKeys = [primaryPhone, secondPhone].filter(Boolean);
      const isDuplicate = contactKeys.some((phone) => importedContactKeys.has(phone))
        || (tcNo && importedTcKeys.has(tcNo));
      if (isDuplicate) {
        duplicateRows += 1;
        return;
      }
      contactKeys.forEach((phone) => importedContactKeys.add(phone));
      if (tcNo) importedTcKeys.add(tcNo);
      const names = splitName(fullName);
      preparedRows.push({
        ...names,
        phone: primaryPhone,
        phone_2: secondPhone,
        tc_no: tcNo,
        email: cleanName(emailValue),
        batch_name: fileName,
        batch_page: rowNumber,
        info_note: infoNote,
        source_extra: sourceExtra,
        status: "pool",
        approved: false,
        payment_received: false,
      });
    };

    sheets.forEach(({ sheetName, matrix }) => {
      const headerRowIndex = matrix.slice(0, 30).findIndex((row) => row.some(isPhoneHeader) && row.some(isNameHeader));
      let extractedFromSheet = 0;
      let rejectedBeforeSheet = rejectedRows;
      let duplicateBeforeSheet = duplicateRows;

      if (headerRowIndex >= 0) {
        const headers = matrix[headerRowIndex];
        const nameColumn = headers.findIndex(isNameHeader);
        const phoneColumns = headers.map((header, index) => isPhoneHeader(header) ? index : -1).filter((index) => index >= 0);
        const tcColumn = headers.findIndex(isTcHeader);
        const emailColumn = headers.findIndex(isEmailHeader);

        matrix.slice(headerRowIndex + 1).forEach((row, index) => {
          const rowNumber = headerRowIndex + index + 2;
          const usedColumns = new Set([nameColumn, ...phoneColumns]);
          if (tcColumn >= 0) usedColumns.add(tcColumn);
          if (emailColumn >= 0) usedColumns.add(emailColumn);
          const info = buildRowInfo({ headers, row, sheetName, rowNumber, usedColumns });
          const before = preparedRows.length;
          addCustomer({
            fullName: row[nameColumn],
            phones: phoneColumns.map((column) => row[column]),
            tcValue: tcColumn >= 0 ? row[tcColumn] : "",
            emailValue: emailColumn >= 0 ? row[emailColumn] : "",
            rowNumber,
            trustedNameColumn: true,
            infoNote: info.infoNote,
            sourceExtra: info.sourceExtra,
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
            const { phones: phoneCandidates, columns: phoneColumns } = findHeaderlessPhones(row, columnIndex, usedPhoneColumns);
            if (!phoneCandidates.length) return;
            phoneColumns.forEach((phoneColumn) => usedPhoneColumns.add(phoneColumn));
            const localUsedColumns = new Set([columnIndex]);
            phoneColumns.forEach((phoneColumn) => localUsedColumns.add(phoneColumn));
            const tcColumn = findHeaderlessTcColumn(row, columnIndex, phoneColumns);
            if (tcColumn >= 0) localUsedColumns.add(tcColumn);
            const emailColumn = findHeaderlessEmailColumn(row, columnIndex, phoneColumns, tcColumn);
            if (emailColumn >= 0) localUsedColumns.add(emailColumn);
            const info = buildRowInfo({ row, sheetName, rowNumber: rowIndex + 1, usedColumns: localUsedColumns });
            const before = preparedRows.length;
            addCustomer({
              fullName: cell,
              phones: phoneCandidates,
              tcValue: tcColumn >= 0 ? row[tcColumn] : "",
              emailValue: emailColumn >= 0 ? row[emailColumn] : "",
              rowNumber: rowIndex + 1,
              infoNote: info.infoNote,
              sourceExtra: info.sourceExtra,
            });
            if (preparedRows.length > before) extractedFromSheet += 1;
          });
          processedRowCount += 1;
          if (processedRowCount % 250 === 0) self.postMessage({ type: "progress", current: processedRowCount, total: totalRows });
        });
      }

      if (extractedFromSheet > 0) processedSheets.push(sheetName);
      sheetStats.push({
        sheet_name: sheetName,
        rows_seen: matrix.length,
        cleaned: extractedFromSheet,
        rejected: rejectedRows - rejectedBeforeSheet,
        duplicates: duplicateRows - duplicateBeforeSheet,
        header_mode: headerRowIndex >= 0 ? "header" : "headerless",
      });
    });

    self.postMessage({ type: "progress", current: totalRows, total: totalRows });
    self.postMessage({
      type: "result",
      result: {
        rows: preparedRows,
        sheetName: processedSheets.join(", ") || workbook.SheetNames[0],
        totalSheets: workbook.SheetNames.length,
        nonEmptySheets: sheets.length,
        processedSheets,
        sheetStats,
        rejectedRows,
        duplicateRows,
      },
    });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || "Excel işlenemedi." });
  }
};
