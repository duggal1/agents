import type { SearchHit } from "@sapphire/contracts";
import { rpc } from "./api";

export async function querySpaceSearch(q: string): Promise<SearchHit[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const result = await rpc<{ hits: SearchHit[] }>("search/query", { q: trimmed });
  return result.hits;
}
