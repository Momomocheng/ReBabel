import type {
  BookBookmark,
  BookParagraph,
  BookReadingProgress,
  BookRecord,
  BookSection,
  TranslationReviewStatus,
  TranslationStatus,
} from "@/lib/books/types";
import type { ReaderReviewChecklistItem } from "@/lib/books/review-checklist";
import { normalizeTranslationReviewStatus } from "@/lib/books/review-status";
import { normalizeBookSections } from "@/lib/books/sections";

type BookBookmarkLike = Partial<BookBookmark> | null | undefined;

type BookParagraphLike = Omit<
  BookParagraph,
  "reviewStatus" | "translationStatus" | "translationError"
> & {
  reviewStatus?: TranslationReviewStatus;
  translationError?: string | null;
  translationStatus?: TranslationStatus;
};

type BookRecordLike = Omit<
  BookRecord,
  "bookmarks" | "paragraphs" | "readingProgress" | "sections"
> & {
  bookmarks?: BookBookmarkLike[] | null;
  paragraphs: BookParagraphLike[];
  readingProgress?: Partial<BookReadingProgress> | null;
  sections?: Array<Partial<BookSection> | null> | null;
};

type NormalizeOptions = {
  resetTranslating?: boolean;
};

function normalizeParagraph(
  paragraph: BookParagraphLike,
  options: NormalizeOptions = {},
): BookParagraph {
  const translatedText = paragraph.translatedText?.trim() || null;
  const status = paragraph.translationStatus;
  const hasTranslation = Boolean(translatedText);
  const reviewStatus = hasTranslation
    ? normalizeTranslationReviewStatus(paragraph.reviewStatus)
    : "unreviewed";

  if (status === "error") {
    return {
      ...paragraph,
      reviewStatus: "unreviewed",
      translatedText,
      translationStatus: "error",
      translationError: paragraph.translationError ?? "翻译失败。",
    };
  }

  if (status === "done" && hasTranslation) {
    return {
      ...paragraph,
      reviewStatus,
      translatedText,
      translationStatus: "done",
      translationError: null,
    };
  }

  if (hasTranslation) {
    return {
      ...paragraph,
      reviewStatus,
      translatedText,
      translationStatus: "done",
      translationError: null,
    };
  }

  if (status === "translating") {
    return {
      ...paragraph,
      reviewStatus: "unreviewed",
      translatedText: null,
      translationStatus: options.resetTranslating ? "pending" : "translating",
      translationError: null,
    };
  }

  return {
    ...paragraph,
    reviewStatus: "unreviewed",
    translatedText: null,
    translationStatus: "pending",
    translationError: null,
  };
}

function normalizeParagraphText(text: string | null | undefined) {
  return text?.trim() || null;
}

function shouldResetParagraphReviewStatus(
  paragraph: BookParagraph,
  patch: Partial<BookParagraph>,
) {
  if (patch.reviewStatus !== undefined) {
    return false;
  }

  if (
    patch.translationStatus !== undefined &&
    patch.translationStatus !== "done"
  ) {
    return true;
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "translatedText") &&
    normalizeParagraphText(patch.translatedText) !==
      normalizeParagraphText(paragraph.translatedText)
  ) {
    return true;
  }

  return false;
}

function normalizeReadingProgress(
  readingProgress: BookRecordLike["readingProgress"],
  paragraphCount: number,
): BookReadingProgress {
  const fallbackIndex = 0;
  const maxIndex = Math.max(paragraphCount - 1, 0);
  const rawIndex = readingProgress?.lastReadParagraphIndex ?? fallbackIndex;

  return {
    lastReadAt: readingProgress?.lastReadAt ?? null,
    lastReadParagraphIndex: Math.min(Math.max(rawIndex, 0), maxIndex),
  };
}

function createBookBookmarkId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBookBookmarks(
  bookmarks: BookRecordLike["bookmarks"],
  paragraphCount: number,
) {
  const maxIndex = Math.max(paragraphCount - 1, 0);
  const dedupedBookmarks = new Map<number, BookBookmark>();

  (bookmarks ?? []).forEach((bookmark) => {
    if (!bookmark) {
      return;
    }

    const rawParagraphIndex = bookmark.paragraphIndex;
    const paragraphIndex = Number.isFinite(rawParagraphIndex)
      ? Math.min(Math.max(Math.floor(rawParagraphIndex ?? 0), 0), maxIndex)
      : 0;
    const note = bookmark.note?.trim() ?? "";
    const createdAt = bookmark.createdAt?.trim() || new Date().toISOString();
    const updatedAt = bookmark.updatedAt?.trim() || createdAt;

    dedupedBookmarks.set(paragraphIndex, {
      id: bookmark.id?.trim() || createBookBookmarkId(),
      createdAt,
      note,
      paragraphIndex,
      updatedAt,
    });
  });

  return [...dedupedBookmarks.values()].sort(
    (left, right) => left.paragraphIndex - right.paragraphIndex,
  );
}

export function normalizeBookRecord(
  book: BookRecordLike,
  options: NormalizeOptions = {},
): BookRecord {
  const paragraphs = book.paragraphs.map((paragraph) =>
    normalizeParagraph(paragraph, options),
  );

  return {
    ...book,
    bookmarks: normalizeBookBookmarks(book.bookmarks, paragraphs.length),
    paragraphs,
    sections: normalizeBookSections(book.sections, paragraphs.length),
    readingProgress: normalizeReadingProgress(book.readingProgress, paragraphs.length),
  };
}

export function updateBookParagraph(
  book: BookRecord,
  index: number,
  patch: Partial<BookParagraph>,
) {
  return {
    ...book,
    updatedAt: new Date().toISOString(),
    paragraphs: book.paragraphs.map((paragraph) =>
      paragraph.index === index
        ? normalizeParagraph({
            ...paragraph,
            ...patch,
            ...(shouldResetParagraphReviewStatus(paragraph, patch)
              ? {
                  reviewStatus: "unreviewed" as const,
                }
              : {}),
          })
        : paragraph,
    ),
  };
}

export function updateBookParagraphReviewStatus(
  book: BookRecord,
  index: number,
  reviewStatus: TranslationReviewStatus,
) {
  return updateBookParagraph(book, index, {
    reviewStatus,
  });
}

export function updateBookParagraphReviewStatuses(
  book: BookRecord,
  paragraphIndexes: number[],
  reviewStatus: TranslationReviewStatus,
) {
  const paragraphIndexSet = new Set(paragraphIndexes);

  return {
    ...book,
    updatedAt: new Date().toISOString(),
    paragraphs: book.paragraphs.map((paragraph) =>
      paragraphIndexSet.has(paragraph.index) &&
      paragraph.translationStatus === "done"
        ? normalizeParagraph({
            ...paragraph,
            reviewStatus,
          })
        : paragraph,
    ),
  };
}

export function clearBookTranslations(book: BookRecord) {
  return {
    ...book,
    updatedAt: new Date().toISOString(),
    paragraphs: book.paragraphs.map((paragraph) => ({
      ...paragraph,
      reviewStatus: "unreviewed" as const,
      translatedText: null,
      translationStatus: "pending" as const,
      translationError: null,
    })),
  };
}

export function updateBookReadingProgress(
  book: BookRecord,
  lastReadParagraphIndex: number,
) {
  return normalizeBookRecord({
    ...book,
    readingProgress: {
      lastReadAt: new Date().toISOString(),
      lastReadParagraphIndex,
    },
  });
}

export function toggleBookBookmark(book: BookRecord, paragraphIndex: number) {
  const now = new Date().toISOString();
  const existingBookmark = book.bookmarks.find(
    (bookmark) => bookmark.paragraphIndex === paragraphIndex,
  );

  if (existingBookmark) {
    return normalizeBookRecord({
      ...book,
      updatedAt: now,
      bookmarks: book.bookmarks.filter(
        (bookmark) => bookmark.paragraphIndex !== paragraphIndex,
      ),
    });
  }

  return normalizeBookRecord({
    ...book,
    updatedAt: now,
    bookmarks: [
      ...book.bookmarks,
      {
        id: createBookBookmarkId(),
        createdAt: now,
        note: "",
        paragraphIndex,
        updatedAt: now,
      },
    ],
  });
}

export function updateBookBookmarkNote(
  book: BookRecord,
  paragraphIndex: number,
  note: string,
) {
  const now = new Date().toISOString();
  const normalizedNote = note.trim();
  const existingBookmark = book.bookmarks.find(
    (bookmark) => bookmark.paragraphIndex === paragraphIndex,
  );

  if (!existingBookmark) {
    return normalizeBookRecord({
      ...book,
      updatedAt: now,
      bookmarks: [
        ...book.bookmarks,
        {
          id: createBookBookmarkId(),
          createdAt: now,
          note: normalizedNote,
          paragraphIndex,
          updatedAt: now,
        },
      ],
    });
  }

  return normalizeBookRecord({
    ...book,
    updatedAt: now,
    bookmarks: book.bookmarks.map((bookmark) =>
      bookmark.paragraphIndex === paragraphIndex
        ? {
            ...bookmark,
            note: normalizedNote,
            updatedAt: now,
          }
      : bookmark,
    ),
  });
}

export function mergeBookBookmarks(book: BookRecord, bookmarks: BookBookmark[]) {
  const now = new Date().toISOString();
  const importedParagraphIndexes = new Set(
    bookmarks.map((bookmark) => bookmark.paragraphIndex),
  );

  return normalizeBookRecord({
    ...book,
    updatedAt: now,
    bookmarks: [
      ...book.bookmarks.filter(
        (bookmark) => !importedParagraphIndexes.has(bookmark.paragraphIndex),
      ),
      ...bookmarks,
    ],
  });
}

export function mergeBookReviewChecklist(
  book: BookRecord,
  items: ReaderReviewChecklistItem[],
) {
  const now = new Date().toISOString();
  const nextParagraphs = [...book.paragraphs];
  const nextBookmarks = [...book.bookmarks];
  const paragraphArrayIndexByIndex = new Map(
    nextParagraphs.map((paragraph, index) => [paragraph.index, index]),
  );
  const bookmarkArrayIndexByIndex = new Map(
    nextBookmarks.map((bookmark, index) => [bookmark.paragraphIndex, index]),
  );
  const itemByParagraphIndex = new Map(
    items.map((item) => [item.paragraphIndex, item]),
  );

  let matchedParagraphCount = 0;
  let mergedBookmarkCount = 0;
  let updatedReviewCount = 0;
  const bookmarkMergeParagraphIndexes: number[] = [];
  const reviewUpdateParagraphIndexes: number[] = [];
  let skippedMissingParagraphCount = 0;
  const skippedMissingParagraphIndexes: number[] = [];
  let skippedSourceMismatchCount = 0;
  const skippedSourceMismatchParagraphIndexes: number[] = [];
  let skippedTranslationMismatchCount = 0;
  const skippedTranslationMismatchParagraphIndexes: number[] = [];

  itemByParagraphIndex.forEach((item, paragraphIndex) => {
    const paragraphArrayIndex = paragraphArrayIndexByIndex.get(paragraphIndex);

    if (paragraphArrayIndex === undefined) {
      skippedMissingParagraphCount += 1;
      skippedMissingParagraphIndexes.push(paragraphIndex);
      return;
    }

    const paragraph = nextParagraphs[paragraphArrayIndex]!;

    if (
      normalizeParagraphText(paragraph.sourceText) !==
      normalizeParagraphText(item.sourceText)
    ) {
      skippedSourceMismatchCount += 1;
      skippedSourceMismatchParagraphIndexes.push(paragraphIndex);
      return;
    }

    matchedParagraphCount += 1;

    const importedBookmarkNote = item.bookmarkNote.trim();

    if (importedBookmarkNote) {
      const bookmarkArrayIndex = bookmarkArrayIndexByIndex.get(paragraphIndex);

      if (bookmarkArrayIndex === undefined) {
        nextBookmarks.push({
          id: createBookBookmarkId(),
          createdAt: now,
          note: importedBookmarkNote,
          paragraphIndex,
          updatedAt: now,
        });
        bookmarkArrayIndexByIndex.set(paragraphIndex, nextBookmarks.length - 1);
        mergedBookmarkCount += 1;
        bookmarkMergeParagraphIndexes.push(paragraphIndex);
      } else if (nextBookmarks[bookmarkArrayIndex]!.note !== importedBookmarkNote) {
        nextBookmarks[bookmarkArrayIndex] = {
          ...nextBookmarks[bookmarkArrayIndex]!,
          note: importedBookmarkNote,
          updatedAt: now,
        };
        mergedBookmarkCount += 1;
        bookmarkMergeParagraphIndexes.push(paragraphIndex);
      }
    }

    if (
      paragraph.translationStatus !== "done" ||
      item.translationStatus !== "done"
    ) {
      return;
    }

    if (
      normalizeParagraphText(paragraph.translatedText) !==
      normalizeParagraphText(item.translatedText)
    ) {
      skippedTranslationMismatchCount += 1;
      skippedTranslationMismatchParagraphIndexes.push(paragraphIndex);
      return;
    }

    if (paragraph.reviewStatus === item.reviewStatus) {
      return;
    }

    nextParagraphs[paragraphArrayIndex] = normalizeParagraph({
      ...paragraph,
      reviewStatus: item.reviewStatus,
    });
    updatedReviewCount += 1;
    reviewUpdateParagraphIndexes.push(paragraphIndex);
  });

  const hasChanges = mergedBookmarkCount > 0 || updatedReviewCount > 0;

  return {
    book: hasChanges
      ? normalizeBookRecord({
          ...book,
          updatedAt: now,
          bookmarks: nextBookmarks,
          paragraphs: nextParagraphs,
        })
      : book,
    bookmarkMergeParagraphIndexes,
    matchedParagraphCount,
    mergedBookmarkCount,
    skippedMissingParagraphCount,
    skippedMissingParagraphIndexes,
    skippedSourceMismatchCount,
    skippedSourceMismatchParagraphIndexes,
    skippedTranslationMismatchCount,
    skippedTranslationMismatchParagraphIndexes,
    reviewUpdateParagraphIndexes,
    updatedReviewCount,
  };
}

export function getBookTranslationStats(book: BookRecord) {
  const translatedCount = book.paragraphs.filter(
    (paragraph) => paragraph.translationStatus === "done",
  ).length;
  const failedCount = book.paragraphs.filter(
    (paragraph) => paragraph.translationStatus === "error",
  ).length;
  const runningCount = book.paragraphs.filter(
    (paragraph) => paragraph.translationStatus === "translating",
  ).length;
  const pendingCount =
    book.paragraphs.length - translatedCount - failedCount - runningCount;

  return {
    totalCount: book.paragraphs.length,
    translatedCount,
    failedCount,
    runningCount,
    pendingCount,
    progressPercent:
      book.paragraphs.length === 0
        ? 0
        : Math.round((translatedCount / book.paragraphs.length) * 100),
  };
}

export function getBookReviewStats(book: BookRecord) {
  const translatedParagraphs = book.paragraphs.filter(
    (paragraph) => paragraph.translationStatus === "done",
  );
  const reviewedCount = translatedParagraphs.filter(
    (paragraph) => paragraph.reviewStatus === "reviewed",
  ).length;
  const needsRevisionCount = translatedParagraphs.filter(
    (paragraph) => paragraph.reviewStatus === "needs-revision",
  ).length;
  const unreviewedCount =
    translatedParagraphs.length - reviewedCount - needsRevisionCount;

  return {
    reviewedCount,
    needsRevisionCount,
    translatedCount: translatedParagraphs.length,
    unreviewedCount,
  };
}
