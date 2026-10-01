import { create } from 'zustand'
import { fetchAllCategories, fetchAllProducts } from '../services/productService'
import { fetchAllVariants, type ProductVariant } from '../services/variantService'
import { toNumber, type UnitType } from '../lib/retail'

export type { ProductVariant }

export interface Product {
  id: string | number
  name: string
  nameTa?: string
  tamilName?: string
  category: string
  categoryId?: number | string | null
  price: number
  offerPrice?: number | null
  unitType?: UnitType
  unitLabel?: string
  baseQuantity?: number
  stockQuantity: number
  stock?: number
  costPrice?: number
  purchasePrice?: number
  isActive: boolean
  sortOrder: number
  hasVariants?: boolean
  sku?: string
  barcode?: string
}

interface ProductState {
  products: Product[]
  loading: boolean
  error: string | null
  lastFetch: number
  fetchProducts: (force?: boolean) => Promise<void>
}

interface VariantStoreState {
  variantsMap: Record<string, ProductVariant[]>
  fetched: boolean
  fetchVariants: () => Promise<void>
  refetchVariants: () => Promise<void>
  getVariants: (productId: string | number) => ProductVariant[]
  hasVariants: (productId: string | number) => boolean
}

export const useProductStore = create<ProductState>((set, get) => ({
  products: [],
  loading: false,
  error: null,
  lastFetch: 0,
  fetchProducts: async (force = false) => {
    if (!force && Date.now() - get().lastFetch < 60000 && get().products.length > 0) return

    set({ loading: true, error: null })
    try {
      const [{ data, error }, { data: categoryData }] = await Promise.all([
        fetchAllProducts(),
        fetchAllCategories(),
      ])

      if (error) throw new Error(error)

      const categoriesById = Object.fromEntries(
        (categoryData || []).map((cat: { id: number | string; name_en: string }) => [
          String(cat.id),
          String(cat.name_en || '').trim(),
        ])
      )

      const normalized: Product[] = (data || []).map((p: any) => ({
        id: p.id,
        name: String(p.name || 'Product').trim(),
        nameTa: p.name_ta || undefined,
        tamilName: p.tamil_name || undefined,
        category: categoriesById[String(p.category_id)] || p.category || 'General',
        categoryId: p.category_id,
        price: toNumber(p.price, 0),
        offerPrice: p.offer_price != null ? toNumber(p.offer_price, 0) : null,
        stockQuantity: toNumber(p.stock_quantity ?? p.stock, 0),
        stock: Math.floor(toNumber(p.stock_quantity ?? p.stock, 0)),
        costPrice: toNumber(p.purchase_price, 0),
        purchasePrice: toNumber(p.purchase_price, 0),
        isActive: p.is_active !== false,
        sortOrder: toNumber(p.sort_order, 0),
        hasVariants: Boolean(p.has_variants),
        sku: p.sku ? String(p.sku) : undefined,
        barcode: p.barcode ? String(p.barcode) : undefined,
      }))

      set({ products: normalized, loading: false, lastFetch: Date.now() })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unable to fetch products',
        loading: false,
      })
    }
  },
}))

export const useVariantStore = create<VariantStoreState>((set, get) => ({
  variantsMap: {},
  fetched: false,
  fetchVariants: async () => {
    if (get().fetched) return
    const { data } = await fetchAllVariants()
    const map: Record<string, ProductVariant[]> = {}
    for (const v of data) {
      if (!map[v.productId]) map[v.productId] = []
      map[v.productId].push(v)
    }
    set({ variantsMap: map, fetched: true })
  },
  refetchVariants: async () => {
    set({ fetched: false })
    const { data } = await fetchAllVariants()
    const map: Record<string, ProductVariant[]> = {}
    for (const v of data) {
      if (!map[v.productId]) map[v.productId] = []
      map[v.productId].push(v)
    }
    set({ variantsMap: map, fetched: true })
  },
  getVariants: (productId) => get().variantsMap[String(productId)] || [],
  hasVariants: (productId) => (get().variantsMap[String(productId)] || []).length > 0,
}))
