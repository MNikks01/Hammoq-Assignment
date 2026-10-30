import { SignJWT } from 'jose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Session } from '../../src/modules/auth/session.model';
import { User } from '../../src/modules/users/user.model';
import { sha256 } from '../../src/utils/crypto';
import { buildApp, Client, cookie, cookieValue, PASSWORD, signUp, testConfig, uniqueEmail } from './helpers';

const app = buildApp();

describe('registration', () => {
  it('creates the user, sets HttpOnly session cookies and never returns the hash', async () => {
    const { res, email } = await signUp(app, 'Ada');
    expect(res.body.data.user).toMatchObject({ name: 'Ada', email });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const at = cookie(res, 'tm_at')!;
    const rt = cookie(res, 'tm_rt')!;
    expect(at).toMatch(/HttpOnly/);
    expect(at).toMatch(/SameSite=Lax/);
    expect(rt).toMatch(/HttpOnly/);
    expect(rt).toMatch(/SameSite=Strict/);
    expect(rt).toMatch(/Path=\/api\/v1\/auth/);

    const stored = await User.findOne({ email }).select('+passwordHash').lean();
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('enforces unique emails case-insensitively via the database index', async () => {
    const email = uniqueEmail('dup');
    const c1 = await new Client(app).init();
    await c1.post('/api/v1/auth/register', { name: 'A', email, password: PASSWORD }).expect(201);
    const c2 = await new Client(app).init();
    const res = await c2.post('/api/v1/auth/register', {
      name: 'B',
      email: email.toUpperCase(),
      password: PASSWORD,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(JSON.stringify(res.body)).not.toMatch(/E11000|duplicate key|index/i);
  });

  it('rejects weak passwords with field-level details', async () => {
    const c = await new Client(app).init();
    const res = await c.post('/api/v1/auth/register', { name: 'A', email: uniqueEmail(), password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('password');
  });
});

describe('login', () => {
  it('returns the same generic error for unknown email and wrong password', async () => {
    const { email } = await signUp(app);
    const c = await new Client(app).init();
    const wrongPw = await c.post('/api/v1/auth/login', { email, password: 'wrongpassword1' });
    const unknown = await c.post('/api/v1/auth/login', {
      email: uniqueEmail('nobody'),
      password: 'wrongpassword1',
    });
    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPw.body.error.message).toBe(unknown.body.error.message);
    expect(wrongPw.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logs in with a differently-cased email and grants access to /me', async () => {
    const { email } = await signUp(app);
    const c = await new Client(app).init();
    await c.post('/api/v1/auth/login', { email: email.toUpperCase(), password: PASSWORD }).expect(200);
    const me = await c.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.user.email).toBe(email);
  });
});

describe('access token validation', () => {
  it('rejects missing, malformed, tampered and expired tokens', async () => {
    await request(app).get('/api/v1/auth/me').expect(401);
    await request(app).get('/api/v1/auth/me').set('Cookie', 'tm_at=not-a-jwt').expect(401);

    const { res } = await signUp(app);
    const token = cookieValue(res, 'tm_at')!;
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
    await request(app).get('/api/v1/auth/me').set('Cookie', `tm_at=${tampered}`).expect(401);

    const key = new TextEncoder().encode(testConfig().ACCESS_TOKEN_SECRET);
    const expired = await new SignJWT({ sid: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('a'.repeat(24))
      .setIssuer('task-api')
      .setAudience('task-web')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    const r = await request(app).get('/api/v1/auth/me').set('Cookie', `tm_at=${expired}`);
    expect(r.status).toBe(401);

    const wrongKey = await new SignJWT({ sid: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('a'.repeat(24))
      .setIssuer('task-api')
      .setAudience('task-web')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('another-secret-another-secret-another-secret'));
    await request(app).get('/api/v1/auth/me').set('Cookie', `tm_at=${wrongKey}`).expect(401);
  });
});

describe('refresh token rotation', () => {
  it('rotates on refresh and revokes the whole family when a rotated token is replayed', async () => {
    const { client, res } = await signUp(app);
    const rt1 = cookieValue(res, 'tm_rt')!;

    const r1 = await client.post('/api/v1/auth/refresh').expect(200);
    const rt2 = cookieValue(r1, 'tm_rt')!;
    expect(rt2).toBeTruthy();
    expect(rt2).not.toBe(rt1);

    const replay = () =>
      request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`tm_rt=${rt1}`, `tm_csrf=${client.csrf}`])
        .set('x-csrf-token', client.csrf);

    // Within the grace window (e.g. two tabs racing) a replay fails but does not revoke.
    await replay().expect(401);
    await client.post('/api/v1/auth/refresh').expect(200);

    // Outside the grace window a replay is treated as theft.
    await Session.updateOne(
      { tokenHash: sha256(rt1) },
      { $set: { replacedAt: new Date(Date.now() - 60_000) } },
    );
    await replay().expect(401);
    const after = await client.post('/api/v1/auth/refresh');
    expect(after.status).toBe(401);
    // The failed refresh clears cookies so the browser stops presenting them.
    expect(cookie(after, 'tm_rt')).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('rejects expired refresh sessions', async () => {
    const { client, res } = await signUp(app);
    await Session.updateOne(
      { tokenHash: sha256(cookieValue(res, 'tm_rt')!) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await client.post('/api/v1/auth/refresh').expect(401);
  });
});

describe('logout', () => {
  it('clears cookies and revokes the refresh token server-side', async () => {
    const { client, res } = await signUp(app);
    const rt = cookieValue(res, 'tm_rt')!;
    const out = await client.post('/api/v1/auth/logout').expect(204);
    expect(cookie(out, 'tm_at')).toMatch(/Expires=Thu, 01 Jan 1970/);
    await client.get('/api/v1/auth/me').expect(401);

    const session = await Session.findOne({ tokenHash: sha256(rt) }).lean();
    expect(session?.revokedAt).toBeInstanceOf(Date);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`tm_rt=${rt}`, `tm_csrf=${client.csrf}`])
      .set('x-csrf-token', client.csrf)
      .expect(401);
  });
});

describe('change password', () => {
  it('requires the current password, then revokes other sessions', async () => {
    const { client, email } = await signUp(app);
    const other = await new Client(app).init();
    await other.post('/api/v1/auth/login', { email, password: PASSWORD }).expect(200);

    const bad = await client.post('/api/v1/auth/change-password', {
      currentPassword: 'wrongpassword1',
      newPassword: 'evenbetterpass2',
    });
    expect(bad.status).toBe(400);

    await client
      .post('/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: 'evenbetterpass2' })
      .expect(200);

    await other.post('/api/v1/auth/refresh').expect(401);
    await client.post('/api/v1/auth/refresh').expect(200);

    const fresh = await new Client(app).init();
    await fresh.post('/api/v1/auth/login', { email, password: PASSWORD }).expect(401);
    await fresh.post('/api/v1/auth/login', { email, password: 'evenbetterpass2' }).expect(200);
  });
});

describe('account deletion', () => {
  it('deletes the user, their tasks and sessions after re-authentication', async () => {
    const { client, user, email } = await signUp(app);
    await client.post('/api/v1/tasks', { title: 'to be deleted' }).expect(201);
    await client.delete('/api/v1/users/me', { password: 'wrong-password-1' }).expect(400);
    await client.delete('/api/v1/users/me', { password: PASSWORD }).expect(204);
    expect(await User.exists({ email })).toBeNull();
    expect(await Session.countDocuments({ userId: user.id })).toBe(0);
    await client.get('/api/v1/auth/me').expect(401);
  });
});
