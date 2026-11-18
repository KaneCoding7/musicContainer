// Auth service: talks to Better Auth endpoints and manages the bearer token.
import { apiBase } from "$lib/services/apiBase";

const TOKEN_KEY = "music_token";

export interface User {
  id: string;
  name: string;
  email: string;
}

// --- token storage ---
export function getToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(token: string): void {
  clearMediaToken(); // a media token belongs to one session; never reuse it across sign-ins
  localStorage.setItem(TOKEN_KEY, token);
}
function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  clearMediaToken();
}

// --- scoped media token ---
// <audio>/<img>/download URLs can't carry an Authorization header, so they get a
// short-lived, read-only *media* token (?mt=) instead of the session token. The
// session token must never appear in a URL: URLs are written to proxy/tunnel
// access logs and browser history. The media token only works for media GETs,
// expires (~12 h), and dies with the session.
const MEDIA_KEY = "music_media_token";
const REFRESH_BEFORE_MS = 60 * 60 * 1000; // renew when < 1 h left
let media: { token: string; expiresAt: number } | null = null;
let mediaTimer: ReturnType<typeof setTimeout> | null = null;
let mediaInflight: Promise<void> | null = null;
let mediaGen = 0; // bumped on clear: a late response for an old session is discarded
let mediaRetryMs = 60_000;

function loadMedia(): void {
  if (media || typeof localStorage === "undefined") return;
  try {
    const v = JSON.parse(localStorage.getItem(MEDIA_KEY) ?? "null");
    if (v && typeof v.token === "string" && v.expiresAt > Date.now() + 60_000) media = v;
  } catch {
    /* ignore */
  }
}

function clearMediaToken(): void {
  mediaGen++;
  mediaInflight = null;
  media = null;
  if (mediaTimer) clearTimeout(mediaTimer);
  mediaTimer = null;
  if (typeof localStorage !== "undefined") localStorage.removeItem(MEDIA_KEY);
}

function scheduleMediaRefresh(): void {
  if (mediaTimer) clearTimeout(mediaTimer);
  if (!media || typeof window === "undefined") return;
  const ms = Math.max(60_000, media.expiresAt - Date.now() - REFRESH_BEFORE_MS);
  mediaTimer = setTimeout(() => void refreshMediaToken().catch(() => {}), ms);
}

function retryMediaRefresh(): void {
  if (mediaTimer) clearTimeout(mediaTimer);
  if (typeof window === "undefined" || !getToken()) return;
  const ms = mediaRetryMs;
  mediaRetryMs = Math.min(mediaRetryMs * 2, 15 * 60_000); // back off up to 15 min
  mediaTimer = setTimeout(() => void refreshMediaToken(), ms);
}

// Fetches a fresh media token using the session (Authorization header). Never throws.
export async function refreshMediaToken(): Promise<void> {
  if (!getToken()) {
    clearMediaToken();
    return;
  }
  if (mediaInflight) return mediaInflight;
  const gen = mediaGen;
  let run!: Promise<void>;
  run = (async () => {
    try {
      const res = await fetch(`${apiBase()}/api/media-token`, { headers: authHeaders() });
      if (gen !== mediaGen) return; // signed out / switched user meanwhile
      if (!res.ok) {
        if (res.status === 401) clearMediaToken();
        else retryMediaRefresh();
        return;
      }
      const body = await res.json();
      if (gen !== mediaGen) return;
      if (typeof body?.token === "string" && typeof body?.expiresAt === "number") {
        media = { token: body.token, expiresAt: body.expiresAt };
        localStorage.setItem(MEDIA_KEY, JSON.stringify(media));
        mediaRetryMs = 60_000;
        scheduleMediaRefresh();
      }
    } catch {
      if (gen === mediaGen) retryMediaRefresh(); // network error: try again later
    } finally {
      if (mediaInflight === run) mediaInflight = null;
    }
  })();
  mediaInflight = run;
  return run;
}

// Ensures a usable media token before media URLs are built. Never throws: a media
// token problem must not look like a failed sign-in.
export async function ensureMediaToken(): Promise<void> {
  loadMedia();
  if (media && media.expiresAt - Date.now() > REFRESH_BEFORE_MS) {
    scheduleMediaRefresh();
    return;
  }
  await refreshMediaToken();
}

// Authorization header for authenticated requests (empty when signed out).
export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// Appends the scoped media token (?mt=) to a media URL. Never the session token.
export function withToken(url: string): string {
  loadMedia();
  if (media && media.expiresAt <= Date.now()) {
    media = null; // expired (e.g. after the device slept): fetch a new one in the background
    void refreshMediaToken();
  }
  if (!media) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}mt=${encodeURIComponent(media.token)}`;
}

async function authError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.message || body?.error?.message || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function signUp(
  email: string,
  password: string,
  name: string,
  invite?: string
): Promise<User> {
  // Goes through our gated wrapper so invite codes are enforced/consumed.
  const res = await fetch(`${apiBase()}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name, invite }),
  });
  if (!res.ok) throw new Error(await authError(res));
  const body = await res.json();
  setToken(body.token);
  await ensureMediaToken();
  return body.user as User;
}

export async function signIn(email: string, password: string): Promise<User> {
  const res = await fetch(`${apiBase()}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await authError(res));
  const body = await res.json();
  setToken(body.token);
  await ensureMediaToken();
  return body.user as User;
}

export async function signOut(): Promise<void> {
  try {
    await fetch(`${apiBase()}/api/auth/sign-out`, {
      method: "POST",
      headers: authHeaders(),
    });
  } finally {
    clearToken();
  }
}

// Updates the current user's display name.
export async function updateName(name: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/auth/update-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await authError(res));
}

// Changes the current user's password.
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const res = await fetch(`${apiBase()}/api/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) throw new Error(await authError(res));
}

// Returns the current user if the stored token is valid, else null.
export async function fetchSession(): Promise<User | null> {
  if (!getToken()) return null;
  try {
    const res = await fetch(`${apiBase()}/api/auth/get-session`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      if (res.status === 401) clearMediaToken();
      return null;
    }
    const body = await res.json();
    const user = (body?.user as User) ?? null;
    if (user) await ensureMediaToken();
    return user;
  } catch {
    return null;
  }
}
