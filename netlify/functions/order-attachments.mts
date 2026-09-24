import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { getDeployStore, getStore } from '@netlify/blobs';

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });

function artworkStore() {
  const deployContext = (globalThis as any).Netlify?.context?.deploy?.context;
  return deployContext === 'production'
    ? getStore('order-artwork')
    : getDeployStore('order-artwork');
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180) || 'attachment';
}

export default async (req: Request, _context: Context) => {
  const db = getDatabase();

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const orderId = Number(url.searchParams.get('orderId'));
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return json({ error: 'A valid order ID is required.' }, { status: 400 });
    }

    try {
      const result = await db.pool.query(
        `SELECT id, order_id, file_name, mime_type, file_size, uploaded_by, created_at
         FROM order_attachments
         WHERE order_id = $1
         ORDER BY created_at DESC`,
        [orderId]
      );
      return json(result.rows);
    } catch (error: any) {
      console.error('attachment list failed', error);
      return json({ error: error?.message || 'Could not load attachments.' }, { status: 500 });
    }
  }

  if (req.method === 'POST') {
    try {
      const form = await req.formData();
      const orderId = Number(form.get('orderId'));
      const actor = String(form.get('actor') || 'Egnali').trim() || 'Egnali';
      const file = form.get('file');

      if (!Number.isFinite(orderId) || orderId <= 0) {
        return json({ error: 'A valid order ID is required.' }, { status: 400 });
      }
      if (!(file instanceof File) || !file.name) {
        return json({ error: 'Choose a file to upload.' }, { status: 400 });
      }

      const orderCheck = await db.pool.query('SELECT id FROM orders WHERE id = $1', [orderId]);
      if (!orderCheck.rowCount) {
        return json({ error: 'Order not found.' }, { status: 404 });
      }

      const cleanName = safeFileName(file.name);
      const blobKey = `orders/${orderId}/${crypto.randomUUID()}-${cleanName}`;
      const store = artworkStore();
      await store.set(blobKey, await file.arrayBuffer());

      const insert = await db.pool.query(
        `INSERT INTO order_attachments
          (order_id, blob_key, file_name, mime_type, file_size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, order_id, file_name, mime_type, file_size, uploaded_by, created_at`,
        [orderId, blobKey, file.name, file.type || 'application/octet-stream', file.size, actor]
      );

      await db.pool.query(
        `INSERT INTO order_events (order_id, event_type, actor, notes)
         VALUES ($1, 'ARTWORK_ATTACHED', $2, $3)`,
        [orderId, actor, `Attached file: ${file.name}`]
      );

      return json(insert.rows[0], { status: 201 });
    } catch (error: any) {
      console.error('attachment upload failed', error);
      return json({ error: error?.message || 'Could not upload attachment.' }, { status: 500 });
    }
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
};

export const config: Config = { path: '/api/order-attachments' };
