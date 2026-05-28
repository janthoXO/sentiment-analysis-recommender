export const readStream = <T extends object>(
  response: Response & { json(): Promise<T> },
  processLine: (value: T) => void
): Promise<void> => {
  if (!response.body) return Promise.resolve()

  const stream = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  const loop = (): Promise<void> =>
    stream.read().then(({ done, value }) => {
      if (done) {
        if (buffer.trim().length > 0) {
          try {
            processLine(JSON.parse(buffer))
          } catch {
            console.warn("Failed to parse final NDJSON chunk; skipping")
          }
        }
        return
      }

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split(/\r?\n/)
      buffer = parts.pop() ?? ""

      for (const part of parts.filter(Boolean)) {
        try {
          processLine(JSON.parse(part) as T)
        } catch {
          console.warn("Failed to parse NDJSON line; skipping:", part)
        }
      }

      return loop()
    })

  return loop()
}
