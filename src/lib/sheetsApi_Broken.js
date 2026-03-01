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
const SHEET_NAME = "Weekly Prices";
const BASE_URL   = "https://sheets.googleapis.com/v4/spreadsheets";

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

// ── WRITE: Add a new item, alphabetized within its category ──────────────────
// Strategy: read all rows → splice new item in alphabetical order within the
// category block → write the entire data range back with a single PUT.
// Avoids batchUpdate entirely (no CORS preflight). Row numbers (col A) are
// reassigned sequentially across all items after the splice.
export async function addItem(accessToken, category, name, size) {
  const data = await sheetsRequest(
    accessToken,
    `/values/${encodeURIComponent(SHEET_NAME)}!A:K`
  );
  const rows = data.values || [];

  // ── 1. Separate header rows (rows 0-2) from data rows (row 3+) ──────────
  const headerRows = rows.slice(0, 3);
  const dataRows   = rows.slice(3);

  // Pad all rows to 11 columns so the PUT covers A:K consistently
  const pad = (r) => {
    const out = [...(r || [])];
    while (out.length < 11) out.push("");
    return out;
  };

  // ── 2. Normalize helper ─────────────────────────────────────────────────
  const normalize = (s) => String(s).replace(/[^\w\s]/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  const targetCat = normalize(category);

  // ── 3. Find the category block boundaries in dataRows ───────────────────
  let catStart = -1;   // index in dataRows where this category's header is
  let catEnd   = -1;   // index of last item row in this category (inclusive)

  for (let i = 0; i < dataRows.length; i++) {
    const col_A = dataRows[i][0];
    if (typeof col_A === "string" && col_A.trim() !== "" && isNaN(Number(col_A))) {
      if (normalize(col_A) === targetCat) {
        catStart = i;
      } else if (catStart !== -1 && catEnd === -1) {
        // Hit the next category header — block ended before this row
        catEnd = i - 1;
        break;
      }
    } else if (catStart !== -1 && !isNaN(Number(col_A)) && col_A !== "") {
      catEnd = i; // keep advancing — this is an item row in our category
    }
  }
  if (catStart !== -1 && catEnd === -1) catEnd = dataRows.length - 1; // last category

  // ── 4. Build the new item row — use a sentinel so renumbering finds it safely ─
  const NEW_ROW = "__NEW__";
  const newItemRow = [NEW_ROW, name, size, "", "", "", "", "", "", "", ""];

  let updatedDataRows;

  if (catStart === -1) {
    // Category doesn't exist yet — append header + item at end
    updatedDataRows = [
      ...dataRows,
      pad([category]),
      newItemRow,
    ];
  } else {
    // Collect only numeric-keyed item rows (skip blanks left by deletes)
    const beforeCat = dataRows.slice(0, catStart + 1);
    const catItems  = dataRows.slice(catStart + 1, catEnd + 1).filter(
      r => !isNaN(Number(r[0])) && String(r[0]).trim() !== ""
    );
    const afterCat  = dataRows.slice(catEnd + 1);

    // Insert alphabetically by item name (col B, case-insensitive)
    const insertIdx = catItems.findIndex(
      r => String(r[1] || "").toLowerCase() > name.toLowerCase()
    );
    if (insertIdx === -1) {
      catItems.push(newItemRow);
    } else {
      catItems.splice(insertIdx, 0, newItemRow);
    }

    updatedDataRows = [...beforeCat, ...catItems, ...afterCat];
  }

  // ── 5. Renumber all item rows sequentially (col A) ───────────────────────
  let rowNum = 1;
  const finalDataRows = updatedDataRows.map(r => {
    const padded = pad(r);
    const isExistingItem = !isNaN(Number(padded[0])) && String(padded[0]).trim() !== "";
    const isNewItem      = padded[0] === NEW_ROW;
    if (isExistingItem || isNewItem) {
      padded[0] = rowNum++;
    }
    return padded;
  });

  // ── 6. Write everything back in one PUT ──────────────────────────────────
  const allRows    = [...headerRows.map(pad), ...finalDataRows];
  const lastRow    = allRows.length;  // 1-based
  const writeRange = `${SHEET_NAME}!A1:K${lastRow}`;

  await sheetsRequest(
    accessToken,
    `/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: allRows }),
    }
  );
}

// ── WRITE: Delete an item row ─────────────────────────────────────────────────
// Clears the row content rather than deleting the physical row — avoids
// batchUpdate (which triggers CORS preflight). The cleared row is skipped
// by parseRows since col_A will no longer be a number.
export async function deleteItem(accessToken, sheetRow) {
  const range = `${SHEET_NAME}!A${sheetRow}:K${sheetRow}`;
  await sheetsRequest(
    accessToken,
    `/values/${encodeURIComponent(range)}:clear`,
    { method: "POST" }
  );
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
