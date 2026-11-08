import { Router } from "express";
import {
  list,
  get,
  create,
  update,
  remove,
} from "../controllers/announcements.controller.ts";
import { authenticate } from "../middleware/authenticate.ts";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validate.ts";
import {
  announcementParamsSchema,
  announcementQuerySchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "../validators/announcements.validator.ts";

const router = Router();
router.get("/", validateQuery(announcementQuerySchema), list);
router.get("/:id", validateParams(announcementParamsSchema), get);
router.post("/", authenticate, validateBody(createAnnouncementSchema), create);
router.patch(
  "/:id",
  authenticate,
  validateParams(announcementParamsSchema),
  validateBody(updateAnnouncementSchema),
  update,
);
router.delete(
  "/:id",
  authenticate,
  validateParams(announcementParamsSchema),
  remove,
);

export default router;
