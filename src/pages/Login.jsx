import { useState } from 'react'
import { deriveMasterKey } from '../crypto/keyDerivation'
import { decryptWithKey } from '../crypto/fileEncryption'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const [password, setPassword] = useState('')
  const navigate = useNavigate()

  async function handleLogin() {
    console.log('--- LOGIN START ---')

    const stored = JSON.parse(
      localStorage.getItem('demo-user')
    )

    if (!stored) {
      alert('No user')
      return
    }

    const { encryptedPrivateKey, salt } = stored
    const { masterKey } = await deriveMasterKey(password, salt)

    try {
      const privateKey = await decryptWithKey(
        encryptedPrivateKey,
        masterKey
      )

      // session demo
      sessionStorage.setItem(
        'session',
        JSON.stringify({ privateKey })
      )

      console.log('LOGIN OK')
      navigate('/dashboard')
    } catch {
      alert('Wrong password')
    }
  }

  return (
    <div>
      <h2>Login</h2>
      <input
        type="password"
        placeholder="password"
        onChange={(e) => setPassword(e.target.value)}
      />
      <button onClick={handleLogin}>Login</button>
    </div>
  )
}
