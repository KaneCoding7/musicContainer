import { describe, expect, it } from "vitest";
import { hitLimit, type RateState } from "../src/rate-limit.js";

describe("rate limit core", () => {
  it("allows up to max within the window, then limits", () => {
    const store = new Map<string, RateState>();
    const now = 1000;
    // max = 3
    expect(hitLimit(store, "ip", now, 60_000, 3).limited).toBe(false); // 1
    expect(hitLimit(store, "ip", now, 60_000, 3).limited).toBe(false); // 2
    expect(hitLimit(store, "ip", now, 60_000, 3).limited).toBe(false); // 3
    const fourth = hitLimit(store, "ip", now, 60_000, 3);
    expect(fourth.limited).toBe(true);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const store = new Map<string, RateState>();
    hitLimit(store, "ip", 0, 1000, 1);
    expect(hitLimit(store, "ip", 500, 1000, 1).limited).toBe(true); // still in window
    expect(hitLimit(store, "ip", 1000, 1000, 1).limited).toBe(false); // window reset
  });

  it("tracks keys independently", () => {
    const store = new Map<string, RateState>();
    expect(hitLimit(store, "a", 0, 1000, 1).limited).toBe(false);
    expect(hitLimit(store, "b", 0, 1000, 1).limited).toBe(false);
    expect(hitLimit(store, "a", 0, 1000, 1).limited).toBe(true);
  });
});
