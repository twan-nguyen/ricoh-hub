# Ricoh Hub: phát triển

App desktop (Tauri 2) cho máy in Ricoh IM 3500 trong mạng LAN: xem trạng thái, in, scan, và theo dõi máy in từ menu bar. App không đổi cấu hình nào trên máy in.

## Chạy

```bash
pnpm install
pnpm tauri dev      # Vite ở cổng 1430, cạnh ClusterSmith ở 1420
pnpm tauri build    # đóng gói .app / .dmg
```

Phát hành qua Homebrew: xem [releasing.md](releasing.md).

Địa chỉ máy in mặc định là `192.168.1.103` với SNMP community `public`. Đổi trong app ở **Cài đặt › Chung** (⌘,). Giá trị được lưu ở `settings.json` trong thư mục cấu hình của app (`~/Library/Application Support/com.ricohhub.desktop/`).

## Cách app đọc máy in

Phía Rust (`src-tauri/src/`) gom mọi thứ vào một lần đọc (`snapshot::read_snapshot`). `monitor.rs` chạy lần đọc này theo nhịp riêng, kể cả khi cửa sổ đã đóng, rồi gửi kết quả cho giao diện qua event `printer-status`. Giao diện lấy trạng thái hiện có bằng `get_status` và nhờ đọc ngay bằng `refresh_printer` (⌘R, hoặc mỗi khi cửa sổ được focus).

| Nguồn | File | Lấy gì |
|---|---|---|
| IPP qua `http://<host>:80/printer` | `printer_ipp.rs` | Trạng thái máy, cảnh báo (`printer-state-reasons`), % mực, khay giấy, lệnh in |
| SNMP v2c, cổng 161 | `snmp.rs`, `snapshot.rs` | Serial, firmware, thời gian chạy, thông báo trên màn hình máy, bảng bộ đếm riêng của Ricoh |

Những điều riêng của máy này, đã kiểm chứng trên IM 3500 firmware 5.30:

- Cổng IPP 631 đóng. Máy chỉ trả lời IPP ở đường dẫn `/printer` trên cổng 80.
- Mức hộp mực thải qua SNMP luôn là 100/100, kể cả khi máy báo bình thường. App chỉ dựa vào cảnh báo `marker-waste-*` của IPP.
- Bộ đếm được tìm theo tên Ricoh đặt (ví dụ `Counter: Machine Total`), không theo số thứ tự, vì thứ tự có thể đổi khi cập nhật firmware.
- Máy in xóa lệnh đã in xong khỏi IPP gần như ngay lập tức, nên danh sách Lệnh in thường trống.
- `snmp2` phải bật feature `heap_buffers`. Nếu không, bộ đệm 64 KB nằm trên stack và làm tràn stack.

## In và hủy lệnh in

`src-tauri/src/printing.rs` gửi IPP Print-Job và Cancel-Job. Giao diện ở `src/components/print-view.tsx` (⌘P) và nút hủy ở màn Lệnh in.

- Máy chỉ nhận PDF, JPEG và PostScript. File khác bị chặn ngay trong app, kèm lời nhắc xuất sang PDF.
- Tùy chọn gửi đi: `copies`, `sides`, `page-ranges`, và khay qua `media-col.media-source`. Máy này không nhận `media-source` đứng riêng ngoài `media-col`.
- Người gửi là tên user macOS (`$USER`), nên Ricoh hiển thị đúng người trong lịch sử in.
- Máy chỉ hỗ trợ `job-hold-until = no-hold`, nên không thể giữ lệnh lại. Lệnh in ngắn thường in xong trước khi kịp hủy; nút hủy hữu ích nhất với lệnh dài hoặc đang xếp hàng.
- Kéo file vào bất kỳ đâu trong cửa sổ sẽ mở màn In tài liệu với file đó.

Hai test với máy thật, không in trang nào:

```bash
cd src-tauri
RICOH_HOST=192.168.1.103 cargo test live_ -- --ignored --skip live_snapshot
```

`live_validate_prints_nothing` gửi Validate-Job với đủ tùy chọn. `live_cancel_unknown_job_is_not_found` hủy một mã lệnh không tồn tại.

## Scan

`src-tauri/src/scanning.rs` nói chuyện với máy qua eSCL (`http://<host>/eSCL/`, HTTP + XML). Giao diện ở `src/components/scan-view.tsx`.

- Luồng: `POST /eSCL/ScanJobs` gửi `ScanSettings`, lấy job từ header `Location`. Sau đó gọi lặp `GET {job}/NextDocument`; mỗi lần trả về 200 là một file, 404 là hết, 503 thì chờ rồi hỏi lại. Hủy bằng `DELETE {job}`.
- Tùy chọn được kiểm tra trước với `ScannerCapabilities`: nguồn, 2 mặt (chỉ ADF), màu, dpi, định dạng, khổ. Vùng scan tính theo đơn vị 1/300 inch.
- Khi chọn khay nạp, app đọc `ScannerStatus.AdfState` trước khi scan, và cứ 3 giây đọc lại một lần khi màn Scan đang mở.
- File lưu vào `~/Downloads/Ricoh Scans`, hoặc thư mục chọn ở Cài đặt. Tên file theo giờ scan, ví dụ `Scan 2026-11-04 01.30.12.pdf`. Job trả nhiều file thì thêm ` (2)`, ` (3)`…
- Lệnh `open_scan` và `reveal_scan` chỉ mở file nằm trong thư mục scan.
- `src-tauri/src/fixtures/` chứa XML thật của máy (đã ẩn serial, UUID) cho unit test.

Test với máy thật:

```bash
cd src-tauri
RICOH_HOST=192.168.1.103 cargo test live_scanner -- --ignored --nocapture        # chỉ đọc
RICOH_SCAN=1 cargo test live_scan_glass -- --ignored --nocapture                 # scan mặt kính 1 lần
```

## Menu bar

App sống trên menu bar (`src-tauri/src/tray.rs`). Đóng cửa sổ (nút đỏ, ⌘W) chỉ ẩn cửa sổ và icon Dock; app vẫn theo dõi máy in. Muốn thoát hẳn thì dùng ⌘Q hoặc mục "Thoát Ricoh Hub" trong menu của icon.

- Nhịp đọc: 10 giây khi cửa sổ mở, 60 giây khi ẩn, để máy in vẫn vào được Energy Saver. Lần đọc chưa xong thì không chồng thêm lần đọc mới.
- Icon là ảnh template: macOS tự tô theo màu menu bar sáng hoặc tối, nên trạng thái được thể hiện bằng hình chứ không bằng màu. Icon bình thường là máy in; có cảnh báo thì thêm vòng tròn rỗng; có lỗi hoặc máy dừng thì thêm chấm đặc; không đọc được máy thì icon mờ. Dòng đầu của menu ghi trạng thái, ví dụ `Sẵn sàng · mực 20%`.
- Đổi địa chỉ máy in thì số liệu cũ bị xóa ngay. Nếu đang có lần đọc với địa chỉ cũ, kết quả của lần đó bị bỏ.
- Mở khi đăng nhập: bật sẵn, tắt được ở **Cài đặt › Chung**, mục Ứng dụng. App dùng `tauri-plugin-autostart` để tạo LaunchAgent, truyền tham số `--hidden` để app khởi động thẳng vào menu bar. Bản dev (`pnpm tauri dev`) không tạo LaunchAgent, vì LaunchAgent trỏ tới file debug sẽ mở một cửa sổ trống khi không có Vite.

Icon nằm ở `src-tauri/icons/tray/`. Muốn sửa thì sửa file `.svg`, rồi tạo lại `.png` (36 px, tức 18 pt @2x):

```bash
cd src-tauri/icons/tray
for f in ok warning error offline; do rsvg-convert $f.svg -o $f.png; done
```

## Thông báo

`src-tauri/src/notifications.rs` so sánh mỗi lần đọc với lần trước, rồi gửi thông báo macOS qua `tauri-plugin-notification`. Bật/tắt từng loại ở **Cài đặt › Chung**, mục Thông báo.

| Loại | Báo khi | Báo "đã ổn" |
|---|---|---|
| Giấy | Một khay hết giấy, hoặc còn ≤ 15% sức chứa (cùng ngưỡng với thẻ Khay giấy). Khay tay không tính | Khay hết giấy đã có giấy |
| Mực | Hết hoặc sắp hết mực (≤ 10% hoặc máy báo `toner-low`); hộp mực thải sắp đầy hoặc đã đầy | Hết mực, hộp thải đầy |
| Kẹt giấy, cửa mở | `media-jam`, `door-open`/`cover-open`, `input-tray-missing` | Cả ba |
| Mất kết nối | 3 lần đọc lỗi liên tiếp, chỉ khi đã từng đọc được máy từ lúc mở app | Kết nối lại |

- Mỗi sự cố chỉ báo một lần, lúc nó xuất hiện. Khi mở app, chỉ báo những sự cố làm máy dừng (hết giấy, kẹt, cửa mở, hết mực…). Cảnh báo như "sắp hết" không bị nhắc lại mỗi lần đăng nhập.
- Máy Mac mang ra khỏi văn phòng sẽ không báo mất kết nối, vì từ lúc mở app chưa từng đọc được máy in.
- Đổi địa chỉ máy in thì bắt đầu so sánh lại từ đầu.
- Bản dev gửi thông báo dưới tên và icon của Terminal (do plugin quy định). Bản đóng gói dùng tên Ricoh Hub, và macOS hỏi quyền ở lần báo đầu tiên.

Xem máy in thật đang có sự cố nào và lúc mở app sẽ báo gì (không gửi thông báo):

```bash
cd src-tauri
RICOH_HOST=192.168.1.103 cargo test live_launch_notices -- --ignored --nocapture
```

## Lịch sử và thống kê

`src-tauri/src/history.rs` ghi bộ đếm vào SQLite (`rusqlite`, feature `bundled`) ở `~/Library/Application Support/com.ricohhub.desktop/history.db`. Màn **Thống kê** (`src/components/stats-view.tsx`) vẽ số trang theo ngày và mức mực; Tổng quan có thêm dòng "Hôm nay".

- Bảng `readings(host, at, total, print, copy, fax, scanned, duplex, large, toner)`; `at` là mili giây từ epoch. Mỗi máy in (theo `host`) có lịch sử riêng.
- Một dòng được ghi khi có số đổi, và ít nhất 15 phút một lần khi app chạy, kể cả lúc ẩn trên menu bar. Khoảng vài chục nghìn dòng mỗi năm, vài MB.
- Số trang của một ngày = lần đọc cuối của ngày đó trừ lần đọc cuối trước đó. Bộ đếm giảm (bị reset) thì ngày đó tính 0.
- Ngày app không chạy thì không có cột. Số trang của những ngày đó dồn vào ngày app chạy lại, và cột đó có dấu `*`. Ngày đầu tiên app chạy chỉ tính từ lần đọc đầu tiên, cũng có dấu `*`.
- Khoảng thời gian: 7 ngày, 30 ngày (theo ngày), hoặc 12 tháng (theo tháng). Ngày tính theo múi giờ của máy Mac.
- Ba ngày đầu, màn Thống kê ghi rõ "Đang thu thập số liệu".
- Sao lưu: chép file `history.db` khi app đã thoát. Xóa file này thì chỉ mất lịch sử; phần còn lại của app vẫn chạy bình thường.

```bash
sqlite3 ~/Library/Application\ Support/com.ricohhub.desktop/history.db \
  "SELECT datetime(at/1000,'unixepoch','localtime'), total, toner FROM readings ORDER BY at DESC LIMIT 5"
```

## Biểu đồ

Biểu đồ ở trang Tổng quan lấy từ [EvilCharts](https://github.com/legions-developer/evilcharts), bản Recharts, cài bằng shadcn CLI. Code nằm ở `src/components/evilcharts/` và được phép sửa trực tiếp.

```bash
pnpm shadcn add @evilcharts/recharts-radial-chart   # registry khai báo trong components.json
```

- Nửa vòng tròn cho mức mực và donut chia số trang (In / Photocopy / Fax) nằm ở `src/components/overview-charts.tsx`. Khay giấy vẫn dùng thanh ngang, vì so sánh các khay bằng thanh dễ hơn bằng vòng tròn.
- Màn Thống kê dùng biểu đồ cột (`recharts-bar-chart`) và đường (`recharts-line-chart`). Bản tải về import thừa kiểu `EvilBrushRange` làm `tsc` báo lỗi; đã xóa import đó, nhớ xóa lại nếu tải đè bằng `pnpm shadcn add`.
- Màu truyền vào là token của app (`var(--success)`, `var(--primary)`…), nên biểu đồ tự đổi theo nền sáng hoặc tối.
- Recharts và motion đẩy file JS lên khoảng 900 KB (gzip khoảng 280 KB). Vì vậy Vite báo chunk lớn hơn 500 KB. Với app desktop nạp file từ đĩa thì không đáng lo.

## Kiểm thử

```bash
cd src-tauri
cargo test                                                   # unit test, không cần máy in
RICOH_HOST=192.168.1.103 cargo test live -- --ignored --nocapture   # đọc máy in thật, in ra JSON
```
