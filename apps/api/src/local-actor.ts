import type { Actor } from "@sapphire/contracts";
import type { PrismaClient } from "@sapphire/db";
import { bootstrapUserSpace, requireMembership } from "@sapphire/db";

/**
 * Local mode (RAKAZO_LOCAL_MODE=1): the Mac app is single-user, so there are
 * no sessions and no login. Every request runs as one fixed owner actor.
 *
 * An existing deployment owner keeps the seat (a database that already had
 * signups keeps working). Otherwise the local user row is created directly —
 * no Better Auth involved — and bootstrapped exactly like a first signup.
 */
const LOCAL_USER_EMAIL = "owner@sapphire.local";

export function isLocalMode(source: NodeJS.ProcessEnv = process.env): boolean {
  return source.RAKAZO_LOCAL_MODE === "1";
}

export const LOCAL_OWNER_EMAIL = LOCAL_USER_EMAIL;

let cached: Promise<Actor> | null = null;

export function resolveLocalActor(prisma: PrismaClient): Promise<Actor> {
  cached ??= provisionLocalActor(prisma).catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
}

async function provisionLocalActor(prisma: PrismaClient): Promise<Actor> {
  const settings = await prisma.deploymentSettings.findUnique({ where: { id: "default" } });
  const ownerId = settings?.ownerUserId ?? null;
  const owner = ownerId
    ? await prisma.user.findUnique({ where: { id: ownerId } })
    : await prisma.user.findUnique({ where: { email: LOCAL_USER_EMAIL } });
  const userId =
    owner?.id ??
    (
      await prisma.user.upsert({
        where: { email: LOCAL_USER_EMAIL },
        create: { id: "local-owner", name: "Owner", email: LOCAL_USER_EMAIL, emailVerified: true },
        update: {},
        select: { id: true },
      })
    ).id;
  await bootstrapUserSpace(
    prisma,
    { id: userId },
    { signupsEnabled: "true", signupAllowlist: "" },
    { claimDeploymentOwner: true },
  );
  return requireMembership(prisma, userId, null);
}
