import sodium from 'libsodium-wrappers-sumo'

export async function encryptFileKeyForUser(
  fileKeyBase64Url,
  userPublicKeyBase64
) {
  await sodium.ready

  console.log('================ TEST 7 DEBUG ================')
  console.log('[1] typeof fileKeyBase64Url:', typeof fileKeyBase64Url)
  console.log('[2] fileKeyBase64Url:', fileKeyBase64Url)
  console.log('[3] length fileKeyBase64Url:', fileKeyBase64Url?.length)

  console.log('[4] typeof userPublicKeyBase64:', typeof userPublicKeyBase64)
  console.log('[5] userPublicKeyBase64:', userPublicKeyBase64)
  console.log('[6] length userPublicKeyBase64:', userPublicKeyBase64?.length)

  if (!fileKeyBase64Url) {
    throw new Error('❌ fileKeyBase64Url is missing or empty')
  }
  if (!userPublicKeyBase64) {
    throw new Error('❌ userPublicKeyBase64 is missing or empty')
  }

  let fileKey
  let userPublicKey

  try {
    fileKey = sodium.from_base64(
      fileKeyBase64Url,
      sodium.base64_variants.URLSAFE_NO_PADDING
    )
    console.log('[7] fileKey Uint8Array length:', fileKey.length)
  } catch (e) {
    console.error('❌ from_base64(fileKeyBase64Url) FAILED')
    throw e
  }

  try {
    userPublicKey = sodium.from_base64(
      userPublicKeyBase64,
      sodium.base64_variants.URLSAFE_NO_PADDING
    )
    console.log('[8] userPublicKey Uint8Array length:', userPublicKey.length)
  } catch (e) {
    console.error('❌ from_base64(userPublicKeyBase64) FAILED')
    throw e
  }

  let sealed
  try {
    sealed = sodium.crypto_box_seal(fileKey, userPublicKey)
    console.log('[9] sealed length:', sealed.length)
  } catch (e) {
    console.error('❌ crypto_box_seal FAILED')
    throw e
  }

  const sealedBase64 = sodium.to_base64(
    sealed,
    sodium.base64_variants.URLSAFE_NO_PADDING
  )

  console.log('[10] sealedBase64:', sealedBase64)
  console.log('[11] sealedBase64 length:', sealedBase64.length)
  console.log('=============== TEST 7 DEBUG END ===============')

  return sealedBase64
}

export async function decryptFileKeyForUser(
  sealedBase64Url,
  userPublicKeyBase64,
  userPrivateKeyBase64
) {
  await sodium.ready

  console.log('================ TEST 6 DECRYPT DEBUG ================')
  console.log('[1] typeof sealedBase64Url:', typeof sealedBase64Url)
  console.log('[2] sealedBase64Url:', sealedBase64Url)
  console.log('[3] sealedBase64Url length:', sealedBase64Url?.length)

  console.log('[4] typeof userPublicKeyBase64:', typeof userPublicKeyBase64)
  console.log('[5] userPublicKeyBase64:', userPublicKeyBase64)
  console.log('[6] userPublicKeyBase64 length:', userPublicKeyBase64?.length)

  console.log('[7] typeof userPrivateKeyBase64:', typeof userPrivateKeyBase64)
  console.log('[8] userPrivateKeyBase64:', userPrivateKeyBase64)
  console.log('[9] userPrivateKeyBase64 length:', userPrivateKeyBase64?.length)

  if (!sealedBase64Url) {
    throw new Error('❌ sealedBase64Url is missing')
  }
  if (!userPublicKeyBase64) {
    throw new Error('❌ userPublicKeyBase64 is missing')
  }
  if (!userPrivateKeyBase64) {
    throw new Error('❌ userPrivateKeyBase64 is missing')
  }

  let sealed
  let userPublicKey
  let userPrivateKey

  try {
    sealed = sodium.from_base64(
      sealedBase64Url,
      sodium.base64_variants.URLSAFE_NO_PADDING
    )
    console.log('[10] sealed Uint8Array length:', sealed.length)
  } catch (e) {
    console.error('❌ from_base64(sealedBase64Url) FAILED')
    throw e
  }

  try {
    userPublicKey = sodium.from_base64(
      userPublicKeyBase64,
      sodium.base64_variants.URLSAFE_NO_PADDING
    )
    console.log('[11] userPublicKey Uint8Array length:', userPublicKey.length)
  } catch (e) {
    console.error('❌ from_base64(userPublicKeyBase64) FAILED')
    throw e
  }

  try {
    userPrivateKey = sodium.from_base64(
      userPrivateKeyBase64,
      sodium.base64_variants.URLSAFE_NO_PADDING
    )
    console.log('[12] userPrivateKey Uint8Array length:', userPrivateKey.length)
  } catch (e) {
    console.error('❌ from_base64(userPrivateKeyBase64) FAILED')
    throw e
  }

  let decrypted
  try {
    decrypted = sodium.crypto_box_seal_open(
      sealed,
      userPublicKey,
      userPrivateKey
    )
    console.log('[13] decrypted Uint8Array length:', decrypted.length)
  } catch (e) {
    console.error('❌ crypto_box_seal_open FAILED')
    throw e
  }

  const decryptedBase64 = sodium.to_base64(
    decrypted,
    sodium.base64_variants.URLSAFE_NO_PADDING
  )

  console.log('[14] decryptedBase64:', decryptedBase64)
  console.log('[15] decryptedBase64 length:', decryptedBase64.length)
  console.log('=============== TEST 6 DECRYPT DEBUG END ===============')

  return decryptedBase64
}