import { describe, expect, it } from "vitest";
import { publicRegisteredRiders } from "../wix/backend/public-prediction-projection.js";

describe("Wix public registered rider projection", () => {
  it("matches role, eligibility, dedupe, sorting, and privacy rules", () => {
    const contestants = new Map([
      ["header", { id: "header", name: "Ada Header", photo: "data:image/png;base64,a", email: "private@example.com" }],
      ["heeler", { id: "heeler", name: "Bo Heeler", photo: "" }],
      ["both", { id: "both", name: "Cal Both", photo: "https://example.com/not-safe.jpg" }],
    ]);
    const registrations = [
      { eventId: "event", contestantId: "both", role: "Header", status: "entered" },
      { eventId: "event", contestantId: "both", role: "Heeler", status: "entered" },
      { eventId: "event", contestantId: "header", role: "Heeler", status: "scratched" },
    ];
    const teams = [
      { eventId: "event", round: 1, headerId: "header", heelerId: "heeler", generated: false, scratched: false },
      { eventId: "event", round: 1, headerId: "header", heelerId: "heeler", generated: false, scratched: false },
      { eventId: "event", round: 1, headerId: "both", heelerId: "both", generated: true, scratched: false },
      { eventId: "event", round: 2, headerId: "both", heelerId: "both", generated: false, scratched: false },
    ];

    const projected = publicRegisteredRiders(
      "event",
      registrations,
      teams,
      contestants,
    );

    expect(projected).toEqual({
      headers: [
        { id: "header", name: "Ada Header", photo: "data:image/png;base64,a" },
        { id: "both", name: "Cal Both", photo: undefined },
      ],
      heelers: [
        { id: "heeler", name: "Bo Heeler", photo: undefined },
        { id: "both", name: "Cal Both", photo: undefined },
      ],
    });
    expect(JSON.stringify(projected)).not.toContain("private@example.com");
  });
});
