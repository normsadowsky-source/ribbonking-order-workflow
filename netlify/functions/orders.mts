import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });

function databaseErrorDetails(error: any) {
  const cause = error?.cause || error?.originalError || null;
  return {
    error: error?.message || 'Server error while accessing the order database.',
    code: error?.code || cause?.code || null,
    detail: error?.detail || cause?.detail || null,
    hint: error?.hint || cause?.hint || null,
    cause: cause?.message || null,
  };
}

export default async (req: Request, _context: Context) => {
  try {
    const db = getDatabase();

    if (req.method === 'GET') {
      const rows = await db.sql`
        SELECT id, po_number, company_name, status, owner, next_action, follow_up_due,
               waiting_since, follow_up_owner, follow_up_stage, ship_date_sent_at,
               plate_status, created_at, updated_at
        FROM orders
        ORDER BY
          CASE WHEN follow_up_due IS NOT NULL AND follow_up_due < CURRENT_DATE THEN 0 ELSE 1 END,
          updated_at DESC
      `;
      return json(rows);
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => null) as null | { poNumber?: string; companyName?: string; actor?: string };
      const poNumber = body?.poNumber?.trim();
      const companyName = body?.companyName?.trim();
      const actor = body?.actor?.trim() || 'Egnali';

      if (!poNumber || !companyName) {
        return json({ error: 'PO number and company name are required.' }, { status: 400 });
      }

      try {
        const [order] = await db.sql`
          INSERT INTO orders (po_number, company_name, created_by)
          VALUES (${poNumber}, ${companyName}, ${actor})
          RETURNING *
        `;
        await db.sql`
          INSERT INTO order_events (order_id, event_type, actor, notes)
          VALUES (${order.id}, 'ORDER_CREATED', ${actor}, ${'Order created'})
        `;
        return json(order, { status: 201 });
      } catch (error: any) {
        const cause = error?.cause || error?.originalError;
        const code = error?.code || cause?.code;
        if (code === '23505') {
          return json({ error: 'That PO number already exists.' }, { status: 409 });
        }
        console.error('order insert failed', error);
        return json(databaseErrorDetails(error), { status: 500 });
      }
    }

    return json({ error: 'Method not allowed' }, { status: 405 });
  } catch (error: any) {
    console.error('orders function failed', error);
    return json(databaseErrorDetails(error), { status: 500 });
  }
};

export const config: Config = { path: '/api/orders' };
