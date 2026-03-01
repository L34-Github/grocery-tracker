// ── sheetsApi.js ──────────────────────────────────────────────────────────────
// All Google Sheets API v4 calls in one place.
//
// Sheet structure (Weekly Prices tab):
//   Row 1-3 : Headers / metadata
//   Row 4+  : Data rows
//
// Column map (1-based for Sheets API, 0-based for array index):
//   A(0)  = Row number (numeric) OR category name (string header)
//   B(1)  = Item name
//   C(2)  = Size
//   D(3)  = WinCo price
//   E(4)  = Fred Meyer price
//   F(5)  = Safeway price
//   G(6)  = Yokes price
//   H(7)  = WinCo on-sale (TRUE/FALSE)
//   I(8)  = Fred Meyer on-sale
//   J(9)  = Safeway on-sale
//   K(10) = Yokes on-sale
// ─────────────────────────────────────────────────────────────────────────────

export const SPREADSHEET_ID = "1VzOd7Qs4cq84H9XHjpI89QoUlT_-OI1GLSVkl0PW44E";
const SHEET_NAME     = "Weekly Prices";
const BASE_URL       = "https://sheets.googleapis.com/v4/spreadsheets";

// Apps Script Web App URL — used for addItem and deleteItem (avoids CORS)
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz4ls7nJkJ_P7ddpaaXjA9Mwoox7mKg56zjXE8ZnlJ7xp8PCTb9_EcLVFcBHx3XxuPy/exec";

// Store key → column index (0-based in row array)
const PRICE_COL  = { winco: 3, fredmeyer: 4, safeway: 5, yokes: 6 };
const SALE_COL   = { winco: 7, fredmeyer: 8, safeway: 9, yokes: 10 };

// Store key → sheet column letter (for range notation)
const PRICE_LETTER = { winco: "D", fredmeyer: "E", safeway: "F", yokes: "G" };
const SALE_LETTER  = { winco: "H", fredmeyer: "I", safeway: "J", yokes: "K" };

// Categories and their display icons
export const CAT_ICONS = { "Dairy & Eggs": "🥚", Produce: "🥬", Pantry: "🧂", Beverages: "🍷" };
export const CATEGORIES = Object.keys(CAT_ICONS);

// ── Shared fetch wrapper ──────────────────────────────────────────────────────
async function sheetsRequest(accessToken, path, options = {}) {
  const res = await fetch(`${BASE_URL}/${SPREADSHEET_ID}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Sheets API error ${res.status}`);
  }
  return res.json();
}

// ── Parse raw sheet rows into item objects ────────────────────────────────────
function parseRows(rows) {
  const items = [];
  let currentCat = "";
  let sheetRowIndex = 3; // rows 0-2 are headers (0-based)

  for (let i = 3; i < rows.length; i++) {
    const row   = rows[i] || [];
    const col_A = row[0];
    const col_B = row[1];

    // Category header row
    if (typeof col_A === "string" && col_A.trim() !== "" && isNaN(Number(col_A))) {
      currentCat = col_A.replace(/[^\w\s&]/gu, "").trim();
      continue;
    }

    // Skip non-numeric rows (empty, totals, etc.)
    if (isNaN(Number(col_A)) || col_A === "") continue;
    if (typeof col_B === "string" && col_B.includes("TOTAL")) continue;

    const priceOrNull = (v) => {
      if (v === "" || v == null) return null;
      // Strip currency formatting ($1.00, $1,234.56) before parsing
      const cleaned = String(v).replace(/[$,]/g, "").trim();
      if (cleaned === "") return null;
      const n = parseFloat(cleaned);
      return isNaN(n) ? null : Math.round(n * 100) / 100;
    };

    items.push({
      sheetRow: i + 1,          // 1-based sheet row number for API calls
      rowNum:   Number(col_A),
      category: currentCat,
      name:     String(col_B || "").trim(),
      size:     String(row[2] || "").trim(),
      prices: {
        winco:     priceOrNull(row[3]),
        fredmeyer: priceOrNull(row[4]),
        safeway:   priceOrNull(row[5]),
        yokes:     priceOrNull(row[6]),
      },
      onSale: {
        winco:     row[7]  === true || row[7]  === "TRUE",
        fredmeyer: row[8]  === true || row[8]  === "TRUE",
        safeway:   row[9]  === true || row[9]  === "TRUE",
        yokes:     row[10] === true || row[10] === "TRUE",
      },
    });
  }
  return items;
}

// ── READ: Get all items from sheet ────────────────────────────────────────────
export async function getItems(accessToken) {
  const data = await sheetsRequest(
    accessToken,
    `/values/${encodeURIComponent(SHEET_NAME)}!A:K`
  );
  const rows = data.values || [];
  return parseRows(rows);
}

// ── WRITE: Update a single price cell ────────────────────────────────────────
// sheetRow: 1-based row number
// storeKey: "winco" | "fredmeyer" | "safeway" | "yokes"
// price: number or null (null clears the cell)
export async function updatePrice(accessToken, sheetRow, storeKey, price) {
  const col   = PRICE_LETTER[storeKey];
  const range = `${SHEET_NAME}!${col}${sheetRow}`;
  const value = price == null ? "" : price;

  await sheetsRequest(
    accessToken,
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [[value]] }),
    }
  );
}

// ── WRITE: Toggle on-sale flag ────────────────────────────────────────────────
export async function toggleSale(accessToken, sheetRow, storeKey, isOnSale) {
  const col   = SALE_LETTER[storeKey];
  const range = `${SHEET_NAME}!${col}${sheetRow}`;

  await sheetsRequest(
    accessToken,
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [[isOnSale]] }),
    }
  );
}

// ── WRITE: Add item — delegates to Apps Script via JSONP (no CORS issues) ────
// The Apps Script handles row insertion, alphabetical ordering, and renumbering.
// Returns the fresh item list so the React app can reload without a second call.
export async function addItem(accessToken, category, name, size) {
  return new Promise((resolve, reject) => {
    const cbName = "_gsAdd_" + Date.now();
    const params = new URLSearchParams({
      action:   "addItem",
      category: category,
      name:     name,
      size:     size,
      callback: cbName,
    });
    const url    = `${APPS_SCRIPT_URL}?${params}`;
    const script = document.createElement("script");

    window[cbName] = (data) => {
      delete window[cbName];
      document.head.removeChild(script);
      if (data.error) reject(new Error(data.error));
      else            resolve(data);   // data.items = fresh item list
    };

    script.onerror = () => {
      delete window[cbName];
      document.head.removeChild(script);
      reject(new Error("addItem JSONP request failed"));
    };

    script.src = url;
    document.head.appendChild(script);
  });
}

// ── WRITE: Delete item — delegates to Apps Script via JSONP ──────────────────
export async function deleteItem(accessToken, sheetRow) {
  return new Promise((resolve, reject) => {
    const cbName = "_gsDel_" + Date.now();
    const params = new URLSearchParams({
      action:   "deleteItem",
      sheetRow: sheetRow,
      callback: cbName,
    });
    const url    = `${APPS_SCRIPT_URL}?${params}`;
    const script = document.createElement("script");

    window[cbName] = (data) => {
      delete window[cbName];
      document.head.removeChild(script);
      if (data.error) reject(new Error(data.error));
      else            resolve(data);   // data.items = fresh item list
    };

    script.onerror = () => {
      delete window[cbName];
      document.head.removeChild(script);
      reject(new Error("deleteItem JSONP request failed"));
    };

    script.src = url;
    document.head.appendChild(script);
  });
}

// ── Helper: get week label string ─────────────────────────────────────────────
export function getWeekLabel() {
  const now   = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + 3);
  const end   = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt   = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}, ${start.getFullYear()}`;
}
