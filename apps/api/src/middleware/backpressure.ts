import type { NextFunction, Request, Response } from 'express';
import { httpInFlight, loadShedTotal } from '../observability/metrics';
import { Errors } from '../utils/errors';
import { sendError } from './error-handler';

/**
 * Per-instance concurrency cap. When the instance is saturated it answers 503 +
 * Retry-After immediately instead of queueing work it cannot finish in time;
 * the load balancer can route the retry to a healthier instance.
 */
export function inFlightLimiter(max: number) {
  let inFlight = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    if (inFlight >= max) {
      loadShedTotal.inc({ reason: 'in_flight' });
      return sendError(req, res, Errors.overloaded());
    }
    inFlight++;
    httpInFlight.inc();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlight--;
      httpInFlight.dec();
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}

/**
 * Request deadline. If the handler has not responded in time the client gets a
 * 503 TIMEOUT; database work is independently bounded by maxTimeMS so abandoned
 * queries do not keep running indefinitely.
 */
export function requestDeadline(ms: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (res.headersSent) return;
      loadShedTotal.inc({ reason: 'deadline' });
      sendError(req, res, Errors.timeout());
    }, ms);
    timer.unref();
    const clear = () => clearTimeout(timer);
    res.once('finish', clear);
    res.once('close', clear);
    next();
  };
}
