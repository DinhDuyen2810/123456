// src/crypto/shareFileKey.js
import sodium from 'libsodium-wrappers-sumo'

export async function encryptFileKeyForUser(fileKeyBase64, recipientPublicKeyBase64) {
  await sodium.ready

  if (!fileKeyBase64 || !recipientPublicKeyBase64) throw new Error('Missing parameters')

  const fileKeyBytes = base64ToUint8Array(fileKeyBase64)
  const recipientPublicKey = sodium.from_base64(recipientPublicKeyBase64, sodium.base64_variants.URLSAFE_NO_PADDING)
  const sealed = sodium.crypto_box_seal(fileKeyBytes, recipientPublicKey)

  return sodium.to_base64(sealed, sodium.base64_variants.URLSAFE_NO_PADDING)
}

export async function decryptFileKeyForUser(sealedBase64Url, senderPublicKeyBase64, userPrivateKeyBase64) {
  await sodium.ready

  if (!sealedBase64Url || !senderPublicKeyBase64 || !userPrivateKeyBase64) throw new Error('Missing parameters')

  const sealed = sodium.from_base64(sealedBase64Url, sodium.base64_variants.URLSAFE_NO_PADDING)
  const senderPublicKey = sodium.from_base64(senderPublicKeyBase64, sodium.base64_variants.URLSAFE_NO_PADDING)
  const userPrivateKey = sodium.from_base64(userPrivateKeyBase64, sodium.base64_variants.URLSAFE_NO_PADDING)

  const decrypted = sodium.crypto_box_seal_open(sealed, senderPublicKey, userPrivateKey)
  if (!decrypted) throw new Error('Decryption failed. Check keys.')

  return arrayBufferToBase64(decrypted) // trả về base64 để decryptFile dùng
}

// Helpers
function arrayBufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToUint8Array(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
