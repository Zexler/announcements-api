import type { RequestHandler } from "express";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import multer from "multer";
import logger from "../logger.ts";

mkdirSync("uploads", { recursive: true });
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter(_req, file, callback) {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(
      Object.assign(new Error("Only JPEG, PNG and WebP images are allowed"), {
        status: 400,
      }),
    );
  },
}).single("image");

export const receiveImage: RequestHandler = (req, res, next) => {
  upload(req, res, (error) => {
    if (error) {
      const malformed = [
        "Multipart: Boundary not found",
        "Malformed part header",
        "Unexpected end of form",
        "Unexpected end of file",
      ];
      if (malformed.includes(error.message)) error.status = 400;
      return next(error);
    }
    const path = req.file?.path;
    if (path) {
      // Прибираємо файл також після помилки валідації або закриття з'єднання.
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        void unlink(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT")
            logger.error(
              { code: error.code },
              "Не вдалося видалити тимчасове фото",
            );
        });
      };
      res.once("finish", cleanup);
      res.once("close", cleanup);
      if (res.destroyed) cleanup();
    }
    if (res.destroyed) return;
    if (req.is("multipart/form-data") && typeof req.body?.price === "string") {
      req.body.price = Number(req.body.price);
    }
    next();
  });
};

export const requireAnnouncementChanges: RequestHandler = (req, res, next) => {
  if (Object.keys(res.locals.body).length === 0 && !req.file) {
    res.status(400).json({
      error: "Validation failed",
      details: {
        formErrors: ["Provide at least one announcement field or image"],
        fieldErrors: {},
      },
    });
    return;
  }
  next();
};
