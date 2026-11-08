import express from "express";
import swaggerUi from "swagger-ui-express";
import { generateOpenApiDocument } from "./openapi.ts";
import authRoutes from "./routes/auth.routes.ts";
import { errorHandler } from "./middleware/error-handler.ts";

const app = express();
app.use(express.json());
app.use("/auth", authRoutes);
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
