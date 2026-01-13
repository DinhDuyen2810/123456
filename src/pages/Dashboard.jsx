// src/pages/Dashboard.jsx
import JSZip from 'jszip'

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
            files(*)
          `)
          .eq('shared_with_user_id', user.userId)

        const mappedSharedFiles = sharedFilesData.map(s => ({
          ...s.files,
          shared_id: s.id
        }))
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
    console.log('[DEBUG] Downloading from storage:', file.storage_path, file)
    const { data, error } = await supabase.storage.from('encrypted-files').download(file.storage_path)
    if (error) {
      console.error('[ERROR] Download encrypted file from storage failed:', error, file)
      throw error
    }

    const buffer = await data.arrayBuffer()
    const encryptedBytes = new Uint8Array(buffer)

    // Kiểm tra thời gian rotate fileKey
    const now = Date.now()
    const fileCreated = file.updated_at ? new Date(file.updated_at).getTime() : (file.created_at ? new Date(file.created_at).getTime() : now)
    const needRotate = (now - fileCreated) > 3600 * 1000 // 1 tiếng

    let decryptedFileKeyBase64

    if (needRotate && file.owner_id === user.userId) {
      // Chủ file: sinh lại fileKey, mã hóa lại file, cập nhật DB và share
      console.log('[ROTATE] Rotating fileKey for owner:', file.original_filename)
      // 1. Giải mã fileKey cũ
      const oldFileKey = await decryptFileKeyForUser({
        sealedBase64Url: file.encrypted_file_key_owner,
        userPublicKeyBase64: user.publicKey,
        userPrivateKeyBase64: user.privateKey
      })
      // 2. Giải mã file
      const decrypted = await decryptFile(encryptedBytes, oldFileKey, file.iv)
      // 3. Sinh fileKey mới
      const fileKeyBytes = crypto.getRandomValues(new Uint8Array(32))
      const newFileKey = btoa(String.fromCharCode(...fileKeyBytes))
      // 4. Mã hóa lại file
      const iv = file.iv
      const cryptoKey = await crypto.subtle.importKey('raw', fileKeyBytes, 'AES-GCM', false, ['encrypt'])
      const newEncryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: atob(iv) }, cryptoKey, decrypted)
      // 5. Upload lại file
      await supabase.storage.from('encrypted-files').upload(file.storage_path, new Blob([new Uint8Array(newEncryptedBuffer)]), { upsert: true })
      // 6. Mã hóa fileKey mới cho owner
      const encryptedFileKeyOwner = await encryptFileKeyForUser(newFileKey, user.publicKey)
      // 7. Cập nhật DB files
      await supabase.from('files').update({ encrypted_file_key_owner: encryptedFileKeyOwner, updated_at: new Date().toISOString() }).eq('file_id', file.file_id)
      // 8. Cập nhật cho tất cả người share
      const { data: shares } = await supabase.from('file_shares').select('id, shared_with_user_id').eq('file_id', file.file_id)
      for (let share of shares || []) {
        // Lấy publicKey người nhận
        const { data: userData } = await supabase.from('users').select('public_key').eq('id', share.shared_with_user_id).single()
        if (userData && userData.public_key) {
          const encryptedKey = await encryptFileKeyForUser(newFileKey, userData.public_key)
          await supabase.from('file_shares').update({ encrypted_file_key: encryptedKey }).eq('id', share.id)
        }
      }
      decryptedFileKeyBase64 = newFileKey
      // Giải mã file với key mới
      const decryptedNew = await decryptFile(new Uint8Array(newEncryptedBuffer), newFileKey, file.iv)
      return new Blob([decryptedNew], { type: file.mime_type })
    }

    if (file.owner_id === user.userId) {
      console.log('[DEBUG] Decrypting own file:', file.original_filename, file)
      decryptedFileKeyBase64 = await decryptFileKeyForUser({
        sealedBase64Url: file.encrypted_file_key_owner,
        userPublicKeyBase64: user.publicKey,
        userPrivateKeyBase64: user.privateKey
      })
    } else {
      console.log('[DEBUG] Decrypting shared file:', file.original_filename, file)
      console.log('[DEBUG] Querying file_shares for', { file_id: file.file_id, shared_with_user_id: user.userId })
      const { data: shareData, error: shareError } = await supabase
        .from('file_shares')
        .select('encrypted_file_key, expires_at, updated_at')
        .eq('file_id', file.file_id)
        .eq('shared_with_user_id', user.userId)
        .limit(1)
        .maybeSingle()

      console.log('[DEBUG] file_shares query result:', { shareData, shareError })
      if (shareError || !shareData) {
        console.error('[ERROR] Cannot access shared file key', { shareError, shareData, file, user })
        throw new Error('Cannot access shared file key')
      }
      // Kiểm tra hạn
      if (shareData.expires_at && new Date(shareData.expires_at) < new Date()) {
        throw new Error('Quyền truy cập file này đã hết hạn!')
      }
      // Rotate key cho người share nếu cần
      const shareUpdated = shareData.updated_at ? new Date(shareData.updated_at).getTime() : fileCreated
      const needRotateShare = (now - shareUpdated) > 3600 * 1000
      if (needRotateShare) {
        // Lấy fileKey mới nhất từ owner
        const { data: fileRow } = await supabase.from('files').select('encrypted_file_key_owner').eq('file_id', file.file_id).single()
        const ownerKey = await decryptFileKeyForUser({
          sealedBase64Url: fileRow.encrypted_file_key_owner,
          userPublicKeyBase64: user.publicKey,
          userPrivateKeyBase64: user.privateKey
        })
        // Mã hóa lại cho người share
        const encryptedKey = await encryptFileKeyForUser(ownerKey, user.publicKey)
        await supabase.from('file_shares').update({ encrypted_file_key: encryptedKey, updated_at: new Date().toISOString() }).eq('file_id', file.file_id).eq('shared_with_user_id', user.userId)
        decryptedFileKeyBase64 = ownerKey
      } else {
        decryptedFileKeyBase64 = await decryptFileKeyForUser({
          sealedBase64Url: shareData.encrypted_file_key,
          userPublicKeyBase64: user.publicKey,
          userPrivateKeyBase64: user.privateKey
        })
      }
    }

    console.log('[DEBUG] FileKey decrypted for', file.original_filename)
    const decrypted = await decryptFile(encryptedBytes, decryptedFileKeyBase64, file.iv)
    return new Blob([decrypted], { type: file.mime_type })
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

      // Ký số file
      const { signPrivateKey, signPublicKey } = user
      const signature = signPrivateKey ? (await import('../crypto/keyPair.js')).signFile(new Uint8Array(encryptedFile), signPrivateKey) : null

      const { data: newFile } = await supabase.from('files').insert([{
        file_id: fileId,
        owner_id: user.userId,
        folder_id: folderId,
        storage_path: storagePath,
        encrypted_file_key_owner: encryptedFileKeyOwner,
        original_filename: file.name,
        mime_type: file.type,
        iv,
        signature: signature ? await signature : null,
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

  const handleShareFolder = async (rootFolderId, recipientData) => {
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
            .single()

          if (!existingShare) {
            await supabase.from('file_shares').insert({
              file_id: file.file_id,
              shared_with_user_id: recipientData.id,
              encrypted_file_key: recipientEncryptedKey
            })
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
      const filesToShare = files.filter(f => targetIds.includes(f.file_id))

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
          const { data: myShare } = await supabase.from('file_shares').select('id, encrypted_file_key').eq('file_id', file.file_id).eq('shared_with_user_id', user.userId).maybeSingle()
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
        const recipientEncryptedKey = await encryptFileKeyForUser(decryptedFileKeyBase64, recipientData.public_key)
        // 3. Lưu parent_share_id để truy vết chuỗi share
        const expiresAt = shareExpiresAt ? new Date(shareExpiresAt).toISOString() : null
        const { error: shareError } = await supabase
          .from('file_shares')
          .insert({
            file_id: file.file_id,
            shared_with_user_id: recipientData.id,
            encrypted_file_key: recipientEncryptedKey,
            expires_at: expiresAt,
            parent_share_id: parentShareId
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

      // ✅ Chỉ gọi handleShareFolder, không insert folder_share trước
      await handleShareFolder(shareModal.targetId, recipientData)

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

        for (let f of allSubfolders) {
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
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#181818', color: '#e3e3e3' }}>
      {/* Sidebar */}
      <div style={{ width: 256, padding: 16, background: '#28292c', display: 'flex', flexDirection: 'column' }}>
        <h2>Cloud_Tool</h2>
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
                <span style={{ cursor: 'pointer' }} title="Download" onClick={() => handleDownloadFolder(f)}>⬇️</span>
                <span style={{ cursor: 'pointer' }} title="Share" onClick={() => openShareModal(f.folder_id, 'folder')}>🔗</span>
                <span style={{ cursor: 'pointer', color: 'red' }} title="Delete" onClick={() => handleDeleteFolder(f)}>🗑️</span>
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
                <span style={{ cursor: 'pointer' }} title="Download" onClick={() => handleDownload(f)}>⬇️</span>
                <span style={{ cursor: 'pointer' }} title="Share" onClick={() => openShareModal(f.file_id, 'file')}>🔗</span>
                <span style={{ cursor: 'pointer', color: 'red' }} title="Delete" onClick={() => handleDeleteFile(f)}>🗑️</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview Modal - ✅ SỬA: Chữ trắng cho text file */}
      {previewFile && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.8)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{ background: '#2c2c2c', padding: 20, borderRadius: 8, maxWidth: '90%', maxHeight: '90%', overflow: 'auto' }}>
            <h3 style={{ color: '#e3e3e3', marginBottom: 16 }}>{previewFile.name}</h3>
            
            {previewFile.type.startsWith('image') && (
              <img src={previewFile.url} style={{ maxWidth: '80vw', maxHeight: '70vh', objectFit: 'contain' }} alt={previewFile.name} />
            )}
            
            {previewFile.type.startsWith('text') && (
              <iframe 
                src={previewFile.url} 
                style={{ 
                  width: '80vw', 
                  height: '60vh', 
                  background: '#ffffffff',
                  border: '1px solid #444',
                  color: '#e3e3e3' 
                }} 
              />
            )}
            
            {previewFile.type.startsWith('audio') && (
              <audio controls style={{ width: '80vw' }}>
                <source src={previewFile.url} type={previewFile.type} />
              </audio>
            )}
            
            {previewFile.type.startsWith('video') && (
              <video controls style={{ maxWidth: '80vw', maxHeight: '60vh' }}>
                <source src={previewFile.url} type={previewFile.type} />
              </video>
            )}
            
            {previewFile.type === 'application/pdf' && (
              <iframe 
                src={previewFile.url} 
                style={{ width: '80vw', height: '70vh', border: '1px solid #444' }} 
              />
            )}
            
            <div style={{ marginTop: 16, textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => {
                // ✅ Tải file từ preview
                const a = document.createElement('a')
                a.href = previewFile.url
                a.download = previewFile.name
                a.click()
              }}>Download</button>
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
          alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{ background: '#2c2c2c', padding: 20, borderRadius: 8, minWidth: 320 }}>
            <h3>Share {shareModal.type}</h3>
            <input
              type="text"
              placeholder="Enter username"
              value={shareUsername}
              onChange={e => setShareUsername(e.target.value)}
              style={{ width: '100%', marginBottom: 10, padding: 4, color: '#000' }}
            />
            <label style={{ color: '#e3e3e3', marginBottom: 4, display: 'block' }} htmlFor="share-expires-at">
              Expiration time (optional):
              <span style={{ color: '#aaa', fontSize: 12, marginLeft: 4 }} title="Sau thời gian này, người nhận sẽ không truy cập được file.">
                (Người nhận sẽ không truy cập được file sau thời điểm này)
              </span>
            </label>
            <input
              id="share-expires-at"
              type="datetime-local"
              value={shareExpiresAt}
              min={new Date().toISOString().slice(0,16)}
              onChange={e => setShareExpiresAt(e.target.value)}
              style={{ width: '100%', marginBottom: 12, padding: 4, color: '#000' }}
              placeholder="YYYY-MM-DD HH:mm"
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
