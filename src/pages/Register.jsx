// src/pages/Register.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import supabase from '../utils/supabase.js'
import { deriveMasterKey } from '../crypto/keyDerivation.js'
import { generateKeyPair } from '../crypto/keyPair.js'
import { encryptWithKey } from '../crypto/fileEncryption.js'

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

      // 4️⃣ Encrypt privateKey với masterKey
      const encryptedPrivateKey = await encryptWithKey(privateKey, masterKey)

      // 5️⃣ Lưu vào DB
      const { error: insertError } = await supabase.from('users').insert([
        {
          username,
          public_key: publicKey,
          encrypted_private_key: JSON.stringify(encryptedPrivateKey),
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #232526 0%, #414345 100%)' }}>
      <div style={{ background: 'rgba(34, 40, 49, 0.95)', borderRadius: 16, boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)', padding: 36, width: 350, maxWidth: '90vw', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12, color: '#00adb5' }}>📝</div>
        <h2 style={{ color: '#eeeeee', marginBottom: 24, letterSpacing: 1 }}>Sign Up</h2>
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
          onClick={handleRegister}
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
          {loading ? 'Registering...' : 'Register'}
        </button>
        <p style={{ color: '#aaa', fontSize: 15 }}>
          Already have an account? <a href="/" style={{ color: '#00adb5', textDecoration: 'underline' }}>Login here</a>
        </p>
      </div>
    </div>
  )
}
