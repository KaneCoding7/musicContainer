import { apiBase } from "./apiBase";

// Public server config exposed at GET /api/config. Lets the client reflect
// server-side settings (e.g. whether registration is invite-only) without
// hardcoding them.
export interface ServerConfig {
  inviteOnly: boolean;
}

const DEFAULT_CONFIG: ServerConfig = { inviteOnly: false };

// Fetch the public server config. Falls back to sensible defaults (open
// registration) if the endpoint is unreachable so the UI still renders.
export async function fetchConfig(): Promise<ServerConfig> {
  try {
    const res = await fetch(`${apiBase()}/api/config`);
    if (!res.ok) return DEFAULT_CONFIG;
    const data = await res.json();
    return { inviteOnly: data?.inviteOnly === true };
  } catch {
    return DEFAULT_CONFIG;
  }
}
