import type { RequestHandler } from "express";
import { verifyToken } from "../tokens.ts";

declare global {
  namespace Express {
    interface Request {
      user?: { sub: number };
    }
  }
}

export const authenticate: RequestHandler = (req, res, next) => {
  const match = req.headers.authorization?.match(/^Bearer (\S+)$/i);
  if (!match) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    req.user = verifyToken(match[1], "access");
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};
