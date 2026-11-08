import { z } from "../zod.ts";

export const textSchema = z
  .string()
  .regex(/^[^\u0000]*$/, "Null characters are not allowed");
