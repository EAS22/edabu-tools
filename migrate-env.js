/**
 * Migration Script for .env to Encrypted Storage
 * 
 * This script migrates plaintext API keys from .env to encrypted format.
 * 
 * IDempotent: Only runs if .env exists and .env.encrypted doesn't exist.
 * 
 * Creates:
 * - .env.encrypted - Encrypted API keys
 * - .env.backup    - Backup of original .env
 * - .master-key    - Master key for decryption (hex string)
 * 
 * Usage: node migrate-env.js
 */

const fs = require('fs');
const path = require('path');
const { generateMasterKey, encrypt, keyToHex } = require('./crypto-utils');

// File paths
const ENV_FILE = path.join(__dirname, '.env');
const ENV_ENCRYPTED_FILE = path.join(__dirname, '.env.encrypted');
const ENV_BACKUP_FILE = path.join(__dirname, '.env.backup');
const MASTER_KEY_FILE = path.join(__dirname, '.master-key');

// Pattern to match API key variables (ends with _API_KEY)
const API_KEY_PATTERN = /_API_KEY$/;

/**
 * Parse .env file into key-value pairs
 * @param {string} content - Raw .env file content
 * @returns {Object} Parsed key-value pairs
 */
function parseEnvFile(content) {
  const result = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    // Skip empty lines and comments
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    // Parse KEY=VALUE
    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) continue;
    
    const key = trimmed.substring(0, equalIndex).trim();
    const value = trimmed.substring(equalIndex + 1).trim();
    
    // Remove quotes if present
    const cleanValue = value.replace(/^["']|["']$/g, '');
    result[key] = cleanValue;
  }
  
  return result;
}

/**
 * Main migration function
 */
function migrate() {
  console.log('=== .env Migration Script ===\n');
  
  // Step 1: Check if migration is needed
  console.log('[1/6] Checking migration status...');
  
  if (!fs.existsSync(ENV_FILE)) {
    console.log('❌ No .env file found. Nothing to migrate.');
    process.exit(0);
  }
  
  if (fs.existsSync(ENV_ENCRYPTED_FILE)) {
    console.log('✅ Already migrated. .env.encrypted exists.');
    console.log('   If you need to re-run migration, delete .env.encrypted first.');
    process.exit(0);
  }
  
  console.log('   Migration needed. Proceeding...\n');
  
  // Step 2: Read and parse .env file
  console.log('[2/6] Reading .env file...');
  const envContent = fs.readFileSync(ENV_FILE, 'utf8');
  const envVars = parseEnvFile(envContent);
  console.log(`   Found ${Object.keys(envVars).length} environment variables.\n`);
  
  // Step 3: Generate master key
  console.log('[3/6] Generating master key...');
  const masterKey = generateMasterKey();
  const masterKeyHex = keyToHex(masterKey);
  console.log(`   Master key generated (${masterKeyHex.length} characters).\n`);
  
  // Step 4: Encrypt API keys
  console.log('[4/6] Encrypting API keys...');
  const encryptedVars = {};
  const nonKeyVars = {};
  
  for (const [key, value] of Object.entries(envVars)) {
    if (API_KEY_PATTERN.test(key)) {
      // Encrypt API key values
      const encrypted = encrypt(value, masterKey);
      // Rename: OPENROUTER_API_KEY -> ENCRYPTED_OPENROUTER
      const encryptedKey = `ENCRYPTED_${key.replace('_API_KEY', '')}`;
      encryptedVars[encryptedKey] = encrypted;
      console.log(`   ✓ Encrypted: ${key} -> ${encryptedKey}`);
    } else {
      // Keep non-API keys as-is (for reference)
      nonKeyVars[key] = value;
    }
  }
  
  if (Object.keys(encryptedVars).length === 0) {
    console.log('   ⚠️  No API keys found to encrypt.');
    process.exit(0);
  }
  console.log(`   Encrypted ${Object.keys(encryptedVars).length} API keys.\n`);
  
  // Step 5: Write .env.encrypted
  console.log('[5/6] Writing encrypted files...');
  
  const encryptedContent = Object.entries(encryptedVars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  
  fs.writeFileSync(ENV_ENCRYPTED_FILE, encryptedContent, 'utf8');
  console.log(`   ✓ Created: ${ENV_ENCRYPTED_FILE}`);
  
  // Write master key
  fs.writeFileSync(MASTER_KEY_FILE, masterKeyHex, 'utf8');
  console.log(`   ✓ Created: ${MASTER_KEY_FILE}\n`);
  
  // Step 6: Backup original .env
  console.log('[6/6] Creating backup...');
  fs.copyFileSync(ENV_FILE, ENV_BACKUP_FILE);
  console.log(`   ✓ Backup created: ${ENV_BACKUP_FILE}\n`);
  
  // Summary
  console.log('=== Migration Complete ===');
  console.log(`   API keys encrypted: ${Object.keys(encryptedVars).length}`);
  console.log(`   Master key saved:   .master-key`);
  console.log(`   Original backed up:  .env.backup`);
  console.log('\n⚠️  IMPORTANT: Add these to .gitignore:');
  console.log('   - .env.encrypted');
  console.log('   - .master-key');
  console.log('   - .env.backup');
  console.log('\n⚠️  SECURITY: Keep .master-key secure! It\'s required to decrypt your API keys.');
}

// Run migration
migrate();