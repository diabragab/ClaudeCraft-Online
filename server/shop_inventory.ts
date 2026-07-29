// Shop catalog: inventory business rules. Mirrors the ShopCategoriesService /
// ShopProductsService split: validation and cross-row rules against a narrow
// ShopInventoryDb interface, zero SQL, zero HTTP. One inventory row per
// product (product_id is UNIQUE); a product with no row is "not tracked" (the
// admin never sees a stock number for it, rather than a fabricated zero).
//
// Every quantityOnHand change is recorded as an append-only adjustment (delta,
// reason, acting admin, the resulting quantity) so stock history is always
// reconstructable, mirroring the existing bank_ledger.ts observer pattern
// elsewhere in this server. The write and its adjustment row land atomically
// (see shop_inventory_db.ts): a partial write can never leave the ledger
// disagreeing with the row it describes.

export interface ShopInventoryRecord {
  id: number;
  productId: number;
  /** Joined display fields (the product's own sku/name), read-only here. */
  productSku: string;
  productName: string;
  quantityOnHand: number;
  quantityReserved: number;
  lowStockThreshold: number;
  unlimited: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ShopInventorySort = 'quantity' | 'updatedAt';
export type ShopSortDirection = 'asc' | 'desc';

export interface ShopInventoryListParams {
  page: number;
  limit: number;
  q: string;
  lowStock?: boolean;
  sort: ShopInventorySort;
  dir: ShopSortDirection;
}

export interface ShopInventoryCreateInput {
  productId: number;
  quantityOnHand: number;
  lowStockThreshold: number;
  unlimited: boolean;
  reason: string;
}

export interface ShopInventoryUpdateInput {
  quantityOnHand?: number;
  lowStockThreshold?: number;
  unlimited?: boolean;
  reason?: string;
}

export interface ShopInventoryWriteRow {
  productId: number;
  quantityOnHand: number;
  quantityReserved: number;
  lowStockThreshold: number;
  unlimited: boolean;
}

/** One append-only stock-change ledger row, recorded atomically with its write. */
export interface ShopInventoryAdjustment {
  delta: number;
  reason: string;
  adminAccountId: number | null;
}

export type ShopInventoryErrorCode =
  | 'product_not_found'
  | 'already_tracked'
  | 'invalid_quantity'
  | 'not_found';

export type ShopInventoryResult =
  | { ok: true; inventory: ShopInventoryRecord }
  | { ok: false; error: ShopInventoryErrorCode };

/** The narrow product-existence read ShopInventoryService needs. */
export interface ShopProductLookup {
  getProduct(id: number): Promise<{ id: number } | null>;
}

// Storage abstraction. The Postgres implementation (shop_inventory_db.ts) owns
// the SQL (the UNIQUE product_id index; a violation propagates as a pg
// unique-constraint error, mapped to 409 db.conflict) and the
// write-plus-adjustment atomicity; the in-memory test fake mirrors both.
export interface ShopInventoryDb {
  insertInventory(
    row: ShopInventoryWriteRow,
    adjustment: ShopInventoryAdjustment | null,
  ): Promise<ShopInventoryRecord>;
  getInventory(id: number): Promise<ShopInventoryRecord | null>;
  getInventoryByProduct(productId: number): Promise<ShopInventoryRecord | null>;
  listInventory(
    params: ShopInventoryListParams,
  ): Promise<{ rows: ShopInventoryRecord[]; total: number }>;
  updateInventory(
    id: number,
    patch: Partial<ShopInventoryWriteRow>,
    adjustment: ShopInventoryAdjustment | null,
  ): Promise<ShopInventoryRecord | null>;
  deleteInventory(id: number): Promise<boolean>;
}

export function shopInventoryJson(inventory: ShopInventoryRecord): Record<string, unknown> {
  return { ...inventory };
}

function validQuantities(onHand: number, reserved: number): boolean {
  return onHand >= 0 && reserved >= 0 && reserved <= onHand;
}

export class ShopInventoryService {
  constructor(
    private readonly db: ShopInventoryDb,
    private readonly products: ShopProductLookup,
  ) {}

  async createInventory(
    input: ShopInventoryCreateInput,
    adminAccountId: number | null,
  ): Promise<ShopInventoryResult> {
    if (!validQuantities(input.quantityOnHand, 0)) return { ok: false, error: 'invalid_quantity' };
    if (input.lowStockThreshold < 0) return { ok: false, error: 'invalid_quantity' };
    const product = await this.products.getProduct(input.productId);
    if (!product) return { ok: false, error: 'product_not_found' };
    const existing = await this.db.getInventoryByProduct(input.productId);
    if (existing) return { ok: false, error: 'already_tracked' };
    const adjustment: ShopInventoryAdjustment | null =
      input.quantityOnHand !== 0
        ? { delta: input.quantityOnHand, reason: input.reason, adminAccountId }
        : null;
    const inventory = await this.db.insertInventory(
      {
        productId: product.id,
        quantityOnHand: input.quantityOnHand,
        quantityReserved: 0,
        lowStockThreshold: input.lowStockThreshold,
        unlimited: input.unlimited,
      },
      adjustment,
    );
    return { ok: true, inventory };
  }

  getInventory(id: number): Promise<ShopInventoryRecord | null> {
    return this.db.getInventory(id);
  }

  getInventoryByProduct(productId: number): Promise<ShopInventoryRecord | null> {
    return this.db.getInventoryByProduct(productId);
  }

  listInventory(
    params: ShopInventoryListParams,
  ): Promise<{ rows: ShopInventoryRecord[]; total: number }> {
    return this.db.listInventory(params);
  }

  async updateInventory(
    id: number,
    input: ShopInventoryUpdateInput,
    adminAccountId: number | null,
  ): Promise<ShopInventoryResult> {
    const existing = await this.db.getInventory(id);
    if (!existing) return { ok: false, error: 'not_found' };
    const quantityOnHand = input.quantityOnHand ?? existing.quantityOnHand;
    const quantityReserved = existing.quantityReserved;
    if (!validQuantities(quantityOnHand, quantityReserved)) {
      return { ok: false, error: 'invalid_quantity' };
    }
    if (input.lowStockThreshold !== undefined && input.lowStockThreshold < 0) {
      return { ok: false, error: 'invalid_quantity' };
    }
    const patch: Partial<ShopInventoryWriteRow> = {};
    if (input.quantityOnHand !== undefined) patch.quantityOnHand = input.quantityOnHand;
    if (input.lowStockThreshold !== undefined) patch.lowStockThreshold = input.lowStockThreshold;
    if (input.unlimited !== undefined) patch.unlimited = input.unlimited;
    const adjustment: ShopInventoryAdjustment | null =
      input.quantityOnHand !== undefined && input.quantityOnHand !== existing.quantityOnHand
        ? {
            delta: input.quantityOnHand - existing.quantityOnHand,
            reason: input.reason ?? '',
            adminAccountId,
          }
        : null;
    const inventory = await this.db.updateInventory(id, patch, adjustment);
    if (!inventory) return { ok: false, error: 'not_found' };
    return { ok: true, inventory };
  }

  deleteInventory(id: number): Promise<boolean> {
    return this.db.deleteInventory(id);
  }
}
