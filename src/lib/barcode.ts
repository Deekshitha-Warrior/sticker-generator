import JsBarcode from 'jsbarcode'

/** Normalize any scanned or user-entered barcode to a consistent UPPERCASE trimmed string. */
export const normalizeBarcode = (code: string | null | undefined): string => {
  return (code ?? '').trim().toUpperCase()
}

export interface LabelSizeConfig {
  id: string
  name: string
  labelsPerRow: number
  widthMm: number
  heightMm: number
  horizontalGapMm: number
  isCustom?: boolean
}

export interface DbLabelSize {
  id: string
  name: string
  width_mm: number
  height_mm: number
  labels_per_row: number
  horizontal_gap_mm: number
  is_default?: boolean
  created_at: string
  updated_at: string
}

export function mapDbToLabelConfig(row: DbLabelSize): LabelSizeConfig {
  return {
    id: row.id,
    name: row.name,
    widthMm: Number(row.width_mm),
    heightMm: Number(row.height_mm),
    labelsPerRow: Number(row.labels_per_row) || 1,
    horizontalGapMm: Number(row.horizontal_gap_mm) || 0,
    isCustom: true,
  }
}

export const DEFAULT_LABEL_SIZES: LabelSizeConfig[] = []

export const DEFAULT_FALLBACK_LABEL_SIZE: LabelSizeConfig = {
  id: 'standard_fallback',
  name: 'Standard (50 × 25 mm)',
  labelsPerRow: 1,
  widthMm: 50,
  heightMm: 25,
  horizontalGapMm: 0,
}

export interface BarcodeSettings {
  printerType: 'label' | 'regular'
  selectedSizeId: string
  showSalePrice: boolean
  showCompanyName: boolean
  showItemName: boolean
  showDiscount: boolean
}

export const DEFAULT_BARCODE_SETTINGS: BarcodeSettings = {
  printerType: 'label',
  selectedSizeId: '',
  showSalePrice: true,
  showCompanyName: true,
  showItemName: true,
  showDiscount: false,
}

const SETTINGS_KEY = 'madhuratex_barcode_settings'
const LEGACY_SETTINGS_KEY = 'chaji_barcode_settings'
const OLD_LEGACY_SETTINGS_KEY = 'clad_barcode_settings'
const CUSTOM_SIZES_KEY = 'madhuratex_custom_label_sizes'
const LEGACY_CUSTOM_SIZES_KEY = 'chaji_custom_label_sizes'
const OLD_LEGACY_CUSTOM_SIZES_KEY = 'clad_custom_label_sizes'
const SIZES_WIPED_VERSION_KEY = 'madhuratex_sizes_wiped_v2'

export function clearAllCustomSizes(): void {
  try {
    localStorage.removeItem(CUSTOM_SIZES_KEY)
    localStorage.removeItem(LEGACY_CUSTOM_SIZES_KEY)
    localStorage.removeItem(OLD_LEGACY_CUSTOM_SIZES_KEY)
    const current = getStoredBarcodeSettings()
    saveStoredBarcodeSettings({ ...current, selectedSizeId: '' })
  } catch (e) {
    console.error('Failed to clear custom label sizes:', e)
  }
}

export function getStoredBarcodeSettings(): BarcodeSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_SETTINGS_KEY) || localStorage.getItem(OLD_LEGACY_SETTINGS_KEY)
    if (raw) {
      return { ...DEFAULT_BARCODE_SETTINGS, ...JSON.parse(raw) }
    }
  } catch (e) {
    console.error('Failed to parse barcode settings:', e)
  }
  return DEFAULT_BARCODE_SETTINGS
}

export function saveStoredBarcodeSettings(settings: BarcodeSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to save barcode settings:', e)
  }
}

export function getStoredCustomSizes(): LabelSizeConfig[] {
  try {
    // If not yet wiped to clean slate per user request, clear existing stored records
    if (typeof window !== 'undefined' && !localStorage.getItem(SIZES_WIPED_VERSION_KEY)) {
      clearAllCustomSizes()
      localStorage.setItem(SIZES_WIPED_VERSION_KEY, 'true')
      return []
    }

    const raw = localStorage.getItem(CUSTOM_SIZES_KEY) || localStorage.getItem(LEGACY_CUSTOM_SIZES_KEY) || localStorage.getItem(OLD_LEGACY_CUSTOM_SIZES_KEY)
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list)) {
        const seenNames = new Set<string>()
        const seenIds = new Set<string>()
        const seenSignatures = new Set<string>()
        const unique: LabelSizeConfig[] = []
        for (const item of list) {
          if (!item || !item.name) continue
          const lower = String(item.name).trim().toLowerCase()
          const sig = `${item.widthMm}x${item.heightMm}_${item.labelsPerRow || 1}`
          if (!seenNames.has(lower) && !seenIds.has(item.id) && !seenSignatures.has(sig)) {
            seenNames.add(lower)
            seenIds.add(item.id)
            seenSignatures.add(sig)
            unique.push({ ...item, isCustom: true })
          }
        }
        return unique
      }
    }
  } catch (e) {
    console.error('Failed to parse custom label sizes:', e)
  }
  return []
}

export function saveStoredCustomSize(size: LabelSizeConfig): LabelSizeConfig[] {
  const lowerName = size.name.trim().toLowerCase()
  const sig = `${size.widthMm}x${size.heightMm}_${size.labelsPerRow}`
  const existing = getStoredCustomSizes().filter(
    (s) => s.id !== size.id &&
           s.name.trim().toLowerCase() !== lowerName &&
           `${s.widthMm}x${s.heightMm}_${s.labelsPerRow}` !== sig
  )
  const updated = [...existing, { ...size, isCustom: true }]
  try {
    localStorage.setItem(CUSTOM_SIZES_KEY, JSON.stringify(updated))
  } catch (e) {
    console.error('Failed to save custom label size:', e)
  }
  return updated
}

export function deleteStoredCustomSize(id: string): LabelSizeConfig[] {
  const existing = getStoredCustomSizes().filter((s) => s.id !== id)
  try {
    localStorage.setItem(CUSTOM_SIZES_KEY, JSON.stringify(existing))
  } catch (e) {
    console.error('Failed to delete custom label size:', e)
  }
  return existing
}

export function getAllLabelSizes(): LabelSizeConfig[] {
  return [...DEFAULT_LABEL_SIZES, ...getStoredCustomSizes()]
}

/**
 * Fetch all label sizes from database with local storage fallback
 */
export async function fetchLabelSizesFromDb(): Promise<LabelSizeConfig[]> {
  try {
    const res = await fetch('/api/label-sizes')
    if (!res.ok) throw new Error(`HTTP error ${res.status}`)
    const json = await res.json()
    const data = json.data || []

    const mapped = (data || []).map((row: DbLabelSize) => mapDbToLabelConfig(row))
    try {
      localStorage.setItem(CUSTOM_SIZES_KEY, JSON.stringify(mapped))
      localStorage.setItem(SIZES_WIPED_VERSION_KEY, 'true')
    } catch (_) {}
    return mapped.length > 0 ? mapped : getAllLabelSizes()
  } catch (err) {
    console.error('[fetchLabelSizesFromDb] Exception:', err)
    return getAllLabelSizes()
  }
}

/**
 * Create a new label size in database
 */
export async function createLabelSizeInDb(
  size: Omit<LabelSizeConfig, 'id'>
): Promise<LabelSizeConfig> {
  const trimmedName = size.name.trim()
  const res = await fetch('/api/label-sizes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: trimmedName,
      width_mm: size.widthMm,
      height_mm: size.heightMm,
      labels_per_row: size.labelsPerRow,
      horizontal_gap_mm: size.horizontalGapMm,
    }),
  })

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}))
    throw new Error(errJson.error || 'Failed to create label size')
  }

  const json = await res.json()
  const newConfig = mapDbToLabelConfig(json.data as DbLabelSize)
  saveStoredCustomSize(newConfig)
  return newConfig
}

/**
 * Delete a label size from database
 */
export async function deleteLabelSizeFromDb(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/label-sizes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })

    deleteStoredCustomSize(id)
    return res.ok
  } catch (err) {
    console.error('[deleteLabelSizeFromDb] Exception:', err)
    deleteStoredCustomSize(id)
    return false
  }
}

/**
 * Delete all custom label sizes from database
 */
export async function clearAllLabelSizesInDb(): Promise<boolean> {
  try {
    clearAllCustomSizes()
    return true
  } catch (err) {
    console.error('[clearAllLabelSizesInDb] Exception:', err)
    clearAllCustomSizes()
    return false
  }
}

export interface BarcodeQueueItem {
  id: string
  productId: number
  productName: string
  variantId?: string | null
  variantName?: string
  barcodeValue: string
  price: number
  costPrice?: number
  noOfLabels: number
  header: string
  line1: string
  line2: string
  line3: string
  line4: string
  selected: boolean
}

export interface BarcodeRenderOptions {
  width?: number
  height?: number
  displayValue?: boolean
  fontSize?: number
  font?: string
  textMargin?: number
  margin?: number
  lineColor?: string
  background?: string
}

/**
 * Render a CODE128 barcode directly into an SVG element.
 */
export function renderBarcodeSvg(
  svgElement: SVGSVGElement,
  value: string,
  options?: BarcodeRenderOptions
) {
  if (!svgElement || !value) return

  try {
    JsBarcode(svgElement, value.trim(), {
      format: 'CODE128',
      width: options?.width ?? 1.5,
      height: options?.height ?? 36,
      displayValue: options?.displayValue ?? true,
      fontSize: options?.fontSize ?? 11,
      font: options?.font ?? 'monospace',
      textMargin: options?.textMargin ?? 1,
      margin: options?.margin ?? 4,
      lineColor: options?.lineColor ?? '#000000',
      background: options?.background ?? '#ffffff',
    })
  } catch (err) {
    console.error('[renderBarcodeSvg] Failed to generate barcode:', err)
  }
}

/**
 * Generate a standalone SVG string for a CODE128 barcode.
 * Executes synchronously in the browser without requiring external CDN scripts.
 */
export function generateBarcodeSvgString(
  value: string,
  options?: BarcodeRenderOptions
): string {
  if (typeof document === 'undefined' || !value) return ''
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    renderBarcodeSvg(svg, value, options)
    return svg.outerHTML || new XMLSerializer().serializeToString(svg)
  } catch (err) {
    console.error('[generateBarcodeSvgString] Failed to generate barcode SVG string:', err)
    return ''
  }
}

/**
 * Format barcode for UI display.
 */
export function formatBarcodeDisplay(value?: string | null): string {
  if (!value) return '—'
  return String(value).trim()
}

/**
 * Validate barcode format (alphanumeric, 4 to 32 chars).
 */
export function isValidBarcodeValue(value: string): boolean {
  return /^[A-Z0-9_-]{4,32}$/i.test(value.trim())
}
