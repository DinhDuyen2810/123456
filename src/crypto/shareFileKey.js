import sodium from 'libsodium-wrappers-sumo'

export async function encryptFileKeyForUser(fileKey, userPublicKeyBase64) {
  await sodium.ready

  if (!fileKey) throw new Error('fileKey is missing')
  if (!userPublicKeyBase64) throw new Error('userPublicKeyBase64 is missing')

  // convert fileKey string → Uint8Array
  let fileKeyBytes
  if (typeof fileKey === 'string') {
    // chuyển base64 nếu fileKey đã base64 hoặc string → bytes
    fileKeyBytes = new TextEncoder().encode(fileKey)
  } else if (fileKey instanceof Uint8Array) {
    fileKeyBytes = fileKey
  } else {
    throw new Error('fileKey must be string or Uint8Array')
  }

  const userPublicKey = sodium.from_base64(userPublicKeyBase64)

  const sealed = sodium.crypto_box_seal(fileKeyBytes, userPublicKey)
  return sodium.to_base64(sealed, sodium.base64_variants.URLSAFE_NO_PADDING)
}

export async function decryptFileKeyForUser(sealedBase64Url, userPublicKeyBase64, userPrivateKeyBase64) {
  await sodium.ready
  const sealed = sodium.from_base64(sealedBase64Url, sodium.base64_variants.URLSAFE_NO_PADDING)
  const userPublicKey = sodium.from_base64(userPublicKeyBase64)
  const userPrivateKey = sodium.from_base64(userPrivateKeyBase64)
  const decrypted = sodium.crypto_box_seal_open(sealed, userPublicKey, userPrivateKey)
  if (!decrypted) throw new Error('Decryption failed')
  return new TextDecoder().decode(decrypted) // convert Uint8Array → string
}
