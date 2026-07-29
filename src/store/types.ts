// Client-side mirrors of the storefront REST response shapes (server/shop_
// storefront_catalog_routes.ts, shop_storefront_orders_routes.ts), the same
// "types.ts mirrors the server record shape" convention src/admin/types.ts
// already uses for the admin dashboard.

export type StoreCategoryStatus = 'active' | 'archived';

export interface StoreCategory {
  id: number;
  name: string;
  slug: string;
  description: string;
  parentId: number | null;
  sortOrder: number;
  status: StoreCategoryStatus;
  createdAt: string;
  updatedAt: string;
}

export type StorefrontAvailability =
  | 'unlimited'
  | 'in_stock'
  | 'low_stock'
  | 'out_of_stock'
  | 'unavailable';

export type StoreProductStatus = 'draft' | 'active' | 'archived';

export interface StoreProduct {
  id: number;
  sku: string;
  name: string;
  slug: string;
  description: string;
  categoryId: number | null;
  priceGoldCopper: number | null;
  priceClaudium: number | null;
  priceUsdCents: number | null;
  railSol: boolean;
  railUsdc: boolean;
  railWoc: boolean;
  status: StoreProductStatus;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
  availability: StorefrontAvailability;
}

export interface StoreProductDetail extends StoreProduct {
  category: StoreCategory | null;
}

export interface StorePaginated<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
}

export type StoreOrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';
export type StoreOrderCurrency = 'gold' | 'claudium' | 'usd';

export interface StoreOrder {
  id: number;
  accountId: number;
  accountUsername: string;
  status: StoreOrderStatus;
  currency: StoreOrderCurrency;
  totalAmount: number;
  note: string;
  createdByAdminId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoreOrderItem {
  id: number;
  productId: number | null;
  productSku: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface StoreOrderStatusHistory {
  id: number;
  fromStatus: StoreOrderStatus | null;
  toStatus: StoreOrderStatus;
  adminAccountId: number | null;
  note: string;
  createdAt: string;
}

export interface StoreOrderDetail extends StoreOrder {
  items: StoreOrderItem[];
  history: StoreOrderStatusHistory[];
}
