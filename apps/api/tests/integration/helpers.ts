import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request, { type Response } from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type Config } from '../../src/config/env';

export const PASSWORD = 'correcthorse1';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://unused-in-tests',
    ACCESS_TOKEN_SECRET: 'test-access-secret-0123456789abcdef-0123',
    COOKIE_SECRET: 'test-cookie-secret-0123456789abcdef-45678',
    RATE_LIMIT_ENABLED: 'false',
    DASHBOARD_CACHE_TTL_SECONDS: '0',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export function buildApp(overrides: Record<string, string> = {}, redis?: Redis): Express {
  return createApp({ config: testConfig(overrides), redis });
}

/** A browser-like client: cookie jar plus the CSRF header on state-changing calls. */
export class Client {
  readonly agent: ReturnType<typeof request.agent>;
  csrf = '';

  constructor(app: Express) {
    this.agent = request.agent(app);
  }

  async init(): Promise<this> {
    const res = await this.agent.get('/api/v1/auth/csrf').expect(200);
    this.csrf = res.body.data.csrfToken;
    return this;
  }

  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body?: object) {
    const r = this.agent.post(url).set('x-csrf-token', this.csrf);
    return body === undefined ? r : r.send(body);
  }
  patch(url: string, body?: object) {
    const r = this.agent.patch(url).set('x-csrf-token', this.csrf);
    return body === undefined ? r : r.send(body);
  }
  delete(url: string, body?: object) {
    const r = this.agent.delete(url).set('x-csrf-token', this.csrf);
    return body === undefined ? r : r.send(body);
  }
}

let seq = 0;
export function uniqueEmail(prefix = 'user'): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}@example.test`;
}

export async function signUp(app: Express, name = 'Test User') {
  const client = await new Client(app).init();
  const email = uniqueEmail();
  const res = await client.post('/api/v1/auth/register', { name, email, password: PASSWORD });
  expect(res.status).toBe(201);
  return { client, email, user: res.body.data.user as { id: string; email: string }, res };
}

export function setCookies(res: Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
}

export function cookie(res: Response, name: string): string | undefined {
  return setCookies(res).find((c) => c.startsWith(`${name}=`));
}

export function cookieValue(res: Response, name: string): string | undefined {
  return cookie(res, name)
    ?.split(';')[0]
    ?.slice(name.length + 1);
}

export async function createTask(client: Client, body: Record<string, unknown>) {
  const res = await client.post('/api/v1/tasks', body);
  expect(res.status).toBe(201);
  return res.body.data as { id: string; version: number; [k: string]: unknown };
}
