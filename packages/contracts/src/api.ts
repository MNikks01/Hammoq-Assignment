/**
 * Response envelopes and error codes shared by the API and the web client.
 *
 * Success:  { data: T, meta?: PaginationMeta }
 * Failure:  { error: { code, message, requestId, details? } }
 */

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CSRF_INVALID',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'OVERLOADED',
  'TIMEOUT',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: ValidationIssue[];
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiPage<T> {
  data: T[];
  meta: PaginationMeta;
}

/** Header the browser must echo from the readable csrf cookie on state-changing requests. */
export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_COOKIE = 'tm_csrf';
