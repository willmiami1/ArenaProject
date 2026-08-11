import { describe, expect, it } from "vitest";
import { publicRoleCapacityLabel } from "./publicRoleCapacity";

describe("public role capacity labels", () => {
  it("formats positive, singular, full, and over-cap remaining spots", () => {
    expect(
      publicRoleCapacityLabel({
        role: "Header",
        registered: 2,
        maximum: 5,
        full: false,
      }),
    ).toBe("3 spots left");
    expect(
      publicRoleCapacityLabel({
        role: "Heeler",
        registered: 4,
        maximum: 5,
        full: false,
      }),
    ).toBe("1 spot left");
    expect(
      publicRoleCapacityLabel({
        role: "Header",
        registered: 5,
        maximum: 5,
        full: true,
      }),
    ).toBe("Full");
    expect(
      publicRoleCapacityLabel({
        role: "Heeler",
        registered: 7,
        maximum: 5,
        full: true,
      }),
    ).toBe("Full");
  });

  it("omits unlimited and invalid legacy capacities", () => {
    expect(publicRoleCapacityLabel(undefined)).toBe("");
    expect(
      publicRoleCapacityLabel({
        role: "Header",
        registered: 2,
        maximum: 0,
        full: false,
      }),
    ).toBe("");
  });
});

