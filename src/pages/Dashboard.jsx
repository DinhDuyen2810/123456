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

  const [shareModal, setShareModal] = useState({ visible: false, targetId: null, type: null })
  const [shareUsername, setShareUsername] = useState('')

  // Load session
  useEffect(() => {
    const session = getSession()
    if (!session) {
      window.location.href = '/'
      return
    }
    console.log('[DEBUG] Session loaded:', session)
    setUser(session)
  }, [])

  // Load folders/files
  useEffect(() => {
    if (!user) return
    async function loadData() {
      try {
        const { data: myFolders } = await supabase.from('folders').select('*').eq('owner_id', user.userId)
        const { data: myFiles } = await supabase.from('files').select('*').eq('owner_id', user.userId)
        setFolders(myFolders || [])
        setFiles(myFiles || [])

        const { data: sharedFileLinks } = await supabase.from('file_shares').select('file_id').eq('shared_with_user_id', user.userId)
        const { data: sharedFilesData } = await supabase.from('files').select('*').in('file_id', sharedFileLinks.map(f => f.file_id))
        setSharedFiles(sharedFilesData || [])

        const { data: sharedFolderLinks } = await supabase.from('folder_shares').select('folder_id').eq('shared_with_user_id', user.userId)
        const { data: sharedFoldersData } = await supabase.from('folders').select('*').in('folder_id', sharedFolderLinks.map(f => f.folder_id))
        setSharedFolders(sharedFoldersData || [])

        console.log('[DEBUG] Data loaded:', { myFolders, myFiles, sharedFilesData, sharedFoldersData })
      } catch (err) {
        console.error('[ERROR] loadData:', err)
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
      const { data, error } = await supabase.storage.from('encrypted-files').download(file.storage_path)
      if (error) throw error

      const buffer = await data.arrayBuffer()
      const encryptedBytes = new Uint8Array(buffer)

      const { data: ownerData } = await supabase.from('users').select('public_key').eq('id', file.owner_id).single()
      const ownerPublicKey = ownerData.public_key
      console.log('[DEBUG] Opening file:', file.original_filename, { ownerPublicKey, userPrivateKey: user.privateKey })

      const decryptedFileKeyBase64 = await decryptFileKeyForUser({
        sealedBase64Url: file.encrypted_file_key_owner,
        senderPublicKeyBase64: ownerPublicKey,
        userPrivateKeyBase64: user.privateKey
      })
      console.log('[DEBUG] FileKey decrypted:', decryptedFileKeyBase64)

      const decrypted = await decryptFile(encryptedBytes, decryptedFileKeyBase64, file.iv)

      const blob = new Blob([decrypted], { type: file.mime_type })
      const url = URL.createObjectURL(blob)
      setPreviewFile({ url, name: file.original_filename, type: file.mime_type })
    } catch (err) {
      console.error('[ERROR] handleOpen:', err)
      alert('Open file failed: ' + err.message)
    }
  }

  const handleUploadFile = async (event, folderId = currentFolderId) => {
    const file = event.target.files[0]
    if (!file) return
    try {
      const { encryptedFile, fileKey, iv } = await encryptFile(await file.arrayBuffer())
      const fileId = crypto.randomUUID()
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      const storagePath = `demo/${fileId}_${safeName}`

      await supabase.storage.from('encrypted-files').upload(storagePath, new Blob([encryptedFile]), { upsert: true })

      const { data: ownerData } = await supabase.from('users').select('public_key').eq('id', user.userId).single()
      const encryptedFileKeyOwner = await encryptFileKeyForUser(fileKey, ownerData.public_key)
      console.log('[DEBUG] Uploaded fileKey encrypted for owner:', encryptedFileKeyOwner)

      const { data: newFile } = await supabase.from('files').insert([{
        file_id: fileId,
        owner_id: user.userId,
        folder_id: folderId,
        storage_path: storagePath,
        encrypted_file_key_owner: encryptedFileKeyOwner,
        original_filename: file.name,
        mime_type: file.type,
        iv
      }]).select().single()

      setFiles(prev => [...prev, newFile])
      console.log('[DEBUG] New file saved to DB:', newFile)
    } catch (err) {
      console.error('[ERROR] handleUploadFile:', err)
      alert('Upload failed: ' + err.message)
    }
  }

  const handleUploadFolder = async (folderPath, folderName) => {
    try {
      let parentFolderId = null;

      const pathParts = folderPath.split('/').filter(Boolean);

      // 1️⃣ Tạo folder và subfolder nếu chưa tồn tại
      for (let folderNamePart of pathParts) {
        let query = supabase
          .from('folders')
          .select('*')
          .eq('name', folderNamePart)
          .eq('owner_id', user.userId);

        if (parentFolderId === null) query = query.is('parent_id', null);
        else query = query.eq('parent_id', parentFolderId);

        const { data: existingFolder, error: fetchError } = await query.single();

        if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

        if (!existingFolder) {
          const { data: newFolder, error: insertError } = await supabase
            .from('folders')
            .insert([{ name: folderNamePart, parent_id: parentFolderId, owner_id: user.userId }])
            .select()
            .single();

          if (insertError) throw insertError;
          parentFolderId = newFolder.folder_id;

          // ✅ Cập nhật GUI ngay
          setFolders(prev => [...prev, newFolder]);
        } else {
          parentFolderId = existingFolder.folder_id;
        }
      }

      // 2️⃣ Upload tất cả file trong folder
      const filesInFolder = await getAllFilesFromLocalFolder(folderPath); // bạn cần định nghĩa helper này
      for (let file of filesInFolder) {
        const uploadedFile = await uploadFileToSupabase(file, parentFolderId);
        setFiles(prev => [...prev, uploadedFile]); // cập nhật GUI ngay
      }

      alert('Folder uploaded successfully!');
    } catch (err) {
      console.error('[ERROR] handleUploadFolder:', err);
      alert('Upload folder failed: ' + err.message);
    }
  }



  const handleShareFolder = async (folderId, recipientData) => {
    async function getAllFilesInFolder(fid) {
      const { data: filesInFolder } = await supabase.from('files').select('*').eq('folder_id', fid)
      const { data: subfolders } = await supabase.from('folders').select('*').eq('parent_id', fid)
      let allFiles = [...filesInFolder]

      for (let sf of subfolders) {
        allFiles = allFiles.concat(await getAllFilesInFolder(sf.folder_id))
      }
      return allFiles
    }

    const filesToShare = await getAllFilesInFolder(folderId)

    for (let file of filesToShare) {
      let ownerPublicKey
      const userPrivateKey = user.privateKey

      if (file.owner_id === user.userId) {
        ownerPublicKey = user.publicKey
      } else {
        const { data: ownerData, error: ownerError } = await supabase
          .from('users')
          .select('public_key')
          .eq('id', file.owner_id)
          .single()

        if (ownerError || !ownerData?.public_key) {
          console.error('[ERROR] Owner public key missing for file:', file.original_filename, ownerError)
          alert(`Cannot get owner public key for file ${file.original_filename}`)
          continue
        }

        ownerPublicKey = ownerData.public_key
      }

      if (!ownerPublicKey || !userPrivateKey) {
        console.error('[ERROR] Missing keys', { ownerPublicKey, userPrivateKey })
        alert('Missing keys, cannot decrypt file key')
        continue
      }

      const decryptedFileKeyBase64 = await decryptFileKeyForUser({
        sealedBase64Url: file.encrypted_file_key_owner,
        senderPublicKeyBase64: ownerPublicKey,
        userPrivateKeyBase64: userPrivateKey
      })

      const recipientEncryptedKey = await encryptFileKeyForUser(decryptedFileKeyBase64, recipientData.public_key)

      await supabase.from('file_shares').insert({
        file_id: file.file_id,
        shared_with_user_id: recipientData.id,
        encrypted_file_key: recipientEncryptedKey
      })

      console.log('[INFO] File shared successfully:', file.original_filename)
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
    try {
      if (!shareUsername) {
        alert('Please enter a username to share with')
        return
      }

      // 1️⃣ Tìm người nhận theo username
      const { data: recipientData, error: recipientError } = await supabase
        .from('users')
        .select('id, username, public_key')
        .eq('username', shareUsername)
        .single()

      if (recipientError || !recipientData) {
        console.error('[ERROR] User to share not found:', recipientError)
        alert('User not found')
        return
      }
      console.debug('[DEBUG] Recipient found:', recipientData)

      // 2️⃣ Xác định file(s) để share
      const targetIds = Array.isArray(shareModal.targetId) ? shareModal.targetId : [shareModal.targetId]
      const filesToShare = files.filter(f => targetIds.includes(f.file_id))

      // 3️⃣ Lặp qua từng file để share
      for (let file of filesToShare) {
        let ownerPublicKey
        let userPrivateKey = user.privateKey  // phải đảm bảo đã set khi load session

        if (file.owner_id === user.id) {
          // Nếu file của chính user
          ownerPublicKey = user.publicKey  
          userPrivateKey = user.privateKey   // privateKey đã giải mã
        } else {
          // Nếu file của người khác
          const { data: ownerData, error: ownerError } = await supabase
            .from('users')
            .select('public_key')
            .eq('id', file.owner_id)
            .single()

          if (ownerError || !ownerData?.public_key) {
            console.error('[ERROR] Owner public key missing for file:', file.original_filename, ownerError)
            alert(`Cannot get owner public key for file ${file.original_filename}`)
            continue
          }

          ownerPublicKey = ownerData.public_key
        }

        if (!ownerPublicKey || !userPrivateKey) {
          console.error('[ERROR] Missing keys', { ownerPublicKey, userPrivateKey })
          alert('Missing keys, cannot decrypt file key')
          continue
        }

        console.debug('[DEBUG] Decrypting file key for file:', file.original_filename)
        const decryptedFileKeyBase64 = await decryptFileKeyForUser({
          sealedBase64Url: file.encrypted_file_key_owner,
          senderPublicKeyBase64: ownerPublicKey,
          userPrivateKeyBase64: userPrivateKey
        })
        console.debug('[DEBUG] Decrypted file key:', decryptedFileKeyBase64)
        // 4️⃣ Encrypt file key cho recipient
        const recipientEncryptedKey = await encryptFileKeyForUser(decryptedFileKeyBase64, recipientData.public_key)
        console.debug('[DEBUG] Encrypted file key for recipient:', recipientEncryptedKey)

        // 5️⃣ Lưu thông tin chia sẻ vào DB
        const { data: shareResult, error: shareError } = await supabase
          .from('file_shares')
          .insert({
            file_id: file.file_id,
            shared_with_user_id: recipientData.id,
            encrypted_file_key: recipientEncryptedKey
          })

        if (shareError) {
          console.error('[ERROR] Failed to save share:', shareError)
          alert(`Failed to share file ${file.original_filename}`)
          continue
        }

        console.log('[INFO] File shared successfully:', file.original_filename)
      }

      alert('File(s) shared successfully!')
      closeShareModal()
    } catch (err) {
      console.error('[ERROR] handleShareSubmit:', err)
      alert('Share failed: ' + err.message)
    }
  }

  const handleShareFolderSubmit = async () => {
    try {
      if (!shareUsername) {
        alert('Please enter a username to share with')
        return
      }

      // 1️⃣ Tìm người nhận theo username
      const { data: recipientData, error: recipientError } = await supabase
        .from('users')
        .select('id, username, public_key')
        .eq('username', shareUsername)
        .single()

      if (recipientError || !recipientData) {
        console.error('[ERROR] User to share not found:', recipientError)
        alert('User not found')
        return
      }
      console.debug('[DEBUG] Recipient found:', recipientData)

      // 2️⃣ Gọi handleShareFolder để share tất cả file trong folder và subfolder
      await handleShareFolder(shareModal.targetId, recipientData)

      alert('Folder shared successfully!')
      closeShareModal()
    } catch (err) {
      console.error('[ERROR] handleShareFolderSubmit:', err)
      alert('Share folder failed: ' + err.message)
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
              <button onClick={() => openShareModal(Array.from(selection)[0], 'file')}>Share</button>
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
      {previewFile && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.8)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center' 
        }}>
          <div style={{ background: '#2c2c2c', padding: 20, borderRadius: 8, maxWidth: '90%', maxHeight: '90%' }}>
            <h3>{previewFile.name}</h3>
            {previewFile.type.startsWith('image') && <img src={previewFile.url} style={{ maxWidth: '80vw', maxHeight: '80vh' }} />}
            {previewFile.type.startsWith('text') && <iframe src={previewFile.url} style={{ width: '80vw', height: '60vh', background: '#1a1a1a' }} />}
            {previewFile.type.startsWith('audio') && <audio controls style={{ width: '80vw' }}><source src={previewFile.url} type={previewFile.type} /></audio>}
            {previewFile.type.startsWith('video') && <video controls style={{ maxWidth: '80vw', maxHeight: '60vh' }}><source src={previewFile.url} type={previewFile.type} /></video>}
            <div style={{ marginTop: 10, textAlign: 'right' }}><button onClick={() => setPreviewFile(null)}>Close</button></div>
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
              <button onClick={shareModal.type === 'file' ? handleShareSubmit : handleShareFolderSubmit}>Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
