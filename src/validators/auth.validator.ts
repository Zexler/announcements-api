import { z } from "../zod.ts";
import { textSchema } from "./text.ts";

const password = z
  .string()
  .min(6)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Password must not exceed 72 bytes",
  });

export const registerSchema = z.object({
  username: textSchema.min(3).max(30).openapi({ example: "olena" }),
  email: z.email(),
  password,
  name: textSchema.min(2).openapi({ example: "Олена" }),
});

export const loginSchema = registerSchema.pick({
  username: true,
  password: true,
});
export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
