import sodium from 'libsodium-wrappers-sumo'

export async function encryptFileKeyForUser(fileKey, publicKeyBase64) {
  await sodium.ready

  const publicKey = sodium.from_base64(publicKeyBase64)

  const sealed = sodium.crypto_box_seal(
    fileKey,
    publicKey
  )

  return sodium.to_base64(sealed)
}
