import { useState, useEffect, useRef } from "react";

// ── CONFIG — your Apps Script /exec URL ──────────────────────────────────────
const SCRIPT_URL = "/api/macros/s/AKfycbz4ls7nJkJ_P7ddpaaXjA9Mwoox7mKg56zjXE8ZnlJ7xp8PCTb9_EcLVFcBHx3XxuPy/exec";

// ── FALLBACK (WinCo baseline — shown while loading or if Sheet unreachable) ──
const FALLBACK_ITEMS = [
  { category: "Dairy & Eggs", name: "Eggs",                  size: "18 ct",  prices: { winco: 2.92, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Dairy & Eggs", name: "Darigold Butter",       size: "1 lb",   prices: { winco: 8.61, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Dairy & Eggs", name: "Plain Yogurt",          size: "48 oz",  prices: { winco: 5.95, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Dairy & Eggs", name: "Heavy Cream",           size: "32 oz",  prices: { winco: 5.11, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Produce",      name: "Bananas",               size: "1 lb",   prices: { winco: 0.50, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Produce",      name: "Avocado",               size: "each",   prices: { winco: 0.68, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Produce",      name: "Roma Tomatoes",         size: "1 lb",   prices: { winco: 0.92, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Produce",      name: "Potatoes (Bakers)",     size: "1 lb",   prices: { winco: 0.48, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Produce",      name: "Onions, Yellow",        size: "1 lb",   prices: { winco: 0.68, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Produce",      name: "Sweet Mini Peppers",    size: "16 oz",  prices: { winco: 2.98, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Produce",      name: "Spring Mix",            size: "24 oz",  prices: { winco: 3.98, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Pantry",       name: "Green Chili",           size: "4 oz",   prices: { winco: 0.88, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Pantry",       name: "Pillsbury Croissants",  size: "1 tube", prices: { winco: 2.58, fredmeyer: null, safeway: null, yokes: null } },
  { category: "Beverages",    name: "Yellowtail Sauv Blanc", size: "750 ml", prices: { winco: 5.41, fredmeyer: null, safeway: null, yokes: null } },
];

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const CAT_ICONS = { "Dairy & Eggs": "🥚", Produce: "🥬", Pantry: "🧂", Beverages: "🍷" };

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

// ── JSONP loader — injects a <script> tag, bypasses CORS entirely ─────────────
function loadViaJSONP(url, callbackName) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("JSONP timeout after 10s"));
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      const el = document.getElementById(callbackName);
      if (el) el.remove();
    }

    window[callbackName] = (data) => {
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };

    const script = document.createElement("script");
    script.id  = callbackName;
    script.src = `${url}?callback=${callbackName}&_=${Date.now()}`;
    script.onerror = () => { cleanup(); reject(new Error("Script load failed")); };
    document.head.appendChild(script);
  });
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function GroceryTracker() {
  const [items,      setItems]      = useState(FALLBACK_ITEMS);
  const [week,       setWeek]       = useState("—");
  const [lastSync,   setLastSync]   = useState(null);
  const [status,     setStatus]     = useState("loading");
  const [view,       setView]       = useState("tracker");
  const [refreshing, setRefreshing] = useState(false);
  const callbackRef = useRef(0);

  const loadData = async () => {
    setRefreshing(true);
    setStatus("loading");
    const cbName = `groceryCallback_${Date.now()}_${++callbackRef.current}`;
    try {
      const data = await loadViaJSONP(SCRIPT_URL, cbName);
      setItems(data.items || FALLBACK_ITEMS);
      setWeek(data.week  || "—");
      setLastSync(data.lastUpdated ? new Date(data.lastUpdated) : new Date());
      setStatus("live");
    } catch (err) {
      console.warn("JSONP failed:", err.message);
      setItems(FALLBACK_ITEMS);
      setWeek("Cached — update Sheet to refresh");
      setStatus("fallback");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // ── Derived data ─────────────────────────────────────────────────────────
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

  const STATUS_PILL = {
    loading:  { label: "Connecting…",        bg: "#444",     fg: "#aaa" },
    live:     { label: "🟢 Live from Sheet", bg: "#1B6B35", fg: "#fff" },
    fallback: { label: "⚠ Cached — offline", bg: "#92400E", fg: "#fff" },
  };
  const pill = STATUS_PILL[status] || STATUS_PILL.fallback;

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Georgia', serif", background: "#F8F4ED", minHeight: "100vh", maxWidth: 520, margin: "0 auto", paddingBottom: 48 }}>

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
            <button onClick={loadData} disabled={refreshing} style={{
              fontSize: 11, padding: "3px 12px", borderRadius: 20,
              border: "1px solid #444", background: "#222",
              color: refreshing ? "#555" : "#aaa",
              cursor: refreshing ? "default" : "pointer", fontFamily: "inherit",
            }}>
              {refreshing ? "Loading…" : "↻ Refresh"}
            </button>
            {lastSync && (
              <div style={{ fontSize: 9, color: "#555" }}>
                {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>
        </div>

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
      <div style={{ display: "flex", gap: 6, padding: "10px 12px 2px", flexWrap: "wrap" }}>
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
      </div>

      {/* ── TRACKER TAB ── */}
      {view === "tracker" && (
        <div style={{ padding: "10px 12px 0" }}>

          {status === "fallback" && (
            <div style={{ background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 8, padding: "9px 12px", marginBottom: 10, fontSize: 11, color: "#78350F", lineHeight: 1.6 }}>
              <strong>Sheet not reached.</strong> Showing WinCo baseline only. Enter prices in your Google Sheet then tap ↻ Refresh.
            </div>
          )}

          {cats.map(cat => (
            <div key={cat} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#666", borderBottom: "2px solid #DDD5C3", paddingBottom: 5, marginBottom: 8, letterSpacing: 0.5 }}>
                {CAT_ICONS[cat] || "📦"} {cat.toUpperCase()}
              </div>

              {items.filter(i => i.category === cat).map(item => {
                const best     = getBest(item.prices);
                const winco    = item.prices?.winco;
                const hasDeal  = best && winco && best.price < winco;

                return (
                  <div key={item.name} style={{ background: "#FFF", borderRadius: 8, marginBottom: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", overflow: "hidden" }}>
                    <div style={{ padding: "8px 10px 5px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#1A1A1A" }}>{item.name}</div>
                        <div style={{ fontSize: 11, color: "#BBB" }}>{item.size}</div>
                      </div>
                      {hasDeal && (
                        <div style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 12, background: "#D4EDDA", color: "#1B6B35", whiteSpace: "nowrap" }}>
                          Save ${(winco - best.price).toFixed(2)} @ {STORES.find(s => s.key === best.store)?.short}
                        </div>
                      )}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "#EDE8DF" }}>
                      {STORES.map(store => {
                        const price  = item.prices?.[store.key];
                        const isBest = best?.store === store.key && price != null;
                        return (
                          <div key={store.key} style={{ background: isBest ? store.bg : "#FAFAF8", padding: "7px 4px", textAlign: "center" }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: store.color, marginBottom: 2 }}>{store.short}</div>
                            <div style={{ fontSize: 14, fontWeight: isBest ? 700 : 400, color: isBest ? store.color : price != null ? "#333" : "#DDD" }}>
                              {fmt(price)}{isBest ? " ✓" : ""}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          <div style={{ background: "#F0EBE2", borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "#888", lineHeight: 1.7 }}>
            <strong style={{ color: "#555" }}>Workflow:</strong> Update prices in Google Sheet → tap ↻ Refresh. Run <em>Copy To History</em> macro in the Sheet each week to build your price database.
          </div>
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
              No savings found yet.<br />Add competitor prices in your Sheet.
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
