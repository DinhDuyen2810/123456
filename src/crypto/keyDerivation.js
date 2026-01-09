// src/crypto/keyDerivation.js
import { initSodium } from './initSodium.js'

const SALT_BYTES = 16

// Web-optimized Argon2id params
const OPSLIMIT = 2           // số vòng tính toán (thấp cho demo, tăng khi production)
const MEMLIMIT = 64 * 1024 * 1024 // 64MB RAM

/**
 * Derive a symmetric master key from password
 * @param {string} password - User password
 * @param {string|null} saltBase64 - Optional salt, Base64. Nếu null sẽ tạo mới.
 * @returns {Promise<{masterKey: string, salt: string}>} masterKey và salt, Base64
 */
export async function deriveMasterKey(password, saltBase64 = null) {
  const sodium = await initSodium()

  if (!password || password.length === 0) {
    throw new Error('Password is required')
  }

  // Nếu có salt -> dùng lại, nếu null -> tạo mới
  const salt = saltBase64
    ? sodium.from_base64(saltBase64)
    : sodium.randombytes_buf(SALT_BYTES)

  const key = sodium.crypto_pwhash(
    32,                  // length of derived key
    password,
    salt,
    OPSLIMIT,
    MEMLIMIT,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  )

  return {
    masterKey: sodium.to_base64(key),
    salt: sodium.to_base64(salt)
  }
}
