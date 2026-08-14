export function registrationDeskWorkspaceHref(currentHref: string) {
  const current = new URL(currentHref);
  const relayOrigin = current.searchParams.get("wixHostOrigin");
  return `?app=command${relayOrigin ? `&wixHostOrigin=${encodeURIComponent(relayOrigin)}` : ""}`;
}

export function registrationDeskHref(currentHref: string) {
  const current = new URL(currentHref);
  const relayOrigin = current.searchParams.get("wixHostOrigin");
  return `?app=registration${relayOrigin ? `&wixHostOrigin=${encodeURIComponent(relayOrigin)}` : ""}`;
}
