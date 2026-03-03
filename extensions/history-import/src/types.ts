/**
 * Normalized conversation types shared across parsers.
 */

export type NormalizedMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
};

export type NormalizedConversation = {
  id: string;
  title?: string;
  messages: NormalizedMessage[];
  source: "chatgpt" | "claude";
  createdAt?: number;
};

export type ImportSource = "chatgpt" | "claude";

export type ImportOptions = {
  source?: ImportSource;
  dryRun?: boolean;
  maxConversations?: number;
  workspaceDir?: string;
};

export type ImportResult = {
  source: ImportSource;
  totalConversations: number;
  importedConversations: number;
  totalMessages: number;
  filesWritten: string[];
  skipped: number;
  errors: string[];
};
