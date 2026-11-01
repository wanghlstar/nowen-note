import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { connectSyncServer, disableSync, fetchSyncDiagnostics, fetchSyncSettings, triggerSyncNow, type SyncDiagnostics, type SyncSettingsResponse } from "@/lib/syncLocalApi";
import { getServerUrl } from "@/lib/api";
import { isMobileLocalMode } from "@/lib/mobileLocalMode";
import { loginMobileSyncAccount } from "@/lib/mobileSyncAccountLogin";

export default function MobileSyncSettings() {
  const { t, i18n } = useTranslation();
  const [diagnostics, setDiagnostics] = useState<SyncDiagnostics | null>(null);
  const [settings, setSettings] = useState<SyncSettingsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactor, setTwoFactor] = useState<{ ticket: string; username: string; serverUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const syncEnabled = settings?.mode === "server";
  const reload = useCallback(async () => {
    try {
      const next = await fetchSyncSettings();
      setSettings(next);
      setDiagnostics(next.mode === "server" ? await fetchSyncDiagnostics() : null);
      setError(null);
    } catch {
      setError("mobileSync.settingsReadFailed");
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => { void reload(); }, 5000);
    return () => window.clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    if (!settings || settings.authorized || settings.mode !== "server") return;
    setShowConnect(true);
    setServerUrl((current) => current || settings.activeProfile?.serverUrl || settings.profiles[0]?.serverUrl || getServerUrl() || "");
  }, [settings]);
  const openConnectForm = () => {
    setShowConnect(true);
    setFormError(null);
    setServerUrl((current) => current || settings?.activeProfile?.serverUrl || settings?.profiles[0]?.serverUrl || getServerUrl() || "");
  };
  const changeMode = async (enabled: boolean) => {
    if (enabled && (isMobileLocalMode() || !settings?.authorized)) {
      openConnectForm();
      return;
    }
    if (!enabled && !syncEnabled) {
      setShowConnect(false);
      setFormError(null);
      return;
    }
    setBusy(true); setError(null);
    try {
      if (enabled) await connectSyncServer({ serverUrl: settings?.profiles[0]?.serverUrl || getServerUrl() });
      else await disableSync();
      await reload();
    } catch {
      setError("mobileSync.settingsChangeFailed");
    } finally { setBusy(false); }
  };
  const submitConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);
    const result = await loginMobileSyncAccount(twoFactor
      ? { serverUrl: twoFactor.serverUrl, ticket: twoFactor.ticket, code }
      : { serverUrl, username, password });
    if (result.status === "requires_2fa") {
      setTwoFactor({ ticket: result.ticket, username: result.username, serverUrl: result.serverUrl });
      setPassword("");
      setCode("");
      setBusy(false);
      return;
    }
    if (result.status === "failed") {
      setFormError(
        result.reason === "network" ? t("auth.networkError")
          : result.reason === "two_factor_invalid" ? t("auth.twoFactor.verifyFailed")
            : result.reason === "two_factor_expired" ? t("auth.twoFactor.ticketExpired")
              : result.reason === "session" ? t("auth.loginSessionError")
                : result.message || t("auth.loginFailed"),
      );
      setBusy(false);
      return;
    }
    setBusy(false);
    setShowConnect(false);
    window.location.reload();
  };
  return <div className="space-y-4">
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{t("mobileSync.title")}</h3>
      {settings ? <>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-app-border p-4">
          <input type="radio" name="mobile-sync-mode" className="mt-1" checked={!syncEnabled && !showConnect} disabled={busy}
            onChange={() => { void changeMode(false); }} />
          <span className="space-y-1">
            <span className="block text-sm font-medium">{t("mobileSync.deviceOnly")}</span>
            <span className="block text-xs text-tx-tertiary">{t("mobileSync.deviceOnlyHint")}</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-app-border p-4">
          <input type="radio" name="mobile-sync-mode" className="mt-1" checked={syncEnabled || showConnect} disabled={busy}
            onChange={() => { void changeMode(true); }} />
          <span className="space-y-1">
            <span className="block text-sm font-medium">{t("mobileSync.ownServer")}</span>
            <span className="block text-xs text-tx-tertiary">{t("mobileSync.ownServerHint")}</span>
            {syncEnabled && <span className="block text-xs text-tx-secondary">{t("mobileSync.connected", { url: settings.activeProfile?.serverUrl || "" })}</span>}
          </span>
        </label>
        {showConnect && <form data-testid="mobile-sync-server-form" className="space-y-3 rounded-lg border border-app-border p-4" onSubmit={(event) => { void submitConnect(event); }}>
          <h4 className="text-sm font-medium">{twoFactor ? t("mobileSync.twoFactorTitle") : t("mobileSync.connectTitle")}</h4>
          <p className="text-xs leading-relaxed text-tx-tertiary">{twoFactor
            ? t("auth.twoFactor.prompt", { username: twoFactor.username })
            : t("mobileSync.connectHint")}</p>
          {twoFactor ? <label className="block space-y-1.5 text-xs">
            <span>{t("auth.twoFactor.codeLabel")}</span>
            <input type="text" name="mobile-sync-two-factor-code" autoComplete="one-time-code" value={code}
              onChange={(event) => setCode(event.target.value)} disabled={busy}
              className="w-full rounded border border-app-border bg-transparent px-3 py-2 text-sm" required />
            <span className="block text-tx-tertiary">{t("auth.twoFactor.codeHint")}</span>
          </label> : <>
            <label className="block space-y-1.5 text-xs">
              <span>{t("auth.serverAddress")}</span>
              <input type="url" name="mobile-sync-server-url" autoComplete="url" value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)} disabled={busy}
                placeholder={t("auth.serverPlaceholder")}
                className="w-full rounded border border-app-border bg-transparent px-3 py-2 text-sm" required />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-xs">
                <span>{t("auth.username")}</span>
                <input type="text" name="mobile-sync-username" autoComplete="username" value={username}
                  onChange={(event) => setUsername(event.target.value)} disabled={busy}
                  className="w-full rounded border border-app-border bg-transparent px-3 py-2 text-sm" required />
              </label>
              <label className="block space-y-1.5 text-xs">
                <span>{t("auth.password")}</span>
                <input type="password" name="mobile-sync-password" autoComplete="current-password" value={password}
                  onChange={(event) => setPassword(event.target.value)} disabled={busy}
                  className="w-full rounded border border-app-border bg-transparent px-3 py-2 text-sm" required />
              </label>
            </div>
          </>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className="rounded-md bg-accent-primary px-3 py-2 text-sm text-white disabled:opacity-50">
              {busy ? t("mobileSync.connecting") : twoFactor ? t("mobileSync.twoFactorAction") : t("mobileSync.connectAction")}
            </button>
            {twoFactor && <button type="button" disabled={busy} className="rounded-md border border-app-border px-3 py-2 text-sm disabled:opacity-50"
              onClick={() => { setTwoFactor(null); setCode(""); setFormError(null); }}>{t("mobileSync.backToPassword")}</button>}
            {!twoFactor && <button type="button" disabled={busy} className="rounded-md border border-app-border px-3 py-2 text-sm disabled:opacity-50"
              onClick={() => { setShowConnect(false); setFormError(null); }}>{t("common.cancel")}</button>}
          </div>
          {formError && <p role="alert" className="break-words text-xs text-red-500">{formError}</p>}
        </form>}
        <p className="text-xs text-tx-tertiary">{t("mobileSync.devicesHint")}</p>
      </> : <p className="text-sm text-tx-tertiary">{error ? t(error) : t("mobileSync.loadingSettings")}</p>}
    </section>
    {syncEnabled &&
    <section className="space-y-3 rounded-lg border border-app-border p-4">
      <h3 className="text-sm font-medium">{t("mobileSync.statusTitle")}</h3>
      <p className="text-sm text-tx-secondary">{diagnostics?.lastError ? t("mobileSync.waitingRecovery") : diagnostics ? t("mobileSync.enabled") : t("mobileSync.loadingStatus")}</p>
        <p className="text-xs text-tx-tertiary">{t("mobileSync.pendingChanges", { pending: diagnostics?.pendingMutations ?? "—" })}</p>
        <p className="text-xs text-tx-tertiary">{t("mobileSync.pendingAttachments", { pending: diagnostics?.pendingAttachments ?? "—" })}</p>
        <p className="text-xs text-tx-tertiary">{t("mobileSync.lastSync", { time: diagnostics?.lastSyncAt ? new Date(diagnostics.lastSyncAt).toLocaleString(i18n.language) : t("mobileSync.neverSynced") })}</p>
        <button type="button" disabled={busy} className="rounded-md border border-app-border px-3 py-2 text-sm disabled:opacity-50" onClick={async () => {
          setBusy(true);
          try { await triggerSyncNow(); await reload(); }
          catch { setError("mobileSync.startFailed"); }
          finally { setBusy(false); }
        }}>{busy ? t("mobileSync.requestingSync") : t("mobileSync.syncNow")}</button>
    </section>}
    {settings && error && <p className="text-xs text-tx-tertiary">{t(error)}</p>}
  </div>;
}
