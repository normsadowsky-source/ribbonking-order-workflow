import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!id) return new Response(JSON.stringify({ error: 'Order id required.' }), { status: 400, headers: { 'content-type': 'application/json' } });
  const db = getDatabase();
  const rows = await db.sql`
    SELECT event_type, actor, notes, created_at
    FROM order_events
    WHERE order_id = ${id}
    ORDER BY created_at DESC
  `;
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
};

export const config: Config = { path: '/api/order-history' };
