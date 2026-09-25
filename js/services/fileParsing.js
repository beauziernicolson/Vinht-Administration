// Parsing CSV / XLSX 100% côté navigateur pour #37 (import catalogue, import
// stock). Aucune donnée n'est envoyée à un service tiers : le fichier est lu
// et parsé localement. XLSX utilise SheetJS (chargé en <script> statique
// depuis un CDN, comme lucide) — cette fonction échoue proprement si la
// librairie n'est pas disponible plutôt que d'inventer un parseur maison.

// Parseur CSV minimal mais correct : gère les champs entre guillemets, les
// virgules et retours à la ligne à l'intérieur des guillemets, et les
// guillemets échappés ("").
export function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Ignore les lignes totalement vides en fin de fichier.
  while (rows.length && rows[rows.length - 1].every((c) => String(c || "").trim() === "")) rows.pop();
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => String(h || "").trim());
  const dataRows = rows.slice(1).map((r) => headers.map((_, i) => (r[i] !== undefined ? r[i] : "")));
  return { headers, rows: dataRows };
}

export function isXlsxSupportAvailable() {
  return typeof window !== "undefined" && !!window.XLSX;
}

// Renvoie la même forme que parseCsvText : { headers, rows }.
export function parseXlsxArrayBuffer(arrayBuffer) {
  if (!isXlsxSupportAvailable()) throw new Error("xlsx_support_unavailable");
  const wb = window.XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = wb.Sheets[sheetName];
  const grid = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  if (!grid.length) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => String(h || "").trim());
  const dataRows = grid.slice(1)
    .filter((r) => r.some((c) => String(c || "").trim() !== ""))
    .map((r) => headers.map((_, i) => (r[i] !== undefined ? String(r[i]) : "")));
  return { headers, rows: dataRows };
}

export async function parseTabularFile(file) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".xlsx")) {
    if (!isXlsxSupportAvailable()) throw new Error("xlsx_support_unavailable");
    const buf = await file.arrayBuffer();
    return parseXlsxArrayBuffer(buf);
  }
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await file.text();
    return parseCsvText(text);
  }
  throw new Error("unsupported_file_type");
}
