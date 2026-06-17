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
  localStorage.setItem(TOKEN_KEY, token);
}
function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// Authorization header for authenticated requests (empty when signed out).
export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// Appends the bearer token as a query param for media URLs (<audio>/<img>/
// download links can't send an Authorization header).
export function withToken(url: string): string {
  const t = getToken();
  if (!t) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(t)}`;
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
    if (!res.ok) return null;
    const body = await res.json();
    return (body?.user as User) ?? null;
  } catch {
    return null;
  }
}
