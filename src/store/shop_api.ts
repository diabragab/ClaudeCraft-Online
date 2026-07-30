// Typed per-endpoint wrappers over api.ts's generic apiGet/apiPost, one
// function per storefront REST call (server/shop_storefront_catalog_routes.ts,
// shop_storefront_orders_routes.ts). Centralizing the query-string building
// here keeps every page module free of hand-built URLSearchParams repetition.

import { apiGet, apiPost } from './api';
import type {
  StoreCategory,
  StoreClaudiumPackage,
  StoreClaudiumPurchase,
  StoreOrderDetail,
  StoreOrderStatus,
  StorePaginated,
  StoreProduct,
  StoreProductDetail,
} from './types';

export interface ListCategoriesParams {
  page?: number;
  limit?: number;
  q?: string;
  parentId?: number;
  sort?: 'name' | 'sortOrder' | 'createdAt';
  dir?: 'asc' | 'desc';
}

function toQuery(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function listCategories(
  params: ListCategoriesParams = {},
): Promise<StorePaginated<StoreCategory>> {
  return apiGet(`/api/shop/categories${toQuery(params)}`);
}

export function getCategory(slug: string): Promise<StoreCategory> {
  return apiGet(`/api/shop/categories/${encodeURIComponent(slug)}`);
}

export interface ListProductsParams {
  page?: number;
  limit?: number;
  q?: string;
  categoryId?: number;
  featured?: boolean;
  sort?: 'name' | 'createdAt' | 'updatedAt';
  dir?: 'asc' | 'desc';
}

export function listProducts(
  params: ListProductsParams = {},
): Promise<StorePaginated<StoreProduct>> {
  return apiGet(`/api/shop/products${toQuery(params)}`);
}

export function getProduct(slug: string): Promise<StoreProductDetail> {
  return apiGet(`/api/shop/products/${encodeURIComponent(slug)}`);
}

export interface CreateOrderItem {
  productId: number;
  quantity: number;
}

export interface CreateOrderInput {
  currency: 'gold' | 'claudium' | 'usd';
  items: CreateOrderItem[];
  note?: string;
}

export function createOrder(input: CreateOrderInput): Promise<StoreOrderDetail> {
  return apiPost('/api/shop/orders', input);
}

export interface ListMyOrdersParams {
  page?: number;
  limit?: number;
  status?: StoreOrderStatus;
  sort?: 'createdAt' | 'updatedAt' | 'totalAmount';
  dir?: 'asc' | 'desc';
}

export function listMyOrders(
  params: ListMyOrdersParams = {},
): Promise<StorePaginated<StoreOrderDetail>> {
  return apiGet(`/api/shop/orders${toQuery(params)}`);
}

export function getMyOrder(id: number): Promise<StoreOrderDetail> {
  return apiGet(`/api/shop/orders/${id}`);
}

/** The enabled-only Claudium Packages catalog (server/shop_storefront_
 *  packages_routes.ts), ordered for display. */
export function listPackages(): Promise<StorePaginated<StoreClaudiumPackage>> {
  return apiGet(
    `/api/shop/packages${toQuery({ limit: 100, sort: 'displayOrder', dir: 'asc', enabled: true })}`,
  );
}

/** Starts a Stripe Checkout Session for one package (server/claudium_
 *  purchases_routes.ts); requires an authenticated session. */
export function startPackageCheckout(
  packageId: number,
): Promise<{ url: string; sessionId: string }> {
  return apiPost(`/api/shop/packages/${packageId}/checkout`, {});
}

/** The caller's own purchase status, for the confirmation page to poll while
 *  the Stripe webhook catches up. */
export function getPurchaseStatus(sessionId: string): Promise<StoreClaudiumPurchase> {
  return apiGet(`/api/shop/packages/purchases/${encodeURIComponent(sessionId)}`);
}
