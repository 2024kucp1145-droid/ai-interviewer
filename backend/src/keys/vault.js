import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const ALGORITHM = 'aes-256-gcm';
const MASTER_KEY_HEX = process.env.ENCRYPTION_MASTER_KEY || 'e83a9f1b4c7d0e2f5a6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f';
const MASTER_KEY = Buffer.from(MASTER_KEY_HEX, 'hex');

/**
 * Encrypt API key using AES-256-GCM
 * @param {string} plainKey 
 * @returns {string} iv:authTag:encryptedText in hex
 */
export function encryptApiKey(plainKey) {
  if (!plainKey || typeof plainKey !== 'string') {
    throw new Error('Invalid key provided for encryption');
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
  
  let encrypted = cipher.update(plainKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt API key using AES-256-GCM
 * @param {string} encryptedPayload 
 * @returns {string} plainKey
 */
export function decryptApiKey(encryptedPayload) {
  if (!encryptedPayload || !encryptedPayload.includes(':')) {
    throw new Error('Invalid encrypted payload format');
  }
  const [ivHex, authTagHex, encryptedHex] = encryptedPayload.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Mask key to return only last 4 chars
 */
export function maskKey(plainKey) {
  if (!plainKey) return '';
  const trimmed = plainKey.trim();
  const last4 = trimmed.slice(-4);
  return `****...${last4}`;
}
