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
          processLine(JSON.parse(buffer))
        }
        return
      }

      buffer += decoder.decode(value, { stream: true })
      // Splitting by \r?\n perfectly handles cross-platform newline characters
      const parts = buffer.split(/\r?\n/)
      buffer = parts.pop() ?? ""

      for (const part of parts.filter(Boolean)) {
        processLine(JSON.parse(part) as T)
      }

      return loop()
    })

  return loop()
}
