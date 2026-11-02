const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function decodeBase58(text) {
  let value = 0n;
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error("base58 character is not in the alphabet");
    }
    value = value * 58n + BigInt(index);
  }
  let hex = value.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  let leadingZeros = 0;
  for (const char of text) {
    if (char === "1") leadingZeros += 1;
    else break;
  }
  return Buffer.concat([Buffer.alloc(leadingZeros), Buffer.from(hex, "hex")]);
}

export function nearEd25519Key(text) {
  const prefix = "ed25519:";
  if (typeof text !== "string" || !text.startsWith(prefix)) {
    throw new Error("expected an ed25519: public key");
  }
  const bytes = decodeBase58(text.slice(prefix.length));
  if (bytes.length !== 32) {
    throw new Error("ed25519 public key is not 32 bytes");
  }
  return bytes;
}
