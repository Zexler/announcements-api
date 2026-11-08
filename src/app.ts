import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import logger from "./logger.ts";
import swaggerUi from "swagger-ui-express";
import { generateOpenApiDocument } from "./openapi.ts";
import authRoutes from "./routes/auth.routes.ts";
import announcementRoutes from "./routes/announcements.routes.ts";
import { errorHandler } from "./middleware/error-handler.ts";

const app = express();
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
app.use(pinoHttp({ logger }));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { "upgrade-insecure-requests": null },
    },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(Object.assign(new Error("Origin not allowed"), { status: 403 }));
    },
  }),
);
app.use(express.json());
app.use("/auth", authRoutes);
app.use("/announcements", announcementRoutes);
const document = generateOpenApiDocument();
app.get("/openapi.json", (_req, res) => {
  res.json(document);
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(document));
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(errorHandler);

export default app;
