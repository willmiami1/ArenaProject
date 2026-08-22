import { describe, expect, it } from "vitest";
import { repeatPairingBlockMessage } from "./competition";

const rules = (overrides: {
  allowRepeatPartners?: boolean;
  allowSamePartnerDrawAndPick?: boolean;
} = {}) => ({
  allowRepeatPartners: false,
  allowSamePartnerDrawAndPick: false,
  ...overrides,
});

const drawTeam = { generated: true };
const pickedTeam = { generated: false };

describe("repeat partner rules", () => {
  it("allows any pairing that does not already exist", () => {
    expect(repeatPairingBlockMessage(rules(), [], false)).toBe("");
    expect(repeatPairingBlockMessage(rules(), [], true)).toBe("");
  });

  it("blocks every repeat when both rules are off", () => {
    expect(repeatPairingBlockMessage(rules(), [pickedTeam], false)).toBe(
      "That header and heeler are already entered as a team.",
    );
    expect(repeatPairingBlockMessage(rules(), [drawTeam], false)).not.toBe("");
  });

  it("allows unlimited repeats when repeat partner runs are on", () => {
    expect(
      repeatPairingBlockMessage(
        rules({ allowRepeatPartners: true }),
        [pickedTeam, pickedTeam, drawTeam],
        false,
      ),
    ).toBe("");
  });

  describe("same partners twice — one draw + one pick", () => {
    const exception = rules({ allowSamePartnerDrawAndPick: true });

    it("allows a picked run when the pairing only exists as a draw run", () => {
      expect(repeatPairingBlockMessage(exception, [drawTeam], false)).toBe("");
    });

    it("allows a draw run when the pairing only exists as a picked run", () => {
      expect(repeatPairingBlockMessage(exception, [pickedTeam], true)).toBe("");
    });

    it("blocks a second picked run of the same pairing", () => {
      expect(repeatPairingBlockMessage(exception, [pickedTeam], false)).toBe(
        "That partnership already has a picked run. The second run must come from the draw.",
      );
    });

    it("blocks a second draw run of the same pairing", () => {
      expect(repeatPairingBlockMessage(exception, [drawTeam], true)).toBe(
        "That partnership already has its draw run. The second run must be a picked team.",
      );
    });

    it("blocks a third run once the draw and pick are both used", () => {
      expect(
        repeatPairingBlockMessage(exception, [drawTeam, pickedTeam], false),
      ).toBe(
        "That partnership already has both of its runs (one draw and one pick).",
      );
    });

    it("defers to unlimited repeats when both rules are on", () => {
      expect(
        repeatPairingBlockMessage(
          rules({ allowRepeatPartners: true, allowSamePartnerDrawAndPick: true }),
          [drawTeam, pickedTeam],
          false,
        ),
      ).toBe("");
    });
  });
});
