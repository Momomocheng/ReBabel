export const DEFAULT_TRANSLATION_CONTEXT_SIZE = 2;
export const MIN_TRANSLATION_CONTEXT_SIZE = 0;
export const MAX_TRANSLATION_CONTEXT_SIZE = 6;
export const TRANSLATION_BATCH_SCOPE_VALUES = [
  "remaining",
  "failed",
  "from-reading-position",
] as const;
export const DEFAULT_TRANSLATION_BATCH_SCOPE = "remaining";
export const MIN_TRANSLATION_REQUEST_DELAY_MS = 0;
export const MAX_TRANSLATION_REQUEST_DELAY_MS = 5000;

export type TranslationBatchScope =
  (typeof TRANSLATION_BATCH_SCOPE_VALUES)[number];

export const TRANSLATION_BATCH_SESSION_STATUS_VALUES = [
  "running",
  "stopped",
  "completed",
  "failed",
] as const;

export type TranslationBatchSessionStatus =
  (typeof TRANSLATION_BATCH_SESSION_STATUS_VALUES)[number];

export type TranslationBatchSession = {
  batchScope: TranslationBatchScope;
  bookId: string;
  failedCount: number;
  lastProcessedParagraphIndex: number | null;
  processedCount: number;
  queueTotal: number;
  startedAt: string;
  status: TranslationBatchSessionStatus;
  successCount: number;
  updatedAt: string;
};

export function normalizeTranslationContextSize(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_TRANSLATION_CONTEXT_SIZE;
  }

  return Math.min(
    Math.max(Math.floor(value ?? DEFAULT_TRANSLATION_CONTEXT_SIZE), MIN_TRANSLATION_CONTEXT_SIZE),
    MAX_TRANSLATION_CONTEXT_SIZE,
  );
}

export function normalizeTranslationBatchScope(
  value: string | null | undefined,
): TranslationBatchScope {
  if (
    value &&
    (TRANSLATION_BATCH_SCOPE_VALUES as readonly string[]).includes(value)
  ) {
    return value as TranslationBatchScope;
  }

  return DEFAULT_TRANSLATION_BATCH_SCOPE;
}

export function normalizeTranslationRequestDelayMs(
  value: number | null | undefined,
) {
  if (!Number.isFinite(value)) {
    return MIN_TRANSLATION_REQUEST_DELAY_MS;
  }

  return Math.min(
    Math.max(
      Math.floor(value ?? MIN_TRANSLATION_REQUEST_DELAY_MS),
      MIN_TRANSLATION_REQUEST_DELAY_MS,
    ),
    MAX_TRANSLATION_REQUEST_DELAY_MS,
  );
}
