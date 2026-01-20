# Cải Tiến Tính Năng Expire Time

## Tổng Quan
Đã cải tiến tính năng expire time cho file sharing với các chức năng sau:

### ✅ Chức Năng Đã Có Sẵn
1. **Set Expire Time**: Người gửi có thể set thời gian expire khi chia sẻ file/folder
2. **Hiển thị Expire Time**: Người nhận có thể thấy thời gian expire
3. **Xóa Tự Động Khi Load**: File đã hết hạn sẽ bị xóa khi user refresh trang
4. **Kiểm tra Khi Mở File**: Người dùng không thể mở file đã hết hạn

### 🆕 Cải Tiến Mới
1. **Auto-Cleanup Định Kỳ (Client-side)**
   - Tự động kiểm tra và xóa file hết hạn mỗi 60 giây
   - Không cần user phải refresh trang
   - Cập nhật UI tự động khi file bị xóa

2. **Countdown Timer Động**
   - Hiển thị thời gian còn lại dưới dạng countdown (vd: "2h 15m left")
   - Cập nhật mỗi giây
   - Màu sắc thay đổi theo mức độ khẩn cấp:
     - Xám (#6b7280): Còn nhiều thời gian
     - Cam (#f59e0b): Dưới 1 phút
     - Đỏ (#dc2626): Đã hết hạn

3. **Tooltip Hover**
   - Hiển thị thời gian expire chính xác khi hover
   - Format: "Expires at: [ngày giờ cụ thể]"

## Chi Tiết Kỹ Thuật

### Component: ExpiresCountdown
**Location**: `/src/pages/Dashboard.jsx` (lines 11-74)

**Features**:
- Real-time countdown timer
- Auto-update every second
- Color-coded urgency levels
- Tooltip with exact expiration time
- Graceful handling of expired items

**Props**:
- `expiresAt`: ISO string or datetime string

**Display Format**:
- Days: "Xd Yh left"
- Hours: "Xh Ym left"
- Minutes: "Xm Ys left"
- Seconds: "Xs left"
- Expired: "Expired"

### Auto-Cleanup Logic
**Location**: `/src/pages/Dashboard.jsx` (useEffect hook)

**Implementation**:
```javascript
setInterval(async () => {
  const now = new Date()
  const expiredFileShares = sharedFiles.filter(f => f.expires_at && new Date(f.expires_at) < now)
  
  if (expiredFileShares.length > 0) {
    // Delete from database
    for (const file of expiredFileShares) {
      await supabase.from('file_shares').delete().eq('id', file.shared_id)
    }
    // Update UI
    setSharedFiles(prev => prev.filter(f => !f.expires_at || new Date(f.expires_at) > now))
  }
}, 60000) // Every 60 seconds
```

## Trải Nghiệm Người Dùng

### Người Gửi (Sender)
1. Upload file hoặc folder
2. Click nút "Share"
3. Nhập username người nhận
4. **Chọn thời gian expire** (tùy chọn) bằng datetime picker
5. Click "Share"

### Người Nhận (Receiver)
1. Thấy file được share trong danh sách "Shared Files"
2. Thấy **countdown timer** hiển thị thời gian còn lại (vd: "2h 30m left")
3. Hover vào timer để thấy **thời gian chính xác** (vd: "Expires at: 1/20/2026, 3:30:00 PM")
4. Timer **tự động cập nhật** mỗi giây
5. Khi timer về 0, file **tự động biến mất** sau tối đa 60 giây (không cần refresh)
6. Màu sắc thay đổi khi sắp hết hạn:
   - Xám: Bình thường
   - Cam: Dưới 1 phút
   - Đỏ: Đã hết hạn

## Files Modified
- `/Users/nguyenthang/123456/src/pages/Dashboard.jsx`
  - Added `ExpiresCountdown` component
  - Added auto-cleanup interval in `useEffect`
  - Replaced static expire time display with dynamic countdown

## Testing Checklist
- [ ] Set expire time khi share file
- [ ] Kiểm tra countdown timer hiển thị đúng
- [ ] Kiểm tra timer tự động update mỗi giây
- [ ] Kiểm tra màu sắc thay đổi khi sắp hết hạn
- [ ] Kiểm tra tooltip hiển thị thời gian chính xác
- [ ] Kiểm tra file tự động bị xóa sau khi hết hạn (sau tối đa 60s)
- [ ] Kiểm tra UI update tự động khi file bị xóa
- [ ] Test với nhiều file có expire time khác nhau
- [ ] Test với file không có expire time (hiển thị "-")
