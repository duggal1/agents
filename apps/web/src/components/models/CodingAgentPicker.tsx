import { Trans } from "@lingui/react/macro";
import type { CodingCliStatus } from "@sapphire/contracts";
import { Button, CodingAgentMark, cn } from "@sapphire/ui-web";

export function CodingAgentPicker({
  statuses,
  connectedProviders,
  selected,
  onSelect,
}: {
  /** Null while the status probe is in flight. */
  statuses: CodingCliStatus[] | null;
  connectedProviders: readonly string[];
  selected: string | null;
  onSelect: (provider: string) => void;
}) {
  if (statuses === null) {
    return <p className="text-sm text-muted-foreground">Checking installed coding agents…</p>;
  }
  return (
    <div className="grid gap-3">
      {statuses.map((status) => {
        const active = selected === status.provider;
        const connected = connectedProviders.includes(status.provider);
        const statusLine = !status.installed
          ? "Not installed"
          : !status.signedIn
            ? "Sign-in needed"
            : (status.version ?? "Signed in");
        return (
          <Button
            key={status.provider}
            type="button"
            variant="outline"
            disabled={!status.installed}
            aria-pressed={active}
            onClick={() => onSelect(status.provider)}
            className={cn(
              "flex h-auto items-center gap-3 px-3.5 py-3 text-left",
              active && "border-foreground",
            )}
          >
            <CodingAgentMark provider={status.provider} size={20} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-normal text-foreground">
                {status.name}
                {connected ? (
                  <span className="text-xs text-success">
                    <Trans>Connected</Trans>
                  </span>
                ) : null}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{statusLine}</span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}
