export async function* readNdjson<T>(
  stream: Response,
  signal: AbortSignal
): AsyncGenerator<T> {
  if (!stream.body) return
  const reader = stream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) {
        if (buffer.trim()) {
          try {
            yield JSON.parse(buffer) as T
          } catch {
            console.warn("Failed to parse final NDJSON chunk; skipping")
          }
        }
        return
      }
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split(/\r?\n/)
      buffer = parts.pop() ?? ""
      for (const part of parts) {
        if (!part.trim() || signal.aborted) continue
        try {
          yield JSON.parse(part) as T
        } catch {
          console.warn("Failed to parse NDJSON line; skipping:", part)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
