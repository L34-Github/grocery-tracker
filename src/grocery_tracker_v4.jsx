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
  const [editing,   setEditing]   = useState(false);
  const [inputVal,  setInputVal]  = useState("");
  const inputRef = useRef(null);

  const price  = item.prices?.[store.key];
  const onSale = item.onSale?.[store.key];
  const best   = getBest(item.prices);
  const isBest = best?.store === store.key && price != null;

  const startEdit = () => {
    if (!isSignedIn) return;
    setInputVal(price != null ? String(price) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const commitEdit = async () => {
    setEditing(false);
    const parsed = inputVal.trim() === "" ? null : parseFloat(inputVal);
    if (isNaN(parsed) && inputVal.trim() !== "") return; // invalid
    if (parsed === price) return; // no change
    await onSave(item.sheetRow, store.key, parsed);
  };

  const handleKey = (e) => {
    if (e.key === "Enter")  commitEdit();
    if (e.key === "Escape") setEditing(false);
  };

  return (
    <div
      style={{
        background:  isBest ? store.bg : "#FAFAF8",
        padding:     "7px 4px",
        textAlign:   "center",
        cursor:      isSignedIn ? "pointer" : "default",
        position:    "relative",
        minHeight:   52,
      }}
      onClick={!editing ? startEdit : undefined}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: store.color, marginBottom: 2 }}>
        {store.short}
        {isSignedIn && onSale && (
          <span style={{ marginLeft: 3, fontSize: 9 }}>🏷</span>
        )}
      </div>

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
            width: "90%", fontSize: 13, textAlign: "center",
            border: `2px solid ${store.color}`, borderRadius: 4,
            padding: "2px 0", background: "#FFF", outline: "none",
          }}
        />
      ) : (
        <div style={{
          fontSize:   14,
          fontWeight: isBest ? 700 : 400,
          color:      isBest ? store.color : price != null ? "#333" : "#DDD",
        }}>
          {saving ? "…" : fmt(price)}{isBest && !saving ? " ✓" : ""}
        </div>
      )}

      {/* On-sale toggle — only visible when signed in and price exists */}
      {isSignedIn && price != null && !editing && (
        <div
          onClick={e => { e.stopPropagation(); onToggleSale(item.sheetRow, store.key, !onSale); }}
          style={{
            fontSize: 9, marginTop: 2,
            color:    onSale ? store.color : "#CCC",
            fontWeight: 700,
            cursor: "pointer",
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
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      zIndex: 100, display: "flex", alignItems: "flex-end",
    }}>
      <div style={{
        background: "#FFF", width: "100%", maxWidth: 520, margin: "0 auto",
        borderRadius: "16px 16px 0 0", padding: 20,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>➕ Add New Item</div>

        <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>Category</label>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD", fontSize: 14, marginBottom: 12 }}
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{CAT_ICONS[c]} {c}</option>)}
        </select>

        <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>Item Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Cheddar Cheese"
          style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }}
        />

        <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>Size / Unit</label>
        <input
          value={size}
          onChange={e => setSize(e.target.value)}
          placeholder="e.g. 16 oz"
          style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD", fontSize: 14, marginBottom: 20, boxSizing: "border-box" }}
        />

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #DDD", background: "#F5F5F5", fontSize: 14, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={adding || !name.trim() || !size.trim()}
            style={{
              flex: 2, padding: 10, borderRadius: 8, border: "none",
              background: adding ? "#AAA" : "#1B6B35", color: "#FFF",
              fontSize: 14, fontWeight: 700, cursor: adding ? "default" : "pointer",
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
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{ background: "#FFF", borderRadius: 12, padding: 24, maxWidth: 340, width: "100%" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Delete Item?</div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>
          This will permanently remove <strong>{item.name}</strong> from the Google Sheet. This cannot be undone.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #DDD", background: "#F5F5F5", fontSize: 14, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={deleting} style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", background: "#CC2200", color: "#FFF", fontSize: 14, fontWeight: 700, cursor: deleting ? "default" : "pointer" }}>
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

  // Auth state
  const [user,        setUser]        = useState(null);   // { name, email, picture, accessToken }
  const [authLoading, setAuthLoading] = useState(false);
  const [authError,   setAuthError]   = useState(null);
  const [gsiReady,    setGsiReady]    = useState(false);

  // Write state
  const [savingCells, setSavingCells] = useState({});     // { "sheetRow-storeKey": true }
  const [showAddModal,setShowAddModal]= useState(false);
  const [adding,      setAdding]      = useState(false);
  const [deleteTarget,setDeleteTarget]= useState(null);   // item to confirm delete
  const [deleting,    setDeleting]    = useState(false);
  const [toast,       setToast]       = useState(null);   // { msg, type }

  // ── Load GSI script on mount ────────────────────────────────────────────
  useEffect(() => {
    loadGsiScript()
      .then(() => setGsiReady(true))
      .catch(err => setAuthError(err.message));
  }, []);

  // ── Show toast helper ───────────────────────────────────────────────────
  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Load data from Sheets API ───────────────────────────────────────────
  const loadData = useCallback(async (token) => {
    setRefreshing(true);
    setStatus("loading");
    try {
      const data = await getItems(token);
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

  // ── Sign in ─────────────────────────────────────────────────────────────
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

  // ── Sign out ────────────────────────────────────────────────────────────
  const handleSignOut = () => {
    signOut(user?.accessToken);
    setUser(null);
    setItems(FALLBACK_ITEMS);
    setStatus("signed-out");
    setLastSync(null);
  };

  // ── Update price ────────────────────────────────────────────────────────
  const handleSavePrice = async (sheetRow, storeKey, price) => {
    const cellKey = `${sheetRow}-${storeKey}`;
    setSavingCells(s => ({ ...s, [cellKey]: true }));
    try {
      await updatePrice(user.accessToken, sheetRow, storeKey, price);
      // Optimistically update local state
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

  // ── Toggle on-sale ──────────────────────────────────────────────────────
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

  // ── Add item ────────────────────────────────────────────────────────────
  const handleAddItem = async (category, name, size) => {
    setAdding(true);
    try {
      await addItem(user.accessToken, category, name, size);
      await loadData(user.accessToken); // reload to get new sheetRow numbers
      setShowAddModal(false);
      showToast(`"${name}" added to sheet ✓`);
    } catch (err) {
      showToast(`Add failed: ${err.message}`, "err");
    } finally {
      setAdding(false);
    }
  };

  // ── Delete item ─────────────────────────────────────────────────────────
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteItem(user.accessToken, deleteTarget.sheetRow);
      setItems(prev => prev.filter(i => i.sheetRow !== deleteTarget.sheetRow));
      showToast(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, "err");
    } finally {
      setDeleting(false);
    }
  };

  // ── Derived data ────────────────────────────────────────────────────────
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
    "signed-out": { label: "Sign in to edit",      bg: "#444",    fg: "#aaa" },
    loading:      { label: "Loading…",             bg: "#444",    fg: "#aaa" },
    live:         { label: "🟢 Live",              bg: "#1B6B35", fg: "#fff" },
    error:        { label: "⚠ Load error",         bg: "#92400E", fg: "#fff" },
  };
  const pill = STATUS_PILL[status] || STATUS_PILL["signed-out"];

  // ── RENDER ────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Georgia', serif", background: "#F8F4ED", minHeight: "100vh", maxWidth: 520, margin: "0 auto", paddingBottom: 48 }}>

      {/* MODALS */}
      {showAddModal && (
        <AddItemModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddItem}
          adding={adding}
        />
      )}
      {deleteTarget && (
        <DeleteConfirm
          item={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}

      {/* TOAST */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          background: toast.type === "err" ? "#CC2200" : "#1B6B35",
          color: "#FFF", padding: "8px 18px", borderRadius: 20, fontSize: 13,
          fontWeight: 700, zIndex: 200, whiteSpace: "nowrap", boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
        }}>
          {toast.msg}
        </div>
      )}

      {/* HEADER */}
      <div style={{ background: "#1A1A1A", padding: "16px 16px 12px", position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#777", textTransform: "uppercase", marginBottom: 2 }}>
              {week}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#F5F0E8", letterSpacing: -0.5 }}>
              🛒 Price Tracker
            </div>
            <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>99208 · WinCo baseline</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, paddingTop: 2 }}>
            <div style={{ fontSize: 10, padding: "3px 9px", borderRadius: 20, background: pill.bg, color: pill.fg, fontWeight: 700, whiteSpace: "nowrap" }}>
              {pill.label}
            </div>

            {isSignedIn ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {user.picture && (
                  <img src={user.picture} alt="" style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid #444" }} />
                )}
                <button onClick={handleSignOut} style={{
                  fontSize: 11, padding: "3px 10px", borderRadius: 20,
                  border: "1px solid #444", background: "#222", color: "#aaa",
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={handleSignIn}
                disabled={authLoading || !gsiReady}
                style={{
                  fontSize: 11, padding: "4px 12px", borderRadius: 20,
                  border: "none", background: authLoading ? "#333" : "#4285F4",
                  color: authLoading ? "#555" : "#FFF",
                  cursor: authLoading ? "default" : "pointer",
                  fontFamily: "inherit", fontWeight: 700,
                }}
              >
                {authLoading ? "Signing in…" : "Sign in with Google"}
              </button>
            )}

            {isSignedIn && (
              <button onClick={() => loadData(user.accessToken)} disabled={refreshing} style={{
                fontSize: 11, padding: "3px 12px", borderRadius: 20,
                border: "1px solid #444", background: "#222",
                color: refreshing ? "#555" : "#aaa",
                cursor: refreshing ? "default" : "pointer", fontFamily: "inherit",
              }}>
                {refreshing ? "Loading…" : "↻ Refresh"}
              </button>
            )}

            {lastSync && (
              <div style={{ fontSize: 9, color: "#555" }}>
                {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>
        </div>

        {authError && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#F87171", background: "#1A0000", padding: "6px 10px", borderRadius: 6 }}>
            {authError}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {[
            { id: "tracker", label: "📋 Price Table" },
            { id: "savings", label: `💰 Savings${savingsItems.length ? ` (${savingsItems.length})` : ""}` },
          ].map(t => (
            <button key={t.id} onClick={() => setView(t.id)} style={{
              flex: 1, padding: "7px 0", border: "none", borderRadius: 5,
              background: view === t.id ? "#F5F0E8" : "#2A2A2A",
              color:      view === t.id ? "#1A1A1A" : "#777",
              fontFamily: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* AD QUICK LINKS */}
      <div style={{ display: "flex", gap: 6, padding: "10px 12px 2px", flexWrap: "wrap", alignItems: "center" }}>
        {["fredmeyer", "safeway", "yokes"].map(k => {
          const s = STORES.find(s => s.key === k);
          return (
            <a key={k} href={AD_LINKS[k]} target="_blank" rel="noreferrer" style={{
              fontSize: 10, padding: "3px 9px", borderRadius: 20,
              background: s.bg, color: s.color,
              textDecoration: "none", fontWeight: 700,
              border: `1px solid ${s.color}33`,
            }}>
              📰 {s.short} Ad ↗
            </a>
          );
        })}
        {isSignedIn && (
          <button onClick={() => setShowAddModal(true)} style={{
            marginLeft: "auto", fontSize: 11, padding: "3px 11px", borderRadius: 20,
            border: "none", background: "#1B6B35", color: "#FFF",
            fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>
            ➕ Add Item
          </button>
        )}
      </div>

      {/* ── TRACKER TAB ── */}
      {view === "tracker" && (
        <div style={{ padding: "10px 12px 0" }}>

          {!isSignedIn && (
            <div style={{ background: "#EEF4FF", border: "1px solid #4285F433", borderRadius: 8, padding: "9px 12px", marginBottom: 10, fontSize: 11, color: "#1845A8", lineHeight: 1.6 }}>
              <strong>Read-only mode.</strong> Sign in with Google to edit prices, toggle sales, and add or remove items.
            </div>
          )}

          {isSignedIn && (
            <div style={{ background: "#E8F5EE", border: "1px solid #1B6B3533", borderRadius: 8, padding: "7px 12px", marginBottom: 10, fontSize: 11, color: "#1B6B35", lineHeight: 1.6 }}>
              <strong>Tap any price to edit it.</strong> Tap "sale?" to mark an item on sale. Use ➕ Add Item to add new rows.
            </div>
          )}

          {cats.map(cat => (
            <div key={cat} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#666", borderBottom: "2px solid #DDD5C3", paddingBottom: 5, marginBottom: 8, letterSpacing: 0.5 }}>
                {CAT_ICONS[cat] || "📦"} {cat.toUpperCase()}
              </div>

              {items.filter(i => i.category === cat).map(item => {
                const best    = getBest(item.prices);
                const winco   = item.prices?.winco;
                const hasDeal = best && winco && best.price < winco;

                return (
                  <div key={item.name} style={{ background: "#FFF", borderRadius: 8, marginBottom: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", overflow: "hidden" }}>
                    <div style={{ padding: "8px 10px 5px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#1A1A1A" }}>{item.name}</div>
                        <div style={{ fontSize: 11, color: "#BBB" }}>{item.size}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {hasDeal && (
                          <div style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 12, background: "#D4EDDA", color: "#1B6B35", whiteSpace: "nowrap" }}>
                            Save ${(winco - best.price).toFixed(2)} @ {STORES.find(s => s.key === best.store)?.short}
                          </div>
                        )}
                        {isSignedIn && (
                          <button
                            onClick={() => setDeleteTarget(item)}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#DDD", padding: "0 2px", lineHeight: 1 }}
                            title="Delete item"
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    </div>

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

          {isSignedIn && (
            <div style={{ background: "#F0EBE2", borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "#888", lineHeight: 1.7 }}>
              <strong style={{ color: "#555" }}>Tip:</strong> Prices save instantly to your Google Sheet. Run <em>Copy To History</em> in the Sheet each week to build your price database.
            </div>
          )}
        </div>
      )}

      {/* ── SAVINGS TAB ── */}
      {view === "savings" && (
        <div style={{ padding: "12px 12px 0" }}>
          <div style={{ background: "#1B6B35", color: "#FFF", borderRadius: 10, padding: "14px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 10, opacity: 0.7, letterSpacing: 2, textTransform: "uppercase" }}>Savings vs WinCo</div>
              <div style={{ fontSize: 30, fontWeight: 700, marginTop: 2 }}>${totalSaved.toFixed(2)}</div>
            </div>
            <div style={{ fontSize: 11, opacity: 0.65, textAlign: "right" }}>
              {savingsItems.length} of {items.length}<br />items cheaper<br />elsewhere
            </div>
          </div>

          {savingsItems.length === 0 && (
            <div style={{ textAlign: "center", color: "#AAA", padding: 40, fontSize: 13 }}>
              No savings found yet.<br />{isSignedIn ? "Tap any price cell to enter competitor prices." : "Sign in to add prices."}
            </div>
          )}

          {savingsItems.map(row => {
            const s = STORES.find(s => s.key === row.best?.store);
            return (
              <div key={row.name} style={{ background: "#FFF", borderRadius: 8, marginBottom: 8, padding: "10px 12px", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{row.name}</div>
                  <div style={{ fontSize: 11, color: "#BBB" }}>{row.size}</div>
                  <div style={{ fontSize: 11, marginTop: 3 }}>
                    <span style={{ color: "#AAA" }}>WinCo {fmt(row.prices?.winco)}</span>
                    <span style={{ color: "#DDD" }}> → </span>
                    <span style={{ color: s?.color || "#1B6B35", fontWeight: 700 }}>{s?.label} {fmt(row.best?.price)}</span>
                    {row.onSale?.[row.best?.store] && <span style={{ marginLeft: 4, fontSize: 10 }}>🏷</span>}
                  </div>
                </div>
                <div style={{ background: "#D4EDDA", color: "#1B6B35", fontWeight: 700, padding: "5px 12px", borderRadius: 20, fontSize: 14, whiteSpace: "nowrap" }}>
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
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Best Store This Week</div>
                {Object.entries(byStore).sort((a, b) => b[1].total - a[1].total).map(([k, v]) => {
                  const s = STORES.find(s => s.key === k);
                  return (
                    <div key={k} style={{ background: s?.bg || "#F8F8F8", border: `1px solid ${s?.color || "#CCC"}33`, borderRadius: 8, padding: "10px 14px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 700, color: s?.color, fontSize: 13 }}>{s?.label}</div>
                      <div style={{ fontSize: 12, color: "#666" }}>{v.count} item{v.count !== 1 ? "s" : ""} · save <strong>${v.total.toFixed(2)}</strong></div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <div style={{ marginTop: 14, background: "#F0EBE2", borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "#888" }}>
            Savings vs WinCo baseline. Run the <em>Copy To History</em> macro in your Sheet weekly to track trends over time.
          </div>
        </div>
      )}
    </div>
  );
}
