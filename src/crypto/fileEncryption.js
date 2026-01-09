// src/crypto/fileEncryption.js
import { initSodium } from './initSodium.js'


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


export async function decryptWithKey(encrypted, keyBase64) {
  const sodium = await initSodium()

  const key = sodium.from_base64(keyBase64)
  const cipher = sodium.from_base64(encrypted.cipher)
  const nonce = sodium.from_base64(encrypted.nonce)

  const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, key)
  if (!plain) throw new Error('Decryption failed')

  return sodium.to_string(plain)
}

// src/crypto/fileEncryption.js
export async function encryptFile(fileBuffer) {
  const fileKeyBytes = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
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
    iv: arrayBufferToBase64(iv) // <-- return base64 iv
  }
}


export async function decryptFile(encryptedBytes, fileKeyBase64, ivBase64) {
  if (!ivBase64) {
    console.error('[DECRYPT ERROR] iv is missing');
    throw new Error('IV (nonce) is required for decryption');
  }
  if (!fileKeyBase64) {
    throw new Error('File key is required for decryption');
  }

  try {
    const iv = base64ToUint8Array(ivBase64);
    const fileKey = base64ToUint8Array(fileKeyBase64);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      fileKey,
      'AES-GCM',
      false,
      ['decrypt']
    );

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encryptedBytes
    );

    return new Uint8Array(decryptedBuffer);
  } catch (err) {
    console.error('[DECRYPT ERROR]', err);
    throw new Error('Decryption failed: ' + err.message);
  }
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

