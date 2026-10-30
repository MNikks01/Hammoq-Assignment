import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Request, RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../observability/logger';
import { httpRequestDuration } from '../observability/metrics';

const INCOMING_ID = /^[A-Za-z0-9._-]{8,64}$/;
const QUIET_PATHS = new Set(['/health/live', '/health/ready', '/metrics']);

/** Low-cardinality route label: the matched route template, never the raw URL. */
export function routeLabel(req: Request, status: number): string {
  if (req.route?.path) return `${req.baseUrl}${String(req.route.path)}`;
  if (status === 404) return 'unmatched';
  return req.baseUrl ? `${req.baseUrl}/*` : 'middleware';
}

function pathOnly(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
}

export function httpLogger(): RequestHandler {
  const pinoMiddleware = pinoHttp({
    logger,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && INCOMING_ID.test(incoming) ? incoming : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    autoLogging: { ignore: (req) => QUIET_PATHS.has(pathOnly(req.url)) },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info'),
    // Log the path without the query string (search terms can be personal data).
    serializers: {
      req: (req: { id: unknown; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        path: pathOnly(req.url),
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customProps: (req) => {
      const auth = (req as Request).auth;
      return auth ? { userId: auth.userId } : {};
    },
  });

  return (req, res, next) => {
    const end = httpRequestDuration.startTimer();
    res.once('finish', () => {
      end({ method: req.method, route: routeLabel(req, res.statusCode), status: String(res.statusCode) });
    });
    pinoMiddleware(req, res, next);
  };
}
