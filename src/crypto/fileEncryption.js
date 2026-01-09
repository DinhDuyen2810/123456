// src/crypto/fileEncryption.js
import { initSodium } from './initSodium.js'

/**
 * Encrypt a string (e.g. privateKey) with a symmetric key
 * @param {string} data - string to encrypt
 * @param {string} keyBase64 - masterKey Base64
 * @returns {Promise<{cipher: string, nonce: string}>} cipher và nonce Base64
 */
export async function encryptWithKey(data, keyBase64) {
  const sodium = await initSodium()

  const key = sodium.from_base64(keyBase64)
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)

  const cipher = sodium.crypto_secretbox_easy(
    sodium.from_string(data),
    nonce,
    key
  )

  return {
    cipher: sodium.to_base64(cipher),
    nonce: sodium.to_base64(nonce)
  }
}

/**
 * Decrypt a string encrypted with encryptWithKey
 * @param {{cipher: string, nonce: string}} encrypted
 * @param {string} keyBase64 - masterKey Base64
 * @returns {Promise<string>} decrypted string
 */
export async function decryptWithKey(encrypted, keyBase64) {
  const sodium = await initSodium()

  const key = sodium.from_base64(keyBase64)
  const cipher = sodium.from_base64(encrypted.cipher)
  const nonce = sodium.from_base64(encrypted.nonce)

  const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, key)
  if (!plain) throw new Error('Decryption failed')

  return sodium.to_string(plain)
}

/**
 * Encrypt file content with a random fileKey
 * @param {ArrayBuffer|Uint8Array} fileBuffer
 * @returns {Promise<{encryptedFile: Uint8Array, fileKey: Uint8Array, nonce: Uint8Array}>}
 */
export async function encryptFile(fileBuffer) {
  const sodium = await initSodium()

  const fileKey = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES)
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)

  const data = fileBuffer instanceof Uint8Array ? fileBuffer : new Uint8Array(fileBuffer)

  const encryptedFile = sodium.crypto_secretbox_easy(data, nonce, fileKey)

  return {
    encryptedFile,
    fileKey,
    nonce
  }
}

/**
 * Decrypt file content using fileKey
 * @param {Uint8Array} encryptedFile
 * @param {Uint8Array} fileKey
 * @param {Uint8Array} nonce
 * @returns {Promise<Uint8Array>} decrypted content
 */
export async function decryptFile(encryptedFile, fileKey, nonce) {
  const sodium = await initSodium()
  const decrypted = sodium.crypto_secretbox_open_easy(encryptedFile, nonce, fileKey)
  if (!decrypted) throw new Error('File decryption failed')
  return decrypted
}
