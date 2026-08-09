import { describe, expect, it, vi } from "vitest";
import {
  buildOwnerPaymentNotification,
  deliverOwnerPaymentNotification,
} from "../wix/backend/public-signup-owner-notification";

const paymentIntent = {
  _id: "intent-1",
  submissionId: "submission-1",
  paymentId: "payment-1",
  transactionId: "transaction-1",
  amount: 400,
  currency: "USD",
  selections: JSON.stringify([
    { competitionId: "roping-1", role: "Header" },
    { competitionId: "roping-2", role: "Heeler" },
  ]),
};

describe("owner payment notifications", () => {
  it("sends and records one notification with an authoritative summary", async () => {
    const notification = buildOwnerPaymentNotification(
      {
        events: [
          {
            id: "roping-1",
            name: "Saturday Slide",
            date: "2026-08-15",
            startTime: "12:00",
          },
          { id: "roping-2", name: "Sunday Round Robin" },
        ],
      },
      {
        name: "Rider One",
        email: "private@example.com",
        phone: "555-0100",
      },
      paymentIntent,
    );
    const persisted = [];
    const send = vi.fn();
    const result = await deliverOwnerPaymentNotification({
      record: { _id: "notice-1", status: "pending", attempts: 0 },
      notification,
      send,
      persist: async (record) => persisted.push(record),
      now: () => new Date("2026-08-09T21:00:00.000Z"),
    });

    expect(result.sent).toBe(true);
    expect(result.record.status).toBe("sent");
    expect(result.record.attempts).toBe(1);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      contestantName: "Rider One",
      paidAmount: "USD 400.00",
      ropings:
        "Saturday Slide (2026-08-15 12:00) - Header\nSunday Round Robin - Heeler",
      submissionId: "submission-1",
      paymentId: "payment-1",
      transactionId: "transaction-1",
    });
    expect(JSON.stringify(send.mock.calls[0][0])).not.toMatch(
      /private@example|555-0100/,
    );
    expect(persisted.map(({ status }) => status)).toEqual(["sending", "sent"]);
  });

  it("does not resend a sent notification", async () => {
    const record = { _id: "notice-1", status: "sent", attempts: 1 };
    const send = vi.fn();
    const persist = vi.fn();

    const result = await deliverOwnerPaymentNotification({
      record,
      notification: {},
      send,
      persist,
    });

    expect(result).toEqual({ record, sent: false });
    expect(send).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("records delivery failure without changing payment state", async () => {
    const persisted = [];
    const deliveryError = new Error("Triggered email unavailable");

    await expect(
      deliverOwnerPaymentNotification({
        record: {
          _id: "notice-1",
          intentId: "intent-1",
          status: "pending",
          attempts: 0,
        },
        notification: {},
        send: async () => {
          throw deliveryError;
        },
        persist: async (record) => persisted.push(record),
        now: () => new Date("2026-08-09T21:00:00.000Z"),
      }),
    ).rejects.toBe(deliveryError);

    expect(persisted.map(({ status }) => status)).toEqual([
      "sending",
      "failed",
    ]);
    expect(persisted[1].attempts).toBe(1);
    expect(persisted[1].error).toBe("Triggered email unavailable");
    expect("paymentStatus" in persisted[1]).toBe(false);
  });
});
