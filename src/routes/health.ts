import { Router } from "express";
import { config } from "../config";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    mode: config.mockMode ? "mock" : "live",
    time: new Date().toISOString(),
  });
});
