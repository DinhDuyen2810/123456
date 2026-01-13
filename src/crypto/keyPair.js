/**
 * Generate signing keypair (Ed25519) for user
 * @returns {Promise<{signPublicKey: string, signPrivateKey: string}>} Base64
 */
export async function generateSignKeyPair() {
  const sodium = await initSodium()
  const { publicKey, privateKey } = sodium.crypto_sign_keypair()
  return {
    signPublicKey: sodium.to_base64(publicKey),
    signPrivateKey: sodium.to_base64(privateKey)
  }
}

/**
 * Sign file data (Uint8Array) with signPrivateKey
 * @param {Uint8Array} fileData
 * @param {string} signPrivateKeyBase64
 * @returns {Promise<string>} signature (base64)
 */
export async function signFile(fileData, signPrivateKeyBase64) {
  const sodium = await initSodium()
  const privateKey = sodium.from_base64(signPrivateKeyBase64)
  const signature = sodium.crypto_sign_detached(fileData, privateKey)
  return sodium.to_base64(signature)
}

/**
 * Verify file signature
 * @param {Uint8Array} fileData
 * @param {string} signatureBase64
 * @param {string} signPublicKeyBase64
 * @returns {Promise<boolean>} true nếu hợp lệ
 */
export async function verifyFileSignature(fileData, signatureBase64, signPublicKeyBase64) {
  const sodium = await initSodium()
  const publicKey = sodium.from_base64(signPublicKeyBase64)
  const signature = sodium.from_base64(signatureBase64)
  return sodium.crypto_sign_verify_detached(signature, fileData, publicKey)
}
// src/crypto/keyPair.js
import { initSodium } from './initSodium.js'

/**
 * Generate an asymmetric keypair for a user
 * @returns {Promise<{publicKey: string, privateKey: string}>} Base64
 */
export async function generateKeyPair() {
  const sodium = await initSodium()

  const { publicKey, privateKey } = sodium.crypto_box_keypair()

  return {
    publicKey: sodium.to_base64(publicKey),
    privateKey: sodium.to_base64(privateKey)
  }
}
