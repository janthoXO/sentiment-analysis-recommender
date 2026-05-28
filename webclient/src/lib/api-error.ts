import { toast } from "sonner"

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

const NOISE_PATTERNS = [
  /NetworkError when attempting to fetch resource\./i,
  /Failed to fetch/i,
  /Load failed/i,
  /net::ERR_/i,
]

export function sanitize(
  e: unknown,
  fallback = "Something went wrong"
): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof DOMException && e.name === "AbortError") return ""
  if (e instanceof Error) {
    const msg = e.message
    if (!msg || msg.length > 200) return fallback
    for (const pattern of NOISE_PATTERNS) {
      if (pattern.test(msg)) return "Network error — check your connection"
    }
    return msg
  }
  return fallback
}

export function toastApiError(
  title: string,
  e: unknown,
  fallback?: string
): void {
  const description = sanitize(e, fallback)
  if (!description) return
  toast.error(title, { description })
}

/** Asserts res.status === 200 for JSON responses; toasts and throws ApiError otherwise. */
export function assertOk<T>(
  res: { status: number; data: unknown },
  title: string
): T {
  if (res.status === 200) return res.data as T

  const data = res.data as Record<string, unknown> | null | undefined
  const message =
    (typeof data?.["error"] === "string" ? data["error"] : null) ??
    "Request failed"
  const code =
    (typeof data?.["code"] === "string" ? data["code"] : null) ?? "UNKNOWN"

  toast.error(title, { description: message })
  throw new ApiError(res.status, code, message)
}

/**
 * Checks status on a streaming (NDJSON) response which has no `data` field.
 * Toasts and throws ApiError if status !== 200.
 */
export function assertStreamOk(
  res: { status: number; data?: unknown },
  title: string
): void {
  if (res.status === 200) return

  const data = res.data as Record<string, unknown> | null | undefined
  const message =
    (typeof data?.["error"] === "string" ? data["error"] : null) ??
    "Request failed"
  const code =
    (typeof data?.["code"] === "string" ? data["code"] : null) ?? "UNKNOWN"

  toast.error(title, { description: message })
  throw new ApiError(res.status, code, message)
}
