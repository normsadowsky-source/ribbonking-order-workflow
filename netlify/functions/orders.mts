import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });

function errorPayload(error: any) {
  return {
    error: error?.message || 'Server error while accessing the order database.',
    code: error?.code || null,
    detail: error?.detail || null,
  };
}

export default async (req: Request, _context: Context) => {
  const db = getDatabase();

  if (req.method === 'GET') {
    try {
      const result = await db.pool.query(`
        SELECT id, po_number, company_name, status, owner, next_action, follow_up_due,
               waiting_since, follow_up_owner, follow_up_stage, ship_date_sent_at,
               plate_status, created_at, updated_at
        FROM orders
        ORDER BY
          CASE WHEN follow_up_due IS NOT NULL AND follow_up_due < CURRENT_DATE THEN 0 ELSE 1 END,
          updated_at DESC
      `);
      return json(result.rows);
    } catch (error: any) {
      console.error('order list failed', error);
      return json(errorPayload(error), { status: 500 });
    }
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => null) as null | {
      poNumber?: string;
      companyName?: string;
      actor?: string;
    };

    const poNumber = body?.poNumber?.trim();
    const companyName = body?.companyName?.trim();
    const actor = body?.actor?.trim() || 'Egnali';

    if (!poNumber || !companyName) {
      return json({ error: 'PO number and company name are required.' }, { status: 400 });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const insert = await client.query(
        `INSERT INTO orders (po_number, company_name, created_by)
         VALUES ($1, $2, $3)
         RETURNING id, po_number, company_name, status, owner, next_action, follow_up_due,
                   waiting_since, follow_up_owner, follow_up_stage, ship_date_sent_at,
                   plate_status, created_at, updated_at`,
        [poNumber, companyName, actor]
      );

      const order = insert.rows[0];

      await client.query(
        `INSERT INTO order_events (order_id, event_type, actor, notes)
         VALUES ($1, $2, $3, $4)`,
        [order.id, 'ORDER_CREATED', actor, 'Order created']
      );

      await client.query('COMMIT');
      return json(order, { status: 201 });
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('order insert transaction failed', error);
      if (error?.code === '23505') {
        const existing = await db.pool.query(
          `SELECT id, po_number, company_name, status, owner, next_action, follow_up_due,
                  waiting_since, follow_up_owner, follow_up_stage, ship_date_sent_at,
                  plate_status, created_at, updated_at
           FROM orders
           WHERE BTRIM(po_number) = BTRIM($1)
             AND LOWER(BTRIM(company_name)) = LOWER(BTRIM($2))
           LIMIT 1`,
          [poNumber, companyName]
        );
        return json({
          error: 'That PO number already exists for this company.',
          existingOrder: existing.rows[0] || null
        }, { status: 409 });
      }
      return json(errorPayload(error), { status: 500 });
    } finally {
      client.release();
    }
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
};

export const config: Config = { path: '/api/orders' };
