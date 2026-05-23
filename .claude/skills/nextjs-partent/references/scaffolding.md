# Scaffolding Reference — Partent Feature Module

Full code samples for each scaffold step. Uses `orders` as the example entity — replace the name as needed.

---

## Step 1: Add Endpoints

```typescript
// core/api/endpoints.ts
export const API_ENDPOINTS = {
  // ...existing endpoints
  ORDERS: {
    LIST:   '/orders',
    DETAIL: (id: string) => `/orders/${id}`,
    CREATE: '/orders',
    UPDATE: (id: string) => `/orders/${id}`,
    DELETE: (id: string) => `/orders/${id}`,
  },
} as const;
```

---

## Step 2: Define Types

```typescript
// features/orders/types/order.types.ts
/**
 * @file order.types.ts
 * @description Order domain types
 */

export interface Order {
  id: string;
  customerId: string;
  total: number;
  status: 'pending' | 'processing' | 'shipped' | 'delivered';
  createdAt: string;
}

export interface OrderFilter {
  status?: Order['status'];
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateOrderPayload extends Omit<Order, 'id' | 'createdAt'> {}
export interface UpdateOrderPayload extends Partial<CreateOrderPayload> {}
```

---

## Step 3: API Functions

```typescript
// features/orders/api/orderApi.ts
/**
 * @file orderApi.ts
 * @description Order API — HTTP calls only, no business logic
 */

import { apiClient } from '@/core/api/client';
import { API_ENDPOINTS } from '@/core/api/endpoints';
import type { Order, OrderFilter, CreateOrderPayload, UpdateOrderPayload } from '../types/order.types';

export const orderApi = {
  getOrders: async (filter?: OrderFilter): Promise<Order[]> => {
    const { data } = await apiClient.get<Order[]>(API_ENDPOINTS.ORDERS.LIST, {
      params: filter,
    });
    return data;
  },

  getOrderDetail: async (id: string): Promise<Order> => {
    const { data } = await apiClient.get<Order>(API_ENDPOINTS.ORDERS.DETAIL(id));
    return data;
  },

  createOrder: async (payload: CreateOrderPayload): Promise<Order> => {
    const { data } = await apiClient.post<Order>(API_ENDPOINTS.ORDERS.CREATE, payload);
    return data;
  },

  updateOrder: async (id: string, payload: UpdateOrderPayload): Promise<Order> => {
    const { data } = await apiClient.put<Order>(API_ENDPOINTS.ORDERS.UPDATE(id), payload);
    return data;
  },

  deleteOrder: async (id: string): Promise<void> => {
    await apiClient.delete(API_ENDPOINTS.ORDERS.DELETE(id));
  },
};
```

---

## Step 4: React Query Hooks

```typescript
// features/orders/hooks/useOrders.ts
/**
 * @file useOrders.ts
 * @description React Query hooks for Orders
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orderApi } from '../api/orderApi';
import type { OrderFilter, CreateOrderPayload, UpdateOrderPayload } from '../types/order.types';

// ─── Query Keys ───────────────────────────────────────────────
export const orderKeys = {
  all:    () => ['orders'] as const,
  list:   (filter?: OrderFilter) => ['orders', 'list', filter] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
};

// ─── Queries ──────────────────────────────────────────────────
export function useOrders(filter?: OrderFilter) {
  return useQuery({
    queryKey: orderKeys.list(filter),
    queryFn:  () => orderApi.getOrders(filter),
  });
}

export function useOrderDetail(id: string) {
  return useQuery({
    queryKey: orderKeys.detail(id),
    queryFn:  () => orderApi.getOrderDetail(id),
    enabled:  !!id,
  });
}

// ─── Mutations ────────────────────────────────────────────────
export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateOrderPayload) => orderApi.createOrder(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orderKeys.all() });
    },
  });
}

export function useUpdateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateOrderPayload }) =>
      orderApi.updateOrder(id, payload),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: orderKeys.all() });
      qc.invalidateQueries({ queryKey: orderKeys.detail(id) });
    },
  });
}

export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderApi.deleteOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orderKeys.all() });
    },
  });
}
```

---

## Step 5: Components

### Card Component

```typescript
// features/orders/components/OrderCard.tsx
/**
 * @file OrderCard.tsx
 * @description Single order display card
 */

'use client';

import { cn } from '@/lib/utils';
import type { Order } from '../types/order.types';

const STATUS_STYLES: Record<Order['status'], string> = {
  pending:    'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  shipped:    'bg-purple-100 text-purple-800',
  delivered:  'bg-green-100 text-green-800',
};

interface OrderCardProps {
  order: Order;
  onPress?: (order: Order) => void;
  className?: string;
}

export function OrderCard({ order, onPress, className }: OrderCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow',
        onPress && 'cursor-pointer',
        className
      )}
      onClick={() => onPress?.(order)}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-lg">Order #{order.id}</h3>
        <span className={cn('text-xs px-2 py-1 rounded-full font-medium', STATUS_STYLES[order.status])}>
          {order.status}
        </span>
      </div>
      <p className="text-blue-600 font-bold text-xl">
        ${order.total.toLocaleString()}
      </p>
    </div>
  );
}
```

### List Component

```typescript
// features/orders/components/OrderList.tsx
/**
 * @file OrderList.tsx
 * @description Orders list with loading/error/empty states
 */

'use client';

import { useOrders } from '../hooks/useOrders';
import { OrderCard } from './OrderCard';
import type { OrderFilter } from '../types/order.types';

interface OrderListProps {
  filter?: OrderFilter;
}

export function OrderList({ filter }: OrderListProps) {
  const { data: orders, isLoading, error } = useOrders(filter);

  if (isLoading) return <div className="text-center py-8 text-gray-500">Loading...</div>;
  if (error)     return <div className="text-center py-8 text-red-500">Failed to load data</div>;
  if (!orders?.length) return <div className="text-center py-8 text-gray-400">No orders found</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} />
      ))}
    </div>
  );
}
```

---

## Step 6: Barrel Export

```typescript
// features/orders/index.ts
/**
 * @file index.ts
 * @description Orders feature — Public API
 * Only export what other features/pages need. Keep internals private.
 */

// Components
export { OrderCard } from './components/OrderCard';
export { OrderList } from './components/OrderList';

// Hooks
export {
  useOrders,
  useOrderDetail,
  useCreateOrder,
  useUpdateOrder,
  useDeleteOrder,
  orderKeys,
} from './hooks/useOrders';

// API (expose only if other features need to call directly)
export { orderApi } from './api/orderApi';

// Types
export type {
  Order,
  OrderFilter,
  CreateOrderPayload,
  UpdateOrderPayload,
} from './types/order.types';
```

---

## Step 7: Page

```typescript
// app/(main)/orders/page.tsx
/**
 * @file page.tsx
 * @description Orders page — compose only, no logic here
 */

import { OrderList } from '@/features/orders';
import { Button } from '@/shared/components/ui';

export default function OrdersPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Order Management</h1>
        <Button variant="primary">Add Order</Button>
      </div>
      <OrderList />
    </div>
  );
}
```

---

## Step 8: Sidebar Menu

```typescript
// shared/components/layout/Sidebar.tsx — add to menuItems:
{ name: 'Orders', href: '/orders', icon: '' },
```

---

## Zustand Store Pattern (when client state is needed)

```typescript
// features/orders/store/orderStore.ts
'use client';

import { create } from 'zustand';

interface OrderStoreState {
  selectedOrderId: string | null;
  setSelectedOrderId: (id: string | null) => void;
}

// Do not use persist unless state needs to survive page reloads
export const useOrderStore = create<OrderStoreState>()((set) => ({
  selectedOrderId: null,
  setSelectedOrderId: (id) => set({ selectedOrderId: id }),
}));
```

> Use `persist` + `localStorage` only for auth sessions or user preferences. Most features do not need it.

---

## Shared UI Component Pattern

```typescript
// shared/components/ui/Button.tsx
import { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline';
  children: ReactNode;
}

export function Button({ variant = 'primary', className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'px-4 py-2 rounded-md font-medium transition-colors',
        {
          'bg-blue-600 text-white hover:bg-blue-700': variant === 'primary',
          'bg-gray-600 text-white hover:bg-gray-700': variant === 'secondary',
          'border border-gray-300 hover:bg-gray-50':  variant === 'outline',
        },
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
```
