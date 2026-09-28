import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) }
  });

async function getAccessToken(refreshToken: string) {
  const clientId = Netlify.env.get('GMAIL_CLIENT_ID')?.trim();
  const clientSecret = Netlify.env.get('GMAIL_CLIENT_SECRET')?.trim();
  if (!clientId || !clientSecret) throw new Error('Gmail OAuth credentials are not configured.');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const tokenData = await tokenRes.json() as any;
  if (!tokenRes.ok || !tokenData.access_token) {
    console.error('Gmail refresh failed', tokenData);
    throw new Error(tokenData?.error || 'Could not refresh Gmail access.');
  }
  return String(tokenData.access_token);
}

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const body = await req.json().catch(() => ({})) as any;
    const messageId = String(body?.messageId || '').trim();
    if (!messageId) return json({ error: 'messageId is required.' }, { status: 400 });

    const store = getStore('gmail-oauth');
    const connection = await store.get('connection', { type: 'json' }) as any;
    if (!connection?.refreshToken) return json({ error: 'Gmail is not connected.' }, { status: 409 });

    const scope = String(connection.scope || '');
    if (!scope.includes('https://www.googleapis.com/auth/gmail.modify')) {
      return json({ error: 'Gmail must be reauthorized with message modification permission.' }, { status: 403 });
    }

    const accessToken = await getAccessToken(connection.refreshToken);
    const modifyRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
    });

    const result = await modifyRes.json() as any;
    if (!modifyRes.ok) {
      console.error('Gmail mark-read failed', result);
      return json({ error: result?.error?.message || 'Could not mark Gmail message as read.' }, { status: 502 });
    }

    return json({ ok: true, messageId: result.id || messageId, labelIds: result.labelIds || [] });
  } catch (error: any) {
    console.error('Gmail mark-read failed', error);
    return json({ error: error?.message || 'Could not mark Gmail message as read.' }, { status: 500 });
  }
};

export const config: Config = { path: '/api/gmail/mark-read' };
