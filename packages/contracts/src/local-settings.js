/** Local host capability: limited to server configuration and its owner's model settings. */
export const LOCAL_SETTINGS_PAGE = "/desktop-settings";
export const LOCAL_SETTINGS_RPC = "/api/desktop-settings/rpc";
export const LOCAL_SETTINGS_TOKEN_HEADER = "x-rakazo-local-settings-token";

const procedures = new Set([
  "me",
  "models/list",
  "models/credentials",
  "models/connect",
  "models/codingCliStatus",
  "models/beginOAuth",
  "models/submitOAuthCode",
  "models/completeOAuth",
  "models/finishOAuth",
  "models/cancelOAuth",
  "models/setDefault",
  "integrationSetup/get",
  "integrationSetup/save",
  "integrationSetup/importEnv",
]);

/** @param {string} pathname */
export function isLocalSettingsProcedure(pathname) {
  return (
    pathname.startsWith(`${LOCAL_SETTINGS_RPC}/`) &&
    procedures.has(pathname.slice(LOCAL_SETTINGS_RPC.length + 1))
  );
}
