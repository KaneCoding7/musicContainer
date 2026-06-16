// Result type for the functional core.
//
// Pure business-logic functions never throw; they return a Result that the
// HTTP layer translates into a response. This keeps error handling explicit
// and the core easy to test.

export type ErrorCode =
  | "validation" // bad input (-> 400)
  | "not_found" // resource missing (-> 404)
  | "conflict" // duplicate / constraint (-> 409)
  | "internal"; // unexpected failure (-> 500)

export interface AppError {
  code: ErrorCode;
  message: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

// Map an ErrorCode to an HTTP status code for the route layer.
export function statusForError(code: ErrorCode): number {
  switch (code) {
    case "validation":
      return 400;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "internal":
      return 500;
  }
}
