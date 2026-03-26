import type {
  BookBookmark,
  BookParagraph,
  BookReadingProgress,
  BookRecord,
  BookSection,
  TranslationStatus,
} from "@/lib/books/types";
import { normalizeBookSections } from "@/lib/books/sections";

type BookBookmarkLike = Partial<BookBookmark> | null | undefined;

type BookParagraphLike = Omit<BookParagraph, "translationStatus" | "translationError"> & {
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

  if (status === "error") {
    return {
      ...paragraph,
      translatedText,
      translationStatus: "error",
      translationError: paragraph.translationError ?? "翻译失败。",
    };
  }

  if (status === "done" && hasTranslation) {
    return {
      ...paragraph,
      translatedText,
      translationStatus: "done",
      translationError: null,
    };
  }

  if (hasTranslation) {
    return {
      ...paragraph,
      translatedText,
      translationStatus: "done",
      translationError: null,
    };
  }

  if (status === "translating") {
    return {
      ...paragraph,
      translatedText: null,
      translationStatus: options.resetTranslating ? "pending" : "translating",
      translationError: null,
    };
  }

  return {
    ...paragraph,
    translatedText: null,
    translationStatus: "pending",
    translationError: null,
  };
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
