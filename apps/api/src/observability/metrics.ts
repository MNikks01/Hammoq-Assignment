import client from 'prom-client';

/**
 * Prometheus metrics. Labels are deliberately low-cardinality: route templates
 * (never raw URLs), status codes, and fixed enums. No user or task IDs.
 */
export const registry = new client.Registry();
registry.setDefaultLabels({ service: 'task-api' });
client.collectDefaultMetrics({ register: registry, eventLoopMonitoringPrecision: 20 });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Requests currently being processed',
  registers: [registry],
});

export const loadShedTotal = new client.Counter({
  name: 'http_load_shed_total',
  help: 'Requests rejected by backpressure controls',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const rateLimitRejections = new client.Counter({
  name: 'rate_limit_rejections_total',
  help: 'Requests rejected by a rate limiter',
  labelNames: ['limiter'] as const,
  registers: [registry],
});

export const rateLimitStoreFallback = new client.Counter({
  name: 'rate_limit_store_fallback_total',
  help: 'Rate-limit increments served by the per-instance fallback store because Redis was unavailable',
  registers: [registry],
});

export const cacheOps = new client.Counter({
  name: 'cache_operations_total',
  help: 'Application cache operations',
  labelNames: ['cache', 'result'] as const, // hit | miss | error | bypass | invalidate
  registers: [registry],
});

export const redisLatency = new client.Histogram({
  name: 'redis_command_duration_seconds',
  help: 'Latency of application Redis calls',
  labelNames: ['op'] as const,
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
  registers: [registry],
});

export const mongoCommandDuration = new client.Histogram({
  name: 'mongodb_command_duration_seconds',
  help: 'MongoDB command latency observed by the driver',
  labelNames: ['command', 'outcome'] as const,
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5],
  registers: [registry],
});

export const mongoPoolCheckedOut = new client.Gauge({
  name: 'mongodb_pool_connections_checked_out',
  help: 'Connections currently checked out of the MongoDB pool',
  registers: [registry],
});

export const mongoPoolCheckoutFailures = new client.Counter({
  name: 'mongodb_pool_checkout_failures_total',
  help: 'Failed attempts to check out a pooled connection',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const authEvents = new client.Counter({
  name: 'auth_events_total',
  help: 'Authentication outcomes',
  labelNames: ['event'] as const, // login_success | login_failure | refresh | refresh_reuse | logout | register
  registers: [registry],
});
