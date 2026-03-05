// ── auth.js ───────────────────────────────────────────────────────────────────
// Google OAuth 2.0 via Google Identity Services (GSI)
// Restricts write access to authorized email addresses only.
//
// SETUP: Replace GOOGLE_CLIENT_ID with your OAuth 2.0 Client ID from
//        Google Cloud Console → APIs & Services → Credentials
// ─────────────────────────────────────────────────────────────────────────────

export const GOOGLE_CLIENT_ID = "865184434385-7hgpsbeksv7sir67ro37ovdlcl1oetgs.apps.googleusercontent.com";

// ── Authorized users — add both Google account emails here ───────────────────
const AUTHORIZED_EMAILS = [
  "loganp83@gmail.com",       // Logan
  "tyezearian@gmail.com",   // Darling
];

// Scopes needed: read + write Sheets + profile email for auth check
const SCOPES = "https://www.googleapis.com/auth/spreadsheets openid email profile";

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

// ── Request an access token via the Token Model (popup) ──────────────────────
// Returns: { accessToken, email, name, picture } or throws on failure/unauth
export function signIn() {
  return new Promise((resolve, reject) => {
    // Step 1: get user info via ID token to check email
    const idClient = window.google.accounts.id;

    // Use OAuth2 token client for Sheets access
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: async (tokenResponse) => {
        if (tokenResponse.error) {
          reject(new Error(tokenResponse.error));
          return;
        }

        // Fetch user profile to verify email
        try {
          const res = await fetch(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            { headers: { Authorization: `Bearer ${tokenResponse.access_token}` } }
          );

          if (!res.ok) {
            reject(new Error(`Failed to fetch user profile (${res.status})`));
            return;
          }

          const profile = await res.json();
          console.log("Google profile response:", profile); // debug — remove after confirming

          // email can be in profile.email or profile.emails[0].value depending on scope
          const email = profile.email || profile.emails?.[0]?.value;

          if (!email) {
            reject(new Error("Could not retrieve email from Google. Make sure your Google account has an email address associated."));
            return;
          }

          if (!AUTHORIZED_EMAILS.includes(email)) {
            reject(new Error(`Unauthorized: ${email} is not on the access list. Add it to AUTHORIZED_EMAILS in auth.js.`));
            return;
          }

          resolve({
            accessToken: tokenResponse.access_token,
            email,
            name:    profile.name    || email,
            picture: profile.picture || null,
          });
        } catch (err) {
          reject(err);
        }
      },
    });

    tokenClient.requestAccessToken({ prompt: "select_account" });
  });
}

// ── Sign out — revoke token ───────────────────────────────────────────────────
export function signOut(accessToken) {
  if (accessToken) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
}
