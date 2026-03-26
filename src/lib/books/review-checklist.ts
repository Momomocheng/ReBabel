import type {
  BookRecord,
  TranslationReviewStatus,
  TranslationStatus,
} from "@/lib/books/types";
import { ZodError, z } from "zod";
import {
  getTranslationReviewStatusLabel,
  normalizeTranslationReviewStatus,
} from "@/lib/books/review-status";

const REVIEW_CHECKLIST_FILE_TYPE = "rebabel-review-checklist";
const REVIEW_CHECKLIST_FILE_VERSION = 1;

const reviewChecklistItemSchema = z.object({
  bookmarkNote: z.string().optional(),
  paragraphIndex: z.number().int().nonnegative(),
  reviewStatus: z.string().optional(),
  sectionTitle: z.string().optional(),
  sourceText: z.string().optional(),
  translatedText: z.string().nullable().optional(),
  translationStatus: z.string().optional(),
});

const reviewChecklistFileSchema = z.object({
  book: z
    .object({
      id: z.string().optional(),
      originalFileName: z.string().optional(),
      title: z.string().optional(),
    })
    .optional(),
  exportedAt: z.string().optional(),
  items: z.array(reviewChecklistItemSchema),
  type: z.literal(REVIEW_CHECKLIST_FILE_TYPE),
  version: z.literal(REVIEW_CHECKLIST_FILE_VERSION),
  view: z
    .object({
      filterLabel: z.string().optional(),
      paragraphCount: z.number().optional(),
      query: z.string().nullable().optional(),
      scopeLabel: z.string().optional(),
    })
    .optional(),
});

export type ReaderReviewChecklistItem = {
  bookmarkNote: string;
  paragraphIndex: number;
  reviewStatus: TranslationReviewStatus;
  sectionTitle: string;
  sourceText: string;
  translatedText: string | null;
  translationStatus: TranslationStatus;
};

type ImportedReaderReviewChecklist = {
  book: {
    id: string;
    originalFileName: string;
    title: string;
  } | null;
  items: ReaderReviewChecklistItem[];
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

function normalizeTranslationStatus(
  status: string | null | undefined,
): TranslationStatus {
  switch (status) {
    case "done":
    case "translating":
    case "error":
      return status;
    default:
      return "pending";
  }
}

function normalizeReviewChecklistItem(
  item: z.infer<typeof reviewChecklistItemSchema>,
): ReaderReviewChecklistItem {
  return {
    bookmarkNote: item.bookmarkNote?.trim() ?? "",
    paragraphIndex: item.paragraphIndex,
    reviewStatus: normalizeTranslationReviewStatus(item.reviewStatus),
    sectionTitle: item.sectionTitle?.trim() ?? "",
    sourceText: item.sourceText?.trim() ?? "",
    translatedText: item.translatedText?.trim() || null,
    translationStatus: normalizeTranslationStatus(item.translationStatus),
  };
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

export function parseReaderReviewChecklistImport(
  jsonText: string,
): ImportedReaderReviewChecklist {
  try {
    const parsed = reviewChecklistFileSchema.parse(JSON.parse(jsonText) as unknown);
    const items = parsed.items.map(normalizeReviewChecklistItem);

    if (items.length === 0) {
      throw new Error("复查清单里没有任何段落。");
    }

    return {
      book: parsed.book
        ? {
            id: parsed.book.id?.trim() ?? "",
            originalFileName: parsed.book.originalFileName?.trim() ?? "",
            title: parsed.book.title?.trim() ?? "",
          }
        : null,
      items,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("复查清单文件不是有效的 JSON。");
    }

    if (error instanceof ZodError) {
      throw new Error("复查清单格式不正确。请导入 ReBabel 导出的 JSON 清单。");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("读取复查清单失败。");
  }
}
