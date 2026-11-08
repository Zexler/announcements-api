import type { RequestHandler } from "express";
import type { Prisma } from "../../generated/prisma/client.ts";
import prisma from "../../prisma/client.ts";
import { userFields } from "../user-fields.ts";
import logger from "../logger.ts";

const includeAuthor = { user: { select: userFields } };
const perPage = 10;

export const list: RequestHandler = async (_req, res) => {
  const { search, sort, page } = res.locals.query;
  const where: Prisma.AnnouncementWhereInput = search
    ? {
        title: {
          contains: search.replace(/[\\%_]/g, "\\$&"),
          mode: "insensitive",
        },
      }
    : {};
  const direction = sort === "oldest" ? "asc" : "desc";
  const [data, total] = await prisma.$transaction([
    prisma.announcement.findMany({
      where,
      include: includeAuthor,
      orderBy: [{ createdAt: direction }, { id: direction }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.announcement.count({ where }),
  ]);
  res.json({
    data,
    pagination: {
      total,
      page,
      totalPages: Math.ceil(total / perPage),
      perPage,
    },
  });
};

export const get: RequestHandler = async (_req, res) => {
  const announcement = await prisma.announcement.findUnique({
    where: { id: res.locals.params.id },
    include: includeAuthor,
  });
  if (!announcement) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }
  res.json(announcement);
};

export const create: RequestHandler = async (req, res) => {
  const announcement = await prisma.announcement.create({
    data: { ...res.locals.body, userId: req.user!.sub },
    include: includeAuthor,
  });
  logger.info(
    { announcementId: announcement.id, userId: req.user!.sub },
    "Оголошення створено",
  );
  res.status(201).json(announcement);
};

export const update: RequestHandler = async (req, res) => {
  const id = res.locals.params.id;
  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }
  if (announcement.userId !== req.user!.sub) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const updated = await prisma.announcement.update({
    where: { id, userId: req.user!.sub },
    data: res.locals.body,
    include: includeAuthor,
  });
  res.json(updated);
};

export const remove: RequestHandler = async (req, res) => {
  const id = res.locals.params.id;
  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }
  if (announcement.userId !== req.user!.sub) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  await prisma.announcement.delete({ where: { id, userId: req.user!.sub } });
  res.status(204).end();
};
