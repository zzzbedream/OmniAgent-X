import { describe, expect, it } from "vitest";
import { flip, sideFromCalibration, sideFromOrderType } from "../src/side";

describe("side inference", () => {
  it("maps the verified on-chain OrderDescEnum", () => {
    expect(sideFromOrderType(0)).toBe("long");
    expect(sideFromOrderType(1)).toBe("short");
    expect(sideFromOrderType(2)).toBe("long");
    expect(sideFromOrderType(3)).toBe("short");
    expect(sideFromOrderType(4)).toBe("unknown");
    expect(sideFromOrderType(undefined)).toBe("unknown");
  });
  it("trusts a calibration only when observations agree", () => {
    expect(sideFromCalibration({ longCount: 3, shortCount: 0 })).toBe("long");
    expect(sideFromCalibration({ longCount: 0, shortCount: 1 })).toBe("short");
    expect(sideFromCalibration({ longCount: 1, shortCount: 1 })).toBe("unknown");
    expect(sideFromCalibration(undefined)).toBe("unknown");
    expect(flip("long")).toBe("short");
  });
});
