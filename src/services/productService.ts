export interface CategoryOption {
  id: number | string
  name_en: string
}

export async function fetchAllCategories(): Promise<{ data: CategoryOption[]; error: string | null }> {
  try {
    const res = await fetch('/api/categories')
    if (!res.ok) throw new Error(`HTTP error ${res.status}`)
    const json = await res.json()
    return { data: json.data || [], error: null }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { data: [], error: msg }
  }
}

export async function fetchAllProducts(): Promise<{ data: any[]; error: string | null }> {
  try {
    const res = await fetch('/api/products')
    if (!res.ok) throw new Error(`HTTP error ${res.status}`)
    const json = await res.json()
    return { data: json.data || [], error: null }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { data: [], error: msg }
  }
}

export async function createProduct(product: {
  name: string
  price: number
  purchase_price?: number
  category_id?: number | string | null
  barcode?: string | null
  has_variants?: boolean
}): Promise<any> {
  const res = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed to create product')
  return json.data
}
