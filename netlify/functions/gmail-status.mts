import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) }
  });

export default async (_req: Request, _context: Context) => {
  try {
    const store = getStore('gmail-oauth');
    const connection = await store.get('connection', { type: 'json' }) as any;

    return json({
      configured: Boolean(Netlify.env.get('GMAIL_CLIENT_ID') && Netlify.env.get('GMAIL_CLIENT_SECRET') && Netlify.env.get('GMAIL_REDIRECT_URI')),
      connected: Boolean(connection?.refreshToken),
      email: connection?.email || null,
      connectedAt: connection?.connectedAt || null
    });
  } catch (error) {
    console.error('Gmail status failed', error);
    return json({
      configured: Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REDIRECT_URI),
      connected: false,
      email: null
    });
  }
};

export const config: Config = { path: '/api/gmail/status' };
