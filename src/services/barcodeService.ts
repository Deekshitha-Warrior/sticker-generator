export interface BarcodeRegistryRecord {
  id: string
  barcode_value: string
  entity_type: 'product' | 'variant'
  product_id: number
  variant_id?: string | null
  is_active: boolean
  created_by_name: string
  created_at: string
  updated_at: string
  product?: {
    id: number
    name: string
    price: number
    offer_price?: number
    category?: string
  }
  variant?: {
    id: string
    variant_name: string
    price?: number
    stock?: number
    sku?: string
  } | null
}

export interface CreateBarcodeAndReceivePayload {
  product_id: number
  variant_id?: string | null
  quantity_received: number
  unit_cost?: number | null
  created_by_name?: string
  custom_barcode?: string | null
  note?: string
}

export interface CreateBarcodeResponse {
  success: boolean
  barcode_id: string
  barcode_value: string
  is_new_barcode: boolean
  movement_type: string
  quantity_before: number
  quantity_received: number
  quantity_after: number
  product_id: number
  variant_id?: string | null
  product_name: string
  variant_name?: string
}

export const barcodeService = {
  /**
   * Receive stock and create/reuse barcode in a single atomic transaction.
   */
  async receiveStockWithBarcode(payload: CreateBarcodeAndReceivePayload): Promise<CreateBarcodeResponse> {
    const res = await fetch('/api/barcodes/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const json = await res.json()
    if (!res.ok || json.error) {
      throw new Error(json.error || 'Failed to receive stock with barcode')
    }

    return json.data as CreateBarcodeResponse
  },

  /**
   * Fetch all barcodes in the registry with search.
   */
  async fetchRegistry(params?: { search?: string; limit?: number }): Promise<{ records: BarcodeRegistryRecord[]; total: number }> {
    const searchParam = params?.search ? `?search=${encodeURIComponent(params.search)}` : ''
    const res = await fetch(`/api/barcodes${searchParam}`)
    const json = await res.json()
    if (!res.ok || json.error) {
      throw new Error(json.error || 'Failed to fetch registry')
    }

    const records = (json.data || []).map((row: any) => ({
      ...row,
      product: Array.isArray(row.product) ? row.product[0] : row.product,
      variant: Array.isArray(row.variant) ? row.variant[0] : row.variant,
    })) as BarcodeRegistryRecord[]

    return { records, total: records.length }
  },

  /**
   * Deactivate a barcode in the registry.
   */
  async deactivateBarcode(id: string): Promise<void> {
    const res = await fetch(`/api/barcodes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
    })
    if (!res.ok) {
      throw new Error('Failed to deactivate barcode')
    }
  },
}
