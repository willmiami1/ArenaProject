import { describe, expect, it } from "vitest";
import { seedData } from "./data";
import {
  createLocalContestantAccount,
  validateContestantAccount,
  type ContestantAccountRequest,
} from "./contestantAccount";

const validAccount: ContestantAccountRequest = {
  name: "  Jane   Roper ",
  email: " JANE@Example.COM ",
  phone: "(555) 234-5678",
  hometown: "  Fort   Worth ",
  role: "Both",
  headerHandicap: 5.5,
  heelerHandicap: 6,
  pin: "2468",
};

describe("contestant account validation", () => {
  it("normalizes valid public account details", () => {
    expect(validateContestantAccount(validAccount)).toMatchObject({
      name: "Jane Roper",
      email: "jane@example.com",
      phone: "5552345678",
      hometown: "Fort Worth",
      headerHandicap: 5.5,
      heelerHandicap: 6,
    });
  });

  it.each([
    ["email", { email: "not-an-email" }],
    ["phone", { phone: "555" }],
    ["PIN", { pin: "12345" }],
    ["handicaps", { headerHandicap: 21 }],
  ])("rejects an invalid %s", (_field, change) => {
    expect(() =>
      validateContestantAccount({ ...validAccount, ...change }),
    ).toThrow();
  });

  it("zeros the handicap for a role the contestant does not enter", () => {
    expect(
      validateContestantAccount({
        ...validAccount,
        role: "Header",
        heelerHandicap: 18,
      }).heelerHandicap,
    ).toBe(0);
  });
});

describe("local contestant account creation", () => {
  it("adds a normalized contestant without storing the PIN", () => {
    const result = createLocalContestantAccount(
      structuredClone(seedData),
      validAccount,
      "contestant-new",
    );
    expect(result.contestant).toMatchObject({
      id: "contestant-new",
      email: "jane@example.com",
      phone: "5552345678",
    });
    expect(result.contestant).not.toHaveProperty("pin");
  });

  it("rejects duplicate email and phone identities", () => {
    const data = structuredClone(seedData);
    data.contestants.push({
      id: "existing-account",
      name: "Existing Roper",
      email: "jane@example.com",
      phone: "5559990000",
      hometown: "",
      role: "Header",
      headerHandicap: 4,
      heelerHandicap: 0,
      photo: "",
    });
    expect(() =>
      createLocalContestantAccount(data, validAccount, "duplicate-email"),
    ).toThrow("already uses that email");
    expect(() =>
      createLocalContestantAccount(
        data,
        {
          ...validAccount,
          email: "different@example.com",
          phone: "555-999-0000",
        },
        "duplicate-phone",
      ),
    ).toThrow("already uses that phone");
  });
});
