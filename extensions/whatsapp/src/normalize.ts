import { looksLikeHandleOrPhoneTarget, trimMessagingTarget } from "openclaw/plugin-sdk";
import { normalizeWhatsAppTarget } from "openclaw/plugin-sdk";

export function normalizeWhatsAppMessagingTarget(raw: string): string | undefined {
  const trimmed = trimMessagingTarget(raw);
  if (!trimmed) {
    return undefined;
  }
  return normalizeWhatsAppTarget(trimmed) ?? undefined;
}

export function normalizeWhatsAppAllowFromEntries(allowFrom: Array<string | number>): string[] {
  return allowFrom
    .map((entry) => String(entry).trim())
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => (entry === "*" ? entry : normalizeWhatsAppTarget(entry)))
    .filter((entry): entry is string => Boolean(entry));
}

export function looksLikeWhatsAppTargetId(raw: string): boolean {
  return looksLikeHandleOrPhoneTarget({
    raw,
    prefixPattern: /^whatsapp:/i,
  });
}
