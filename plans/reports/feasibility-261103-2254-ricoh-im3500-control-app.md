# Khả thi: ứng dụng điều khiển Ricoh IM 3500 (192.168.1.103)

Ngày kiểm tra: 2026-11-03, từ máy macOS 192.168.1.118 (cùng subnet).
Phương pháp: chỉ đọc (GET / IPP Get-* / SNMP get với community `public`). Không gửi lệnh in, không đăng nhập, không đổi cấu hình.

## Kết luận

**Khả thi.** Máy in mở sẵn 4 giao diện chuẩn, đủ để làm app chạy trên máy này mà không cần SDK của Ricoh.
Chỉ những việc cần quyền admin (sổ địa chỉ, cài đặt) mới phải tự động hóa Web Image Monitor bằng tài khoản admin.

## Giao diện đã xác minh

| Giao diện | Cổng | Kết quả |
|---|---|---|
| IPP 2.0 | `ipp://192.168.1.103:80/printer`, `ipps://…:443/printer` | Hoạt động. Cổng 631 đóng, phải dùng path `/printer` trên 80/443 |
| SNMP v2c | UDP 161, community `public` | Đọc được |
| eSCL (AirScan) | `http(s)://…/eSCL/` | Hoạt động, có thể scan từ xa |
| RAW / LPR | TCP 9100 / 515 | Mở |
| Web Image Monitor | HTTP 80 / HTTPS 443 | Trang guest xem được, admin cần login |

Máy: `RICOH IM 3500 PS3`, firmware System 5.30 / Printer 5.29 / Web 3.00. Đây là máy in đen trắng, có Tray 1, Tray 2 và khay tay (Bypass).

## Chức năng có thể làm và nguồn dữ liệu

| Chức năng | Nguồn | Trạng thái kiểm chứng |
|---|---|---|
| Trạng thái máy (idle / printing / lỗi, Energy Saver) | IPP `printer-state`, SNMP hrPrinterStatus + alert table | Đã đọc được |
| Mực còn lại (%) | IPP `marker-levels` = 20, Ricoh MIB `.367.3.2.1.2.24.1.1.5` = 20 | Đã đọc được (MIB chuẩn trả 5, không dùng) |
| Hộp mực thải | SNMP prtMarkerSupplies | Đã đọc được |
| Khay giấy: khổ, sức chứa, mức | IPP `printer-input-tray`, SNMP prtInput | Đã đọc được (Tray 1: 385/550, Tray 2: 55/550) |
| Bộ đếm trang (tổng, copy, print, A3, duplex, scan) | SNMP Ricoh `.367.3.2.1.2.19.5.1.{6,9}` | Đã đọc được (tổng 61188) |
| In file: PDF, JPEG, PostScript; 1 hoặc 2 mặt; chọn khay; 1–255 bản | IPP Print-Job | Máy báo hỗ trợ, **chưa in thử** |
| Xem hàng đợi và lịch sử job | IPP Get-Jobs | Gọi được (hiện đang trống) |
| Hủy job | IPP Cancel-Job | Máy báo hỗ trợ, chưa thử |
| Pause / Resume / Purge máy in | IPP | Máy báo hỗ trợ, có thể cần admin, chưa thử |
| Scan từ kính hoặc ADF, có duplex, 100–600 dpi, ra PDF/JPEG/TIFF | eSCL | Đọc được capabilities, **chưa scan thử** |
| Locked / Hold / Stored Print | WIM `webprinter/storedJob.cgi` (guest xem được) | Xem được danh sách |
| Sổ địa chỉ (scan-to-email/folder) | WIM `address/adrsList.cgi` | **Cần đăng nhập admin** |
| Đổi cài đặt máy | WIM | Cần admin |

## Rủi ro và giới hạn

- **Web Image Monitor khó tự động hóa.** Giao diện dùng frameset cũ và `wimToken` thay đổi mỗi phiên. Login gửi userid/password chỉ mã hóa base64 qua `login.cgi`, nên nên dùng HTTPS (443). Ricoh có thể đổi HTML khi cập nhật firmware, làm app gãy. Chỉ nên làm phần này nếu thật sự cần.
- **IPP không có xác thực thật** (`requesting-user-name`). Ai trong LAN cũng in hoặc hủy job được, app không làm thay đổi điều đó.
- **Mức mực không chính xác tuyệt đối.** Ricoh báo theo nấc (20 %), không theo từng phần trăm.
- **SNMP `public` chỉ đọc.** App sẽ không ghi gì qua SNMP.
- **Máy hay vào Energy Saver.** Lệnh đầu tiên có thể chậm vài giây trong lúc máy khởi động lại.

## Đề xuất kiến trúc

App web nội bộ chạy trên máy này, gồm Node.js 20 (đã có sẵn) làm backend và một trang HTML làm giao diện, mở tại `http://localhost:<port>`.
Backend gọi IPP (thư viện `ipp`), SNMP (`net-snmp`) và eSCL (HTTP + XML). Phần WIM để sau, tùy nhu cầu.

## Câu hỏi còn mở

1. Bạn cần những chức năng nào: in, xem trạng thái, scan, xem bộ đếm, sổ địa chỉ…?
2. Có cần phần chỉ admin làm được (sổ địa chỉ, cài đặt) không? Nếu cần, bạn có tài khoản admin không?
3. Bạn có cho phép in thử 1 trang và scan thử 1 lần để xác minh hết luồng trước khi code không?

## Bổ sung 2026-11-03: Tauri + Rust

**Khả thi.** Đã chạy thử một chương trình Rust ngoài repo, đọc máy in thật thành công ngay lần đầu.

- Môi trường: Rust 1.99.1, Xcode có sẵn; `clustersmith` đã dùng Tauri 2 trên máy này.
- `ipp` 8.0.0 (feature `async-client`, cập nhật 2026-10-25): Get-Printer-Attributes và Get-Jobs trả `successful-ok`. Đọc được trạng thái, model, mực 20 %, 4 dòng `printer-input-tray`. Mất khoảng 1 giây, phần lớn là do máy in đang ở Energy Saver.
- `snmp2` 0.5.3 (feature `tokio`, cập nhật 2026-11-02): GET đọc được serial máy và mực Ricoh 20 %. Walk bằng GETBULK lấy đủ 186 bộ đếm trong khoảng 120 ms.
- eSCL chỉ là HTTP + XML, dùng `reqwest` (đã kéo theo qua `ipp`) là đủ, chưa cần thử riêng.

Kiến trúc: React + Vite + Tailwind ở webview. Phần Rust trong `src-tauri` gọi SNMP, IPP, eSCL và trả dữ liệu qua `invoke` command. Không cần server riêng, không vướng CORS.

Đánh đổi so với bản web: app chỉ mở được trên máy cài nó (macOS, có thể build thêm cho Windows), điện thoại trong LAN không xem được. Lần build Tauri đầu tiên mất vài phút.
