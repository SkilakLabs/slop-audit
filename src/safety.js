// Refuse to scan anything that is not a public http(s) host. This tool is pointed
// at strangers' websites; it must never become a way to probe a private network.
import { promises as dns } from "node:dns";
import net from "node:net";

const PRIVATE = [
  /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT and Tailscale
];
const PRIVATE6 = (ip) => ip === "::1" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || /^::ffff:/i.test(ip);

export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error(`Not a URL: ${raw}`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`Only http(s) URLs are scanned: ${raw}`);
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error(`Refusing private host: ${host}`);
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!ips.length) throw new Error(`Cannot resolve host: ${host}`);
  for (const ip of ips) {
    if (PRIVATE.some((re) => re.test(ip)) || PRIVATE6(ip)) throw new Error(`Refusing private address for ${host}: ${ip}`);
  }
  return u;
}

export function normalizeUrl(input) {
  const s = String(input).trim();
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
