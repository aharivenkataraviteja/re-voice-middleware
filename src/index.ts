import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config";
import { rateLimiter } from "./middleware/rateLimit";
import { requestLogger } from "./middleware/requestLogger";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";
import { healthRouter } from "./routes/health";
import { webhookRouter } from "./routes/webhook";
import { calendarRouter } from "./routes/tools/calendar";
import { propertyRouter } from "./routes/tools/property";
import { marketRouter } from "./routes/tools/market";
import { smsRouter } from "./routes/tools/sms";
import { crmRouter } from "./routes/tools/crm";
import { transferRouter } from "./routes/tools/transfer";
import { authRouter } from "./routes/api/auth";
import { leadsRouter } from "./routes/api/leads";
import { appointmentsRouter } from "./routes/api/appointments";
import { tasksRouter } from "./routes/api/tasks";
import { todayRouter } from "./routes/api/today";
import { analyticsRouter } from "./routes/api/analytics";
import { callsRouter } from "./routes/api/calls";

const app = express();

// Required for correct client IP detection (and thus rate limiting) behind
// Railway's reverse proxy.
app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(helmet());

const isDev = config.nodeEnv !== "production";
app.use(
  cors({
    origin: isDev ? /^http:\/\/localhost(:\d+)?$/ : false,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    credentials: true,
  })
);

app.use(cookieParser());

// Capture the raw body for HMAC verification before JSON parsing discards it.
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);

app.use(rateLimiter);
app.use(requestLogger);

app.use(healthRouter);
app.use(webhookRouter);
app.use(calendarRouter);
app.use(propertyRouter);
app.use(marketRouter);
app.use(smsRouter);
app.use(crmRouter);
app.use(transferRouter);
app.use(authRouter);
app.use(leadsRouter);
app.use(appointmentsRouter);
app.use(tasksRouter);
app.use(todayRouter);
app.use(analyticsRouter);
app.use(callsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`RE-VOICE middleware listening on port ${config.port} (mode=${config.mockMode ? "mock" : "live"})`);
});
