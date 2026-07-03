import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  mockMode: (process.env.MOCK_MODE || "true").toLowerCase() === "true",
  dataDir: process.env.DATA_DIR || "./data",
  vapiToolSecret: required("VAPI_TOOL_SECRET"),
  vapiWebhookSecret: required("VAPI_WEBHOOK_SECRET"),
};
