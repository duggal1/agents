import { describe, expect, it } from "vitest";
import { parseStringList, serializeStringList } from "./string-list.js";

describe("string list helpers", () => {
  it("round-trips arrays through JSON text", () => {
    expect(parseStringList(serializeStringList(["a", "b"]))).toEqual(["a", "b"]);
    expect(parseStringList(serializeStringList([]))).toEqual([]);
  });

  it("defaults empty and missing values to []", () => {
    expect(parseStringList("[]")).toEqual([]);
    expect(parseStringList(null)).toEqual([]);
    expect(parseStringList(undefined)).toEqual([]);
    expect(parseStringList("")).toEqual([]);
  });

  it("ignores corrupt or non-string payloads instead of throwing", () => {
    expect(parseStringList("not json")).toEqual([]);
    expect(parseStringList("{}")).toEqual([]);
    expect(parseStringList('["ok", 1, null]')).toEqual(["ok"]);
  });
});
