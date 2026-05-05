import z from "zod"

export const CounterDTOSchema = z.object({
  amount: z.number().int().min(0),
})

export type CounterDTO = z.infer<typeof CounterDTOSchema>
