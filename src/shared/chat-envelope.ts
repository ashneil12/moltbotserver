const ENVELOPE_PREFIX = /^\[([^\]]+)\]\s*/;
const ENVELOPE_CHANNELS = [
  "WebChat",
  "WhatsApp",
  "Telegram",
  "Signal",
  "Slack",
  "Discord",
  "Google Chat",
  "iMessage",
  "Teams",
  "Matrix",
  "Zalo",
  "Zalo Personal",
  "BlueBubbles",
];

const MESSAGE_ID_LINE = /^\s*\[message_id:\s*[^\]]+\]\s*$/i;
function looksLikeEnvelopeHeader(header: string): boolean {
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z\b/.test(header)) {
    return true;
  }
  if (/\d{4}-\d{2}-\d{2} \d{2}:\d{2}\b/.test(header)) {
    return true;
  }
  return ENVELOPE_CHANNELS.some((label) => header.startsWith(`${label} `));
}

export function stripEnvelope(text: string): string {
  const match = text.match(ENVELOPE_PREFIX);
  if (!match) {
    return text;
  }
  const header = match[1] ?? "";
  if (!looksLikeEnvelopeHeader(header)) {
    return text;
  }
  return text.slice(match[0].length);
}

export function stripMessageIdHints(text: string): string {
  if (!text.includes("[message_id:")) {
    return text;
  }
  const lines = text.split(/\r?\n/);
  const filtered = lines.filter((line) => !MESSAGE_ID_LINE.test(line));
  return filtered.length === lines.length ? text : filtered.join("\n");
}

/**
 * Strip untrusted metadata / context blocks injected by {@link buildInboundUserContextPrefix}.
 *
 * These blocks follow the pattern:
 *   Label (untrusted metadata):\n```json\n...\n```
 *   Label (untrusted, for context):\n```json\n...\n```
 *
 * They are intended for the LLM only and should not be rendered in the chat UI.
 */
const UNTRUSTED_BLOCK =
  /^[^\n]*\(untrusted(?:\s+metadata|,\s*for\s+context)\):\s*\n```json\n[\s\S]*?\n```\s*(?:\n|$)/gm;

export function stripUntrustedMetaBlocks(text: string): string {
  if (!text.includes("(untrusted")) {
    return text;
  }
  return text.replace(UNTRUSTED_BLOCK, "").trim();
}
