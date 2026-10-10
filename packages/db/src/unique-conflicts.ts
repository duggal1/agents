/**
 * SQLite's Prisma client rejects `createMany({ skipDuplicates: true })`, so
 * insert-or-ignore is expressed as a plain batch create whose unique-constraint
 * conflict is swallowed: the first writer wins, matching Postgres's
 * skipDuplicates for the single-row batches every caller passes.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function createManyIgnoringConflicts<T>(
  delegate: { createMany(args: { data: T[] }): Promise<unknown> },
  data: T[],
): Promise<void> {
  await delegate.createMany({ data }).catch((error: unknown) => {
    if (!isUniqueConstraintError(error)) throw error;
  });
}
