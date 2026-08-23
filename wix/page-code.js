import {
  authenticateContestant,
  loadPublicArenaData,
  loadPublicSchedule,
  publishPublicSchedule,
  loadSignupOptions,
  createPublicSignupPayment,
  submitPublicSignupCash,
  getPublicSignupPaymentStatus,
  loadArenaData,
  debugSaveArenaData,
  saveArenaData,
  saveContestant,
  saveEvent,
  saveRegistration,
  setActiveRun,
  setContestantPin,
  updateContestantProfile,
  submitSpectatorPrediction,
  submitReservedSpot,
  resetSpectatorScoreboard,
  clearTeamSpectatorPredictions,
  createContestantAccount,
  createRiderAccount,
  getAdminAccess as getAdminAccessFromBackend,
  getRegistrationDeskAccess as getRegistrationDeskAccessFromBackend,
  loadRegistrationDeskData,
  loadContestantSignedWaiver,
  loadContestantWaiverStatuses,
  saveRegistrationDeskContestant,
  setRegistrationDeskContestantPin,
  scratchRegistrationDeskEntry,
  submitRegistrationDeskSignup,
  submitRegistrationDeskWaiver,
  updateRegistrationDeskEntry,
} from "backend/arena-data.web";
import { authentication } from "wix-members-frontend";
import wixLocationFrontend from "wix-location-frontend";
import wixPayFrontend from "wix-pay-frontend";
import wixWindowFrontend from "wix-window-frontend";

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const ADMIN_LOGOUT_ACTIONS = new Set([
  "logoutAdmin",
  "logoutRegistrationDesk",
]);
const ADMIN_SESSION_RETRY_DELAYS_MS = [250, 500, 1000, 1500, 2500];
const PUBLIC_SIGNUP_ACTIONS = new Set([
  "loadSignupOptions",
  "startPublicSignupPayment",
  "submitPublicSignupCash",
  "getPublicSignupPaymentStatus",
]);
const REGISTRATION_DESK_WAIVER_ACTIONS = new Set([
  "submitRegistrationDeskWaiver",
]);
const REGISTRATION_DESK_WAIVER_ERROR_MESSAGES = new Map([
  ["WAIVER_INVALID_REQUEST", "Choose a valid competition and contestant."],
  [
    "WAIVER_NOT_ACCEPTED",
    "The participant must accept the current waiver before signing.",
  ],
  [
    "WAIVER_SIGNER_NAME_REQUIRED",
    "Enter the signer name exactly as signed.",
  ],
  [
    "WAIVER_SIGNATURE_INVALID",
    "Draw a valid PNG signature before submitting the waiver.",
  ],
  [
    "WAIVER_SIGNATURE_TOO_LARGE",
    "The PNG signature is too large. Clear it and sign again.",
  ],
  [
    "WAIVER_DOCUMENT_UNAVAILABLE",
    "Participant waiver signatures are unavailable until the authoritative waiver text is configured.",
  ],
  ["WAIVER_EVENT_NOT_FOUND", "Competition not found."],
  [
    "WAIVER_EVENT_NOT_LIVE",
    "Participant waivers can only be signed at Registration Desk for live or upcoming competitions.",
  ],
  ["WAIVER_CONTESTANT_NOT_FOUND", "Contestant not found."],
  [
    "WAIVER_RECORD_CONFLICT",
    "The existing waiver signature record does not match this competition, contestant, and waiver version.",
  ],
]);
const REGISTRATION_DESK_WAIVER_ERROR_CODES_BY_MESSAGE = new Map(
  [...REGISTRATION_DESK_WAIVER_ERROR_MESSAGES].map(([code, message]) => [
    message,
    code,
  ]),
);
const PUBLIC_EVENT_SECTIONS = new Set(["future", "current", "live", "past"]);
const PUBLIC_EVENT_SECTION_HASHES = new Map([
  ["events-current", "current"],
  ["events-live", "live"],
  ["events-future", "future"],
  ["events-past", "past"],
]);

const registrationDeskWaiverRelayError = (error) => {
  const knownCode =
    (REGISTRATION_DESK_WAIVER_ERROR_MESSAGES.has(error?.code) &&
      error.code) ||
    REGISTRATION_DESK_WAIVER_ERROR_CODES_BY_MESSAGE.get(error?.message);
  if (knownCode) {
    return {
      code: knownCode,
      message: REGISTRATION_DESK_WAIVER_ERROR_MESSAGES.get(knownCode),
    };
  }
  if (
    error?.message ===
    "This action requires the Wix Registration Desk role."
  ) {
    return {
      code: "WAIVER_FORBIDDEN",
      message: "This action requires the Wix Registration Desk role.",
    };
  }
  return {
    code: "WAIVER_SUBMISSION_FAILED",
    message: "The participant waiver could not be submitted.",
  };
};

async function getAccessWhenSessionIsReady(getAccess) {
  let access = await getAccess();
  for (const delay of ADMIN_SESSION_RETRY_DELAYS_MS) {
    if (access?.state !== "login-required") return access;
    await wait(delay);
    access = await getAccess();
  }
  if (access?.state === "login-required") {
    throw new Error(
      "Wix login completed, but the member session is not available yet. Wait a moment and try again.",
    );
  }
  return access;
}

async function promptLogin(getAccess) {
  await authentication.promptLogin({ mode: "login", modal: false });
  return getAccessWhenSessionIsReady(getAccess);
}

async function loadPublicArenaDataWhenReady() {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await loadPublicArenaData();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(500 * (attempt + 1));
    }
  }
  throw lastError;
}

class ArenaRelayError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const unwrapPublicSignupEnvelope = (envelope) => {
  if (envelope?.ok === true) return envelope.data;
  throw new ArenaRelayError(
    envelope?.error?.code || "TEMPORARILY_UNAVAILABLE",
    envelope?.error?.message ||
      "Public registration is temporarily unavailable. Try again.",
  );
};

$w.onReady(() => {
  const [embed] = $w("HtmlComponent");
  if (!embed) {
    console.error("Add an HTML Component containing the Arena app bridge.");
    return;
  }

  const requestedSectionQuery = wixLocationFrontend.query.section;
  const requestedSectionHash = PUBLIC_EVENT_SECTION_HASHES.get(
    new URL(wixLocationFrontend.url).hash.slice(1),
  );
  let requestedSection =
    typeof requestedSectionQuery === "string" &&
    PUBLIC_EVENT_SECTIONS.has(requestedSectionQuery)
      ? requestedSectionQuery
      : requestedSectionHash;

  const pendingRequests = new Set();
  embed.onMessage(async (event) => {
    const message = event.data;
    if (message?.source !== "arena-command-app" || !message.requestId) return;

    if (pendingRequests.has(message.requestId)) return;
    pendingRequests.add(message.requestId);

    try {
      let data;
      if (message.action === "load") data = await loadArenaData();
      else if (message.action === "save") {
        const result = await debugSaveArenaData(message.data);
        if (result?.ok === false) {
          throw new Error(
            `DIAG:${result.phase}: code=${result.code || ""} message=${result.message || ""}`,
          );
        }
        data = result?.result;
      } else if (message.action === "saveContestant") {
        data = await saveContestant(message.data);
      } else if (message.action === "saveEvent") {
        data = await saveEvent(message.data);
      } else if (message.action === "saveRegistration") {
        data = await saveRegistration(message.data);
      } else if (message.action === "setActiveRun") {
        data = await setActiveRun(message.data);
      } else if (message.action === "authenticateContestant") {
        data = await authenticateContestant(message.data);
      } else if (message.action === "setContestantPin") {
        data = await setContestantPin(message.data);
      } else if (message.action === "updateContestantProfile") {
        data = await updateContestantProfile(message.data);
      } else if (message.action === "loadPublicArenaData") {
        data = await loadPublicArenaDataWhenReady();
      } else if (message.action === "loadPublicSchedule") {
        data = await loadPublicSchedule();
      } else if (message.action === "publishPublicSchedule") {
        data = await publishPublicSchedule(message.data);
      } else if (message.action === "loadSignupOptions") {
        data = unwrapPublicSignupEnvelope(
          await loadSignupOptions(message.data),
        );
      } else if (message.action === "startPublicSignupPayment") {
        const payment = unwrapPublicSignupEnvelope(
          await createPublicSignupPayment(message.data),
        );
        if (payment.status !== "payment-created" || !payment.paymentId) {
          data = payment;
        } else {
          await wixWindowFrontend.scrollTo(0, 0, {
            scrollAnimation: false,
          });
          const checkout = await wixPayFrontend.startPayment(
            payment.paymentId,
            { showThankYouPage: false },
          );
          const authoritative = unwrapPublicSignupEnvelope(
            await getPublicSignupPaymentStatus({
              ...message.data,
              submissionId: payment.submissionId,
            }),
          );
          data = {
            ...authoritative,
            checkoutStatus: checkout.status,
          };
        }
      } else if (message.action === "submitPublicSignupCash") {
        data = unwrapPublicSignupEnvelope(
          await submitPublicSignupCash(message.data),
        );
      } else if (message.action === "getPublicSignupPaymentStatus") {
        data = unwrapPublicSignupEnvelope(
          await getPublicSignupPaymentStatus(message.data),
        );
      } else if (message.action === "submitSpectatorPrediction") {
        data = await submitSpectatorPrediction(message.data);
      } else if (message.action === "submitReservedSpot") {
        data = unwrapPublicSignupEnvelope(
          await submitReservedSpot(message.data),
        );
      } else if (message.action === "resetSpectatorScoreboard") {
        data = await resetSpectatorScoreboard(message.data);
      } else if (message.action === "clearTeamSpectatorPredictions") {
        data = await clearTeamSpectatorPredictions(message.data);
      } else if (message.action === "createContestantAccount") {
        data = await createContestantAccount(message.data);
      } else if (message.action === "createRiderAccount") {
        data = await createRiderAccount(message.data);
      } else if (message.action === "getAdminAccess") {
        data = await getAdminAccessFromBackend();
      } else if (message.action === "promptAdminLogin") {
        data = await promptLogin(getAdminAccessFromBackend);
      } else if (message.action === "getRegistrationDeskAccess") {
        data = await getRegistrationDeskAccessFromBackend();
      } else if (message.action === "promptRegistrationDeskLogin") {
        data = await promptLogin(getRegistrationDeskAccessFromBackend);
      } else if (message.action === "loadRegistrationDeskData") {
        data = await loadRegistrationDeskData();
      } else if (message.action === "loadContestantWaiverStatuses") {
        data = await loadContestantWaiverStatuses();
      } else if (message.action === "loadContestantSignedWaiver") {
        data = await loadContestantSignedWaiver(message.data);
      } else if (message.action === "saveRegistrationDeskContestant") {
        data = await saveRegistrationDeskContestant(message.data);
      } else if (message.action === "setRegistrationDeskContestantPin") {
        data = await setRegistrationDeskContestantPin(message.data);
      } else if (message.action === "updateRegistrationDeskEntry") {
        data = await updateRegistrationDeskEntry(message.data);
      } else if (message.action === "scratchRegistrationDeskEntry") {
        data = await scratchRegistrationDeskEntry(message.data);
      } else if (message.action === "submitRegistrationDeskSignup") {
        data = await submitRegistrationDeskSignup(message.data);
      } else if (message.action === "submitRegistrationDeskWaiver") {
        data = await submitRegistrationDeskWaiver(message.data);
      } else if (ADMIN_LOGOUT_ACTIONS.has(message.action)) {
        await authentication.logout();
        data = { loggedOut: true };
      } else {
        throw new Error("Unsupported Arena Command action.");
      }
      embed.postMessage({
        source: "arena-wix-host",
        requestId: message.requestId,
        ok: true,
        data,
      });
    } catch (error) {
      const waiverError = REGISTRATION_DESK_WAIVER_ACTIONS.has(message.action)
        ? registrationDeskWaiverRelayError(error)
        : null;
      const errMsg =
        waiverError?.message ||
        (error instanceof Error ? error.message : String(error));
      const errCode = waiverError?.code || error?.code || "";
      const errDetails =
        !waiverError && error?.details ? JSON.stringify(error.details) : "";
      console.error(
        "Arena Command action failed. action=" + message.action +
        " code=" + errCode +
        " message=" + errMsg +
        " details=" + errDetails
      );
      embed.postMessage({
        source: "arena-wix-host",
        requestId: message.requestId,
        ok: false,
        error:
          error instanceof ArenaRelayError
            ? { code: error.code, message: error.message }
            : waiverError
              ? waiverError
            : PUBLIC_SIGNUP_ACTIONS.has(message.action)
              ? {
                  code: "PAYMENT_WINDOW_FAILED",
                  message:
                    error?.message ||
                    "Wix checkout could not be opened. Try again.",
                }
            : error?.message || "The requested Arena action failed.",
      });
    } finally {
      if (requestedSection) {
        embed.postMessage({
          source: "arena-wix-host",
          type: "arena:navigate-section",
          section: requestedSection,
        });
        requestedSection = undefined;
      }
      pendingRequests.delete(message.requestId);
    }
  });
});