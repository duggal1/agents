/** SQLite has no scalar lists, so string arrays are stored as JSON text. */
export function parseStringList(value: string | null | undefined): string[] {
  if (value == null || value === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export function serializeStringList(ids: string[]): string {
  return JSON.stringify(ids);
}
