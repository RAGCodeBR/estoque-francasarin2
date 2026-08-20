export async function calculateSha256(bytes: Uint8Array): Promise<string> {
  const copiedBytes = new Uint8Array(bytes.byteLength);
  copiedBytes.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copiedBytes.buffer);

  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}
