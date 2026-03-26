import type {
  BookRecord,
  TranslationReviewStatus,
  TranslationStatus,
} from "@/lib/books/types";
import { getTranslationReviewStatusLabel } from "@/lib/books/review-status";

const REVIEW_CHECKLIST_FILE_TYPE = "rebabel-review-checklist";
const REVIEW_CHECKLIST_FILE_VERSION = 1;

export type ReaderReviewChecklistItem = {
  bookmarkNote: string;
  paragraphIndex: number;
  reviewStatus: TranslationReviewStatus;
  sectionTitle: string;
  sourceText: string;
  translatedText: string | null;
  translationStatus: TranslationStatus;
};

function sanitizeFileSegment(value: string) {
  const normalized = value
    .trim()
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "rebabel-review";
}

function formatExportDate(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function getTranslationStatusLabel(status: TranslationStatus) {
  switch (status) {
    case "done":
      return "已翻译";
    case "translating":
      return "翻译中";
    case "error":
      return "失败";
    default:
      return "待翻译";
  }
}

export function buildReaderReviewChecklistFileName(
  book: Pick<BookRecord, "title">,
  options: {
    extension: "json" | "txt";
    filterLabel: string;
    scopeLabel: string;
  },
) {
  const dateStamp = new Date().toISOString().slice(0, 10);

  return `${sanitizeFileSegment(book.title)}-${sanitizeFileSegment(
    `${options.filterLabel}-${options.scopeLabel}`,
  )}-review-checklist-${dateStamp}.${options.extension}`;
}

export function buildReaderReviewChecklistJsonExport(options: {
  book: Pick<BookRecord, "id" | "originalFileName" | "title">;
  filterLabel: string;
  items: ReaderReviewChecklistItem[];
  query: string | null;
  scopeLabel: string;
}) {
  return {
    book: {
      id: options.book.id,
      originalFileName: options.book.originalFileName,
      title: options.book.title,
    },
    exportedAt: new Date().toISOString(),
    items: options.items.map((item) => ({
      bookmarkNote: item.bookmarkNote,
      paragraphIndex: item.paragraphIndex,
      reviewStatus: item.reviewStatus,
      sectionTitle: item.sectionTitle,
      sourceText: item.sourceText,
      translatedText: item.translatedText,
      translationStatus: item.translationStatus,
    })),
    type: REVIEW_CHECKLIST_FILE_TYPE,
    version: REVIEW_CHECKLIST_FILE_VERSION,
    view: {
      filterLabel: options.filterLabel,
      paragraphCount: options.items.length,
      query: options.query,
      scopeLabel: options.scopeLabel,
    },
  };
}

export function buildReaderReviewChecklistTextExport(options: {
  book: Pick<BookRecord, "originalFileName" | "title">;
  filterLabel: string;
  items: ReaderReviewChecklistItem[];
  query: string | null;
  scopeLabel: string;
}) {
  return [
    `# ${options.book.title} · 复查清单`,
    "",
    `导出时间：${formatExportDate(new Date().toISOString())}`,
    `源文件：${options.book.originalFileName}`,
    `当前视图：${options.filterLabel}`,
    `当前范围：${options.scopeLabel}`,
    `导出条目：${options.items.length}`,
    ...(options.query ? [`搜索词：${options.query}`] : []),
    "",
    ...options.items.flatMap((item) => [
      `## Paragraph ${item.paragraphIndex + 1}${item.sectionTitle ? ` · ${item.sectionTitle}` : ""}`,
      `- 翻译状态：${getTranslationStatusLabel(item.translationStatus)}`,
      `- 复查状态：${getTranslationReviewStatusLabel(item.reviewStatus)}`,
      `- 书签批注：${item.bookmarkNote || "无"}`,
      "",
      "EN",
      item.sourceText,
      "",
      "ZH",
      item.translatedText || "这段还没有译文。",
      "",
    ]),
  ]
    .join("\n")
    .trim();
}
