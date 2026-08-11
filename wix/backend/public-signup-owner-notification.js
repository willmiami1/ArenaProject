export const OWNER_NOTIFICATION_MAX_ATTEMPTS = 5;

const notificationErrorMessage = (error) =>
  (error instanceof Error ? error.message : String(error || "Unknown error")).slice(
    0,
    500,
  );

export function buildOwnerPaymentNotification(
  workspace,
  contestant,
  intent,
  transactionId = "",
) {
  const selections = JSON.parse(intent.selections);
  const ropings = selections.map((selection) => {
    const event = workspace.events.find(
      (item) => item.id === selection.competitionId,
    );
    const schedule = [event?.date, event?.startTime].filter(Boolean).join(" ");
    return `${event?.name || selection.competitionId}${schedule ? ` (${schedule})` : ""} - ${selection.role}`;
  });

  return {
    contestantName: String(contestant?.name || "Unknown contestant"),
    paidAmount: `${String(intent.currency)} ${Number(intent.amount).toFixed(2)}`,
    ropings: ropings.join("\n"),
    submissionId: String(intent.submissionId),
    paymentId: String(intent.paymentId),
    transactionId: String(transactionId || intent.transactionId || ""),
  };
}

export async function deliverOwnerPaymentNotification({
  record,
  notification,
  send,
  persist,
  now = () => new Date(),
}) {
  if (
    record.status === "sent" ||
    record.status === "sending" ||
    Number(record.attempts || 0) >= OWNER_NOTIFICATION_MAX_ATTEMPTS
  ) {
    return { record, sent: false };
  }

  const startedAt = now();
  const sendingRecord = {
    ...record,
    status: "sending",
    attempts: Number(record.attempts || 0) + 1,
    lastAttemptAt: startedAt,
    error: "",
    updatedAt: startedAt,
  };
  await persist(sendingRecord, "owner-payment-notification-started");

  try {
    await send(notification);
  } catch (error) {
    const failedAt = now();
    const failedRecord = {
      ...sendingRecord,
      status: "failed",
      error: notificationErrorMessage(error),
      updatedAt: failedAt,
    };
    await persist(failedRecord, "owner-payment-notification-failed");
    throw error;
  }

  const sentAt = now();
  const sentRecord = {
    ...sendingRecord,
    status: "sent",
    notifiedAt: sentAt,
    updatedAt: sentAt,
  };
  await persist(sentRecord, "owner-payment-notification-sent");
  return { record: sentRecord, sent: true };
}
