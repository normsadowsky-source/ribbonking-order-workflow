import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { getDeployStore, getStore } from '@netlify/blobs';

function artworkStore() {
  const deployContext = (globalThis as any).Netlify?.context?.deploy?.context;
  return deployContext === 'production'
    ? getStore('order-artwork')
    : getDeployStore('order-artwork');
}

export default async (req: Request, _context: Context) => {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return new Response('Invalid attachment ID', { status: 400 });
  }

  const db = getDatabase();
  const result = await db.pool.query(
    `SELECT blob_key, file_name, mime_type
     FROM order_attachments
     WHERE id = $1`,
    [id]
  );

  if (!result.rowCount) {
    return new Response('Attachment not found', { status: 404 });
  }

  const attachment = result.rows[0];
  const store = artworkStore();
  const data = await store.get(attachment.blob_key, { type: 'arrayBuffer' });

  if (!data) {
    return new Response('Attachment file not found', { status: 404 });
  }

  const encoded = encodeURIComponent(attachment.file_name);
  return new Response(data, {
    headers: {
      'content-type': attachment.mime_type || 'application/octet-stream',
      'content-disposition': `attachment; filename*=UTF-8''${encoded}`,
      'cache-control': 'private, no-store',
    },
  });
};

export const config: Config = { path: '/api/order-attachment-file' };
