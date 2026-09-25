import type { Config, Context } from '@netlify/functions';
import { getDatabase } from '@netlify/database';

type Transition = { status?: string; owner?: string; nextAction?: string; waiting?: boolean; followBusinessDays?: number; followUpOwner?: string | null; followUpStage?: string | null };

const transitions: Record<string, Transition> = {
  ASSIGN_TO_LOGAS: { status: 'READY_FOR_VECTOR', owner: 'Logas', nextAction: 'Send to Vector', waiting: false },
  WAITING_CUSTOMER_INFO: { status: 'WAITING_CUSTOMER_INFO', owner: 'Logas', nextAction: 'Follow up with customer', waiting: true, followBusinessDays: 1, followUpOwner: 'Logas', followUpStage: 'CUSTOMER_INFO' },
  SENT_TO_VECTOR: { status: 'WAITING_VECTOR', owner: 'Logas', nextAction: 'Monitor Vector return', waiting: true, followBusinessDays: 1, followUpOwner: 'Logas', followUpStage: 'VECTOR' },
  VECTOR_RECEIVED: { status: 'VECTOR_REVIEW_REQUIRED', owner: 'Logas', nextAction: 'Review Vector artwork', waiting: false },
  PROOF_SENT: { status: 'WAITING_CUSTOMER_RESPONSE', owner: 'Logas', nextAction: 'Monitor customer response for 3 business hours', waiting: true, followUpOwner: 'Logas', followUpStage: 'CUSTOMER_RESPONSE_WINDOW' },
  TRANSFER_APPROVAL_TO_EGNALI: { status: 'WAITING_CUSTOMER_APPROVAL', owner: 'Egnali', nextAction: 'Approval follow-up every other business day', waiting: true, followBusinessDays: 2, followUpOwner: 'Egnali', followUpStage: 'APPROVAL' },
  CUSTOMER_CHANGES: { status: 'CUSTOMER_CHANGES_REQUESTED', owner: 'Logas', nextAction: 'Send revision to Vector', waiting: false },
  REVISION_SENT_VECTOR: { status: 'WAITING_VECTOR_REVISION', owner: 'Logas', nextAction: 'Monitor Vector revision', waiting: true, followBusinessDays: 1, followUpOwner: 'Logas', followUpStage: 'VECTOR_REVISION' },
  CUSTOMER_APPROVED: { status: 'CUSTOMER_APPROVED', owner: 'Egnali', nextAction: 'Send ship date and decide plate requirement', waiting: false },
};

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json; charset=utf-8' } });

function easternTodayUtc() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

function easternBusinessDatePlus(days: number) {
  const date = easternTodayUtc();
  let added = 0;
  while (added < days) {
    date.setUTCDate(date.getUTCDate() + 1);
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
  const db = getDatabase();
  const body = await req.json().catch(() => null) as null | { orderId?: number; action?: string; actor?: string; notes?: string };
  const orderId = Number(body?.orderId);
  const action = body?.action || '';
  const actor = body?.actor?.trim() || 'Egnali';
  const notes = body?.notes?.trim() || null;

  if (!orderId || !action) return json({ error: 'Invalid order or action.' }, { status: 400 });
  const [current] = await db.sql`SELECT * FROM orders WHERE id = ${orderId}`;
  if (!current) return json({ error: 'Order not found.' }, { status: 404 });

  if (action === 'APPROVED_NO_PLATE_READY') {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const updatedResult = await client.query(
        `UPDATE orders
           SET status='COMPLETE', owner='Egnali', next_action='Complete',
               ship_date_sent_at=NOW(), plate_status='NOT_REQUIRED',
               follow_up_due=NULL, follow_up_owner=NULL, follow_up_stage=NULL,
               waiting_since=NULL, updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [orderId]
      );
      const updated = updatedResult.rows[0];
      await client.query(
        `INSERT INTO order_events (order_id,event_type,actor,notes)
         VALUES
           ($1,'CUSTOMER_APPROVED',$2,$3),
           ($1,'SHIP_DATE_SENT',$2,NULL),
           ($1,'PLATE_NOT_REQUIRED',$2,NULL),
           ($1,'COMPLETE',$2,NULL)`,
        [orderId, actor, notes]
      );
      await client.query('COMMIT');
      return json(updated);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  if (action === 'APPROVED_PLATE_REQUIRED') {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const updatedResult = await client.query(
        `UPDATE orders
           SET status='CUSTOMER_APPROVED', owner='Egnali', next_action='Make plate',
               ship_date_sent_at=NOW(), plate_status='REQUIRED',
               follow_up_due=NULL, follow_up_owner=NULL, follow_up_stage=NULL,
               waiting_since=NULL, updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [orderId]
      );
      const updated = updatedResult.rows[0];
      await client.query(
        `INSERT INTO order_events (order_id,event_type,actor,notes)
         VALUES
           ($1,'CUSTOMER_APPROVED',$2,$3),
           ($1,'SHIP_DATE_SENT',$2,NULL),
           ($1,'PLATE_REQUIRED',$2,NULL)`,
        [orderId, actor, notes]
      );
      await client.query('COMMIT');
      return json(updated);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  if (action === 'PLATE_READY_COMPLETE') {
    if (current.status !== 'CUSTOMER_APPROVED' || current.plate_status !== 'REQUIRED') {
      return json({ error: 'This action is only available when a required plate is pending.' }, { status: 409 });
    }
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const updatedResult = await client.query(
        `UPDATE orders
           SET status='COMPLETE', owner='Egnali', next_action='Complete',
               plate_status='ORDERED', follow_up_due=NULL, follow_up_owner=NULL,
               follow_up_stage=NULL, waiting_since=NULL, updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [orderId]
      );
      const updated = updatedResult.rows[0];
      await client.query(
        `INSERT INTO order_events (order_id,event_type,actor,notes)
         VALUES
           ($1,'PLATE_ORDERED',$2,$3),
           ($1,'COMPLETE',$2,NULL)`,
        [orderId, actor, notes]
      );
      await client.query('COMMIT');
      return json(updated);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  if (action === 'FOLLOW_UP_SENT') {
    let due: string | null = null;
    let followUpOwner = current.follow_up_owner || current.owner;
    let followUpStage = current.follow_up_stage;
    let nextAction = current.next_action;

    if (current.status === 'WAITING_CUSTOMER_APPROVAL') {
      followUpOwner = 'Egnali';
      followUpStage = 'APPROVAL';
      due = easternBusinessDatePlus(2);
      nextAction = 'Egnali: approval follow-up every other business day';
    } else {
      due = easternBusinessDatePlus(1);
      followUpOwner = current.owner;
    }

    const [updated] = await db.sql`
      UPDATE orders SET follow_up_due=${due}, follow_up_owner=${followUpOwner}, follow_up_stage=${followUpStage},
        next_action=${nextAction}, waiting_since=COALESCE(waiting_since,NOW()), updated_at=NOW()
      WHERE id=${orderId} RETURNING *`;
    const eventActor = current.status === 'WAITING_CUSTOMER_APPROVAL' ? 'Egnali' : actor;
    await db.sql`INSERT INTO order_events (order_id,event_type,actor,notes) VALUES (${orderId},${action},${eventActor},${notes})`;
    return json(updated);
  }

  if (action === 'SHIP_DATE_SENT') {
    const [updated] = await db.sql`
      UPDATE orders SET ship_date_sent_at = NOW(),
        next_action = CASE WHEN plate_status = 'UNDECIDED' THEN 'Decide plate requirement' WHEN plate_status = 'REQUIRED' THEN 'Order plate' ELSE 'Ready to close' END,
        updated_at = NOW()
      WHERE id = ${orderId} RETURNING *`;
    await db.sql`INSERT INTO order_events (order_id,event_type,actor,notes) VALUES (${orderId},${action},${actor},${notes})`;
    return json(updated);
  }

  if (action === 'PLATE_NOT_REQUIRED' || action === 'PLATE_REQUIRED' || action === 'PLATE_ORDERED') {
    const plateStatus = action === 'PLATE_NOT_REQUIRED' ? 'NOT_REQUIRED' : action === 'PLATE_REQUIRED' ? 'REQUIRED' : 'ORDERED';
    const [updated] = await db.sql`
      UPDATE orders SET plate_status = ${plateStatus},
        next_action = CASE
          WHEN ship_date_sent_at IS NULL THEN 'Send ship date to customer'
          WHEN ${plateStatus} = 'REQUIRED' THEN 'Order plate'
          ELSE 'Ready to close'
        END,
        updated_at = NOW()
      WHERE id = ${orderId} RETURNING *`;
    await db.sql`INSERT INTO order_events (order_id,event_type,actor,notes) VALUES (${orderId},${action},${actor},${notes})`;
    return json(updated);
  }

  if (action === 'COMPLETE') {
    if (current.status !== 'CUSTOMER_APPROVED') return json({ error: 'Only approved orders can be closed.' }, { status: 409 });
    if (!current.ship_date_sent_at) return json({ error: 'Send the ship date before closing the order.' }, { status: 409 });
    if (!['NOT_REQUIRED', 'ORDERED'].includes(current.plate_status)) return json({ error: 'Resolve the plate requirement before closing the order.' }, { status: 409 });
    const [updated] = await db.sql`
      UPDATE orders SET status='COMPLETE', owner='Egnali', next_action='Complete', follow_up_due=NULL, waiting_since=NULL, updated_at=NOW()
      WHERE id=${orderId} RETURNING *`;
    await db.sql`INSERT INTO order_events (order_id,event_type,actor,notes) VALUES (${orderId},${action},${actor},${notes})`;
    return json(updated);
  }

  const transition = transitions[action];
  if (!transition) return json({ error: 'Invalid action.' }, { status: 400 });

  const status = transition.status || current.status;
  const owner = transition.owner || current.owner;
  const nextAction = transition.nextAction || current.next_action;
  const due = transition.followBusinessDays ? easternBusinessDatePlus(transition.followBusinessDays) : null;

  const [updated] = await db.sql`
    UPDATE orders
       SET status = ${status}, owner = ${owner}, next_action = ${nextAction},
           waiting_since = ${transition.waiting ? new Date().toISOString() : null},
           follow_up_due = ${due}, follow_up_owner = ${transition.followUpOwner ?? null},
           follow_up_stage = ${transition.followUpStage ?? null}, updated_at = NOW()
     WHERE id = ${orderId}
     RETURNING *
  `;

  await db.sql`INSERT INTO order_events (order_id,event_type,actor,notes) VALUES (${orderId},${action},${actor},${notes})`;
  return json(updated);
};

export const config: Config = { path: '/api/order-action' };
