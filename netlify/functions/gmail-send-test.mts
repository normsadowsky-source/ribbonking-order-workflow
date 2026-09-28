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

  if (!clientId || !clientSecret) {
    throw new Error('Gmail OAuth credentials are not configured.');
  }

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
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const store = getStore('gmail-oauth');
    const connection = await store.get('connection', { type: 'json' }) as any;

    if (!connection?.refreshToken || !connection?.email) {
      return json({ error: 'Gmail is not connected.' }, { status: 409 });
    }

    const accessToken = await getAccessToken(connection.refreshToken);
    const subject = 'Ribbon King Workflow Gmail Test';
    const body = [
      'Gmail integration test successful.',
      '',
      'This message was sent by the Ribbon King Order Workflow app.',
      `Connected account: ${connection.email}`,
      `Sent: ${new Date().toISOString()}`
    ].join('\r\n');

    const rawMessage = [
      `From: Ribbon King <${connection.email}>`,
      `To: ${connection.email}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body
    ].join('\r\n');

    const raw = Buffer.from(rawMessage, 'utf8').toString('base64url');

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ raw })
    });

    const sent = await sendRes.json() as any;
    if (!sendRes.ok) {
      console.error('Gmail send test failed', sent);
      return json({ error: sent?.error?.message || 'Gmail test send failed.' }, { status: 502 });
    }

    return json({
      ok: true,
      email: connection.email,
      messageId: sent.id || null,
      threadId: sent.threadId || null
    });
  } catch (error: any) {
    console.error('Gmail test failed', error);
    return json({ error: error?.message || 'Gmail test failed.' }, { status: 500 });
  }
};

export const config: Config = { path: '/api/gmail/send-test' };
