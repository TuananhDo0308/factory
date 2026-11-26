import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getHealth } from "./health.ts";

describe("getHealth", () => {
  it("returns ok status with service name", () => {
    assert.deepEqual(getHealth("billing"), { ok: true, service: "billing" });
  });
});
