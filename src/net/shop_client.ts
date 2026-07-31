// Client-side typed fetch wrapper for the in-game Shop (Phase 7), the general
// Shop System's catalog + the internal Claudium ledger checkout. Same-origin
// only: talks to the GAME server's /api/shop/* routes
// (server/shop_storefront_catalog_routes.ts, server/shop_buy_routes.ts,
// server/claudium_ledger_routes.ts, server/shop_storefront_packages_routes.ts),
// never a second implementation of catalog, ledger, or checkout logic.
// Mirrors economy_sdk.ts's role and shape (a thin per-endpoint wrapper, its
// own locally-declared wire types rather than importing src/store/'s, the
// same way economy_sdk.ts and server/claudium_proxy.ts each declare their own
// parallel types for the same wire shapes) so src/ui/ never has to import
// net/ or store/ directly: src/main.ts is the only caller, injecting a
// ShopHooks bag into Hud exactly like it already does for Claudium.

import { apiUrl } from './online';

export type ShopProductGrantKind = 'none' | 'weapon_skin' | 'item';

export type ShopRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export type ShopBadge =
  | 'new'
  | 'hot'
  | 'featured'
  | 'best_value'
  | 'limited'
  | 'sale'
  | 'event'
  | 'exclusive'
  | 'popular';

export interface ShopCatalogCategory {
  id: number;
  name: string;
  slug: string;
}

export interface ShopCatalogProduct {
  id: number;
  sku: string;
  name: string;
  slug: string;
  description: string;
  categoryId: number | null;
  priceGoldCopper: number | null;
  priceClaudium: number | null;
  icon: string | null;
  displayOrder: number;
  status: 'draft' | 'active' | 'archived';
  featured: boolean;
  grantKind: ShopProductGrantKind;
  grantItemId: string | null;
  grantQuantity: number;
  availability: 'unlimited' | 'in_stock' | 'low_stock' | 'out_of_stock' | 'unavailable';
  rarity: ShopRarity;
  badges: ShopBadge[];
  isEvent: boolean;
  isLimited: boolean;
  discountPercent: number | null;
  bannerImage: string | null;
  previewImage: string | null;
}

export interface ClaudiumPackage {
  id: number;
  name: string;
  claudiumAmount: number;
  bonusAmount: number;
  price: number;
  currency: string;
  displayOrder: number;
  imageUrl: string | null;
  discountPercent: number;
  featured: boolean;
}

export interface ClaudiumHistoryEntry {
  id: number;
  amount: number;
  type: 'PURCHASE' | 'ADMIN_ADD' | 'ADMIN_REMOVE' | 'REWARD' | 'REFUND';
  reason: string;
  createdAt: string;
}

/** ok:false's reason is the server's stable shop.* error code (minus the
 *  'shop.' prefix), e.g. 'insufficient_claudium' / 'price_changed'. */
export interface ShopBuyResult {
  ok: boolean;
  balance: number | null;
  reason: string | null;
}

// Same localStorage session the game client and homepage account portal
// already share (src/net/online.ts's Api.SESSION_KEY literal), read directly
// here rather than importing the heavier Api/ClientWorld machinery.
const SESSION_KEY = 'woc_session';
function shopToken(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string };
    return typeof parsed.token === 'string' ? parsed.token : null;
  } catch {
    return null;
  }
}

async function shopGet<T>(path: string): Promise<T | null> {
  const token = shopToken();
  if (!token) return null;
  try {
    const res = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function listShopCategories(): Promise<ShopCatalogCategory[]> {
  const res = await shopGet<{ rows: ShopCatalogCategory[] }>(
    '/api/shop/categories?limit=100&sort=name&dir=asc',
  );
  return res?.rows ?? [];
}

export async function listShopProducts(
  q: string,
  categoryId?: number,
): Promise<ShopCatalogProduct[]> {
  const params = new URLSearchParams({ limit: '100', status: 'active', sort: 'name', dir: 'asc' });
  if (q) params.set('q', q);
  if (categoryId !== undefined) params.set('categoryId', String(categoryId));
  const res = await shopGet<{ rows: ShopCatalogProduct[] }>(`/api/shop/products?${params}`);
  return res?.rows ?? [];
}

/** The enabled-only Claudium Packages catalog (server/shop_storefront_packages_routes.ts). */
export async function listClaudiumPackages(): Promise<ClaudiumPackage[]> {
  const res = await shopGet<{ rows: ClaudiumPackage[] }>(
    '/api/shop/packages?limit=100&sort=displayOrder&dir=asc',
  );
  return res?.rows ?? [];
}

/** The caller's own Claudium balance (server/claudium_ledger_routes.ts), or
 *  null when signed out or the request fails. */
export async function claudiumBalance(): Promise<number | null> {
  const res = await shopGet<{ balance: number }>('/api/shop/claudium/balance');
  return typeof res?.balance === 'number' ? res.balance : null;
}

/** The caller's own Claudium transaction history, newest first. */
export async function claudiumHistory(limit = 100): Promise<ClaudiumHistoryEntry[]> {
  const res = await shopGet<{ entries: ClaudiumHistoryEntry[] }>(
    `/api/shop/claudium/history?limit=${limit}`,
  );
  return res?.entries ?? [];
}

/** Strips the leading 'shop.' from a problem+json code, e.g.
 *  'shop.insufficient_claudium' -> 'insufficient_claudium'. Falls back to
 *  'unavailable' for a network failure or a body the server didn't shape. */
function reasonFromCode(code: unknown): string {
  if (typeof code === 'string' && code.startsWith('shop.')) return code.slice('shop.'.length);
  return 'unavailable';
}

/** Buy one unit(s) of a product with the player's own Claudium balance
 *  (Phase 7, POST /api/shop/buy): the internal ledger checkout, delivery is
 *  immediate server-side. */
export async function buyProduct(
  productId: number,
  characterId: number,
  quantity: number,
): Promise<ShopBuyResult> {
  const token = shopToken();
  if (!token) return { ok: false, balance: null, reason: 'unavailable' };
  try {
    const res = await fetch(apiUrl('/api/shop/buy'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ productId, characterId, quantity }),
    });
    const body = (await res.json().catch(() => null)) as { balance?: number; code?: string } | null;
    if (!res.ok) {
      return { ok: false, balance: null, reason: reasonFromCode(body?.code) };
    }
    return {
      ok: true,
      balance: typeof body?.balance === 'number' ? body.balance : null,
      reason: null,
    };
  } catch {
    return { ok: false, balance: null, reason: 'unavailable' };
  }
}
