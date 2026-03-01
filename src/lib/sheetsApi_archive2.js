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

// ── WRITE: Add a new item to the sheet ───────────────────────────────────────
// Finds the last row of the target category and appends after it.
// If category doesn't exist yet, appends at end with a new category header.
export async function addItem(accessToken, category, name, size) {
  // Read current sheet to find insertion point
  const data = await sheetsRequest(
    accessToken,
    `/values/${encodeURIComponent(SHEET_NAME)}!A:K`
  );
  const rows = data.values || [];

  let lastRowInCat = -1;
  let currentCat   = "";
  let maxRowNum    = 0;

  for (let i = 3; i < rows.length; i++) {
    const row   = rows[i] || [];
    const col_A = row[0];
    const col_B = row[1];

    if (typeof col_A === "string" && col_A.trim() !== "" && isNaN(Number(col_A))) {
      currentCat = col_A.replace(/[^\w\s&]/gu, "").trim();
      continue;
    }
    if (!isNaN(Number(col_A)) && col_A !== "") {
      const n = Number(col_A);
      if (n > maxRowNum) maxRowNum = n;
      if (currentCat === category) lastRowInCat = i;
    }
  }

  const newRowNum = maxRowNum + 1;

  if (lastRowInCat === -1) {
    // Category not found — append category header + item at end of sheet
    const appendRows = [
      [category, "", "", "", "", "", "", false, false, false, false],
      [newRowNum, name, size, "", "", "", "", false, false, false, false],
    ];
    await sheetsRequest(
      accessToken,
      `/values/${encodeURIComponent(SHEET_NAME)}!A1:K1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: JSON.stringify({ values: appendRows }),
      }
    );
  } else {
    // Insert after last row of the category using batchUpdate
    const insertAfterRow = lastRowInCat + 1; // 1-based

    // First insert a blank row
    await sheetsRequest(
      accessToken,
      "/batchUpdate",
      {
        method: "POST",
        body: JSON.stringify({
          requests: [{
            insertDimension: {
              range: {
                sheetId: await getSheetId(accessToken),
                dimension: "ROWS",
                startIndex: insertAfterRow,     // 0-based
                endIndex:   insertAfterRow + 1,
              },
              inheritFromBefore: true,
            },
          }],
        }),
      }
    );

    // Then write the new item data into that row
    const range = `${SHEET_NAME}!A${insertAfterRow + 1}:K${insertAfterRow + 1}`;
    await sheetsRequest(
      accessToken,
      `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        body: JSON.stringify({
          values: [[newRowNum, name, size, "", "", "", "", false, false, false, false]],
        }),
      }
    );
  }
}

// ── WRITE: Delete an item row ─────────────────────────────────────────────────
export async function deleteItem(accessToken, sheetRow) {
  const sheetId = await getSheetId(accessToken);
  await sheetsRequest(
    accessToken,
    "/batchUpdate",
    {
      method: "POST",
      body: JSON.stringify({
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: sheetRow - 1,   // 0-based
              endIndex:   sheetRow,
            },
          },
        }],
      }),
    }
  );
}

// ── Helper: get the numeric sheetId for "Weekly Prices" tab ──────────────────
let _cachedSheetId = null;
async function getSheetId(accessToken) {
  if (_cachedSheetId != null) return _cachedSheetId;
  const data = await sheetsRequest(accessToken, "");
  const sheet = data.sheets?.find(s => s.properties.title === SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found`);
  _cachedSheetId = sheet.properties.sheetId;
  return _cachedSheetId;
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
