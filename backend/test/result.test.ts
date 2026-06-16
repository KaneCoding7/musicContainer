import { describe, expect, it } from "vitest";
import { err, ok, statusForError } from "../src/functional/result.js";

describe("Result", () => {
  it("ok wraps a value", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("err carries a code and message", () => {
    const r = err("not_found", "nope");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("not_found");
      expect(r.error.message).toBe("nope");
    }
  });

  it("maps error codes to HTTP statuses", () => {
    expect(statusForError("validation")).toBe(400);
    expect(statusForError("not_found")).toBe(404);
    expect(statusForError("conflict")).toBe(409);
    expect(statusForError("internal")).toBe(500);
  });
});
