import type { Request, Response, NextFunction } from "express";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }

  static badRequest(code: string, message: string): HttpError {
    return new HttpError(400, code, message);
  }

  static unauthorized(message = "Unauthorized"): HttpError {
    return new HttpError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "Forbidden"): HttpError {
    return new HttpError(403, "FORBIDDEN", message);
  }

  static notFound(code: string, message: string): HttpError {
    return new HttpError(404, code, message);
  }

  static upstreamUnavailable(message: string, cause?: unknown): HttpError {
    return new HttpError(503, "UPSTREAM_UNAVAILABLE", message, cause);
  }

  static internal(cause?: unknown): HttpError {
    return new HttpError(500, "INTERNAL", "Internal server error", cause);
  }
}

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;

export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Runs fn(), mapping thrown errors to typed HttpErrors.
 * Network/rate-limit/upstream failures → 503 UPSTREAM_UNAVAILABLE.
 * Unexpected errors → re-thrown as-is (caught by errorHandler as 500).
 */
export async function wrapUpstream<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    // Classify as upstream failure when the error looks like a network/HTTP problem
    const isUpstream =
      msg.includes("fetch") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("ENOTFOUND") ||
      msg.includes("timeout") ||
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("503") ||
      msg.includes("502") ||
      msg.includes("504");
    if (isUpstream) {
      throw HttpError.upstreamUnavailable(`${label} unavailable`, e);
    }
    throw e;
  }
}

/** Sanitize an unknown error into a safe user-facing message string. */
export function sanitizeError(e: unknown, fallback: string): string {
  if (e instanceof HttpError) return e.message;
  if (e instanceof Error) {
    const msg = e.message;
    // Redact anything that looks like a key or token
    if (
      msg.includes("token=") ||
      msg.includes("api_key") ||
      msg.includes("apikey") ||
      msg.includes("secret") ||
      msg.length > 300
    ) {
      return fallback;
    }
    return msg;
  }
  return fallback;
}

/** Extract a machine-readable code from an unknown error. */
export function errorCode(e: unknown): string {
  if (e instanceof HttpError) return e.code;
  return "INTERNAL";
}
