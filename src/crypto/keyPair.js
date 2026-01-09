import sodium from 'libsodium-wrappers-sumo'

export async function generateKeyPair() {
  await sodium.ready

  const { publicKey, privateKey } = sodium.crypto_box_keypair()

  return {
    publicKey: sodium.to_base64(publicKey),
    privateKey: sodium.to_base64(privateKey)
  }
}
