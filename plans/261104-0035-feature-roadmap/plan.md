# Ricoh Hub: lộ trình tính năng sau bản đầu

Trạng thái: **chờ chọn ưu tiên**. Bản đầu (xem trạng thái, chỉ đọc) đã ở `main`, commit `ed34430`.

Cột "Đã kiểm chứng" dựa trên các lần dò máy in thật ngày 2026-11-03 (xem `plans/reports/feasibility-261103-2254-ricoh-im3500-control-app.md`).

## Danh sách ứng viên

| # | Tính năng | Cần gì | Đã kiểm chứng | Công sức | Rủi ro |
|---|---|---|---|---|---|
| 1 | **In file**: kéo thả PDF/JPEG, chọn số bản, 1 hoặc 2 mặt, khay | IPP Print-Job (crate `ipp` có sẵn) | Máy báo hỗ trợ PDF, JPEG, PostScript; `sides`, `media-source`, `copies` 1–255. Chưa in thử | Vừa | Tốn giấy khi thử; cần bạn cho phép in 1 trang |
| 2 | **Hủy lệnh in** ở màn Lệnh in | IPP Cancel-Job | Máy báo hỗ trợ. Chưa thử; Ricoh có thể đòi quyền | Nhỏ | Lệnh in xong biến mất rất nhanh, nên chỉ hữu ích với lệnh đang chờ |
| 3 | **Scan về máy**: kính hoặc ADF, 2 mặt, 100–600 dpi, PDF/JPEG, chọn nơi lưu | eSCL qua HTTP + XML (`reqwest`), `tauri-plugin-dialog` | Đọc được ScannerCapabilities và ScannerStatus. Chưa scan thử | Vừa–lớn | Luồng job eSCL (tạo job, tải trang, ADF hết giấy) cần thử kỹ |
| 4 | **Chạy nền trên menu bar**: icon theo trạng thái máy, mở nhanh cửa sổ | Tauri tray icon | Không phụ thuộc máy in | Nhỏ–vừa | Thấp |
| 5 | **Thông báo macOS** khi mực hoặc giấy sắp hết, kẹt giấy, cửa mở | `tauri-plugin-notification`, so sánh `printer-state-reasons` giữa hai lần đọc | Đọc được `media-low-warning` | Nhỏ | Chỉ báo khi app đang chạy, nên hợp nhất khi làm cùng #4 |
| 6 | **Lịch sử và biểu đồ theo ngày**: số trang mỗi ngày, mực theo tuần | Lưu snapshot bộ đếm định kỳ (SQLite qua `rusqlite`, hoặc JSON) trong thư mục dữ liệu app | Bộ đếm và mực đọc ổn định | Vừa | Có khoảng trống khi app tắt; hợp nhất khi làm cùng #4 |
| 7 | **Locked / Hold / Stored Print** | Đọc HTML của Web Image Monitor (`webprinter/storedJob.cgi`, không cần đăng nhập) | Trang mở được | Vừa | Dễ hỏng khi Ricoh cập nhật firmware |
| 8 | **Sổ địa chỉ** scan-to-email/folder | Đăng nhập admin Web Image Monitor, lưu mật khẩu trong Keychain | Trang yêu cầu admin | Lớn | Dễ hỏng; cần tài khoản admin |
| 9 | **Đóng gói và phát hành**: `.dmg`, repo GitHub, Homebrew tap như ClusterSmith | `pnpm tauri build`, GitHub Actions | Không phụ thuộc máy in | Nhỏ | Cần quyết định tạo repo GitHub (hiện chưa có remote) |

## Phụ thuộc

- #5 và #6 chỉ có giá trị khi app chạy liên tục, nên nên làm sau hoặc cùng #4.
- #2 dùng chung phần IPP với #1.
- #8 là việc duy nhất cần lưu thông tin đăng nhập.

## Đề xuất thứ tự

1. **#1 + #2 (in và hủy lệnh in)**: hoàn thiện phần "điều khiển" máy in, dùng crate đã có sẵn.
2. **#3 (scan)**: tính năng Web Image Monitor không có.
3. **#4 + #5 + #6 (menu bar, thông báo, lịch sử)**: biến app thành công cụ theo dõi chạy nền.
4. #9 khi muốn chia sẻ app; #7 và #8 chỉ khi thật sự cần.

## Tiêu chí hoàn thành chung cho mỗi tính năng

- Chạy được với máy in thật (in hoặc scan thử chỉ khi bạn cho phép).
- Có trạng thái lỗi rõ ràng bằng tiếng Việt, ví dụ máy tắt, hết giấy hoặc máy từ chối lệnh.
- `cargo test`, `cargo clippy`, `pnpm build` sạch; giao diện theo ClusterSmith.
- Cập nhật `docs/development.md` nếu có lệnh hoặc cấu hình mới.

## Câu hỏi còn mở

1. Làm tính năng nào trước?
2. Có tạo repo GitHub để đẩy `main` lên không? Nếu có thì repo private hay public?
