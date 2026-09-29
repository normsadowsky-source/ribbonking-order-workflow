import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { getDatabase } from '@netlify/database';

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) }
  });

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
  if (!response.ok || !data.access_token) {
    console.error('Gmail token refresh failed', data);
    throw new Error(data?.error || 'Could not refresh Gmail access.');
  }
  return String(data.access_token);
}

function encodeHeader(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function wrapBase64(base64: string) {
  return base64.match(/.{1,76}/g)?.join('\r\n') || base64;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const form = await req.formData();
    const orderId = Number(form.get('orderId'));
    const actor = String(form.get('actor') || 'Logas').trim() || 'Logas';
    const instructions = String(form.get('instructions') || '').trim();
    const file = form.get('file');

    if (!Number.isFinite(orderId) || orderId <= 0) {
      return json({ error: 'A valid order ID is required.' }, { status: 400 });
    }
    if (!(file instanceof File) || !file.name) {
      return json({ error: 'Attach the artwork or logo before sending to Vector.' }, { status: 400 });
    }

    const vectorEmail = Netlify.env.get('VECTOR_EMAIL')?.trim();
    if (!vectorEmail) return json({ error: 'Vector email address is not configured.' }, { status: 503 });

    const db = getDatabase();
    const orderResult = await db.pool.query('SELECT id, po_number, company_name FROM orders WHERE id=$1', [orderId]);
    const order = orderResult.rows[0];
    if (!order) return json({ error: 'Order not found.' }, { status: 404 });

    const store = getStore('gmail-oauth');
    const connection = await store.get('connection', { type: 'json' }) as any;
    if (!connection?.refreshToken || !connection?.email) {
      return json({ error: 'Gmail is not connected.' }, { status: 409 });
    }

    const subject = `PO ${order.po_number} - ${order.company_name} - Vector Artwork Request`;
    const body = [
      'Hello Vector,',
      '',
      `Please process the attached artwork for Ribbon King PO ${order.po_number}.`,
      `Customer: ${order.company_name}`,
      '',
      'Instructions:',
      instructions || 'No additional instructions provided.',
      '',
      'Thank you,',
      'Ribbon King'
    ].join('\r\n');

    const boundary = `rk-${crypto.randomUUID()}`;
    const fileBytes = Buffer.from(await file.arrayBuffer());
    const fileBase64 = wrapBase64(fileBytes.toString('base64'));
    const mime = [
      `From: Ribbon King <${connection.email}>`,
      `To: ${vectorEmail}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body,
      '',
      `--${boundary}`,
      `Content-Type: ${file.type || 'application/octet-stream'}; name="${encodeHeader(file.name)}"`,
      `Content-Disposition: attachment; filename="${encodeHeader(file.name)}"`,
      'Content-Transfer-Encoding: base64',
      '',
      fileBase64,
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const token = await accessToken(connection.refreshToken);
    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ raw: Buffer.from(mime, 'utf8').toString('base64url') })
    });

    const sent = await sendRes.json() as any;
    if (!sendRes.ok || !sent?.id) {
      console.error('Vector Gmail send failed', sent);
      return json({ error: sent?.error?.message || 'Could not send email to Vector.' }, { status: 502 });
    }

    const due = easternBusinessDatePlus(1);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE orders
            SET status='WAITING_VECTOR', owner='Logas', next_action='Monitor Vector return',
                waiting_since=NOW(), follow_up_due=$1, follow_up_owner='Logas',
                follow_up_stage='VECTOR', updated_at=NOW()
          WHERE id=$2`,
        [due, orderId]
      );
      await client.query(
        `INSERT INTO order_email_threads
          (order_id, gmail_thread_id, thread_type, participant_email, subject)
         VALUES ($1,$2,'VECTOR',$3,$4)
         ON CONFLICT (order_id, gmail_thread_id)
         DO UPDATE SET participant_email=EXCLUDED.participant_email,
                       subject=EXCLUDED.subject,
                       updated_at=NOW()`,
        [orderId, sent.threadId, vectorEmail, subject]
      );
      await client.query(
        `INSERT INTO order_events (order_id,event_type,actor,notes)
         VALUES ($1,'SENT_TO_VECTOR',$2,$3)`,
        [orderId, actor, `Email sent to ${vectorEmail}. Gmail message ${sent.id}. ${instructions ? 'Instructions: ' + instructions : 'No additional instructions.'}`]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    return json({
      ok: true,
      recipient: vectorEmail,
      messageId: sent.id,
      threadId: sent.threadId,
      subject
    });
  } catch (error: any) {
    console.error('Send to Vector failed', error);
    return json({ error: error?.message || 'Could not send to Vector.' }, { status: 500 });
  }
};

export const config: Config = { path: '/api/gmail/send-vector' };
