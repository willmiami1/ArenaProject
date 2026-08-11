import { processPublicSignupPaymentUpdate } from "backend/public-signup-payments";

export async function wixPay_onPaymentUpdate(event) {
  await processPublicSignupPaymentUpdate(event);
}
