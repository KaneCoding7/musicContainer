import { describe, expect, it } from "vitest";
import { isPrivateOrigin } from "../src/origins.js";

describe("isPrivateOrigin", () => {
  it("accepts localhost and private-LAN origins", () => {
    expect(isPrivateOrigin("http://localhost:3000")).toBe(true);
    expect(isPrivateOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isPrivateOrigin("http://192.168.0.215:3000")).toBe(true);
    expect(isPrivateOrigin("http://10.0.0.5:3000")).toBe(true);
    expect(isPrivateOrigin("http://172.16.1.1:8080")).toBe(true);
    expect(isPrivateOrigin("http://nas.local")).toBe(true);
  });

  it("rejects public origins and junk", () => {
    expect(isPrivateOrigin("https://evil.example.com")).toBe(false);
    expect(isPrivateOrigin("https://beats.mrkane.dev")).toBe(false);
    // 172.32 is outside the private 172.16–172.31 range.
    expect(isPrivateOrigin("http://172.32.0.1")).toBe(false);
    expect(isPrivateOrigin("not a url")).toBe(false);
    expect(isPrivateOrigin("ftp://192.168.0.1")).toBe(false);
  });
});
