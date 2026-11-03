# Khả thi: biểu đồ EvilCharts cho trang Tổng quan

Ngày: 2026-11-04. Đã thử trên một bản sao frontend trong thư mục nháp; repo thật chưa bị đổi.

## Kết luận

**Khả thi.** EvilCharts cài được vào ricoh-hub, nhận đúng token màu của ClusterSmith và chạy ở nền tối.

## Về EvilCharts

- Nguồn: [legions-developer/evilcharts](https://github.com/legions-developer/evilcharts), giấy phép MIT, khoảng 3.200 sao, commit gần nhất ngày 2026-10-29.
- Registry `https://evilcharts.com/r/{name}.json` có 302 mục, mỗi loại biểu đồ có bản Recharts và bản ECharts.
- Cài bằng shadcn CLI, code được chép vào `src/components/evilcharts/`. Cần thêm `"@evilcharts": "https://evilcharts.com/r/{name}.json"` vào `registries` trong `components.json`.
- Thêm hai dependency: `recharts` ^3.10 và `motion` ^14.9.

## Kết quả thử

| Hạng mục | Kết quả |
|---|---|
| Cài radial, pie, bar | Tạo 8 file: 3 biểu đồ cộng 5 file phụ trợ |
| TypeScript strict | Một lỗi: import `EvilBrushRange` không dùng trong `recharts-bar-chart.tsx`, sửa một dòng là xong |
| Màu | Truyền `var(--success)`, `var(--warning)`, `var(--primary)` được. Dark mode theo class `.dark`, app đang dùng sẵn class này |
| Bundle JS | 375 KB lên 769 KB (gzip 122 lên 235 KB). App desktop nạp file từ đĩa nên không đáng lo |
| Tooltip khi rê chuột | Chưa xác nhận được trong trình duyệt thử |

Ba biểu đồ đã dựng với số liệu thật:
1. Nửa vòng tròn (`variant="semi"`, `max=100`) cho mực 20 %: rõ ràng, nhưng cần tự đặt số % vào giữa.
2. Vòng tròn đồng tâm cho 3 khay giấy: đẹp, nhưng khó so sánh các khay hơn thanh ngang đang có.
3. Donut số trang theo In / Photocopy / Fax: hợp. Fax bằng 0 nên không hiện cung nào.

## Giới hạn dữ liệu

Máy in chỉ trả về số hiện tại và bộ đếm cộng dồn, không có lịch sử. Muốn có biểu đồ theo thời gian (số trang mỗi ngày, mực giảm theo tuần), app phải tự lưu snapshot định kỳ. Đó là một tính năng riêng.

## Quyết định

Ngày 2026-11-04: dùng nửa vòng tròn cho mực và donut cho số trang; khay giấy giữ thanh ngang.

## Câu hỏi còn mở

1. Có làm phần lưu lịch sử để có biểu đồ theo ngày không?
