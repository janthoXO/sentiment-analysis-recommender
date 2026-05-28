import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { HttpError } from "./httpError.js";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    if (err.status >= 500) console.error(err.cause ?? err);
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }

  if (err instanceof ZodError) {
    res
      .status(400)
      .json({ error: "Invalid request", code: "VALIDATION_FAILED" });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error", code: "INTERNAL" });
}
