import { useLingui } from "@lingui/react/macro";
import { desktopBridge, windowChromeKind } from "../lib/desktop";

export function WindowChrome() {
  const { t } = useLingui();
  const desktop = desktopBridge();
  const kind = windowChromeKind(desktop);
  if (kind === "spacer") {
    return <div className="h-3 w-[72px]" aria-hidden="true" />;
  }
  if (kind === "darwin") {
    return <div className="app-drag h-3 w-[72px]" aria-hidden="true" />;
  }
  return (
    <div className="app-drag flex gap-[7px]" data-slot="window-chrome">
      <button
        type="button"
        className="app-no-drag h-3 w-3 cursor-pointer rounded-full bg-[#FF5F57] transition-colors duration-150 hover:brightness-110 active:opacity-90"
        aria-label={t`Close`}
        onClick={() => void desktop?.window.close()}
      />
      <button
        type="button"
        className="app-no-drag h-3 w-3 cursor-pointer rounded-full bg-[#FEBC2E] transition-colors duration-150 hover:brightness-110 active:opacity-90"
        aria-label={t`Minimize`}
        onClick={() => void desktop?.window.minimize()}
      />
      <button
        type="button"
        className="app-no-drag h-3 w-3 cursor-pointer rounded-full bg-[#28C840] transition-colors duration-150 hover:brightness-110 active:opacity-90"
        aria-label={t`Fullscreen`}
        onClick={() => void desktop?.window.toggleMaximize()}
      />
    </div>
  );
}
