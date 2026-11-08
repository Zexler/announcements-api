import type { ErrorRequestHandler } from "express";
import logger from "../logger.ts";
import multer from "multer";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    res
      .status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
      .json({ error: error.message });
    return;
  }
  if (error?.status === 502 || error?.status === 503) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({
      error: "Validation failed",
      details: { formErrors: ["Invalid JSON"], fieldErrors: {} },
    });
    return;
  }
  if (error?.status >= 400 && error.status < 500) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error?.code === "P2002") {
    res.status(409).json({ error: "Username or email already taken" });
    return;
  }
  if (error?.code === "P2025") {
    res.status(404).json({ error: "Resource not found" });
    return;
  }
  if (error?.code === "P2003") {
    res.status(400).json({ error: "Foreign key constraint failed" });
    return;
  }
  logger.error(
    { name: error?.name, code: error?.code },
    "Помилка обробки запиту",
  );
  res.status(500).json({ error: "Internal server error" });
};
