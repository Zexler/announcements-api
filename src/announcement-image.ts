import "dotenv/config";
import type { Request } from "express";
import { unlink } from "node:fs/promises";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import logger from "./logger.ts";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function saveWithImage<T>(
  req: Request,
  save: (imageUrl?: string) => Promise<T>,
) {
  if (!req.file) return save();
  let image: UploadApiResponse;
  try {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      throw Object.assign(new Error("Image upload is not configured"), {
        status: 503,
      });
    }
    try {
      image = await cloudinary.uploader.upload(req.file.path, {
        resource_type: "image",
        allowed_formats: ["jpg", "png", "webp"],
        folder: "announcements",
      });
    } catch {
      throw Object.assign(new Error("Image upload failed"), { status: 502 });
    }
    try {
      const result = await save(image.secure_url);
      logger.info({ userId: req.user!.sub }, "Фото оголошення завантажено");
      return result;
    } catch (error) {
      await cloudinary.uploader.destroy(image.public_id).catch(() => {
        logger.error(
          { publicId: image.public_id },
          "Не вдалося видалити незбережене фото",
        );
      });
      throw error;
    }
  } finally {
    await unlink(req.file.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT")
        logger.error(
          { code: error.code },
          "Не вдалося видалити тимчасове фото",
        );
    });
  }
}
