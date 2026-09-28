import type { Config, Context } from '@netlify/functions';

const redirect = (url: string, headers: Record<string,string> = {}) =>
  new Response(null, { status: 302, headers: { location: url, ...headers } });

export default async (_req: Request, _context: Context) => {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    const missing = [
      !clientId ? 'GMAIL_CLIENT_ID' : null,
      !redirectUri ? 'GMAIL_REDIRECT_URI' : null
    ].filter(Boolean).join(', ');
    return new Response(`Gmail OAuth is not configured yet. Missing: ${missing}`, { status: 503 });
  }

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly'
    ].join(' ')
  });

  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, {
    'set-cookie': `rk_gmail_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  });
};

export const config: Config = { path: '/api/gmail/connect' };
