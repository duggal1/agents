import { Trans } from "@lingui/react/macro";
import { Button, RakazoMark } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { IntegrationSetup } from "../components/integrations/IntegrationSetup";
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
