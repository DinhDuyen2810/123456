// src/crypto/fileEncryption.js
export async function encryptFile(fileBuffer) {
  // Tạo random file key
  const fileKeyBytes = crypto.getRandomValues(new Uint8Array(32)) // 256-bit key
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 96-bit IV

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    fileKeyBytes,
    'AES-GCM',
    false,
    ['encrypt']
  )

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    fileBuffer
  )

  return {
    encryptedFile: new Uint8Array(encryptedBuffer),
    fileKey: arrayBufferToBase64(fileKeyBytes),
    iv: arrayBufferToBase64(iv)
  }
}

export async function decryptFile(encryptedBytes, fileKeyBase64, ivBase64) {
  if (!ivBase64) throw new Error('nonce cannot be null or undefined')

  const iv = base64ToUint8Array(ivBase64)
  const fileKey = base64ToUint8Array(fileKeyBase64)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    fileKey,
    'AES-GCM',
    false,
    ['decrypt']
  )

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encryptedBytes
  )

  return new Uint8Array(decryptedBuffer)
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
