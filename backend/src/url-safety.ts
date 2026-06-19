import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// SSRF guard for the link importer. yt-dlp/spotdl will fetch whatever URL we
// hand them, so before spawning we make sure the target isn't an internal /
// private address — otherwise a user could point the importer at the host's own
// network (router admin, other containers, cloud metadata at 169.254.169.254,
// etc.) and use the server as a proxy into the LAN.

// True for addresses that must never be reachable via the importer.
export function isBlockedAddress(ipRaw: string): boolean {
  // Unwrap IPv4-mapped IPv6 (e.g. ::ffff:192.168.0.1).
  const mapped = ipRaw.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  const ip = mapped ? mapped[1] : ipRaw;
  const fam = isIP(ip);
  if (fam === 4) {
    const o = ip.split(".").map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
      return true;
    const [a, b] = o;
    if (a === 0) return true; // "this" network
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 special-use
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (fam === 6) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true; // loopback / unspecified
    if (low.startsWith("fe80")) return true; // link-local
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // unique-local
    return false;
  }
  return true; // not a valid IP literal → block
}

// Throws if `url` is not a safe public http(s) target. Resolves the hostname and
// rejects when ANY resolved address is internal/private.
export async function assertSafeRemoteUrl(url: string): Promise<void> {
  let hostname: string;
  let protocol: string;
  try {
    const u = new URL(url);
    hostname = u.hostname;
    protocol = u.protocol;
  } catch {
    throw new Error("Invalid link");
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("Only http(s) links are allowed");
  }
  const host =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  if (!host) throw new Error("Invalid link");

  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error("That address is not allowed");
    return;
  }
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    throw new Error("That host is not allowed");
  }

  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("Could not resolve that host");
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new Error("That host resolves to a blocked address");
  }
}
