// src/tests/debugTests.js
import { deriveMasterKey } from '../crypto/keyDerivation'
import { generateKeyPair } from '../crypto/keyPair'
import { encryptWithKey, decryptWithKey } from '../crypto/fileEncryption'
import {
  encryptFileKeyForUser,
  decryptFileKeyForUser
} from '../crypto/shareFileKey'
import supabase from '../utils/supabase'

// UUID cố định cho test
const ownerId = '11111111-1111-1111-1111-111111111111'
const userBId = '22222222-2222-2222-2222-222222222222'

// Hàm helper: tạo user nếu chưa có
async function ensureUser(id, localPrefix) {
  let pub = localStorage.getItem(`${localPrefix}-public-key`)
  let priv = localStorage.getItem(`${localPrefix}-private-key`)
  let salt = localStorage.getItem(`${localPrefix}-salt`)

  if (!pub || !priv || !salt) {
    const kp = await generateKeyPair()
    const s = crypto.randomUUID()
    pub = kp.publicKey
    priv = kp.privateKey
    salt = s

    localStorage.setItem(`${localPrefix}-public-key`, pub)
    localStorage.setItem(`${localPrefix}-private-key`, priv)
    localStorage.setItem(`${localPrefix}-salt`, salt)

    const { error } = await supabase.from('users').upsert([
      {
        id,
        public_key: pub,
        encrypted_private_key: priv,
        salt
      }
    ])
    if (error) throw error
  }

  return { pub, priv, salt }
}

// TEST 5 – Upload file + save metadata + ensure user A
export async function test5() {
  console.log('--- TEST 5 START ---')

  // 1️⃣ Ensure user A
  await ensureUser(ownerId, 'userA')

  // 2️⃣ Tạo fileKey + fileId
  const fileKey = crypto.randomUUID()
  const fileId = crypto.randomUUID()
  localStorage.setItem('demo-file-id', fileId)
  localStorage.setItem('demo-file-key', fileKey)
  console.log('Saved fileId:', fileId)
  console.log('Saved fileKey:', fileKey)

  // 3️⃣ Upload file lên Supabase Storage
  const filename = `${fileId}.txt`
  const storagePath = `demo/${filename}`
  const fileContent = new Blob([`Demo file content for ${fileId}`], { type: 'text/plain' })

  const { error: storageError } = await supabase.storage
    .from('encrypted-files')
    .upload(storagePath, fileContent, { upsert: true })

  if (storageError) {
    console.error('❌ Upload file failed:', storageError)
    throw storageError
  }
  console.log('✅ File uploaded to storage at:', storagePath)

  // 4️⃣ Lưu metadata vào bảng files
  const { data, error } = await supabase
    .from('files')
    .upsert([
      {
        file_id: fileId,
        owner_id: ownerId,
        storage_path: storagePath,
        encrypted_file_key_owner: fileKey,
        original_filename: 'demo.txt',
        mime_type: 'text/plain'
      }
    ])
    .select()
    .single()

  if (error) {
    console.error('❌ Save file metadata failed:', error)
    throw error
  }

  console.log('✅ TEST 5 OK, file metadata saved:', data)
}

// TEST 6 – Share key A → B
export async function test6() {
  console.log('--- TEST 6 START ---')

  // 1️⃣ Ensure user B
  const { pub: pubB, priv: privB } = await ensureUser(userBId, 'userB')

  // 2️⃣ File key của A
  const fileKey = localStorage.getItem('demo-file-key')
  if (!fileKey) throw new Error('❌ demo-file-key missing')

  // 3️⃣ Encrypt fileKey cho B
  const encrypted = await encryptFileKeyForUser(fileKey, pubB)

  // 4️⃣ B decrypt
  const decrypted = await decryptFileKeyForUser(encrypted, pubB, privB)

  // 5️⃣ Verify
  console.log('[fileKey]     ', fileKey)
  console.log('[decrypted]   ', decrypted)
  console.log('MATCH:', decrypted === fileKey)

  if (decrypted !== fileKey) throw new Error('❌ TEST 6 FAILED: key mismatch')

  console.log('--- TEST 6 OK ---')
}

// TEST 7 – Encrypt fileKey for B
export async function test7() {
  console.log('--- TEST 7 START ---')

  const fileId = localStorage.getItem('demo-file-id')
  const fileKey = localStorage.getItem('demo-file-key')
  const pubB = localStorage.getItem('userB-public-key')

  if (!fileId || !fileKey || !pubB) {
    throw new Error('Missing data – run test5 & test6 first')
  }

  const encrypted = await encryptFileKeyForUser(fileKey, pubB)
  console.log('Encrypted for B:', encrypted)

  console.log('--- TEST 7 OK ---')
}

// TEST 8 – Save file share
export async function test8() {
  console.log('--- TEST 8 START ---')

  const fileId = localStorage.getItem('demo-file-id')
  const fileKey = localStorage.getItem('demo-file-key')
  const { pub: pubB } = await ensureUser(userBId, 'userB')

  // Encrypt file key cho B
  const encryptedForB = await encryptFileKeyForUser(fileKey, pubB)

  // Lưu vào bảng file_shares
  const { data, error } = await supabase
    .from('file_shares')
    .upsert([
      {
        file_id: fileId,
        shared_with_user_id: userBId,
        encrypted_file_key: encryptedForB
      }
    ])
    .select()
    .single()

  if (error) {
    console.error('❌ TEST 8 SAVE FAILED:', error)
    throw error
  }

  console.log('✅ TEST 8 OK, saved row:', data)
}
