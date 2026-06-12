// convex/lib/razorpay.ts
// Razorpay signature verification — pure Web Crypto so it runs in the
// default Convex runtime and is unit-testable. Two HMAC-SHA256 schemes:
//   - webhook:  HMAC(rawBody)              with the WEBHOOK secret
//   - checkout: HMAC("orderId|paymentId")  with the KEY secret
// Both verify over exact raw bytes — never re-serialize the payload first.

const encoder = new TextEncoder();

export async function hmacSha256Hex(
  secret: string,
  payload: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish hex comparison (length leak is fine — lengths are
 *  public; what matters is not short-circuiting on content). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyRazorpaySignature(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(secret, payload);
  return timingSafeEqualHex(expected, signature.toLowerCase());
}
