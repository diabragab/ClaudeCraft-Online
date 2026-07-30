// The URL-safe slug charset shared by every shop catalog domain (categories,
// products): lowercase letters, digits, and single hyphens between segments.
// A tiny, single-purpose module (rule of three: shop_categories.ts and
// shop_products.ts both need the identical check) so the format cannot drift
// between the two domains' validation rules.

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validSlugFormat(slug: string): boolean {
  return SLUG_RE.test(slug);
}
