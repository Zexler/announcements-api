import express from "express";
import authRoutes from "./routes/auth.routes.ts";
import { errorHandler } from "./middleware/error-handler.ts";

const app = express();
app.use(express.json());
app.use("/auth", authRoutes);
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(errorHandler);

export default app;
