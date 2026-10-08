import { textDirectionForLocale } from "@sapphire/core";
import { resolveUiLocale } from "./ui-locale";

export function applyUiDirection(locale: string = resolveUiLocale()) {
  const direction = textDirectionForLocale(locale);
  document.documentElement.dir = direction;
  document.documentElement.lang = locale;
  return direction;
}
