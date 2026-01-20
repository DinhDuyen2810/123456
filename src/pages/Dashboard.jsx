// Helper: Chuyển base64 về Uint8Array
function base64ToUint8Array(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// Component: Show countdown timer for expiration
function ExpiresCountdown({ expiresAt }) {
  const [timeLeft, setTimeLeft] = useState('')
  const [isExpired, setIsExpired] = useState(false)

  useEffect(() => {
    if (!expiresAt) return

    const updateTimer = () => {
      const utcTime = expiresAt.includes('Z') || expiresAt.includes('+')
        ? expiresAt
        : expiresAt.replace(' ', 'T') + 'Z'
      const expires = new Date(utcTime).getTime()
      const now = Date.now()
      const diff = expires - now

      if (diff <= 0) {
        setIsExpired(true)
        setTimeLeft('Expired')
        return
      }

      const seconds = Math.floor(diff / 1000)
      const minutes = Math.floor(seconds / 60)
      const hours = Math.floor(minutes / 60)
      const days = Math.floor(hours / 24)

      if (days > 0) {
        setTimeLeft(`${days}d ${hours % 24}h left`)
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes % 60}m left`)
      } else if (minutes > 0) {
        setTimeLeft(`${minutes}m ${seconds % 60}s left`)
      } else {
        setTimeLeft(`${seconds}s left`)
      }
    }

    updateTimer()
    const intervalId = setInterval(updateTimer, 1000)

    return () => clearInterval(intervalId)
  }, [expiresAt])

  if (!expiresAt) return <span>-</span>

  const utcTime = expiresAt.includes('Z') || expiresAt.includes('+')
    ? expiresAt
    : expiresAt.replace(' ', 'T') + 'Z'
  const exactTime = new Date(utcTime).toLocaleString()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
      <span
        style={{
          color: isExpired ? '#dc2626' : (timeLeft.includes('s left') && !timeLeft.includes('m') ? '#f59e0b' : '#6b7280'),
          fontSize: '0.9em',
          fontWeight: isExpired || timeLeft.includes('s left') ? 600 : 400,
          cursor: 'help'
        }}
        title={`Expires at: ${exactTime}`}
      >
        {timeLeft}
      </span>
      <span style={{ fontSize: '0.75em', color: '#9ca3af' }}>{exactTime}</span>
    </div>
  )
}

// src/pages/Dashboard.jsx
import JSZip from 'jszip'

import { useEffect, useState } from 'react'
import supabase from '../utils/supabase.js'
import { getSession, clearSession } from '../utils/session.js'
import { encryptFile, decryptFile } from '../crypto/fileEncryption.js'
import { encryptFileKeyForUser, decryptFileKeyForUser } from '../crypto/shareFileKey.js'
import { Shield, Folder, FileText, Download, Share2, Trash2, X, Plus, LogOut } from 'lucide-react'
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
  // ISO string or empty
  const [shareExpiresAt, setShareExpiresAt] = useState('')

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

  const handleLogout = () => {
    clearSession()
    window.location.href = '/'
  }

  const handleDownloadFolder = async (folder) => {
    try {
      const zip = new JSZip()

      // Đệ quy lấy tất cả file trong folder và subfolder
      const getAllFilesInFolder = async (fid, pathPrefix = '') => {
        const { data: filesInFolder } = await supabase.from('files').select('*').eq('folder_id', fid)
        const { data: subfolders } = await supabase.from('folders').select('*').eq('parent_id', fid)
        console.log('[DEBUG] getAllFilesInFolder', { fid, pathPrefix, filesInFolder, subfolders })
        // Thêm file vào zip
        for (let file of filesInFolder || []) {
          try {
            console.log('[DEBUG] Decrypting file in folder:', file)
            const decryptedBlob = await decryptFileHelper(file)
            const filePath = pathPrefix ? `${pathPrefix}/${file.original_filename}` : file.original_filename
            zip.file(filePath, decryptedBlob)
          } catch (fileErr) {
            console.error('[ERROR] decryptFileHelper failed:', file, fileErr)
            throw fileErr
          }
        }
        // Đệ quy cho subfolder
        for (let sf of subfolders || []) {
          await getAllFilesInFolder(sf.folder_id, pathPrefix ? `${pathPrefix}/${sf.name}` : sf.name)
        }
      }

      await getAllFilesInFolder(folder.folder_id, folder.name)

      // Tạo file zip và tải về
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(content)
      a.download = `${folder.name}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
      alert('Folder downloaded as zip!')
    } catch (err) {
      console.error('[ERROR] handleDownloadFolder:', err)
      alert('Download folder failed: ' + err.message)
    }
  }

  // Load folders/files
  useEffect(() => {
    if (!user) return
    async function loadData() {
      try {
        // Folders/files của user
        const { data: myFolders } = await supabase.from('folders').select('*').eq('owner_id', user.userId)
        const { data: myFiles } = await supabase.from('files').select('*').eq('owner_id', user.userId)
        setFolders(myFolders || [])
        setFiles(myFiles || [])

        // Shared files
        const { data: sharedFilesData } = await supabase
          .from('file_shares')
          .select(`
            id,
            file_id,
            shared_with_user_id,
            expires_at,
            files(*)
          `)
          .eq('shared_with_user_id', user.userId)

        // Delete expired shares
        const now = new Date()
        const expiredShares = sharedFilesData.filter(s => s.expires_at && new Date(s.expires_at) < now)
        for (const share of expiredShares) {
          await supabase.from('file_shares').delete().eq('id', share.id)
          console.log('[AUTO-DELETE] Deleted expired share:', share.id, share.files?.original_filename)
        }

        const mappedSharedFiles = sharedFilesData
          .filter(s => !s.expires_at || new Date(s.expires_at) > now)
          .map(s => ({
            ...s.files,
            shared_id: s.id,
            expires_at: s.expires_at
          }))
        console.log('[DEBUG] mappedSharedFiles:', mappedSharedFiles)
        setSharedFiles(mappedSharedFiles || [])

        // Shared folders
        const { data: sharedFoldersData } = await supabase
          .from('folder_shares')
          .select(`
            id,
            folder_id,
            shared_with_user_id,
            parent_share_id,
            folders(*)
          `)
          .eq('shared_with_user_id', user.userId)

        const mappedSharedFolders = sharedFoldersData.map(s => ({
          ...s.folders,
          shared_id: s.id,
          parent_id: s.parent_share_id || s.folders.parent_id
        }))
        setSharedFolders(mappedSharedFolders || [])

        console.log('[DEBUG] Data loaded', { myFolders, myFiles, sharedFilesData: mappedSharedFiles, sharedFoldersData: mappedSharedFolders })
      } catch (err) {
        console.error('[ERROR] loadData:', err)
      }
    }
    loadData()

  }, [user]) // Removed sharedFiles from dependency to avoid infinite loop

  // 🔄 Auto check expired shares separate effect
  useEffect(() => {
    const intervalId = setInterval(() => {
      setSharedFiles(prev => {
        const now = new Date()
        const expiredFileShares = prev.filter(f => f.expires_at && new Date(f.expires_at) < now)

        if (expiredFileShares.length > 0) {
          console.log('[AUTO-CLEANUP] Found', expiredFileShares.length, 'expired file(s)')
          // Delete from DB asynchronously
          expiredFileShares.forEach(file => {
            supabase.from('file_shares').delete().eq('id', file.shared_id)
              .then(() => console.log('[AUTO-CLEANUP] Removed expired file:', file.original_filename))
              .catch(err => console.error('[AUTO-CLEANUP ERROR]', err))
          })

          return prev.filter(f => !f.expires_at || new Date(f.expires_at) > now)
        }
        return prev
      })
    }, 60000)

    return () => clearInterval(intervalId)
  }, [])


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
    else await handlePreview(item)
  }

  //  Preview file (mở xem trước)
  const handlePreview = async (file) => {
    try {
      const decryptedBlob = await decryptFileHelper(file)
      const url = URL.createObjectURL(decryptedBlob)
      setPreviewFile({ url, name: file.original_filename, type: file.mime_type })
    } catch (err) {
      console.error('[ERROR] handlePreview:', err)
      alert('Preview failed: ' + err.message)
    }
  }

  //  Download file (tải về thực sự)
  const handleDownload = async (file) => {
    try {
      // Tải encryptedFile từ Supabase Storage
      const { data: encryptedFileData, error: downloadError } = await supabase.storage.from('encrypted-files').download(file.storage_path)
      if (downloadError) {
        alert('Download failed!')
        return
      }
      const encryptedFileBytes = new Uint8Array(await encryptedFileData.arrayBuffer())
      // Xác thực chữ ký
      const isValid = await (await import('../crypto/keyPair.js')).verifyFileSignature(encryptedFileBytes, file.signature, file.sign_public_key)
      if (!isValid) {
        alert('File bị chỉnh sửa hoặc không hợp lệ!')
        return
      }
      // Giải mã file như cũ
      const decryptedBlob = await decryptFileHelper(file)
      // Tạo link download
      const url = URL.createObjectURL(decryptedBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.original_filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      console.log('[INFO] File downloaded:', file.original_filename)
    } catch (err) {
      console.error('[ERROR] handleDownload:', err)
      alert('Download failed: ' + err.message)
    }
  }

  //  Decrypt file (dùng chung cho preview và download)
  const decryptFileHelper = async (file) => {
    console.log('[DEBUG] Downloading from storage:', file.storage_path)

    const { data, error } = await supabase
      .storage
      .from('encrypted-files')
      .download(file.storage_path)

    if (error) throw error

    const encryptedBytes = new Uint8Array(await data.arrayBuffer())

    const now = Date.now()
    const fileCreated = new Date(file.updated_at || file.created_at).getTime()
    const needRotate = (now - fileCreated) > 3600 * 1000

    let decryptedFileKeyBase64

    // ============================
    // OWNER
    // ============================
    if (file.owner_id === user.userId) {
      const oldFileKey = await decryptFileKeyForUser({
        sealedBase64Url: file.encrypted_file_key_owner,
        userPublicKeyBase64: user.publicKey,
        userPrivateKeyBase64: user.privateKey
      })

      // Rotate nếu cần
      if (needRotate) {
        console.log('[ROTATE] Owner rotating key for', file.original_filename)

        const decrypted = await decryptFile(encryptedBytes, oldFileKey, file.iv)

        const newFileKeyBytes = crypto.getRandomValues(new Uint8Array(32))
        const newFileKey = btoa(String.fromCharCode(...newFileKeyBytes))

        const ivBytes = base64ToUint8Array(file.iv)
        const cryptoKey = await crypto.subtle.importKey('raw', newFileKeyBytes, 'AES-GCM', false, ['encrypt'])
        const newEncryptedBuffer = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: ivBytes },
          cryptoKey,
          decrypted
        )

        // upload lại
        await supabase.storage.from('encrypted-files')
          .upload(file.storage_path, new Blob([new Uint8Array(newEncryptedBuffer)]), { upsert: true })

        // update owner key
        const encryptedFileKeyOwner = await encryptFileKeyForUser(newFileKey, user.publicKey)
        await supabase.from('files')
          .update({ encrypted_file_key_owner: encryptedFileKeyOwner, updated_at: new Date().toISOString() })
          .eq('file_id', file.file_id)

        // update shares
        const { data: shares } = await supabase
          .from('file_shares')
          .select('id, shared_with_user_id')
          .eq('file_id', file.file_id)

        for (let share of shares || []) {
          const { data: u } = await supabase
            .from('users')
            .select('public_key')
            .eq('id', share.shared_with_user_id)
            .single()

          if (u?.public_key) {
            const enc = await encryptFileKeyForUser(newFileKey, u.public_key)
            await supabase.from('file_shares')
              .update({ encrypted_file_key: enc, updated_at: new Date().toISOString() })
              .eq('id', share.id)
          }
        }

        decryptedFileKeyBase64 = newFileKey
        const decryptedNew = await decryptFile(new Uint8Array(newEncryptedBuffer), newFileKey, file.iv)
        return new Blob([decryptedNew], { type: file.mime_type })
      }

      decryptedFileKeyBase64 = oldFileKey
    }

    // ============================
    // SHARED USER
    // ============================
    else {
      const { data: shareRows } = await supabase
        .from('file_shares')
        .select('encrypted_file_key, expires_at')
        .eq('file_id', file.file_id)
        .eq('shared_with_user_id', user.userId)
        .limit(1)

      const share = shareRows?.[0]
      if (!share) throw new Error('No access to this shared file')

      if (share.expires_at && new Date(share.expires_at) < new Date()) {
        throw new Error('Share expired')
      }

      decryptedFileKeyBase64 = await decryptFileKeyForUser({
        sealedBase64Url: share.encrypted_file_key,
        userPublicKeyBase64: user.publicKey,
        userPrivateKeyBase64: user.privateKey
      })
    }

    // ============================
    // Decrypt file
    // ============================
    const decrypted = await decryptFile(encryptedBytes, decryptedFileKeyBase64, file.iv)
    return new Blob([decrypted], { type: file.mime_type })
  }


  const handleUploadFile = async (event, folderId = currentFolderId) => {
    const file = event.target.files[0]
    if (!file) return
    try {
      // Mã hóa file
      const { encryptedFile, fileKey, iv } = await encryptFile(await file.arrayBuffer())
      const fileId = crypto.randomUUID()
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      const storagePath = `demo/${fileId}_${safeName}`

      // Upload file đã mã hóa
      await supabase.storage.from('encrypted-files').upload(storagePath, new Blob([encryptedFile]), { upsert: true })

      // Mã hóa fileKey cho owner
      const { data: ownerData } = await supabase.from('users').select('public_key').eq('id', user.userId).single()
      const encryptedFileKeyOwner = await encryptFileKeyForUser(fileKey, ownerData.public_key)

      // Ký số file
      const { signPrivateKey, signPublicKey } = user
      let signature = null
      if (signPrivateKey) {
        signature = await (await import('../crypto/keyPair.js')).signFile(new Uint8Array(encryptedFile), signPrivateKey)
      }

      // Lưu metadata vào DB
      const { data: newFile } = await supabase.from('files').insert([{
        file_id: fileId,
        owner_id: user.userId,
        folder_id: folderId,
        storage_path: storagePath,
        encrypted_file_key_owner: encryptedFileKeyOwner,
        original_filename: file.name,
        mime_type: file.type,
        iv,
        signature,
        sign_public_key: signPublicKey || null
      }]).select().single()

      setFiles(prev => [...prev, newFile])
      console.log('[DEBUG] New file saved to DB:', newFile)
    } catch (err) {
      console.error('[ERROR] handleUploadFile:', err)
      alert('Upload failed: ' + err.message)
    }
  }

  const handleUploadFolder = async (event) => {
    const files = Array.from(event.target.files)
    if (files.length === 0) return

    try {
      const folderStructure = {}

      for (let file of files) {
        const pathParts = file.webkitRelativePath.split('/')
        pathParts.pop()

        let currentPath = ''
        for (let part of pathParts) {
          const parentPath = currentPath
          currentPath = currentPath ? `${currentPath}/${part}` : part

          if (!folderStructure[currentPath]) {
            folderStructure[currentPath] = { parentPath, name: part, folderId: null }
          }
        }
      }

      const sortedPaths = Object.keys(folderStructure).sort((a, b) =>
        a.split('/').length - b.split('/').length
      )

      for (let path of sortedPaths) {
        const folder = folderStructure[path]
        const parentFolderId = folder.parentPath
          ? folderStructure[folder.parentPath].folderId
          : currentFolderId

        const { data: newFolder, error } = await supabase
          .from('folders')
          .insert([{
            name: folder.name,
            parent_id: parentFolderId,
            owner_id: user.userId
          }])
          .select()
          .single()

        if (error) throw error
        folder.folderId = newFolder.folder_id
        setFolders(prev => [...prev, newFolder])
      }

      for (let file of files) {
        const pathParts = file.webkitRelativePath.split('/')
        pathParts.pop()
        const folderPath = pathParts.join('/')
        const targetFolderId = folderPath ? folderStructure[folderPath].folderId : currentFolderId

        await handleUploadFile({ target: { files: [file] } }, targetFolderId)
      }

      alert('Folder uploaded successfully!')
    } catch (err) {
      console.error('[ERROR] handleUploadFolder:', err)
      alert('Upload folder failed: ' + err.message)
    }
  }

  const handleShareFolder = async (rootFolderId, recipientData, expiresAt) => {
    try {
      // 🌳 Lấy folder gốc + tất cả subfolder đệ quy
      const getAllSubfolders = async (fid) => {
        const { data: subfolders } = await supabase.from('folders').select('*').eq('parent_id', fid)
        let allSubs = [...(subfolders || [])]
        for (let sf of subfolders || []) {
          allSubs = allSubs.concat(await getAllSubfolders(sf.folder_id))
        }
        return allSubs
      }

      const { data: rootFolderData } = await supabase.from('folders').select('*').eq('folder_id', rootFolderId).single()
      const subfolders = await getAllSubfolders(rootFolderId)
      const allFolders = [rootFolderData, ...subfolders]

      // 🌿 Map folder_id → folder_share.id
      const folderShareIdMap = {}

      for (let folder of allFolders) {
        const parentShareId = folder.parent_id ? folderShareIdMap[folder.parent_id] : null

        // Insert folder_share
        const { data: folderShare, error } = await supabase.from('folder_shares')
          .insert({
            folder_id: folder.folder_id,
            shared_with_user_id: recipientData.id,
            parent_share_id: parentShareId
          })
          .select()
          .single()

        if (error) {
          console.error('[ERROR] Failed to share folder:', folder.name, error)
          continue
        }

        folderShareIdMap[folder.folder_id] = folderShare.id
      }

      // 🌐 Share tất cả files trong folder + subfolder
      const getAllFilesInFolder = async (fid) => {
        const { data: filesInFolder } = await supabase.from('files').select('*').eq('folder_id', fid)
        const { data: subfolders } = await supabase.from('folders').select('*').eq('parent_id', fid)
        let allFiles = [...(filesInFolder || [])]
        for (let sf of subfolders || []) {
          allFiles = allFiles.concat(await getAllFilesInFolder(sf.folder_id))
        }
        return allFiles
      }

      const allFiles = await getAllFilesInFolder(rootFolderId)

      for (let file of allFiles) {
        try {
          const userPrivateKey = user.privateKey
          const ownerPublicKey = file.owner_id === user.userId
            ? user.publicKey
            : (await supabase.from('users').select('public_key').eq('id', file.owner_id).single()).data.public_key

          const decryptedFileKeyBase64 = await decryptFileKeyForUser({
            sealedBase64Url: file.encrypted_file_key_owner,
            userPublicKeyBase64: user.publicKey,
            userPrivateKeyBase64: userPrivateKey
          })

          const recipientEncryptedKey = await encryptFileKeyForUser(decryptedFileKeyBase64, recipientData.public_key)

          // ✅ Check nếu file đã share với user chưa → tránh duplicate
          const { data: existingShare } = await supabase.from('file_shares')
            .select('*')
            .eq('file_id', file.file_id)
            .eq('shared_with_user_id', recipientData.id)
            .maybeSingle()

          if (!existingShare) {
            await supabase.from('file_shares').insert({
              file_id: file.file_id,
              shared_with_user_id: recipientData.id,
              encrypted_file_key: recipientEncryptedKey,
              expires_at: expiresAt
            })
          } else {
            await supabase.from('file_shares').update({
              encrypted_file_key: recipientEncryptedKey,
              expires_at: expiresAt
            }).eq('id', existingShare.id)
          }
        } catch (err) {
          console.error('[ERROR] Sharing file failed:', file.original_filename, err)
        }
      }

      console.log('[INFO] Folder and subfolders/files shared successfully')
    } catch (err) {
      console.error('[ERROR] handleShareFolder:', err)
      throw err
    }
  }




  const openShareModal = (id, type) => {
    setShareModal({ visible: true, targetId: id, type })
    setShareUsername('')
    setShareExpiresAt('') // reset khi mở modal mới
  }

  const closeShareModal = () => {
    setShareModal({ visible: false, targetId: null, type: null })
    setShareUsername('')
    setShareExpiresAt('')
  }

  const handleShareSubmit = async () => {
    try {
      if (!shareUsername) {
        alert('Please enter a username to share with')
        return
      }

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

      const targetIds = Array.isArray(shareModal.targetId) ? shareModal.targetId : [shareModal.targetId]
      const allFiles = [...files, ...sharedFiles]
      // Dùng Map để loại bỏ trùng lặp nếu file vừa là của mình vừa được share (lý thuyết ít khi xảy ra)
      const uniqueFiles = Array.from(new Map(allFiles.map(item => [item.file_id, item])).values())

      const filesToShare = uniqueFiles.filter(f => targetIds.includes(f.file_id))

      console.log('[DEBUG] handleShareSubmit start', {
        targetIds,
        foundFilesCount: filesToShare.length,
        shareExpiresAt
      })

      for (let file of filesToShare) {
        // 1. Lấy fileKey đã giải mã (dù là chủ hay người được share)
        let decryptedFileKeyBase64 = null
        let parentShareId = null
        if (file.owner_id === user.userId) {
          decryptedFileKeyBase64 = await decryptFileKeyForUser({
            sealedBase64Url: file.encrypted_file_key_owner,
            userPublicKeyBase64: user.publicKey,
            userPrivateKeyBase64: user.privateKey
          })
        } else {
          // Lấy bản share gần nhất của user
          const { data: myShare } = await supabase.from('file_shares').select('id, encrypted_file_key').eq('file_id', file.file_id).eq('shared_with_user_id', user.userId).single()
          if (!myShare) {
            alert('Bạn không có quyền chia sẻ file này')
            continue
          }
          parentShareId = myShare.id
          decryptedFileKeyBase64 = await decryptFileKeyForUser({
            sealedBase64Url: myShare.encrypted_file_key,
            userPublicKeyBase64: user.publicKey,
            userPrivateKeyBase64: user.privateKey
          })
        }
        // 2. Mã hóa lại fileKey cho người nhận mới
        console.debug('[DEBUG] Encrypting fileKey for recipient:', {
          recipientUsername: recipientData.username,
          recipientPublicKey: recipientData.public_key
        })
        const recipientEncryptedKey = await encryptFileKeyForUser(decryptedFileKeyBase64, recipientData.public_key)
        // 3. Check duplicate share
        const { data: existingShare } = await supabase.from('file_shares')
          .select('id')
          .eq('file_id', file.file_id)
          .eq('shared_with_user_id', recipientData.id)
          .maybeSingle()

        console.log('[DEBUG] shareExpiresAt raw input:', shareExpiresAt)
        const expiresAt = shareExpiresAt ? new Date(shareExpiresAt).toISOString() : null
        console.log('[DEBUG] Calculated expiresAt for DB:', expiresAt)

        let shareError = null
        if (existingShare) {
          const { error } = await supabase.from('file_shares')
            .update({ encrypted_file_key: recipientEncryptedKey, expires_at: expiresAt })
            .eq('id', existingShare.id)
          shareError = error
        } else {
          const { error } = await supabase.from('file_shares').insert({
            file_id: file.file_id,
            shared_with_user_id: recipientData.id,
            encrypted_file_key: recipientEncryptedKey,
            expires_at: expiresAt
          })
          shareError = error
        }

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
      const expiresAt = shareExpiresAt ? new Date(shareExpiresAt).toISOString() : null

      // ✅ Chỉ gọi handleShareFolder, không insert folder_share trước
      await handleShareFolder(shareModal.targetId, recipientData, expiresAt)

      alert('Folder shared successfully!')
      closeShareModal()
    } catch (err) {
      console.error('[ERROR] handleShareFolderSubmit:', err)
      alert('Share folder failed: ' + err.message)
    }
  }


  const handleDeleteFile = async (file) => {
    const isShare = !!file.shared_id; // có shared_id → là bản share

    const confirmMsg = isShare
      ? `Are you sure you want to delete this shared copy of "${file.original_filename}"?`
      : `Are you sure you want to delete "${file.original_filename}"? This will also delete all shared copies.`;

    if (!window.confirm(confirmMsg)) return;

    try {
      if (isShare) {
        // Xóa chỉ bản share
        const { error: shareError } = await supabase
          .from('file_shares')
          .delete()
          .eq('id', file.shared_id); // chú ý: dùng id của bản share
        if (shareError) throw shareError;
      } else {
        // Xóa tất cả share liên quan
        const { error: shareError } = await supabase
          .from('file_shares')
          .delete()
          .eq('file_id', file.file_id);
        if (shareError) throw shareError;

        // Xóa file storage
        const { error: storageError } = await supabase.storage
          .from('encrypted-files')
          .remove([file.storage_path]);
        if (storageError) throw storageError;

        // Xóa metadata file gốc
        const { error: fileError } = await supabase
          .from('files')
          .delete()
          .eq('file_id', file.file_id);
        if (fileError) throw fileError;
      }

      // Cập nhật state UI
      setFiles(prev => prev.filter(f => f.file_id !== file.file_id));
      setSharedFiles(prev => prev.filter(f => f.file_id !== file.file_id || (file.shared_id && f.shared_id !== file.shared_id)));

      alert('File deleted successfully!');
    } catch (err) {
      console.error('[ERROR] handleDeleteFile:', err);
      alert('Delete failed: ' + err.message);
    }
  };


  const deleteFileFromDB = async (file) => {
    if (file.shared_id) {
      // Xóa bản share
      const { error } = await supabase.from('file_shares').delete().eq('shared_id', file.shared_id);
      if (error) throw error;
    } else {
      // Xóa tất cả share trước
      const { error: shareError } = await supabase.from('file_shares').delete().eq('file_id', file.file_id);
      if (shareError) throw shareError;

      // Xóa file storage
      const { error: storageError } = await supabase.storage.from('encrypted-files').remove([file.storage_path]);
      if (storageError) throw storageError;

      // Xóa metadata file gốc
      const { error: fileError } = await supabase.from('files').delete().eq('file_id', file.file_id);
      if (fileError) throw fileError;
    }
  };

  const handleDeleteFolder = async (folder) => {
    const isShare = !!folder.shared_id;

    const confirmMsg = isShare
      ? `Are you sure you want to delete this shared folder "${folder.name}"?`
      : `Are you sure you want to delete folder "${folder.name}" and all its contents?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      if (isShare) {
        // Chỉ xóa folder share
        const { error } = await supabase.from('folder_shares').delete().eq('id', folder.shared_id);
        if (error) throw error;
      } else {
        // 1️⃣ Lấy tất cả file trong folder + subfolder
        const getAllFilesInFolder = async (fid) => {
          const { data: files } = await supabase.from('files').select('*').eq('folder_id', fid);
          const { data: subfolders } = await supabase.from('folders').select('*').eq('parent_id', fid);
          let allFiles = [...(files || [])];
          for (let sf of subfolders || []) {
            allFiles = allFiles.concat(await getAllFilesInFolder(sf.folder_id));
          }
          return allFiles;
        };

        const allFiles = await getAllFilesInFolder(folder.folder_id);

        // Xóa tất cả file
        for (let file of allFiles) {
          await deleteFileFromDB(file);
        }

        // 2️⃣ Xóa tất cả folder_shares liên quan
        await supabase.from('folder_shares').delete().eq('folder_id', folder.folder_id);

        // 3️⃣ Xóa tất cả subfolders đệ quy
        const getAllSubfolders = async (fid) => {
          const { data: subfolders } = await supabase.from('folders').select('*').eq('parent_id', fid);
          let allSubs = [...(subfolders || [])];
          for (let sf of subfolders || []) {
            allSubs = allSubs.concat(await getAllSubfolders(sf.folder_id));
          }
          return allSubs;
        };

        const allSubfolders = await getAllSubfolders(folder.folder_id);

        // Reverse to delete children before parents
        const sortedSubfolders = allSubfolders.reverse();

        for (let f of sortedSubfolders) {
          await supabase.from('folder_shares').delete().eq('folder_id', f.folder_id);
          await supabase.from('folders').delete().eq('folder_id', f.folder_id);
        }

        // Xóa folder gốc
        const { error: folderError } = await supabase.from('folders').delete().eq('folder_id', folder.folder_id);
        if (folderError) throw folderError;
      }

      // Cập nhật state UI
      setFolders(prev => prev.filter(f => f.folder_id !== folder.folder_id));
      setSharedFolders(prev => prev.filter(f => f.folder_id !== folder.folder_id || (folder.shared_id && f.shared_id !== folder.shared_id)));
      setFiles(prev => prev.filter(f => f.folder_id !== folder.folder_id));
      setSharedFiles(prev => prev.filter(f => f.folder_id !== folder.folder_id));

      alert('Folder deleted successfully!');
    } catch (err) {
      console.error('[ERROR] handleDeleteFolder:', err);
      alert('Delete folder failed: ' + err.message);
    }
  };





  const displayedFolders = [...folders.filter(f => f.parent_id === currentFolderId), ...sharedFolders.filter(f => f.parent_id === currentFolderId)]
  const displayedFiles = [...files.filter(f => f.folder_id === currentFolderId), ...sharedFiles.filter(f => f.folder_id === currentFolderId)]

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="logo-area">
          <Shield className="file-icon" size={24} /> zkCloud
        </div>

        <div className="sidebar-actions">
          <button onClick={() => document.getElementById('upload-file-input').click()}>Upload File</button>
          <button className="secondary" onClick={() => document.getElementById('upload-folder-input').click()}>Upload Folder</button>
        </div>

        <div className="user-info">
          <div style={{ marginBottom: '0.5rem' }}>Logged in as: <b>{user?.username}</b></div>
          <button onClick={handleLogout} className="danger" style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', padding: '0.4rem' }}>
            <LogOut size={16} /> Logout
          </button>
        </div>

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

      {/* Main Content */}
      <div className="main-content">
        {/* Breadcrumb & Actions */}
        <div className="toolbar">
          <div className="breadcrumb">
            <button onClick={() => setCurrentFolderId(null)}>Roots</button>
            {getBreadcrumb().map(f => (
              <span key={f.folder_id}> / <button onClick={() => setCurrentFolderId(f.folder_id)}>{f.name}</button></span>
            ))}
          </div>

          {selection.size > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="secondary" onClick={() => alert('Download selected feature coming soon')}>Download Zip</button>
              <button onClick={() => openShareModal(Array.from(selection)[0], 'file')}>Share Selected</button>
            </div>
          )}
        </div>

        {/* File List */}
        <div className="file-list-container">
          <div className="file-grid-header">
            <div></div>
            <div>Name</div>
            <div>Owner</div>
            <div>Created At</div>
            <div>Expires</div>
            <div>Actions</div>
          </div>

          <div className="file-list-body">
            {displayedFolders.map(f => (
              <div
                key={f.folder_id + (f.shared_id ? '-shared' : '')}
                className="file-grid-row"
                onDoubleClick={() => handleDoubleClick(f)}
              >
                <input
                  type="checkbox"
                  checked={selection.has(f.folder_id)}
                  readOnly
                  onClick={(e) => { e.stopPropagation(); toggleSelect(f.folder_id); }}
                />
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <Folder className="file-icon" size={20} color="#4f46e5" fill="#4f46e5" fillOpacity={0.2} />
                  <span>{f.name}</span>
                </div>
                <span>{f.owner_id === user.userId ? 'Me' : 'Shared'}</span>
                <span>{f.created_at ? new Date(f.created_at).toLocaleDateString('vi-VN') : '-'}</span>
                <span>-</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="action-btn" title="Download" onClick={(e) => { e.stopPropagation(); handleDownloadFolder(f); }}>
                    <Download size={18} />
                  </button>
                  <button className="action-btn" title="Share" onClick={(e) => { e.stopPropagation(); openShareModal(f.folder_id, 'folder'); }}>
                    <Share2 size={18} />
                  </button>
                  <button className="action-btn delete" title="Delete" onClick={(e) => { e.stopPropagation(); handleDeleteFolder(f); }}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}

            {displayedFiles.map(f => {
              console.log('[RENDER FILE]', f.original_filename, 'expires_at:', f.expires_at, 'shared_id:', f.shared_id)
              return (
                <div
                  key={f.file_id + (f.shared_id ? '-shared' : '')}
                  className="file-grid-row"
                  onDoubleClick={() => handleDoubleClick(f)}
                >
                  <input
                    type="checkbox"
                    checked={selection.has(f.file_id)}
                    readOnly
                    onClick={(e) => { e.stopPropagation(); toggleSelect(f.file_id); }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    <FileText className="file-icon" size={20} color="#6b7280" />
                    <span title={f.original_filename}>{f.original_filename}</span>
                  </div>
                  <span>{f.owner_id === user.userId ? 'Me' : 'Shared'}</span>
                  <span>{f.created_at ? new Date(f.created_at).toLocaleDateString('vi-VN') : '-'}</span>
                  <ExpiresCountdown expiresAt={f.expires_at} />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="action-btn" title="Download" onClick={(e) => { e.stopPropagation(); handleDownload(f); }}>
                      <Download size={18} />
                    </button>
                    <button className="action-btn" title="Share" onClick={(e) => { e.stopPropagation(); openShareModal(f.file_id, 'file'); }}>
                      <Share2 size={18} />
                    </button>
                    <button className="action-btn delete" title="Delete" onClick={(e) => { e.stopPropagation(); handleDeleteFile(f); }}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              )
            })}

            {displayedFolders.length === 0 && displayedFiles.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                This folder is empty.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {previewFile && (
        <div className="modal-overlay">
          <div className="modal-content large">
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{previewFile.name}</span>
              <button className="action-btn" onClick={() => setPreviewFile(null)}><X size={20} /></button>
            </div>

            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f3f4f6', borderRadius: 8, overflow: 'hidden', marginBottom: '1rem' }}>
              {previewFile.type.startsWith('image') && (
                <img src={previewFile.url} style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }} alt={previewFile.name} />
              )}

              {previewFile.type.startsWith('text') && (
                <iframe
                  src={previewFile.url}
                  style={{ width: '100%', height: '100%', border: 'none', background: 'white' }}
                />
              )}

              {previewFile.type.startsWith('audio') && (
                <audio controls style={{ width: '100%' }}>
                  <source src={previewFile.url} type={previewFile.type} />
                </audio>
              )}

              {previewFile.type.startsWith('video') && (
                <video controls style={{ maxWidth: '100%', maxHeight: '60vh' }}>
                  <source src={previewFile.url} type={previewFile.type} />
                </video>
              )}

              {previewFile.type === 'application/pdf' && (
                <iframe
                  src={previewFile.url}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                />
              )}
            </div>

            <div className="modal-actions">
              <button onClick={() => {
                const a = document.createElement('a')
                a.href = previewFile.url
                a.download = previewFile.name
                a.click()
              }}>Download</button>
              <button className="secondary" onClick={() => setPreviewFile(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareModal.visible && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-header">Share {shareModal.type}</h3>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Recipient Username</label>
              <input
                type="text"
                placeholder="Enter username"
                value={shareUsername}
                onChange={e => setShareUsername(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                Expiration (optional)
              </label>
              <input
                id="share-expires-at"
                type="datetime-local"
                value={shareExpiresAt}
                min={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                onChange={e => setShareExpiresAt(e.target.value)}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '0.85em', color: 'var(--text-muted)', marginTop: 4 }}>
                User access will be revoked after this time.
              </div>
            </div>

            <div className="modal-actions">
              <button className="secondary" onClick={closeShareModal}>Cancel</button>
              <button onClick={shareModal.type === 'file' ? handleShareSubmit : handleShareFolderSubmit}>Share</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
