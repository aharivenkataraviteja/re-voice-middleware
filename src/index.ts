import path from "path";
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
import { callerMemoryRouter } from "./routes/tools/callerMemory";
import { authRouter } from "./routes/api/auth";
import { leadsRouter } from "./routes/api/leads";
import { appointmentsRouter } from "./routes/api/appointments";
import { tasksRouter } from "./routes/api/tasks";
import { todayRouter } from "./routes/api/today";
import { analyticsRouter } from "./routes/api/analytics";
import { callsRouter } from "./routes/api/calls";
import { usersRouter } from "./routes/api/users";
import { googleCalendarRouter } from "./routes/api/googleCalendar";

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
app.use(callerMemoryRouter);
app.use(authRouter);
app.use(leadsRouter);
app.use(appointmentsRouter);
app.use(tasksRouter);
app.use(todayRouter);
app.use(analyticsRouter);
app.use(callsRouter);
app.use(usersRouter);
app.use(googleCalendarRouter);

// Switchboard frontend — served from this same service so its relative
// fetch("/api/v1/...") calls are same-origin (production CORS is locked to
// `origin: false`, so a separately-hosted frontend would not work here).
// Mounted after every /api, /tools, /vapi, /health route so none of those
// can be shadowed by the SPA fallback below.
const webDistPath = path.join(__dirname, "..", "web", "dist");
app.use(express.static(webDistPath));
app.get(/^\/(?!api|tools|vapi|health).*/, (_req, res, next) => {
  res.sendFile(path.join(webDistPath, "index.html"), (err) => {
    if (err) next(err);
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`RE-VOICE middleware listening on port ${config.port} (mode=${config.mockMode ? "mock" : "live"})`);
  const twilioConfigured = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  const smsIsReal = twilioConfigured && !config.mockMode;
  console.log(
    smsIsReal
      ? "[sms] Twilio configured and MOCK_MODE=false — SMS sends are REAL."
      : `[sms] SMS sends are MOCK — no real message will be delivered (Twilio configured: ${twilioConfigured}, MOCK_MODE: ${config.mockMode}).`
  );
});
