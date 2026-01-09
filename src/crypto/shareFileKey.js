// src/crypto/shareFileKey.js
import sodium from 'libsodium-wrappers-sumo'

export async function encryptFileKeyForUser(fileKeyBase64, recipientPublicKeyBase64) {
  await sodium.ready
  console.log('[DEBUG] encryptFileKeyForUser params:', { fileKeyBase64, recipientPublicKeyBase64 })
  if (!fileKeyBase64 || !recipientPublicKeyBase64) throw new Error('Missing parameters')

  const fileKeyBytes = base64ToUint8Array(fileKeyBase64)
  const recipientPublicKey = sodium.from_base64(recipientPublicKeyBase64, sodium.base64_variants.URLSAFE_NO_PADDING)
  const sealed = sodium.crypto_box_seal(fileKeyBytes, recipientPublicKey)

  return sodium.to_base64(sealed, sodium.base64_variants.URLSAFE_NO_PADDING)
}

// ✅ SỬA HÀM NÀY
export async function decryptFileKeyForUser({ sealedBase64Url, userPublicKeyBase64, userPrivateKeyBase64 }) {
  await sodium.ready
  console.log('[DEBUG] decryptFileKeyForUser params:', { sealedBase64Url, userPublicKeyBase64, userPrivateKeyBase64 })

  if (!sealedBase64Url || !userPublicKeyBase64 || !userPrivateKeyBase64) {
    throw new Error('Missing parameters for decryption')
  }

  const sealed = sodium.from_base64(sealedBase64Url, sodium.base64_variants.URLSAFE_NO_PADDING)
  const userPublicKey = sodium.from_base64(userPublicKeyBase64, sodium.base64_variants.URLSAFE_NO_PADDING)
  const userPrivateKey = sodium.from_base64(userPrivateKeyBase64, sodium.base64_variants.URLSAFE_NO_PADDING)

  // ✅ ĐÚNG: crypto_box_seal_open chỉ cần 3 tham số
  const decrypted = sodium.crypto_box_seal_open(sealed, userPublicKey, userPrivateKey)
  if (!decrypted) throw new Error('Decryption failed. Check keys.')

  return arrayBufferToBase64(decrypted)
}

// Helpers
function arrayBufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToUint8Array(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}