import { env } from "$env/dynamic/public";

// Resolves the backend API base URL.
//
// When the app is opened on localhost or a private-LAN address (e.g.
// http://192.168.0.215:3000), talk to the backend on the same host at port
// 3001 — so the app works on the local network without depending on the public
// tunnel. Otherwise (public hostname) use the configured PUBLIC_API_BASE_URL.
export function apiBase(): string {
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".local") ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    if (isLocal) return `${protocol}//${hostname}:3001`;
  }
  return env.PUBLIC_API_BASE_URL ?? "http://localhost:3001";
}
