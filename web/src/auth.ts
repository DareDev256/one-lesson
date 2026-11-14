import { createAuth0Client, type Auth0Client } from '@auth0/auth0-spa-js';

let client: Auth0Client | null = null;
let cfgPromise: Promise<{ auth0Domain: string | null; auth0ClientId: string | null }> | null = null;

export const config = () => (cfgPromise ??= fetch('/api/config').then((r) => r.json()));

/** Auth0 when the server is configured for it; null otherwise (typed names, marked unverified). */
export async function auth(): Promise<Auth0Client | null> {
  if (client) return client;
  const c = await config();
  if (!c.auth0Domain || !c.auth0ClientId) return null;
  client = await createAuth0Client({
    domain: c.auth0Domain,
    clientId: c.auth0ClientId,
    authorizationParams: { redirect_uri: location.origin + location.pathname, scope: 'openid profile' },
    cacheLocation: 'localstorage',
    useRefreshTokens: true,
  });
  if (location.search.includes('code=') && location.search.includes('state=')) {
    await client.handleRedirectCallback().catch(() => {});
    history.replaceState({}, '', location.pathname);
  }
  return client;
}

export async function whoami() {
  const a = await auth();
  if (!a || !(await a.isAuthenticated())) return null;
  const claims = await a.getIdTokenClaims();
  return claims ? { name: String(claims.name ?? claims.nickname ?? 'teacher'), sub: String(claims.sub), token: claims.__raw } : null;
}
