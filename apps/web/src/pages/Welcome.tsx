import { Trans } from "@lingui/react/macro";
import { RakazoMark } from "@rakazo/ui-web";
import { useNavigate } from "react-router-dom";
import { WindowChrome } from "./WindowChrome";

export function WelcomePage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-full flex-col bg-background" data-rakazo-surface="welcome">
      <div className="app-drag flex items-center gap-3 px-5 py-[18px]">
        <WindowChrome />
        <RakazoMark className="app-no-drag text-foreground" size={20} />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-11 pb-[90px]">
        <div className="flex items-center gap-[26px]">
          <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-accent">
            <RakazoMark className="text-foreground" size={44} />
          </div>
          <div className="text-[76px] leading-none font-normal tracking-[-0.03em] text-foreground antialiased">
            Rakazo
          </div>
        </div>
        <p className="max-w-[600px] text-center text-[27px] leading-[1.4] font-normal text-foreground/75">
          <Trans>
            Your team of always-on agents
            <br />
            that you can give real work to.
          </Trans>
        </p>
        <button
          type="button"
          onClick={() => navigate("/sign-up")}
          className="app-no-drag cursor-pointer rounded-full bg-accent px-[34px] py-[15px] text-[19px] font-normal text-foreground transition-colors duration-150 hover:bg-muted active:opacity-90"
        >
          <Trans>Sign up</Trans>&nbsp;&nbsp;→
        </button>
      </div>
    </div>
  );
}
