/**
 * Crypto Utils - AES-256 Encryption for API Keys
 * 
 * Algorithm: AES-256-CBC
 * Key derivation: PBKDF2 with 100k iterations, SHA256
 * Storage format: base64(salt + iv + encrypted)
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;
const DIGEST = 'sha256';

/**
 * Generate a random 32-byte master key
 * @returns {Buffer} 32-byte random key
 */
function generateMasterKey() {
  return crypto.randomBytes(32);
}

/**
 * Derive encryption key from master key using PBKDF2
 * @param {Buffer|string} masterKey - The master key
 * @param {Buffer} salt - Salt for key derivation
 * @returns {Buffer} Derived 32-byte key
 */
function deriveKey(masterKey, salt) {
  const keyBuffer = Buffer.isBuffer(masterKey) ? masterKey : Buffer.from(masterKey, 'hex');
  return crypto.pbkdf2Sync(keyBuffer, salt, ITERATIONS, KEY_LENGTH, DIGEST);
}

/**
 * Encrypt text using AES-256-CBC
 * @param {string} text - Plain text to encrypt
 * @param {Buffer|string} masterKey - Master key for encryption
 * @returns {string} Base64 encoded (salt + iv + encrypted)
 */
function encrypt(text, masterKey) {
  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Derive key from master key
  const key = deriveKey(masterKey, salt);
  
  // Encrypt
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'binary');
  encrypted += cipher.final('binary');
  
  // Combine salt + iv + encrypted and return as base64
  const combined = Buffer.concat([
    salt,
    iv,
    Buffer.from(encrypted, 'binary')
  ]);
  
  return combined.toString('base64');
}

/**
 * Decrypt base64 encoded encrypted data
 * @param {string} encryptedBase64 - Base64 encoded (salt + iv + encrypted)
 * @param {Buffer|string} masterKey - Master key for decryption
 * @returns {string} Decrypted plain text
 */
function decrypt(encryptedBase64, masterKey) {
  // Decode base64
  const combined = Buffer.from(encryptedBase64, 'base64');
  
  // Extract salt, iv, and encrypted data
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH);
  
  // Derive key from master key
  const key = deriveKey(masterKey, salt);
  
  // Decrypt
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Create a verification hash of the master key
 * Used to verify the correct key was provided
 * @param {Buffer|string} masterKey - Master key to hash
 * @returns {string} SHA256 hash in hex
 */
function hashKey(masterKey) {
  const keyBuffer = Buffer.isBuffer(masterKey) ? masterKey : Buffer.from(masterKey, 'hex');
  return crypto.createHash('sha256').update(keyBuffer).digest('hex');
}

/**
 * Convert master key Buffer to hex string for storage
 * @param {Buffer} masterKey - Master key buffer
 * @returns {string} Hex encoded string
 */
function keyToHex(masterKey) {
  return masterKey.toString('hex');
}

/**
 * Convert hex string back to Buffer
 * @param {string} hexString - Hex encoded master key
 * @returns {Buffer} Master key buffer
 */
function hexToKey(hexString) {
  return Buffer.from(hexString, 'hex');
}

module.exports = {
  generateMasterKey,
  encrypt,
  decrypt,
  hashKey,
  keyToHex,
  hexToKey,
  // Export constants for reference
  ALGORITHM,
  IV_LENGTH,
  SALT_LENGTH,
  ITERATIONS
};