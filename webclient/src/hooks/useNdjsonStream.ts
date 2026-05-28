import { useState, useRef, useCallback } from "react"
import { readStream } from "@/lib/stream"
import { assertStreamOk, toastApiError } from "@/lib/api-error"

type StreamResponse = { status: number; stream: Response; headers: Headers }

/** Abort-aware NDJSON stream hook.
 *
 * `start` is called with an AbortSignal and must return the raw fetch response.
 * Each parsed line calls `onLine`. Errors are surfaced via `error` state and a toast.
 * Call `run(start, onLine)` to kick off a stream; calling it again aborts any in-flight request.
 */
export function useNdjsonStream() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(
    async <T extends object>(
      start: (signal: AbortSignal) => Promise<StreamResponse>,
      onLine: (line: T) => void,
      errorTitle = "Stream failed"
    ) => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl

      setLoading(true)
      setError(null)

      try {
        const res = await start(ctrl.signal)
        if (ctrl.signal.aborted) return

        assertStreamOk(res, errorTitle)

        await readStream(res.stream, (parsed) => {
          if (!ctrl.signal.aborted) onLine(parsed as T)
        })
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return
        const msg = e instanceof Error ? e.message : "Unknown error"
        setError(msg)
        toastApiError(errorTitle, e)
      } finally {
        if (abortRef.current === ctrl) {
          setLoading(false)
          abortRef.current = null
        }
      }
    },
    []
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  return { loading, error, run, abort }
}
