"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BookOpenText,
  Download,
  Import,
  Languages,
  LoaderCircle,
  PanelsTopLeft,
  Plus,
  Redo2,
  RefreshCcw,
  Square,
  Trash2,
  Undo2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  clearBookTranslations,
  getBookTranslationStats,
  updateBookParagraph,
} from "@/lib/books/book-record";
import {
  buildBookExportFileName,
  buildBookHtmlExport,
  buildBookJsonExport,
  buildBookMarkdownExport,
  buildBookPlainTextExport,
  getBookTextExportPreview,
  parseBookJsonImport,
} from "@/lib/books/book-export";
import {
  DEFAULT_BOOK_READABLE_EXPORT_FORMAT,
  DEFAULT_BOOK_TEXT_EXPORT_SCOPE,
  normalizeBookReadableExportFormat,
  normalizeBookTextExportScope,
  type BookReadableExportFormat,
  type BookTextExportScope,
} from "@/lib/books/export-options";
import {
  countLikelyNoiseParagraphs,
  countShortParagraphs,
  isLikelyNoiseParagraph,
  isShortParagraph,
  matchesImportDraftSearch,
  normalizeImportDraftParagraph,
  normalizeImportDraftParagraphs,
} from "@/lib/books/import-cleaning";
import {
  buildBookStats,
  createBookParagraphs,
  deriveTitleFromFileName,
  parseTxtParagraphs,
  splitPlainTextParagraphs,
} from "@/lib/books/parser";
import {
  buildParagraphSectionIds,
  buildSectionsFromParagraphSectionIds,
  createDefaultBookSections,
  getSectionIndexForParagraph,
} from "@/lib/books/sections";
import { parseEpubFile } from "@/lib/books/epub";
import { deleteBook, listBooks, saveBook } from "@/lib/db/rebabel-db";
import {
  buildGlossaryExport,
  getEffectiveGlossaryTerms,
  parseGlossaryImport,
} from "@/lib/translation/glossary";
import {
  classifyTranslationError,
  type TranslationErrorCategory,
} from "@/lib/translation/error-classification";
import {
  DEFAULT_TRANSLATION_BATCH_SCOPE,
  DEFAULT_TRANSLATION_CONTEXT_SIZE,
  MAX_TRANSLATION_CONTEXT_SIZE,
  MAX_TRANSLATION_REQUEST_DELAY_MS,
  MIN_TRANSLATION_REQUEST_DELAY_MS,
  MIN_TRANSLATION_CONTEXT_SIZE,
  normalizeTranslationBatchScope,
  normalizeTranslationContextSize,
  normalizeTranslationRequestDelayMs,
  type TranslationBatchSession,
  type TranslationBatchScope,
} from "@/lib/translation/preferences";
import { translateParagraph } from "@/lib/translation/openai-compatible";
import type { GlossaryTerm } from "@/lib/translation/types";
import type { BookRecord, BookSection, TranslationStatus } from "@/lib/books/types";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useTranslationPreferencesStore } from "@/stores/translation-preferences-store";

const promptInputClassName =
  "mt-2 w-full rounded-2xl border border-[color:var(--line)] bg-white/85 px-4 py-3 text-sm leading-7 outline-none transition placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]";

function createBookId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `book-${Date.now()}`;
}

function createBookRecord({
  fileName,
  paragraphs,
  sections,
  title,
}: {
  fileName: string;
  paragraphs: BookRecord["paragraphs"];
  sections: BookRecord["sections"];
  title?: string;
}): BookRecord {
  const now = new Date().toISOString();

  return {
    id: createBookId(),
    title: title?.trim() || deriveTitleFromFileName(fileName),
    originalFileName: fileName,
    createdAt: now,
    updatedAt: now,
    bookmarks: [],
    paragraphs,
    sections,
    readingProgress: {
      lastReadAt: null,
      lastReadParagraphIndex: 0,
    },
    stats: buildBookStats(paragraphs),
  };
}

function formatRelativeDate(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function parseParagraphIndexParam(rawValue: string | null) {
  if (!rawValue) {
    return null;
  }

  const paragraphNumber = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(paragraphNumber) || paragraphNumber < 1) {
    return null;
  }

  return paragraphNumber - 1;
}

function getStatusLabel(status: TranslationStatus) {
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

function getStatusClassName(status: TranslationStatus) {
  switch (status) {
    case "done":
      return "bg-emerald-100 text-emerald-800";
    case "translating":
      return "bg-amber-100 text-amber-800";
    case "error":
      return "bg-red-100 text-red-700";
    default:
      return "bg-stone-200 text-stone-700";
  }
}

function getSingleParagraphActionLabel(
  paragraph: BookRecord["paragraphs"][number],
) {
  switch (paragraph.translationStatus) {
    case "error":
      return "重试本段";
    case "done":
      return "润色本段";
    case "translating":
      return "翻译中";
    default:
      return paragraph.translatedText ? "继续改写" : "补译本段";
  }
}

function getTargetedParagraphWorkflowHint(
  paragraph: BookRecord["paragraphs"][number],
) {
  switch (paragraph.translationStatus) {
    case "error":
      return "这段上次翻译失败了，最合理的处理是先单段重试，再决定是否继续整批跑剩余内容。";
    case "done":
      return "这段已经有译文。若语气、术语或节奏不满意，可以直接单段润色。";
    case "translating":
      return "这段正在翻译中。等当前请求结束后，你可以继续处理相邻上下文或返回阅读器查看结果。";
    default:
      return "这段还没有译文。可以先单段补译，确认风格没问题后再继续批量翻译。";
  }
}

function buildLibraryHref(
  bookId: string,
  options?: {
    paragraph?: number | null;
  },
) {
  const params = new URLSearchParams();

  params.set("book", bookId);

  if (options?.paragraph && options.paragraph > 0) {
    params.set("p", String(Math.floor(options.paragraph)));
  }

  return `/library?${params.toString()}`;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "发生未知错误。";
}

type ImportDraft = {
  originalFileName: string;
  paragraphSectionIds: string[];
  paragraphs: string[];
  parsedParagraphSectionIds: string[];
  parsedParagraphs: string[];
  parsedSections: BookSection[];
  parsedTitle: string;
  title: string;
};

type FailedParagraphGroup = {
  category: TranslationErrorCategory;
  count: number;
  hint: string;
  label: string;
  latestMessage: string;
  paragraphIndexes: number[];
  requiresSettingsChange: boolean;
  retryable: boolean;
};

const BATCH_SCOPE_OPTIONS: Array<{
  description: string;
  label: string;
  value: TranslationBatchScope;
}> = [
  {
    value: "remaining",
    label: "未完成段落",
    description: "处理整本书里所有待翻译和失败段落，适合第一次完整跑书。",
  },
  {
    value: "failed",
    label: "仅失败段落",
    description: "只重试报错段落，不重复请求已经成功的译文。",
  },
  {
    value: "from-reading-position",
    label: "从阅读位置继续",
    description: "从这本书上次阅读位置开始，只处理后面的待翻译和失败段落。",
  },
];

const TEXT_EXPORT_SCOPE_OPTIONS: Array<{
  description: string;
  label: string;
  value: BookTextExportScope;
}> = [
  {
    value: "whole-book",
    label: "整本书",
    description: "按当前书籍的完整顺序导出，适合整理完整成果。",
  },
  {
    value: "translated-only",
    label: "仅已翻译段落",
    description: "只导出已有中文译文的段落，适合快速交付已完成部分。",
  },
  {
    value: "reading-section",
    label: "当前阅读章节",
    description: "按上次阅读位置所在章节导出，适合按章校对或分享。",
  },
];

const READABLE_EXPORT_FORMAT_OPTIONS: Array<{
  description: string;
  label: string;
  value: BookReadableExportFormat;
}> = [
  {
    value: "html",
    label: "HTML 阅读稿",
    description: "导出可直接打开的双栏阅读页面，最适合分享成品。",
  },
  {
    value: "markdown",
    label: "Markdown",
    description: "适合继续整理、提交仓库或进入其它写作工具。",
  },
  {
    value: "txt",
    label: "TXT",
    description: "最轻量的纯文本导出，方便归档或再次处理。",
  },
];

const IMPORT_PREVIEW_LIMIT = 8;
const IMPORT_DRAFT_HISTORY_LIMIT = 40;
const LIBRARY_PREVIEW_PARAGRAPH_LIMIT = 6;

function buildImportedCopyTitle(title: string, books: BookRecord[]) {
  const existingTitles = new Set(books.map((book) => book.title));
  const baseTitle = `${title}（导入副本）`;

  if (!existingTitles.has(baseTitle)) {
    return baseTitle;
  }

  let suffix = 2;

  while (existingTitles.has(`${baseTitle} ${suffix}`)) {
    suffix += 1;
  }

  return `${baseTitle} ${suffix}`;
}

function deriveImportDraftSections(importDraft: ImportDraft | null) {
  if (!importDraft || importDraft.paragraphs.length === 0) {
    return [];
  }

  return buildSectionsFromParagraphSectionIds(
    importDraft.paragraphSectionIds,
    importDraft.parsedSections,
  );
}

function filterImportDraftParagraphs(
  importDraft: ImportDraft,
  predicate: (paragraph: string, index: number) => boolean,
) {
  return importDraft.paragraphs.reduce<{
    paragraphSectionIds: string[];
    paragraphs: string[];
  }>(
    (nextDraft, paragraph, index) => {
      if (!predicate(paragraph, index)) {
        return nextDraft;
      }

      nextDraft.paragraphs.push(paragraph);
      nextDraft.paragraphSectionIds.push(importDraft.paragraphSectionIds[index] ?? "section-1");

      return nextDraft;
    },
    {
      paragraphSectionIds: [],
      paragraphs: [],
    },
  );
}

function sanitizeImportDraft(importDraft: ImportDraft) {
  return importDraft.paragraphs.reduce<{
    paragraphSectionIds: string[];
    paragraphs: string[];
  }>(
    (nextDraft, paragraph, index) => {
      const normalizedParagraph = normalizeImportDraftParagraph(paragraph);

      if (!normalizedParagraph) {
        return nextDraft;
      }

      nextDraft.paragraphs.push(normalizedParagraph);
      nextDraft.paragraphSectionIds.push(importDraft.paragraphSectionIds[index] ?? "section-1");

      return nextDraft;
    },
    {
      paragraphSectionIds: [],
      paragraphs: [],
    },
  );
}

function buildBatchTranslationQueue(
  book: BookRecord,
  batchScope: TranslationBatchScope,
) {
  switch (batchScope) {
    case "failed":
      return book.paragraphs
        .filter((paragraph) => paragraph.translationStatus === "error")
        .map((paragraph) => paragraph.index);
    case "from-reading-position":
      return book.paragraphs
        .filter(
          (paragraph) =>
            paragraph.index >= book.readingProgress.lastReadParagraphIndex &&
            paragraph.translationStatus !== "done",
        )
        .map((paragraph) => paragraph.index);
    default:
      return book.paragraphs
        .filter((paragraph) => paragraph.translationStatus !== "done")
        .map((paragraph) => paragraph.index);
  }
}

function getEmptyBatchQueueNotice(batchScope: TranslationBatchScope) {
  switch (batchScope) {
    case "failed":
      return "当前没有失败段落可重试。";
    case "from-reading-position":
      return "从当前阅读位置往后，没有待翻译或失败段落。";
    default:
      return "这本书已经全部翻译完成。";
  }
}

function getBatchActionLabel(
  batchScope: TranslationBatchScope,
  translatedCount: number,
) {
  switch (batchScope) {
    case "failed":
      return "重试失败段落";
    case "from-reading-position":
      return "从阅读位置继续翻译";
    default:
      return translatedCount > 0 ? "继续翻译剩余段落" : "开始批量翻译";
  }
}

function formatDuration(ms: number) {
  if (ms < 1000) {
    return "不到 1 秒";
  }

  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分`;
  }

  if (minutes > 0) {
    return `${minutes} 分 ${seconds} 秒`;
  }

  return `${seconds} 秒`;
}

function buildParagraphRangeSummary(indexes: number[]) {
  if (indexes.length === 0) {
    return "";
  }

  const ranges: Array<{
    end: number;
    start: number;
  }> = [];

  indexes.forEach((index) => {
    const lastRange = ranges[ranges.length - 1];

    if (!lastRange || index > lastRange.end + 1) {
      ranges.push({
        end: index,
        start: index,
      });
      return;
    }

    lastRange.end = index;
  });

  const visibleRanges = ranges.slice(0, 4).map((range) =>
    range.start === range.end
      ? `第 ${range.start + 1} 段`
      : `第 ${range.start + 1}-${range.end + 1} 段`,
  );

  if (ranges.length > 4) {
    visibleRanges.push(`另外还有 ${ranges.length - 4} 段区间`);
  }

  return visibleRanges.join("、");
}

function getBatchSessionStatusLabel(status: TranslationBatchSession["status"]) {
  switch (status) {
    case "completed":
      return "已完成";
    case "failed":
      return "中断失败";
    case "running":
      return "进行中";
    default:
      return "已暂停";
  }
}

function getBatchSessionStatusClassName(
  status: TranslationBatchSession["status"],
) {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-800";
    case "failed":
      return "bg-red-100 text-red-700";
    case "running":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-stone-200 text-stone-700";
  }
}

async function waitForAbortableDelay(delayMs: number, signal: AbortSignal) {
  if (delayMs <= 0) {
    return;
  }

  if (signal.aborted) {
    throw new DOMException("翻译已取消。", "AbortError");
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);

    function handleAbort() {
      window.clearTimeout(timeoutId);
      signal.removeEventListener("abort", handleAbort);
      reject(new DOMException("翻译已取消。", "AbortError"));
    }

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

export function LibraryWorkspace() {
  const searchParams = useSearchParams();
  const selectedBookIdFromUrl = searchParams.get("book") ?? "";
  const paragraphIndexFromUrl = parseParagraphIndexParam(searchParams.get("p"));
  const {
    apiKey,
    baseUrl,
    isHydrated: settingsHydrated,
    model,
    providerLabel,
  } = useSettingsStore(
    useShallow((state) => ({
      apiKey: state.apiKey,
      baseUrl: state.baseUrl,
      isHydrated: state.isHydrated,
      model: state.model,
      providerLabel: state.providerLabel,
    })),
  );
  const {
    batchScope,
    clearLastBatchSession,
    contextSize,
    addGlossaryTerm,
    extraInstructions,
    glossaryTerms,
    isHydrated: preferencesHydrated,
    lastBatchSession,
    preferredReadableExportFormat,
    replaceGlossaryTerms,
    resetBatchScope,
    resetContextSize,
    resetPreferredReadableExportFormat,
    resetRequestDelayMs,
    resetTextExportScope,
    removeGlossaryTerm,
    resetExtraInstructions,
    resetGlossaryTerms,
    requestDelayMs,
    setBatchScope,
    setContextSize,
    setExtraInstructions,
    setPreferredReadableExportFormat,
    setLastBatchSession,
    setRequestDelayMs,
    setTextExportScope,
    textExportScope,
    updateGlossaryTerm,
  } = useTranslationPreferencesStore(
    useShallow((state) => ({
      batchScope: state.batchScope,
      clearLastBatchSession: state.clearLastBatchSession,
      contextSize: state.contextSize,
      addGlossaryTerm: state.addGlossaryTerm,
      extraInstructions: state.extraInstructions,
      glossaryTerms: state.glossaryTerms,
      isHydrated: state.isHydrated,
      lastBatchSession: state.lastBatchSession,
      preferredReadableExportFormat: state.preferredReadableExportFormat,
      replaceGlossaryTerms: state.replaceGlossaryTerms,
      resetBatchScope: state.resetBatchScope,
      resetContextSize: state.resetContextSize,
      resetPreferredReadableExportFormat: state.resetPreferredReadableExportFormat,
      resetRequestDelayMs: state.resetRequestDelayMs,
      resetTextExportScope: state.resetTextExportScope,
      removeGlossaryTerm: state.removeGlossaryTerm,
      resetExtraInstructions: state.resetExtraInstructions,
      resetGlossaryTerms: state.resetGlossaryTerms,
      requestDelayMs: state.requestDelayMs,
      setBatchScope: state.setBatchScope,
      setContextSize: state.setContextSize,
      setExtraInstructions: state.setExtraInstructions,
      setPreferredReadableExportFormat: state.setPreferredReadableExportFormat,
      setLastBatchSession: state.setLastBatchSession,
      setRequestDelayMs: state.setRequestDelayMs,
      setTextExportScope: state.setTextExportScope,
      textExportScope: state.textExportScope,
      updateGlossaryTerm: state.updateGlossaryTerm,
    })),
  );

  const [books, setBooks] = useState<BookRecord[]>([]);
  const [selectedBookId, setSelectedBookId] = useState("");
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);
  const [importDraftFuture, setImportDraftFuture] = useState<ImportDraft[]>([]);
  const [importDraftPast, setImportDraftPast] = useState<ImportDraft[]>([]);
  const [isImportDraftExpanded, setIsImportDraftExpanded] = useState(false);
  const [importDraftSearch, setImportDraftSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isImportingBackup, setIsImportingBackup] = useState(false);
  const [shortParagraphThreshold, setShortParagraphThreshold] = useState(20);
  const [translationMode, setTranslationMode] = useState<"batch" | "single" | null>(
    null,
  );
  const [activeParagraphIndex, setActiveParagraphIndex] = useState<number | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const backupImportInputRef = useRef<HTMLInputElement | null>(null);
  const translationAbortControllerRef = useRef<AbortController | null>(null);
  const glossaryImportInputRef = useRef<HTMLInputElement | null>(null);

  const selectedBook = useMemo(
    () =>
      books.find((book) => book.id === selectedBookId) ??
      books.find((book) => book.id === selectedBookIdFromUrl) ??
      books[0] ??
      null,
    [books, selectedBookId, selectedBookIdFromUrl],
  );
  const targetedParagraph = useMemo(() => {
    if (
      !selectedBook ||
      selectedBook.id !== selectedBookIdFromUrl ||
      paragraphIndexFromUrl === null ||
      paragraphIndexFromUrl < 0 ||
      paragraphIndexFromUrl >= selectedBook.paragraphs.length
    ) {
      return null;
    }

    return selectedBook.paragraphs[paragraphIndexFromUrl] ?? null;
  }, [paragraphIndexFromUrl, selectedBook, selectedBookIdFromUrl]);
  const targetedParagraphSectionTitle = useMemo(() => {
    if (!selectedBook || !targetedParagraph) {
      return "";
    }

    const sectionIndex = getSectionIndexForParagraph(
      selectedBook.sections,
      targetedParagraph.index,
    );

    return selectedBook.sections[sectionIndex]?.title ?? "";
  }, [selectedBook, targetedParagraph]);
  const previewParagraphs = useMemo(() => {
    if (!selectedBook) {
      return [] as BookRecord["paragraphs"];
    }

    if (!targetedParagraph) {
      return selectedBook.paragraphs.slice(0, LIBRARY_PREVIEW_PARAGRAPH_LIMIT);
    }

    const maxPreviewStartIndex = Math.max(
      selectedBook.paragraphs.length - LIBRARY_PREVIEW_PARAGRAPH_LIMIT,
      0,
    );
    const previewStartIndex =
      targetedParagraph.index < LIBRARY_PREVIEW_PARAGRAPH_LIMIT
        ? 0
        : Math.max(
            Math.min(targetedParagraph.index - 2, maxPreviewStartIndex),
            0,
          );

    return selectedBook.paragraphs.slice(
      previewStartIndex,
      previewStartIndex + LIBRARY_PREVIEW_PARAGRAPH_LIMIT,
    );
  }, [selectedBook, targetedParagraph]);
  const targetedParagraphActionLabel = useMemo(
    () => (targetedParagraph ? getSingleParagraphActionLabel(targetedParagraph) : ""),
    [targetedParagraph],
  );
  const targetedParagraphWorkflowHint = useMemo(
    () =>
      targetedParagraph ? getTargetedParagraphWorkflowHint(targetedParagraph) : "",
    [targetedParagraph],
  );
  const targetedPreviousParagraph = useMemo(() => {
    if (!selectedBook || !targetedParagraph || targetedParagraph.index === 0) {
      return null;
    }

    return selectedBook.paragraphs[targetedParagraph.index - 1] ?? null;
  }, [selectedBook, targetedParagraph]);
  const targetedNextParagraph = useMemo(() => {
    if (
      !selectedBook ||
      !targetedParagraph ||
      targetedParagraph.index >= selectedBook.paragraphs.length - 1
    ) {
      return null;
    }

    return selectedBook.paragraphs[targetedParagraph.index + 1] ?? null;
  }, [selectedBook, targetedParagraph]);

  const translationStats = useMemo(
    () =>
      selectedBook
        ? getBookTranslationStats(selectedBook)
        : {
            totalCount: 0,
            translatedCount: 0,
            failedCount: 0,
            runningCount: 0,
            pendingCount: 0,
            progressPercent: 0,
          },
    [selectedBook],
  );
  const failedParagraphGroups = useMemo(() => {
    if (!selectedBook) {
      return [] as FailedParagraphGroup[];
    }

    const groupedFailures = new Map<TranslationErrorCategory, FailedParagraphGroup>();

    selectedBook.paragraphs.forEach((paragraph) => {
      if (paragraph.translationStatus !== "error") {
        return;
      }

      const classification = classifyTranslationError(paragraph.translationError);
      const existingGroup = groupedFailures.get(classification.category);

      if (existingGroup) {
        existingGroup.count += 1;
        existingGroup.paragraphIndexes.push(paragraph.index);
        existingGroup.latestMessage = paragraph.translationError?.trim() || existingGroup.latestMessage;
        return;
      }

      groupedFailures.set(classification.category, {
        category: classification.category,
        count: 1,
        hint: classification.hint,
        label: classification.label,
        latestMessage: paragraph.translationError?.trim() || "翻译失败。",
        paragraphIndexes: [paragraph.index],
        requiresSettingsChange: classification.requiresSettingsChange,
        retryable: classification.retryable,
      });
    });

    return [...groupedFailures.values()].sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.label.localeCompare(right.label, "zh-CN");
    });
  }, [selectedBook]);
  const failedParagraphGroupByCategory = useMemo(
    () =>
      new Map(failedParagraphGroups.map((group) => [group.category, group])),
    [failedParagraphGroups],
  );
  const selectedBookBatchSession = useMemo(
    () =>
      lastBatchSession && selectedBook && lastBatchSession.bookId === selectedBook.id
        ? lastBatchSession
        : null,
    [lastBatchSession, selectedBook],
  );
  const importDraftParagraphs = useMemo(
    () => (importDraft ? normalizeImportDraftParagraphs(importDraft.paragraphs) : []),
    [importDraft],
  );
  const importDraftSections = useMemo(
    () => deriveImportDraftSections(importDraft),
    [importDraft],
  );
  const importDraftStats = useMemo(
    () =>
      importDraft
        ? buildBookStats(createBookParagraphs(importDraftParagraphs))
        : null,
    [importDraft, importDraftParagraphs],
  );
  const importDraftSectionTitleById = useMemo(
    () => new Map(importDraftSections.map((section) => [section.id, section.title])),
    [importDraftSections],
  );
  const filteredImportDraftParagraphs = useMemo(
    () =>
      (importDraft?.paragraphs ?? [])
        .map((paragraph, index) => ({
          index,
          paragraph,
          sectionId: importDraft?.paragraphSectionIds[index] ?? "section-1",
        }))
        .filter(({ paragraph }) => matchesImportDraftSearch(paragraph, importDraftSearch)),
    [importDraft, importDraftSearch],
  );
  const visibleImportDraftParagraphs = useMemo(
    () =>
      isImportDraftExpanded
        ? filteredImportDraftParagraphs
        : filteredImportDraftParagraphs.slice(0, IMPORT_PREVIEW_LIMIT),
    [filteredImportDraftParagraphs, isImportDraftExpanded],
  );
  const likelyNoiseParagraphCount = useMemo(
    () => (importDraft ? countLikelyNoiseParagraphs(importDraft.paragraphs) : 0),
    [importDraft],
  );
  const canRedoImportDraft = importDraftFuture.length > 0;
  const canUndoImportDraft = importDraftPast.length > 0;
  const shortParagraphCount = useMemo(
    () =>
      importDraft ? countShortParagraphs(importDraft.paragraphs, shortParagraphThreshold) : 0,
    [importDraft, shortParagraphThreshold],
  );
  const activeGlossaryTerms = useMemo(
    () => getEffectiveGlossaryTerms(glossaryTerms),
    [glossaryTerms],
  );
  const normalizedBatchScope = useMemo(
    () => normalizeTranslationBatchScope(batchScope),
    [batchScope],
  );
  const normalizedContextSize = useMemo(
    () => normalizeTranslationContextSize(contextSize),
    [contextSize],
  );
  const normalizedRequestDelayMs = useMemo(
    () => normalizeTranslationRequestDelayMs(requestDelayMs),
    [requestDelayMs],
  );
  const normalizedTextExportScope = useMemo(
    () => normalizeBookTextExportScope(textExportScope),
    [textExportScope],
  );
  const normalizedPreferredReadableExportFormat = useMemo(
    () => normalizeBookReadableExportFormat(preferredReadableExportFormat),
    [preferredReadableExportFormat],
  );
  const batchQueuePreview = useMemo(
    () =>
      selectedBook
        ? buildBatchTranslationQueue(selectedBook, normalizedBatchScope)
        : [],
    [normalizedBatchScope, selectedBook],
  );
  const batchQueuePreviewParagraphs = useMemo(
    () => batchQueuePreview.slice(0, 5),
    [batchQueuePreview],
  );
  const batchQueueRangeSummary = useMemo(
    () => buildParagraphRangeSummary(batchQueuePreview),
    [batchQueuePreview],
  );
  const selectedBatchScopeOption = useMemo(
    () =>
      BATCH_SCOPE_OPTIONS.find((option) => option.value === normalizedBatchScope) ??
      BATCH_SCOPE_OPTIONS[0],
    [normalizedBatchScope],
  );
  const selectedBookBatchSessionScopeOption = useMemo(
    () =>
      selectedBookBatchSession
        ? BATCH_SCOPE_OPTIONS.find(
            (option) => option.value === selectedBookBatchSession.batchScope,
          ) ?? null
        : null,
    [selectedBookBatchSession],
  );
  const selectedBookBatchSessionQueueKind =
    selectedBookBatchSession?.queueKind ?? "scope";
  const selectedBookBatchSessionQueueLabel =
    selectedBookBatchSession?.queueLabel?.trim() ||
    selectedBookBatchSessionScopeOption?.label ||
    "批量任务";
  const batchActionLabel = useMemo(
    () => getBatchActionLabel(normalizedBatchScope, translationStats.translatedCount),
    [normalizedBatchScope, translationStats.translatedCount],
  );
  const resumableBatchQueue = useMemo(
    () => {
      if (!selectedBook || !selectedBookBatchSession) {
        return [];
      }

      if (
        selectedBookBatchSessionQueueKind === "failure-category" &&
        selectedBookBatchSession.errorCategory
      ) {
        return (
          failedParagraphGroupByCategory.get(selectedBookBatchSession.errorCategory)
            ?.paragraphIndexes ?? []
        );
      }

      return buildBatchTranslationQueue(selectedBook, selectedBookBatchSession.batchScope);
    },
    [
      failedParagraphGroupByCategory,
      selectedBook,
      selectedBookBatchSession,
      selectedBookBatchSessionQueueKind,
    ],
  );
  const resumableBatchQueuePreviewParagraphs = useMemo(
    () => resumableBatchQueue.slice(0, 5),
    [resumableBatchQueue],
  );
  const resumableBatchQueueRangeSummary = useMemo(
    () => buildParagraphRangeSummary(resumableBatchQueue),
    [resumableBatchQueue],
  );
  const selectedBookBatchSessionProgressPercent = useMemo(() => {
    if (!selectedBookBatchSession || selectedBookBatchSession.queueTotal <= 0) {
      return 0;
    }

    return Math.min(
      Math.round(
        (selectedBookBatchSession.processedCount / selectedBookBatchSession.queueTotal) *
          100,
      ),
      100,
    );
  }, [selectedBookBatchSession]);
  const currentBatchQueueMinimumWaitMs = useMemo(
    () => Math.max(batchQueuePreview.length - 1, 0) * normalizedRequestDelayMs,
    [batchQueuePreview.length, normalizedRequestDelayMs],
  );
  const selectedBookBatchSessionObservedParagraphMs = useMemo(() => {
    if (!selectedBookBatchSession || selectedBookBatchSession.processedCount <= 0) {
      return null;
    }

    const elapsedMs =
      new Date(selectedBookBatchSession.updatedAt).getTime() -
      new Date(selectedBookBatchSession.startedAt).getTime();

    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      return null;
    }

    return elapsedMs / selectedBookBatchSession.processedCount;
  }, [selectedBookBatchSession]);
  const currentBatchQueueObservedEstimateMs = useMemo(() => {
    if (
      !selectedBookBatchSessionObservedParagraphMs ||
      !selectedBookBatchSession ||
      selectedBookBatchSession.batchScope !== normalizedBatchScope ||
      batchQueuePreview.length === 0
    ) {
      return null;
    }

    return Math.round(batchQueuePreview.length * selectedBookBatchSessionObservedParagraphMs);
  }, [
    batchQueuePreview.length,
    normalizedBatchScope,
    selectedBookBatchSession,
    selectedBookBatchSessionObservedParagraphMs,
  ]);
  const resumableBatchQueueObservedEstimateMs = useMemo(() => {
    if (
      !selectedBookBatchSessionObservedParagraphMs ||
      !selectedBookBatchSession ||
      resumableBatchQueue.length === 0
    ) {
      return null;
    }

    return Math.round(
      resumableBatchQueue.length * selectedBookBatchSessionObservedParagraphMs,
    );
  }, [
    resumableBatchQueue.length,
    selectedBookBatchSession,
    selectedBookBatchSessionObservedParagraphMs,
  ]);
  const canResumeBatchSession = Boolean(
    selectedBookBatchSession &&
      selectedBookBatchSession.status !== "completed" &&
      resumableBatchQueue.length > 0,
  );
  const batchQueueStatusText = useMemo(() => {
    if (!selectedBook) {
      return "请先选择一本书。";
    }

    if (batchQueuePreview.length === 0) {
      return getEmptyBatchQueueNotice(normalizedBatchScope);
    }

    return `当前队列会处理 ${batchQueuePreview.length} 段，首个任务是第 ${batchQueuePreview[0] + 1} 段。`;
  }, [batchQueuePreview, normalizedBatchScope, selectedBook]);
  const batchQueueScopeHint = useMemo(() => {
    if (!selectedBook) {
      return "";
    }

    switch (normalizedBatchScope) {
      case "failed":
        return `当前全书共有 ${translationStats.failedCount} 段失败记录。`;
      case "from-reading-position":
        return `上次阅读位置是第 ${selectedBook.readingProgress.lastReadParagraphIndex + 1} 段。`;
      default:
        return `当前全书还有 ${
          translationStats.pendingCount + translationStats.failedCount
        } 段未完成。`;
    }
  }, [normalizedBatchScope, selectedBook, translationStats.failedCount, translationStats.pendingCount]);
  const selectedTextExportScopeOption = useMemo(
    () =>
      TEXT_EXPORT_SCOPE_OPTIONS.find(
        (option) => option.value === normalizedTextExportScope,
      ) ?? TEXT_EXPORT_SCOPE_OPTIONS[0],
    [normalizedTextExportScope],
  );
  const selectedReadableExportFormatOption = useMemo(
    () =>
      READABLE_EXPORT_FORMAT_OPTIONS.find(
        (option) => option.value === normalizedPreferredReadableExportFormat,
      ) ?? READABLE_EXPORT_FORMAT_OPTIONS[0],
    [normalizedPreferredReadableExportFormat],
  );
  const textExportPreview = useMemo(
    () =>
      selectedBook
        ? getBookTextExportPreview(selectedBook, normalizedTextExportScope)
        : null,
    [normalizedTextExportScope, selectedBook],
  );
  const canExportReadableBook = Boolean(
    preferencesHydrated &&
      textExportPreview &&
      textExportPreview.paragraphCount > 0,
  );
  const isExportPreferencesDirty =
    normalizedTextExportScope !== DEFAULT_BOOK_TEXT_EXPORT_SCOPE ||
    normalizedPreferredReadableExportFormat !==
      DEFAULT_BOOK_READABLE_EXPORT_FORMAT;
  const readableExportSummary = useMemo(() => {
    if (!textExportPreview) {
      return "请先选择一本书。";
    }

    return `当前会导出 ${selectedReadableExportFormatOption.label}，包含 ${textExportPreview.paragraphCount} 段与 ${textExportPreview.bookmarkCount} 条书签/批注。`;
  }, [selectedReadableExportFormatOption.label, textExportPreview]);

  const isTranslating = translationMode !== null;

  const hasTranslationConfig =
    settingsHydrated && Boolean(baseUrl && model && apiKey);

  const refreshBooks = useCallback(async () => {
    setIsLoading(true);

    try {
      const nextBooks = await listBooks();
      setBooks(nextBooks);
      setSelectedBookId((current) =>
        current && nextBooks.some((book) => book.id === current)
          ? current
          : selectedBookIdFromUrl &&
              nextBooks.some((book) => book.id === selectedBookIdFromUrl)
            ? selectedBookIdFromUrl
          : (nextBooks[0]?.id ?? ""),
      );
      setError("");
    } catch {
      setError("读取本地书库失败，请检查浏览器是否支持 IndexedDB。");
    } finally {
      setIsLoading(false);
    }
  }, [selectedBookIdFromUrl]);

  useEffect(() => {
    void refreshBooks();
  }, [refreshBooks]);

  useEffect(() => {
    return () => {
      translationAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(""), 2800);

    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (
      !preferencesHydrated ||
      isTranslating ||
      !lastBatchSession ||
      lastBatchSession.status !== "running"
    ) {
      return;
    }

    setLastBatchSession({
      ...lastBatchSession,
      status: "stopped",
      updatedAt: new Date().toISOString(),
    });
  }, [isTranslating, lastBatchSession, preferencesHydrated, setLastBatchSession]);

  function replaceBookInState(nextBook: BookRecord) {
    setBooks((current) =>
      current.map((book) => (book.id === nextBook.id ? nextBook : book)),
    );
  }

  async function persistBook(nextBook: BookRecord) {
    replaceBookInState(nextBook);
    await saveBook(nextBook);
  }

  function clearImportDraftHistory() {
    setImportDraftPast([]);
    setImportDraftFuture([]);
  }

  function commitImportDraft(
    nextDraft: ImportDraft | null,
    options?: {
      clearHistory?: boolean;
      recordHistory?: boolean;
    },
  ) {
    if (options?.clearHistory || nextDraft === null) {
      clearImportDraftHistory();
    } else if (options?.recordHistory !== false && importDraft) {
      setImportDraftPast((current) =>
        [...current, importDraft].slice(-IMPORT_DRAFT_HISTORY_LIMIT),
      );
      setImportDraftFuture([]);
    }

    setImportDraft(nextDraft);
  }

  function handleUndoImportDraft() {
    if (!importDraft || importDraftPast.length === 0) {
      return;
    }

    const previousDraft = importDraftPast[importDraftPast.length - 1];

    setImportDraftPast((current) => current.slice(0, -1));
    setImportDraftFuture((current) =>
      [importDraft, ...current].slice(0, IMPORT_DRAFT_HISTORY_LIMIT),
    );
    setImportDraft(previousDraft);
    setNotice("已撤销上一步导入草稿编辑。");
    setError("");
  }

  function handleRedoImportDraft() {
    if (!importDraft || importDraftFuture.length === 0) {
      return;
    }

    const nextDraft = importDraftFuture[0];

    setImportDraftPast((current) =>
      [...current, importDraft].slice(-IMPORT_DRAFT_HISTORY_LIMIT),
    );
    setImportDraftFuture((current) => current.slice(1));
    setImportDraft(nextDraft);
    setNotice("已恢复上一步导入草稿编辑。");
    setError("");
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsImporting(true);
    setError("");

    try {
      if (
        importDraft &&
        !window.confirm("当前有一个未保存的导入草稿。上传新文件会覆盖它，是否继续？")
      ) {
        return;
      }

      const lowerFileName = file.name.toLowerCase();
      let importedBook: {
        paragraphs: BookRecord["paragraphs"];
        sections: BookSection[];
        title: string;
      };

      if (lowerFileName.endsWith(".epub")) {
        importedBook = await parseEpubFile(file);
      } else {
        const paragraphs = parseTxtParagraphs(await file.text());
        importedBook = {
          paragraphs,
          sections: createDefaultBookSections(paragraphs.length),
          title: deriveTitleFromFileName(file.name),
        };
      }

      const paragraphSectionIds = buildParagraphSectionIds(
        importedBook.paragraphs.length,
        importedBook.sections,
      );
      const nextImportDraft = {
        originalFileName: file.name,
        paragraphSectionIds,
        paragraphs: importedBook.paragraphs.map((paragraph) => paragraph.sourceText),
        parsedParagraphSectionIds: [...paragraphSectionIds],
        parsedParagraphs: importedBook.paragraphs.map((paragraph) => paragraph.sourceText),
        parsedSections: importedBook.sections,
        parsedTitle: importedBook.title,
        title: importedBook.title,
      } satisfies ImportDraft;

      if (nextImportDraft.paragraphs.length === 0) {
        setError("文件内容为空，或者没有解析出有效段落。");
        return;
      }

      commitImportDraft(nextImportDraft, {
        clearHistory: true,
        recordHistory: false,
      });
      setIsImportDraftExpanded(false);
      setImportDraftSearch("");
      setNotice(
        `已解析《${nextImportDraft.title}》，共 ${nextImportDraft.paragraphs.length} 段。请先检查标题和切段结果，再保存到书库。`,
      );
    } catch (importError) {
      setError(getErrorMessage(importError));
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  }

  function createImportedBookCopy(book: BookRecord) {
    const now = new Date().toISOString();

    return {
      ...book,
      id: createBookId(),
      title: buildImportedCopyTitle(book.title, books),
      createdAt: now,
      updatedAt: now,
    };
  }

  async function handleImportBookBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsImportingBackup(true);
    setError("");

    try {
      const importedBook = parseBookJsonImport(await file.text());
      const existingBook = books.find((book) => book.id === importedBook.id);

      let nextBook = importedBook;
      let importNotice = `已导入《${importedBook.title}》的整书备份。`;

      if (existingBook) {
        const shouldOverwrite = window.confirm(
          `本地书库里已经有《${existingBook.title}》。确定覆盖这本本地副本吗？点击“取消”会改为导入一个副本。`,
        );

        if (shouldOverwrite) {
          importNotice = `已覆盖导入《${importedBook.title}》的整书备份。`;
        } else {
          nextBook = createImportedBookCopy(importedBook);
          importNotice = `已把《${importedBook.title}》导入为新副本《${nextBook.title}》。`;
        }
      }

      await saveBook(nextBook);

      const nextBooks = await listBooks();

      setBooks(nextBooks);
      setSelectedBookId(nextBook.id);
      setNotice(importNotice);
      setError("");
    } catch (importError) {
      setError(getErrorMessage(importError));
    } finally {
      setIsImportingBackup(false);
      event.target.value = "";
    }
  }

  function updateImportDraftParagraph(index: number, value: string) {
    if (!importDraft) {
      return;
    }

    commitImportDraft({
      ...importDraft,
      paragraphs: importDraft.paragraphs.map((paragraph, paragraphIndex) =>
        paragraphIndex === index ? value : paragraph,
      ),
    });
  }

  function handleMergeImportDraftParagraph(index: number) {
    if (!importDraft || index === 0) {
      return;
    }

    const previousParagraph = importDraft.paragraphs[index - 1] ?? "";
    const currentParagraph = importDraft.paragraphs[index] ?? "";
    const mergedParagraph = [previousParagraph.trim(), currentParagraph.trim()]
      .filter(Boolean)
      .join(" ");

    commitImportDraft({
      ...importDraft,
      paragraphSectionIds: importDraft.paragraphSectionIds.filter(
        (_, paragraphIndex) => paragraphIndex !== index,
      ),
      paragraphs: importDraft.paragraphs.flatMap((paragraph, paragraphIndex) => {
        if (paragraphIndex === index - 1) {
          return mergedParagraph;
        }

        if (paragraphIndex === index) {
          return [];
        }

        return paragraph;
      }),
    });
  }

  function handleRemoveImportDraftParagraph(index: number) {
    if (!importDraft) {
      return;
    }

    commitImportDraft({
      ...importDraft,
      paragraphSectionIds: importDraft.paragraphSectionIds.filter(
        (_, paragraphIndex) => paragraphIndex !== index,
      ),
      paragraphs: importDraft.paragraphs.filter((_, paragraphIndex) => paragraphIndex !== index),
    });
  }

  function handleSplitImportDraftParagraph(index: number) {
    if (!importDraft) {
      return;
    }

    const currentParagraph = importDraft.paragraphs[index] ?? "";
    const nextParagraphs = splitPlainTextParagraphs(currentParagraph);

    if (nextParagraphs.length < 2) {
      setNotice("先在这段文本里插入一个空行，再点击“按空行拆分”。");
      return;
    }

    commitImportDraft({
      ...importDraft,
      paragraphSectionIds: importDraft.paragraphSectionIds.flatMap(
        (sectionId, paragraphIndex) =>
          paragraphIndex === index ? new Array(nextParagraphs.length).fill(sectionId) : sectionId,
      ),
      paragraphs: importDraft.paragraphs.flatMap((paragraph, paragraphIndex) =>
        paragraphIndex === index ? nextParagraphs : paragraph,
      ),
    });
    setNotice(`已把第 ${index + 1} 段拆成 ${nextParagraphs.length} 段。`);
    setError("");
  }

  function handleResetImportDraft() {
    if (!importDraft) {
      return;
    }

    commitImportDraft({
      ...importDraft,
      paragraphSectionIds: [...importDraft.parsedParagraphSectionIds],
      paragraphs: [...importDraft.parsedParagraphs],
      title: importDraft.parsedTitle,
    });
    setImportDraftSearch("");
    setNotice("已恢复为本次文件导入时的原始解析结果。");
    setError("");
  }

  function handleDiscardImportDraft() {
    commitImportDraft(null, {
      clearHistory: true,
      recordHistory: false,
    });
    setIsImportDraftExpanded(false);
    setImportDraftSearch("");
    setNotice("导入草稿已丢弃。");
    setError("");
  }

  async function handleSaveImportDraft() {
    if (!importDraft) {
      return;
    }

    const sanitizedDraft = sanitizeImportDraft(importDraft);
    const sanitizedParagraphs = sanitizedDraft.paragraphs;

    if (sanitizedParagraphs.length === 0) {
      setError("当前草稿没有可保存的有效段落。");
      return;
    }

    try {
      const book = createBookRecord({
        fileName: importDraft.originalFileName,
        paragraphs: createBookParagraphs(sanitizedParagraphs),
        sections: buildSectionsFromParagraphSectionIds(
          sanitizedDraft.paragraphSectionIds,
          importDraft.parsedSections,
        ),
        title: importDraft.title,
      });

      await saveBook(book);
      const nextBooks = await listBooks();

      setBooks(nextBooks);
      setSelectedBookId(book.id);
      commitImportDraft(null, {
        clearHistory: true,
        recordHistory: false,
      });
      setIsImportDraftExpanded(false);
      setImportDraftSearch("");
      setNotice(`已把《${book.title}》保存到本地书库，共 ${book.stats.paragraphCount} 段。`);
      setError("");
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    }
  }

  function handleRemoveLikelyNoiseParagraphs() {
    if (!importDraft) {
      return;
    }

    const { paragraphSectionIds, paragraphs } = filterImportDraftParagraphs(
      importDraft,
      (paragraph) => !isLikelyNoiseParagraph(paragraph),
    );
    const removedCount = importDraft.paragraphs.length - paragraphs.length;

    if (removedCount === 0) {
      setNotice("没有识别到可批量删除的目录页、版权页或页码段落。");
      return;
    }

    commitImportDraft({
      ...importDraft,
      paragraphSectionIds,
      paragraphs,
    });
    setNotice(`已批量删除 ${removedCount} 段疑似目录页、版权页或页码内容。`);
    setError("");
  }

  function handleRemoveShortParagraphs() {
    if (!importDraft) {
      return;
    }

    const { paragraphSectionIds, paragraphs } = filterImportDraftParagraphs(
      importDraft,
      (paragraph) => !isShortParagraph(paragraph, shortParagraphThreshold),
    );
    const removedCount = importDraft.paragraphs.length - paragraphs.length;

    if (removedCount === 0) {
      setNotice(`没有长度小于 ${shortParagraphThreshold} 的段落。`);
      return;
    }

    commitImportDraft({
      ...importDraft,
      paragraphSectionIds,
      paragraphs,
    });
    setNotice(`已删除 ${removedCount} 段长度小于 ${shortParagraphThreshold} 的短段。`);
    setError("");
  }

  async function handleDelete(bookId: string) {
    try {
      await deleteBook(bookId);
      const nextBooks = await listBooks();

      setBooks(nextBooks);
      if (lastBatchSession?.bookId === bookId) {
        clearLastBatchSession();
      }
      setSelectedBookId((current) =>
        current === bookId ? (nextBooks[0]?.id ?? "") : current,
      );
      setNotice("书籍已从当前浏览器的本地书库删除。");
    } catch {
      setError("删除失败，请稍后重试。");
    }
  }

  async function handleClearTranslations() {
    if (!selectedBook || isTranslating) {
      return;
    }

    try {
      const clearedBook = clearBookTranslations(selectedBook);
      await persistBook(clearedBook);
      if (lastBatchSession?.bookId === selectedBook.id) {
        clearLastBatchSession();
      }
      setNotice("已清空这本书的译文和翻译状态。");
      setError("");
    } catch {
      setError("清空译文失败，请稍后重试。");
    }
  }

  async function runParagraphTranslation({
    book,
    controller,
    contextSizeSnapshot,
    extraInstructionsSnapshot,
    glossaryTermsSnapshot,
    index,
    revisionMode,
  }: {
    book: BookRecord;
    controller: AbortController;
    contextSizeSnapshot: number;
    extraInstructionsSnapshot: string;
    glossaryTermsSnapshot: GlossaryTerm[];
    index: number;
    revisionMode: boolean;
  }) {
    setActiveParagraphIndex(index);

    let workingBook = updateBookParagraph(book, index, {
      translationError: null,
      translationStatus: "translating",
    });
    await persistBook(workingBook);

    try {
      const translatedText = await translateParagraph({
        book: workingBook,
        contextSize: contextSizeSnapshot,
        extraInstructions: extraInstructionsSnapshot,
        glossaryTerms: glossaryTermsSnapshot,
        index,
        revisionMode,
        settings: {
          apiKey,
          baseUrl,
          model,
          providerLabel,
        },
        signal: controller.signal,
      });

      workingBook = updateBookParagraph(workingBook, index, {
        translatedText,
        translationError: null,
        translationStatus: "done",
      });
      await persistBook(workingBook);

      return {
        nextBook: workingBook,
        success: true as const,
      };
    } catch (translationError) {
      if (isAbortError(translationError)) {
        throw translationError;
      }

      const errorMessage = getErrorMessage(translationError);

      workingBook = updateBookParagraph(workingBook, index, {
        translationError: errorMessage,
        translationStatus: "error",
      });
      await persistBook(workingBook);

      return {
        errorMessage,
        nextBook: workingBook,
        success: false as const,
      };
    }
  }

  async function handleTranslateBook(options?: {
    errorCategory?: TranslationErrorCategory | null;
    queueKind?: "scope" | "failure-category";
    queueLabel?: string;
    queueOverride?: number[];
    resumeSession?: boolean;
    scopeOverride?: TranslationBatchScope;
  }) {
    if (!selectedBook) {
      setError("请先选择一本书。");
      return;
    }

    if (!hasTranslationConfig) {
      setError("请先完成 API Key、Base URL 和模型配置。");
      return;
    }

    const batchScopeSnapshot = options?.scopeOverride ?? normalizedBatchScope;
    const queueKind = options?.queueKind ?? "scope";
    const requestDelayMsSnapshot = normalizedRequestDelayMs;
    const batchScopeOption =
      BATCH_SCOPE_OPTIONS.find((option) => option.value === batchScopeSnapshot) ??
      BATCH_SCOPE_OPTIONS[0];
    const queueLabel = options?.queueLabel?.trim() || batchScopeOption.label;
    const queue =
      options?.queueOverride ?? buildBatchTranslationQueue(selectedBook, batchScopeSnapshot);
    const currentBatchSession =
      options?.resumeSession &&
      selectedBookBatchSession &&
      selectedBookBatchSession.batchScope === batchScopeSnapshot &&
      (selectedBookBatchSession.queueKind ?? "scope") === queueKind &&
      (selectedBookBatchSession.errorCategory ?? null) ===
        (options?.errorCategory ?? null)
        ? selectedBookBatchSession
        : null;

    if (queue.length === 0) {
      if (currentBatchSession) {
        setLastBatchSession({
          ...currentBatchSession,
          status: "completed",
          updatedAt: new Date().toISOString(),
        });
      }
      setNotice(
        queueKind === "failure-category"
          ? `当前没有「${queueLabel}」可重试段落。`
          : getEmptyBatchQueueNotice(batchScopeSnapshot),
      );
      setError("");
      return;
    }

    setTranslationMode("batch");
    setActiveParagraphIndex(null);
    setError("");
    setNotice("");

    const extraInstructionsSnapshot = extraInstructions;
    const contextSizeSnapshot = normalizedContextSize;
    const glossaryTermsSnapshot = activeGlossaryTerms;
    const controller = new AbortController();
    translationAbortControllerRef.current = controller;
    let batchSession: TranslationBatchSession;
    const sessionTimestamp = new Date().toISOString();

    if (currentBatchSession) {
      batchSession = {
        ...currentBatchSession,
        status: "running",
        updatedAt: sessionTimestamp,
      };
    } else {
      batchSession = {
        batchScope: batchScopeSnapshot,
        bookId: selectedBook.id,
        errorCategory: options?.errorCategory ?? null,
        failedCount: 0,
        lastProcessedParagraphIndex: null,
        processedCount: 0,
        queueKind,
        queueLabel,
        queueTotal: queue.length,
        startedAt: sessionTimestamp,
        status: "running",
        successCount: 0,
        updatedAt: sessionTimestamp,
      };
    }

    setLastBatchSession(batchSession);

    let workingBook = selectedBook;
    let successCount = 0;
    let failedCount = 0;

    try {
      for (const [queueIndex, index] of queue.entries()) {
        if (controller.signal.aborted) {
          throw new DOMException("翻译已取消。", "AbortError");
        }

        const result = await runParagraphTranslation({
          book: workingBook,
          controller,
          contextSizeSnapshot,
          extraInstructionsSnapshot,
          glossaryTermsSnapshot,
          index,
          revisionMode: false,
        });

        workingBook = result.nextBook;

        if (result.success) {
          successCount += 1;
        } else {
          failedCount += 1;
        }

        batchSession = {
          ...batchSession,
          failedCount: batchSession.failedCount + (result.success ? 0 : 1),
          lastProcessedParagraphIndex: index,
          processedCount: batchSession.processedCount + 1,
          successCount: batchSession.successCount + (result.success ? 1 : 0),
          updatedAt: new Date().toISOString(),
        };
        setLastBatchSession(batchSession);

        if (queueIndex < queue.length - 1 && requestDelayMsSnapshot > 0) {
          await waitForAbortableDelay(requestDelayMsSnapshot, controller.signal);
        }
      }

      setLastBatchSession({
        ...batchSession,
        status: "completed",
        updatedAt: new Date().toISOString(),
      });

      setNotice(
        queueKind === "failure-category"
          ? failedCount > 0
            ? `「${queueLabel}」重试完成：成功 ${successCount} 段，失败 ${failedCount} 段。`
            : `「${queueLabel}」重试完成：本次成功处理 ${successCount} 段。`
          : failedCount > 0
            ? `翻译完成：成功 ${successCount} 段，失败 ${failedCount} 段。再次运行会重试失败段落。`
            : `翻译完成：本次新增 ${successCount} 段译文。`,
      );
    } catch (translationError) {
      if (isAbortError(translationError)) {
        setLastBatchSession({
          ...batchSession,
          status: "stopped",
          updatedAt: new Date().toISOString(),
        });
        setNotice(
          queueKind === "failure-category"
            ? `已停止「${queueLabel}」这批重试。稍后可以继续从剩余失败段落接着跑。`
            : "翻译已停止。再次开始会从未完成或失败的段落继续。",
        );
      } else {
        setLastBatchSession({
          ...batchSession,
          status: "failed",
          updatedAt: new Date().toISOString(),
        });
        setError(getErrorMessage(translationError));
      }
    } finally {
      setTranslationMode(null);
      setActiveParagraphIndex(null);
      translationAbortControllerRef.current = null;
    }
  }

  async function handleRetranslateParagraph(index: number) {
    if (!selectedBook) {
      setError("请先选择一本书。");
      return;
    }

    if (!hasTranslationConfig) {
      setError("请先完成 API Key、Base URL 和模型配置。");
      return;
    }

    setTranslationMode("single");
    setError("");
    setNotice("");

    const extraInstructionsSnapshot = extraInstructions;
    const contextSizeSnapshot = normalizedContextSize;
    const glossaryTermsSnapshot = activeGlossaryTerms;
    const controller = new AbortController();
    translationAbortControllerRef.current = controller;

    try {
      const result = await runParagraphTranslation({
        book: selectedBook,
        controller,
        contextSizeSnapshot,
        extraInstructionsSnapshot,
        glossaryTermsSnapshot,
        index,
        revisionMode: true,
      });

      if (result.success) {
        setNotice(`已重译第 ${index + 1} 段。`);
      } else {
        setError(`第 ${index + 1} 段重译失败：${result.errorMessage}`);
      }
    } catch (translationError) {
      if (isAbortError(translationError)) {
        setNotice("重译已停止。");
      } else {
        setError(getErrorMessage(translationError));
      }
    } finally {
      setTranslationMode(null);
      setActiveParagraphIndex(null);
      translationAbortControllerRef.current = null;
    }
  }

  function handleStopTranslation() {
    translationAbortControllerRef.current?.abort();
  }

  function handleResumeLastBatchSession() {
    if (!selectedBookBatchSession) {
      return;
    }

    setBatchScope(selectedBookBatchSession.batchScope);
    void handleTranslateBook({
      errorCategory: selectedBookBatchSession.errorCategory ?? null,
      queueKind: selectedBookBatchSession.queueKind ?? "scope",
      queueLabel:
        selectedBookBatchSession.queueLabel?.trim() ||
        selectedBookBatchSessionScopeOption?.label ||
        "批量任务",
      resumeSession: true,
      scopeOverride: selectedBookBatchSession.batchScope,
    });
  }

  function handleRetryFailedCategory(category: TranslationErrorCategory) {
    const group = failedParagraphGroupByCategory.get(category);

    if (!group) {
      return;
    }

    void handleTranslateBook({
      errorCategory: category,
      queueKind: "failure-category",
      queueLabel: group.label,
      queueOverride: group.paragraphIndexes,
      scopeOverride: "failed",
    });
  }

  function downloadContentFile(
    content: string,
    fileName: string,
    mimeType: string,
  ) {
    const blob = new Blob([content], {
      type: mimeType,
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();

    URL.revokeObjectURL(objectUrl);
  }

  function handleExportBookAsJson() {
    if (!selectedBook) {
      return;
    }

    downloadContentFile(
      JSON.stringify(buildBookJsonExport(selectedBook), null, 2),
      buildBookExportFileName(selectedBook, "json"),
      "application/json",
    );
    setNotice(`已导出《${selectedBook.title}》的完整书籍 JSON。`);
    setError("");
  }

  function handleExportPreferredReadableBook() {
    if (!selectedBook || !textExportPreview || textExportPreview.paragraphCount === 0) {
      return;
    }

    const scope = normalizedTextExportScope;
    const scopeFileSegment = textExportPreview.scopeFileSegment;

    switch (normalizedPreferredReadableExportFormat) {
      case "markdown":
        downloadContentFile(
          buildBookMarkdownExport(selectedBook, scope),
          buildBookExportFileName(selectedBook, "markdown", scopeFileSegment),
          "text/markdown;charset=utf-8",
        );
        setNotice(`已按当前设置导出《${selectedBook.title}》的 Markdown。`);
        break;
      case "txt":
        downloadContentFile(
          buildBookPlainTextExport(selectedBook, scope),
          buildBookExportFileName(selectedBook, "txt", scopeFileSegment),
          "text/plain;charset=utf-8",
        );
        setNotice(`已按当前设置导出《${selectedBook.title}》的 TXT。`);
        break;
      default:
        downloadContentFile(
          buildBookHtmlExport(selectedBook, scope),
          buildBookExportFileName(selectedBook, "html", scopeFileSegment),
          "text/html;charset=utf-8",
        );
        setNotice(`已按当前设置导出《${selectedBook.title}》的 HTML 阅读稿。`);
        break;
    }

    setError("");
  }

  function handleResetExportPreferences() {
    resetPreferredReadableExportFormat();
    resetTextExportScope();
  }

  function handleExportGlossary() {
    const payload = buildGlossaryExport(glossaryTerms);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = `rebabel-glossary-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();

    URL.revokeObjectURL(objectUrl);
    setNotice(`已导出 ${glossaryTerms.length} 条术语到 JSON 文件。`);
    setError("");
  }

  async function handleImportGlossary(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      if (
        glossaryTerms.length > 0 &&
        !window.confirm("导入会替换当前术语表。建议先导出备份。是否继续？")
      ) {
        return;
      }

      const content = await file.text();
      const importedTerms = parseGlossaryImport(content);

      replaceGlossaryTerms(importedTerms);
      setNotice(`已导入 ${importedTerms.length} 条术语，并替换当前术语表。`);
      setError("");
    } catch (importError) {
      setError(getErrorMessage(importError));
    } finally {
      event.target.value = "";
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-[34px] border border-[color:var(--line)] bg-[color:var(--panel-strong)]/90 p-7 shadow-[var(--shadow)] backdrop-blur-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--line)] pb-6">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-[color:var(--muted)]">
              Step 2
            </p>
            <h2 className="mt-3 font-serif text-4xl">导入英文原著</h2>
            <p className="mt-3 text-sm leading-7 text-[color:var(--muted)]">
              现在支持 `.txt` 和 `.epub`。导入后会先在浏览器里完成解析和切段，进入草稿预览；确认无误后，再写入本地 IndexedDB。
            </p>
          </div>

          <button
            type="button"
            onClick={() => void refreshBooks()}
            disabled={isTranslating}
            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-200"
          >
            <RefreshCcw className="h-4 w-4" />
            刷新
          </button>
        </div>

        <div className="mt-6 rounded-[28px] border border-dashed border-[color:var(--line)] bg-white/70 p-5">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel)] px-6 py-10 text-center transition hover:bg-white">
            {isImporting ? (
              <LoaderCircle className="h-8 w-8 animate-spin text-[color:var(--accent)]" />
            ) : (
              <Import className="h-8 w-8 text-[color:var(--accent)]" />
            )}
            <div>
              <p className="text-lg font-semibold">
                {isImporting ? "正在导入..." : "选择一个 .txt / .epub 文件"}
              </p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                纯文本会按空行切段，EPUB 会按章节正文抽取段落。
              </p>
            </div>
            <span className="rounded-full bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white">
              上传到本地书库
            </span>
            <input
              type="file"
              accept=".txt,.epub,text/plain,application/epub+zip"
              className="sr-only"
              onChange={handleImport}
              disabled={isImporting || isImportingBackup || isTranslating}
            />
          </label>

          <div className="mt-4 rounded-[20px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold">恢复整书备份</p>
                <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                  导入之前从 ReBabel 导出的整书 JSON，直接恢复章节、译文、阅读进度和书签批注，不经过切段草稿。
                </p>
              </div>

              <input
                ref={backupImportInputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={(event) => void handleImportBookBackup(event)}
                disabled={isImporting || isImportingBackup || isTranslating}
              />
              <button
                type="button"
                onClick={() => backupImportInputRef.current?.click()}
                disabled={isImporting || isImportingBackup || isTranslating}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-4 py-3 text-sm font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
              >
                {isImportingBackup ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {isImportingBackup ? "正在恢复备份..." : "导入备份 JSON"}
              </button>
            </div>
          </div>
        </div>

        {importDraft ? (
          <div className="mt-6 rounded-[28px] border border-[color:var(--line)] bg-white/82 p-5">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-[color:var(--muted)]">
                    Import Draft
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold">导入预览与清洗</h3>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                    这一步还没有写入书库。你可以先改标题、检查切段结果，删除噪音段落，或者把误拆的段落并回上一段。
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleUndoImportDraft}
                    disabled={!canUndoImportDraft}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                  >
                    <Undo2 className="h-4 w-4" />
                    撤销
                  </button>
                  <button
                    type="button"
                    onClick={handleRedoImportDraft}
                    disabled={!canRedoImportDraft}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                  >
                    <Redo2 className="h-4 w-4" />
                    重做
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsImportDraftExpanded((current) => !current)}
                    className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50"
                  >
                    {isImportDraftExpanded ? "只看前几段" : "展开全部段落"}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetImportDraft}
                    className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50"
                  >
                    重置草稿
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardImportDraft}
                    className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:text-red-600"
                  >
                    放弃导入
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveImportDraft()}
                    className="inline-flex items-center justify-center rounded-full bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
                  >
                    保存到本地书库
                  </button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="草稿段落数"
                  value={String(importDraftStats?.paragraphCount ?? 0)}
                  hint="保存时生效"
                />
                <MetricCard
                  label="草稿词数"
                  value={String(importDraftStats?.wordCount ?? 0)}
                  hint="英文原文"
                />
                <MetricCard
                  label="章节数"
                  value={String(importDraftSections.length)}
                  hint="导航保留"
                />
                <MetricCard
                  label="源文件"
                  value={
                    importDraft.originalFileName.length > 14
                      ? `${importDraft.originalFileName.slice(0, 14)}...`
                      : importDraft.originalFileName
                  }
                  hint="当前导入"
                />
              </div>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Book Title
                </span>
                <input
                  type="text"
                  value={importDraft.title}
                  onChange={(event) =>
                    commitImportDraft({
                      ...importDraft,
                      title: event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 text-sm outline-none transition placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]"
                  placeholder="书名会在保存时写入本地书库"
                />
              </label>

              <div className="rounded-[20px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">批量清洗与搜索</p>
                    <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                      用搜索先定位问题段，再用批量动作快速清理目录页、版权页和异常短段。
                    </p>
                    <input
                      type="text"
                      value={importDraftSearch}
                      onChange={(event) => setImportDraftSearch(event.target.value)}
                      className="mt-3 w-full rounded-2xl border border-[color:var(--line)] bg-white px-4 py-3 text-sm outline-none transition placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]"
                      placeholder="搜索段落内容，例如 copyright、contents、isbn、chapter"
                    />
                    <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                      当前匹配 {filteredImportDraftParagraphs.length} /{" "}
                      {importDraft.paragraphs.length} 段。
                    </p>
                    <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                      如果某段被并得太长，可以在编辑框里插入一个空行，再用“按空行拆分”把它拆回多段。
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={handleRemoveLikelyNoiseParagraphs}
                      disabled={likelyNoiseParagraphCount === 0}
                      className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-3 text-sm font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                    >
                      清理疑似噪音段
                      {likelyNoiseParagraphCount > 0
                        ? ` (${likelyNoiseParagraphCount})`
                        : ""}
                    </button>

                    <label className="flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-sm">
                      <span className="text-[color:var(--muted)]">短段阈值</span>
                      <input
                        type="number"
                        min={1}
                        max={400}
                        value={shortParagraphThreshold}
                        onChange={(event) =>
                          setShortParagraphThreshold(
                            Math.max(1, Number.parseInt(event.target.value || "1", 10)),
                          )
                        }
                        className="w-16 bg-transparent text-right outline-none"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={handleRemoveShortParagraphs}
                      disabled={shortParagraphCount === 0}
                      className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-3 text-sm font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100 sm:col-span-2"
                    >
                      删除短段
                      {shortParagraphCount > 0 ? ` (${shortParagraphCount})` : ""}
                    </button>
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  "space-y-3",
                  isImportDraftExpanded &&
                    filteredImportDraftParagraphs.length > IMPORT_PREVIEW_LIMIT
                    ? "max-h-[38rem] overflow-y-auto pr-1"
                    : "",
                )}
              >
                {visibleImportDraftParagraphs.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-5 text-sm leading-6 text-[color:var(--muted)]">
                    没有匹配当前搜索条件的段落。试着清空搜索词，或调整清洗阈值。
                  </div>
                ) : (
                  visibleImportDraftParagraphs.map(({ index, paragraph, sectionId }) => (
                    <article
                      key={`${importDraft.originalFileName}-${index}`}
                      className="rounded-[20px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                            Paragraph {index + 1}
                          </p>
                          <p className="mt-1 text-xs text-[color:var(--muted)]">
                            {importDraftSectionTitleById.get(sectionId) ?? "全文"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleSplitImportDraftParagraph(index)}
                            className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50"
                          >
                            按空行拆分
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMergeImportDraftParagraph(index)}
                            disabled={index === 0}
                            className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                          >
                            并入上一段
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveImportDraftParagraph(index)}
                            className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:text-red-600"
                          >
                            删除本段
                          </button>
                        </div>
                      </div>

                      <textarea
                        rows={4}
                        value={paragraph}
                        onChange={(event) =>
                          updateImportDraftParagraph(index, event.target.value)
                        }
                        className={promptInputClassName}
                        placeholder="可以直接修改这段英文原文，再保存到书库。"
                      />
                    </article>
                  ))
                )}
              </div>

              {!isImportDraftExpanded &&
              filteredImportDraftParagraphs.length > IMPORT_PREVIEW_LIMIT ? (
                <div className="rounded-[20px] border border-dashed border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-4 text-sm leading-6 text-[color:var(--muted)]">
                  当前只展示前 {IMPORT_PREVIEW_LIMIT} 段。展开后可以继续检查并编辑后面的段落。
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <MetricCard
            label="已导入书籍"
            value={String(books.length)}
            hint="当前浏览器"
          />
          <MetricCard
            label="当前段落数"
            value={selectedBook ? String(selectedBook.stats.paragraphCount) : "0"}
            hint="所选书籍"
          />
          <MetricCard
            label="当前词数"
            value={selectedBook ? String(selectedBook.stats.wordCount) : "0"}
            hint="英文原文"
          />
        </div>

        <div className="mt-6 min-h-10 text-sm leading-6">
          {error ? <p className="text-red-600">{error}</p> : null}
          {!error && notice ? (
            <p className="font-semibold text-[color:var(--accent-strong)]">{notice}</p>
          ) : null}
          {!error && !notice ? (
            <p className="text-[color:var(--muted)]">
              {importDraft
                ? "当前有一个未保存的导入草稿。确认保存后，就可以在右侧启动逐段翻译。"
                : "书籍导入后，可以直接在右侧启动逐段翻译，并把译文写回本地书库。"}
            </p>
          ) : null}
        </div>

        <div className="mt-6 border-t border-[color:var(--line)] pt-6">
          <div className="mb-4 flex items-center gap-2">
            <BookOpenText className="h-5 w-5 text-[color:var(--accent-strong)]" />
            <p className="text-base font-semibold">本地书库</p>
          </div>

          {isLoading ? (
            <div className="rounded-[24px] border border-[color:var(--line)] bg-white/70 p-5 text-sm text-[color:var(--muted)]">
              正在读取本地书库...
            </div>
          ) : books.length === 0 ? (
            <div className="rounded-[24px] border border-[color:var(--line)] bg-white/70 p-5 text-sm leading-6 text-[color:var(--muted)]">
              还没有导入任何书籍。先上传一个 `.txt` 或 `.epub` 文件，确认段落切分结果是否符合预期。
            </div>
          ) : (
            <div className="space-y-3">
              {books.map((book) => {
                const isSelected = selectedBook?.id === book.id;
                const bookTranslationStats = getBookTranslationStats(book);

                return (
                  <div
                    key={book.id}
                    className={cn(
                      "rounded-[24px] border p-4 transition",
                      isSelected
                        ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
                        : "border-[color:var(--line)] bg-white/72 hover:bg-white",
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <button
                        type="button"
                        onClick={() => setSelectedBookId(book.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-base font-semibold">{book.title}</p>
                        <p className="mt-1 text-sm text-[color:var(--muted)]">
                          {book.stats.paragraphCount} 段 · {book.stats.wordCount} 词 · 翻译{" "}
                          {bookTranslationStats.translatedCount}/
                          {bookTranslationStats.totalCount}
                        </p>
                        <p className="mt-1 text-xs text-[color:var(--muted)]">
                          更新于 {formatRelativeDate(book.updatedAt)}
                        </p>
                        <p className="mt-2 truncate text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                          {book.originalFileName}
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDelete(book.id)}
                        disabled={isTranslating}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--line)] bg-white text-[color:var(--muted)] transition hover:text-red-600 disabled:cursor-not-allowed disabled:bg-stone-200"
                        aria-label={`删除 ${book.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[34px] border border-[color:var(--line)] bg-[color:var(--panel)] p-7 shadow-[var(--shadow)] backdrop-blur-xl">
        <div className="border-b border-[color:var(--line)] pb-6">
          <p className="text-sm uppercase tracking-[0.3em] text-[color:var(--muted)]">
            Step 3
          </p>
          <h3 className="mt-3 font-serif text-4xl">翻译与预览</h3>
          <p className="mt-3 text-sm leading-7 text-[color:var(--muted)]">
            用你在设置页保存的 OpenAI 兼容配置，逐段发起翻译请求。当前实现会为每个段落带上少量前文上下文，并把译文和状态写回 IndexedDB。
          </p>
        </div>

        {!selectedBook ? (
          <div className="mt-6 rounded-[28px] border border-[color:var(--line)] bg-white/70 p-6 text-sm leading-6 text-[color:var(--muted)]">
            还没有可翻译的书籍。导入后会在这里显示翻译控制、进度和译文预览。
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div className="rounded-[28px] border border-[color:var(--line)] bg-white/72 p-5">
              <div className="flex flex-col gap-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]">
                    <Languages className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-2xl font-semibold">{selectedBook.title}</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      已翻译 {translationStats.translatedCount} /{" "}
                      {translationStats.totalCount} 段，失败 {translationStats.failedCount} 段，
                      待处理 {translationStats.pendingCount} 段。
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-[0.22em] text-[color:var(--muted)]">
                      {selectedBook.originalFileName}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <MetricCard
                    label="译文完成"
                    value={String(translationStats.translatedCount)}
                    hint="done"
                  />
                  <MetricCard
                    label="失败段落"
                    value={String(translationStats.failedCount)}
                    hint="error"
                  />
                  <MetricCard
                    label="当前进度"
                    value={`${translationStats.progressPercent}%`}
                    hint="whole book"
                  />
                </div>

                <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-strong)] p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    <span className="rounded-full bg-stone-200 px-3 py-1 text-stone-700">
                      {settingsHydrated ? "设置已加载" : "读取设置中"}
                    </span>
                    <span className="rounded-full bg-white px-3 py-1">
                      {providerLabel || "OpenAI Compatible"}
                    </span>
                    <span className="rounded-full bg-white px-3 py-1">
                      {model || "未配置模型"}
                    </span>
                  </div>

                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-stone-200">
                    <div
                      className="h-full rounded-full bg-[color:var(--accent)] transition-[width]"
                      style={{ width: `${translationStats.progressPercent}%` }}
                    />
                  </div>

                  <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
                    {hasTranslationConfig
                      ? "当前可以直接从浏览器发起翻译请求。若服务商阻止跨域访问，需要换成支持前端直连的兼容端点。"
                      : "当前还不能翻译。请先在设置页填写 Base URL、模型名和 API Key。"}
                  </p>

                  <div className="mt-4 rounded-[20px] border border-[color:var(--line)] bg-white/80 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold">批量策略</p>
                        <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                          先决定这次要处理哪一批段落，再决定每次请求之间是否留出缓冲时间，减少长书翻译时的重试成本。
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={resetBatchScope}
                          disabled={
                            !preferencesHydrated ||
                            normalizedBatchScope === DEFAULT_TRANSLATION_BATCH_SCOPE
                          }
                          className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                        >
                          默认范围
                        </button>
                        <button
                          type="button"
                          onClick={resetRequestDelayMs}
                          disabled={
                            !preferencesHydrated ||
                            normalizedRequestDelayMs === MIN_TRANSLATION_REQUEST_DELAY_MS
                          }
                          className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                        >
                          清零间隔
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {BATCH_SCOPE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          disabled={!preferencesHydrated}
                          onClick={() => setBatchScope(option.value)}
                          className={cn(
                            "rounded-full border px-4 py-2 text-sm font-semibold transition",
                            normalizedBatchScope === option.value
                              ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]"
                              : "border-[color:var(--line)] bg-white hover:bg-stone-50",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">
                      {selectedBatchScopeOption.description}
                    </p>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[0.34fr_0.66fr]">
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          请求间隔
                        </span>
                        <input
                          type="number"
                          min={MIN_TRANSLATION_REQUEST_DELAY_MS}
                          max={MAX_TRANSLATION_REQUEST_DELAY_MS}
                          step={100}
                          value={normalizedRequestDelayMs}
                          disabled={!preferencesHydrated}
                          onChange={(event) =>
                            setRequestDelayMs(
                              normalizeTranslationRequestDelayMs(
                                Number.parseInt(event.target.value || "0", 10),
                              ),
                            )
                          }
                          className="mt-2 w-full rounded-2xl border border-[color:var(--line)] bg-white px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]"
                        />
                        <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                          `0 ms` 表示连续请求；适当增加间隔更适合限流严格的服务商。
                        </p>
                      </label>

                      <div className="rounded-[18px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          当前队列预览
                        </p>
                        <p className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">
                          {batchQueueStatusText}
                        </p>
                        <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                          {batchQueueScopeHint}
                        </p>
                        <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                          当前请求间隔为 {normalizedRequestDelayMs} ms。
                        </p>
                        {batchQueueRangeSummary ? (
                          <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                            覆盖区间：{batchQueueRangeSummary}。
                          </p>
                        ) : null}
                        {batchQueuePreview.length > 0 ? (
                          <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                            按当前间隔，至少还需 {formatDuration(currentBatchQueueMinimumWaitMs)}
                            。
                            {currentBatchQueueObservedEstimateMs
                              ? ` 如果按这本书上次同范围的处理速度估算，整批大约需要 ${formatDuration(
                                  currentBatchQueueObservedEstimateMs,
                                )}。`
                              : ""}
                          </p>
                        ) : null}
                        {batchQueuePreviewParagraphs.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {batchQueuePreviewParagraphs.map((index) => (
                              <span
                                key={`${normalizedBatchScope}-${index}`}
                                className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-[color:var(--muted)]"
                              >
                                第 {index + 1} 段
                              </span>
                            ))}
                            {batchQueuePreview.length > batchQueuePreviewParagraphs.length ? (
                              <span className="rounded-full bg-stone-200 px-3 py-1 text-[11px] font-semibold text-stone-700">
                                还有 {batchQueuePreview.length - batchQueuePreviewParagraphs.length} 段
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {selectedBookBatchSession ? (
                      <div className="mt-4 rounded-[18px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                              上次批量任务
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "rounded-full px-3 py-1 text-[11px] font-semibold",
                                  getBatchSessionStatusClassName(
                                    selectedBookBatchSession.status,
                                  ),
                                )}
                              >
                                {getBatchSessionStatusLabel(selectedBookBatchSession.status)}
                              </span>
                              <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-[color:var(--muted)]">
                                {selectedBookBatchSessionQueueLabel}
                              </span>
                              <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-[color:var(--muted)]">
                                已处理 {selectedBookBatchSession.processedCount}/
                                {selectedBookBatchSession.queueTotal} 段
                              </span>
                            </div>
                            <p className="mt-3 text-sm font-semibold text-[color:var(--foreground)]">
                              成功 {selectedBookBatchSession.successCount} 段，失败{" "}
                              {selectedBookBatchSession.failedCount} 段，当前还可继续处理{" "}
                              {resumableBatchQueue.length} 段。
                            </p>
                            <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                              开始于 {formatRelativeDate(selectedBookBatchSession.startedAt)}，
                              最近更新于 {formatRelativeDate(selectedBookBatchSession.updatedAt)}。
                              {selectedBookBatchSession.lastProcessedParagraphIndex !== null
                                ? ` 上次推进到第 ${
                                    selectedBookBatchSession.lastProcessedParagraphIndex + 1
                                  } 段。`
                                : ""}
                            </p>
                            {selectedBookBatchSessionObservedParagraphMs ? (
                              <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                                上次平均每段约 {formatDuration(selectedBookBatchSessionObservedParagraphMs)}。
                                {resumableBatchQueueObservedEstimateMs
                                  ? ` 以同样速度估算，剩余队列大约还需 ${formatDuration(
                                      resumableBatchQueueObservedEstimateMs,
                                    )}。`
                                  : ""}
                              </p>
                            ) : null}
                            {resumableBatchQueueRangeSummary ? (
                              <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                                当前续跑区间：{resumableBatchQueueRangeSummary}。
                              </p>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={handleResumeLastBatchSession}
                              disabled={
                                !hasTranslationConfig ||
                                isTranslating ||
                                !canResumeBatchSession
                              }
                              className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-stone-300"
                            >
                              <WandSparkles className="h-4 w-4" />
                              继续上次任务
                            </button>
                            <button
                              type="button"
                              onClick={clearLastBatchSession}
                              disabled={isTranslating}
                              className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                            >
                              清除记录
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 h-3 overflow-hidden rounded-full bg-stone-200">
                          <div
                            className="h-full rounded-full bg-[color:var(--accent)] transition-[width]"
                            style={{ width: `${selectedBookBatchSessionProgressPercent}%` }}
                          />
                        </div>

                        {resumableBatchQueuePreviewParagraphs.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {resumableBatchQueuePreviewParagraphs.map((index) => (
                              <span
                                key={`${selectedBookBatchSession.bookId}-${index}`}
                                className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-[color:var(--muted)]"
                              >
                                续跑第 {index + 1} 段
                              </span>
                            ))}
                            {resumableBatchQueue.length >
                            resumableBatchQueuePreviewParagraphs.length ? (
                              <span className="rounded-full bg-stone-200 px-3 py-1 text-[11px] font-semibold text-stone-700">
                                还有{" "}
                                {resumableBatchQueue.length -
                                  resumableBatchQueuePreviewParagraphs.length}{" "}
                                段
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">
                            当前已经没有可续跑段落了。你可以清除这条记录，或切换新的批量范围重新开始。
                          </p>
                        )}
                      </div>
                    ) : null}

                    {failedParagraphGroups.length > 0 ? (
                      <div className="mt-4 rounded-[18px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                              失败聚合
                            </p>
                            <p className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">
                              当前共有 {failedParagraphGroups.length} 类失败原因，合计{" "}
                              {translationStats.failedCount} 段失败记录。
                            </p>
                            <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                              先看是配置问题、限流，还是临时网络波动，再决定是去设置页、调请求间隔，还是直接重试这一类失败段。
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => setBatchScope("failed")}
                            disabled={!preferencesHydrated || isTranslating}
                            className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                          >
                            切到失败段落范围
                          </button>
                        </div>

                        <div className="mt-4 space-y-3">
                          {failedParagraphGroups.map((group) => {
                            const firstParagraphIndex = group.paragraphIndexes[0] ?? 0;
                            const isActiveFailureRetry =
                              isTranslating &&
                              selectedBookBatchSession?.status === "running" &&
                              (selectedBookBatchSession.queueKind ?? "scope") ===
                                "failure-category" &&
                              selectedBookBatchSession.errorCategory === group.category;

                            return (
                              <div
                                key={group.category}
                                className="rounded-[18px] border border-[color:var(--line)] bg-white/85 p-4"
                              >
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-sm font-semibold">
                                        {group.label}
                                      </span>
                                      <span className="rounded-full bg-stone-200 px-3 py-1 text-[11px] font-semibold text-stone-700">
                                        {group.count} 段
                                      </span>
                                      {group.retryable ? (
                                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                                          可直接重试
                                        </span>
                                      ) : (
                                        <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-800">
                                          建议先调整配置
                                        </span>
                                      )}
                                      {isActiveFailureRetry ? (
                                        <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-[11px] font-semibold text-[color:var(--accent-strong)]">
                                          当前正在重试这类错误
                                        </span>
                                      ) : null}
                                    </div>

                                    <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                                      {group.hint}
                                    </p>
                                    <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                                      最近错误：{group.latestMessage}
                                    </p>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {group.paragraphIndexes.slice(0, 5).map((index) => (
                                        <span
                                          key={`${group.category}-${index}`}
                                          className="rounded-full bg-[color:var(--panel)] px-3 py-1 text-[11px] font-semibold text-[color:var(--muted)]"
                                        >
                                          第 {index + 1} 段
                                        </span>
                                      ))}
                                      {group.paragraphIndexes.length > 5 ? (
                                        <span className="rounded-full bg-stone-200 px-3 py-1 text-[11px] font-semibold text-stone-700">
                                          还有 {group.paragraphIndexes.length - 5} 段
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    <Link
                                      href={buildLibraryHref(selectedBook.id, {
                                        paragraph: firstParagraphIndex + 1,
                                      })}
                                      className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50"
                                    >
                                      定位首段
                                    </Link>
                                    {group.requiresSettingsChange ? (
                                      <Link
                                        href="/settings"
                                        className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50"
                                      >
                                        去检查设置
                                      </Link>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => handleRetryFailedCategory(group.category)}
                                      disabled={
                                        !group.retryable ||
                                        !hasTranslationConfig ||
                                        isTranslating
                                      }
                                      className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-stone-300"
                                    >
                                      <WandSparkles className="h-4 w-4" />
                                      只重试这类
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 rounded-[20px] border border-[color:var(--line)] bg-white/80 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold">分块上下文</p>
                        <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                          翻译当前段时，额外携带前文若干段作为上下文。段数越大，一致性通常越好，但成本和延迟也会增加。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={resetContextSize}
                        disabled={
                          !preferencesHydrated ||
                          normalizedContextSize === DEFAULT_TRANSLATION_CONTEXT_SIZE
                        }
                        className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                      >
                        恢复默认
                      </button>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[0.7fr_0.3fr]">
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          Context Paragraphs
                        </span>
                        <input
                          type="range"
                          min={MIN_TRANSLATION_CONTEXT_SIZE}
                          max={MAX_TRANSLATION_CONTEXT_SIZE}
                          step={1}
                          value={normalizedContextSize}
                          disabled={!preferencesHydrated}
                          onChange={(event) =>
                            setContextSize(
                              normalizeTranslationContextSize(
                                Number.parseInt(event.target.value, 10),
                              ),
                            )
                          }
                          className="mt-4 w-full accent-[color:var(--accent)]"
                        />
                        <div className="mt-2 flex justify-between text-[11px] text-[color:var(--muted)]">
                          <span>{MIN_TRANSLATION_CONTEXT_SIZE} 段</span>
                          <span>{DEFAULT_TRANSLATION_CONTEXT_SIZE} 段推荐</span>
                          <span>{MAX_TRANSLATION_CONTEXT_SIZE} 段</span>
                        </div>
                      </label>

                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          当前值
                        </span>
                        <input
                          type="number"
                          min={MIN_TRANSLATION_CONTEXT_SIZE}
                          max={MAX_TRANSLATION_CONTEXT_SIZE}
                          step={1}
                          value={normalizedContextSize}
                          disabled={!preferencesHydrated}
                          onChange={(event) =>
                            setContextSize(
                              normalizeTranslationContextSize(
                                Number.parseInt(event.target.value || "0", 10),
                              ),
                            )
                          }
                          className="mt-2 w-full rounded-2xl border border-[color:var(--line)] bg-white px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]"
                        />
                      </label>
                    </div>

                    <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">
                      {preferencesHydrated
                        ? normalizedContextSize === 0
                          ? "当前会逐段独立翻译，不带前文参考，成本最低，但人名、语气和指代更容易漂移。"
                          : `当前会携带前 ${normalizedContextSize} 段作为参考。开始批量翻译后，会固定这一版上下文设置直到本轮结束。`
                        : "正在读取已保存的上下文设置..."}
                    </p>
                  </div>

                  <div className="mt-4 rounded-[20px] border border-[color:var(--line)] bg-white/80 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold">导出成果</p>
                        <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                          把当前书籍从浏览器导出为可分享文件。HTML、Markdown 与 TXT 会记住你上次选择的范围和格式；JSON 始终作为整书备份。
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-2 text-xs font-semibold text-[color:var(--accent-strong)]">
                          已翻译 {translationStats.translatedCount}/{translationStats.totalCount}
                        </span>
                        <button
                          type="button"
                          onClick={handleResetExportPreferences}
                          disabled={!preferencesHydrated || !isExportPreferencesDirty}
                          className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                        >
                          恢复默认导出偏好
                        </button>
                      </div>
                    </div>

                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                      导出范围
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {TEXT_EXPORT_SCOPE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          disabled={!preferencesHydrated}
                          onClick={() => setTextExportScope(option.value)}
                          className={cn(
                            "rounded-full border px-4 py-2 text-sm font-semibold transition",
                            normalizedTextExportScope === option.value
                              ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]"
                              : "border-[color:var(--line)] bg-white hover:bg-stone-50",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 rounded-[18px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
                      <p className="text-sm font-semibold">
                        {textExportPreview?.scopeLabel ?? "导出范围"}
                      </p>
                      <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                        {selectedTextExportScopeOption.description}
                      </p>
                    </div>

                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                      默认可读格式
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {READABLE_EXPORT_FORMAT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          disabled={!preferencesHydrated}
                          onClick={() => setPreferredReadableExportFormat(option.value)}
                          className={cn(
                            "rounded-full border px-4 py-2 text-sm font-semibold transition",
                            normalizedPreferredReadableExportFormat === option.value
                              ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]"
                              : "border-[color:var(--line)] bg-white hover:bg-stone-50",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 rounded-[18px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
                      <p className="text-sm font-semibold">
                        当前格式：{selectedReadableExportFormatOption.label}
                      </p>
                      <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                        {selectedReadableExportFormatOption.description}
                      </p>
                      <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                        {readableExportSummary}
                      </p>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={handleExportPreferredReadableBook}
                        disabled={!canExportReadableBook}
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-stone-300"
                      >
                        <Download className="h-4 w-4" />
                        按当前设置导出
                      </button>
                      <button
                        type="button"
                        onClick={handleExportBookAsJson}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-4 py-3 text-sm font-semibold transition hover:bg-stone-50"
                      >
                        <Download className="h-4 w-4" />
                        导出 JSON
                      </button>
                    </div>

                    <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">
                      {preferencesHydrated
                        ? "HTML、Markdown 与 TXT 的导出偏好会自动保存在当前浏览器；JSON 会始终导出整书备份。"
                        : "正在读取已保存的导出偏好..."}
                    </p>
                  </div>

                  <div className="mt-4 rounded-[20px] border border-[color:var(--line)] bg-white/80 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold">附加翻译提示</p>
                        <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                          用来微调语气、术语和风格，会同时影响批量翻译和单段重译。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={resetExtraInstructions}
                        disabled={!extraInstructions}
                        className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                      >
                        清空提示
                      </button>
                    </div>

                    <textarea
                      className={promptInputClassName}
                      rows={4}
                      value={extraInstructions}
                      disabled={!preferencesHydrated}
                      onChange={(event) => setExtraInstructions(event.target.value)}
                      placeholder="例如：中文更克制一点，减少网络感；人名与专有名词保持统一；对话要自然。"
                    />

                    <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                      {preferencesHydrated
                        ? "输入内容会自动保存在当前浏览器。"
                        : "正在读取已保存的附加提示..."}
                    </p>
                  </div>

                  <div className="mt-4 rounded-[20px] border border-[color:var(--line)] bg-white/80 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">术语表</p>
                        <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                          为人名、地名、组织名和固定表达指定译法。只有英文原词和中文译法都填写完整时，术语才会生效。
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-2 text-xs font-semibold text-[color:var(--accent-strong)]">
                          生效 {activeGlossaryTerms.length} 条
                        </span>
                        <input
                          ref={glossaryImportInputRef}
                          type="file"
                          accept=".json,application/json"
                          className="sr-only"
                          onChange={(event) => void handleImportGlossary(event)}
                          disabled={!preferencesHydrated}
                        />
                        <button
                          type="button"
                          onClick={() => glossaryImportInputRef.current?.click()}
                          disabled={!preferencesHydrated}
                          className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                        >
                          <Upload className="h-4 w-4" />
                          导入 JSON
                        </button>
                        <button
                          type="button"
                          onClick={handleExportGlossary}
                          disabled={!preferencesHydrated || glossaryTerms.length === 0}
                          className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                        >
                          <Download className="h-4 w-4" />
                          导出 JSON
                        </button>
                        <button
                          type="button"
                          onClick={addGlossaryTerm}
                          disabled={!preferencesHydrated}
                          className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50"
                        >
                          <Plus className="h-4 w-4" />
                          新增术语
                        </button>
                        <button
                          type="button"
                          onClick={resetGlossaryTerms}
                          disabled={!preferencesHydrated || glossaryTerms.length === 0}
                          className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                        >
                          清空术语
                        </button>
                      </div>
                    </div>

                    {glossaryTerms.length === 0 ? (
                      <div className="mt-4 rounded-[18px] border border-dashed border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-5 text-sm leading-6 text-[color:var(--muted)]">
                        还没有术语条目。可以先录入角色名、地名、机构名，减少整本书里的译法漂移。
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {glossaryTerms.map((term, glossaryIndex) => (
                          <div
                            key={term.id}
                            className="rounded-[18px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                                Term {glossaryIndex + 1}
                              </p>
                              <button
                                type="button"
                                onClick={() => removeGlossaryTerm(term.id)}
                                disabled={!preferencesHydrated}
                                className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:text-red-600 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                              >
                                删除
                              </button>
                            </div>

                            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1.2fr]">
                              <label className="space-y-2">
                                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                                  Source
                                </span>
                                <input
                                  type="text"
                                  value={term.source}
                                  disabled={!preferencesHydrated}
                                  onChange={(event) =>
                                    updateGlossaryTerm(term.id, {
                                      source: event.target.value,
                                    })
                                  }
                                  className="w-full rounded-2xl border border-[color:var(--line)] bg-white px-4 py-3 text-sm outline-none transition placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]"
                                  placeholder="如 Elizabeth Bennet"
                                />
                              </label>

                              <label className="space-y-2">
                                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                                  Target
                                </span>
                                <input
                                  type="text"
                                  value={term.target}
                                  disabled={!preferencesHydrated}
                                  onChange={(event) =>
                                    updateGlossaryTerm(term.id, {
                                      target: event.target.value,
                                    })
                                  }
                                  className="w-full rounded-2xl border border-[color:var(--line)] bg-white px-4 py-3 text-sm outline-none transition placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]"
                                  placeholder="如 伊丽莎白·班纳特"
                                />
                              </label>

                              <label className="space-y-2">
                                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                                  Note
                                </span>
                                <input
                                  type="text"
                                  value={term.note}
                                  disabled={!preferencesHydrated}
                                  onChange={(event) =>
                                    updateGlossaryTerm(term.id, {
                                      note: event.target.value,
                                    })
                                  }
                                  className="w-full rounded-2xl border border-[color:var(--line)] bg-white px-4 py-3 text-sm outline-none transition placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]"
                                  placeholder="可选：如 保留英式贵族语感"
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">
                      {preferencesHydrated
                        ? "术语表会自动保存在当前浏览器，也可以导入或导出 JSON。批量翻译开始后，会固定当前这一版术语设置。"
                        : "正在读取已保存的术语表..."}
                    </p>
                  </div>

                  {activeParagraphIndex !== null ? (
                    <p className="mt-2 text-sm font-semibold text-[color:var(--accent-strong)]">
                      {translationMode === "single"
                        ? `正在重译第 ${activeParagraphIndex + 1} 段...`
                        : `正在翻译第 ${activeParagraphIndex + 1} 段...`}
                    </p>
                  ) : null}

                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    {isTranslating ? (
                      <button
                        type="button"
                        onClick={handleStopTranslation}
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--foreground)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-black"
                      >
                        <Square className="h-4 w-4" />
                        停止翻译
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleTranslateBook()}
                        disabled={!hasTranslationConfig || batchQueuePreview.length === 0}
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-stone-300"
                      >
                        <WandSparkles className="h-4 w-4" />
                        {batchActionLabel}
                      </button>
                    )}

                    <Link
                      href={
                        selectedBook
                          ? `/reader?book=${encodeURIComponent(selectedBook.id)}&p=${
                              selectedBook.readingProgress.lastReadParagraphIndex + 1
                            }`
                          : "/reader"
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-5 py-3 text-sm font-semibold transition hover:bg-stone-50"
                    >
                      <PanelsTopLeft className="h-4 w-4" />
                      进入阅读器
                    </Link>

                    <button
                      type="button"
                      onClick={() => void handleClearTranslations()}
                      disabled={
                        isTranslating ||
                        (translationStats.translatedCount === 0 &&
                          translationStats.failedCount === 0)
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-5 py-3 text-sm font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-200"
                    >
                      <RefreshCcw className="h-4 w-4" />
                      清空译文
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {targetedParagraph ? (
              <div className="rounded-[24px] border border-[color:var(--accent)] bg-[color:var(--accent-soft)]/55 p-4">
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-[color:var(--accent-strong)]">
                      Deep Link
                    </p>
                    <p className="mt-2 text-sm font-semibold">
                      已定位到第 {targetedParagraph.index + 1} 段
                      {targetedParagraphSectionTitle
                        ? ` · ${targetedParagraphSectionTitle}`
                        : ""}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">
                      {targetedParagraphWorkflowHint}
                    </p>
                  </div>

                  <div className="rounded-[20px] border border-[color:var(--line)] bg-white/82 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-semibold",
                          getStatusClassName(targetedParagraph.translationStatus),
                        )}
                      >
                        {getStatusLabel(targetedParagraph.translationStatus)}
                      </span>
                      <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--accent-strong)]">
                        当前预览已带上前后上下文
                      </span>
                    </div>

                    {targetedParagraph.translationError ? (
                      <p className="mt-3 text-sm leading-6 text-red-600">
                        上次错误：{targetedParagraph.translationError}
                      </p>
                    ) : null}

                    {!hasTranslationConfig ? (
                      <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
                        当前还不能直接处理这段。先去设置页补全 API Key、Base URL 和模型配置。
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                      <button
                        type="button"
                        onClick={() => void handleRetranslateParagraph(targetedParagraph.index)}
                        disabled={
                          !hasTranslationConfig ||
                          isTranslating ||
                          targetedParagraph.translationStatus === "translating"
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-stone-300"
                      >
                        <RefreshCcw className="h-4 w-4" />
                        {targetedParagraphActionLabel}
                      </button>

                      {targetedPreviousParagraph ? (
                        <Link
                          href={buildLibraryHref(selectedBook.id, {
                            paragraph: targetedPreviousParagraph.index + 1,
                          })}
                          className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-3 text-sm font-semibold transition hover:bg-stone-50"
                        >
                          查看上一段上下文
                        </Link>
                      ) : null}

                      {targetedNextParagraph ? (
                        <Link
                          href={buildLibraryHref(selectedBook.id, {
                            paragraph: targetedNextParagraph.index + 1,
                          })}
                          className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-3 text-sm font-semibold transition hover:bg-stone-50"
                        >
                          查看下一段上下文
                        </Link>
                      ) : null}

                      <Link
                        href={`/reader?book=${encodeURIComponent(selectedBook.id)}&p=${
                          targetedParagraph.index + 1
                        }`}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-4 py-3 text-sm font-semibold transition hover:bg-stone-50"
                      >
                        <PanelsTopLeft className="h-4 w-4" />
                        回到阅读器
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              {previewParagraphs.map((paragraph) => (
                <article
                  key={paragraph.id}
                  className={cn(
                    "rounded-[24px] border bg-white/80 p-5",
                    targetedParagraph?.id === paragraph.id
                      ? "border-[color:var(--accent)] shadow-[0_18px_40px_rgba(212,104,52,0.12)]"
                      : "border-[color:var(--line)]",
                  )}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--muted)]">
                        Paragraph {paragraph.index + 1}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        {targetedParagraph?.id === paragraph.id ? (
                          <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--accent-strong)]">
                            来自阅读器
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            "rounded-full px-3 py-1 text-xs font-semibold",
                            getStatusClassName(paragraph.translationStatus),
                          )}
                        >
                          {getStatusLabel(paragraph.translationStatus)}
                        </span>
                        {paragraph.index === activeParagraphIndex && isTranslating ? (
                          <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--accent-strong)]">
                            处理中
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleRetranslateParagraph(paragraph.index)}
                      disabled={
                        !hasTranslationConfig ||
                        isTranslating ||
                        paragraph.translationStatus === "translating"
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                    >
                      <RefreshCcw className="h-4 w-4" />
                      {getSingleParagraphActionLabel(paragraph)}
                    </button>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-[20px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                        English
                      </p>
                      <p className="mt-3 text-sm leading-7 text-[color:var(--foreground)]">
                        {paragraph.sourceText}
                      </p>
                    </div>

                    <div className="rounded-[20px] border border-[color:var(--line)] bg-[color:var(--panel-strong)] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                        Chinese
                      </p>
                      <p className="mt-3 text-sm leading-7 text-[color:var(--foreground)]">
                        {paragraph.translatedText || "这段还没有译文。"}
                      </p>
                    </div>
                  </div>

                  {paragraph.translationError ? (
                    <p className="mt-3 text-sm text-red-600">
                      错误：{paragraph.translationError}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>

            {selectedBook.paragraphs.length > LIBRARY_PREVIEW_PARAGRAPH_LIMIT ? (
              <div className="rounded-[24px] border border-dashed border-[color:var(--line)] bg-white/60 p-4 text-sm text-[color:var(--muted)]">
                {targetedParagraph
                  ? `当前只展示目标段落附近的 ${previewParagraphs.length} 段，方便你直接处理第 ${
                      targetedParagraph.index + 1
                    } 段。`
                  : `这里只展示前 ${LIBRARY_PREVIEW_PARAGRAPH_LIMIT} 段。后续阅读器会读取整本书的全部段落与译文。`}
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

type MetricCardProps = {
  hint: string;
  label: string;
  value: string;
};

function MetricCard({ hint, label, value }: MetricCardProps) {
  return (
    <div className="rounded-[24px] border border-[color:var(--line)] bg-white/75 px-4 py-4">
      <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-[color:var(--muted)]">{hint}</p>
    </div>
  );
}
