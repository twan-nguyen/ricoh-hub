# Giai đoạn D: Lịch sử và biểu đồ theo ngày

## Mục tiêu

Trả lời được "tuần này in bao nhiêu trang", "mực tụt nhanh cỡ nào" mà máy in không tự lưu.

## Dữ liệu

- SQLite (`rusqlite`, feature `bundled`) ở `~/Library/Application Support/com.ricohhub.desktop/history.db`.
- Bảng `readings(at INTEGER, total, print, copy, fax, scanned, duplex, large, toner)`.
- Lưu khi một bộ đếm đổi, hoặc tối đa mỗi 15 phút. Mỗi năm vài chục nghìn dòng, vài trăm KB.
- Số trang theo ngày = chênh lệch bộ đếm cộng dồn giữa lần đọc cuối của ngày đó và của ngày trước. Khoảng app tắt sẽ dồn vào ngày đọc lại đầu tiên; biểu đồ đánh dấu những ngày như vậy.

## Việc cần làm

- `src-tauri/src/history.rs`: tạo bảng, ghi, truy vấn `pages_per_day(from, to)` và `toner_series(from, to)`.
- Màn "Thống kê" ở sidebar dùng EvilCharts (đã có trong repo):
  - cột số trang theo ngày, xếp chồng In / Photocopy (cần thêm `@evilcharts/recharts-bar-chart`; sửa import thừa đã biết);
  - đường mức mực theo thời gian;
  - chọn 7 ngày / 30 ngày / 12 tháng.
- Tổng quan: thêm "Hôm nay: N trang".

## Kiểm tra

- Unit test với SQLite trong bộ nhớ: chênh lệch theo ngày, ngày không có dữ liệu, bộ đếm bị reset (giá trị giảm thì bỏ qua).
- Chạy app nửa ngày; số trang hôm nay khớp với bộ đếm máy trừ số đầu ngày.

## Rủi ro

- Biểu đồ trống trong vài ngày đầu. Màn hình phải nói rõ "Đang thu thập, quay lại sau vài ngày".
- Sao lưu: file DB nằm trong thư mục app; ghi chú cách sao lưu trong docs. Không có thay đổi schema phá dữ liệu ở giai đoạn này.

## Quay lại

Xóa `history.db` và màn Thống kê; phần còn lại của app không phụ thuộc.
