// Client-side typed fetch wrapper for the in-game Shop (Phase 5), the
// general Shop System's catalog + Claudium checkout. Same-origin only: talks
// to the GAME server's /api/shop/* routes (server/shop_storefront_catalog_routes.ts,
// server/shop_storefront_claudium_routes.ts), never a second implementation
// of catalog or checkout logic. Mirrors economy_sdk.ts's role and shape (a
// thin per-endpoint wrapper, its own locally-declared wire types rather than
// importing src/store/'s, the same way economy_sdk.ts and
// server/claudium_proxy.ts each declare their own parallel types for the
// same wire shapes) so src/ui/ never has to import net/ or store/ directly:
// src/main.ts is the only caller, injecting a ShopHooks bag into Hud exactly
// like it already does for Claudium.

import { apiUrl } from './online';

export type ShopProductGrantKind = 'none' | 'weapon_skin' | 'item';

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
  status: 'draft' | 'active' | 'archived';
  featured: boolean;
  grantKind: ShopProductGrantKind;
  grantItemId: string | null;
  grantQuantity: number;
  availability: 'unlimited' | 'in_stock' | 'low_stock' | 'out_of_stock' | 'unavailable';
}

/** ok:false's reason is the server's stable shop.* error code (minus the
 *  'shop.' prefix), e.g. 'insufficient_claudium' / 'price_changed'. */
export interface ShopClaudiumPurchaseResult {
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

/** Strips the leading 'shop.' from a problem+json code, e.g.
 *  'shop.insufficient_claudium' -> 'insufficient_claudium'. Falls back to
 *  'unavailable' for a network failure or a body the server didn't shape. */
function reasonFromCode(code: unknown): string {
  if (typeof code === 'string' && code.startsWith('shop.')) return code.slice('shop.'.length);
  return 'unavailable';
}

export async function purchaseWithClaudium(
  productId: number,
  characterId: number,
  quantity: number,
): Promise<ShopClaudiumPurchaseResult> {
  return purchaseAt('/api/shop/claudium/purchase', productId, characterId, quantity);
}

/** Buy one unit(s) of a product with the player's own live gold (Phase 6):
 *  no external economy service, delivery is immediate server-side. Same
 *  wire shape and error-code convention as purchaseWithClaudium above. */
export async function purchaseWithGold(
  productId: number,
  characterId: number,
  quantity: number,
): Promise<ShopClaudiumPurchaseResult> {
  return purchaseAt('/api/shop/gold/purchase', productId, characterId, quantity);
}

async function purchaseAt(
  path: string,
  productId: number,
  characterId: number,
  quantity: number,
): Promise<ShopClaudiumPurchaseResult> {
  const token = shopToken();
  if (!token) return { ok: false, balance: null, reason: 'unavailable' };
  try {
    const res = await fetch(apiUrl(path), {
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
