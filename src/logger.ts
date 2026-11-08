import "dotenv/config";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers.set-cookie",
  ],
});

export default logger;
