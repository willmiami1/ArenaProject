import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, LockKeyhole, LogIn, LogOut, RefreshCw, ShieldAlert } from "lucide-react";
import {
  canMountArenaCommand,
  isBrowserStoragePreview,
  localAdminAccess,
  type AdminAccessState,
} from "./adminAccess";
import {
  getAdminAccess,
  isWixEmbed,
  logoutAdmin,
  promptAdminLogin,
} from "./wixBridge";

export function AdminAccessGate({ children }: { children: ReactNode }) {
  const embedded = isWixEmbed();
  const browserPreview = isBrowserStoragePreview();
  const [state, setState] = useState<AdminAccessState>(() =>
    localAdminAccess(embedded, import.meta.env.DEV, browserPreview),
  );
  const [message, setMessage] = useState(
    embedded
      ? "Checking your Wix administrator access..."
      : import.meta.env.DEV || browserPreview
        ? "Browser test mode using this browser's local storage."
        : "Arena Command is available only through the published Wix site.",
  );
  const [busy, setBusy] = useState(embedded);

  const applyResult = (
    result: Awaited<ReturnType<typeof getAdminAccess>>,
  ) => {
    if (!result) {
      setState("denied");
      setMessage("Administrator access could not be verified.");
      return;
    }
    setState(result.state);
    setMessage(result.message);
  };

  useEffect(() => {
    if (!embedded) return;
    let cancelled = false;
    getAdminAccess()
      .then((result) => {
        if (!cancelled) applyResult(result);
      })
      .catch(() => {
        if (!cancelled) {
          setState("login-required");
          setMessage("Sign in with a Wix account assigned the Arena Admin role.");
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
    setMessage("Opening Wix Members login...");
    try {
      applyResult(await promptAdminLogin());
    } catch (error) {
      setState("login-required");
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Login was cancelled. Administrator access was not granted.",
      );
    } finally {
      setBusy(false);
    }
  };

  // Roles assigned in the Wix dashboard after login only show up on a fresh
  // access check, so a denied operator can re-check without reloading.
  const checkAgain = async () => {
    setBusy(true);
    setMessage("Checking your Wix administrator access...");
    try {
      applyResult(await getAdminAccess());
    } catch {
      setState("login-required");
      setMessage("Sign in with a Wix account assigned the Arena Admin role.");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    setMessage("Signing out of Wix Members...");
    try {
      await logoutAdmin();
    } catch {
      // The host reloads after logout; a rejected relay still means we
      // should offer the login button again.
    }
    setState("login-required");
    setMessage("Sign in with a Wix account assigned the Arena Admin role.");
    setBusy(false);
  };

  if (canMountArenaCommand(state)) {
    return (
      <>
        {state === "local-development" && (
          <div className="admin-development-banner" role="status">
            Browser test mode - data is stored only in this browser. Wix authorization is still required in production.
          </div>
        )}
        {children}
      </>
    );
  }

  return (
    <div className="public-site admin-access-page">
      <header className="public-header">
        <a className="public-brand" href="?page=home">
          <img src="./destiny-ranch-arena-logo.png" alt="" />
          <span><strong>Destiny Ranch</strong><small>Arena</small></span>
        </a>
      </header>
      <main className="admin-access-main">
        <section className="admin-access-card" aria-live="polite">
          <span className="admin-access-icon">
            {state === "denied" ? <ShieldAlert /> : <LockKeyhole />}
          </span>
          <span className="eyebrow">Arena Command</span>
          <h1>
            {state === "denied"
              ? "Administrator access denied"
              : state === "unavailable"
                ? "Open Arena Command from Wix"
                : "Administrator login"}
          </h1>
          <p>{message}</p>
          {state === "login-required" && (
            <button className="public-button primary" disabled={busy} onClick={login}>
              <LogIn size={18} />
              {busy ? "Checking access..." : "Log in with Wix Members"}
            </button>
          )}
          {state === "denied" && embedded && (
            <>
              <button className="public-button primary" disabled={busy} onClick={checkAgain}>
                <RefreshCw size={18} />
                {busy ? "Checking access..." : "Check access again"}
              </button>
              <button className="public-button" disabled={busy} onClick={logout}>
                <LogOut size={18} /> Log out and switch account
              </button>
            </>
          )}
          {state === "unavailable" &&
            import.meta.env.VITE_WIX_HOST_ORIGIN?.trim() && (
              <a
                className="public-button primary"
                href={`${import.meta.env.VITE_WIX_HOST_ORIGIN.replace(/\/$/, "")}/?app=command`}
              >
                <LogIn size={18} /> Open secure Wix admin login
              </a>
            )}
          <a className="public-button quiet" href="?page=home">
            <ArrowLeft size={18} /> Return to public website
          </a>
        </section>
      </main>
    </div>
  );
}
