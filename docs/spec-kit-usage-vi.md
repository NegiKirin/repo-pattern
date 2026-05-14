# Hướng dẫn sử dụng Spec Kit

## Mục tiêu

Tài liệu này hướng dẫn cách dùng Spec Kit sau khi đã chạy `specify init` trong project.

Spec Kit là workflow spec-driven: viết rõ nguyên tắc, mô tả yêu cầu, lập kế hoạch, tách task rồi mới triển khai.

## Điều kiện trước khi dùng

Bạn nên có sẵn:

- project đã chạy `specify init`
- Claude được mở đúng trong thư mục project
- các skill Spec Kit đã được cài vào `.claude/skills`

## Flow cơ bản

Sau khi init xong, flow nên dùng là:

1. `/speckit-constitution` - thiết lập nguyên tắc cho project
2. `/speckit-specify` - tạo baseline specification
3. `/speckit-plan` - tạo implementation plan
4. `/speckit-tasks` - sinh task có thể thực thi
5. `/speckit-implement` - triển khai theo plan

## Các skill bổ trợ

Dùng khi cần tăng độ rõ ràng và chất lượng trước lúc implement:

- `/speckit-clarify` - làm rõ các điểm còn mơ hồ trước khi lên plan
- `/speckit-checklist` - tạo checklist để rà độ đầy đủ, rõ ràng, nhất quán
- `/speckit-analyze` - kiểm tra tính nhất quán giữa spec, plan và tasks trước khi implement

Thứ tự hay dùng:

1. `/speckit-specify`
2. `/speckit-clarify` nếu spec còn mơ hồ
3. `/speckit-plan`
4. `/speckit-checklist` nếu muốn rà chất lượng
5. `/speckit-tasks`
6. `/speckit-analyze`
7. `/speckit-implement`

## Cách dùng từng bước

### 1. Thiết lập nguyên tắc project

Dùng khi repo chưa có nguyên tắc làm việc rõ ràng.

```text
/speckit-constitution Project này ưu tiên thay đổi nhỏ, tránh refactor ngoài phạm vi, mọi bug fix phải có cách verify rõ ràng.
```

Nội dung nên ngắn và mang tính nguyên tắc, ví dụ:

- ưu tiên thay đổi nhỏ
- không thêm abstraction khi chưa cần
- bug fix phải có cách tái hiện và kiểm tra
- ưu tiên test hoặc bước verify rõ ràng

### 2. Viết spec

Dùng `/speckit-specify` để mô tả bạn muốn xây gì.

Chỉ tập trung vào:

- người dùng cần gì
- hành vi mong muốn là gì
- tại sao cần

Không cần đi sâu tech stack ở bước này.

Ví dụ:

```text
/speckit-specify Thêm tính năng cho phép người dùng lọc danh sách đơn hàng theo khoảng ngày, trạng thái và từ khóa mã đơn. Kết quả cần phản hồi nhanh, giữ nguyên phân trang hiện tại và không làm đổi luồng xem chi tiết đơn hàng.
```

### 3. Làm rõ spec nếu còn mơ hồ

Dùng `/speckit-clarify` khi yêu cầu chưa rõ hoặc có nhiều cách hiểu.

Ví dụ:

```text
/speckit-clarify Tập trung làm rõ yêu cầu filter, hành vi khi không có kết quả và giới hạn hiệu năng chấp nhận được.
```

Nên dùng bước này trước `/speckit-plan` nếu:

- có nhiều edge case
- nhiều điều kiện chưa chốt
- yêu cầu nghiệp vụ chưa rõ

### 4. Lập implementation plan

Dùng `/speckit-plan` để chốt hướng kỹ thuật.

Lúc này mới cung cấp:

- tech stack
- ràng buộc kỹ thuật
- yêu cầu dữ liệu
- yêu cầu bảo mật, hiệu năng, migration nếu có

Ví dụ:

```text
/speckit-plan Backend dùng Node.js và PostgreSQL. API hiện có cần được mở rộng thay vì tạo service mới. UI đang dùng React. Ưu tiên thay đổi nhỏ, không đổi schema nếu chưa thật sự cần.
```

### 5. Tạo checklist rà chất lượng

Dùng `/speckit-checklist` sau khi plan đã hình thành tương đối rõ.

```text
/speckit-checklist
```

Phù hợp khi bạn muốn rà:

- yêu cầu đã đầy đủ chưa
- có mâu thuẫn giữa yêu cầu và plan không
- còn chỗ nào dễ gây hiểu nhầm không

### 6. Sinh task để triển khai

Dùng `/speckit-tasks` để chia nhỏ công việc.

```text
/speckit-tasks
```

Kết quả mong đợi:

- task có thứ tự hợp lý
- task đủ nhỏ để làm độc lập
- dễ kiểm tra tiến độ hoặc giao tiếp tiếp cho agent

### 7. Phân tích chéo trước khi implement

Dùng `/speckit-analyze` sau khi đã có spec, plan và tasks.

```text
/speckit-analyze
```

Bước này hữu ích để phát hiện:

- task thiếu so với spec
- plan không khớp với yêu cầu
- điểm mơ hồ còn sót trước khi code

### 8. Triển khai

Dùng `/speckit-implement` khi đã sẵn sàng code.

```text
/speckit-implement
```

Nên dùng sau khi:

- spec đủ rõ
- plan đã ổn
- tasks đã tách hợp lý

## Khi nào nên dùng Spec Kit

Nên dùng khi:

- tính năng có nhiều bước
- yêu cầu có tradeoff
- thay đổi ảnh hưởng nhiều file
- cần làm việc cùng agent theo flow rõ ràng
- muốn tránh nhảy vào code quá sớm

## Khi nào không cần dùng Spec Kit

Không cần dùng khi:

- sửa typo
- đổi 1-2 dòng rõ ràng
- fix nhỏ không có tradeoff đáng kể
- thay đổi quá ngắn và không cần plan riêng

## 3 ví dụ thực tế

### Ví dụ 1: Thêm bộ lọc cho trang danh sách đơn hàng

Mục tiêu: thêm filter theo ngày, trạng thái và mã đơn.

Bước 1 - thiết lập nguyên tắc nếu cần:

```text
/speckit-constitution Project này ưu tiên thay đổi nhỏ, không refactor lan sang module không liên quan, mọi thay đổi phải có bước verify rõ ràng.
```

Bước 2 - viết spec:

```text
/speckit-specify Thêm bộ lọc cho trang danh sách đơn hàng theo khoảng ngày, trạng thái và mã đơn. Người dùng có thể kết hợp nhiều điều kiện lọc. Kết quả cần giữ nguyên phân trang và không làm thay đổi luồng xem chi tiết đơn hàng.
```

Bước 3 - làm rõ:

```text
/speckit-clarify Làm rõ hành vi khi filter rỗng, khi không có kết quả và khi người dùng đổi filter liên tục.
```

Bước 4 - plan:

```text
/speckit-plan Backend dùng API hiện tại, frontend dùng React. Ưu tiên mở rộng query params của endpoint đang có, không tạo endpoint mới nếu chưa cần.
```

Bước 5 - tasks:

```text
/speckit-tasks
```

Bước 6 - analyze:

```text
/speckit-analyze
```

Bước 7 - implement:

```text
/speckit-implement
```

### Ví dụ 2: Sửa bug double submit ở form tạo user

Mục tiêu: ngăn người dùng bấm nhiều lần gây tạo user trùng.

Bước 1 - spec:

```text
/speckit-specify Sửa lỗi form tạo user có thể bị submit nhiều lần khi người dùng bấm liên tiếp vào nút tạo. Hệ thống chỉ được tạo một user cho mỗi thao tác hợp lệ và phải phản hồi rõ trạng thái đang xử lý.
```

Bước 2 - clarify:

```text
/speckit-clarify Làm rõ hành vi nút submit khi request đang chạy, cách hiển thị loading và yêu cầu idempotency ở backend.
```

Bước 3 - plan:

```text
/speckit-plan Frontend dùng React, backend dùng REST API hiện có. Ưu tiên chặn submit lặp ở UI và bổ sung bảo vệ ở API nếu cần.
```

Bước 4 - tasks:

```text
/speckit-tasks
```

Bước 5 - analyze:

```text
/speckit-analyze
```

Bước 6 - implement:

```text
/speckit-implement
```

### Ví dụ 3: Thêm export CSV cho báo cáo doanh thu

Mục tiêu: cho phép tải CSV từ màn hình báo cáo.

Bước 1 - spec:

```text
/speckit-specify Thêm chức năng export CSV cho màn hình báo cáo doanh thu. File tải về cần phản ánh đúng bộ lọc hiện tại của người dùng và giữ định dạng cột phù hợp để mở bằng Excel.
```

Bước 2 - clarify:

```text
/speckit-clarify Làm rõ giới hạn dữ liệu export, encoding file, tên file tải về và quyền của người dùng được phép export.
```

Bước 3 - plan:

```text
/speckit-plan Backend hiện có API báo cáo, frontend dùng React. Ưu tiên tái sử dụng logic filter hiện có và tránh tạo pipeline export riêng nếu không cần.
```

Bước 4 - checklist:

```text
/speckit-checklist
```

Bước 5 - tasks:

```text
/speckit-tasks
```

Bước 6 - analyze:

```text
/speckit-analyze
```

Bước 7 - implement:

```text
/speckit-implement
```

## Mẹo dùng hiệu quả

- Viết `/speckit-specify` theo ngôn ngữ nghiệp vụ, không sa vào chi tiết kỹ thuật quá sớm.
- Dùng `/speckit-clarify` trước `/speckit-plan` nếu còn điểm mơ hồ.
- Dùng `/speckit-analyze` trước `/speckit-implement` để giảm rủi ro lệch giữa spec, plan và tasks.
- Với thay đổi lớn, làm theo từng phase thay vì dồn mọi thứ vào một lần implement.

## Tóm tắt flow đề xuất

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

Không phải lúc nào cũng cần dùng hết các bước. Với thay đổi nhỏ hoặc vừa, bạn có thể chỉ cần:

```text
/speckit-specify
/speckit-plan
/speckit-tasks
/speckit-implement
```
