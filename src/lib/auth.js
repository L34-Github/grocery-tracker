// ── auth.js ───────────────────────────────────────────────────────────────────
// Google OAuth 2.0 via Google Identity Services (GSI)
// Restricts write access to authorized email addresses only.
//
// v2 changes:
//   - Saves email hint to localStorage after sign-in
//   - Attempts silent re-auth on page load using stored hint (no popup)
//   - Clears hint on sign-out
//   - Falls back gracefully to manual sign-in if silent attempt fails
// ─────────────────────────────────────────────────────────────────────────────

export const GOOGLE_CLIENT_ID = "865184434385-7hgpsbeksv7sir67ro37ovdlcl1oetgs.apps.googleusercontent.com";

// ── Authorized users ──────────────────────────────────────────────────────────
const AUTHORIZED_EMAILS = [
  "loganp83@gmail.com",     // Logan
  "tyezearian@gmail.com",   // Darling
];

// Scopes needed: read + write Sheets + profile email for auth check
const SCOPES = "https://www.googleapis.com/auth/spreadsheets openid email profile";

// localStorage key for persisting the email hint between sessions
const HINT_KEY = "gt_auth_hint";

// ── Load the Google Identity Services script dynamically ─────────────────────
export function loadGsiScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
}

// ── Fetch user profile and validate email ─────────────────────────────────────
async function fetchAndValidateProfile(accessToken) {
  const res = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) throw new Error(`Failed to fetch user profile (${res.status})`);

  const profile = await res.json();
  const email   = profile.email || profile.emails?.[0]?.value;

  if (!email) throw new Error("Could not retrieve email from Google.");

  if (!AUTHORIZED_EMAILS.includes(email)) {
    throw new Error(`Unauthorized: ${email} is not on the access list.`);
  }

  // Persist email hint for next session's silent re-auth
  try { localStorage.setItem(HINT_KEY, email); } catch (_) {}

  return {
    accessToken,
    email,
    name:    profile.name    || email,
    picture: profile.picture || null,
  };
}

// ── Silent sign-in — no popup, uses stored email hint ────────────────────────
// Returns user object if successful, null if silent auth is not possible.
// Should be called on app load before showing any UI.
export function silentSignIn() {
  return new Promise((resolve) => {
    let hint = "";
    try { hint = localStorage.getItem(HINT_KEY) || ""; } catch (_) {}

    // No hint stored — can't attempt silent auth
    if (!hint) { resolve(null); return; }

    let settled = false;
    const settle = (val) => { if (!settled) { settled = true; resolve(val); } };

    // Timeout: if Google doesn't respond quickly, fall back to manual sign-in
    const timer = setTimeout(() => settle(null), 5000);

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope:     SCOPES,
      hint,                   // tells Google which account to use silently
      callback:  async (tokenResponse) => {
        clearTimeout(timer);
        if (tokenResponse.error) { settle(null); return; }
        try {
          const userData = await fetchAndValidateProfile(tokenResponse.access_token);
          settle(userData);
        } catch (_) {
          settle(null);
        }
      },
    });

    // prompt: "" means "no UI interaction" — fails fast if session is gone
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

// ── Manual sign-in — shows account picker popup ───────────────────────────────
export function signIn() {
  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope:     SCOPES,
      callback:  async (tokenResponse) => {
        if (tokenResponse.error) { reject(new Error(tokenResponse.error)); return; }
        try {
          const userData = await fetchAndValidateProfile(tokenResponse.access_token);
          resolve(userData);
        } catch (err) {
          reject(err);
        }
      },
    });

    tokenClient.requestAccessToken({ prompt: "select_account" });
  });
}

// ── Sign out — revoke token + clear stored hint ───────────────────────────────
export function signOut(accessToken) {
  try { localStorage.removeItem(HINT_KEY); } catch (_) {}
  if (accessToken) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
}
