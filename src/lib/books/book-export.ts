import { z, ZodError } from "zod";
import type { BookTextExportScope } from "@/lib/books/export-options";
import { getBookTranslationStats } from "@/lib/books/book-record";
import { normalizeBookRecord } from "@/lib/books/book-record";
import { buildBookStats, deriveTitleFromFileName } from "@/lib/books/parser";
import {
  getSectionIndexForParagraph,
  getSectionParagraphRange,
} from "@/lib/books/sections";
import type { BookRecord } from "@/lib/books/types";
import type { BookBookmark, BookParagraph } from "@/lib/books/types";
import type { TranslationStatus } from "@/lib/books/types";

const BOOK_EXPORT_FILE_TYPE = "rebabel-book";
const BOOK_EXPORT_FILE_VERSION = 1;

export type BookExportFormat = "html" | "json" | "markdown" | "txt";

type BookTextExportSnapshot = {
  bookmarks: BookBookmark[];
  paragraphs: BookParagraph[];
  scopeFileSegment: string | null;
  scopeLabel: string;
  sectionTitleByParagraphIndex: Map<number, string>;
  stats: ReturnType<typeof buildBookStats>;
};

const translationStatusSchema = z.enum([
  "pending",
  "translating",
  "done",
  "error",
] satisfies TranslationStatus[]);

const bookExportParagraphSchema = z.object({
  id: z.string().optional(),
  index: z.number().int().nonnegative().optional(),
  sourceText: z.string(),
  translatedText: z.string().nullable().optional(),
  translationError: z.string().nullable().optional(),
  translationStatus: translationStatusSchema.optional(),
});

const bookExportBookmarkSchema = z.object({
  createdAt: z.string().optional(),
  id: z.string().optional(),
  note: z.string().optional(),
  paragraphIndex: z.number().int().nonnegative().optional(),
  updatedAt: z.string().optional(),
});

const bookExportSectionSchema = z.object({
  id: z.string().optional(),
  startParagraphIndex: z.number().int().nonnegative().optional(),
  title: z.string().optional(),
});

const bookRecordImportSchema = z.object({
  bookmarks: z.array(bookExportBookmarkSchema).optional(),
  createdAt: z.string().optional(),
  id: z.string().optional(),
  originalFileName: z.string().optional(),
  paragraphs: z.array(bookExportParagraphSchema),
  readingProgress: z
    .object({
      lastReadAt: z.string().nullable().optional(),
      lastReadParagraphIndex: z.number().int().nonnegative().optional(),
    })
    .optional(),
  sections: z.array(bookExportSectionSchema).optional(),
  stats: z
    .object({
      characterCount: z.number().int().nonnegative().optional(),
      paragraphCount: z.number().int().nonnegative().optional(),
      wordCount: z.number().int().nonnegative().optional(),
    })
    .optional(),
  title: z.string().optional(),
  updatedAt: z.string().optional(),
});

const bookExportFileSchema = z.object({
  book: bookRecordImportSchema,
  exportedAt: z.string().optional(),
  type: z.literal(BOOK_EXPORT_FILE_TYPE),
  version: z.literal(BOOK_EXPORT_FILE_VERSION),
});

function createImportedBookEntityId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function hasCompleteStats(
  stats: z.infer<typeof bookRecordImportSchema>["stats"],
): stats is {
  characterCount: number;
  paragraphCount: number;
  wordCount: number;
} {
  return Boolean(
    stats &&
      Number.isFinite(stats.characterCount) &&
      Number.isFinite(stats.paragraphCount) &&
      Number.isFinite(stats.wordCount),
  );
}

function sanitizeFileSegment(value: string) {
  const normalized = value
    .trim()
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "rebabel-book";
}

function formatExportDate(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function buildExportSummaryLines(book: BookRecord) {
  const translationStats = getBookTranslationStats(book);

  return [
    `书名：${book.title}`,
    `源文件：${book.originalFileName}`,
    `导出时间：${formatExportDate(new Date().toISOString())}`,
    `总段落：${book.stats.paragraphCount}`,
    `已翻译：${translationStats.translatedCount}`,
    `失败段落：${translationStats.failedCount}`,
    `待处理：${translationStats.pendingCount}`,
    `书签数：${book.bookmarks.length}`,
  ];
}

function buildBookmarksMarkdown(book: BookRecord) {
  if (book.bookmarks.length === 0) {
    return "";
  }

  return [
    "## 阅读笔记",
    "",
    ...book.bookmarks.flatMap((bookmark) => [
      `### Paragraph ${bookmark.paragraphIndex + 1}`,
      `- 更新时间：${formatExportDate(bookmark.updatedAt)}`,
      `- 批注：${bookmark.note || "无"}`,
      "",
    ]),
  ].join("\n");
}

function buildBookmarksText(book: BookRecord) {
  if (book.bookmarks.length === 0) {
    return "";
  }

  return [
    "==== 阅读笔记 ====",
    "",
    ...book.bookmarks.flatMap((bookmark) => [
      `Paragraph ${bookmark.paragraphIndex + 1}`,
      `更新时间：${formatExportDate(bookmark.updatedAt)}`,
      `批注：${bookmark.note || "无"}`,
      "",
    ]),
  ].join("\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

export function buildBookExportFileName(
  book: Pick<BookRecord, "title">,
  format: BookExportFormat,
  scopeFileSegment?: string | null,
) {
  const extension = format === "markdown" ? "md" : format;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const suffix = scopeFileSegment ? `-${sanitizeFileSegment(scopeFileSegment)}` : "";

  return `${sanitizeFileSegment(book.title)}${suffix}-${dateStamp}.${extension}`;
}

function buildSectionTitleMarkers(
  book: BookRecord,
  paragraphs: BookParagraph[],
) {
  const markers = new Map<number, string>();
  let lastSectionId: string | null = null;

  paragraphs.forEach((paragraph) => {
    const sectionIndex = getSectionIndexForParagraph(book.sections, paragraph.index);
    const section = book.sections[sectionIndex];

    if (!section || section.id === lastSectionId) {
      return;
    }

    markers.set(paragraph.index, section.title);
    lastSectionId = section.id;
  });

  return markers;
}

function buildBookTextExportSnapshot(
  book: BookRecord,
  scope: BookTextExportScope,
): BookTextExportSnapshot {
  let paragraphs: BookParagraph[] = [];
  let scopeFileSegment: string | null = null;
  let scopeLabel = "整本书";

  switch (scope) {
    case "translated-only":
      paragraphs = book.paragraphs.filter((paragraph) => Boolean(paragraph.translatedText));
      scopeFileSegment = "translated-only";
      scopeLabel = "仅已翻译段落";
      break;
    case "reading-section": {
      const sectionIndex = getSectionIndexForParagraph(
        book.sections,
        book.readingProgress.lastReadParagraphIndex,
      );
      const section = book.sections[sectionIndex];
      const range = getSectionParagraphRange(
        book.sections,
        sectionIndex,
        book.paragraphs.length,
      );

      paragraphs = book.paragraphs.filter(
        (paragraph) =>
          paragraph.index >= range.startParagraphIndex &&
          paragraph.index <= range.endParagraphIndex,
      );
      scopeFileSegment = "reading-section";
      scopeLabel = section
        ? `当前阅读章节：${section.title}`
        : "当前阅读章节";
      break;
    }
    default:
      paragraphs = book.paragraphs;
      break;
  }

  const includedParagraphIndexes = new Set(paragraphs.map((paragraph) => paragraph.index));
  const bookmarks = book.bookmarks.filter((bookmark) =>
    includedParagraphIndexes.has(bookmark.paragraphIndex),
  );

  return {
    bookmarks,
    paragraphs,
    scopeFileSegment,
    scopeLabel,
    sectionTitleByParagraphIndex: buildSectionTitleMarkers(book, paragraphs),
    stats: buildBookStats(paragraphs),
  };
}

export function getBookTextExportPreview(
  book: BookRecord,
  scope: BookTextExportScope,
) {
  const snapshot = buildBookTextExportSnapshot(book, scope);

  return {
    bookmarkCount: snapshot.bookmarks.length,
    paragraphCount: snapshot.paragraphs.length,
    scopeFileSegment: snapshot.scopeFileSegment,
    scopeLabel: snapshot.scopeLabel,
  };
}

export function parseBookJsonImport(jsonText: string): BookRecord {
  try {
    const raw = JSON.parse(jsonText) as unknown;
    const parsedBook =
      typeof raw === "object" &&
      raw !== null &&
      "type" in raw &&
      raw.type === BOOK_EXPORT_FILE_TYPE
        ? bookExportFileSchema.parse(raw).book
        : bookRecordImportSchema.parse(raw);

    if (parsedBook.paragraphs.length === 0) {
      throw new Error("书籍备份文件里没有任何段落。");
    }

    const now = new Date().toISOString();
    const title =
      parsedBook.title?.trim() ||
      deriveTitleFromFileName(parsedBook.originalFileName?.trim() || "rebabel-book.json");
    const originalFileName =
      parsedBook.originalFileName?.trim() || `${sanitizeFileSegment(title)}.json`;
    const paragraphs = parsedBook.paragraphs.map((paragraph, index) => {
      const translatedText = paragraph.translatedText ?? null;

      return {
        id: paragraph.id?.trim() || createImportedBookEntityId("paragraph"),
        index,
        sourceText: paragraph.sourceText,
        translatedText,
        translationError: paragraph.translationError ?? null,
        translationStatus:
          paragraph.translationStatus ?? (translatedText ? "done" : "pending"),
      } satisfies BookRecord["paragraphs"][number];
    });

    return normalizeBookRecord(
      {
        bookmarks: parsedBook.bookmarks ?? [],
        createdAt: parsedBook.createdAt?.trim() || now,
        id: parsedBook.id?.trim() || createImportedBookEntityId("book"),
        originalFileName,
        paragraphs,
        readingProgress: parsedBook.readingProgress ?? null,
        sections: parsedBook.sections ?? [],
        stats: hasCompleteStats(parsedBook.stats)
          ? parsedBook.stats
          : buildBookStats(paragraphs),
        title,
        updatedAt: parsedBook.updatedAt?.trim() || now,
      },
      {
        resetTranslating: true,
      },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("书籍备份文件不是有效的 JSON。");
    }

    if (error instanceof ZodError) {
      throw new Error("书籍备份格式不正确。请导入 ReBabel 导出的整书 JSON。");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("读取书籍备份失败。");
  }
}

export function buildBookJsonExport(book: BookRecord) {
  const translationStats = getBookTranslationStats(book);

  return {
    book: {
      bookmarks: book.bookmarks.map((bookmark) => ({
        createdAt: bookmark.createdAt,
        id: bookmark.id,
        note: bookmark.note,
        paragraphIndex: bookmark.paragraphIndex,
        updatedAt: bookmark.updatedAt,
      })),
      createdAt: book.createdAt,
      id: book.id,
      originalFileName: book.originalFileName,
      paragraphs: book.paragraphs.map((paragraph) => ({
        id: paragraph.id,
        index: paragraph.index,
        sourceText: paragraph.sourceText,
        translatedText: paragraph.translatedText,
        translationError: paragraph.translationError,
        translationStatus: paragraph.translationStatus,
      })),
      readingProgress: book.readingProgress,
      sections: book.sections.map((section) => ({
        id: section.id,
        startParagraphIndex: section.startParagraphIndex,
        title: section.title,
      })),
      stats: book.stats,
      title: book.title,
      translationStats,
      updatedAt: book.updatedAt,
    },
    exportedAt: new Date().toISOString(),
    type: BOOK_EXPORT_FILE_TYPE,
    version: BOOK_EXPORT_FILE_VERSION,
  };
}

export function buildBookMarkdownExport(
  book: BookRecord,
  scope: BookTextExportScope = "whole-book",
) {
  const snapshot = buildBookTextExportSnapshot(book, scope);
  const scopedBook = {
    ...book,
    bookmarks: snapshot.bookmarks,
    paragraphs: snapshot.paragraphs,
    stats: snapshot.stats,
  };
  const translationStats = getBookTranslationStats(scopedBook);

  return [
    `# ${book.title}`,
    "",
    ...[
      `导出范围：${snapshot.scopeLabel}`,
      `导出段落：${snapshot.paragraphs.length}`,
      `导出书签：${snapshot.bookmarks.length}`,
      `已翻译：${translationStats.translatedCount}`,
      ...buildExportSummaryLines(book),
    ].map((line) => `- ${line}`),
    "",
    ...snapshot.paragraphs.flatMap((paragraph) => {
      const sectionTitle =
        snapshot.sectionTitleByParagraphIndex.get(paragraph.index) ?? null;

      return [
        ...(sectionTitle ? [`## ${sectionTitle}`, ""] : []),
        `### Paragraph ${paragraph.index + 1}`,
        "",
        "**EN**",
        "",
        paragraph.sourceText,
        "",
        "**ZH**",
        "",
        paragraph.translatedText || "_这段还没有译文。_",
        ...(paragraph.translationError
          ? ["", `> 错误：${paragraph.translationError}`]
          : []),
        "",
      ];
    }),
    buildBookmarksMarkdown({
      ...book,
      bookmarks: snapshot.bookmarks,
    }),
  ]
    .join("\n")
    .trim();
}

export function buildBookPlainTextExport(
  book: BookRecord,
  scope: BookTextExportScope = "whole-book",
) {
  const snapshot = buildBookTextExportSnapshot(book, scope);
  const scopedBook = {
    ...book,
    bookmarks: snapshot.bookmarks,
    paragraphs: snapshot.paragraphs,
    stats: snapshot.stats,
  };
  const translationStats = getBookTranslationStats(scopedBook);

  return [
    `导出范围：${snapshot.scopeLabel}`,
    `导出段落：${snapshot.paragraphs.length}`,
    `导出书签：${snapshot.bookmarks.length}`,
    `已翻译：${translationStats.translatedCount}`,
    "",
    ...buildExportSummaryLines(book),
    "",
    ...snapshot.paragraphs.flatMap((paragraph) => {
      const sectionTitle =
        snapshot.sectionTitleByParagraphIndex.get(paragraph.index) ?? null;

      return [
        ...(sectionTitle ? [`==== ${sectionTitle} ====`, ""] : []),
        `Paragraph ${paragraph.index + 1}`,
        `EN: ${paragraph.sourceText}`,
        `ZH: ${paragraph.translatedText || "这段还没有译文。"}`,
        ...(paragraph.translationError ? [`错误：${paragraph.translationError}`] : []),
        "",
      ];
    }),
    buildBookmarksText({
      ...book,
      bookmarks: snapshot.bookmarks,
    }),
  ]
    .join("\n")
    .trim();
}

export function buildBookHtmlExport(
  book: BookRecord,
  scope: BookTextExportScope = "whole-book",
) {
  const snapshot = buildBookTextExportSnapshot(book, scope);
  const scopedBook = {
    ...book,
    bookmarks: snapshot.bookmarks,
    paragraphs: snapshot.paragraphs,
    stats: snapshot.stats,
  };
  const translationStats = getBookTranslationStats(scopedBook);
  const summaryItems = [
    `导出范围：${snapshot.scopeLabel}`,
    `导出段落：${snapshot.paragraphs.length}`,
    `导出书签：${snapshot.bookmarks.length}`,
    `已翻译：${translationStats.translatedCount}`,
    ...buildExportSummaryLines(book),
  ];
  const paragraphHtml = snapshot.paragraphs
    .map((paragraph) => {
      const sectionTitle =
        snapshot.sectionTitleByParagraphIndex.get(paragraph.index) ?? null;
      const errorHtml = paragraph.translationError
        ? `<p class="paragraph-error">错误：${escapeHtml(paragraph.translationError)}</p>`
        : "";

      return [
        '<article class="paragraph-card">',
        sectionTitle
          ? `<div class="section-marker"><span>Section</span><strong>${escapeHtml(
              sectionTitle,
            )}</strong></div>`
          : "",
        `<div class="paragraph-meta"><span class="paragraph-index">Paragraph ${
          paragraph.index + 1
        }</span><span class="status-pill status-${paragraph.translationStatus}">${getTranslationStatusLabel(
          paragraph.translationStatus,
        )}</span></div>`,
        '<div class="paragraph-grid">',
        `<section class="panel panel-source"><h2>English</h2><p>${escapeHtml(
          paragraph.sourceText,
        )}</p></section>`,
        `<section class="panel panel-target"><h2>Chinese</h2><p>${escapeHtml(
          paragraph.translatedText || "这段还没有译文。",
        )}</p></section>`,
        "</div>",
        errorHtml,
        "</article>",
      ]
        .filter(Boolean)
        .join("");
    })
    .join("");
  const bookmarksHtml =
    snapshot.bookmarks.length === 0
      ? '<p class="bookmarks-empty">当前导出范围内没有书签或批注。</p>'
      : snapshot.bookmarks
          .map(
            (bookmark) => `
              <article class="bookmark-card">
                <div class="bookmark-head">
                  <strong>Paragraph ${bookmark.paragraphIndex + 1}</strong>
                  <span>${escapeHtml(formatExportDate(bookmark.updatedAt))}</span>
                </div>
                <p>${escapeHtml(bookmark.note || "无")}</p>
              </article>
            `,
          )
          .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(book.title)} | ReBabel Export</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f1e8;
        --paper: rgba(255, 251, 246, 0.88);
        --paper-strong: #fffdf9;
        --line: rgba(71, 57, 41, 0.14);
        --ink: #251b12;
        --muted: #6b5a4a;
        --accent: #b65c2b;
        --accent-soft: rgba(182, 92, 43, 0.12);
        --shadow: 0 22px 60px rgba(67, 45, 24, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background:
          radial-gradient(circle at top left, rgba(182, 92, 43, 0.12), transparent 32rem),
          linear-gradient(180deg, #f9f4ec 0%, var(--bg) 100%);
        color: var(--ink);
        font-family: "Source Han Serif SC", "Noto Serif SC", Georgia, serif;
      }
      .page {
        width: min(1180px, calc(100% - 32px));
        margin: 24px auto 48px;
      }
      .hero, .bookmarks, .paragraph-card {
        border: 1px solid var(--line);
        background: var(--paper);
        box-shadow: var(--shadow);
        backdrop-filter: blur(12px);
      }
      .hero {
        border-radius: 32px;
        padding: 28px;
      }
      .eyebrow {
        margin: 0;
        font: 600 12px/1.4 system-ui, sans-serif;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .hero h1 {
        margin: 14px 0 0;
        font-size: clamp(2.2rem, 4vw, 4rem);
        line-height: 1;
      }
      .hero p {
        margin: 14px 0 0;
        max-width: 68ch;
        color: var(--muted);
        font-size: 0.98rem;
        line-height: 1.8;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-top: 22px;
      }
      .meta-card {
        border-radius: 22px;
        border: 1px solid var(--line);
        background: var(--paper-strong);
        padding: 16px 18px;
      }
      .meta-card span {
        display: block;
        font: 600 11px/1.4 system-ui, sans-serif;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .meta-card strong {
        display: block;
        margin-top: 10px;
        font-size: 1.02rem;
      }
      .summary-list {
        margin: 24px 0 0;
        padding-left: 18px;
        color: var(--muted);
      }
      .summary-list li { margin-top: 8px; }
      .section {
        margin-top: 28px;
      }
      .section-title {
        margin: 0 0 14px;
        font: 600 12px/1.4 system-ui, sans-serif;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .paragraphs {
        display: grid;
        gap: 18px;
      }
      .paragraph-card {
        border-radius: 28px;
        padding: 22px;
      }
      .section-marker {
        display: inline-flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 16px;
        padding: 12px 14px;
        border-radius: 18px;
        background: var(--accent-soft);
      }
      .section-marker span {
        font: 600 11px/1.4 system-ui, sans-serif;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--accent);
      }
      .section-marker strong { font-size: 1rem; }
      .paragraph-meta {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        margin-bottom: 16px;
      }
      .paragraph-index {
        font: 600 12px/1.4 system-ui, sans-serif;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .status-pill {
        padding: 6px 12px;
        border-radius: 999px;
        font: 600 12px/1.4 system-ui, sans-serif;
      }
      .status-done { background: #dff3e7; color: #16663a; }
      .status-error { background: #fbe1de; color: #a5372c; }
      .status-pending { background: #ece6df; color: #62554a; }
      .status-translating { background: #f5e6c9; color: #8a5f16; }
      .paragraph-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      .panel {
        border-radius: 22px;
        border: 1px solid var(--line);
        padding: 18px;
        min-height: 100%;
      }
      .panel-source { background: var(--paper-strong); }
      .panel-target { background: #f9f4ee; }
      .panel h2 {
        margin: 0;
        font: 600 12px/1.4 system-ui, sans-serif;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .panel p, .bookmark-card p {
        margin: 14px 0 0;
        white-space: pre-wrap;
        line-height: 1.9;
        font-size: 0.98rem;
      }
      .paragraph-error {
        margin: 14px 0 0;
        color: #a5372c;
        font-size: 0.92rem;
      }
      .bookmarks {
        margin-top: 26px;
        border-radius: 28px;
        padding: 22px;
      }
      .bookmarks-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
      }
      .bookmarks-head h2 {
        margin: 0;
        font-size: 1.35rem;
      }
      .bookmarks-head span {
        color: var(--muted);
        font-size: 0.92rem;
      }
      .bookmarks-grid {
        display: grid;
        gap: 12px;
        margin-top: 16px;
      }
      .bookmark-card {
        border-radius: 20px;
        border: 1px solid var(--line);
        background: var(--paper-strong);
        padding: 16px 18px;
      }
      .bookmark-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 10px;
      }
      .bookmark-head span {
        color: var(--muted);
        font-size: 0.86rem;
      }
      .bookmarks-empty {
        margin: 14px 0 0;
        color: var(--muted);
      }
      @media (max-width: 840px) {
        .page { width: min(100% - 20px, 1180px); }
        .hero, .bookmarks, .paragraph-card { border-radius: 24px; }
        .paragraph-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <p class="eyebrow">ReBabel Export</p>
        <h1>${escapeHtml(book.title)}</h1>
        <p>这是从 ReBabel 导出的独立双语阅读稿。当前文件不依赖浏览器本地书库，可直接打开阅读、分享或归档。</p>
        <div class="meta-grid">
          <article class="meta-card"><span>导出范围</span><strong>${escapeHtml(
            snapshot.scopeLabel,
          )}</strong></article>
          <article class="meta-card"><span>导出段落</span><strong>${
            snapshot.paragraphs.length
          }</strong></article>
          <article class="meta-card"><span>导出书签</span><strong>${
            snapshot.bookmarks.length
          }</strong></article>
          <article class="meta-card"><span>已翻译</span><strong>${
            translationStats.translatedCount
          }</strong></article>
        </div>
        <ul class="summary-list">
          ${summaryItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>

      <section class="section">
        <p class="section-title">Side By Side Reading</p>
        <div class="paragraphs">${paragraphHtml}</div>
      </section>

      <section class="bookmarks">
        <div class="bookmarks-head">
          <h2>阅读笔记</h2>
          <span>范围内共 ${snapshot.bookmarks.length} 条</span>
        </div>
        <div class="bookmarks-grid">${bookmarksHtml}</div>
      </section>
    </main>
  </body>
</html>`;
}
