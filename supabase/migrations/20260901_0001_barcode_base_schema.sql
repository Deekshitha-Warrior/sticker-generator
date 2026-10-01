-- ====================================================================
-- Migration 0001: Core Catalog Schema for Barcode Management
-- Provides: categories, products, product_variants with RLS and indexes
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Categories
CREATE TABLE IF NOT EXISTS public.categories (
  id BIGSERIAL PRIMARY KEY,
  name_en TEXT NOT NULL UNIQUE,
  name_ta TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Products Table
CREATE TABLE IF NOT EXISTS public.products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_ta TEXT NOT NULL DEFAULT '',
  tamil_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  category_id BIGINT REFERENCES public.categories(id) ON DELETE SET NULL,
  remedy TEXT[] NOT NULL DEFAULT '{}',
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  offer_price NUMERIC(12,2),
  purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  mrp NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  unit_type TEXT NOT NULL DEFAULT 'unit' CHECK (unit_type IN ('unit', 'weight', 'volume', 'bundle')),
  unit_label TEXT NOT NULL DEFAULT 'piece',
  unit TEXT NOT NULL DEFAULT 'piece',
  base_quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  stock_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  opening_stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  stock_unit TEXT NOT NULL DEFAULT 'piece',
  low_stock_alert NUMERIC(12,3) NOT NULL DEFAULT 5,
  allow_decimal_quantity BOOLEAN NOT NULL DEFAULT FALSE,
  predefined_options JSONB NOT NULL DEFAULT '[]'::JSONB,
  description TEXT NOT NULL DEFAULT '',
  description_ta TEXT NOT NULL DEFAULT '',
  benefits TEXT NOT NULL DEFAULT '',
  benefits_ta TEXT NOT NULL DEFAULT '',
  image TEXT,
  image_url TEXT,
  sku TEXT,
  barcode TEXT,
  brand TEXT,
  supplier TEXT,
  size TEXT,
  color TEXT,
  rating NUMERIC(3,1) NOT NULL DEFAULT 5,
  has_variants BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for searching and barcode lookups
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON public.products (is_active, sort_order ASC);

-- 3. Product Variants Table
CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_name TEXT NOT NULL,
  size_label TEXT,
  weight_value NUMERIC(12,3),
  weight_unit TEXT,
  sku TEXT,
  barcode TEXT,
  purchase_price NUMERIC(12,2),
  mrp NUMERIC(12,2),
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  group_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for variant barcode lookups
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON public.product_variants (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON public.product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_is_active ON public.product_variants (is_active, sort_order ASC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- 5. Public RLS Policies
DROP POLICY IF EXISTS "categories_all" ON public.categories;
CREATE POLICY "categories_all" ON public.categories FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "products_all" ON public.products;
CREATE POLICY "products_all" ON public.products FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "product_variants_all" ON public.product_variants;
CREATE POLICY "product_variants_all" ON public.product_variants FOR ALL USING (TRUE) WITH CHECK (TRUE);
