# Giai đoạn B: Chạy nền trên menu bar

## Mục tiêu

App tiếp tục đọc máy in khi cửa sổ đóng, để thông báo (C) và lịch sử (D) có dữ liệu.

## Việc cần làm

- Bật feature `tray-icon` của `tauri` 2. Icon menu bar dạng template (đen trắng, macOS tự đổi màu theo sáng/tối), thêm chấm đỏ khi máy có lỗi, vàng khi có cảnh báo.
- Menu của icon: trạng thái một dòng ("Sẵn sàng · mực 20%"), "Mở Ricoh Hub", "In tài liệu…", "Đọc lại", "Thoát".
- Đóng cửa sổ (⌘W, nút đỏ) thì ẩn cửa sổ, không thoát. ⌘Q và mục "Thoát" mới thoát.
- Chuyển vòng đọc máy in từ frontend (10 giây, `setInterval`) sang Rust (tokio task). Frontend nhận snapshot qua event, nên vẫn chạy khi webview ẩn:
  - 10 giây khi cửa sổ mở;
  - 60 giây khi ẩn, để không làm máy thức khỏi Energy Saver liên tục.
- Tự chạy khi đăng nhập (`tauri-plugin-autostart` 2.x), bật/tắt ở Cài đặt, theo quyết định #2.
- Ẩn icon Dock khi cửa sổ đóng (`ActivationPolicy::Accessory`), hiện lại khi mở.

## Kiểm tra

- Đóng cửa sổ, đợi 2 phút: tiến trình vẫn chạy, icon đổi màu khi rút dây mạng máy in (hoặc đổi IP sai trong Cài đặt).
- Đăng xuất và đăng nhập lại: app tự chạy nếu bật.

## Rủi ro

- Polling 60 giây có thể giữ máy không vào Energy Saver. Cần đo: nếu máy không ngủ nữa thì giãn lên 5 phút khi ẩn.
- Thay đổi cách lấy dữ liệu của frontend: cần giữ nguyên hành vi "Đang kết nối lại…".

## Quay lại

Tắt tray và trả polling về frontend; dữ liệu không bị ảnh hưởng.
