# Claude hooks trong repo này

Tài liệu này giải thích ngắn gọn từng hook trong [.claude/hooks/hooks.json](.claude/hooks/hooks.json).

## Cách đọc nhanh

- **PreToolUse**: chặn hoặc nhắc trước khi tool chạy.
- **PostToolUse**: log, kiểm tra, hoặc gom trạng thái sau khi tool chạy.
- **PostToolUseFailure**: xử lý khi tool fail.
- **PreCompact**: lưu trạng thái trước khi Claude compact context.
- **SessionStart**: bootstrap khi mở session.
- **Stop**: chạy ở cuối mỗi lượt trả lời.
- **SessionEnd**: chạy khi session kết thúc hẳn.

---

## PreToolUse

### `pre:bash:block-no-verify`
Chặn `--no-verify` trong lệnh git để không bypass pre-commit, commit-msg, pre-push.

### `pre:bash:auto-tmux-dev`
Tự bật dev server trong tmux theo thư mục làm việc. Giảm việc chạy server thủ công.

### `pre:bash:tmux-reminder`
Nhắc dùng tmux cho lệnh chạy lâu. Mục tiêu là tránh mất tiến trình khi session đổi trạng thái.

### `pre:bash:git-push-reminder`
Nhắc rà lại thay đổi trước khi `git push`. Là soft guard trước khi tác động remote.

### `pre:bash:commit-quality`
Check trước commit: lint staged files, format commit message, phát hiện `console.log`, `debugger`, secret.

### `pre:write:doc-file-warning`
Cảnh báo khi tạo file docs không theo convention. Chỉ warn, không block.

### `pre:edit-write:suggest-compact`
Nhắc compact thủ công ở các mốc hợp lý để giảm context noise.

### `pre:governance-capture`
Ghi nhận sự kiện governance như secret, policy violation, approval request. Chỉ hoạt động khi bật `ECC_GOVERNANCE_CAPTURE=1`.

### `pre:config-protection`
Chặn sửa file config kiểu linter/formatter. Ép sửa code thay vì nới luật.

### `pre:mcp-health-check`
Check health MCP server trước khi gọi tool liên quan MCP. Nếu server unhealthy thì block sớm.

---

## PreCompact

### `pre:compact`
Lưu state trước khi compact context để giữ continuity giữa các vòng làm việc.

---

## SessionStart

### `session:start`
Bootstrap session mới: nạp context cũ và detect package manager của repo.

---

## PostToolUse

### `post:bash:command-log-audit`
Log toàn bộ lệnh Bash vào `~/.claude/bash-commands.log` cho mục đích audit.

### `post:bash:command-log-cost`
Log usage của Bash kèm timestamp để theo dõi cost và hành vi dùng shell.

### `post:bash:pr-created`
Sau khi tạo PR, ghi lại PR URL và gợi ý lệnh review tiếp theo.

### `post:bash:build-complete`
Hook async chạy sau build để phân tích kết quả mà không block luồng chính.

### `post:quality-gate`
Chạy quality gate sau edit/write. Thường là lớp kiểm tra nhanh sau khi sửa file.

### `post:edit:design-quality-check`
Cảnh báo nếu sửa frontend làm UI trôi về kiểu template generic, thiếu chất lượng thiết kế.

### `post:edit:accumulator`
Gom danh sách file JS/TS đã sửa để cuối lượt mới format + typecheck một lần.

### `post:edit:console-warn`
Cảnh báo nếu edit để lại `console.log`.

### `post:governance-capture`
Ghi nhận governance signal từ output của tool. Chỉ hoạt động khi bật `ECC_GOVERNANCE_CAPTURE=1`.

---

## PostToolUseFailure

### `post:mcp-health-check`
Theo dõi MCP tool call bị lỗi, mark server unhealthy và thử reconnect.

---

## Stop

> `Stop` chạy cuối mỗi lượt trả lời của Claude. Đây là lớp hậu kiểm quan trọng nhất.

### `stop:format-typecheck`
Batch format và typecheck toàn bộ file JS/TS đã sửa trong lượt hiện tại. Chạy một lần cuối lượt thay vì sau từng edit.

### `stop:check-console-log`
Quét file đã sửa để tìm `console.log` còn sót lại.

### `stop:session-end`
Persist session state sau mỗi response. Dùng `transcript_path` từ event Stop để lưu dấu vết phiên làm việc.

### `stop:evaluate-session`
Đánh giá session để rút pattern, thói quen, hoặc tín hiệu có thể tái sử dụng.

### `stop:cost-tracker`
Ghi metric token/cost theo session.

### `stop:desktop-notify`
Bắn desktop notification khi Claude trả lời xong. Hữu ích khi đang để task chạy nền.

---

## SessionEnd

### `session:end:marker`
Đánh dấu lifecycle khi session kết thúc hẳn. Hook non-blocking, chủ yếu để ghi nhận trạng thái cuối.

---

## Ghi chú kỹ thuật

- Phần lớn hook JS chạy qua wrapper `.claude/scripts/hooks/run-with-flags.js`.
- Wrapper này truyền `hook id`, `target script`, và `mode flags` như `minimal`, `standard`, `strict`.
- Nhóm `Stop` và `SessionEnd` đang dùng inline `node -e` để resolve runner path trước khi gọi lại `run-with-flags.js`.
- Hook config này là bản mô tả/đồng bộ trong thư mục `.claude/hooks`; runtime active hiện phụ thuộc vào việc cấu hình tương ứng đã được nạp vào `.claude/settings.json`.
