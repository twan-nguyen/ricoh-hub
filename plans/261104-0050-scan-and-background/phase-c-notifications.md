# Giai đoạn C: Thông báo macOS

## Mục tiêu

Báo đúng lúc máy cần người, không báo lặp.

## Việc cần làm

- `tauri-plugin-notification` 2.x; xin quyền thông báo lần đầu bật.
- Rust so sánh `printer-state-reasons` (và trạng thái kết nối) giữa hai lần đọc. Chỉ báo khi một lý do **mới xuất hiện**, không báo lại khi nó vẫn còn. Báo "đã ổn" khi lỗi nghiêm trọng hết, ví dụ hết kẹt giấy.
- Nội dung tiếng Việt, dùng lại bảng `REASONS` trong `format.ts`; chuyển bảng sang Rust hoặc gửi khóa để frontend dịch.
- Ví dụ: "Ricoh IM 3500: Khay 2 sắp hết giấy (55 tờ)".
- Mất kết nối chỉ báo sau 3 lần đọc lỗi liên tiếp, để tránh báo nhầm khi máy đang thức dậy.
- Cài đặt: bật/tắt từng loại theo quyết định #3.

## Kiểm tra

- Unit test cho hàm so sánh: lý do mới thì báo, lý do cũ thì im, hết lỗi thì báo đã ổn, mất kết nối 1–2 lần thì im, lần thứ 3 thì báo.
- Thử thật: mở khay giấy trên máy (máy báo `media-empty` / `input-tray-missing`), xem thông báo hiện ra.

## Rủi ro

Thấp. Nếu máy báo một lý do bật tắt liên tục thì thêm thời gian chờ 10 phút cho mỗi lý do.
