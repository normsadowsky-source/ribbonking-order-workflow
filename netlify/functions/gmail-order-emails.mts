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
    const rows = await db.pool.query(
      `SELECT gmail_thread_id, thread_type, participant_email, subject, created_at
         FROM order_email_threads
        WHERE order_id=$1
        ORDER BY created_at ASC`,
      [orderId]
    );

    if (!rows.rowCount) return json([]);

    const store = getStore('gmail-oauth');
    const connection = await store.get('connection', { type: 'json' }) as any;
    if (!connection?.refreshToken) return json({ error: 'Gmail is not connected.' }, { status: 409 });

    const token = await accessToken(connection.refreshToken);
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

      result.push({
        threadId: thread.gmail_thread_id,
        type: thread.thread_type,
        participantEmail: thread.participant_email,
        subject: thread.subject,
        messages: (data.messages || []).map((m: any) => ({
          id: m.id,
          threadId: m.threadId,
          from: header(m, 'From'),
          to: header(m, 'To'),
          subject: header(m, 'Subject'),
          date: header(m, 'Date'),
          snippet: m.snippet || '',
          unread: Array.isArray(m.labelIds) && m.labelIds.includes('UNREAD')
        }))
      });
    }

    return json(result);
  } catch (error: any) {
    console.error('Order Gmail thread lookup failed', error);
    return json({ error: error?.message || 'Could not load order email conversations.' }, { status: 500 });
  }
};

export const config: Config = { path: '/api/gmail/order-emails' };
