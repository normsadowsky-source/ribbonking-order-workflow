import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const appUrl = 'https://ribbonking-order-workflow.netlify.app/';

function cookieValue(req: Request, name: string) {
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

const redirect = (url: string) => new Response(null, {
  status: 302,
  headers: {
    location: url,
    'set-cookie': 'rk_gmail_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
  }
});

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const expectedState = cookieValue(req, 'rk_gmail_oauth_state');

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    return redirect(appUrl + '?gmail=error&reason=state');
  }

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return redirect(appUrl + '?gmail=error&reason=config');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });

  const tokens = await tokenRes.json() as any;
  if (!tokenRes.ok || !tokens.access_token) {
    console.error('Gmail token exchange failed', tokens);
    return redirect(appUrl + '?gmail=error&reason=token');
  }

  const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { authorization: `Bearer ${tokens.access_token}` }
  });
  const profile = await profileRes.json() as any;

  if (!profileRes.ok || !profile.emailAddress) {
    console.error('Gmail profile lookup failed', profile);
    return redirect(appUrl + '?gmail=error&reason=profile');
  }

  const expectedEmail = process.env.GMAIL_ACCOUNT_EMAIL?.trim().toLowerCase();
  const connectedEmail = String(profile.emailAddress).trim().toLowerCase();

  if (expectedEmail && connectedEmail !== expectedEmail) {
    return redirect(appUrl + '?gmail=error&reason=wrong_account');
  }

  if (!tokens.refresh_token) {
    return redirect(appUrl + '?gmail=error&reason=no_refresh_token');
  }

  const store = getStore('gmail-oauth');
  await store.setJSON('connection', {
    email: profile.emailAddress,
    refreshToken: tokens.refresh_token,
    scope: tokens.scope || null,
    connectedAt: new Date().toISOString()
  });

  return redirect(appUrl + '?gmail=connected');
};

export const config: Config = { path: '/api/gmail/callback' };
