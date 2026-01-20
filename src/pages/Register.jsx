// src/pages/Register.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import supabase from '../utils/supabase.js'
import { deriveMasterKey } from '../crypto/keyDerivation.js'
import { generateKeyPair, generateSignKeyPair } from '../crypto/keyPair.js'
import { encryptWithKey } from '../crypto/fileEncryption.js'
import { UserPlus } from 'lucide-react'

export default function Register() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleRegister() {
    if (!username || !password) {
      alert('Username and password required')
      return
    }

    setLoading(true)

    try {
      // 1️⃣ Check username đã tồn tại chưa
      const { data: existingUsers, error: fetchError } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .limit(1)

      if (fetchError) throw fetchError

      if (existingUsers && existingUsers.length > 0) {
        alert('Username already exists')
        setLoading(false)
        return
      }

      // 2️⃣ Tạo masterKey + salt
      const { masterKey, salt } = await deriveMasterKey(password)

      // 3️⃣ Tạo keypair
      const { publicKey, privateKey } = await generateKeyPair()
      // 4️⃣ Tạo cặp khóa ký số
      const { signPublicKey, signPrivateKey } = await generateSignKeyPair()
      // 5️⃣ Encrypt privateKey với masterKey
      const encryptedPrivateKey = await encryptWithKey(privateKey, masterKey)
      // 6️⃣ Encrypt signPrivateKey với masterKey
      const encryptedSignPrivateKey = await encryptWithKey(signPrivateKey, masterKey)

      // 7️⃣ Lưu vào DB
      const { error: insertError } = await supabase.from('users').insert([
        {
          username,
          public_key: publicKey,
          encrypted_private_key: JSON.stringify(encryptedPrivateKey),
          sign_public_key: signPublicKey,
          encrypted_sign_private_key: JSON.stringify(encryptedSignPrivateKey),
          salt
        }
      ])

      if (insertError) throw insertError

      alert('Register success! You can login now.')
      navigate('/')
    } catch (err) {
      console.error(err)
      alert('Register failed: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div style={{ marginBottom: 12, color: 'var(--primary-color)' }}>
          <UserPlus size={48} />
        </div>
        <h2 className="auth-title">Sign Up</h2>
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
          onClick={handleRegister}
          disabled={loading}
          className="auth-btn"
        >
          {loading ? 'Registering...' : 'Register'}
        </button>
        <p className="auth-link">
          Already have an account? <a href="/">Login here</a>
        </p>
      </div>
    </div>
  )
}
