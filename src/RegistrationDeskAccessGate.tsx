import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ClipboardPen, LogIn, LogOut, RefreshCw, ShieldAlert } from "lucide-react";
import {
  canMountArenaCommand,
  isBrowserStoragePreview,
  localAdminAccess,
  type AdminAccessState,
} from "./adminAccess";
import {
  getRegistrationDeskAccess,
  isWixEmbed,
  logoutRegistrationDesk,
  promptRegistrationDeskLogin,
} from "./wixBridge";

export function RegistrationDeskAccessGate({
  children,
}: {
  children: ReactNode;
}) {
  const embedded = isWixEmbed();
  const browserPreview = isBrowserStoragePreview();
  const [state, setState] = useState<AdminAccessState>(() =>
    localAdminAccess(embedded, import.meta.env.DEV, browserPreview),
  );
  const [message, setMessage] = useState(
    embedded
      ? "Checking registration desk access..."
      : import.meta.env.DEV || browserPreview
        ? "Local registration desk preview"
        : "The Registration Desk is available only through the published Wix site.",
  );
  const [busy, setBusy] = useState(embedded);

  const applyResult = (
    result: Awaited<ReturnType<typeof getRegistrationDeskAccess>>,
  ) => {
    if (!result) {
      setState("denied");
      setMessage("Registration desk access could not be verified.");
      return;
    }
    setState(result.state);
    setMessage(result.message);
  };

  useEffect(() => {
    if (!embedded) return;
    let cancelled = false;
    getRegistrationDeskAccess()
      .then((result) => {
        if (!cancelled) applyResult(result);
      })
      .catch(() => {
        if (!cancelled) {
          setState("login-required");
          setMessage("Sign in with a Wix Registration Desk account.");
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [embedded]);

  const login = async () => {
    setBusy(true);
    try {
      applyResult(await promptRegistrationDeskLogin());
    } catch (error) {
      setState("login-required");
      setMessage(
        error instanceof Error
          ? error.message
          : "Registration Desk login was cancelled.",
      );
    } finally {
      setBusy(false);
    }
  };

  const checkAgain = async () => {
    setBusy(true);
    setMessage("Checking registration desk access...");
    try {
      applyResult(await getRegistrationDeskAccess());
    } catch {
      setState("login-required");
      setMessage("Sign in with a Wix Registration Desk account.");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    setMessage("Signing out of Wix Members...");
    try {
      await logoutRegistrationDesk();
    } catch {
      // Fall through to the login prompt either way.
    }
    setState("login-required");
    setMessage("Sign in with a Wix Registration Desk account.");
    setBusy(false);
  };

  if (canMountArenaCommand(state)) return <>{children}</>;

  return (
    <div className="public-site admin-access-page">
      <main className="admin-access-main">
        <section className="admin-access-card" aria-live="polite">
          <span className="admin-access-icon">
            {state === "denied" ? <ShieldAlert /> : <ClipboardPen />}
          </span>
          <span className="eyebrow">Restricted workspace</span>
          <h1>Registration Desk</h1>
          <p>{message}</p>
          {state === "login-required" && (
            <button className="public-button" disabled={busy} onClick={login}>
              <LogIn size={18} />
              {busy ? "Checking access..." : "Log in with Wix Members"}
            </button>
          )}
          {state === "denied" && embedded && (
            <>
              <button className="public-button" disabled={busy} onClick={checkAgain}>
                <RefreshCw size={18} />
                {busy ? "Checking access..." : "Check access again"}
              </button>
              <button className="public-button" disabled={busy} onClick={logout}>
                <LogOut size={18} /> Log out and switch account
              </button>
            </>
          )}
          <a className="public-button quiet" href="?page=home">
            <ArrowLeft size={18} /> Return to public website
          </a>
        </section>
      </main>
    </div>
  );
}
