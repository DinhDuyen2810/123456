import { initSodium } from './initSodium'

const SALT_BYTES = 16

// Web-optimized Argon2id params
const OPSLIMIT = 2
const MEMLIMIT = 64 * 1024 * 1024 // 64MB

export async function deriveMasterKey(password, saltBase64 = null) {
  const sodium = await initSodium()

  if (!password || password.length === 0) {
    throw new Error('Password is required')
  }

  const salt = saltBase64
    ? sodium.from_base64(saltBase64)
    : sodium.randombytes_buf(SALT_BYTES)

  const key = sodium.crypto_pwhash(
    32,
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
