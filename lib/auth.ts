import crypto from "crypto";

// Signs the shared app password into a session token instead of storing it
// verbatim in the browser's cookie jar -- so a leaked cookie (a stray log
// line, a misconfigured proxy, a browser extension) discloses a token good
// only for this app's session, not the literal password, which the
// freelancer may reuse elsewhere. AUTH_COOKIE_SECRET is optional but
// recommended in production (see README's security notes); without it, a
// fixed app-level pepper is used -- still keeps the cookie from literally
// *being* the password, but loses the extra protection a real
// per-deployment secret adds.
const PEPPER = process.env.AUTH_COOKIE_SECRET || "lead-radar-static-pepper-v1";

export function signSessionToken(appPassword: string): string {
  return crypto.createHmac("sha256", PEPPER).update(appPassword).digest("hex");
}
