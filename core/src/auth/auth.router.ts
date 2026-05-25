import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";
import { db } from "../postgres.repo.js";
import { usersSchema } from "./auth.schema.js";
import { listsSchema } from "../03watchlist/watchlist.schema.js";

export const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_dev_only";

export const authRouter = Router();

authRouter.post("/register", async (req, res): Promise<void> => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    await db.insert(usersSchema).values({
      id: userId,
      username,
      passwordHash,
    });

    const now = Math.floor(Date.now() / 1000);
    await db.insert(listsSchema).values([
      { id: uuidv4(), userId, name: "Watchlist", createdAtSec: now },
      { id: uuidv4(), userId, name: "Portfolio", createdAtSec: now + 1 },
    ]);

    const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505') { // Postgres unique_violation
      res.status(400).json({ error: "Username already taken" });
      return;
    }
    console.error("Register error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

authRouter.post("/login", async (req, res): Promise<void> => {
  try {
    const { username, password } = req.body;
    
    const user = await db.query.usersSchema.findFirst({
      where: eq(usersSchema.username, username),
    });

    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    username: string;
  };
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Allow passing token via query param (useful for SSE EventSource) or Authorization header
  const authHeader = req.headers.authorization;
  let token = authHeader?.split(" ")[1];

  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string, username: string };
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}


