const { Pool } = require('pg');
require('dotenv').config();

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.NEON_URL;
    if (!connectionString) {
      throw new Error('NEON_URL is not set in environment');
    }
    pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 6000,
      idleTimeoutMillis: 10000,
      max: 10,
    });
  }
  return pool;
}

async function handleApiRequest(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const rawUrl = req.headers['x-forwarded-uri'] || req.url || '/';
  const url = new URL(rawUrl, 'http://localhost');
  let pathname = url.pathname;

  // In Vercel [...path].js functions, req.query.path contains the sub-paths
  if (req.query && req.query.path) {
    const sub = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
    pathname = '/api/' + sub.replace(/^\/+/, '');
  }

  try {
    const db = getPool();

    // 1. GET /api/products
    if (pathname === '/api/products' && req.method === 'GET') {
      const result = await db.query(`
        SELECT p.*, c.name_en as category_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.is_active = true
        ORDER BY p.sort_order ASC, p.id ASC;
      `);
      res.statusCode = 200;
      res.end(JSON.stringify({ data: result.rows }));
      return;
    }

    // 2. POST /api/products
    if (pathname === '/api/products' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = await db.query(
        `INSERT INTO products (name, category_id, price, purchase_price, barcode, has_variants)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;`,
        [body.name, body.category_id || null, body.price || 0, body.purchase_price || 0, body.barcode || null, body.has_variants || false]
      );
      res.statusCode = 201;
      res.end(JSON.stringify({ data: result.rows[0] }));
      return;
    }

    // 3. GET /api/categories
    if (pathname === '/api/categories' && req.method === 'GET') {
      const result = await db.query(`
        SELECT id, name_en, name_ta, is_active, sort_order
        FROM categories
        WHERE is_active = true
        ORDER BY sort_order ASC, id ASC;
      `);
      res.statusCode = 200;
      res.end(JSON.stringify({ data: result.rows }));
      return;
    }

    // 4. GET /api/variants
    if (pathname === '/api/variants' && req.method === 'GET') {
      const productId = url.searchParams.get('productId');
      let query = 'SELECT * FROM product_variants WHERE is_active = true';
      const params = [];
      if (productId) {
        query += ' AND product_id = $1';
        params.push(productId);
      }
      query += ' ORDER BY sort_order ASC, variant_name ASC;';
      const result = await db.query(query, params);
      res.statusCode = 200;
      res.end(JSON.stringify({ data: result.rows }));
      return;
    }

    // 5. GET /api/label-sizes
    if (pathname === '/api/label-sizes' && req.method === 'GET') {
      const result = await db.query(`
        SELECT * FROM barcode_label_sizes ORDER BY created_at ASC;
      `);
      res.statusCode = 200;
      res.end(JSON.stringify({ data: result.rows }));
      return;
    }

    // 6. POST /api/label-sizes
    if (pathname === '/api/label-sizes' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = await db.query(
        `INSERT INTO barcode_label_sizes (name, width_mm, height_mm, labels_per_row, horizontal_gap_mm, is_default)
         VALUES ($1, $2, $3, $4, $5, false) RETURNING *;`,
        [body.name, body.width_mm, body.height_mm, body.labels_per_row || 1, body.horizontal_gap_mm || 0]
      );
      res.statusCode = 201;
      res.end(JSON.stringify({ data: result.rows[0] }));
      return;
    }

    // 7. DELETE /api/label-sizes/:id
    if (pathname.startsWith('/api/label-sizes/') && req.method === 'DELETE') {
      const id = pathname.replace('/api/label-sizes/', '');
      await db.query(`DELETE FROM barcode_label_sizes WHERE id = $1;`, [id]);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 8. POST /api/barcodes/receive (Atomic RPC)
    if (pathname === '/api/barcodes/receive' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = await db.query(
        `SELECT public.create_barcode_and_receive_stock($1, $2, $3, $4, $5, $6, $7) as res;`,
        [
          body.product_id,
          body.variant_id || null,
          body.quantity_received || 0,
          body.unit_cost || null,
          body.created_by_name || 'Admin',
          body.custom_barcode || null,
          body.note || '',
        ]
      );
      res.statusCode = 200;
      res.end(JSON.stringify({ data: result.rows[0].res }));
      return;
    }

    // 9. GET /api/barcodes (Registry)
    if (pathname === '/api/barcodes' && req.method === 'GET') {
      const search = url.searchParams.get('search') || '';
      let query = `
        SELECT 
          r.id, r.barcode_value, r.entity_type, r.product_id, r.variant_id, r.is_active, r.created_by_name, r.created_at, r.updated_at,
          json_build_object('id', p.id, 'name', p.name, 'price', p.price, 'offer_price', p.offer_price, 'category', p.category) as product,
          CASE WHEN v.id IS NOT NULL THEN json_build_object('id', v.id, 'variant_name', v.variant_name, 'price', v.price, 'stock', v.stock, 'sku', v.sku) ELSE NULL END as variant
        FROM barcode_registry r
        LEFT JOIN products p ON r.product_id = p.id
        LEFT JOIN product_variants v ON r.variant_id = v.id
        WHERE r.is_active = true
      `;
      const params = [];
      if (search.trim()) {
        params.push(`%${search.trim()}%`);
        query += ` AND (r.barcode_value ILIKE $1 OR p.name ILIKE $1)`;
      }
      query += ` ORDER BY r.created_at DESC LIMIT 100;`;
      const result = await db.query(query, params);
      res.statusCode = 200;
      res.end(JSON.stringify({ data: result.rows }));
      return;
    }

    // 10. PATCH /api/barcodes/:id
    if (pathname.startsWith('/api/barcodes/') && req.method === 'PATCH') {
      const id = pathname.replace('/api/barcodes/', '');
      await db.query(`UPDATE barcode_registry SET is_active = false, updated_at = NOW() WHERE id = $1;`, [id]);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // Not found
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  } catch (err) {
    console.error('[API Error]:', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON in request body'));
      }
    });
    req.on('error', reject);
  });
}

module.exports = { handleApiRequest, getPool };
