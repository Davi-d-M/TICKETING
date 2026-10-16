import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash
} from 'node:crypto';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const totpPeriodSeconds = 30;

function encryptionKey() {
  const configured = process.env.TICKETING_MFA_ENCRYPTION_KEY?.trim();
  if (!configured || configured.length < 32) {
    throw new Error('TICKETING_MFA_ENCRYPTION_KEY must contain at least 32 characters.');
  }
  return createHash('sha256').update(configured).digest();
}

export function createTotpSecret() {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let encoded = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) encoded += base32Alphabet[(value << (5 - bits)) & 31];
  return encoded;
}

export function encryptTotpSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptTotpSecret(value: string) {
  const [ivValue, tagValue, encryptedValue, extra] = value.split('.');
  if (!ivValue || !tagValue || !encryptedValue || extra) throw new Error('The stored authenticator secret is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

function decodeBase32(secret: string) {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '')) {
    const index = base32Alphabet.indexOf(character);
    if (index < 0) throw new Error('The authenticator secret is invalid.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTotp(secret: string, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const currentCounter = Math.floor(now / 1000 / totpPeriodSeconds);
  const candidate = Buffer.from(code);
  for (const counter of [currentCounter - 1, currentCounter, currentCounter + 1]) {
    if (counter < 0) continue;
    const expected = Buffer.from(generateTotp(secret, counter));
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return counter;
  }
  return null;
}

export function createTotpProvisioningUri(email: string, secret: string) {
  const issuer = 'Midnight Society KE Ticketing';
  const label = `${issuer}:${email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${totpPeriodSeconds}`;
}
