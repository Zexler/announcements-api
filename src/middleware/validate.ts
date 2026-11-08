import type { RequestHandler } from "express";
import { z } from "zod";

function validate(
  schema: z.ZodType,
  source: "body" | "params" | "query",
): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      res
        .status(400)
        .json({
          error: "Validation failed",
          details: z.flattenError(result.error),
        });
      return;
    }
    // В Express 5 req.query доступний лише для читання.
    res.locals[source] = result.data;
    next();
  };
}

export const validateBody = (schema: z.ZodType) => validate(schema, "body");
export const validateParams = (schema: z.ZodType) => validate(schema, "params");
export const validateQuery = (schema: z.ZodType) => validate(schema, "query");
