export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  TURNSTILE_FAILED: 400,
  UNAUTHORIZED: 401,
  QUEUE_TOKEN_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_IN_QUEUE: 404,
  QUEUE_NOT_OPEN: 409,
  OUT_OF_STOCK: 409,
  LIMIT_EXCEEDED: 409,
  CONFLICT: 409,
  SOLD_OUT: 410,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.code = code;
    this.statusCode = ERROR_CODES[code];
    this.headers = headers;
  }
}
