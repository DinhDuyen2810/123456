// src/pages/Dashboard.jsx
import { useEffect, useState } from 'react'
import supabase from '../utils/supabase.js'
import { getSession } from '../utils/session.js'
import { encryptFileKeyForUser, decryptFileKeyForUser } from '../crypto/shareFileKey.js'
import { encryptFile, decryptFile } from '../crypto/fileEncryption.js'

export default function Dashboard() {
  const [files, setFiles] = useState([])
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedItems, setSelectedItems] = useState({})
  const [popupShare, setPopupShare] = useState({ visible: false, itemId: null })
  const [shareUsername, setShareUsername] = useState('')
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadFolder, setUploadFolder] = useState(null)
  const [previewFile, setPreviewFile] = useState(null) // Hiển thị file trên app

  const session = getSession()
  if (!session) {
    window.location.href = '/'
    return null
  }
  const { userId, username, privateKey } = session

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        // Files/Folders sở hữu
        const { data: myFiles } = await supabase.from('files').select('*').eq('owner_id', userId)
        const { data: myFolders } = await supabase.from('folders').select('*').eq('owner_id', userId)

        // Files shared với user
        const { data: sharedFiles } = await supabase
          .from('file_shares')
          .select('files(*)')
          .eq('shared_with_user_id', userId)
        const shared = (sharedFiles || []).map(s => ({ ...s.files, shared: true }))

        setFiles([...(myFiles || []), ...shared])
        setFolders(myFolders || [])
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [userId])

  // Toggle checkbox
  function toggleItem(id) {
    setSelectedItems(prev => ({ ...prev, [id]: !prev[id] }))
  }

  // Upload file
  async function handleUploadFile() {
    if (!uploadFile) return
    try {
      const { encryptedFile, fileKey } = await encryptFile(await uploadFile.arrayBuffer())
      const fileId = crypto.randomUUID()
      const safeName = uploadFile.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      const storagePath = `demo/${fileId}_${safeName}`

      // Upload encrypted file
      const { error: uploadError } = await supabase.storage.from('encrypted-files').upload(storagePath, new Blob([encryptedFile]), { upsert: true })
      if (uploadError) throw uploadError

      // Encrypt fileKey for owner
      const { data: ownerData } = await supabase.from('users').select('public_key').eq('id', userId).single()
      const encryptedFileKeyOwner = await encryptFileKeyForUser(fileKey, ownerData.public_key)

      // Insert metadata
      await supabase.from('files').insert([{
        file_id: fileId,
        owner_id: userId,
        storage_path: storagePath,
        encrypted_file_key_owner: encryptedFileKeyOwner,
        original_filename: uploadFile.name,
        mime_type: uploadFile.type
      }])

      setFiles(prev => [...prev, { file_id: fileId, original_filename: uploadFile.name }])
      setUploadFile(null)
    } catch (err) {
      console.error(err)
      alert('Upload file failed: ' + err.message)
    }
  }

  // Upload folder (tương tự, duyệt từng file trong folder)
  async function handleUploadFolder(event) {
    const filesList = Array.from(event.target.files)
    for (let file of filesList) {
      setUploadFile(file)
      await handleUploadFile()
    }
  }

  // Download file
  async function handleDownload(file) {
    try {
      const { data, error } = await supabase.storage.from('encrypted-files').download(file.storage_path)
      if (error) throw error
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = file.original_filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert('Download failed: ' + err.message)
    }
  }

  // Open file in app
  async function handleOpen(file) {
    try {
      const { data } = await supabase.storage.from('encrypted-files').download(file.storage_path)
      const buffer = await data.arrayBuffer()
      const decryptedKey = await decryptFileKeyForUser(file.encrypted_file_key, file.owner_id, privateKey)
      const decrypted = await decryptFile(buffer, decryptedKey)
      const blob = new Blob([decrypted], { type: file.mime_type })
      const url = URL.createObjectURL(blob)
      setPreviewFile({ url, name: file.original_filename, type: file.mime_type })
    } catch (err) {
      console.error(err)
      alert('Open file failed: ' + err.message)
    }
  }

  // Share item
  async function handleShare(itemId) {
    if (!shareUsername.trim()) return alert('Nhập username để share')
    try {
      const { data: targetData } = await supabase.from('users').select('*').eq('username', shareUsername.trim()).limit(1)
      if (!targetData || targetData.length === 0) return alert('Người dùng không tồn tại')
      const targetUser = targetData[0]

      const file = files.find(f => f.file_id === itemId)
      if (!file) return
      const encryptedKey = await encryptFileKeyForUser(file.encrypted_file_key_owner, targetUser.public_key)

      await supabase.from('file_shares').upsert({
        file_id: file.file_id,
        shared_with_user_id: targetUser.id,
        encrypted_file_key: encryptedKey
      })
      alert('Shared successfully!')
      setPopupShare({ visible: false, itemId: null })
      setShareUsername('')
    } catch (err) {
      console.error(err)
      alert('Share failed: ' + err.message)
    }
  }

  const multiSelected = Object.values(selectedItems).some(v => v)

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#181818', color: '#e3e3e3', fontFamily: 'sans-serif' }}>
      {/* Sidebar */}
      <div className="sidebar" style={{ width: 256, padding: 16, background: '#28292c', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 22, marginBottom: 20 }}>Drive</div>
        <input type="file" onChange={e => setUploadFile(e.target.files[0])} />
        <button onClick={handleUploadFile} style={{ margin: '8px 0', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}>Upload file</button>
        <input type="file" webkitdirectory="true" directory="" multiple onChange={handleUploadFolder} />
        <div style={{ marginTop: 'auto', fontSize: 14 }}>Đăng nhập: <b>{username}</b></div>
      </div>

      {/* Main */}
      <div className="main-content" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Multi-action toolbar */}
        {multiSelected && (
          <div style={{ padding: 8, background: '#222', display: 'flex', gap: 8 }}>
            <button style={{ cursor: 'pointer' }} onClick={() => alert('Download multiple')}>⬇ Download</button>
            <button style={{ cursor: 'pointer' }} onClick={() => alert('Share multiple')}>🔗 Share</button>
          </div>
        )}

        {/* File list */}
        <div style={{ flexGrow: 1, overflowY: 'auto' }}>
          {folders.map(folder => (
            <div key={folder.folder_id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: 8, borderBottom: '1px solid #444', alignItems: 'center' }}>
              <input type="checkbox" checked={!!selectedItems[folder.folder_id]} onChange={() => toggleItem(folder.folder_id)} />
              <div>📁 {folder.name}</div>
              <div>{folder.owner_id === userId ? 'Tôi' : 'Người khác'}</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setPopupShare({ visible: true, itemId: folder.folder_id })}>🔗</button>
              </div>
            </div>
          ))}

          {files.map(file => (
            <div key={file.file_id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: 8, borderBottom: '1px solid #444', alignItems: 'center' }}
              onDoubleClick={() => handleOpen(file)}>
              <input type="checkbox" checked={!!selectedItems[file.file_id]} onChange={() => toggleItem(file.file_id)} />
              <div>📄 {file.original_filename} {file.shared && '(shared)'}</div>
              <div>{file.owner_id === userId ? 'Tôi' : 'Người khác'}</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={e => { e.stopPropagation(); handleDownload(file) }}>⬇</button>
                <button onClick={e => { e.stopPropagation(); setPopupShare({ visible: true, itemId: file.file_id }) }}>🔗</button>
              </div>
            </div>
          ))}
        </div>

        {/* Share popup */}
        {popupShare.visible && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#333', padding: 16, borderRadius: 8 }}>
            <input type="text" placeholder="Username to share" value={shareUsername} onChange={e => setShareUsername(e.target.value)} />
            <button onClick={() => handleShare(popupShare.itemId)}>Share</button>
            <button onClick={() => setPopupShare({ visible: false, itemId: null })}>Cancel</button>
          </div>
        )}

        {/* Preview file */}
        {previewFile && (
          <div style={{ position: 'absolute', top: 50, right: 20, background: '#222', padding: 16, borderRadius: 8 }}>
            <div style={{ marginBottom: 8 }}>{previewFile.name}</div>
            {previewFile.type.startsWith('image') && <img src={previewFile.url} style={{ maxWidth: 400, maxHeight: 400 }} />}
            {previewFile.type.startsWith('text') && <iframe src={previewFile.url} style={{ width: 400, height: 400 }} />}
            <button onClick={() => setPreviewFile(null)}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}
