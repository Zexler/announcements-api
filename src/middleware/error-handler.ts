import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error?.type === "entity.parse.failed") {
    res
      .status(400)
      .json({
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
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
};
