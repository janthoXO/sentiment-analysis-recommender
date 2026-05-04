import { z } from "zod"

export default z.object({ "stock": z.any(), "sources": z.array(z.intersection(z.any(), z.object({ "score": z.number().gte(-1).lte(1) }))), "score": z.number().gte(-1).lte(1) })
