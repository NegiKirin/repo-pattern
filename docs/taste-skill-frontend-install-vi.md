# Hướng dẫn cài Taste Skill cho project frontend

Tài liệu này hướng dẫn cài `taste-skill` của Leonxlnx vào project frontend để dùng với Claude Code.

## Mục tiêu

Cài bộ skill sau vào repo hiện tại:

```bash
npx skills add https://github.com/Leonxlnx/taste-skill
```

Sau khi cài, Claude Code sẽ có thêm các skill liên quan đến UI/frontend như:

- `design-taste-frontend`
- `design-taste-frontend-v1`
- `gpt-taste`
- `image-to-code`
- `redesign-existing-projects`
- `high-end-visual-design`
- `minimalist-ui`
- `industrial-brutalist-ui`
- `imagegen-frontend-web`
- `imagegen-frontend-mobile`
- `brandkit`

## Khi nào nên cài full bộ

Dùng lệnh đầy đủ này khi project frontend của bạn cần nhiều workflow thiết kế khác nhau:

```bash
npx skills add https://github.com/Leonxlnx/taste-skill
```

Phù hợp khi bạn muốn:

- làm landing page hoặc marketing site
- redesign UI hiện có
- generate reference images trước khi code
- thử nhiều style như minimalist, brutalist, premium
- dùng nhiều skill frontend trong cùng một repo

## Khi nào chỉ nên cài skill chính

Nếu bạn chỉ muốn có skill mặc định để Claude Code viết UI đẹp hơn, cài riêng skill chính:

```bash
npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"
```

Phù hợp khi bạn muốn:

- giữ setup gọn
- chỉ cần skill mặc định cho frontend
- không cần image workflow hoặc các style phụ

## Cách cài trong repo frontend mới

Chạy lệnh ngay tại thư mục repo:

```bash
npx skills add https://github.com/Leonxlnx/taste-skill
```

Hoặc nếu chỉ cần skill chính:

```bash
npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"
```

## Cài global cho mọi repo

Nếu muốn dùng Taste Skill ở mọi project trên máy, dùng:

```bash
npx skills add https://github.com/Leonxlnx/taste-skill --global
```

Dùng cách này khi bạn thường xuyên tạo project frontend mới và không muốn cài lại từng repo.

## Cách verify sau khi cài

### Cách 1: xem skill đã xuất hiện trong Claude Code

Mở Claude Code trong repo. Nếu cài thành công, skill sẽ xuất hiện trong danh sách skill khả dụng, ví dụ:

- `design-taste-frontend`
- `gpt-taste`
- `image-to-code`

### Cách 2: kiểm tra thư mục skill của project

Thông thường skill sẽ xuất hiện trong thư mục `.claude/skills/` của repo hoặc được symlink từ hệ thống cài đặt skill.

### Cách 3: kiểm tra bằng lệnh

```bash
npx skills list
```

Nếu cài thành công, bạn sẽ thấy các skill của `taste-skill` trong danh sách.

## Khuyến nghị cho project frontend

- **Project web/app bình thường**: cài `design-taste-frontend`
- **Project cần nhiều thử nghiệm visual**: cài full bộ
- **Project redesign UI cũ**: ưu tiên thêm `redesign-existing-projects`
- **Project image-first workflow**: dùng thêm `image-to-code` hoặc `imagegen-frontend-web`

## Lệnh khuyến nghị mặc định

Nếu bạn không muốn suy nghĩ nhiều, dùng lệnh này:

```bash
npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"
```

Đây là lựa chọn gọn nhất cho đa số project frontend dùng Claude Code.
