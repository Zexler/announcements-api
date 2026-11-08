import type { RequestHandler } from "express";
import bcrypt from "bcrypt";
import prisma from "../../prisma/client.ts";
import { createTokens, verifyToken } from "../tokens.ts";
import { userFields } from "../user-fields.ts";
import logger from "../logger.ts";

export const register: RequestHandler = async (_req, res) => {
  const { username, email, password, name } = res.locals.body;
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
  });
  if (existing) {
    res.status(409).json({ error: "Username or email already taken" });
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { username, email, password: hash, name },
      select: userFields,
    });
    const tokens = createTokens(user.id);
    await tx.refreshToken.create({
      data: { userId: user.id, token: tokens.refreshToken },
    });
    return { user, ...tokens };
  });
  logger.info({ userId: result.user.id }, "Користувача зареєстровано");
  res.status(201).json(result);
};

export const login: RequestHandler = async (_req, res) => {
  const { username, password } = res.locals.body;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const tokens = createTokens(user.id);
  await prisma.refreshToken.upsert({
    where: { userId: user.id },
    create: { userId: user.id, token: tokens.refreshToken },
    update: { token: tokens.refreshToken },
  });
  logger.info({ userId: user.id }, "Користувач увійшов");
  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
    },
    ...tokens,
  });
};

export const refresh: RequestHandler = async (_req, res) => {
  const { refreshToken } = res.locals.body;
  let userId: number;
  try {
    userId = verifyToken(refreshToken, "refresh").sub;
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const tokens = createTokens(userId);
  const rotated = await prisma.refreshToken.updateMany({
    where: { token: refreshToken, userId },
    data: { token: tokens.refreshToken },
  });
  if (rotated.count === 0) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(tokens);
};

export const logout: RequestHandler = async (req, res) => {
  await prisma.refreshToken.deleteMany({ where: { userId: req.user!.sub } });
  res.status(204).end();
};

export const me: RequestHandler = async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { ...userFields, createdAt: true },
  });
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(user);
};
