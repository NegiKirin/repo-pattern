---
name: nextjs-partent
description: Use when building or modifying Next.js projects that follow Mebiesoft's feature-based modular architecture (Partent). Always invoke this skill whenever the user mentions Next.js features, API layers, CRUD modules, Zustand stores, React Query hooks, App Router pages, or any mention of scaffolding, refactoring, or reviewing a Next.js project structure — even if they don't explicitly say "Partent" or "modular architecture". Also use when bootstrapping a new Next.js project, adding a new domain/entity, or auditing existing feature structure compliance.
---

# Next.js Partent — Feature-Based Modular Architecture

## Core Principle

`app/` contains routes only — all business logic lives inside `features/`.

## Tech Stack

| Layer | Package | Version |
|-------|---------|---------|
| Framework | Next.js (App Router) | 16+ |
| Server State | @tanstack/react-query | ^5 |
| Client State | Zustand | ^5 |
| HTTP | Axios | ^1 |
| Styling | TailwindCSS | ^4 |
| Language | TypeScript (strict) | ^5 |

## Architecture Layers

```
src/
├── app/         → Routes ONLY (pages, layouts, route groups)
├── features/    → [MAIN] Business domain modules (self-contained)
├── shared/      → Cross-feature reusable code (UI, utils)
├── core/        → Infrastructure (API client, config, interceptors)
├── lib/         → Third-party library wrappers
└── types/       → Global TypeScript types
```

### Dependency Rules (STRICT)

```
app/      → features/ (via index.ts), shared/, lib/
features/ → core/, shared/, lib/
shared/   → lib/
core/     → (standalone — NEVER import from features/)
lib/      → (standalone)
```

> NOTE: NEVER let `core/` import from `features/`. Use callback injection if an auth token is needed.

## Feature Structure

```
features/{feature-name}/
├── api/           → {feature}Api.ts        (Axios calls)
├── hooks/         → use{Feature}.ts        (React Query wraps)
├── components/    → {Feature}Card.tsx, etc (UI)
├── store/         → {feature}Store.ts      (Zustand, optional)
├── types/         → {feature}.types.ts     (interfaces)
└── index.ts       → barrel export (public API)
```

## Scaffolding Order (always follow this sequence)

1. `core/api/endpoints.ts` → add new endpoints
2. `features/{name}/types/` → define types
3. `features/{name}/api/` → HTTP functions
4. `features/{name}/hooks/` → React Query hooks
5. `features/{name}/components/` → UI components
6. `features/{name}/index.ts` → barrel export
7. `app/(main)/{name}/page.tsx` → page composing components
8. Sidebar → add menu item if needed

**Full code samples for each step:** see `references/scaffolding.md`

## Quick Rules

### Imports
```typescript
// CORRECT — Import feature via barrel
import { ProductList, useProducts } from '@/features/products';

// WRONG — NEVER import internals directly from outside the feature
import { productApi } from '@/features/products/api/productApi';

// CORRECT — Internal import WITHIN the same feature
import { productApi } from '../api/productApi';

// CORRECT — Shared + core
import { Button } from '@/shared/components/ui';
import { apiClient } from '@/core/api/client';
import { API_ENDPOINTS } from '@/core/api/endpoints';
import { cn } from '@/lib/utils';
```

### Naming Conventions
| Type | Pattern | Example |
|------|---------|---------|
| Component | PascalCase.tsx | `ProductCard.tsx` |
| Hook | use + PascalCase.ts | `useProducts.ts` |
| API file | camelCase + Api.ts | `productApi.ts` |
| Store | camelCase + Store.ts | `authStore.ts` |
| Types | camelCase + .types.ts | `product.types.ts` |

### Export Rules
- **Named exports ONLY** — no default exports
- Exception: `page.tsx`, `layout.tsx` use `export default` (Next.js convention)

### React Query Keys
```typescript
queryKey: ['products', filter]  // list
queryKey: ['product', id]       // single item
```

### className Pattern
```typescript
import { cn } from '@/lib/utils';
className={cn('base-classes', { 'conditional': condition }, className)}
```

## Common Mistakes

| WRONG | CORRECT |
|-------|---------|
| Calling API directly inside a component | Always go through the hooks layer |
| Importing internal paths across features | Import via `index.ts` |
| Default export on a component | Named export |
| Hardcoding URLs in api files | Use `API_ENDPOINTS` |
| Forgetting `isLoading` / `error` | Always handle both |
| Generic queryKey `['data']` | Prefix with feature `['products']` |
| Forgetting `invalidateQueries` after mutation | Add inside `onSuccess` |
| Missing `index.ts` | Always create a barrel export |
| Business logic inside `app/` | Logic belongs in `features/` |

## Reference Files

| File | When to use |
|------|-------------|
| `references/scaffolding.md` | Scaffold a new feature, see full code samples |
| `references/core-infrastructure.md` | Set up `core/api/client.ts`, interceptors, error handling |