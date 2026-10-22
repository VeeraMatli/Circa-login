import { describe, it, expect } from "vitest";
import { configuration } from "../src/verification";
describe("Apple verification configuration", () => {
  it("requires explicit credentials and certificate roots", () =>
    expect(() => configuration({})).toThrow("APPLE_ENVIRONMENT"));
  it("rejects unsupported StoreKit environments", () =>
    expect(() => configuration({ APPLE_ENVIRONMENT: "Xcode" })).toThrow(
      "Sandbox or Production",
    ));
});
