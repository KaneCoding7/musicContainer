// Service layer: invite codes.
import { apiBase } from "$lib/services/apiBase";
import { authHeaders } from "$lib/services/authService";


export interface Invite {
  code: string;
  createdAt: string;
  used: boolean;
  usedAt: string | null;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message || body?.message || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function fetchInvites(): Promise<Invite[]> {
  const res = await fetch(`${apiBase()}/api/invites`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).invites as Invite[];
}

export async function createInvite(): Promise<Invite> {
  const res = await fetch(`${apiBase()}/api/invites`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).invite as Invite;
}

// Builds the shareable invite link for a code (points at the app's register
// flow with the code prefilled).
export function inviteLink(code: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/?invite=${encodeURIComponent(code)}`;
}
