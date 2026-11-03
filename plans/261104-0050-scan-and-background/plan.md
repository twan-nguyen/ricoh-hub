# Scan, chạy nền, thông báo và lịch sử

Trạng thái: **A và B đã xong, chờ thử thật**; C và D chưa bắt đầu. Tiếp nối [lộ trình](../261104-0035-feature-roadmap/plan.md), các mục #3 → #6.

Nền: `main` có bản xem trạng thái (`ed34430`). Các nhánh nối tiếp nhau: `feat/print-jobs` (in và hủy lệnh in) → `feat/scan` (A) → `feat/menu-bar` (B). In, scan và menu bar đều chưa thử với máy thật; bạn sẽ tự thử.

## Kết quả mong muốn

1. Scan từ kính hoặc ADF về máy tính, không cần cài driver Ricoh.
2. App sống trên menu bar: đóng cửa sổ không thoát, icon cho biết máy in ổn hay đang có vấn đề.
3. macOS báo khi máy in cần người: hết hoặc sắp hết giấy, mực, kẹt giấy, cửa mở, mất kết nối.
4. Biểu đồ số trang theo ngày và mực theo thời gian, dựa trên dữ liệu app tự lưu.

## Ngoài phạm vi

Sổ địa chỉ, Locked/Stored Print, đóng gói phát hành (lộ trình #7–#9). Scan-to-email/folder chạy trên máy in. Nhiều máy in.

## Các giai đoạn

| # | Giai đoạn | File | Phụ thuộc | Công sức |
|---|---|---|---|---|
| A | Scan về máy (eSCL) | [phase-a-scan.md](phase-a-scan.md) | Không | Vừa–lớn |
| B | Chạy nền trên menu bar | [phase-b-menu-bar.md](phase-b-menu-bar.md) | Không | Nhỏ–vừa |
| C | Thông báo macOS | [phase-c-notifications.md](phase-c-notifications.md) | B | Nhỏ |
| D | Lịch sử và biểu đồ theo ngày | [phase-d-history.md](phase-d-history.md) | B | Vừa |

A độc lập với B–D. C và D chỉ có giá trị khi app chạy liên tục, nên làm sau B. Mỗi giai đoạn là một nhánh `feat/…` và một commit riêng.

## Tiêu chí hoàn thành chung

- Chạy với máy in thật. Scan thử và in thử chỉ khi bạn cho phép.
- Lỗi và trạng thái bằng tiếng Việt; giao diện theo ClusterSmith.
- `cargo test`, `cargo clippy`, `pnpm build` sạch; unit test cho phần phân tích dữ liệu (XML eSCL, so sánh cảnh báo, tính số trang theo ngày).
- `docs/development.md` cập nhật cho lệnh, plugin và quyền mới.

## Quyết định (chốt 2026-11-04)

1. **File scan**: tự lưu vào `~/Downloads/Ricoh Scans`, tên theo giờ scan; có nút Mở và Hiện trong Finder; đổi thư mục ở Cài đặt.
2. **Đóng cửa sổ**: ẩn xuống menu bar, tiếp tục theo dõi; tự chạy khi đăng nhập, tắt được ở Cài đặt.
3. **Thông báo**: cả bốn loại: giấy hết/sắp hết, mực hết/sắp hết (kèm hộp mực thải), kẹt giấy/cửa mở, mất kết nối (sau 3 lần đọc lỗi liên tiếp). Mỗi loại tắt được ở Cài đặt.
4. **Phần in**: commit lên `feat/print-jobs`; đưa vào `main` sau khi bạn in thử thật.

Mặc định khác: lịch sử lưu mỗi 15 phút khi app chạy, giữ vô thời hạn (vài trăm KB mỗi năm); scan nhớ lựa chọn lần trước.
