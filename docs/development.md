# Ricoh Hub: phát triển

App desktop (Tauri 2) xem trạng thái máy in Ricoh IM 3500 trong mạng LAN. Chỉ đọc, không đổi gì trên máy in.

## Chạy

```bash
pnpm install
pnpm tauri dev      # Vite ở cổng 1430, cạnh ClusterSmith ở 1420
pnpm tauri build    # đóng gói .app / .dmg
```

Địa chỉ máy in mặc định là `192.168.1.103` với SNMP community `public`. Đổi trong app ở **Cài đặt › Máy in** (⌘,). Giá trị được lưu ở `settings.json` trong thư mục cấu hình của app (`~/Library/Application Support/com.ricohhub.desktop/`).

## Cách app đọc máy in

Phía Rust (`src-tauri/src/`) gom mọi thứ vào một lệnh `get_snapshot`. Giao diện gọi lệnh này 10 giây một lần, và gọi lại mỗi khi cửa sổ được focus.

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

## Biểu đồ

Biểu đồ ở trang Tổng quan lấy từ [EvilCharts](https://github.com/legions-developer/evilcharts), bản Recharts, cài bằng shadcn CLI. Code nằm ở `src/components/evilcharts/` và được phép sửa trực tiếp.

```bash
pnpm shadcn add @evilcharts/recharts-radial-chart   # registry khai báo trong components.json
```

- Nửa vòng tròn cho mức mực và donut chia số trang (In / Photocopy / Fax) nằm ở `src/components/overview-charts.tsx`. Khay giấy vẫn dùng thanh ngang, vì so sánh các khay bằng thanh dễ hơn bằng vòng tròn.
- Màu truyền vào là token của app (`var(--success)`, `var(--primary)`…), nên biểu đồ tự đổi theo nền sáng hoặc tối.
- Recharts và motion đẩy file JS lên khoảng 900 KB (gzip khoảng 280 KB). Vì vậy Vite báo chunk lớn hơn 500 KB. Với app desktop nạp file từ đĩa thì không đáng lo.

## Kiểm thử

```bash
cd src-tauri
cargo test                                                   # unit test, không cần máy in
RICOH_HOST=192.168.1.103 cargo test live -- --ignored --nocapture   # đọc máy in thật, in ra JSON
```
