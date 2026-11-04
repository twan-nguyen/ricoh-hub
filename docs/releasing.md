# Phát hành Ricoh Hub

Ghi chú vận hành cho chủ repo. Người dùng cài app bằng Homebrew:

```bash
brew install --cask twan-nguyen/ricoh/ricoh-hub
```

Cask dùng stanza `postflight_steps`, chỉ có từ Homebrew 6.0.16. Máy chạy Homebrew cũ hơn sẽ báo cask không đọc được, nên cần chạy `brew update` trước khi cài.

## Phát hành bản mới

1. Commit và push mọi thay đổi lên `main`.
2. Tạo tag phiên bản rồi push tag:

   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```

3. Theo dõi CI. Bản build universal mất khoảng 10–15 phút:

   ```bash
   gh run watch --repo twan-nguyen/ricoh-hub
   ```

4. Kiểm tra cask đã trỏ sang bản mới, rồi cập nhật trên máy:

   ```bash
   gh api repos/twan-nguyen/homebrew-ricoh/contents/Casks/ricoh-hub.rb --jq .content | base64 -d | grep 'version "'
   brew update && brew upgrade --cask ricoh-hub
   ```

Workflow [release.yml](../.github/workflows/release.yml) làm lần lượt các bước sau:
- Build `Ricoh Hub.app` universal, chạy được cả trên Apple Silicon lẫn Intel. App được ký ad-hoc.
- Nén app thành `Ricoh-Hub-X.Y.Z.zip` (không có dấu cách, để URL tải gọn) và tạo GitHub Release.
- Ghi lại `Casks/ricoh-hub.rb` trong [homebrew-ricoh](https://github.com/twan-nguyen/homebrew-ricoh) với phiên bản và `sha256` mới.

### Quy tắc

- Tag phải có dạng `vX.Y.Z`. Tag sai dạng làm CI dừng ngay.
- Số phiên bản lấy từ tag, nên không cần sửa `version` trong `tauri.conf.json` hay `Cargo.toml`.
- App không có chữ ký Developer ID và không được notarize. Cask tự gỡ cờ quarantine sau khi cài, nên Gatekeeper không chặn. Nếu tải zip bằng trình duyệt thì phải gỡ tay: `xattr -dr com.apple.quarantine "/Applications/Ricoh Hub.app"`.

### Khi phát hành hỏng

Xem log bằng `gh run view --log-failed --repo twan-nguyen/ricoh-hub`. Sửa lỗi, rồi xoá release và tag cũ trước khi gắn lại:

```bash
gh release delete v0.1.0 --cleanup-tag --yes --repo twan-nguyen/ricoh-hub
git tag -d v0.1.0
git tag v0.1.0 && git push origin v0.1.0
```

## Deploy key cho tap

CI đẩy cask lên tap bằng một deploy key có quyền ghi. Secret `TAP_DEPLOY_KEY` của repo ricoh-hub giữ khoá riêng, còn repo `homebrew-ricoh` giữ khoá công khai.

Tạo hoặc thay khoá:

```bash
ssh-keygen -t ed25519 -N "" -C "ricoh-hub release" -f ~/ricoh-hub-tap-key
gh repo deploy-key add ~/ricoh-hub-tap-key.pub --repo twan-nguyen/homebrew-ricoh --allow-write --title "ricoh-hub release"
gh secret set TAP_DEPLOY_KEY --repo twan-nguyen/ricoh-hub < ~/ricoh-hub-tap-key
rm ~/ricoh-hub-tap-key ~/ricoh-hub-tap-key.pub
```

Khoá không lưu lại trên máy nào. Khi mất khoá, chỉ cần xoá deploy key cũ trong Settings > Deploy keys của `homebrew-ricoh` rồi tạo lại bằng các lệnh trên.

## Build trên máy, không qua phát hành

```bash
pnpm tauri build --bundles app
```

App nằm ở `src-tauri/target/release/bundle/macos/Ricoh Hub.app`. Muốn build bản universal như CI thì chạy `rustup target add x86_64-apple-darwin` một lần, rồi thêm `--target universal-apple-darwin`.

## Ghi chú

- "Mở khi đăng nhập" chỉ có tác dụng ở bản đóng gói. App tạo `~/Library/LaunchAgents/Ricoh Hub.plist` trỏ vào `/Applications/Ricoh Hub.app`, nên vẫn đúng sau `brew upgrade`.
- `brew uninstall --cask ricoh-hub` giữ lại mục mở khi đăng nhập, để lần nâng cấp không làm mất nó. Muốn gỡ sạch thì dùng `brew uninstall --cask --zap ricoh-hub`: lệnh này xoá cài đặt, lịch sử (`history.db`), dữ liệu WebView và mục mở khi đăng nhập. File scan trong `~/Downloads/Ricoh Scans` được giữ nguyên.
