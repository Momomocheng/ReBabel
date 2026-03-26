export const BOOK_TEXT_EXPORT_SCOPE_VALUES = [
  "whole-book",
  "translated-only",
  "reading-section",
] as const;

export type BookTextExportScope =
  (typeof BOOK_TEXT_EXPORT_SCOPE_VALUES)[number];

export const BOOK_READABLE_EXPORT_FORMAT_VALUES = [
  "html",
  "markdown",
  "txt",
] as const;

export type BookReadableExportFormat =
  (typeof BOOK_READABLE_EXPORT_FORMAT_VALUES)[number];

export const DEFAULT_BOOK_TEXT_EXPORT_SCOPE = "whole-book";
export const DEFAULT_BOOK_READABLE_EXPORT_FORMAT = "html";

export function normalizeBookTextExportScope(
  value: string | null | undefined,
): BookTextExportScope {
  if (
    value &&
    (BOOK_TEXT_EXPORT_SCOPE_VALUES as readonly string[]).includes(value)
  ) {
    return value as BookTextExportScope;
  }

  return DEFAULT_BOOK_TEXT_EXPORT_SCOPE;
}

export function normalizeBookReadableExportFormat(
  value: string | null | undefined,
): BookReadableExportFormat {
  if (
    value &&
    (BOOK_READABLE_EXPORT_FORMAT_VALUES as readonly string[]).includes(value)
  ) {
    return value as BookReadableExportFormat;
  }

  return DEFAULT_BOOK_READABLE_EXPORT_FORMAT;
}
