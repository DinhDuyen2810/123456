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
  const [sharedFolders, setSharedFolders] = useState([])
  const [sharedFiles, setSharedFiles] = useState([])
  const [currentFolderId, setCurrentFolderId] = useState(null)
  const [previewFile, setPreviewFile] = useState(null)
  const [selection, setSelection] = useState(new Set())

  // Share modal state
  const [shareModal, setShareModal] = useState({ visible: false, targetId: null, type: null })
  const [shareUsername, setShareUsername] = useState('')

  // Load session
  useEffect(() => {
    const session = getSession()
    if (!session) {
      window.location.href = '/'
      return
    }
    setUser(session)
  }, [])

  // Load folders/files
  useEffect(() => {
    if (!user) return
    async function loadData() {
      try {
        // Own folders/files
        const { data: myFolders } = await supabase.from('folders').select('*').eq('owner_id', user.userId)
        const { data: myFiles } = await supabase.from('files').select('*').eq('owner_id', user.userId)
        setFolders(myFolders || [])
        setFiles(myFiles || [])

        // Shared folders/files
        const { data: sharedFileLinks } = await supabase.from('file_shares').select('file_id').eq('shared_with_user_id', user.userId)
        const { data: sharedFilesData } = await supabase.from('files').select('*').in('file_id', sharedFileLinks.map(f => f.file_id))
        setSharedFiles(sharedFilesData || [])

        const { data: sharedFolderLinks } = await supabase.from('folder_shares').select('folder_id').eq('shared_with_user_id', user.userId)
        const { data: sharedFoldersData } = await supabase.from('folders').select('*').in('folder_id', sharedFolderLinks.map(f => f.folder_id))
        setSharedFolders(sharedFoldersData || [])
      } catch (err) {
        console.error(err)
      }
    }
    loadData()
  }, [user])

  const toggleSelect = (id) => {
    const newSet = new Set(selection)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelection(newSet)
  }

  const getBreadcrumb = () => {
    const path = []
    let folder = [...folders, ...sharedFolders].find(f => f.folder_id === currentFolderId)
    while (folder) {
      path.unshift(folder)
      folder = [...folders, ...sharedFolders].find(f => f.folder_id === folder.parent_id)
    }
    return path
  }

  const handleDoubleClick = async (item) => {
    if (item.folder_id) setCurrentFolderId(item.folder_id)
    else await handleOpen(item)
  }

  const handleOpen = async (file) => {
    try {
      // Download
      const { data, error } = await supabase.storage.from('encrypted-files').download(file.storage_path)
      if (error) throw error

      const buffer = await data.arrayBuffer()
      const encryptedBytes = new Uint8Array(buffer)

      // Lấy publicKey owner
      const { data: ownerData } = await supabase.from('users').select('public_key').eq('id', file.owner_id).single()
      const ownerPublicKey = ownerData.public_key

      // Giải mã fileKey → base64
      const decryptedFileKeyBase64 = await decryptFileKeyForUser(
        file.encrypted_file_key_owner,
        ownerPublicKey,
        user.privateKey
      )

      // Giải mã file thực tế
      const decrypted = await decryptFile(encryptedBytes, decryptedFileKeyBase64, file.iv)

      const blob = new Blob([decrypted], { type: file.mime_type })
      const url = URL.createObjectURL(blob)
      setPreviewFile({ url, name: file.original_filename, type: file.mime_type })
    } catch (err) {
      console.error(err)
      alert('Open file failed: ' + err.message)
    }
  }




  const handleUploadFile = async (event, folderId = currentFolderId) => {
    const file = event.target.files[0]
    if (!file) return
    try {
      const { encryptedFile, fileKey } = await encryptFile(await file.arrayBuffer())
      const fileId = crypto.randomUUID()
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      const storagePath = `demo/${fileId}_${safeName}`

      await supabase.storage.from('encrypted-files').upload(storagePath, new Blob([encryptedFile]), { upsert: true })

      const { data: ownerData } = await supabase.from('users').select('public_key').eq('id', user.userId).single()
      const encryptedFileKeyOwner = await encryptFileKeyForUser(fileKey, ownerData.public_key)

      const { data: newFile } = await supabase.from('files').insert([{
        file_id: fileId,
        owner_id: user.userId,
        folder_id: folderId,
        storage_path: storagePath,
        encrypted_file_key_owner: encryptedFileKeyOwner,
        original_filename: file.name,
        mime_type: file.type
      }]).select().single()

      setFiles(prev => [...prev, newFile])
    } catch (err) {
      console.error(err)
      alert('Upload failed: ' + err.message)
    }
  }

  const handleUploadFolder = async (event) => {
    const filesList = Array.from(event.target.files)
    for (let file of filesList) {
      const pathParts = file.webkitRelativePath.split('/')
      const folderPath = pathParts.slice(0, -1)
      let parentId = currentFolderId

      for (let folderName of folderPath) {
        let query = supabase.from('folders').select('*').eq('name', folderName).eq('owner_id', user.userId).limit(1)
        query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null)
        const { data: existingFolders } = await query
        let existingFolder = existingFolders?.[0]
        if (!existingFolder) {
          const { data: newFolder } = await supabase.from('folders').insert([{ name: folderName, owner_id: user.userId, parent_id: parentId }]).select().single()
          parentId = newFolder.folder_id
          setFolders(prev => [...prev, newFolder])
        } else {
          parentId = existingFolder.folder_id
        }
      }
      await handleUploadFile({ target: { files: [file] } }, parentId)
    }
  }

  // Share modal handlers
  const openShareModal = (id, type) => {
    setShareModal({ visible: true, targetId: id, type })
    setShareUsername('')
  }

  const closeShareModal = () => {
    setShareModal({ visible: false, targetId: null, type: null })
    setShareUsername('')
  }

  const handleShareSubmit = async () => {
    if (!shareUsername) return alert('Enter username to share!')
    try {
      const { data: userToShare } = await supabase
        .from('users')
        .select('*')
        .eq('username', shareUsername)
        .single()

      if (shareModal.type === 'file') {
        await supabase.from('file_shares').insert([{ file_id: shareModal.targetId, shared_with_user_id: userToShare.id }])
      } else if (shareModal.type === 'folder') {
        await supabase.from('folder_shares').insert([{ folder_id: shareModal.targetId, shared_with_user_id: userToShare.id }])
      }

      alert(`Shared with ${shareUsername}`)
      closeShareModal()
    } catch (err) {
      console.error(err)
      alert('Share failed: ' + err.message)
    }
  }

  const displayedFolders = [...folders.filter(f => f.parent_id === currentFolderId), ...sharedFolders.filter(f => f.parent_id === currentFolderId)]
  const displayedFiles = [...files.filter(f => f.folder_id === currentFolderId), ...sharedFiles.filter(f => f.folder_id === currentFolderId)]

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#181818', color: '#e3e3e3' }}>
      {/* Sidebar */}
      <div style={{ width: 256, padding: 16, background: '#28292c', display: 'flex', flexDirection: 'column' }}>
        <h2>Drive</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => document.getElementById('upload-file-input').click()}>Upload File</button>
          <button onClick={() => document.getElementById('upload-folder-input').click()}>Upload Folder</button>
        </div>
        <div style={{ marginTop: 'auto' }}>User: <b>{user?.username}</b></div>

        {/* Hidden inputs */}
        <input
          type="file"
          id="upload-file-input"
          style={{ display: 'none' }}
          onChange={handleUploadFile}
        />
        <input
          type="file"
          id="upload-folder-input"
          style={{ display: 'none' }}
          webkitdirectory="true"
          directory=""
          multiple
          onChange={handleUploadFolder}
        />
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column' }}>
        {/* Breadcrumb + action buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <button onClick={() => setCurrentFolderId(null)}>Root</button>
            {getBreadcrumb().map(f => (
              <span key={f.folder_id}> / <button onClick={() => setCurrentFolderId(f.folder_id)}>{f.name}</button></span>
            ))}
          </div>

          {selection.size > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => alert('Download selected TODO')}>Download</button>
              <button onClick={() => openShareModal(Array.from(selection), 'multiple')}>Share</button>
            </div>
          )}
        </div>

        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 150px 200px 150px', fontWeight: 'bold', borderBottom: '2px solid #555', padding: 8 }}>
          <div></div>
          <div>Name</div>
          <div>Owner</div>
          <div>Created At</div>
          <div>Actions</div>
        </div>

        {/* Files/Folders */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {displayedFolders.map(f => (
            <div key={f.folder_id} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 150px 200px 150px', padding: 8, alignItems: 'center', borderBottom: '1px solid #444', cursor: 'pointer' }} onDoubleClick={() => handleDoubleClick(f)}>
              <input type="checkbox" checked={selection.has(f.folder_id)} readOnly onClick={() => toggleSelect(f.folder_id)} />
              <span>📁 {f.name}</span>
              <span>{f.owner_id === user.userId ? user.username : 'Shared'}</span>
              <span>{f.created_at ? new Date(f.created_at).toLocaleString() : '-'}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ cursor: 'pointer' }} title="Download" onClick={() => alert('Download folder TODO')}>⬇️</span>
                <span style={{ cursor: 'pointer' }} title="Share" onClick={() => openShareModal(f.folder_id, 'folder')}>🔗</span>
              </div>
            </div>
          ))}

          {displayedFiles.map(f => (
            <div key={f.file_id} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 150px 200px 150px', padding: 8, alignItems: 'center', borderBottom: '1px solid #444', cursor: 'pointer' }} onDoubleClick={() => handleDoubleClick(f)}>
              <input type="checkbox" checked={selection.has(f.file_id)} readOnly onClick={() => toggleSelect(f.file_id)} />
              <span>📄 {f.original_filename}</span>
              <span>{f.owner_id === user.userId ? user.username : 'Shared'}</span>
              <span>{f.created_at ? new Date(f.created_at).toLocaleString() : '-'}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ cursor: 'pointer' }} title="Download" onClick={() => handleOpen(f)}>⬇️</span>
                <span style={{ cursor: 'pointer' }} title="Share" onClick={() => openShareModal(f.file_id, 'file')}>🔗</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview */}
      {/* Preview */}
      {previewFile && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.8)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center' 
        }}>
          <div style={{ background: '#2c2c2c', padding: 20, borderRadius: 8, maxWidth: '90%', maxHeight: '90%' }}>
            <h3>{previewFile.name}</h3>

            {/* Xem trước hình ảnh (PNG, JPG, GIF, …) */}
            {previewFile.type.startsWith('image') && (
              <img src={previewFile.url} style={{ maxWidth: '80vw', maxHeight: '80vh' }} />
            )}

            {/* Xem trước văn bản */}
            {previewFile.type.startsWith('text') && (
              <iframe src={previewFile.url} style={{ width: '80vw', height: '60vh', background: '#1a1a1a' }} />
            )}

            {/* Xem trước audio */}
            {previewFile.type.startsWith('audio') && (
              <audio controls style={{ width: '80vw' }}>
                <source src={previewFile.url} type={previewFile.type} />
                Your browser does not support the audio element.
              </audio>
            )}

            {/* Xem trước video */}
            {previewFile.type.startsWith('video') && (
              <video controls style={{ maxWidth: '80vw', maxHeight: '60vh' }}>
                <source src={previewFile.url} type={previewFile.type} />
                Your browser does not support the video element.
              </video>
            )}

            <div style={{ marginTop: 10, textAlign: 'right' }}>
              <button onClick={() => setPreviewFile(null)}>Close</button>
            </div>
          </div>
        </div>
      )}


      {/* Share Modal */}
      {shareModal.visible && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ background: '#2c2c2c', padding: 20, borderRadius: 8, minWidth: 300 }}>
            <h3>Share {shareModal.type}</h3>
            <input
              type="text"
              placeholder="Enter username"
              value={shareUsername}
              onChange={e => setShareUsername(e.target.value)}
              style={{ width: '100%', marginBottom: 10, padding: 4 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={closeShareModal}>Cancel</button>
              <button onClick={handleShareSubmit}>Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
