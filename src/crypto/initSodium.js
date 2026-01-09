// src/crypto/initSodium.js
import sodium from 'libsodium-wrappers-sumo'

let readyPromise = null

export async function initSodium() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await sodium.ready
      console.log('[crypto] libsodium ready')
      return sodium
    })()
  }
  return readyPromise
}
