import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";
import type { Db } from "../utils/postgres.repo.js";
import { usersSchema } from "./auth.schema.js";
import { asyncHandler, HttpError } from "../middleware/httpError.js";

export const JWT_SECRET =
  process.env.JWT_SECRET || "fallback_secret_for_dev_only";

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    username: string;
  };
}

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  let token = authHeader?.split(" ")[1];

  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      username: string;
    };
    req.user = decoded;
    next();
  } catch {
    res
      .status(401)
      .json({ error: "Invalid or expired token", code: "UNAUTHORIZED" });
  }
}

export function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  let token = authHeader?.split(" ")[1];

  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as {
        userId: string;
        username: string;
      };
      req.user = decoded;
    } catch {
      // ignore invalid tokens — user stays unauthenticated
    }
  }

  next();
}

export function makeAuthRouter({
  db,
  createDefaultListsForUser,
}: {
  db: Db;
  createDefaultListsForUser: (userId: string) => Promise<void>;
}) {
  const authRouter = Router();

  authRouter.post(
    "/register",
    asyncHandler(async (req, res): Promise<void> => {
      const { username, password } = req.body;
      if (!username || !password) {
        throw HttpError.badRequest(
          "MISSING_CREDENTIALS",
          "Username and password required"
        );
      }

      try {
        const passwordHash = await bcrypt.hash(password, 10);
        const userId = uuidv4();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
          .insert(usersSchema)
          .values({ id: userId, username, passwordHash });

        await createDefaultListsForUser(userId);

        const token = jwt.sign({ userId, username }, JWT_SECRET, {
          expiresIn: "7d",
        });
        res.json({ token });
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code: string }).code === "23505"
        ) {
          throw HttpError.badRequest(
            "USERNAME_TAKEN",
            "Username already taken"
          );
        }
        throw error;
      }
    })
  );

  authRouter.post(
    "/login",
    asyncHandler(async (req, res): Promise<void> => {
      const { username, password } = req.body;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = await (db as any).query.usersSchema.findFirst({
        where: eq(usersSchema.username, username),
      });

      if (!user) {
        throw HttpError.unauthorized("Invalid credentials");
      }

      const isValid = await bcrypt.compare(
        password,
        (user as { passwordHash: string }).passwordHash
      );
      if (!isValid) {
        throw HttpError.unauthorized("Invalid credentials");
      }

      const token = jwt.sign(
        {
          userId: (user as { id: string }).id,
          username: (user as { username: string }).username,
        },
        JWT_SECRET,
        { expiresIn: "7d" }
      );
      res.json({ token });
    })
  );

  return authRouter;
}
