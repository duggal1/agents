import { Trans } from "@lingui/react/macro";
import type { LocalRuntimeStatus } from "@sapphire/contracts";
import { Button, Input, RakazoMark, Switch } from "@sapphire/ui-web";
import { useEffect, useState } from "react";
import { IntegrationSetup } from "../components/integrations/IntegrationSetup";
import { desktopBridge } from "../lib/desktop";
import { rpc } from "../lib/rpc";
import { ModelSettingsOverlay } from "./ModelSettingsOverlay";
import { WindowChrome } from "./WindowChrome";

export function LocalSettingsPage() {
  const [section, setSection] = useState<"models" | "integrations" | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    void rpc.integrationSetup
      .get()
      .then(() => setReady(true))
      .catch(() => setError(true));
  }, []);
  return (
    <main className="flex h-full flex-col overflow-auto bg-background">
      <div className="app-drag flex items-center gap-3 px-5 py-[18px]">
        <WindowChrome />
        <RakazoMark className="app-no-drag text-foreground" size={20} />
      </div>
      <div className="mx-auto w-full max-w-xl space-y-6 px-6 pb-12">
        <h1 className="text-2xl font-normal tracking-tight text-foreground antialiased">
          <Trans>Local Server Settings</Trans>
        </h1>
        {error ? (
          <p role="alert">
            <Trans>
              Could not open local settings. Start the local server and create its owner account,
              then try again.
            </Trans>
          </p>
        ) : null}
        {ready ? (
          <>
            <RuntimeSection />
            <nav className="flex gap-2">
              <Button variant="outline" onClick={() => setSection("models")}>
                <Trans>Models</Trans>
              </Button>
              <Button
                variant="outline"
                onClick={() => setSection(section === "integrations" ? null : "integrations")}
              >
                <Trans>Server integrations</Trans>
              </Button>
            </nav>
            {section === "models" ? (
              <ModelSettingsOverlay onClose={() => setSection(null)} localOwner />
            ) : null}
            {section === "integrations" ? <IntegrationSetup serverSetup managedOnly /> : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

/**
 * Bot-computer posture for the packaged desktop app: enter or replace the E2B
 * key later, and toggle the per-install Docker fallback. Rendered only when
 * the desktop runtime bridge exists. The key itself is write-only here; the
 * bridge returns booleans, never the stored key.
 */
function RuntimeSection() {
  const runtime = desktopBridge()?.runtime;
  const [status, setStatus] = useState<LocalRuntimeStatus | null>(null);
  const [key, setKey] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!runtime) return;
    void runtime.status().then(setStatus).catch(() => undefined);
  }, [runtime]);
  if (!runtime) return null;

  const refresh = async () => {
    setStatus(await runtime.status().catch(() => null));
  };
  const run = async (action: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      if (result.ok) {
        setKey("");
        setNotice(done);
        await refresh();
      } else {
        setNotice(result.error ?? "Could not save that change.");
      }
    } catch {
      setNotice("Could not save that change.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="text-base font-medium text-foreground">
        <Trans>Bot computers</Trans>
      </h2>
      <p className="text-sm text-muted-foreground">
        {status?.hasE2BKey ? (
          <Trans>E2B key saved. Computers use E2B.</Trans>
        ) : (
          <Trans>No E2B key saved. Computers stay unavailable unless Docker fallback is on.</Trans>
        )}
      </p>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="e2b_…"
          aria-label="E2B API key"
          value={key}
          disabled={busy}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={busy || key.trim() === ""}
          onClick={() => void run(() => runtime.setKey(key), "E2B key saved.")}
        >
          <Trans>{status?.hasE2BKey ? "Replace" : "Save"}</Trans>
        </Button>
        {status?.hasE2BKey ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => runtime.clearKey(), "E2B key removed.")}
          >
            <Trans>Remove</Trans>
          </Button>
        ) : null}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <Switch
          checked={status?.allowDockerComputerFallback ?? false}
          disabled={busy}
          onCheckedChange={(checked) =>
            void run(() => runtime.setFallbackAllowed(checked), "Fallback setting saved.")
          }
        />
        <Trans>Allow Docker computer fallback</Trans>
      </label>
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
