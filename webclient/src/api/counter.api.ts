import { CounterDTOSchema, type CounterDTO } from "./dto/counter.dto"

export function fetchCounter(): Promise<CounterDTO> {
  return fetch("/api/counter")
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch counter: ${response.statusText}`)
      }
      return response.json()
    })
    .then((data) => {
      // Validate the response data using the CounterDTO schema
      const parsedData = CounterDTOSchema.safeParse(data)
      if (!parsedData.success) {
        throw new Error(`Invalid counter data: ${parsedData.error.message}`)
      }
      return parsedData.data
    })
}
