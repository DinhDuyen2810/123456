import { useState } from 'react'
import { deriveMasterKey } from '../crypto/keyDerivation'
import { generateKeyPair } from '../crypto/keyPair'
import { encryptWithKey } from '../crypto/fileEncryption'

export default function Register() {
  const [password, setPassword] = useState('')

  async function handleRegister() {
    console.log('--- REGISTER START ---')

    const { masterKey, salt } = await deriveMasterKey(password)
    const { publicKey, privateKey } = await generateKeyPair()

    const encryptedPrivateKey = await encryptWithKey(
      privateKey,
      masterKey
    )

    localStorage.setItem(
      'demo-user',
      JSON.stringify({
        publicKey,
        encryptedPrivateKey,
        salt
      })
    )

    console.log('REGISTER OK')
  }

  return (
    <div>
      <h2>Register</h2>
      <input
        type="password"
        placeholder="password"
        onChange={(e) => setPassword(e.target.value)}
      />
      <button onClick={handleRegister}>Register</button>
    </div>
  )
}
