import "dotenv/config";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET ?? "";
if (!secret || secret.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters");
}

export function createTokens(userId: number) {
  return {
    accessToken: jwt.sign({ sub: userId, type: "access" }, secret, {
      algorithm: "HS256",
      expiresIn: "15m",
      jwtid: randomUUID(),
    }),
    refreshToken: jwt.sign({ sub: userId, type: "refresh" }, secret, {
      algorithm: "HS256",
      expiresIn: "7d",
      jwtid: randomUUID(),
    }),
  };
}

export function verifyToken(token: string, type: "access" | "refresh") {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  if (
    typeof payload === "string" ||
    payload.type !== type ||
    !Number.isInteger(payload.sub) ||
    Number(payload.sub) <= 0 ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Invalid token");
  }
  return { sub: Number(payload.sub) };
}
