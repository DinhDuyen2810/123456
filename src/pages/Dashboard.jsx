// src/pages/Dashboard.jsx
import { useEffect, useState } from 'react'
import supabase from '../utils/supabase.js'
import { getSession } from '../utils/session.js'
import { encryptFile, decryptFile } from '../crypto/fileEncryption.js'
import { encryptFileKeyForUser, decryptFileKeyForUser } from '../crypto/shareFileKey.js'

export default function Dashboard() {
  const [user, setUser] = useState(null)
  const [folders, setFolders] = useState([])
  const [files, setFiles] = useState([])
  const [currentFolderId, setCurrentFolderId] = useState(null)
  const [uploadFile, setUploadFile] = useState(null)
  const [previewFile, setPreviewFile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load session
  useEffect(() => {
    const session = getSession()
    if (!session) {
      window.location.href = '/'
      return
    }
    setUser(session)
  }, [])

  // Load files and folders
  useEffect(() => {
    if (!user) return
    async function loadData() {
      setLoading(true)
      try {
        const { data: myFolders } = await supabase.from('folders').select('*').eq('owner_id', user.userId)
        const { data: myFiles } = await supabase.from('files').select('*').eq('owner_id', user.userId)
        setFolders(myFolders || [])
        setFiles(myFiles || [])
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [user])

  // Breadcrumb
  const getBreadcrumb = () => {
    const path = []
    let folder = folders.find(f => f.folder_id === currentFolderId)
    while (folder) {
      path.unshift(folder)
      folder = folders.find(f => f.folder_id === folder.parent_id)
    }
    return path
  }

  // Displayed items
  const displayedFolders = folders.filter(f => f.parent_id === currentFolderId)
  const displayedFiles = files.filter(f => f.folder_id === currentFolderId)

  // Upload single file
  const handleUploadFile = async (file, folderId = currentFolderId) => {
    if (!file) return
    try {
      const { encryptedFile, fileKey } = await encryptFile(await file.arrayBuffer())
      const fileId = crypto.randomUUID()
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      const storagePath = `demo/${fileId}_${safeName}`

      // Upload encrypted file
      const { error: uploadError } = await supabase.storage.from('encrypted-files').upload(storagePath, new Blob([encryptedFile]), { upsert: true })
      if (uploadError) throw uploadError

      // Encrypt file key for owner
      const { data: ownerData } = await supabase.from('users').select('public_key').eq('id', user.userId).single()
      const encryptedFileKeyOwner = await encryptFileKeyForUser(fileKey, ownerData.public_key)

      // Insert metadata
      await supabase.from('files').insert([{
        file_id: fileId,
        owner_id: user.userId,
        folder_id: folderId,
        storage_path: storagePath,
        encrypted_file_key_owner: encryptedFileKeyOwner,
        original_filename: file.name,
        mime_type: file.type
      }])

      setFiles(prev => [...prev, { file_id: fileId, original_filename: file.name, folder_id: folderId }])
    } catch (err) {
      console.error(err)
      alert('Upload file failed: ' + err.message)
    }
  }

  // Upload folder recursively
  const handleUploadFolder = async (event) => {
    const filesList = Array.from(event.target.files)
    for (let file of filesList) {
      const pathParts = file.webkitRelativePath.split('/')
      const folderPath = pathParts.slice(0, -1)
      const filename = pathParts[pathParts.length - 1]

      // Create folder chain
      let parentId = currentFolderId
      for (let folderName of folderPath) {
        let { data: existingFolder } = await supabase
          .from('folders')
          .select('*')
          .eq('name', folderName)
          .eq('owner_id', user.userId)
          .eq('parent_id', parentId)
          .limit(1)
          .single()
        if (!existingFolder) {
          const { data: newFolder } = await supabase
            .from('folders')
            .insert([{ name: folderName, owner_id: user.userId, parent_id: parentId }])
            .select()
            .single()
          parentId = newFolder.folder_id
        } else {
          parentId = existingFolder.folder_id
        }
      }
      await handleUploadFile(file, parentId)
    }
  }

  // Open file
  const handleOpen = async (file) => {
    try {
      const { data } = await supabase.storage.from('encrypted-files').download(file.storage_path)
      const buffer = await data.arrayBuffer()
      const decryptedKey = await decryptFileKeyForUser(file.encrypted_file_key_owner, file.owner_id, user.privateKey)
      const decrypted = await decryptFile(buffer, decryptedKey)
      const blob = new Blob([decrypted], { type: file.mime_type })
      const url = URL.createObjectURL(blob)
      setPreviewFile({ url, name: file.original_filename, type: file.mime_type })
    } catch (err) {
      console.error(err)
      alert('Open file failed: ' + err.message)
    }
  }

  // Double click
  const handleDoubleClick = (item) => {
    if (item.folder_id) setCurrentFolderId(item.folder_id)
    else handleOpen(item)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#181818', color: '#e3e3e3' }}>
      {/* Sidebar */}
      <div style={{ width: 256, padding: 16, background: '#28292c', display: 'flex', flexDirection: 'column' }}>
        <h2>Drive</h2>
        <input type="file" onChange={e => handleUploadFile(e.target.files[0])} />
        <input type="file" webkitdirectory="true" directory="" multiple onChange={handleUploadFolder} style={{ marginTop: 8 }} />
        <div style={{ marginTop: 'auto' }}>User: <b>{user?.username}</b></div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column' }}>
        {/* Breadcrumb */}
        <div style={{ marginBottom: 16 }}>
          <button onClick={() => setCurrentFolderId(null)}>Root</button>
          {getBreadcrumb().map(f => (
            <span key={f.folder_id}> / <button onClick={() => setCurrentFolderId(f.folder_id)}>{f.name}</button></span>
          ))}
        </div>

        {/* File/folder list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {displayedFolders.map(f => (
            <div key={f.folder_id} style={{ display: 'grid', gridTemplateColumns: '1fr', padding: 8, cursor: 'pointer', borderBottom: '1px solid #444' }}
              onDoubleClick={() => handleDoubleClick(f)}>
              📁 {f.name}
            </div>
          ))}

          {displayedFiles.map(f => (
            <div key={f.file_id} style={{ display: 'grid', gridTemplateColumns: '1fr', padding: 8, cursor: 'pointer', borderBottom: '1px solid #444' }}
              onDoubleClick={() => handleDoubleClick(f)}>
              📄 {f.original_filename}
            </div>
          ))}
        </div>
      </div>

      {/* Preview popup */}
      {previewFile && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ background: '#2c2c2c', padding: 20, borderRadius: 8 }}>
            <h3>{previewFile.name}</h3>
            {previewFile.type.startsWith('image') && <img src={previewFile.url} style={{ maxWidth: 600, maxHeight: 600 }} />}
            {previewFile.type.startsWith('text') && <iframe src={previewFile.url} style={{ width: 600, height: 400 }} />}
            <button onClick={() => setPreviewFile(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
