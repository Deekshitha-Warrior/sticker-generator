-- ====================================================================
-- Migration 0002: Barcode Management & Inventory Movement Ledger
-- Provides: barcode sequences, barcode_registry, inventory_movements,
-- helper functions, and create_barcode_and_receive_stock RPC
-- ====================================================================

-- 1. Sequences for Barcode Generation
CREATE SEQUENCE IF NOT EXISTS public.barcode_product_seq START WITH 10000001;
CREATE SEQUENCE IF NOT EXISTS public.barcode_variant_seq START WITH 10000001;

-- 2. Canonical Barcode Registry Table
CREATE TABLE IF NOT EXISTS public.barcode_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode_value TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('product', 'variant')),
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_barcode_entity_target CHECK (
    (entity_type = 'product' AND variant_id IS NULL) OR
    (entity_type = 'variant' AND variant_id IS NOT NULL)
  )
);

-- 3. Inventory Movement Ledger Table
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  barcode_id UUID REFERENCES public.barcode_registry(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL CHECK (
    movement_type IN ('INITIAL_BARCODE_STOCK', 'RESTOCK', 'SALE', 'RETURN', 'DAMAGE', 'CORRECTION', 'VOID')
  ),
  quantity_delta NUMERIC NOT NULL,
  quantity_before NUMERIC NOT NULL,
  quantity_after NUMERIC NOT NULL,
  unit_cost NUMERIC DEFAULT NULL,
  reference_type TEXT DEFAULT NULL, -- 'order', 'adjustment', 'barcode_receipt'
  reference_id TEXT DEFAULT NULL,   -- order_id or invoice_no
  note TEXT DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Indexes for Rapid Barcode Lookup & Stock History
CREATE INDEX IF NOT EXISTS idx_barcode_registry_val ON public.barcode_registry(barcode_value);
CREATE INDEX IF NOT EXISTS idx_barcode_registry_prod ON public.barcode_registry(product_id);
CREATE INDEX IF NOT EXISTS idx_barcode_registry_var ON public.barcode_registry(variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_movements_prod ON public.inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movements_var ON public.inventory_movements(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movements_type ON public.inventory_movements(movement_type, created_at DESC);

-- 5. Enable RLS and Policies
ALTER TABLE public.barcode_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS barcode_registry_all ON public.barcode_registry;
CREATE POLICY barcode_registry_all ON public.barcode_registry FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS inventory_movements_all ON public.inventory_movements;
CREATE POLICY inventory_movements_all ON public.inventory_movements FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 6. Helper Function: Generate Unique Barcode String
CREATE OR REPLACE FUNCTION public.generate_barcode_value(p_entity_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_entity_type = 'variant' THEN
    RETURN 'MTXV' || LPAD(nextval('public.barcode_variant_seq')::TEXT, 7, '0');
  ELSE
    RETURN 'MTXP' || LPAD(nextval('public.barcode_product_seq')::TEXT, 7, '0');
  END IF;
END;
$$;

-- 7. Transactional RPC: Create Barcode & Receive Stock (Atomic)
CREATE OR REPLACE FUNCTION public.create_barcode_and_receive_stock(
  p_product_id BIGINT,
  p_variant_id UUID DEFAULT NULL,
  p_quantity_received NUMERIC DEFAULT 0,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_created_by_name TEXT DEFAULT '',
  p_custom_barcode TEXT DEFAULT NULL,
  p_note TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_type TEXT;
  v_barcode_id UUID;
  v_barcode_value TEXT;
  v_is_new_barcode BOOLEAN := FALSE;
  v_movement_type TEXT;
  v_qty_before NUMERIC := 0;
  v_qty_after NUMERIC := 0;
  v_prod_name TEXT;
  v_var_name TEXT := '';
BEGIN
  IF p_quantity_received < 0 THEN
    RAISE EXCEPTION 'Quantity received cannot be negative';
  END IF;

  -- 1. Check Parent Product Exists
  SELECT name INTO v_prod_name FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product with ID % not found', p_product_id;
  END IF;

  -- 2. Verify Variant Belongs to Product if Variant is Provided
  IF p_variant_id IS NOT NULL THEN
    v_entity_type := 'variant';
    SELECT variant_name, stock INTO v_var_name, v_qty_before
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant % does not belong to Product %', p_variant_id, p_product_id;
    END IF;
  ELSE
    v_entity_type := 'product';
    SELECT stock_quantity INTO v_qty_before
    FROM public.products
    WHERE id = p_product_id;
  END IF;

  -- 3. Check for Existing Active Barcode in barcode_registry (SKU Identity)
  IF v_entity_type = 'variant' THEN
    SELECT id, barcode_value INTO v_barcode_id, v_barcode_value
    FROM public.barcode_registry
    WHERE variant_id = p_variant_id AND is_active = TRUE
    ORDER BY created_at DESC
    LIMIT 1;
  ELSE
    SELECT id, barcode_value INTO v_barcode_id, v_barcode_value
    FROM public.barcode_registry
    WHERE product_id = p_product_id AND variant_id IS NULL AND is_active = TRUE
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- 4. Reuse Existing or Create New Barcode
  IF v_barcode_id IS NOT NULL THEN
    v_is_new_barcode := FALSE;
    v_movement_type := CASE WHEN v_qty_before = 0 THEN 'INITIAL_BARCODE_STOCK' ELSE 'RESTOCK' END;
  ELSE
    v_is_new_barcode := TRUE;
    v_movement_type := 'INITIAL_BARCODE_STOCK';
    v_barcode_value := COALESCE(NULLIF(UPPER(BTRIM(p_custom_barcode)), ''), public.generate_barcode_value(v_entity_type));

    INSERT INTO public.barcode_registry (
      barcode_value, entity_type, product_id, variant_id, is_active, created_by_name
    )
    VALUES (
      v_barcode_value, v_entity_type, p_product_id, p_variant_id, TRUE, COALESCE(p_created_by_name, '')
    )
    RETURNING id INTO v_barcode_id;
  END IF;

  -- 5. Synchronize compatibility column on target table
  IF v_entity_type = 'variant' THEN
    UPDATE public.product_variants
    SET barcode = v_barcode_value, updated_at = NOW()
    WHERE id = p_variant_id;
  ELSE
    UPDATE public.products
    SET barcode = v_barcode_value, updated_at = NOW()
    WHERE id = p_product_id;
  END IF;

  -- 6. Apply Stock Increment & Parent Aggregate Sync
  v_qty_after := v_qty_before + p_quantity_received;

  IF p_quantity_received > 0 THEN
    IF v_entity_type = 'variant' THEN
      UPDATE public.product_variants
      SET stock = v_qty_after, updated_at = NOW()
      WHERE id = p_variant_id;
  
      -- Refresh parent aggregate stock cache
      UPDATE public.products
      SET stock_quantity = (
            SELECT COALESCE(SUM(stock), 0)
            FROM public.product_variants
            WHERE product_id = p_product_id AND is_active = TRUE
          ),
          stock = FLOOR((
            SELECT COALESCE(SUM(stock), 0)
            FROM public.product_variants
            WHERE product_id = p_product_id AND is_active = TRUE
          ))::INTEGER,
          updated_at = NOW()
      WHERE id = p_product_id;
    ELSE
      UPDATE public.products
      SET stock_quantity = v_qty_after,
          stock = FLOOR(v_qty_after)::INTEGER,
          updated_at = NOW()
      WHERE id = p_product_id;
    END IF;
  END IF;

  -- 7. Record Immutable Inventory Movement
  IF p_quantity_received > 0 THEN
    INSERT INTO public.inventory_movements (
      product_id, variant_id, barcode_id, movement_type,
      quantity_delta, quantity_before, quantity_after,
      unit_cost, reference_type, reference_id, note, created_by_name
    )
    VALUES (
      p_product_id, p_variant_id, v_barcode_id, v_movement_type,
      p_quantity_received, v_qty_before, v_qty_after,
      p_unit_cost, 'barcode_receipt', v_barcode_value,
      COALESCE(p_note, ''), COALESCE(p_created_by_name, '')
    );
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'barcode_id', v_barcode_id,
    'barcode_value', v_barcode_value,
    'is_new_barcode', v_is_new_barcode,
    'movement_type', v_movement_type,
    'quantity_before', v_qty_before,
    'quantity_received', p_quantity_received,
    'quantity_after', v_qty_after,
    'product_id', p_product_id,
    'variant_id', p_variant_id,
    'product_name', v_prod_name,
    'variant_name', v_var_name
  );
END;
$$;

-- 8. Transactional RPC: Adjust Stock (Restock, Damage, Correction, Return)
CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(
  p_product_id BIGINT,
  p_variant_id UUID DEFAULT NULL,
  p_new_quantity NUMERIC DEFAULT 0,
  p_reason TEXT DEFAULT 'RESTOCK',
  p_note TEXT DEFAULT '',
  p_created_by_name TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty_before NUMERIC := 0;
  v_delta NUMERIC := 0;
  v_barcode_id UUID;
BEGIN
  IF p_new_quantity < 0 THEN
    RAISE EXCEPTION 'Stock quantity cannot be negative';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = p_variant_id AND product_id = p_product_id) THEN
      RAISE EXCEPTION 'Variant does not belong to specified Product';
    END IF;

    SELECT stock INTO v_qty_before FROM public.product_variants WHERE id = p_variant_id FOR UPDATE;
    SELECT id INTO v_barcode_id FROM public.barcode_registry WHERE variant_id = p_variant_id AND is_active = TRUE LIMIT 1;
    
    v_delta := p_new_quantity - v_qty_before;

    UPDATE public.product_variants
    SET stock = p_new_quantity, updated_at = NOW()
    WHERE id = p_variant_id;

    UPDATE public.products
    SET stock_quantity = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = p_product_id AND is_active = TRUE),
        stock = FLOOR((SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = p_product_id AND is_active = TRUE))::INTEGER,
        updated_at = NOW()
    WHERE id = p_product_id;
  ELSE
    SELECT stock_quantity INTO v_qty_before FROM public.products WHERE id = p_product_id FOR UPDATE;
    SELECT id INTO v_barcode_id FROM public.barcode_registry WHERE product_id = p_product_id AND variant_id IS NULL AND is_active = TRUE LIMIT 1;

    v_delta := p_new_quantity - v_qty_before;

    UPDATE public.products
    SET stock_quantity = p_new_quantity,
        stock = FLOOR(p_new_quantity)::INTEGER,
        updated_at = NOW()
    WHERE id = p_product_id;
  END IF;

  INSERT INTO public.inventory_movements (
    product_id, variant_id, barcode_id, movement_type,
    quantity_delta, quantity_before, quantity_after,
    reference_type, note, created_by_name
  )
  VALUES (
    p_product_id, p_variant_id, v_barcode_id, p_reason,
    v_delta, v_qty_before, p_new_quantity,
    'manual_adjustment', COALESCE(p_note, ''), COALESCE(p_created_by_name, '')
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'product_id', p_product_id,
    'variant_id', p_variant_id,
    'quantity_before', v_qty_before,
    'quantity_after', p_new_quantity,
    'delta', v_delta
  );
END;
$$;
