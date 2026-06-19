import type { Handle } from "@sveltejs/kit";

// Baseline security headers on every response from the SvelteKit server.
// - X-Frame-Options: DENY    → can't be iframed (clickjacking protection)
// - X-Content-Type-Options   → no MIME sniffing
// - Referrer-Policy          → don't leak full URLs to third parties
// - Permissions-Policy       → disable powerful APIs the app doesn't use
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "geolocation=(), camera=(), microphone=(), usb=()"
  );
  return response;
};
