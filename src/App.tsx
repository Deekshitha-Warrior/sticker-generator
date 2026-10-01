import './index.css'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Printer,
  Settings,
  Plus,
  Trash2,
  Sparkles,
  Info,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  Search,
  RefreshCw,
  Tag,
  Copy,
  Check,
  Package,
} from 'lucide-react'
import {
  type BarcodeQueueItem,
  type BarcodeSettings,
  type LabelSizeConfig,
  getStoredBarcodeSettings,
  getAllLabelSizes,
  fetchLabelSizesFromDb,
  DEFAULT_FALLBACK_LABEL_SIZE,
  renderBarcodeSvg,
  generateBarcodeSvgString,
} from './lib/barcode'
import { BRAND_EN } from './lib/brand'
import { barcodeService, type BarcodeRegistryRecord } from './services/barcodeService'
import { fetchVariantsByProduct, type ProductVariant } from './services/variantService'
import { useProductStore, type Product } from './store/store'
import { BarcodeSettingsDrawer } from './components/barcode/BarcodeSettingsDrawer'
import { BarcodeSheetPreviewModal } from './components/barcode/BarcodeSheetPreviewModal'
import { BarcodePrintModal } from './components/barcode/BarcodePrintModal'
import { formatCurrency } from './lib/retail'

export default function App() {
  const { products, fetchProducts, loading: productsLoading } = useProductStore()

  // Navigation tab
  const [activeTab, setActiveTab] = useState<'generator' | 'registry'>('generator')

  // Barcode Settings
  const [settings, setSettings] = useState<BarcodeSettings>(getStoredBarcodeSettings())
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false)
  const [showSheetPreviewModal, setShowSheetPreviewModal] = useState(false)
  const [allSizes, setAllSizes] = useState<LabelSizeConfig[]>(() => getAllLabelSizes())

  // Print modal for registry items
  const [printModalData, setPrintModalData] = useState<{
    productName: string
    variantName?: string
    barcodeValue: string
    price: number
    mrp?: number | null
    defaultQuantity: number
  } | null>(null)

  // Intake Form State
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [productSearch, setProductSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null)
  const [itemCode, setItemCode] = useState('')
  const [noOfLabels, setNoOfLabels] = useState('1')
  const [header, setHeader] = useState(BRAND_EN)
  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [line3, setLine3] = useState('Discount: 0%')
  const [line4, setLine4] = useState('')
  const [updateStock, setUpdateStock] = useState(false)

  // Queue of items to generate
  const [queue, setQueue] = useState<BarcodeQueueItem[]>([])
  const [generating, setGenerating] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Registry / History State
  const [registryRecords, setRegistryRecords] = useState<BarcodeRegistryRecord[]>([])
  const [registryLoading, setRegistryLoading] = useState(false)
  const [registrySearch, setRegistrySearch] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Refs
  const previewSvgRef = useRef<SVGSVGElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load products and label sizes on mount
  useEffect(() => {
    document.title = `${BRAND_EN} - Barcode Studio`
    void fetchProducts(true)
    fetchLabelSizesFromDb().then((sizes) => {
      if (sizes && sizes.length > 0) setAllSizes(sizes)
    })
  }, [fetchProducts])

  // Reload sizes when drawer closes
  useEffect(() => {
    fetchLabelSizesFromDb().then((sizes) => {
      if (sizes && sizes.length > 0) setAllSizes(sizes)
    })
  }, [showSettingsDrawer])

  const currentSizeConfig: LabelSizeConfig =
    allSizes.find((s) => s.id === settings.selectedSizeId) || allSizes[0] || DEFAULT_FALLBACK_LABEL_SIZE

  // Load registry records when registry tab is opened
  const loadRegistry = useCallback(async () => {
    setRegistryLoading(true)
    try {
      const res = await barcodeService.fetchRegistry({ search: registrySearch, limit: 100 })
      setRegistryRecords(res.records)
    } catch (err) {
      console.error('Failed to load barcode registry:', err)
    } finally {
      setRegistryLoading(false)
    }
  }, [registrySearch])

  useEffect(() => {
    if (activeTab === 'registry') {
      void loadRegistry()
    }
  }, [activeTab, loadRegistry])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Select product handler
  const selectProductItem = useCallback(async (prod: Product, targetVariantId?: string | null) => {
    setSelectedProduct(prod)
    setProductSearch(prod.name)
    setDropdownOpen(false)

    const code = prod.barcode || `MTX${Math.floor(1000000 + Math.random() * 9000000)}`
    setItemCode(code)
    setLine1(prod.name)
    setLine2(prod.category || '')
    setLine3(settings.showDiscount ? 'Discount: 0%' : `Price: ₹${prod.price}`)

    if (prod.hasVariants) {
      try {
        const vars = await fetchVariantsByProduct(String(prod.id))
        setVariants(vars)
        if (vars.length > 0) {
          const chosen = targetVariantId ? vars.find((v) => v.id === targetVariantId) || vars[0] : vars[0]
          setSelectedVariant(chosen)
          if (chosen.barcode) setItemCode(chosen.barcode)
          setLine2(`Size: ${chosen.variantName}`)
          if (chosen.price) {
            setLine3(settings.showDiscount ? 'Discount: 0%' : `Price: ₹${chosen.price}`)
          }
        }
      } catch (err) {
        console.error('Failed to load variants:', err)
      }
    } else {
      setVariants([])
      setSelectedVariant(null)
    }
  }, [settings.showDiscount])

  // Update live preview SVG
  useEffect(() => {
    const codeToRender = (itemCode && itemCode.trim()) || 'MTX0000000'
    const previewScale = Math.min(230 / currentSizeConfig.widthMm, 150 / currentSizeConfig.heightMm)
    const previewWidth = Math.round(currentSizeConfig.widthMm * previewScale)
    const previewHeight = Math.round(currentSizeConfig.heightMm * previewScale)
    const previewBarcodeHeight = Math.max(26, Math.round(previewHeight * 0.46))
    const codeLength = codeToRender.length
    const previewBarcodeWidth = Math.max(
      0.82,
      Math.min(1.85, Math.round(((previewWidth * 0.84) / ((codeLength + 2) * 11 + 2)) * 100) / 100)
    )

    if (previewSvgRef.current) {
      renderBarcodeSvg(previewSvgRef.current, codeToRender, {
        width: previewBarcodeWidth,
        height: previewBarcodeHeight,
        fontSize: Math.max(7, Math.round(previewHeight * 0.08)),
        displayValue: false,
        margin: 0,
      })
    }
  }, [itemCode, header, line1, line2, line3, line4, currentSizeConfig])

  // Assigned barcode detection
  const assignedBarcode = selectedVariant
    ? selectedVariant.barcode && selectedVariant.barcode.trim().length > 0
      ? selectedVariant.barcode.trim()
      : null
    : selectedProduct?.hasVariants
    ? null
    : selectedProduct?.barcode && selectedProduct.barcode.trim().length > 0
    ? selectedProduct.barcode.trim()
    : null

  const isBarcodeAlreadyAssigned = Boolean(assignedBarcode)

  const handleSelectVariant = (varId: string) => {
    const v = variants.find((item) => item.id === varId)
    if (!v) return
    setSelectedVariant(v)
    if (v.barcode) setItemCode(v.barcode)
    setLine2(`Size: ${v.variantName}`)
    if (v.price) {
      setLine3(settings.showDiscount ? 'Discount: 0%' : `Price: ₹${v.price}`)
    }
  }

  const handleAssignCode = () => {
    const generated = 'MTX' + Math.floor(1000000 + Math.random() * 9000000)
    setItemCode(generated)
  }

  const handleAddToQueue = () => {
    if (!selectedProduct) {
      setStatusMessage({ type: 'error', text: 'Please select an item first' })
      return
    }

    if (isBarcodeAlreadyAssigned) {
      setStatusMessage({
        type: 'error',
        text: `Barcode already exists for this item (${assignedBarcode}).`,
      })
      return
    }

    if (!itemCode.trim()) {
      setStatusMessage({ type: 'error', text: 'Item Code / Barcode is required' })
      return
    }

    const parsedLabels = parseInt(noOfLabels.trim(), 10)
    const finalLabels = !isNaN(parsedLabels) && parsedLabels > 0 ? parsedLabels : 1

    const alreadyInQueue = queue.some(
      (it) => it.productId === Number(selectedProduct.id) && (selectedVariant ? it.variantId === selectedVariant.id : !it.variantId)
    )
    if (alreadyInQueue) {
      setStatusMessage({
        type: 'error',
        text: `This item (${selectedProduct.name}${selectedVariant ? ` - ${selectedVariant.variantName}` : ''}) is already in the queue.`,
      })
      return
    }

    const newItem: BarcodeQueueItem = {
      id: `queue_${Date.now()}_${Math.random()}`,
      productId: Number(selectedProduct.id),
      productName: selectedProduct.name,
      variantId: selectedVariant?.id || null,
      variantName: selectedVariant?.variantName || undefined,
      barcodeValue: itemCode.trim(),
      price: selectedVariant?.price || selectedProduct.price,
      costPrice: selectedProduct.costPrice || 0,
      noOfLabels: finalLabels,
      header: header.trim(),
      line1: line1.trim(),
      line2: line2.trim(),
      line3: line3.trim(),
      line4: line4.trim(),
      selected: true,
    }

    setQueue((prev) => [...prev, newItem])
    setStatusMessage(null)
    setNoOfLabels('1')
  }

  const handleRemoveQueueItem = (id: string) => {
    setQueue((prev) => prev.filter((it) => it.id !== id))
  }

  const handleUpdateQueueItem = (id: string, field: keyof BarcodeQueueItem, value: any) => {
    setQueue((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)))
  }

  const handleToggleSelectAll = (checked: boolean) => {
    setQueue((prev) => prev.map((it) => ({ ...it, selected: checked })))
  }

  const totalLabelsNeeded = queue
    .filter((it) => it.selected)
    .reduce((sum, it) => sum + (it.noOfLabels || 0), 0)

  // Generate barcodes & receive stock
  const handleGenerateAndCommitStock = async () => {
    const selectedItems = queue.filter((it) => it.selected)
    if (selectedItems.length === 0) {
      setStatusMessage({ type: 'error', text: 'Please add and select at least one item to generate barcodes' })
      return
    }

    setGenerating(true)
    setStatusMessage(null)

    try {
      for (const item of selectedItems) {
        await barcodeService.receiveStockWithBarcode({
          product_id: item.productId,
          variant_id: item.variantId || null,
          quantity_received: updateStock ? item.noOfLabels : 0,
          unit_cost: item.costPrice || null,
          custom_barcode: item.barcodeValue,
          note: updateStock ? `Received via Barcode Studio (${item.noOfLabels} labels)` : 'Barcode generated',
          created_by_name: 'Admin',
        })
      }

      await fetchProducts(true)
      setStatusMessage({
        type: 'success',
        text: `Successfully generated barcodes for ${selectedItems.length} items (${totalLabelsNeeded} labels)${updateStock ? ' and updated inventory' : ''}!`,
      })

      setShowSheetPreviewModal(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate barcodes'
      setStatusMessage({ type: 'error', text: msg })
    } finally {
      setGenerating(false)
    }
  }

  // Filter products for dropdown
  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.barcode && p.barcode.toLowerCase().includes(productSearch.toLowerCase()))
  )

  // Direct print queue
  const printQueueDirectly = () => {
    const selectedItems = queue.filter((it) => it.selected)
    if (selectedItems.length === 0) return

    try {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
      iframe.setAttribute('aria-hidden', 'true')
      iframe.setAttribute('tabindex', '-1')
      document.body.appendChild(iframe)

      const doc = iframe.contentWindow?.document
      if (!doc) {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
        return
      }

      const isThermal = settings.printerType === 'label'
      const isSmall = currentSizeConfig.heightMm <= 25
      const isLarge = currentSizeConfig.heightMm >= 40

      const barcodeHeightPx = Math.max(16, Math.round(currentSizeConfig.heightMm * 0.32 * 3.7795))
      const printableWidthPx = Math.max(30, (currentSizeConfig.widthMm - 4) * 3.7795)
      const barcodeBarWidth = Math.max(0.8, Math.min(1.7, Math.round((printableWidthPx / 120) * 100) / 100))
      const barcodeFontSize = Math.max(6, Math.min(9.5, Math.round(currentSizeConfig.heightMm * 0.2 * 10) / 10))

      const headerFontSize = isSmall ? '7pt' : isLarge ? '10.5pt' : '8.5pt'
      const titleFontSize = isSmall ? '6pt' : isLarge ? '9pt' : '7.5pt'
      const tagFontSize = isSmall ? '5.5pt' : isLarge ? '8.5pt' : '7pt'
      const priceFontSize = isSmall ? '8pt' : isLarge ? '12pt' : '9.5pt'
      const stickerPadding = isSmall ? '0.6mm 1.2mm' : '1.0mm 1.6mm'

      const allStickers: string[] = []
      selectedItems.forEach((item) => {
        const count = Math.max(1, item.noOfLabels)
        const fullTitle = `${item.productName}${item.variantName ? ` (${item.variantName})` : ''}`
        const svgMarkup = generateBarcodeSvgString(item.barcodeValue, {
          width: barcodeBarWidth,
          height: barcodeHeightPx,
          fontSize: barcodeFontSize,
          font: 'Arial, sans-serif',
          margin: 0,
          textMargin: 1.5,
          displayValue: true,
        })
        for (let i = 0; i < count; i++) {
          allStickers.push(`
            <div class="label-sticker">
              ${settings.showCompanyName ? `<div class="header">${item.header || BRAND_EN}</div>` : ''}
              ${settings.showItemName ? `<div class="prod-title">${fullTitle}</div>` : ''}
              <div class="barcode-box">${svgMarkup}</div>
              <div class="footer">
                <span><span class="tag">${item.line2 || 'MADHURA TEX'}</span></span>
                ${settings.showSalePrice ? `<span class="price">₹${item.price}</span>` : ''}
              </div>
            </div>
          `)
        }
      })

      const columns = isThermal ? Math.max(1, currentSizeConfig.labelsPerRow || 1) : 1
      const gapMm = currentSizeConfig.horizontalGapMm || 0
      let bodyContent = ''

      if (isThermal) {
        const rows: string[] = []
        for (let i = 0; i < allStickers.length; i += columns) {
          const rowStickers = allStickers.slice(i, i + columns)
          rows.push(`<div class="sticker-row">${rowStickers.join('')}</div>`)
        }
        bodyContent = rows.join('')
      } else {
        bodyContent = `<div class="a4-container">${allStickers.join('')}</div>`
      }

      doc.open()
      doc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>${BRAND_EN} Barcode Labels</title>
            <style>
              @page {
                ${
                  isThermal
                    ? `size: ${(currentSizeConfig.widthMm * columns + gapMm * (columns - 1)).toFixed(2)}mm ${currentSizeConfig.heightMm}mm; margin: 0mm !important;`
                    : `size: A4 portrait; margin: 10mm !important;`
                }
              }
              * { box-sizing: border-box; margin: 0; padding: 0; }
              html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; font-family: -apple-system, sans-serif; }
              .a4-container { display: flex; flex-wrap: wrap; gap: 3mm 4mm; }
              .sticker-row { display: flex; flex-direction: row; gap: ${gapMm}mm; width: ${(currentSizeConfig.widthMm * columns + gapMm * (columns - 1)).toFixed(2)}mm; page-break-inside: avoid; }
              .sticker-row + .sticker-row { ${isThermal ? 'page-break-before: always;' : ''} }
              .label-sticker {
                width: ${currentSizeConfig.widthMm}mm !important;
                height: ${currentSizeConfig.heightMm}mm !important;
                padding: ${stickerPadding};
                display: flex; flex-direction: column; justify-content: space-between; align-items: center; text-align: center;
                overflow: hidden; flex-shrink: 0; background: #fff;
                ${!isThermal ? 'border: 0.2mm dashed #bbb;' : ''}
              }
              .header { font-size: ${headerFontSize}; font-weight: 900; text-transform: uppercase; color: #000; }
              .prod-title { font-size: ${titleFontSize}; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 98%; color: #111; }
              .barcode-box { width: 100%; flex: 1; display: flex; justify-content: center; align-items: center; margin: 0.4mm 0; overflow: hidden; }
              .barcode-box svg { max-width: 98%; max-height: 100%; width: auto; height: auto; }
              .footer { width: 100%; display: flex; justify-content: space-between; align-items: center; border-top: 0.6pt solid #000; padding-top: 0.5mm; }
              .tag { font-size: ${tagFontSize}; font-weight: 700; color: #444; }
              .price { font-size: ${priceFontSize}; font-weight: 900; color: #000; }
            </style>
          </head>
          <body>${bodyContent}</body>
        </html>
      `)
      doc.close()

      const cleanup = () => {
        try {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
        } catch {}
      }

      setTimeout(() => {
        try {
          if (iframe.contentWindow) {
            iframe.contentWindow.focus()
            iframe.contentWindow.print()
          }
        } catch (err) {
          console.warn('[Print] error:', err)
        } finally {
          setTimeout(cleanup, 2500)
        }
      }, 200)
    } catch (err) {
      console.warn('[Print] failed:', err)
    }
  }

  // Copy barcode helper
  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-gray-900 flex flex-col font-sans">
      {/* TOP HEADER */}
      <header className="sticky top-0 z-40 bg-[#0B2559] border-b border-[#0B2559]/80 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D4AF37] flex items-center justify-center font-black text-[#0B2559] shadow-inner text-base">
              MT
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black tracking-wide text-white leading-none">
                  {BRAND_EN}
                </h1>
                <span className="text-[10px] uppercase font-black tracking-wider bg-[#D4AF37] text-[#0B2559] px-2 py-0.5 rounded-full">
                  Barcode Studio
                </span>
              </div>
              <p className="text-[11px] text-gray-300 font-medium">
                Barcode Generator &amp; Thermal Roll Print Manager
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="hidden md:flex items-center bg-[#123E94]/60 p-1 rounded-xl border border-white/10 text-xs font-bold">
            <button
              onClick={() => setActiveTab('generator')}
              className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'generator'
                  ? 'bg-white text-[#0B2559] shadow-sm font-black'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              <Sparkles size={14} /> Generator
            </button>
            <button
              onClick={() => setActiveTab('registry')}
              className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'registry'
                  ? 'bg-white text-[#0B2559] shadow-sm font-black'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              <Tag size={14} /> Barcode Registry
            </button>
          </div>

          {/* Actions: Printer Info, Settings, Add Barcode CTA */}
          <div className="flex items-center gap-2.5">
            <div className="hidden lg:flex flex-col text-right text-[11px] font-bold text-gray-300 pr-2 border-r border-white/15">
              <span>
                {settings.printerType === 'label' ? 'Thermal Roll' : 'Sheet'}:{' '}
                <strong className="text-[#D4AF37]">{currentSizeConfig.name}</strong>
              </span>
            </div>

            {/* Add Barcode CTA Button */}
            <button
              type="button"
              onClick={() => {
                setActiveTab('generator')
                setSelectedProduct(null)
                setSelectedVariant(null)
                setItemCode(`MTX${Math.floor(1000000 + Math.random() * 9000000)}`)
                setProductSearch('')
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className="px-3.5 py-2 rounded-xl bg-[#D4AF37] text-[#0B2559] text-xs font-black hover:bg-[#E5BE48] transition-all shadow-md flex items-center gap-1.5 cursor-pointer shrink-0"
              title="Add a new barcode item"
            >
              <Plus size={15} /> Add Barcode
            </button>

            {/* Settings Gear */}
            <button
              type="button"
              onClick={() => setShowSettingsDrawer(true)}
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Barcode & Printer Settings"
            >
              <Settings size={17} />
            </button>
          </div>
        </div>

        {/* Mobile Tab Bar */}
        <div className="flex md:hidden border-t border-white/10 bg-[#0B2559]/90 px-4 py-1.5 text-xs font-bold gap-2">
          <button
            onClick={() => setActiveTab('generator')}
            className={`flex-1 py-1.5 rounded-lg text-center ${
              activeTab === 'generator' ? 'bg-white text-[#0B2559] font-black' : 'text-gray-300'
            }`}
          >
            Generator
          </button>
          <button
            onClick={() => setActiveTab('registry')}
            className={`flex-1 py-1.5 rounded-lg text-center ${
              activeTab === 'registry' ? 'bg-white text-[#0B2559] font-black' : 'text-gray-300'
            }`}
          >
            Barcode Registry
          </button>
        </div>
      </header>

      {/* STATUS BANNER */}
      {statusMessage && (
        <div
          className={`px-4 sm:px-6 py-2.5 flex items-center justify-between text-xs font-bold shadow-xs ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-b border-emerald-200'
              : 'bg-red-50 text-red-900 border-b border-red-200'
          }`}
        >
          <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
            <div className="flex items-center gap-2">
              {statusMessage.type === 'success' ? (
                <CheckCircle size={16} className="text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle size={16} className="text-red-600 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-gray-500 hover:text-black font-black cursor-pointer px-2"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* TAB 1: BARCODE GENERATOR */}
        {activeTab === 'generator' && (
          <div className="space-y-6 animate-in fade-in duration-150">
            {/* INTAKE FORM & PREVIEW CARD */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 shadow-sm">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
                {/* LEFT: FORM INPUTS */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <span className="text-xs font-black uppercase tracking-wider text-gray-800 flex items-center gap-1.5">
                      <Sparkles size={14} className="text-[#0B2559]" /> Enter Item Details for Barcode
                    </span>
                    {selectedProduct && (
                      <span className="text-xs font-bold text-gray-500">
                        Selected: <strong className="text-gray-900">{selectedProduct.name}</strong>
                      </span>
                    )}
                  </div>

                  {/* Warning if already assigned */}
                  {isBarcodeAlreadyAssigned && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-900 font-bold">
                      <AlertCircle size={17} className="text-red-600 shrink-0 mt-0.5" />
                      <div>
                        <span>Barcode already exists for this item: </span>
                        <span className="font-mono bg-white px-2 py-0.5 rounded border border-red-300 font-black">
                          {assignedBarcode}
                        </span>
                        <p className="text-[11px] text-red-700 font-medium mt-1">
                          You can view and reprint this barcode from the Barcode Registry tab.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Row 1: Item Search Dropdown & Item Code */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Item Name Dropdown */}
                    <div className="relative" ref={dropdownRef}>
                      <label className="block text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1">
                        Item Name <span className="text-red-500">*</span>
                      </label>
                      <div
                        onClick={() => setDropdownOpen(true)}
                        className="w-full h-11 px-3 rounded-xl border border-gray-300 bg-white flex items-center justify-between cursor-pointer focus-within:border-[#0B2559]"
                      >
                        <input
                          type="text"
                          placeholder={productsLoading ? 'Loading products...' : 'Select / Search Product'}
                          value={productSearch}
                          onChange={(e) => {
                            setProductSearch(e.target.value)
                            setDropdownOpen(true)
                          }}
                          className="w-full text-xs font-bold text-gray-900 bg-transparent outline-none"
                        />
                        <ChevronDown size={14} className="text-gray-400 shrink-0" />
                      </div>

                      {dropdownOpen && (
                        <div className="absolute left-0 top-full mt-1 w-full sm:w-[420px] bg-white rounded-2xl border border-gray-300 shadow-2xl z-50 overflow-hidden animate-in fade-in duration-100 max-h-64 overflow-y-auto divide-y divide-gray-100">
                          {filteredProducts.length === 0 ? (
                            <div className="p-4 text-xs text-gray-400 text-center font-bold">
                              No matching products found in catalog.
                            </div>
                          ) : (
                            filteredProducts.map((p) => {
                              const hasBarcode = Boolean(p.barcode && p.barcode.trim().length > 0)
                              return (
                                <div
                                  key={p.id}
                                  onClick={() => selectProductItem(p)}
                                  className="p-3 hover:bg-[#FBFAF6] cursor-pointer flex items-center justify-between text-xs transition-colors"
                                >
                                  <div className="min-w-0 pr-2">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <p className="font-bold text-gray-900 truncate">{p.name}</p>
                                      {p.hasVariants ? (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-purple-100 text-purple-800">
                                          Variants
                                        </span>
                                      ) : hasBarcode ? (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-amber-100 text-amber-900">
                                          Barcode: {p.barcode}
                                        </span>
                                      ) : (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-emerald-100 text-emerald-800">
                                          Ready for Barcode
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                                      {p.category || 'General'}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <span className="font-black text-gray-900">₹{p.price}</span>
                                    <span className="block text-[10px] text-gray-500 font-semibold">
                                      Stock: {p.stockQuantity ?? 0}
                                    </span>
                                  </div>
                                </div>
                              )
                            })
                          )}
                        </div>
                      )}
                    </div>

                    {/* Item Code (Barcode) */}
                    <div>
                      <label className="block text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1">
                        Item Code / Barcode <span className="text-red-500">*</span>
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          required
                          placeholder="e.g. MTX1234567"
                          value={itemCode}
                          onChange={(e) => setItemCode(e.target.value)}
                          className="w-full h-11 px-3 rounded-xl border border-gray-300 bg-white text-xs font-mono font-bold text-gray-900 outline-none focus:border-[#0B2559]"
                        />
                        <button
                          type="button"
                          onClick={handleAssignCode}
                          className="shrink-0 px-3 h-11 rounded-xl bg-gray-100 border border-gray-300 text-[11px] font-black text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer"
                        >
                          Auto Code
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Variant Selection if product has variants */}
                  {variants.length > 0 && (
                    <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-black uppercase tracking-wider text-amber-900">
                          Select Variant / Size ({variants.length} available)
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedProduct) return
                            const unassigned = variants.filter((v) => !v.barcode || !v.barcode.trim())
                            if (unassigned.length === 0) {
                              setStatusMessage({
                                type: 'error',
                                text: 'All variants for this item already have barcodes assigned.',
                              })
                              return
                            }

                            const itemsToAdd: BarcodeQueueItem[] = unassigned.map((v) => ({
                              id: `queue_${Date.now()}_${v.id}_${Math.random()}`,
                              productId: Number(selectedProduct.id),
                              productName: selectedProduct.name,
                              variantId: v.id,
                              variantName: v.variantName,
                              barcodeValue: `MTX${Math.floor(1000000 + Math.random() * 9000000)}`,
                              price: v.price || selectedProduct.price,
                              costPrice: selectedProduct.costPrice || 0,
                              noOfLabels: parseInt(noOfLabels, 10) || 1,
                              header: header || BRAND_EN,
                              line1: selectedProduct.name,
                              line2: `Size: ${v.variantName}`,
                              line3: settings.showDiscount ? 'Discount: 0%' : `Price: ₹${v.price || selectedProduct.price}`,
                              line4: line4.trim(),
                              selected: true,
                            }))

                            setQueue((prev) => [...prev, ...itemsToAdd])
                            setStatusMessage({
                              type: 'success',
                              text: `Added ${unassigned.length} variants to the queue!`,
                            })
                          }}
                          className="px-2.5 py-1 rounded-md bg-[#0B2559] text-[#D4AF37] border border-[#D4AF37] text-[10px] font-black uppercase tracking-wider hover:bg-[#123E94] transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <Plus size={11} /> Add All Variants ({variants.filter((v) => !v.barcode?.trim()).length})
                        </button>
                      </div>
                      <select
                        value={selectedVariant?.id || ''}
                        onChange={(e) => handleSelectVariant(e.target.value)}
                        className="w-full h-10 px-3 rounded-lg border border-amber-300 bg-white text-xs font-bold text-gray-900 outline-none"
                      >
                        {variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.variantName} {v.barcode ? `— [Barcode: ${v.barcode}]` : '— [No Barcode]'} — ₹{v.price} — Stock: {v.stock}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Row 2: No of Labels, Header, Line 1 */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1">
                        No of Labels <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="1"
                        value={noOfLabels}
                        onChange={(e) => setNoOfLabels(e.target.value.replace(/[^0-9]/g, ''))}
                        className="w-full h-10 px-3 rounded-xl border border-gray-300 bg-white text-xs font-black text-gray-900 outline-none focus:border-[#0B2559]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1">
                        Header
                      </label>
                      <input
                        type="text"
                        value={header}
                        onChange={(e) => setHeader(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0B2559]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1">
                        Line 1 (Product Name)
                      </label>
                      <input
                        type="text"
                        value={line1}
                        onChange={(e) => setLine1(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0B2559]"
                      />
                    </div>
                  </div>

                  {/* Row 3: Line 2, Line 3, Line 4 */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1">
                        Line 2 (Size / Category)
                      </label>
                      <input
                        type="text"
                        value={line2}
                        onChange={(e) => setLine2(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0B2559]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1">
                        Line 3 (Price / Discount)
                      </label>
                      <input
                        type="text"
                        value={line3}
                        onChange={(e) => setLine3(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0B2559]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1">
                        Line 4 (Notes / Info)
                      </label>
                      <input
                        type="text"
                        value={line4}
                        onChange={(e) => setLine4(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0B2559]"
                      />
                    </div>
                  </div>
                </div>

                {/* RIGHT: LIVE PREVIEW & ADD BUTTON */}
                <div className="flex flex-col items-center w-full">
                  <div className="w-full flex items-center justify-between mb-2 px-0.5">
                    <span className="text-xs font-black uppercase tracking-wider text-gray-800">
                      Live Preview
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-[#0B2559] text-[#D4AF37] tracking-wide shrink-0">
                      {currentSizeConfig.widthMm} × {currentSizeConfig.heightMm} mm
                    </span>
                  </div>

                  <div className="w-full rounded-2xl bg-[#F4F5F7] border border-gray-300 p-4 shadow-inner flex flex-col items-center justify-center relative min-h-[220px]">
                    {(() => {
                      const previewScale = Math.min(230 / currentSizeConfig.widthMm, 150 / currentSizeConfig.heightMm)
                      const previewWidthPx = Math.max(140, Math.round(currentSizeConfig.widthMm * previewScale))
                      const previewHeightPx = Math.max(90, Math.round(currentSizeConfig.heightMm * previewScale))
                      const previewBarcodeHeightPx = Math.max(26, Math.round(previewHeightPx * 0.46))

                      return (
                        <div
                          className="bg-white border border-gray-300 rounded-xl p-2.5 shadow-sm flex flex-col justify-between items-center text-center relative transition-all"
                          style={{
                            width: `${previewWidthPx}px`,
                            height: `${previewHeightPx}px`,
                            boxSizing: 'border-box',
                          }}
                        >
                          {settings.showCompanyName && (
                            <span
                              className="font-black uppercase tracking-wider text-gray-900 leading-none truncate max-w-[85%]"
                              style={{ fontSize: `${Math.max(8, Math.round(previewHeightPx * 0.085))}px` }}
                            >
                              {header || BRAND_EN}
                            </span>
                          )}

                          <div
                            className="w-full flex items-center justify-center overflow-hidden my-0.5"
                            style={{ height: `${previewBarcodeHeightPx}px` }}
                          >
                            <svg ref={previewSvgRef} className="max-w-[98%] max-h-full h-auto" />
                          </div>

                          <span
                            className="font-mono font-bold text-gray-800 tracking-wider leading-none"
                            style={{ fontSize: `${Math.max(7.5, Math.round(previewHeightPx * 0.075))}px` }}
                          >
                            {itemCode || 'MTX0000000'}
                          </span>

                          {settings.showItemName && (
                            <span
                              className="font-bold text-gray-800 truncate max-w-full leading-tight"
                              style={{ fontSize: `${Math.max(7.5, Math.round(previewHeightPx * 0.075))}px` }}
                            >
                              {line1 || selectedProduct?.name || 'Item Name'}
                            </span>
                          )}

                          {line2 && (
                            <span
                              className="font-semibold text-gray-600 truncate max-w-full leading-tight"
                              style={{ fontSize: `${Math.max(7, Math.round(previewHeightPx * 0.07))}px` }}
                            >
                              {line2}
                            </span>
                          )}

                          {settings.showSalePrice && (
                            <span
                              className="font-black text-black truncate max-w-full leading-none"
                              style={{ fontSize: `${Math.max(8.5, Math.round(previewHeightPx * 0.095))}px` }}
                            >
                              {line3 || (settings.showDiscount ? 'Discount: 0%' : 'Price: ₹0')}
                            </span>
                          )}
                        </div>
                      )
                    })()}

                    <div className="mt-2 text-[10px] font-bold text-gray-500 text-center">
                      {settings.printerType === 'label'
                        ? `Thermal Roll (${currentSizeConfig.labelsPerRow || 1}-up)`
                        : 'Sheet Layout (A4)'}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddToQueue}
                    className={`w-full mt-3 py-3 rounded-xl border text-xs font-black uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer ${
                      isBarcodeAlreadyAssigned
                        ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                        : 'bg-[#0B2559] border-[#D4AF37] text-[#D4AF37] hover:bg-[#123E94]'
                    }`}
                  >
                    <Plus size={14} /> {isBarcodeAlreadyAssigned ? 'Barcode Already Exists' : 'Add for Barcode'}
                  </button>
                </div>
              </div>
            </div>

            {/* QUEUE TABLE (`Item Details`) */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm flex flex-col">
              <div className="p-4 border-b border-gray-200 bg-[#FAFAFA] flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-wider text-gray-800">
                  Barcode Queue ({queue.length} items)
                </h3>
                {queue.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setQueue([])}
                    className="text-xs font-bold text-red-600 hover:text-red-800 cursor-pointer"
                  >
                    Clear Queue
                  </button>
                )}
              </div>

              {queue.length === 0 ? (
                <div className="p-12 text-center flex flex-col items-center justify-center text-gray-400">
                  <div className="w-14 h-14 rounded-2xl bg-gray-100 border border-gray-200 flex items-center justify-center mb-3">
                    <Sparkles size={24} className="text-gray-400" />
                  </div>
                  <p className="text-xs font-bold text-gray-600">
                    Added items for Barcode generation will appear here.
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Select an item above, set label count, and click "Add for Barcode".
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FBFAF6] border-b border-gray-200 text-[10px] font-black uppercase tracking-wider text-gray-600">
                      <tr>
                        <th className="p-3 w-10 text-center">
                          <input
                            type="checkbox"
                            checked={queue.every((it) => it.selected)}
                            onChange={(e) => handleToggleSelectAll(e.target.checked)}
                            className="accent-[#0B2559] w-4 h-4 rounded cursor-pointer"
                          />
                        </th>
                        <th className="p-3">Item Name</th>
                        <th className="p-3 w-28">Labels</th>
                        <th className="p-3">Header</th>
                        <th className="p-3">Line 1</th>
                        <th className="p-3">Line 2</th>
                        <th className="p-3">Line 3</th>
                        <th className="p-3">Line 4</th>
                        <th className="p-3 w-12 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {queue.map((item) => (
                        <tr key={item.id} className="hover:bg-[#FBFAF6] transition-colors">
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              checked={item.selected}
                              onChange={(e) => handleUpdateQueueItem(item.id, 'selected', e.target.checked)}
                              className="accent-[#0B2559] w-4 h-4 rounded cursor-pointer"
                            />
                          </td>
                          <td className="p-3 font-bold text-gray-900">
                            <div>{item.productName}</div>
                            <div className="text-[10px] font-mono text-gray-400">
                              {item.barcodeValue} {item.variantName ? `(${item.variantName})` : ''}
                            </div>
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={item.noOfLabels === 0 ? '' : item.noOfLabels}
                              onChange={(e) => {
                                const clean = e.target.value.replace(/[^0-9]/g, '')
                                handleUpdateQueueItem(
                                  item.id,
                                  'noOfLabels',
                                  clean === '' ? 0 : parseInt(clean, 10) || 0
                                )
                              }}
                              className="w-20 h-8 px-2 rounded-lg border border-gray-300 font-black text-center text-xs outline-none focus:border-[#0B2559]"
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              value={item.header}
                              onChange={(e) => handleUpdateQueueItem(item.id, 'header', e.target.value)}
                              className="w-28 h-8 px-2 rounded-lg border border-gray-300 text-xs font-bold outline-none focus:border-[#0B2559]"
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              value={item.line1}
                              onChange={(e) => handleUpdateQueueItem(item.id, 'line1', e.target.value)}
                              className="w-28 h-8 px-2 rounded-lg border border-gray-300 text-xs outline-none focus:border-[#0B2559]"
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              value={item.line2}
                              onChange={(e) => handleUpdateQueueItem(item.id, 'line2', e.target.value)}
                              className="w-28 h-8 px-2 rounded-lg border border-gray-300 text-xs outline-none focus:border-[#0B2559]"
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              value={item.line3}
                              onChange={(e) => handleUpdateQueueItem(item.id, 'line3', e.target.value)}
                              className="w-28 h-8 px-2 rounded-lg border border-gray-300 text-xs outline-none focus:border-[#0B2559]"
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              value={item.line4}
                              onChange={(e) => handleUpdateQueueItem(item.id, 'line4', e.target.value)}
                              className="w-28 h-8 px-2 rounded-lg border border-gray-300 text-xs outline-none focus:border-[#0B2559]"
                            />
                          </td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveQueueItem(item.id)}
                              className="w-7 h-7 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors cursor-pointer mx-auto"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Status and Action Footer */}
              {queue.length > 0 && (
                <div className="p-4 bg-[#FBFAF6] border-t border-gray-200 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-blue-900">
                    <Info size={16} className="text-blue-600" />
                    <span>Total {totalLabelsNeeded} labels to generate and print.</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-700">
                      <input
                        type="checkbox"
                        checked={updateStock}
                        onChange={(e) => setUpdateStock(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-[#0B2559] cursor-pointer"
                      />
                      <span>Update Inventory Stock</span>
                    </label>

                    <button
                      type="button"
                      onClick={() => setShowSheetPreviewModal(true)}
                      className="px-4 py-2 rounded-xl border border-[#0B2559] bg-white text-[#0B2559] text-xs font-black uppercase hover:bg-gray-50 transition-all cursor-pointer"
                    >
                      Preview Sheet
                    </button>

                    <button
                      type="button"
                      onClick={handleGenerateAndCommitStock}
                      disabled={generating || queue.filter((it) => it.selected).length === 0}
                      className="px-5 py-2.5 rounded-xl bg-[#0B2559] border border-[#D4AF37] text-[#D4AF37] text-xs font-black uppercase tracking-wider hover:bg-[#123E94] transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {generating ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
                          <span>Generating...</span>
                        </>
                      ) : (
                        <>
                          <Printer size={15} />
                          <span>Generate &amp; Print ({totalLabelsNeeded})</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: BARCODE REGISTRY / HISTORY */}
        {activeTab === 'registry' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-gray-900">
                  Barcode Registry
                </h2>
                <p className="text-xs text-gray-500 font-medium">
                  Canonical directory of active barcodes assigned to products &amp; variants
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative w-64">
                  <Search size={14} className="absolute left-3 top-3 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search barcode or item..."
                    value={registrySearch}
                    onChange={(e) => setRegistrySearch(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 rounded-xl border border-gray-300 text-xs font-bold outline-none focus:border-[#0B2559]"
                  />
                </div>
                <button
                  type="button"
                  onClick={loadRegistry}
                  className="h-9 px-3 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw size={13} className={registryLoading ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
            </div>

            {/* Registry Table */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              {registryLoading ? (
                <div className="p-12 text-center text-xs font-bold text-gray-400 flex flex-col items-center justify-center">
                  <span className="w-6 h-6 border-2 border-gray-300 border-t-[#0B2559] rounded-full animate-spin mb-2" />
                  Loading barcode registry...
                </div>
              ) : registryRecords.length === 0 ? (
                <div className="p-12 text-center text-xs font-bold text-gray-400">
                  No registered barcodes found. Generate new barcodes using the Generator tab!
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FBFAF6] border-b border-gray-200 text-[10px] font-black uppercase tracking-wider text-gray-600">
                      <tr>
                        <th className="p-3">Barcode</th>
                        <th className="p-3">Item / Variant Name</th>
                        <th className="p-3">Category</th>
                        <th className="p-3">Price</th>
                        <th className="p-3">Created</th>
                        <th className="p-3">Created By</th>
                        <th className="p-3 text-center">Print</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {registryRecords.map((r) => {
                        const prodName = r.product?.name || `Product #${r.product_id}`
                        const varName = r.variant?.variant_name
                        const price = r.variant?.price ?? r.product?.price ?? 0
                        const mrp = r.product?.offer_price
                        return (
                          <tr key={r.id} className="hover:bg-[#FBFAF6] transition-colors">
                            <td className="p-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-black text-gray-900 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                                  {r.barcode_value}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(r.barcode_value, r.id)}
                                  className="text-gray-400 hover:text-black cursor-pointer"
                                  title="Copy Barcode"
                                >
                                  {copiedId === r.id ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                                </button>
                              </div>
                            </td>
                            <td className="p-3 font-bold text-gray-900">
                              <div>{prodName}</div>
                              {varName && (
                                <div className="text-[10px] text-purple-700 font-semibold">
                                  Size: {varName}
                                </div>
                              )}
                            </td>
                            <td className="p-3 text-gray-600">{r.product?.category || 'General'}</td>
                            <td className="p-3 font-black text-gray-900">₹{price}</td>
                            <td className="p-3 text-gray-500 text-[11px]">
                              {new Date(r.created_at).toLocaleDateString()}
                            </td>
                            <td className="p-3 text-gray-600">{r.created_by_name || 'Admin'}</td>
                            <td className="p-3 text-center">
                              <button
                                type="button"
                                onClick={() =>
                                  setPrintModalData({
                                    productName: prodName,
                                    variantName: varName,
                                    barcodeValue: r.barcode_value,
                                    price,
                                    mrp,
                                    defaultQuantity: 1,
                                  })
                                }
                                className="px-2.5 py-1.5 rounded-lg bg-[#0B2559] text-[#D4AF37] border border-[#D4AF37] text-[11px] font-black hover:bg-[#123E94] transition-all cursor-pointer inline-flex items-center gap-1"
                              >
                                <Printer size={12} /> Print
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* MODALS & DRAWERS */}
      {/* Settings Drawer */}
      {showSettingsDrawer && (
        <BarcodeSettingsDrawer
          isOpen={showSettingsDrawer}
          onClose={() => setShowSettingsDrawer(false)}
          settings={settings}
          onUpdateSettings={(newSettings) => setSettings(newSettings)}
        />
      )}

      {/* Sheet Preview Modal */}
      {showSheetPreviewModal && (
        <BarcodeSheetPreviewModal
          isOpen={showSheetPreviewModal}
          onClose={() => setShowSheetPreviewModal(false)}
          items={queue}
          sizeConfig={currentSizeConfig}
          onPrint={printQueueDirectly}
        />
      )}

      {/* Print Single Barcode Modal from Registry */}
      {printModalData && (
        <BarcodePrintModal
          isOpen={!!printModalData}
          onClose={() => setPrintModalData(null)}
          productName={printModalData.productName}
          variantName={printModalData.variantName}
          barcodeValue={printModalData.barcodeValue}
          price={printModalData.price}
          mrp={printModalData.mrp}
          defaultQuantity={printModalData.defaultQuantity}
        />
      )}
    </div>
  )
}
