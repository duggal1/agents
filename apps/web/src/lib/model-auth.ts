import { waitForModelOAuthCompletion } from "@sapphire/core";
import { rpc } from "./rpc";

export type { ModelCatalogEntry, ModelCredential, ModelOAuthBegin } from "@sapphire/contracts";
export { cancelModelOAuthAttempt, finishModelOAuthAttempt } from "@sapphire/core";

export async function waitForModelOAuth(loginId: string, signal?: AbortSignal) {
  return waitForModelOAuthCompletion(() => rpc.models.completeOAuth({ loginId }, { signal }), {
    signal,
  });
}
