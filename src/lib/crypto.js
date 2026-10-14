const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// 256 bits from the platform CSPRNG.
export const randomToken = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256Hex(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}
