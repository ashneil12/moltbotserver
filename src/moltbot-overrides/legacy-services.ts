export const MOLTBOT_LEGACY_MARKERS = ["clawdbot", "moltbot"] as const;
export const MOLTBOT_LEGACY_SYSTEMD_SERVICES = ["clawdbot-gateway", "moltbot-gateway"];
export type MoltBotLegacyMarker = (typeof MOLTBOT_LEGACY_MARKERS)[number];

export function isMoltBotLegacyLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return MOLTBOT_LEGACY_MARKERS.some((marker) => lower.includes(marker));
}
