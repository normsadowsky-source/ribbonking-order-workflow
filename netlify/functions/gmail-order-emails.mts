import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { getDatabase } from '@netlify/database';

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) }
  });

async function accessToken(refreshToken: string) {
  const clientId = Netlify.env.get('GMAIL_CLIENT_ID')?.trim();
  const clientSecret = Netlify.env.get('GMAIL_CLIENT_SECRET')?.trim();
  if (!clientId || !clientSecret) throw new Error('Gmail OAuth credentials are not configured.');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await response.json() as any;
  if (!response.ok || !data.access_token) throw new Error(data?.error || 'Could not refresh Gmail access.');
  return String(data.access_token);
}

function header(message: any, name: string) {
  const headers = message?.payload?.headers || [];
  return headers.find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value || '';
}

export default async (req: Request, _context: Context) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const url = new URL(req.url);
    const orderId = Number(url.searchParams.get('orderId'));
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return json({ error: 'A valid order ID is required.' }, { status: 400 });
    }

    const db = getDatabase();
    const orderResult = await db.pool.query(
      'SELECT id, po_number, company_name, customer_email FROM orders WHERE id=$1',
      [orderId]
    );
    const order = orderResult.rows[0];
    if (!order) return json({ error: 'Order not found.' }, { status: 404 });

    let rows = await db.pool.query(
      `SELECT gmail_thread_id, thread_type, participant_email, subject, created_at
         FROM order_email_threads
        WHERE order_id=$1
        ORDER BY created_at ASC`,
      [orderId]
    );

    const store = getStore('gmail-oauth');
    const connection = await store.get('connection', { type: 'json' }) as any;
    if (!connection?.refreshToken) return json({ error: 'Gmail is not connected.' }, { status: 409 });

    const token = await accessToken(connection.refreshToken);

    if (order.customer_email) {
      const query = `from:(${order.customer_email}) "PO ${order.po_number}" newer_than:90d`;
      const searchRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(query)}&maxResults=20`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      const searchData = await searchRes.json() as any;

      if (searchRes.ok) {
        for (const candidate of searchData.threads || []) {
          const threadRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(candidate.id)}?format=full`,
            { headers: { authorization: `Bearer ${token}` } }
          );
          const threadData = await threadRes.json() as any;
          if (!threadRes.ok) continue;

          const matchingMessage = (threadData.messages || []).find((m: any) => {
            const from = header(m, 'From').toLowerCase();
            const subject = header(m, 'Subject').toLowerCase();
            return from.includes(String(order.customer_email).toLowerCase())
              && subject.includes(String(order.po_number).toLowerCase());
          });

          if (matchingMessage) {
            await db.pool.query(
              `INSERT INTO order_email_threads
                (order_id, gmail_thread_id, thread_type, participant_email, subject)
               VALUES ($1,$2,'CUSTOMER',$3,$4)
               ON CONFLICT (order_id, gmail_thread_id) DO NOTHING`,
              [orderId, candidate.id, order.customer_email, header(matchingMessage, 'Subject')]
            );
          }
        }

        rows = await db.pool.query(
          `SELECT gmail_thread_id, thread_type, participant_email, subject, created_at
             FROM order_email_threads
            WHERE order_id=$1
            ORDER BY created_at ASC`,
          [orderId]
        );
      }
    }

    const result = [];

    for (const thread of rows.rows) {
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(thread.gmail_thread_id)}?format=full`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      const data = await response.json() as any;
      if (!response.ok) {
        console.error('Could not load Gmail thread', thread.gmail_thread_id, data);
        continue;
      }

      const messages = [];
      for (const m of data.messages || []) {
        const from = header(m, 'From');
        const to = header(m, 'To');
        const subject = header(m, 'Subject');
        const date = header(m, 'Date');
        const participant = String(thread.participant_email || '').toLowerCase();
        const incoming = participant && from.toLowerCase().includes(participant);

        if (incoming) {
          const inserted = await db.pool.query(
            `INSERT INTO order_email_messages
              (order_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, message_date)
             VALUES ($1,$2,$3,'INCOMING',$4,$5,$6)
             ON CONFLICT (order_id, gmail_message_id) DO NOTHING
             RETURNING id`,
            [orderId, m.id, m.threadId, from, subject, date]
          );

          if (inserted.rowCount) {
            const eventType = thread.thread_type === 'VECTOR' ? 'VECTOR_REPLY_RECEIVED' : 'CUSTOMER_REPLY_RECEIVED';
            await db.pool.query(
              `INSERT INTO order_events (order_id,event_type,actor,notes)
               VALUES ($1,$2,'System',$3)`,
              [orderId, eventType, `Reply received from ${from}. Subject: ${subject || thread.subject || 'No subject'}`]
            );
          }
        }

        messages.push({
          id: m.id,
          threadId: m.threadId,
          from,
          to,
          subject,
          date,
          snippet: m.snippet || '',
          unread: Array.isArray(m.labelIds) && m.labelIds.includes('UNREAD'),
          incoming
        });
      }

      result.push({
        threadId: thread.gmail_thread_id,
        type: thread.thread_type,
        participantEmail: thread.participant_email,
        subject: thread.subject,
        messages
      });
    }

    return json(result);
  } catch (error: any) {
    console.error('Order Gmail thread lookup failed', error);
    return json({ error: error?.message || 'Could not load order email conversations.' }, { status: 500 });
  }
};

export const config: Config = { path: '/api/gmail/order-emails' };
