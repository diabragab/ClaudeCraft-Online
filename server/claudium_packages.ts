// Claudium Packages: business rules over ClaudiumPackagesDb (server/
// claudium_packages_db.ts, zero SQL here). Field SHAPE is validated one
// layer up by the routes modules via server/http/schema.ts; this module
// enforces the one cross-field rule schema.ts cannot express (a Stripe price
// id is optional, an empty string clears it the same way shop_products.ts's
// price fields use '' to mean "unset").

export interface ClaudiumPackageRecord {
  id: number;
  name: string;
  claudiumAmount: number;
  bonusAmount: number;
  price: number;
  currency: string;
  stripePriceId: string | null;
  enabled: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClaudiumPackageCreateInput {
  name: string;
  claudiumAmount: number;
  bonusAmount: number;
  price: number;
  currency: string;
  stripePriceId: string;
  enabled: boolean;
  displayOrder: number;
}

export interface ClaudiumPackageUpdateInput {
  name?: string;
  claudiumAmount?: number;
  bonusAmount?: number;
  price?: number;
  currency?: string;
  stripePriceId?: string;
  enabled?: boolean;
  displayOrder?: number;
}

export interface ClaudiumPackageWriteRow {
  name: string;
  claudiumAmount: number;
  bonusAmount: number;
  price: number;
  currency: string;
  stripePriceId: string | null;
  enabled: boolean;
  displayOrder: number;
}

export type ClaudiumPackageSort = 'displayOrder' | 'name' | 'createdAt' | 'updatedAt';
export type ClaudiumPackageSortDirection = 'asc' | 'desc';

export interface ClaudiumPackageListParams {
  page: number;
  limit: number;
  q: string;
  enabled?: boolean;
  sort: ClaudiumPackageSort;
  dir: ClaudiumPackageSortDirection;
}

export type ClaudiumPackageErrorCode = 'not_found';

export type ClaudiumPackageResult =
  | { ok: true; pkg: ClaudiumPackageRecord }
  | { ok: false; error: ClaudiumPackageErrorCode };

export interface ClaudiumPackagesDb {
  insertPackage(row: ClaudiumPackageWriteRow): Promise<ClaudiumPackageRecord>;
  getPackage(id: number): Promise<ClaudiumPackageRecord | null>;
  listPackages(
    params: ClaudiumPackageListParams,
  ): Promise<{ rows: ClaudiumPackageRecord[]; total: number }>;
  updatePackage(
    id: number,
    patch: Partial<ClaudiumPackageWriteRow>,
  ): Promise<ClaudiumPackageRecord | null>;
  deletePackage(id: number): Promise<boolean>;
}

export function claudiumPackageJson(pkg: ClaudiumPackageRecord): Record<string, unknown> {
  return { ...pkg };
}

function resolveWriteRow(
  input: ClaudiumPackageCreateInput | (ClaudiumPackageUpdateInput & { name: string }),
  existing: ClaudiumPackageRecord | null,
): ClaudiumPackageWriteRow {
  const stripePriceIdRaw = input.stripePriceId ?? existing?.stripePriceId ?? '';
  return {
    name: input.name ?? (existing?.name as string),
    claudiumAmount: input.claudiumAmount ?? existing?.claudiumAmount ?? 0,
    bonusAmount: input.bonusAmount ?? existing?.bonusAmount ?? 0,
    price: input.price ?? existing?.price ?? 0,
    currency: input.currency ?? existing?.currency ?? 'USD',
    stripePriceId: stripePriceIdRaw.trim() === '' ? null : stripePriceIdRaw.trim(),
    enabled: input.enabled ?? existing?.enabled ?? true,
    displayOrder: input.displayOrder ?? existing?.displayOrder ?? 0,
  };
}

export class ClaudiumPackagesService {
  constructor(private readonly db: ClaudiumPackagesDb) {}

  async createPackage(input: ClaudiumPackageCreateInput): Promise<ClaudiumPackageResult> {
    const row = resolveWriteRow(input, null);
    const pkg = await this.db.insertPackage(row);
    return { ok: true, pkg };
  }

  getPackage(id: number): Promise<ClaudiumPackageRecord | null> {
    return this.db.getPackage(id);
  }

  listPackages(
    params: ClaudiumPackageListParams,
  ): Promise<{ rows: ClaudiumPackageRecord[]; total: number }> {
    return this.db.listPackages(params);
  }

  async updatePackage(
    id: number,
    input: ClaudiumPackageUpdateInput,
  ): Promise<ClaudiumPackageResult> {
    const existing = await this.db.getPackage(id);
    if (!existing) return { ok: false, error: 'not_found' };
    const resolved = resolveWriteRow({ ...input, name: input.name ?? existing.name }, existing);
    const patch: Partial<ClaudiumPackageWriteRow> = {};
    if (input.name !== undefined) patch.name = resolved.name;
    if (input.claudiumAmount !== undefined) patch.claudiumAmount = resolved.claudiumAmount;
    if (input.bonusAmount !== undefined) patch.bonusAmount = resolved.bonusAmount;
    if (input.price !== undefined) patch.price = resolved.price;
    if (input.currency !== undefined) patch.currency = resolved.currency;
    if (input.stripePriceId !== undefined) patch.stripePriceId = resolved.stripePriceId;
    if (input.enabled !== undefined) patch.enabled = resolved.enabled;
    if (input.displayOrder !== undefined) patch.displayOrder = resolved.displayOrder;
    const pkg = await this.db.updatePackage(id, patch);
    if (!pkg) return { ok: false, error: 'not_found' };
    return { ok: true, pkg };
  }

  deletePackage(id: number): Promise<boolean> {
    return this.db.deletePackage(id);
  }
}
