// src/pages/Login.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import supabase from '../utils/supabase.js'
import { deriveMasterKey } from '../crypto/keyDerivation.js'
import { decryptWithKey } from '../crypto/fileEncryption.js'
import { saveSession } from '../utils/session.js'
import { generateSignKeyPair } from '../crypto/keyPair.js'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleLogin() {
    if (!username || !password) {
      alert('Username and password required')
      return
    }

    setLoading(true)

    try {
      // 1️⃣ Fetch user by username
      const { data: users, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .limit(1)

      if (fetchError) throw fetchError
      if (!users || users.length === 0) {
        alert('User not found')
        setLoading(false)
        return
      }

      const user = users[0]

      // 2️⃣ Derive masterKey từ password + salt
      const { masterKey } = await deriveMasterKey(password, user.salt)

      // 3️⃣ Decrypt privateKey
      const encryptedObj = JSON.parse(user.encrypted_private_key)
      const privateKey = await decryptWithKey(encryptedObj, masterKey)

      // 4️⃣ Decrypt signPrivateKey
      let signPrivateKey = null
      if (user.encrypted_sign_private_key) {
        const encryptedSignObj = JSON.parse(user.encrypted_sign_private_key)
        signPrivateKey = await decryptWithKey(encryptedSignObj, masterKey)
      }
      // 5️⃣ Save session
      saveSession({
        userId: user.id,
        username: user.username,
        privateKey,
        publicKey: user.public_key,
        signPublicKey: user.sign_public_key,
        signPrivateKey
      })

      navigate('/dashboard')
    } catch (err) {
      console.error(err)
      alert('Login failed: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #232526 0%, #414345 100%)' }}>
      <div style={{ background: 'rgba(34, 40, 49, 0.95)', borderRadius: 16, boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)', padding: 36, width: 350, maxWidth: '90vw', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12, color: '#00adb5' }}>🔒</div>
        <h2 style={{ color: '#eeeeee', marginBottom: 24, letterSpacing: 1 }}>Sign In</h2>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 16px',
            marginBottom: 16,
            borderRadius: 8,
            border: '1px solid #393e46',
            background: '#232931',
            color: '#fff',
            fontSize: 16,
            outline: 'none',
            transition: 'border 0.2s',
          }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 16px',
            marginBottom: 16,
            borderRadius: 8,
            border: '1px solid #393e46',
            background: '#232931',
            color: '#fff',
            fontSize: 16,
            outline: 'none',
            transition: 'border 0.2s',
          }}
        />
        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px 0',
            borderRadius: 8,
            border: 'none',
            background: loading ? '#393e46' : '#00adb5',
            color: '#fff',
            fontWeight: 600,
            fontSize: 18,
            marginBottom: 18,
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            transition: 'background 0.2s',
          }}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>
        <p style={{ color: '#aaa', fontSize: 15 }}>
          Don't have an account? <a href="/register" style={{ color: '#00adb5', textDecoration: 'underline' }}>Register here</a>
        </p>
      </div>
    </div>
  )
}
