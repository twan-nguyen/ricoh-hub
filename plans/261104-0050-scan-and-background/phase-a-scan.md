# Giai đoạn A: Scan về máy qua eSCL

## Bối cảnh (đã đọc từ máy, 2026-11-04)

- `GET /eSCL/ScannerCapabilities`: eSCL 2.63, nguồn `Platen` và `Adf`; ADF có `Duplex`, `DetectPaperLoaded`, `SelectSinglePage`.
- Vùng tối đa 3507 × 5102 (đơn vị 1/300 inch), tức 297 × 432 mm.
- Màu `BlackAndWhite1`, `Grayscale8`, `RGB24`; 100–600 dpi; `application/pdf`, `image/jpeg`, `image/tiff`.
- `GET /eSCL/ScannerStatus`: `State` (Idle/Processing), `AdfState` (`ScannerAdfEmpty`, `ScannerAdfLoaded`, …).
- Chưa thử tạo job scan; chưa biết máy có đòi đăng nhập ở `POST /eSCL/ScanJobs` không.

## Luồng eSCL

1. `POST /eSCL/ScanJobs` với `ScanSettings` (InputSource, ColorMode, X/YResolution, DocumentFormatExt, Duplex, ScanRegion) → `201 Created`, header `Location: /eSCL/ScanJobs/{id}`.
2. Lặp `GET {Location}/NextDocument` → mỗi lần một tài liệu; `404` là hết trang.
3. Hủy: `DELETE {Location}`.

Chưa biết: với PDF qua ADF, máy trả một PDF nhiều trang hay mỗi trang một PDF. Nếu nhiều PDF thì ghép bằng `lopdf`; xác minh ở lần scan thử đầu.

## Việc cần làm

- Rust `src-tauri/src/scanning.rs`:
  - đọc capabilities và status (`quick-xml`);
  - `scan(options) -> Vec<PathBuf>` chạy luồng trên, ghi file, phát tiến độ từng trang qua `Channel`;
  - `cancel_scan()`.
- Lỗi tiếng Việt: ADF trống, máy bận, máy đòi đăng nhập, kẹt giấy bản gốc (`AdfState`).
- Giao diện `scan-view.tsx` (mục "Scan" ở sidebar):
  - nguồn (Kính / Khay nạp bản gốc), 2 mặt (chỉ ADF), màu (Đen trắng / Xám / Màu), độ phân giải (200 / 300 / 600), khổ (A4 / A3 / Letter), định dạng (PDF / JPEG);
  - trạng thái ADF trực tiếp ("Đã có giấy trong khay nạp");
  - tiến độ "Đang scan trang 3…", nút hủy;
  - xong thì hiện file với nút "Mở" và "Hiện trong Finder".
- Lưu theo quyết định #1 trong `plan.md`.

## Kiểm tra

- Unit test: dựng XML ScanSettings, đọc capabilities/status từ XML mẫu của chính máy này.
- Live test (bỏ qua mặc định): đọc capabilities/status.
- Scan thử thật **chỉ khi được phép**: 1 trang trên kính, PDF xám 200 dpi; rồi ADF 2 trang 2 mặt để xác minh PDF nhiều trang.

## Rủi ro

- Máy có thể đòi xác thực cho ScanJobs; khi đó cần thêm tài khoản (Keychain).
- Scan đang chạy mà đóng app: phải `DELETE` job để máy không kẹt ở trạng thái bận.

## Quay lại

Nhánh riêng; bỏ nhánh là xong, không đụng phần khác.
