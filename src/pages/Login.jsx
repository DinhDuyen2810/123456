// src/pages/Login.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import supabase from '../utils/supabase.js'
import { deriveMasterKey } from '../crypto/keyDerivation.js'
import { decryptWithKey } from '../crypto/fileEncryption.js'
import { saveSession } from '../utils/session.js'
import { generateSignKeyPair } from '../crypto/keyPair.js'
import { Lock, Key } from 'lucide-react'

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
    <div className="auth-container">
      <div className="auth-card">
        <div style={{ marginBottom: 12, color: 'var(--primary-color)' }}>
          <Lock size={48} />
        </div>
        <h2 className="auth-title">Sign In</h2>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="auth-input"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="auth-input"
        />
        <button
          onClick={handleLogin}
          disabled={loading}
          className="auth-btn"
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>
        <p className="auth-link">
          Don't have an account? <a href="/register">Register here</a>
        </p>
      </div>
    </div>
  )
}
