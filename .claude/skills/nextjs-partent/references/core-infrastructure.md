# Core Infrastructure — Partent

Setup for the `core/` layer: API client, interceptors, error handling, and endpoints.

---

## Folder Structure

```
core/
├── api/
│   ├── client.ts       -> Axios instance + interceptors
│   ├── endpoints.ts    -> API endpoint constants
│   └── errors.ts       -> Error types & normalization
└── config/
    └── env.ts          -> Environment variables
```

---

## Environment Config

```typescript
// core/config/env.ts
/**
 * @file env.ts
 * @description Centralized environment variable access
 */

export const env = {
  API_BASE_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api',
  APP_ENV:      process.env.NODE_ENV ?? 'development',
} as const;
```

---

## Error Types

```typescript
// core/api/errors.ts
/**
 * @file errors.ts
 * @description Normalized API error types
 */

export interface ApiErrorResponse {
  message: string;
  code?: string;
  statusCode: number;
  errors?: Record<string, string[]>;
}

export class ApiError extends Error {
  statusCode: number;
  code?: string;
  errors?: Record<string, string[]>;

  constructor(response: ApiErrorResponse) {
    super(response.message);
    this.name = 'ApiError';
    this.statusCode = response.statusCode;
    this.code = response.code;
    this.errors = response.errors;
  }
}
```

---

## Axios Client + Interceptors

```typescript
// core/api/client.ts
/**
 * @file client.ts
 * @description Axios instance with auth + error interceptors
 * NEVER import from features/ — use callback injection if a token is needed
 */

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { env } from '../config/env';
import { ApiError, type ApiErrorResponse } from './errors';

// Callback injection — set by the auth feature after login
let getTokenFn: (() => string | null) | null = null;
let onUnauthorizedFn: (() => void) | null = null;

export function setApiClientAuth(
  getToken: () => string | null,
  onUnauthorized: () => void
) {
  getTokenFn = getToken;
  onUnauthorizedFn = onUnauthorized;
}

// ─── Axios Instance ────────────────────────────────────────────
export const apiClient = axios.create({
  baseURL: env.API_BASE_URL,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─── Request Interceptor: inject auth token ───────────────────
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getTokenFn?.();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response Interceptor: normalize errors ───────────────────
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorResponse>) => {
    if (error.response?.status === 401) {
      onUnauthorizedFn?.();
    }

    const apiErrorData = error.response?.data;
    if (apiErrorData) {
      return Promise.reject(new ApiError(apiErrorData));
    }

    // Network error or timeout
    return Promise.reject(
      new ApiError({
        message: error.message ?? 'Network error',
        statusCode: error.response?.status ?? 0,
      })
    );
  }
);
```

---

## Wiring Auth into apiClient

Call `setApiClientAuth` inside the auth feature after the user logs in — **not inside core**:

```typescript
// features/auth/hooks/useAuthInit.ts
'use client';

import { useEffect } from 'react';
import { setApiClientAuth } from '@/core/api/client';
import { useAuthStore } from '../store/authStore';

export function useAuthInit() {
  const { token, logout } = useAuthStore();

  useEffect(() => {
    setApiClientAuth(
      () => token,
      () => logout()
    );
  }, [token, logout]);
}
```

Use in the root layout or providers:

```typescript
// app/layout.tsx or shared/components/providers/AppProviders.tsx
'use client';
import { useAuthInit } from '@/features/auth';
export function AppProviders({ children }: { children: React.ReactNode }) {
  useAuthInit();
  return <>{children}</>;
}
```

---

## Endpoint Constants

```typescript
// core/api/endpoints.ts
/**
 * @file endpoints.ts
 * @description All API endpoint constants — add new feature endpoints here
 */

export const API_ENDPOINTS = {
  AUTH: {
    LOGIN:   '/auth/login',
    LOGOUT:  '/auth/logout',
    REFRESH: '/auth/refresh',
    ME:      '/auth/me',
  },
  PRODUCTS: {
    LIST:   '/products',
    DETAIL: (id: string) => `/products/${id}`,
    CREATE: '/products',
    UPDATE: (id: string) => `/products/${id}`,
    DELETE: (id: string) => `/products/${id}`,
  },
  // -> add new feature endpoints here
} as const;
```

---

## Error Handling in Components

```typescript
// In a component, use ApiError to display specific error messages
import { ApiError } from '@/core/api/errors';

const { mutate: createOrder, error } = useCreateOrder();

if (error instanceof ApiError) {
  // error.message    -> user-facing message
  // error.errors     -> field-level validation errors (if any)
  // error.statusCode
}
```

---

## React Query Global Error Handler (optional)

```typescript
// lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/core/api/errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Do not retry on 4xx errors
        if (error instanceof ApiError && error.statusCode < 500) return false;
        return failureCount < 2;
      },
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});
```
