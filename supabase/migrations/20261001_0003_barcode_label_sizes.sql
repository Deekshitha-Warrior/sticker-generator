-- ====================================================================
-- Migration 0003: Barcode Label Sizes & Printer Specifications
-- Stores custom and physical label roll dimensions synchronized via Supabase
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.barcode_label_sizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  width_mm NUMERIC NOT NULL CHECK (width_mm > 0),
  height_mm NUMERIC NOT NULL CHECK (height_mm > 0),
  labels_per_row INTEGER NOT NULL DEFAULT 1 CHECK (labels_per_row >= 1),
  horizontal_gap_mm NUMERIC NOT NULL DEFAULT 0 CHECK (horizontal_gap_mm >= 0),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for ordering by creation time
CREATE INDEX IF NOT EXISTS idx_barcode_label_sizes_created ON public.barcode_label_sizes(created_at ASC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.barcode_label_sizes ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated and anonymous users
DROP POLICY IF EXISTS "Allow public read on barcode_label_sizes" ON public.barcode_label_sizes;
CREATE POLICY "Allow public read on barcode_label_sizes"
  ON public.barcode_label_sizes
  FOR SELECT
  TO public
  USING (true);

-- Allow insert access
DROP POLICY IF EXISTS "Allow insert on barcode_label_sizes" ON public.barcode_label_sizes;
CREATE POLICY "Allow insert on barcode_label_sizes"
  ON public.barcode_label_sizes
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Allow update access
DROP POLICY IF EXISTS "Allow update on barcode_label_sizes" ON public.barcode_label_sizes;
CREATE POLICY "Allow update on barcode_label_sizes"
  ON public.barcode_label_sizes
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

-- Allow delete access
DROP POLICY IF EXISTS "Allow delete on barcode_label_sizes" ON public.barcode_label_sizes;
CREATE POLICY "Allow delete on barcode_label_sizes"
  ON public.barcode_label_sizes
  FOR DELETE
  TO public
  USING (true);

-- Auto-update updated_at timestamp trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_barcode_label_sizes_updated_at ON public.barcode_label_sizes;
CREATE TRIGGER trg_barcode_label_sizes_updated_at
  BEFORE UPDATE ON public.barcode_label_sizes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Seed Default Standard Thermal Label Presets
INSERT INTO public.barcode_label_sizes (name, width_mm, height_mm, labels_per_row, horizontal_gap_mm, is_default)
VALUES 
  ('Standard (50 × 25 mm)', 50, 25, 1, 0, true),
  ('2-Up Roll (50 × 25 mm × 2)', 50, 25, 2, 2, false),
  ('Compact (38 × 25 mm)', 38, 25, 1, 0, false),
  ('Jewelry / Small Tag (35 × 22 mm)', 35, 22, 1, 0, false),
  ('Large Box Sticker (100 × 50 mm)', 100, 50, 1, 0, false)
ON CONFLICT (name) DO NOTHING;
