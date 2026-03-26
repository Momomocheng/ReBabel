export type TranslationStatus = "pending" | "translating" | "done" | "error";

export type BookParagraph = {
  id: string;
  index: number;
  sourceText: string;
  translatedText: string | null;
  translationStatus: TranslationStatus;
  translationError: string | null;
};

export type BookStats = {
  paragraphCount: number;
  wordCount: number;
  characterCount: number;
};

export type BookSection = {
  id: string;
  title: string;
  startParagraphIndex: number;
};

export type BookReadingProgress = {
  lastReadAt: string | null;
  lastReadParagraphIndex: number;
};

export type BookBookmark = {
  id: string;
  createdAt: string;
  note: string;
  paragraphIndex: number;
  updatedAt: string;
};

export type BookRecord = {
  id: string;
  title: string;
  originalFileName: string;
  createdAt: string;
  updatedAt: string;
  bookmarks: BookBookmark[];
  paragraphs: BookParagraph[];
  sections: BookSection[];
  readingProgress: BookReadingProgress;
  stats: BookStats;
};
