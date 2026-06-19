// Service layer: the user's Subsonic/OpenSubsonic client credential.
import { apiBase } from "$lib/services/apiBase";
import { authHeaders } from "$lib/services/authService";

export interface SubsonicCredential {
  username: string | null;
  password: string | null;
}

export async function getSubsonicCredential(): Promise<SubsonicCredential> {
  const res = await fetch(`${apiBase()}/api/subsonic-credential`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load (${res.status})`);
  return res.json();
}

export async function generateSubsonicCredential(): Promise<SubsonicCredential> {
  const res = await fetch(`${apiBase()}/api/subsonic-credential`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to generate (${res.status})`);
  return res.json();
}
