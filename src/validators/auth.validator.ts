import { z } from "zod";

const password = z
  .string()
  .min(6)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Password must not exceed 72 bytes",
  });

export const registerSchema = z.object({
  username: z.string().min(3).max(30),
  email: z.email(),
  password,
  name: z.string().min(2),
});

export const loginSchema = registerSchema.pick({
  username: true,
  password: true,
});
export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
