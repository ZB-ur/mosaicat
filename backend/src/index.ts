import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './auth.js';
import { verifyUserToken, getUserInstallations, createInstallationToken } from './auth.js';

type Bindings = Env;

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors());

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

/**
 * GET /auth/installations
 * Returns the user's GitHub App installations and their repos.
 */
app.get('/auth/installations', async (c) => {
  const userToken = extractBearer(c.req.header('Authorization'));
  if (!userToken) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  try {
    await verifyUserToken(userToken);
  } catch {
    return c.json({ error: 'Invalid or expired token. Run `mosaicat login` again.' }, 401);
  }

  try {
    const installations = await getUserInstallations(userToken, c.env);
    return c.json(installations);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /auth/token
 * Exchange an installation ID for an installation access token.
 * Body: { installation_id: number }
 */
app.post('/auth/token', async (c) => {
  const userToken = extractBearer(c.req.header('Authorization'));
  if (!userToken) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  try {
    await verifyUserToken(userToken);
  } catch {
    return c.json({ error: 'Invalid or expired token. Run `mosaicat login` again.' }, 401);
  }

  const body = await c.req.json<{ installation_id?: number }>().catch(() => ({}));
  if (!body.installation_id || typeof body.installation_id !== 'number') {
    return c.json({ error: 'Missing or invalid installation_id' }, 400);
  }

  try {
    const result = await createInstallationToken(body.installation_id, c.env);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('Not Found') || message.includes('404')) {
      return c.json({ error: 'Installation not found. Is the GitHub App installed?' }, 404);
    }
    return c.json({ error: message }, 500);
  }
});

/**
 * Health check
 */
app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
