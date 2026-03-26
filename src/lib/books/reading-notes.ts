import { ZodError, z } from "zod";
import type { BookBookmark, BookRecord } from "@/lib/books/types";

const READING_NOTES_FILE_TYPE = "rebabel-reading-notes";
const READING_NOTES_FILE_VERSION = 1;

const readingNoteBookmarkSchema = z.object({
  createdAt: z.string().optional(),
  note: z.string().optional(),
  paragraphIndex: z.number().int().nonnegative().optional(),
  updatedAt: z.string().optional(),
});

const readingNotesFileSchema = z.object({
  book: z
    .object({
      id: z.string().optional(),
      originalFileName: z.string().optional(),
      title: z.string().optional(),
    })
    .optional(),
  bookmarks: z.array(readingNoteBookmarkSchema),
  exportedAt: z.string().optional(),
  type: z.literal(READING_NOTES_FILE_TYPE),
  version: z.literal(READING_NOTES_FILE_VERSION),
});

const readingNoteBookmarkArraySchema = z.array(readingNoteBookmarkSchema);

type ImportedReadingNotes = {
  book: {
    id: string;
    originalFileName: string;
    title: string;
  } | null;
  bookmarks: BookBookmark[];
};

function createImportedBookmarkId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBookmark(bookmark: z.infer<typeof readingNoteBookmarkSchema>): BookBookmark {
  const now = new Date().toISOString();

  return {
    id: createImportedBookmarkId(),
    createdAt: bookmark.createdAt?.trim() || now,
    note: bookmark.note?.trim() ?? "",
    paragraphIndex: Math.max(0, Math.floor(bookmark.paragraphIndex ?? 0)),
    updatedAt: bookmark.updatedAt?.trim() || bookmark.createdAt?.trim() || now,
  };
}

export function buildReadingNotesExport(
  book: Pick<BookRecord, "bookmarks" | "id" | "originalFileName" | "title">,
) {
  return {
    book: {
      id: book.id,
      originalFileName: book.originalFileName,
      title: book.title,
    },
    bookmarks: book.bookmarks.map((bookmark) => ({
      createdAt: bookmark.createdAt,
      note: bookmark.note,
      paragraphIndex: bookmark.paragraphIndex,
      updatedAt: bookmark.updatedAt,
    })),
    exportedAt: new Date().toISOString(),
    type: READING_NOTES_FILE_TYPE,
    version: READING_NOTES_FILE_VERSION,
  };
}

export function parseReadingNotesImport(jsonText: string): ImportedReadingNotes {
  try {
    const raw = JSON.parse(jsonText) as unknown;
    const parsed = Array.isArray(raw)
      ? {
          book: null,
          bookmarks: readingNoteBookmarkArraySchema.parse(raw),
        }
      : readingNotesFileSchema.parse(raw);

    if (parsed.bookmarks.length === 0) {
      throw new Error("阅读笔记文件里没有任何书签或批注。");
    }

    return {
      book:
        "book" in parsed
          ? {
              id: parsed.book?.id?.trim() ?? "",
              originalFileName: parsed.book?.originalFileName?.trim() ?? "",
              title: parsed.book?.title?.trim() ?? "",
            }
          : null,
      bookmarks: parsed.bookmarks.map(normalizeBookmark),
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("阅读笔记文件不是有效的 JSON。");
    }

    if (error instanceof ZodError) {
      throw new Error(
        "阅读笔记格式不正确。请导入 ReBabel 导出的 JSON，或只包含 paragraphIndex、note、createdAt、updatedAt 数组的 JSON。",
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("读取阅读笔记失败。");
  }
}
