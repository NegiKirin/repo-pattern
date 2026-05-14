# Skills Overview

Tài liệu này tóm tắt nhanh chức năng của từng skill trong `.claude/skills`, bỏ qua toàn bộ nhóm `spec-kit`.

## Core engineering

- **api-connector-builder** — Thêm một connector/provider mới theo đúng pattern integration sẵn có của repo.
- **api-design** — Thiết kế REST API production-ready: resource, status code, pagination, filter, versioning, rate limit.
- **backend-patterns** — Áp dụng pattern backend cho Node.js/Express/Next.js: kiến trúc, API, data flow, performance.
- **code-reviewer** — Review code/PR, chỉ ra lỗi chất lượng, refactor hợp lý, và rủi ro bảo mật.
- **codebase-onboarding** — Đọc repo lạ và tạo onboarding guide: entry point, kiến trúc, convention, luồng chính.
- **coding-standards** — Chuẩn hóa coding style: naming, readability, immutability, maintainability.
- **deployment-patterns** — Thiết kế quy trình deploy/CI-CD, health check, rollback, production readiness.
- **docker-patterns** — Áp dụng Docker/Compose pattern cho local dev, network, security, orchestration.
- **dockerfile-validator** — Kiểm tra Dockerfile về correctness, security, image size, cache, build efficiency.
- **prompt-engineer** — Thiết kế và tinh chỉnh prompt cho task LLM, output format, evaluation, reliability.
- **security-review** — Review code theo góc nhìn security: input handling, auth, secrets, OWASP-style issues.
- **security-scan** — Quét cấu hình `.claude` để tìm misconfiguration, injection risk, hoặc setup thiếu an toàn.

## Frontend, UX, and presentation

- **frontend-design** — Xây UI production có thẩm mỹ, rõ hierarchy, có state/interaction hợp lý, tránh template look.
- **frontend-patterns** — Áp dụng pattern React/Next cho state, data fetching, component architecture, performance.
- **frontend-slides** — Tạo slide HTML giàu animation hoặc chuyển deck/PPT sang web presentation.
- **ui-ux-pro-max** — Tư vấn UI/UX tổng thể: visual direction, palette, typography, layout, chart, design system.
- **dashboard-builder** — Xây dashboard vận hành thực dụng cho Grafana/SigNoz, tập trung vào câu hỏi mà operator cần trả lời.
- **e2e-testing** — Thiết kế và triển khai test E2E với Playwright: structure, CI, flake control, coverage flow chính.

## Python and backend frameworks

- **fastapi-expert** — Xây FastAPI production-ready với async, auth, validation, performance, OpenAPI.
- **fastapi-project-structure** — Tổ chức project FastAPI: app layout, service layer, database layer, module boundary.
- **postgres-pro** — Tối ưu PostgreSQL: query plan, indexing, schema decisions, concurrency, advanced features.
- **python-pro** — Viết Python production: typing, async, packaging, architecture, code quality.
- **python-testing** — Viết test Python/pytest theo TDD: fixture, mock, parametrization, coverage.
- **pytorch-patterns** — Áp dụng pattern PyTorch cho training loop, data pipeline, reproducibility, model organization.

## Product, research, and documentation

- **article-writing** — Viết bài dài, guide, tutorial, newsletter theo giọng điệu nhất quán và có cấu trúc rõ.
- **deep-research** — Nghiên cứu đa nguồn trên web, tổng hợp insight và dẫn nguồn rõ ràng.
- **document-specialist** — Tạo/audit/chuyển đổi tài liệu kỹ thuật như PRD, SRS, OpenAPI, runbook, manual, diagram.
- **product-capability** — Chuyển yêu cầu sản phẩm hoặc roadmap thành capability/implementation plan có thể làm được.
- **product-lens** — Soi lại bài toán sản phẩm trước khi build: mục tiêu, giả định, tradeoff, phạm vi.
- **quality-nonconformance** — Ghi nhận và phân tích các điểm không phù hợp với chuẩn chất lượng hoặc quy trình.

## Domain-specific

- **dart-flutter-patterns** — Pattern Dart/Flutter production: state management, navigation, networking, architecture.
- **defi-amm-security** — Review bảo mật cho Solidity/AMM: liquidity pool, swap logic, invariant, attack surface.

## Ghi chú

- Đã **bỏ qua toàn bộ nhóm `spec-kit`** theo yêu cầu.
- Mục tiêu của file này là **đọc nhanh để chọn đúng skill**, không thay thế tài liệu chi tiết trong từng `SKILL.md`.