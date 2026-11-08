import { z } from "../zod.ts";
import { textSchema } from "./text.ts";

const id = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().max(2147483647));

export const announcementParamsSchema = z.object({ id });
export const announcementQuerySchema = z.object({
  search: textSchema.optional().openapi({ example: "велосипед" }),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  page: id.default(1),
});

export const createAnnouncementSchema = z.object({
  title: textSchema.min(5).max(50).openapi({ example: "Продам велосипед" }),
  description: textSchema
    .min(10)
    .openapi({ example: "Гірський велосипед у доброму стані" }),
  price: z.number().positive(),
  category: z.enum(["sale", "service", "job", "other"]),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial();
