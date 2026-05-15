# Checklist chỉnh `.mcp.json`

File `.mcp.json` dùng để khai báo các MCP server cho project. Khi copy repo sang máy khác, đổi workspace, hoặc cấu hình lại Claude Code, đây là file rất dễ bị quên cập nhật.

## 1. Những chỗ cần kiểm tra đầu tiên

Mở file [`.mcp.json`](../.mcp.json) và rà soát các mục sau:

- `mcpServers.filesystem`
- `mcpServers.context7.env.CONTEXT7_API_KEY`
- `mcpServers.tavily.env.TAVILY_API_KEY`
- `command` và `args` của từng MCP server

## 2. Mục quan trọng nhất: `filesystem`

Đây là mục dễ bị quên nhất.

Hiện tại cấu hình mẫu là:

```json
"filesystem": {
  "command": "npx",
  "args": [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "/home/osboxes/Code/repo-pattern"
  ],
  "description": "Filesystem operations for the current workspace"
}
```

## 3. Bắt buộc phải đổi path workspace

Khi dùng repo ở máy khác hoặc thư mục khác, phải đổi giá trị cuối trong `args`:

```json
"/home/osboxes/Code/repo-pattern"
```

thành đường dẫn tuyệt đối đúng với máy hiện tại.

Ví dụ:

```json
"args": [
  "-y",
  "@modelcontextprotocol/server-filesystem",
  "/Users/your-name/Code/repo-pattern"
]
```

hoặc:

```json
"args": [
  "-y",
  "@modelcontextprotocol/server-filesystem",
  "D:/workspace/repo-pattern"
]
```

Nếu quên đổi mục này, MCP filesystem có thể:

- trỏ sai thư mục
- không đọc được file của project hiện tại
- đọc nhầm project khác
- làm các tool filesystem hoạt động không đúng như mong đợi

## 4. API key không nên để giá trị giả mà không cấu hình môi trường

Trong file hiện tại có dạng:

```json
"env": {
  "CONTEXT7_API_KEY": "CONTEXT7_API_KEY"
}
```

và:

```json
"env": {
  "TAVILY_API_KEY": "TAVILY_API_KEY"
}
```

Ý nghĩa ở đây thường là tên biến môi trường cần có trên máy. Cần bảo đảm môi trường chạy Claude Code đã có:

- `CONTEXT7_API_KEY`
- `TAVILY_API_KEY`

Nếu chưa set, các MCP tương ứng có thể không dùng được.

## 5. Kiểm tra server nào thật sự cần dùng

Theo comment trong file, nên chỉ giữ các server mà repo đang thật sự cần:

- `context7`
- `gitnexus`
- `tavily`
- `sequential-thinking`
- `playwright`
- `filesystem`

Nếu một server không dùng nữa, có thể xóa khỏi `.mcp.json` để giảm context noise và giảm số tool không cần thiết.

## 6. Checklist nhanh trước khi dùng

Trước khi bắt đầu làm việc trong repo này, kiểm tra nhanh:

- [ ] Path của `mcpServers.filesystem.args` đã đúng workspace hiện tại
- [ ] Máy đã có Node.js và dùng được `npx`
- [ ] `CONTEXT7_API_KEY` đã được set nếu dùng Context7
- [ ] `TAVILY_API_KEY` đã được set nếu dùng Tavily
- [ ] Chỉ giữ các MCP server thật sự cần thiết
- [ ] Mở Claude Code trong đúng thư mục project

## 7. Dấu hiệu cấu hình sai

Một số dấu hiệu thường gặp:

- MCP filesystem không thấy file trong repo
- Claude đọc sai cây thư mục
- Tool liên quan đến docs/web search hoạt động lỗi do thiếu API key
- Playwright hoặc GitNexus không chạy vì thiếu package hay sai môi trường

## 8. Gợi ý quy trình an toàn khi đổi máy hoặc clone repo mới

1. Mở [`.mcp.json`](../.mcp.json)
2. Đổi path của `filesystem` sang đường dẫn tuyệt đối trên máy hiện tại
3. Kiểm tra các API key cần thiết trong môi trường
4. Giữ lại đúng các MCP server đang cần
5. Mở lại Claude Code trong thư mục repo và test lại

## 9. Dọn `.claude/rules` theo đúng loại project

Ngoài `.mcp.json`, còn một việc dễ bị để sót là dọn thư mục [`.claude/rules/`](../.claude/rules/).

Nếu trong `.claude/rules` đang có nhiều bộ rule như:

- `python/`
- `typescript/`
- `web/`

thì chỉ nên giữ **1 bộ phù hợp nhất với project hiện tại**.

### Cách làm

- Nếu project là Python thì giữ rule `python`
- Nếu project là TypeScript/Node thì giữ rule `typescript`
- Nếu project thiên về frontend/web UI thì giữ rule `web`

Sau đó:

1. Kéo các file `.md` trong folder rule phù hợp ra trực tiếp dưới [`.claude/rules/`](../.claude/rules/)
2. Xóa folder rule đó sau khi đã kéo file ra ngoài
3. Xóa luôn các folder rule không phù hợp còn lại
4. Giữ lại `common/` nếu project vẫn đang dùng lớp rule chung

### Mục tiêu cuối cùng

Trong [`.claude/rules/`](../.claude/rules/) không nên còn đồng thời cả 3 folder `python/`, `typescript/`, `web/` nếu chỉ một loại là phù hợp với project.

Cấu trúc mong muốn sẽ là dạng:

```text
.claude/rules/
├── README.md
├── common/
├── coding-style.md
├── hooks.md
├── patterns.md
├── security.md
└── testing.md
```

hoặc một cấu trúc tương đương, miễn là chỉ còn bộ rule đang dùng.

### Lý do cần dọn

Nếu giữ nhiều folder rule không liên quan cùng lúc thì dễ xảy ra:

- dư hướng dẫn không phù hợp với repo
- tăng nhiễu khi đọc rule
- khó biết project thật sự đang theo bộ rule nào
- dễ quên kéo các file `.md` của bộ rule đang dùng ra ngoài mức `rules/`

## 10. Checklist đầy đủ khi setup repo mới hoặc đổi môi trường

- [ ] Path của `mcpServers.filesystem.args` đã đúng workspace hiện tại
- [ ] Máy đã có Node.js và dùng được `npx`
- [ ] `CONTEXT7_API_KEY` đã được set nếu dùng Context7
- [ ] `TAVILY_API_KEY` đã được set nếu dùng Tavily
- [ ] Chỉ giữ các MCP server thật sự cần thiết
- [ ] Trong `.claude/rules` chỉ giữ 1 bộ rule phù hợp giữa `python` / `typescript` / `web`
- [ ] Các file `.md` của bộ rule đang dùng đã được kéo ra trực tiếp dưới `.claude/rules/`
- [ ] Các folder rule không dùng đã được xóa
- [ ] Mở Claude Code trong đúng thư mục project

## 11. Điều dễ quên nhất

Nếu chỉ nhớ hai việc, hãy nhớ hai việc này:

- **Luôn kiểm tra lại path trong `mcpServers.filesystem.args`, vì đây là chỗ dễ bị quên nhất khi copy cấu hình sang môi trường khác.**
- **Trong `.claude/rules`, chỉ giữ 1 bộ rule phù hợp và kéo các file `.md` của bộ đó ra ngoài `rules/`.**
