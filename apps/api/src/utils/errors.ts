import type { ErrorCode, ValidationIssue } from '@taskmanager/contracts';

/** An error whose message is safe to show to API clients. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ValidationIssue[],
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthenticated: (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message),
  invalidCredentials: () => new AppError(401, 'UNAUTHENTICATED', 'Invalid email or password'),
  csrf: () => new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token'),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  versionConflict: () =>
    new AppError(409, 'VERSION_CONFLICT', 'This task was changed elsewhere. Reload it and try again.'),
  unsupportedMediaType: () =>
    new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request body must be application/json'),
  overloaded: () =>
    new AppError(503, 'OVERLOADED', 'Server is busy. Please retry shortly.', undefined, {
      'Retry-After': '1',
    }),
  timeout: () =>
    new AppError(503, 'TIMEOUT', 'The request took too long to process', undefined, { 'Retry-After': '2' }),
  unavailable: () =>
    new AppError(503, 'SERVICE_UNAVAILABLE', 'A required service is unavailable', undefined, {
      'Retry-After': '5',
    }),
};
