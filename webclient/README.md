# React + TypeScript + Vite + shadcn/ui

This is a template for a new Vite project with React, TypeScript, and shadcn/ui.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `src/components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button"

## Generate Zod Schemas & Handlers

This project uses Zod for runtime validation. The recommended workflow below shows how to generate Zod schemas from the repository OpenAPI spec and how to use them in request handlers.

- Install runtime dependency:

```bash
pnpm add zod
```

- (Optional) Install generator tooling (dev dependencies) to convert OpenAPI -> Zod:

```bash
pnpm add -D openapi-to-zod openapi-typescript zod-to-ts
```

- Generate Zod schemas from the OpenAPI file (run from the `webclient` folder):

```bash
# uses the repo root contracts/openapi.yml
pnpm exec openapi-to-zod ../contracts/openapi.yml --output src/api/dto/openapi.schemas.ts
```

- Example: add a `gen:schemas` script to `webclient/package.json`:

```json
"scripts": {
	"gen:schemas": "openapi-to-zod ../contracts/openapi.yml --output src/api/dto/openapi.schemas.ts"
}
```

- Use generated Zod schemas in a handler (example):

```ts
// src/api/handlers/search.ts
import { type Request, type Response } from 'express'
import { searchQuerySchema } from '../dto/openapi.schemas'

export async function searchHandler(req: Request, res: Response) {
	const parsed = searchQuerySchema.safeParse(req.query)
	if (!parsed.success) return res.status(400).json({ error: parsed.error.errors })

	const query = parsed.data
	// TODO: call API / stream results / use fetch to core server
	res.json({ ok: true, query })
}
```

- Validation helpers: use `schema.parse(value)` to throw on invalid data, or `schema.safeParse(value)` to inspect errors without throwing.

- Verify workflow:

```bash
pnpm install
pnpm run gen:schemas    # generate/update Zod schemas
pnpm run dev            # start dev server (vite)
pnpm run build          # verify production build
pnpm run lint           # run lint checks
```

Notes:
- The `openapi-to-zod` CLI is one option — if you prefer other tools (or templates) there are packages that convert OpenAPI/JSON Schema to Zod. Adjust the commands above to the generator you choose.
- Generated schemas are plain Zod files: integrate them into your API layer and use `parse`/`safeParse` in request handlers.

If you want, I can also add a `gen:schemas` script to `webclient/package.json` and create a tiny example handler file. Tell me which you'd prefer.
```
