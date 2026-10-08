import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { withTransactionRetry } from "./transaction-retry.js";

type CredentialSecretClient = Pick<
  PrismaClient,
  "secret" | "userModelCredential" | "userVoiceCredential"
>;

export async function deleteUnreferencedCredentialSecret(
  prisma: CredentialSecretClient,
  input: {
    credentialKind: "model" | "voice";
    credentialId: string;
    secretId: string;
  },
): Promise<void> {
  const [modelReferences, voiceReferences] = await Promise.all([
    prisma.userModelCredential.count({
      where: {
        secretId: input.secretId,
        ...(input.credentialKind === "model" ? { id: { not: input.credentialId } } : {}),
      },
    }),
    prisma.userVoiceCredential.count({
      where: {
        secretId: input.secretId,
        ...(input.credentialKind === "voice" ? { id: { not: input.credentialId } } : {}),
      },
    }),
  ]);
  if (modelReferences + voiceReferences === 0) {
    await prisma.secret.deleteMany({ where: { id: input.secretId } });
  }
}

/**
 * Drop a model credential whose stored OAuth material is dead, along with the
 * secret row nothing else references. The provider then reports `disconnected`
 * through the existing catalog auth machinery.
 *
 * Two guards keep a stale failure from deleting newer material:
 * - `secretId`: a reconnect swaps the credential to a fresh secret row, so a
 *   mismatch means the retired material is already gone — leave it alone.
 * - `matchesFailedSecret`: a concurrent successful refresh rewrites the SAME
 *   secret row in place, leaving `secretId` unchanged. The predicate is called
 *   inside this serializable transaction with the credential's current secret
 *   row and returns whether it still holds the exact credential state whose
 *   refresh failed; a mismatch means a newer credential won the race and the
 *   delete is skipped. When the secret row itself is already gone there is
 *   nothing newer to protect, so the credential is still deleted.
 */
export async function retireModelCredential(
  prisma: Pick<PrismaClient, "$transaction">,
  input: {
    userId: string;
    credentialId: string;
    secretId?: string;
    matchesFailedSecret?: (secret: { id: string; ciphertext: string }) => boolean;
  },
): Promise<boolean> {
  if (!input.credentialId) return false;
  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const credential = await tx.userModelCredential.findFirst({
          where: { id: input.credentialId, userId: input.userId },
        });
        if (!credential || (input.secretId && credential.secretId !== input.secretId)) return false;
        if (input.matchesFailedSecret) {
          const secret = await tx.secret.findFirst({
            where: { id: credential.secretId },
            select: { id: true, ciphertext: true },
          });
          if (secret && !input.matchesFailedSecret(secret)) return false;
        }
        await tx.spaceModelPreference.deleteMany({
          where: { userId: input.userId, credentialId: credential.id },
        });
        await tx.userModelCredential.delete({ where: { id: credential.id } });
        await deleteUnreferencedCredentialSecret(tx, {
          credentialKind: "model",
          credentialId: credential.id,
          secretId: credential.secretId,
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
