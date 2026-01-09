import sodium from 'libsodium-wrappers-sumo'

export async function encryptWithKey(data, keyBase64) {
  await sodium.ready

  const key = sodium.from_base64(keyBase64)
  const nonce = sodium.randombytes_buf(
    sodium.crypto_secretbox_NONCEBYTES
  )

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
  await sodium.ready

  const key = sodium.from_base64(keyBase64)
  const cipher = sodium.from_base64(encrypted.cipher)
  const nonce = sodium.from_base64(encrypted.nonce)

  const plain = sodium.crypto_secretbox_open_easy(
    cipher,
    nonce,
    key
  )

  if (!plain) {
    throw new Error('Decryption failed')
  }

  return sodium.to_string(plain)
}

export async function encryptFile(fileBuffer) {
  await sodium.ready

  const fileKey = sodium.randombytes_buf(
    sodium.crypto_secretbox_KEYBYTES
  )

  const nonce = sodium.randombytes_buf(
    sodium.crypto_secretbox_NONCEBYTES
  )

  const encryptedFile = sodium.crypto_secretbox_easy(
    new Uint8Array(fileBuffer),
    nonce,
    fileKey
  )

  return {
    encryptedFile,
    fileKey,
    nonce
  }
}