import { useState, useEffect, useRef, useCallback } from "react";
import { loadGsiScript, signIn, signOut, GOOGLE_CLIENT_ID } from "./lib/auth";
import {
  getItems, updatePrice, toggleSale, addItem, deleteItem,
  getWeekLabel, CATEGORIES, CAT_ICONS, SPREADSHEET_ID,
} from "./lib/sheetsApi";

// ── FALLBACK (WinCo baseline — shown when signed out or sheet unreachable) ────
const FALLBACK_ITEMS = [
  { category: "Dairy & Eggs", name: "Eggs",                  size: "18 ct",  prices: { winco: 2.92, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Dairy & Eggs", name: "Darigold Butter",       size: "1 lb",   prices: { winco: 8.61, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Dairy & Eggs", name: "Plain Yogurt",          size: "48 oz",  prices: { winco: 5.95, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Dairy & Eggs", name: "Heavy Cream",           size: "32 oz",  prices: { winco: 5.11, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Produce",      name: "Bananas",               size: "1 lb",   prices: { winco: 0.50, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Produce",      name: "Avocado",               size: "each",   prices: { winco: 0.68, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Produce",      name: "Roma Tomatoes",         size: "1 lb",   prices: { winco: 0.92, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Produce",      name: "Potatoes (Bakers)",     size: "1 lb",   prices: { winco: 0.48, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Produce",      name: "Onions, Yellow",        size: "1 lb",   prices: { winco: 0.68, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Produce",      name: "Sweet Mini Peppers",    size: "16 oz",  prices: { winco: 2.98, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Produce",      name: "Spring Mix",            size: "24 oz",  prices: { winco: 3.98, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Pantry",       name: "Green Chili",           size: "4 oz",   prices: { winco: 0.88, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Pantry",       name: "Pillsbury Croissants",  size: "1 tube", prices: { winco: 2.58, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
  { category: "Beverages",    name: "Yellowtail Sauv Blanc", size: "750 ml", prices: { winco: 5.41, fredmeyer: null, safeway: null, yokes: null }, onSale: {} },
];

const STORES = [
  { key: "winco",     label: "WinCo",      short: "WinCo", color: "#1B6B35", bg: "#E8F5EE" },
  { key: "fredmeyer", label: "Fred Meyer", short: "FM",    color: "#CC2200", bg: "#FDF0EE" },
  { key: "safeway",   label: "Safeway",    short: "SFW",   color: "#AA1111", bg: "#FDF0EE" },
  { key: "yokes",     label: "Yokes",      short: "Yokes", color: "#1845A8", bg: "#EEF1FB" },
];

const AD_LINKS = {
  fredmeyer: "https://www.fredmeyer.com/weeklyad",
  safeway:   "https://www.safeway.com/weeklyad",
  yokes:     "https://www.yokesfreshmarkets.com/weekly-ad/indian-trail",
};

const fmt = (n) => n == null ? "—" : `$${parseFloat(n).toFixed(2)}`;

// Convert Apps Script JSONP item format → component format
// JSONP uses { num, category, name, size, prices } (no sheetRow, no onSale)
// We synthesise sheetRow from position since the Script returns items in sheet order
function parseScriptItems(scriptItems) {
  return (scriptItems || [])
    .filter(i => i.name && i.name.trim() !== "")  // skip blank rows
    .map((item, idx) => ({
      sheetRow: idx + 4,   // approximate — good enough for price edits; reloads after add/delete
      rowNum:   item.num,
      category: item.category || "",
      name:     item.name     || "",
      size:     item.size     || "",
      prices: {
        winco:     item.prices?.winco     ?? null,
        fredmeyer: item.prices?.fredmeyer ?? null,
        safeway:   item.prices?.safeway   ?? null,
        yokes:     item.prices?.yokes     ?? null,
      },
      onSale: { winco: false, fredmeyer: false, safeway: false, yokes: false },
    }));
}

function getBest(prices) {
  let best = null;
  Object.entries(prices).forEach(([store, price]) => {
    if (price != null && (best === null || price < best.price))
      best = { store, price };
  });
  return best;
}

// ── Inline price cell component ───────────────────────────────────────────────
function PriceCell({ item, store, isSignedIn, onSave, onToggleSale, saving }) {
  const [editing,  setEditing]  = useState(false);
  const [inputVal, setInputVal] = useState("");
  const inputRef  = useRef(null);
  // Use a ref so commitEdit always sees the latest price — avoids stale closure bug
  const priceRef  = useRef(null);

  const price  = item.prices?.[store.key];
  const onSale = item.onSale?.[store.key];
  const best   = getBest(item.prices);
  const isBest = best?.store === store.key && price != null;

  // Keep ref in sync with latest price prop
  priceRef.current = price;

  const startEdit = () => {
    if (!isSignedIn) return;
    const current = priceRef.current;
    setInputVal(current != null ? String(current) : "");
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
  };

  const commitEdit = async () => {
    setEditing(false);
    const currentPrice = priceRef.current;
    const raw    = inputVal.trim();
    const parsed = raw === "" ? null : parseFloat(raw);
    if (raw !== "" && isNaN(parsed)) return;          // invalid number — discard
    if (parsed === currentPrice) return;              // no change — skip API call
    await onSave(item.sheetRow, store.key, parsed);
  };

  const handleKey = (e) => {
    if (e.key === "Enter")  commitEdit();
    if (e.key === "Escape") setEditing(false);
  };

  return (
    <div
      style={{
        background: isBest ? store.bg : "#FAFAF8",
        padding:    "5px 3px",           // FIX 4: tighter vertical padding
        textAlign:  "center",
        cursor:     isSignedIn ? "pointer" : "default",
        position:   "relative",
        minHeight:  44,                  // FIX 4: 44px = Apple min touch target
        display:    "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
      onClick={!editing ? startEdit : undefined}
    >
      {/* Store label */}
      <div style={{ fontSize: 9, fontWeight: 700, color: store.color, lineHeight: 1 }}>
        {store.short}
      </div>

      {/* Price input or display */}
      {editing ? (
        <input
          ref={inputRef}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKey}
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          style={{
            width: "88%",
            fontSize: 13,
            textAlign: "center",
            border: `2px solid ${store.color}`,
            borderRadius: 4,
            padding: "2px 0",
            // FIX 1: Dark background with white text — clearly visible
            background: "#1A1A1A",
            color: "#FFFFFF",
            outline: "none",
            fontWeight: 700,
          }}
        />
      ) : (
        <div style={{
          fontSize:   13,
          fontWeight: isBest ? 700 : 400,
          color:      isBest ? store.color : price != null ? "#1A1A1A" : "#BBBBBB",
          lineHeight: 1,
        }}>
          {saving ? "…" : fmt(price)}{isBest && !saving ? " ✓" : ""}
        </div>
      )}

      {/* FIX 2: Sale toggle — now a visible pill, not faint gray text */}
      {isSignedIn && price != null && !editing && (
        <div
          onClick={e => { e.stopPropagation(); onToggleSale(item.sheetRow, store.key, !onSale); }}
          style={{
            fontSize:     8,
            fontWeight:   700,
            padding:      "1px 5px",
            borderRadius: 8,
            cursor:       "pointer",
            lineHeight:   1.4,
            // ON SALE: colored bg + white text — clearly visible
            // not on sale: dark border + store-colored text — still visible but subdued
            background:   onSale ? store.color : "transparent",
            color:        onSale ? "#FFF" : store.color,
            border:       `1px solid ${onSale ? store.color : store.color + "66"}`,
          }}
        >
          {onSale ? "ON SALE" : "sale?"}
        </div>
      )}
    </div>
  );
}

// ── Add Item Modal ────────────────────────────────────────────────────────────
function AddItemModal({ onClose, onAdd, adding }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [name,     setName]     = useState("");
  const [size,     setSize]     = useState("");

  const handleSubmit = () => {
    if (!name.trim() || !size.trim()) return;
    onAdd(category, name.trim(), size.trim());
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      zIndex: 100, display: "flex", alignItems: "flex-end",
    }}>
      <div style={{
        background: "#1E1E1E", width: "100%", maxWidth: 520, margin: "0 auto",
        borderRadius: "14px 14px 0 0", padding: "16px 16px 24px",
        border: "1px solid #333",
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#F5F0E8" }}>➕ Add New Item</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <div>
            <label style={{ fontSize: 10, color: "#888", display: "block", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              style={{ width: "100%", padding: "7px 8px", borderRadius: 6, border: "1px solid #444", fontSize: 12, background: "#2A2A2A", color: "#F5F0E8" }}
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{CAT_ICONS[c]} {c}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: "#888", display: "block", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Size / Unit</label>
            <input
              value={size}
              onChange={e => setSize(e.target.value)}
              placeholder="e.g. 16 oz"
              style={{ width: "100%", padding: "7px 8px", borderRadius: 6, border: "1px solid #444", fontSize: 12, background: "#2A2A2A", color: "#F5F0E8", boxSizing: "border-box" }}
            />
          </div>
        </div>

        <label style={{ fontSize: 10, color: "#888", display: "block", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Item Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Cheddar Cheese"
          style={{ width: "100%", padding: "7px 8px", borderRadius: 6, border: "1px solid #444", fontSize: 13, background: "#2A2A2A", color: "#F5F0E8", marginBottom: 12, boxSizing: "border-box" }}
        />

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 9, borderRadius: 7, border: "1px solid #444", background: "#2A2A2A", color: "#aaa", fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={adding || !name.trim() || !size.trim()}
            style={{
              flex: 2, padding: 9, borderRadius: 7, border: "none",
              background: adding ? "#555" : "#1B6B35", color: "#FFF",
              fontSize: 13, fontWeight: 700, cursor: adding ? "default" : "pointer",
            }}
          >
            {adding ? "Adding…" : "Add to Sheet"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirmation ───────────────────────────────────────────────────────
function DeleteConfirm({ item, onConfirm, onCancel, deleting }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{ background: "#1E1E1E", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%", border: "1px solid #333" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: "#F5F0E8" }}>Delete Item?</div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 16, lineHeight: 1.5 }}>
          Permanently removes <strong style={{ color: "#F5F0E8" }}>{item.name}</strong> from the Google Sheet.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: 9, borderRadius: 7, border: "1px solid #444", background: "#2A2A2A", color: "#aaa", fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={deleting} style={{ flex: 1, padding: 9, borderRadius: 7, border: "none", background: "#CC2200", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: deleting ? "default" : "pointer" }}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function GroceryTracker() {
  const [items,       setItems]       = useState(FALLBACK_ITEMS);
  const [week,        setWeek]        = useState(getWeekLabel());
  const [lastSync,    setLastSync]    = useState(null);
  const [status,      setStatus]      = useState("signed-out");
  const [view,        setView]        = useState("tracker");
  const [refreshing,  setRefreshing]  = useState(false);

  const [user,        setUser]        = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError,   setAuthError]   = useState(null);
  const [gsiReady,    setGsiReady]    = useState(false);

  const [savingCells, setSavingCells] = useState({});
  const [showAddModal,setShowAddModal]= useState(false);
  const [adding,      setAdding]      = useState(false);
  const [deleteTarget,setDeleteTarget]= useState(null);
  const [deleting,    setDeleting]    = useState(false);
  const [toast,       setToast]       = useState(null);

  useEffect(() => {
    loadGsiScript()
      .then(() => setGsiReady(true))
      .catch(err => setAuthError(err.message));
  }, []);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = useCallback(async (token) => {
    setRefreshing(true);
    setStatus("loading");
    try {
      const data = await getItems(token);
      if (data.length > 0) {
        console.log("[GT] First item:", JSON.stringify(data[0]));
        console.log("[GT] Items loaded:", data.length);
      } else {
        console.warn("[GT] Sheet returned 0 items");
      }
      setItems(data);
      setLastSync(new Date());
      setStatus("live");
    } catch (err) {
      console.warn("Sheet load failed:", err.message);
      setStatus("error");
      showToast(`Load failed: ${err.message}`, "err");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const userData = await signIn();
      setUser(userData);
      setStatus("loading");
      await loadData(userData.accessToken);
    } catch (err) {
      setAuthError(err.message);
      setStatus("signed-out");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = () => {
    signOut(user?.accessToken);
    setUser(null);
    setItems(FALLBACK_ITEMS);
    setStatus("signed-out");
    setLastSync(null);
  };

  const handleSavePrice = async (sheetRow, storeKey, price) => {
    const cellKey = `${sheetRow}-${storeKey}`;
    setSavingCells(s => ({ ...s, [cellKey]: true }));
    try {
      await updatePrice(user.accessToken, sheetRow, storeKey, price);
      setItems(prev => prev.map(item =>
        item.sheetRow === sheetRow
          ? { ...item, prices: { ...item.prices, [storeKey]: price } }
          : item
      ));
      showToast(`Saved ${storeKey} price`);
    } catch (err) {
      showToast(`Save failed: ${err.message}`, "err");
    } finally {
      setSavingCells(s => { const n = { ...s }; delete n[cellKey]; return n; });
    }
  };

  const handleToggleSale = async (sheetRow, storeKey, isOnSale) => {
    try {
      await toggleSale(user.accessToken, sheetRow, storeKey, isOnSale);
      setItems(prev => prev.map(item =>
        item.sheetRow === sheetRow
          ? { ...item, onSale: { ...item.onSale, [storeKey]: isOnSale } }
          : item
      ));
      showToast(isOnSale ? "Marked on sale 🏷" : "Sale removed");
    } catch (err) {
      showToast(`Toggle failed: ${err.message}`, "err");
    }
  };

  const handleAddItem = async (category, name, size) => {
    setAdding(true);
    try {
      // Apps Script returns fresh item list directly — no second API call needed
      const result = await addItem(user.accessToken, category, name, size);
      if (result.items) {
        setItems(parseScriptItems(result.items));
      } else {
        await loadData(user.accessToken);
      }
      setShowAddModal(false);
      showToast(`"${name}" added ✓`);
    } catch (err) {
      showToast(`Add failed: ${err.message}`, "err");
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Apps Script returns fresh item list directly — no second API call needed
      const result = await deleteItem(user.accessToken, deleteTarget.sheetRow);
      if (result.items) {
        setItems(parseScriptItems(result.items));
      } else {
        await loadData(user.accessToken);
      }
      showToast(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, "err");
    } finally {
      setDeleting(false);
    }
  };

  const savingsItems = items
    .map(item => {
      const best  = getBest(item.prices);
      const winco = item.prices?.winco;
      const saved = best && winco && best.price < winco ? +(winco - best.price).toFixed(2) : 0;
      return { ...item, best, saved };
    })
    .filter(i => i.saved > 0)
    .sort((a, b) => b.saved - a.saved);

  const totalSaved = savingsItems.reduce((s, i) => s + i.saved, 0);
  const cats       = [...new Set(items.map(i => i.category))];
  const isSignedIn = !!user;

  const STATUS_PILL = {
    "signed-out": { label: "Sign in to edit", bg: "#333", fg: "#888" },
    loading:      { label: "Loading…",        bg: "#333", fg: "#888" },
    live:         { label: "🟢 Live",         bg: "#1B6B35", fg: "#fff" },
    error:        { label: "⚠ Error",         bg: "#7A2A00", fg: "#fff" },
  };
  const pill = STATUS_PILL[status] || STATUS_PILL["signed-out"];

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Georgia', serif", background: "#F8F4ED", minHeight: "100vh", maxWidth: 520, margin: "0 auto", paddingBottom: 48 }}>

      {showAddModal && <AddItemModal onClose={() => setShowAddModal(false)} onAdd={handleAddItem} adding={adding} />}
      {deleteTarget && <DeleteConfirm item={deleteTarget} onConfirm={handleDeleteConfirm} onCancel={() => setDeleteTarget(null)} deleting={deleting} />}

      {toast && (
        <div style={{
          position: "fixed", bottom: 72, left: "50%", transform: "translateX(-50%)",
          background: toast.type === "err" ? "#CC2200" : "#1B6B35",
          color: "#FFF", padding: "7px 16px", borderRadius: 20, fontSize: 12,
          fontWeight: 700, zIndex: 200, whiteSpace: "nowrap", boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── COMPACT HEADER (FIX: single-row layout, tighter padding) ────── */}
      <div style={{ background: "#1A1A1A", padding: "10px 12px 0", position: "sticky", top: 0, zIndex: 20 }}>

        {/* Top row: title + auth controls */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#F5F0E8" }}>🛒 Price Tracker</div>
            <div style={{ fontSize: 9, color: "#666" }}>99208</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Status pill */}
            <div style={{ fontSize: 9, padding: "2px 7px", borderRadius: 20, background: pill.bg, color: pill.fg, fontWeight: 700, whiteSpace: "nowrap" }}>
              {pill.label}
            </div>

            {/* Auth button */}
            {isSignedIn ? (
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                {user.picture && (
                  <img src={user.picture} alt="" style={{ width: 20, height: 20, borderRadius: "50%", border: "1px solid #444" }} />
                )}
                <button onClick={handleSignOut} style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 20,
                  border: "1px solid #444", background: "#222", color: "#888",
                  cursor: "pointer", fontFamily: "inherit",
                }}>Out</button>
                <button onClick={() => loadData(user.accessToken)} disabled={refreshing} style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 20,
                  border: "1px solid #444", background: "#222",
                  color: refreshing ? "#555" : "#aaa",
                  cursor: refreshing ? "default" : "pointer", fontFamily: "inherit",
                }}>
                  {refreshing ? "…" : "↻"}
                </button>
              </div>
            ) : (
              <button
                onClick={handleSignIn}
                disabled={authLoading || !gsiReady}
                style={{
                  fontSize: 10, padding: "3px 10px", borderRadius: 20,
                  border: "none", background: authLoading ? "#333" : "#4285F4",
                  color: authLoading ? "#555" : "#FFF",
                  cursor: authLoading ? "default" : "pointer",
                  fontFamily: "inherit", fontWeight: 700,
                }}
              >
                {authLoading ? "Signing in…" : "Sign in"}
              </button>
            )}
          </div>
        </div>

        {/* Week label + last sync */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontSize: 9, letterSpacing: 1.5, color: "#666", textTransform: "uppercase" }}>{week}</div>
          {lastSync && (
            <div style={{ fontSize: 9, color: "#555" }}>
              synced {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>

        {authError && (
          <div style={{ marginBottom: 6, fontSize: 10, color: "#F87171", background: "#1A0000", padding: "5px 8px", borderRadius: 5 }}>
            {authError}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { id: "tracker", label: "📋 Prices" },
            { id: "savings", label: `💰 Savings${savingsItems.length ? ` (${savingsItems.length})` : ""}` },
          ].map(t => (
            <button key={t.id} onClick={() => setView(t.id)} style={{
              flex: 1, padding: "6px 0", border: "none", borderRadius: "5px 5px 0 0",
              background: view === t.id ? "#F8F4ED" : "#2A2A2A",
              color:      view === t.id ? "#1A1A1A" : "#777",
              fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* AD LINKS + ADD ITEM */}
      <div style={{ display: "flex", gap: 5, padding: "8px 12px 4px", flexWrap: "wrap", alignItems: "center", background: "#F0EBE2", borderBottom: "1px solid #DDD5C3" }}>
        {["fredmeyer", "safeway", "yokes"].map(k => {
          const s = STORES.find(s => s.key === k);
          return (
            <a key={k} href={AD_LINKS[k]} target="_blank" rel="noreferrer" style={{
              fontSize: 9, padding: "3px 8px", borderRadius: 20,
              background: "#FFF", color: s.color,
              textDecoration: "none", fontWeight: 700,
              border: `1px solid ${s.color}55`,
            }}>
              📰 {s.short} Ad ↗
            </a>
          );
        })}
        {isSignedIn && (
          <button onClick={() => setShowAddModal(true)} style={{
            marginLeft: "auto", fontSize: 10, padding: "3px 10px", borderRadius: 20,
            border: "none", background: "#1B6B35", color: "#FFF",
            fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>
            ➕ Add
          </button>
        )}
      </div>

      {/* ── TRACKER TAB ── */}
      {view === "tracker" && (
        <div style={{ padding: "8px 10px 0" }}>

          {!isSignedIn && (
            <div style={{ background: "#EEF4FF", border: "1px solid #4285F433", borderRadius: 7, padding: "7px 10px", marginBottom: 8, fontSize: 10, color: "#1845A8", lineHeight: 1.5 }}>
              <strong>Read-only.</strong> Sign in to edit prices & toggle sales.
            </div>
          )}

          {isSignedIn && (
            <div style={{ background: "#E8F5EE", border: "1px solid #1B6B3533", borderRadius: 7, padding: "6px 10px", marginBottom: 8, fontSize: 10, color: "#1B6B35", lineHeight: 1.5 }}>
              <strong>Tap any price to edit.</strong> Existing price pre-filled — just type to replace. Tap sale pill to toggle.
            </div>
          )}

          {cats.map(cat => (
            <div key={cat} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#888", borderBottom: "1px solid #DDD5C3", paddingBottom: 3, marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>
                {CAT_ICONS[cat] || "📦"} {cat}
              </div>

              {items.filter(i => i.category === cat).map(item => {
                const best    = getBest(item.prices);
                const winco   = item.prices?.winco;
                const hasDeal = best && winco && best.price < winco;

                return (
                  <div key={item.rowNum ?? item.name} style={{ background: "#FFF", borderRadius: 7, marginBottom: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", overflow: "hidden" }}>
                    {/* Item header */}
                    <div style={{ padding: "6px 10px 4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1A1A" }}>{item.name}</span>
                        <span style={{ fontSize: 10, color: "#888", marginLeft: 6 }}>{item.size}</span>
                      </div>
                      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                        {hasDeal && (
                          <div style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10, background: "#D4EDDA", color: "#1B6B35", whiteSpace: "nowrap" }}>
                            −${(winco - best.price).toFixed(2)} @ {STORES.find(s => s.key === best.store)?.short}
                          </div>
                        )}
                        {isSignedIn && (
                          <button
                            onClick={() => setDeleteTarget(item)}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#DDD", padding: "0 1px", lineHeight: 1 }}
                            title="Delete item"
                          >🗑</button>
                        )}
                      </div>
                    </div>

                    {/* Price grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "#EDE8DF" }}>
                      {STORES.map(store => (
                        <PriceCell
                          key={store.key}
                          item={item}
                          store={store}
                          isSignedIn={isSignedIn}
                          onSave={handleSavePrice}
                          onToggleSale={handleToggleSale}
                          saving={!!savingCells[`${item.sheetRow}-${store.key}`]}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ── SAVINGS TAB ── */}
      {view === "savings" && (
        <div style={{ padding: "10px 10px 0" }}>
          <div style={{ background: "#1B6B35", color: "#FFF", borderRadius: 9, padding: "12px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 9, opacity: 0.7, letterSpacing: 2, textTransform: "uppercase" }}>Savings vs WinCo</div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 1 }}>${totalSaved.toFixed(2)}</div>
            </div>
            <div style={{ fontSize: 10, opacity: 0.65, textAlign: "right" }}>
              {savingsItems.length} of {items.length}<br />items cheaper<br />elsewhere
            </div>
          </div>

          {savingsItems.length === 0 && (
            <div style={{ textAlign: "center", color: "#AAA", padding: 32, fontSize: 12 }}>
              No savings found yet.<br />{isSignedIn ? "Tap any price cell to enter competitor prices." : "Sign in to add prices."}
            </div>
          )}

          {savingsItems.map(row => {
            const s = STORES.find(s => s.key === row.best?.store);
            return (
              <div key={row.name} style={{ background: "#FFF", borderRadius: 7, marginBottom: 6, padding: "9px 11px", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{row.name}</div>
                  <div style={{ fontSize: 10, color: "#888" }}>{row.size}</div>
                  <div style={{ fontSize: 10, marginTop: 2 }}>
                    <span style={{ color: "#AAA" }}>WinCo {fmt(row.prices?.winco)}</span>
                    <span style={{ color: "#DDD" }}> → </span>
                    <span style={{ color: s?.color || "#1B6B35", fontWeight: 700 }}>{s?.label} {fmt(row.best?.price)}</span>
                    {row.onSale?.[row.best?.store] && <span style={{ marginLeft: 3, fontSize: 9 }}>🏷 SALE</span>}
                  </div>
                </div>
                <div style={{ background: "#D4EDDA", color: "#1B6B35", fontWeight: 700, padding: "4px 10px", borderRadius: 18, fontSize: 13, whiteSpace: "nowrap" }}>
                  −${row.saved.toFixed(2)}
                </div>
              </div>
            );
          })}

          {savingsItems.length > 0 && (() => {
            const byStore = {};
            savingsItems.forEach(r => {
              const k = r.best?.store;
              if (!k) return;
              if (!byStore[k]) byStore[k] = { count: 0, total: 0 };
              byStore[k].count++;
              byStore[k].total += r.saved;
            });
            return (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#999", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Best Store This Week</div>
                {Object.entries(byStore).sort((a, b) => b[1].total - a[1].total).map(([k, v]) => {
                  const s = STORES.find(s => s.key === k);
                  return (
                    <div key={k} style={{ background: s?.bg || "#F8F8F8", border: `1px solid ${s?.color || "#CCC"}33`, borderRadius: 7, padding: "8px 12px", marginBottom: 5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 700, color: s?.color, fontSize: 12 }}>{s?.label}</div>
                      <div style={{ fontSize: 11, color: "#666" }}>{v.count} item{v.count !== 1 ? "s" : ""} · save <strong>${v.total.toFixed(2)}</strong></div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <div style={{ marginTop: 12, background: "#F0EBE2", borderRadius: 7, padding: "8px 10px", fontSize: 10, color: "#888" }}>
            Savings vs WinCo baseline. Run <em>Copy To History</em> in your Sheet weekly to track trends.
          </div>
        </div>
      )}
    </div>
  );
}
