---
name: fastapi-pattern
description: Use when creating, restructuring, or extending a FastAPI backend and the main question is how to organize routers, services, repositories, schemas, dependencies, config, migrations, and tests into a maintainable project layout.
---

# FastAPI Project Structure

## Overview

Use this skill to keep a FastAPI codebase structurally consistent as it grows.

Core principle: HTTP concerns stay in routers, business rules stay in services, persistence stays in repositories, and framework wiring stays in dependencies and startup code.

## When to Use

Use when:
- starting a new FastAPI service
- adding a new domain and unsure where files should live
- refactoring a messy `main.py` or oversized endpoint module
- introducing services, repositories, or integrations and wanting one consistent layout
- reviewing whether a FastAPI codebase has clear boundaries

Do not use when:
- the task is only about one endpoint implementation detail
- the main problem is query tuning, auth design, or deployment rather than project layout
- the project is not FastAPI-based

## Recommended Structure

```text
app/
├── main.py
├── core/
│   ├── config.py
│   ├── security.py
│   ├── constants.py
│   └── logging.py
├── api/
│   ├── deps.py
│   └── v1/
│       ├── router.py
│       └── endpoints/
│           ├── users.py
│           ├── auth.py
│           └── health.py
├── schemas/
│   ├── base.py
│   ├── user.py
│   └── auth.py
├── models/
│   ├── base.py
│   └── user.py
├── services/
│   ├── auth/
│   │   ├── __init__.py
│   │   └── auth_service.py
│   ├── cache/
│   │   ├── __init__.py
│   │   └── redis_service.py
│   └── users/
│       ├── __init__.py
│       └── user_service.py
├── repositories/
│   ├── base.py
│   └── user_repository.py
├── integrations/
│   ├── redis_client.py
│   ├── s3_client.py
│   └── external_api_client.py
├── db/
│   ├── session.py
│   └── base.py
├── exceptions/
│   ├── base.py
│   └── handlers.py
├── middleware/
│   └── request_logging.py
├── migrations/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
└── tests/
    ├── unit/
    ├── integration/
    └── conftest.py
```

## Layer Responsibilities

| Layer | Owns | Must not own |
|------|------|---------------|
| `api/v1/endpoints/` | request parsing, response mapping, status codes, `Depends(...)` | business rules, SQL, external client wiring |
| `services/` | business logic, orchestration, validation beyond schema shape | HTTP transport details, raw SQL |
| `repositories/` | database reads/writes, query composition | HTTP concerns, cross-service orchestration |
| `schemas/` | request/response DTOs | persistence logic |
| `models/` | ORM entities | response formatting |
| `integrations/` | external systems and SDK clients | domain rules |
| `core/` | config, security primitives, constants, shared setup | domain behavior |
| `exceptions/` | app error types and global handlers | domain workflows |

## Quick Placement Rules

If the code is about...
- **route shape / status code / dependency injection** → `api/`
- **business decision or use case** → `services/`
- **querying or persisting data** → `repositories/`
- **Pydantic input/output models** → `schemas/`
- **SQLAlchemy ORM models** → `models/`
- **Redis/S3/third-party API adapter** → `integrations/`
- **settings, auth helpers, constants** → `core/`
- **global exception mapping** → `exceptions/`
- **app startup and router registration** → `main.py`

## Domain Pattern

For each domain, keep files aligned by name.

Example for `users`:

```text
api/v1/endpoints/users.py
schemas/user.py
models/user.py
services/users/user_service.py
repositories/user_repository.py
```

This makes the codebase searchable and keeps domain concepts easy to trace.

## Implementation Patterns

### Router pattern

```python
router = APIRouter(prefix="/users", tags=["users"])

@router.get("/{user_id}", response_model=BaseResponse[UserOut])
async def get_user(
    user_id: str,
    service: UserService = Depends(get_user_service),
    _: CurrentUser = Depends(get_current_user),
) -> BaseResponse[UserOut]:
    user = await service.find_by_id(user_id)
    return BaseResponse(data=user)
```

Router rules:
- keep handlers thin
- always declare `response_model`
- use dependencies for auth, DB-backed services, and shared request context
- translate service results into HTTP responses, not the other way around

### Service pattern

```python
class UserService:
    def __init__(self, repo: UserRepository, cache: RedisService) -> None:
        self.repo = repo
        self.cache = cache

    async def find_by_id(self, user_id: str) -> UserOut:
        cached = await self.cache.get(f"user:{user_id}")
        if cached:
            return UserOut.model_validate(cached)

        user = await self.repo.find_by_id(user_id)
        if user is None:
            raise AppError(code="USER_NOT_FOUND", message="User not found", status_code=404)

        result = UserOut.model_validate(user)
        await self.cache.set(f"user:{user_id}", result.model_dump(), ttl=300)
        return result
```

Service rules:
- own orchestration and business decisions
- combine repositories and integrations
- raise app-level errors, not `HTTPException` everywhere
- do not embed raw SQL

### Repository pattern

```python
class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def find_by_id(self, user_id: str) -> User | None:
        return await self.session.get(User, user_id)

    async def find_by_email(self, email: str) -> User | None:
        stmt = select(User).where(User.email == email)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
```

Repository rules:
- keep query logic here
- return ORM entities or repository-owned query results
- do not handle HTTP or authentication policy

### Dependency wiring pattern

```python
async def get_session() -> AsyncIterator[AsyncSession]:
    async with async_session_maker() as session:
        yield session


def get_redis_service() -> RedisService:
    return RedisService(redis_client)


async def get_user_service(
    session: AsyncSession = Depends(get_session),
    cache: RedisService = Depends(get_redis_service),
) -> UserService:
    repo = UserRepository(session)
    return UserService(repo=repo, cache=cache)
```

Dependency rules:
- construct framework-managed objects here
- reuse `Depends(...)` for request-scoped wiring
- avoid constructing infra objects ad hoc inside services or routers

## Configuration Pattern

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    PROJECT_NAME: str = "my-service"
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: str
    REDIS_URL: str | None = None

    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
```

Rules:
- load secrets from environment
- keep config centralized in `core/config.py`
- do not scatter `os.getenv()` across the codebase

## Startup Pattern

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)
app.include_router(api_router, prefix=settings.API_V1_PREFIX)
register_exception_handlers(app)
```

Rules:
- keep `main.py` focused on app assembly
- register middleware, routers, lifespan hooks, and exception handlers here
- do not place domain logic in startup code

## Testing Layout

```text
tests/
├── unit/           # service and utility tests
├── integration/    # API + DB + repository flows
└── conftest.py     # shared fixtures
```

Guidelines:
- unit test service logic separately from transport
- integration test router + dependency + DB behavior together
- keep test structure parallel to application domains when possible

## MUST / NEVER

### MUST
- validate request and response shapes with Pydantic
- set `response_model` on endpoints
- keep all I/O async where the stack supports it
- create Alembic migrations for model changes
- inject request-scoped dependencies with `Depends(...)`
- keep `__init__.py` in service subfolders when re-exporting service classes is part of the local pattern
- centralize settings, auth primitives, and shared constants

### NEVER
- put raw SQL in routers or services
- make routers responsible for business decisions
- let services call unrelated domain services directly when a clearer dependency boundary is available
- instantiate shared infra clients repeatedly inside endpoint handlers
- mix ORM models and API response schemas into one class hierarchy
- grow `main.py` into the app's control plane

## Common Mistakes

### 1. Fat router
Symptom: endpoint handlers validate, query, branch on business rules, and build responses inline.

Fix: move decision-making into a service and leave the router with HTTP-only concerns.

### 2. Service doing SQL
Symptom: service imports `select`, writes joins, or manipulates session state directly.

Fix: move persistence logic into a repository.

### 3. Repository returning HTTP-shaped data
Symptom: repository returns `{success: true, data: ...}` or raises transport-specific exceptions.

Fix: repositories should stay persistence-focused.

### 4. Config scattered everywhere
Symptom: modules read environment variables directly in multiple places.

Fix: centralize config in `core/config.py`.

### 5. Domain boundaries collapse
Symptom: `user_service` imports `order_service`, which imports `payment_service`, which imports `user_service`.

Fix: extract a clearer orchestration boundary or shared dependency instead of chaining services.

## Review Notes on the Previous Version

The previous skill had useful content, but it was weak as a discoverable Claude skill:
- frontmatter `name` did not match the actual topic cleanly
- `description` described a role/stack rather than trigger conditions
- title and body framed it as an "agent" instead of a reusable structure skill
- sections were pattern-heavy but missing a clean "when to use / when not to use" split
- there was no layer responsibility table, placement guide, or common mistakes section
- some prescriptions were too absolute without clarifying architectural intent

This rewrite keeps the practical FastAPI structure guidance, but makes the skill easier to discover, scan, and apply correctly.
