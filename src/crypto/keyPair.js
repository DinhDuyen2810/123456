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
