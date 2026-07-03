import { Request, Response, NextFunction } from "express";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "not_found" });
}

// Always returns a generic JSON error to the caller — never a stack trace
// or internal error message, regardless of environment. Full error detail
// (including stack) goes to the server-side console log only.
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  console.error(`[error] ${req.method} ${req.path}`, err);

  const status = Number.isInteger(err?.status) ? err.status : 500;
  const message = status >= 500 ? "internal_server_error" : "bad_request";

  res.status(status).json({ error: message });
}
