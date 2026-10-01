export type ProductVariant = {
  id: string
  productId: string
  variantName: string
  sizeLabel: string | null
  weightValue: number | null
  weightUnit: string | null
  sku: string | null
  barcode: string | null
  purchasePrice: number | null
  mrp: number | null
  price: number
  stock: number
  isDefault: boolean
  isActive: boolean
  sortOrder: number
  imageUrl: string | null
  groupName: string | null
}

function mapVariant(r: Record<string, unknown>): ProductVariant {
  return {
    id: String(r.id || ''),
    productId: String(r.product_id || ''),
    variantName: String(r.variant_name || ''),
    sizeLabel: r.size_label ? String(r.size_label) : null,
    weightValue: r.weight_value != null ? Number(r.weight_value) : null,
    weightUnit: r.weight_unit ? String(r.weight_unit) : null,
    sku: r.sku ? String(r.sku) : null,
    barcode: r.barcode ? String(r.barcode) : null,
    purchasePrice: r.purchase_price != null ? Number(r.purchase_price) : null,
    mrp: r.mrp != null ? Number(r.mrp) : null,
    price: Number(r.price ?? 0),
    stock: Number(r.stock ?? 0),
    isDefault: r.is_default === true,
    isActive: r.is_active !== false,
    sortOrder: Number(r.sort_order ?? 0),
    imageUrl: r.image_url ? String(r.image_url) : null,
    groupName: r.group_name ? String(r.group_name) : null,
  }
}

export async function fetchAllVariants(): Promise<{ data: ProductVariant[]; error: string | null }> {
  try {
    const res = await fetch('/api/variants')
    if (!res.ok) throw new Error(`HTTP error ${res.status}`)
    const json = await res.json()
    return {
      data: (json.data || []).map((r: Record<string, unknown>) => mapVariant(r)),
      error: null,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { data: [], error: msg }
  }
}

export async function fetchVariantsByProduct(productId: string): Promise<ProductVariant[]> {
  try {
    const res = await fetch(`/api/variants?productId=${encodeURIComponent(productId)}`)
    if (!res.ok) throw new Error(`HTTP error ${res.status}`)
    const json = await res.json()
    return (json.data || []).map((r: Record<string, unknown>) => mapVariant(r))
  } catch (err) {
    console.error('Failed to load variants:', err)
    return []
  }
}
