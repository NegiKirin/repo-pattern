# Hướng dẫn cài nhanh Claude Code CLI, MCP và Spec Kit

## 1. Kiểm tra môi trường

```bash
node --version
npm --version
git --version
```

## 2. Cài Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

Nếu dùng API key, đặt biến môi trường trước khi chạy Claude Code.

PowerShell:

```powershell
$env:ANTHROPIC_API_KEY="your_api_key"
```

Chạy Claude Code:

```bash
claude
```

## 3. Cài 9Router

```bash
npm install -g 9router
9router
```

Endpoint local thường dùng:

```text
http://localhost:20128/v1
```

## 4. Tạo file `.mcp.json`

Tạo file [`.mcp.json`](../.mcp.json) ở root repo:

```json
{
  "mcpServers": {
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "env": {
        "CONTEXT7_API_KEY": "${CONTEXT7_API_KEY}"
      }
    },
    "gitnexus": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "gitnexus", "mcp"]
    },
    "web-tools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "<ten-package-web-tools>"]
    }
  }
}
```

## 5. Cài Context7 MCP

Chạy thử:

```bash
npx -y @upstash/context7-mcp
```

Đặt API key.

PowerShell:

```powershell
$env:CONTEXT7_API_KEY="ctx7sk-..."
```

## 6. Cài GitNexus MCP

Dùng ngay với `npx`:

```bash
npx gitnexus analyze
```

Hoặc cài global:

```bash
npm install -g gitnexus
gitnexus analyze
gitnexus setup
gitnexus mcp
```

## 7. Cài `web-tools`

Điền đúng command/package bạn đang dùng vào [`.mcp.json`](../.mcp.json).

Nếu dùng repo này:

```text
https://github.com/huynhkhan123/mcp-web-tools
```

thì đọc setup của repo đó rồi thay `<ten-package-web-tools>` bằng tên thật.

## 8. Cài Spec Kit vào project hiện tại

Dùng Bash script:

```bash
uvx --from "git+https://github.com/github/spec-kit.git@v0.8.9" specify init . --integration claude --script sh
```

Dùng PowerShell script:

```bash
uvx --from "git+https://github.com/github/spec-kit.git@v0.8.9" specify init . --integration claude --script ps
```

Nếu muốn cài cố định:

```bash
pipx install "git+https://github.com/github/spec-kit.git@v0.8.9"
specify init . --integration claude --script sh
```

Nếu cần git extension sau này:

```bash
specify extension add git
```

## 9. Lưu ý với `.claude/`

Cân nhắc thêm `.claude/` hoặc các phần nhạy cảm của nó vào `.gitignore` để tránh lộ credentials hoặc token.

## 10. Các lệnh Spec Kit sẽ dùng trong Claude Code

```text
/speckit-constitution
/speckit-specify
/speckit-clarify
/speckit-plan
/speckit-checklist
/speckit-tasks
/speckit-analyze
/speckit-implement
```

## 11. Kiểm tra nhanh sau khi cài

Kiểm tra Claude Code:

```bash
claude --version
```

Kiểm tra GitNexus:

```bash
gitnexus analyze
```

Kiểm tra Spec Kit trong Claude Code:

```text
/speckit-specify
/speckit-plan
```

Kiểm tra skill chung:

```text
/diagnose
/tdd
```

## 12. Lỗi thường gặp

### `claude: command not found`

```bash
npm install -g @anthropic-ai/claude-code
```

### Context7 báo `Invalid API key`

PowerShell:

```powershell
$env:CONTEXT7_API_KEY="ctx7sk-..."
```

### GitNexus chưa trả kết quả tốt

```bash
gitnexus analyze
```

### Skill `/speckit-*` chưa dùng được

Chạy lại:

```bash
uvx --from "git+https://github.com/github/spec-kit.git@v0.8.9" specify init . --integration claude --script sh
```

sau đó mở lại Claude trong đúng thư mục project.
