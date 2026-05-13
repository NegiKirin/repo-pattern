# Hướng dẫn setup Claude Code CLI, 9Router, MCP, OpenSpec và skills cho mọi repo

## Mục tiêu

Tài liệu này hướng dẫn setup theo hướng dùng chung cho mọi repo:

- Claude Code CLI
- 9Router
- MCP servers cho Claude Code
- các MCP phổ biến như `context7`, `gitnexus`, `web-tools`
- OpenSpec workflow
- skills, gồm cả trường hợp dùng source như `mattpocock/skills`

Tài liệu này được viết theo môi trường Windows. Nếu bạn dùng macOS hoặc Linux, phần lớn nội dung vẫn giữ nguyên, và thường chỉ cần thay đổi nhẹ ở cách export biến môi trường, đường dẫn, hoặc một vài lệnh shell.

## 1. Yêu cầu trước khi cài

Bạn nên có sẵn:

- Node.js 18+
- `npm` hoặc `npx`
- Git
- Claude account hoặc Anthropic API key

Kiểm tra nhanh:

```bash
node --version
npm --version
git --version
```

## 2. Cài Claude Code CLI

Cài global bằng npm:

```bash
npm install -g @anthropic-ai/claude-code
```

Kiểm tra cài đặt:

```bash
claude --version
```

Khởi động Claude Code:

```bash
claude
```

Nếu môi trường của bạn dùng API key thay vì login qua trình duyệt, đặt biến môi trường trước khi chạy.

## 3. Cài 9Router

Cài global:

```bash
npm install -g 9router
```

Khởi động 9Router:

```bash
9router
```

Thông thường 9Router sẽ mở dashboard để bạn kết nối provider và cấu hình routing. Theo thông tin công khai hiện có, endpoint local mặc định thường là:

```text
http://localhost:20128/v1
```

### Khi nào nên dùng 9Router

9Router phù hợp khi bạn muốn:

- gom nhiều provider vào một local endpoint
- dùng một OpenAI-compatible endpoint cho các tool khác
- thử nghiệm routing giữa nhiều model/provider

### Ghi chú quan trọng với Claude Code

Claude Code không mặc định cần 9Router để hoạt động. Hãy cài Claude Code độc lập trước. Chỉ thêm 9Router nếu workflow của bạn thực sự cần một local router hoặc một endpoint tương thích cho tool khác trong hệ sinh thái của bạn.

## 4. Cách Claude Code nạp MCP servers

Thông thường bạn sẽ khai báo MCP servers trong file [`.mcp.json`](../.mcp.json) ở root repo.

Ví dụ tối thiểu:

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
    }
  }
}
```

Ý nghĩa chính:

- `type: "stdio"`: Claude Code sẽ chạy server như một local process
- `command`: lệnh thực thi
- `args`: tham số truyền vào lệnh
- `env`: biến môi trường cần cho server đó

Nếu repo của bạn chưa có [`.mcp.json`](../.mcp.json), bạn có thể tạo mới theo mẫu trên.

## 5. Setup Context7 MCP

Context7 hữu ích khi bạn muốn Claude tra tài liệu thư viện, framework, SDK, API, CLI tool hoặc cloud service theo tài liệu hiện tại.

### Cách chạy

```bash
npx -y @upstash/context7-mcp
```

### Thiết lập API key

Bạn cần `CONTEXT7_API_KEY` trong môi trường.

Ví dụ trên Windows PowerShell:

```powershell
$env:CONTEXT7_API_KEY="ctx7sk-..."
```

Hoặc lưu lâu dài trong System Environment Variables rồi mở lại terminal.

### Mẫu cấu hình `.mcp.json`

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
    }
  }
}
```

### Kiểm tra nhanh

Mở Claude Code trong repo có [`.mcp.json`](../.mcp.json), rồi yêu cầu tra tài liệu một package bất kỳ.

Nếu API key sai hoặc thiếu, bạn thường sẽ thấy lỗi tương tự:

```text
Invalid API key. Please check your API key. API keys should start with 'ctx7sk' prefix.
```

## 6. Setup GitNexus MCP

GitNexus hữu ích khi bạn muốn index codebase để Claude hiểu symbol, call graph, execution flow và blast radius của thay đổi.

### Cách 1: dùng ngay với npx

```bash
npx gitnexus analyze
```

### Cách 2: cài global

```bash
npm install -g gitnexus
```

### Index repo

Trong repo cần phân tích:

```bash
gitnexus analyze
```

### Cấu hình cho editor/agent

```bash
gitnexus setup
```

### Chạy MCP server thủ công

```bash
gitnexus mcp
```

### Mẫu cấu hình `.mcp.json`

```json
{
  "mcpServers": {
    "gitnexus": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "gitnexus", "mcp"]
    }
  }
}
```

### Lưu ý

- Hãy index repo trước khi mong đợi kết quả tốt từ GitNexus.
- Một số môi trường có thể đang dùng package fork hoặc package nội bộ thay cho `gitnexus` chính thức. Khi đó, đổi `args` theo package bạn thực sự dùng.

## 7. Thêm MCP `web-tools`

`web-tools` hữu ích khi bạn muốn có web search hoặc web fetch như một MCP server riêng trong Claude Code.

Nếu bạn đang dùng template này cùng repo `mcp-web-tools`, nguồn repo là:

```text
https://github.com/huynhkhan123/mcp-web-tools
```

Repo đó đã có hướng dẫn setup, nên khi dùng `web-tools` bạn nên đọc setup từ chính repo đó trước, rồi mới điền command tương ứng vào [`.mcp.json`](../.mcp.json).

Vì package hoặc command khởi động của `web-tools` có thể khác nhau theo cách bạn cài, cách an toàn nhất là thêm nó theo đúng lệnh chạy MCP server mà bạn đang có.

### Mẫu cấu hình chung

```json
{
  "mcpServers": {
    "web-tools": {
      "type": "stdio",
      "command": "<lenh-chay-web-tools>",
      "args": ["<arg-1>", "<arg-2>"],
      "env": {}
    }
  }
}
```

### Ví dụ nếu server chạy bằng `npx`

```json
{
  "mcpServers": {
    "web-tools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "<ten-package-web-tools>"]
    }
  }
}
```

Nếu bạn đã biết chính xác package hoặc repo của `web-tools`, hãy thay `<ten-package-web-tools>` bằng tên thật đó.

## 8. Setup OpenSpec

OpenSpec phù hợp khi bạn muốn làm việc theo flow spec-driven thay vì nhảy thẳng vào code.

### Khi nào nên dùng OpenSpec

OpenSpec hữu ích khi bạn muốn:

- viết proposal trước khi code
- tách `proposal`, `design`, `tasks` rõ ràng
- quản lý thay đổi lớn hoặc thay đổi có nhiều bước
- giảm mơ hồ trước khi implement

### Dấu hiệu một repo đã dùng OpenSpec

Bạn thường sẽ thấy một hoặc nhiều dấu hiệu sau:

- có thư mục `openspec/`
- có file `openspec/config.yaml`
- có các slash command hoặc skills như `/openspec-propose`, `/openspec-apply-change`

### Ghi chú cho `repo-pattern`

Trong template `repo-pattern`, OpenSpec đã được custom sẵn để đi cùng bộ skills đang khóa trong `skills-lock.json`, gồm cả trường hợp dùng source như `mattpocock/skills`.

Điều đó có nghĩa là nếu bạn khởi tạo repo mới bằng template này, bạn thường không cần chạy `openspec init` lại cho project nữa. Hãy ưu tiên sửa `openspec/config.yaml`, giữ `skills-lock.json` theo template, rồi dùng luôn các command OpenSpec có sẵn.

Chỉ cân nhắc chạy `openspec init` nếu bạn chủ động thay toàn bộ cấu trúc OpenSpec của template hoặc muốn reset về trạng thái mặc định của OpenSpec.

### Cách dùng nhanh trong Claude Code

Trong Claude Code, bạn có thể gọi trực tiếp:

- `/openspec-propose` để tạo change proposal
- `/openspec-explore` để làm rõ yêu cầu
- `/openspec-apply-change` để triển khai task từ change
- `/openspec-archive-change` để archive change đã xong

### Khi không cần OpenSpec

Không cần bật OpenSpec cho các thay đổi rất nhỏ như:

- sửa typo
- đổi 1-2 dòng rõ ràng
- fix nhỏ không có tradeoff đáng kể

## 9. Setup skills, gồm `mattpocock/skills`

Claude Code có thể nạp skills để bổ sung workflow như diagnose, prototype, tdd, triage hoặc document workflows.

### Dấu hiệu repo hoặc môi trường có dùng skills lock

Bạn có thể thấy file [skills-lock.json](../skills-lock.json) ở root repo. File này thường dùng để pin danh sách skill và hash tương ứng, giúp việc nạp skill ổn định hơn.

Ngoài ra, trong template `repo-pattern`, bạn cũng có thể thấy file [`.claude/CLAUDE.md`](../.claude/CLAUDE.md). File này dùng để giữ project instructions và, theo custom của pattern này, là nơi gắn với `andrej-karpathy-skills`.

### Khi nào liên quan đến `mattpocock/skills`

Nếu `skills-lock.json` hoặc cấu hình skill source của bạn tham chiếu `mattpocock/skills`, điều đó có nghĩa là một phần skill đang được lấy từ source đó.

Bạn thường không cần sửa file lock này bằng tay trừ khi đang chủ động:

- đổi source skill
- refresh lock
- thêm bộ skill mới

### Cách dùng nhanh

Nếu skill đã được nạp vào Claude Code, bạn chỉ cần gọi bằng slash command hoặc yêu cầu tương ứng, ví dụ:

- `/diagnose`
- `/tdd`
- `/prototype`
- `/caveman`

### Khuyến nghị thực tế

- Nếu skill đang hoạt động ổn định, không cần cài lại.
- Nếu bạn muốn thay đổi bộ skill, nên làm bằng workflow quản lý skills của Claude Code thay vì sửa tay JSON.
- Nếu repo có `skills-lock.json`, hãy coi đó là source of truth cho trạng thái skill đã pin.

## 10. Mẫu `.mcp.json` đầy đủ

Ví dụ cấu hình kết hợp `context7`, `gitnexus`, và `web-tools`:

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

## 11. Kiểm tra sau khi cài

### Kiểm tra Claude Code CLI

```bash
claude --version
```

### Kiểm tra Context7

- Mở Claude Code trong repo.
- Bảo Claude tra tài liệu một package bất kỳ.
- Nếu lỗi API key, kiểm tra lại `CONTEXT7_API_KEY`.

### Kiểm tra GitNexus

Chạy index trước:

```bash
gitnexus analyze
```

Sau đó mở Claude Code và yêu cầu tìm symbol hoặc execution flow trong repo.

### Kiểm tra `.mcp.json`

Đảm bảo file [`.mcp.json`](../.mcp.json) có JSON hợp lệ và command thực sự tồn tại trên máy.

### Kiểm tra OpenSpec

Nếu skill OpenSpec có sẵn, thử gọi:

```text
/openspec-explore
```

hoặc:

```text
/openspec-propose
```

### Kiểm tra skills

Nếu môi trường có skill phù hợp, thử gọi:

```text
/diagnose
```

hoặc:

```text
/tdd
```

## 12. Lỗi thường gặp

### `claude: command not found`

Claude Code CLI chưa được cài global hoặc npm global bin chưa nằm trong `PATH`.

### `npx` chạy được nhưng MCP không lên

Thường do một trong các nguyên nhân:

- package name sai
- thiếu API key
- command trong [`.mcp.json`](../.mcp.json) không đúng
- terminal chưa nạp lại environment variables

### Context7 báo `Invalid API key`

API key chưa đúng hoặc chưa export vào môi trường shell đang chạy Claude Code.

### GitNexus có MCP nhưng không trả kết quả hữu ích

Repo chưa được index. Chạy lại:

```bash
gitnexus analyze
```

### Skills có trong lock nhưng không gọi được

Có thể skill source chưa được nạp trong môi trường hiện tại, hoặc phiên Claude Code hiện tại không load đúng bộ skill đó.

## 13. Khuyến nghị chung

Thiết lập đơn giản và ổn định nhất cho đa số repo là:

1. Cài Claude Code CLI.
2. Thiết lập `CONTEXT7_API_KEY` nếu bạn muốn tra docs qua Context7.
3. Tạo [`.mcp.json`](../.mcp.json) tối thiểu với `context7` và `gitnexus`.
4. Chạy `gitnexus analyze` cho từng repo cần index.
5. Chỉ thêm `web-tools` khi bạn đã có đúng package hoặc command khởi động MCP server đó.
6. Dùng OpenSpec cho thay đổi vừa và lớn.
7. Nếu repo có `skills-lock.json`, giữ nó ổn định trừ khi bạn thật sự cần đổi bộ skill.

## 14. Nếu bạn muốn mở rộng tiếp

Bạn có thể làm tiếp một trong các việc sau:

1. tạo [`.mcp.json`](../.mcp.json) mẫu cho repo mới
2. thêm phần quick start 5 phút vào [README.md](../README.md)
3. viết riêng một checklist cho OpenSpec flow `propose -> apply -> archive`
4. viết riêng một checklist cho skill sync/update
