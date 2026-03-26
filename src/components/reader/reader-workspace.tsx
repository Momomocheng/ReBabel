"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type UIEvent,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bookmark,
  BookOpenText,
  ChevronRight,
  Download,
  Languages,
  LibraryBig,
  Link2,
  PanelsLeftRight,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  getBookTranslationStats,
  mergeBookBookmarks,
  toggleBookBookmark,
  updateBookBookmarkNote,
  updateBookParagraphReviewStatus,
  updateBookReadingProgress,
} from "@/lib/books/book-record";
import {
  getTranslationReviewStatusClassName,
  getTranslationReviewStatusLabel,
} from "@/lib/books/review-status";
import {
  buildReadingNotesExport,
  parseReadingNotesImport,
} from "@/lib/books/reading-notes";
import {
  getSectionIndexForParagraph,
  getSectionParagraphRange,
} from "@/lib/books/sections";
import { listBooks, saveBook } from "@/lib/db/rebabel-db";
import { getEffectiveGlossaryTerms } from "@/lib/translation/glossary";
import {
  findGlossaryMatches,
  type GlossaryMatch,
} from "@/lib/translation/glossary-highlighting";
import type { GlossaryTerm } from "@/lib/translation/types";
import type { BookRecord, TranslationReviewStatus } from "@/lib/books/types";
import { cn } from "@/lib/utils";
import { useTranslationPreferencesStore } from "@/stores/translation-preferences-store";

type SearchResult = {
  matchesSource: boolean;
  matchesTranslation: boolean;
  paragraphIndex: number;
  sourceSnippet: string;
  translatedSnippet: string;
};

type ParagraphGlossaryMatch = {
  matchedTerms: GlossaryTerm[];
  sourceMatches: GlossaryMatch[];
  targetMatches: GlossaryMatch[];
};

type SearchNavigationDirection = "next" | "previous";
type ReaderParagraphFilter =
  | "all"
  | "bookmarked"
  | "failed"
  | "needs-review"
  | "needs-revision"
  | "reviewed"
  | "unreviewed-translated"
  | "search-results";

const READER_PARAGRAPH_FILTER_OPTIONS: Array<{
  label: string;
  value: ReaderParagraphFilter;
}> = [
  {
    value: "all",
    label: "全部段落",
  },
  {
    value: "needs-review",
    label: "待补译",
  },
  {
    value: "unreviewed-translated",
    label: "待复查译文",
  },
  {
    value: "needs-revision",
    label: "待修订",
  },
  {
    value: "reviewed",
    label: "已复核",
  },
  {
    value: "failed",
    label: "失败段落",
  },
  {
    value: "bookmarked",
    label: "已收藏",
  },
  {
    value: "search-results",
    label: "搜索命中",
  },
];

function formatRelativeDate(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function normalizeSearchQuery(query: string) {
  return query.trim().toLocaleLowerCase();
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

function buildMatchSnippet(text: string | null | undefined, normalizedQuery: string) {
  if (!text || !normalizedQuery) {
    return "";
  }

  const normalizedText = text.toLocaleLowerCase();
  const matchIndex = normalizedText.indexOf(normalizedQuery);

  if (matchIndex < 0) {
    return "";
  }

  const contextRadius = 42;
  const start = Math.max(matchIndex - contextRadius, 0);
  const end = Math.min(
    matchIndex + normalizedQuery.length + contextRadius,
    text.length,
  );
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function matchesReaderParagraphFilter({
  filter,
  isSearchHit,
  isBookmarked,
  reviewStatus,
  translationStatus,
}: {
  filter: ReaderParagraphFilter;
  isSearchHit: boolean;
  isBookmarked: boolean;
  reviewStatus: BookRecord["paragraphs"][number]["reviewStatus"];
  translationStatus: BookRecord["paragraphs"][number]["translationStatus"];
}) {
  switch (filter) {
    case "search-results":
      return isSearchHit;
    case "bookmarked":
      return isBookmarked;
    case "failed":
      return translationStatus === "error";
    case "needs-review":
      return translationStatus !== "done";
    case "unreviewed-translated":
      return translationStatus === "done" && reviewStatus === "unreviewed";
    case "needs-revision":
      return translationStatus === "done" && reviewStatus === "needs-revision";
    case "reviewed":
      return translationStatus === "done" && reviewStatus === "reviewed";
    default:
      return true;
  }
}

function getReviewStatusNoticeLabel(status: TranslationReviewStatus) {
  switch (status) {
    case "reviewed":
      return "已复核";
    case "needs-revision":
      return "待修订";
    default:
      return "待复查";
  }
}

function findSearchResultIndex(
  searchResults: SearchResult[],
  activeParagraphIndex: number,
) {
  return searchResults.findIndex(
    (result) => result.paragraphIndex === activeParagraphIndex,
  );
}

function resolveSearchNavigationIndex(
  searchResults: SearchResult[],
  activeParagraphIndex: number,
  direction: SearchNavigationDirection,
) {
  if (searchResults.length === 0) {
    return -1;
  }

  const activeResultIndex = findSearchResultIndex(
    searchResults,
    activeParagraphIndex,
  );

  if (activeResultIndex >= 0) {
    return direction === "next"
      ? (activeResultIndex + 1) % searchResults.length
      : (activeResultIndex - 1 + searchResults.length) % searchResults.length;
  }

  if (direction === "next") {
    const nextIndex = searchResults.findIndex(
      (result) => result.paragraphIndex > activeParagraphIndex,
    );

    return nextIndex >= 0 ? nextIndex : 0;
  }

  for (let index = searchResults.length - 1; index >= 0; index -= 1) {
    if (searchResults[index]!.paragraphIndex < activeParagraphIndex) {
      return index;
    }
  }

  return searchResults.length - 1;
}

function buildReaderHref(
  bookId: string,
  options?: {
    paragraph?: number | null;
    query?: string | null;
  },
) {
  const params = new URLSearchParams();

  params.set("book", bookId);

  if (options?.paragraph && options.paragraph > 0) {
    params.set("p", String(Math.floor(options.paragraph)));
  }

  const normalizedQuery = options?.query?.trim() ?? "";

  if (normalizedQuery) {
    params.set("q", normalizedQuery);
  }

  return `/reader?${params.toString()}`;
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

function renderTextWithGlossaryHighlights(
  text: string,
  matches: GlossaryMatch[],
  keyPrefix: string,
) {
  if (matches.length === 0) {
    return text;
  }

  const fragments: ReactNode[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    if (cursor < match.start) {
      fragments.push(text.slice(cursor, match.start));
    }

    fragments.push(
      <mark
        key={`${keyPrefix}-${match.term.id}-${match.start}-${index}`}
        className={cn(
          "rounded px-1 py-0.5 font-medium",
          match.variant === "source"
            ? "bg-amber-100 text-amber-950"
            : "bg-emerald-100 text-emerald-900",
        )}
        title={
          match.term.note
            ? `${match.term.source} => ${match.term.target} (${match.term.note})`
            : `${match.term.source} => ${match.term.target}`
        }
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    cursor = match.end;
  });

  if (cursor < text.length) {
    fragments.push(text.slice(cursor));
  }

  return fragments;
}

export function ReaderWorkspace() {
  const { glossaryTerms, isHydrated: preferencesHydrated } =
    useTranslationPreferencesStore(
      useShallow((state) => ({
        glossaryTerms: state.glossaryTerms,
        isHydrated: state.isHydrated,
      })),
    );
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedBookIdFromUrl = searchParams.get("book") ?? "";
  const paragraphIndexFromUrl = parseParagraphIndexParam(searchParams.get("p"));
  const searchQueryFromUrl = searchParams.get("q") ?? "";

  const [books, setBooks] = useState<BookRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeParagraphIndex, setActiveParagraphIndex] = useState(0);
  const [bookmarkNoteInput, setBookmarkNoteInput] = useState("");
  const [isGlossaryHighlightEnabled, setIsGlossaryHighlightEnabled] = useState(true);
  const [jumpParagraphInput, setJumpParagraphInput] = useState("");
  const [paragraphFilter, setParagraphFilter] =
    useState<ReaderParagraphFilter>("all");
  const [searchInput, setSearchInput] = useState(searchQueryFromUrl);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const paragraphRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastSelectedBookIdRef = useRef<string | null>(null);
  const appliedReaderLocationRef = useRef<string | null>(null);
  const pendingParagraphNavigationRef = useRef<{
    behavior: ScrollBehavior;
    index: number;
    syncUrl: boolean;
  } | null>(null);
  const readingNotesImportInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookIdFromUrl) ?? books[0] ?? null,
    [books, selectedBookIdFromUrl],
  );

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
  const activeSectionIndex = useMemo(
    () =>
      selectedBook
        ? getSectionIndexForParagraph(selectedBook.sections, activeParagraphIndex)
        : 0,
    [activeParagraphIndex, selectedBook],
  );
  const activeSection = selectedBook?.sections[activeSectionIndex] ?? null;
  const bookmarksByParagraphIndex = useMemo(
    () =>
      new Map(
        (selectedBook?.bookmarks ?? []).map((bookmark) => [
          bookmark.paragraphIndex,
          bookmark,
        ]),
      ),
    [selectedBook],
  );
  const currentBookmark = bookmarksByParagraphIndex.get(activeParagraphIndex) ?? null;
  const bookmarkedCount = selectedBook?.bookmarks.length ?? 0;
  const baseParagraphFilterCounts = useMemo(
    () => ({
      all: selectedBook?.paragraphs.length ?? 0,
      bookmarked: selectedBook?.bookmarks.length ?? 0,
      failed:
        selectedBook?.paragraphs.filter(
          (paragraph) => paragraph.translationStatus === "error",
        ).length ?? 0,
      "needs-review":
        selectedBook?.paragraphs.filter(
          (paragraph) => paragraph.translationStatus !== "done",
        ).length ?? 0,
      "needs-revision":
        selectedBook?.paragraphs.filter(
          (paragraph) =>
            paragraph.translationStatus === "done" &&
            paragraph.reviewStatus === "needs-revision",
        ).length ?? 0,
      reviewed:
        selectedBook?.paragraphs.filter(
          (paragraph) =>
            paragraph.translationStatus === "done" &&
            paragraph.reviewStatus === "reviewed",
        ).length ?? 0,
      "unreviewed-translated":
        selectedBook?.paragraphs.filter(
          (paragraph) =>
            paragraph.translationStatus === "done" &&
            paragraph.reviewStatus === "unreviewed",
        ).length ?? 0,
    }),
    [selectedBook],
  );
  const bookmarksWithNotesCount = useMemo(
    () =>
      (selectedBook?.bookmarks ?? []).filter((bookmark) => Boolean(bookmark.note.trim()))
        .length,
    [selectedBook],
  );
  const bookmarksBySection = useMemo(() => {
    if (!selectedBook || selectedBook.bookmarks.length === 0) {
      return [] as Array<{
        bookmarks: BookRecord["bookmarks"];
        sectionIndex: number;
        sectionRange: ReturnType<typeof getSectionParagraphRange>;
        sectionTitle: string;
      }>;
    }

    const groupedBookmarks = new Map<
      number,
      {
        bookmarks: BookRecord["bookmarks"];
        sectionIndex: number;
        sectionRange: ReturnType<typeof getSectionParagraphRange>;
        sectionTitle: string;
      }
    >();

    [...selectedBook.bookmarks]
      .sort((left, right) => left.paragraphIndex - right.paragraphIndex)
      .forEach((bookmark) => {
        const sectionIndex = getSectionIndexForParagraph(
          selectedBook.sections,
          bookmark.paragraphIndex,
        );
        const section = selectedBook.sections[sectionIndex] ?? null;
        const existingGroup = groupedBookmarks.get(sectionIndex);

        if (existingGroup) {
          existingGroup.bookmarks.push(bookmark);
          return;
        }

        groupedBookmarks.set(sectionIndex, {
          bookmarks: [bookmark],
          sectionIndex,
          sectionRange: getSectionParagraphRange(
            selectedBook.sections,
            sectionIndex,
            selectedBook.paragraphs.length,
          ),
          sectionTitle: section?.title ?? "全文",
        });
      });

    return [...groupedBookmarks.values()].sort(
      (left, right) => left.sectionIndex - right.sectionIndex,
    );
  }, [selectedBook]);
  const activeGlossaryTerms = useMemo(
    () => getEffectiveGlossaryTerms(glossaryTerms),
    [glossaryTerms],
  );
  const paragraphGlossaryMatches = useMemo(() => {
    const nextMatches = new Map<number, ParagraphGlossaryMatch>();

    if (!selectedBook || activeGlossaryTerms.length === 0) {
      return nextMatches;
    }

    selectedBook.paragraphs.forEach((paragraph) => {
      const sourceMatches = findGlossaryMatches(
        paragraph.sourceText,
        activeGlossaryTerms,
        "source",
      );
      const targetMatches = findGlossaryMatches(
        paragraph.translatedText,
        activeGlossaryTerms,
        "target",
      );

      if (sourceMatches.length === 0 && targetMatches.length === 0) {
        return;
      }

      const matchedTerms = [...sourceMatches, ...targetMatches].reduce<GlossaryTerm[]>(
        (terms, match) => {
          if (terms.some((term) => term.id === match.term.id)) {
            return terms;
          }

          terms.push(match.term);
          return terms;
        },
        [],
      );

      nextMatches.set(paragraph.index, {
        matchedTerms,
        sourceMatches,
        targetMatches,
      });
    });

    return nextMatches;
  }, [activeGlossaryTerms, selectedBook]);
  const glossaryMatchedTerms = useMemo(
    () =>
      [...paragraphGlossaryMatches.values()].flatMap((paragraphMatch) => paragraphMatch.matchedTerms).reduce<GlossaryTerm[]>(
        (terms, term) => {
          if (terms.some((currentTerm) => currentTerm.id === term.id)) {
            return terms;
          }

          terms.push(term);
          return terms;
        },
        [],
      ),
    [paragraphGlossaryMatches],
  );
  const currentParagraphGlossaryMatch =
    paragraphGlossaryMatches.get(activeParagraphIndex) ?? null;
  const normalizedSearchQuery = useMemo(
    () => normalizeSearchQuery(searchInput),
    [searchInput],
  );
  const searchResults = useMemo(() => {
    if (!selectedBook || !normalizedSearchQuery) {
      return [] as SearchResult[];
    }

    return selectedBook.paragraphs.flatMap((paragraph) => {
      const sourceSnippet = buildMatchSnippet(
        paragraph.sourceText,
        normalizedSearchQuery,
      );
      const translatedSnippet = buildMatchSnippet(
        paragraph.translatedText,
        normalizedSearchQuery,
      );

      if (!sourceSnippet && !translatedSnippet) {
        return [];
      }

      return [
        {
          matchesSource: Boolean(sourceSnippet),
          matchesTranslation: Boolean(translatedSnippet),
          paragraphIndex: paragraph.index,
          sourceSnippet,
          translatedSnippet,
        },
      ];
    });
  }, [normalizedSearchQuery, selectedBook]);
  const searchHitParagraphIndexes = useMemo(
    () => new Set(searchResults.map((result) => result.paragraphIndex)),
    [searchResults],
  );
  const paragraphFilterCounts = useMemo(
    () => ({
      ...baseParagraphFilterCounts,
      "search-results": searchResults.length,
    }),
    [baseParagraphFilterCounts, searchResults.length],
  );
  const filteredParagraphs = useMemo(() => {
    if (!selectedBook) {
      return [] as BookRecord["paragraphs"];
    }

    return selectedBook.paragraphs.filter((paragraph) =>
      matchesReaderParagraphFilter({
        filter: paragraphFilter,
        isSearchHit: searchHitParagraphIndexes.has(paragraph.index),
        isBookmarked: bookmarksByParagraphIndex.has(paragraph.index),
        reviewStatus: paragraph.reviewStatus,
        translationStatus: paragraph.translationStatus,
      }),
    );
  }, [
    bookmarksByParagraphIndex,
    paragraphFilter,
    searchHitParagraphIndexes,
    selectedBook,
  ]);
  const filteredParagraphIndexSet = useMemo(
    () => new Set(filteredParagraphs.map((paragraph) => paragraph.index)),
    [filteredParagraphs],
  );
  const selectedParagraphFilterOption = useMemo(
    () =>
      READER_PARAGRAPH_FILTER_OPTIONS.find(
        (option) => option.value === paragraphFilter,
      ) ?? READER_PARAGRAPH_FILTER_OPTIONS[0],
    [paragraphFilter],
  );
  const visibleParagraphFilterOptions = useMemo(
    () =>
      READER_PARAGRAPH_FILTER_OPTIONS.filter(
        (option) =>
          option.value !== "search-results" || Boolean(normalizedSearchQuery),
      ),
    [normalizedSearchQuery],
  );
  const activeSearchResultIndex = useMemo(
    () => findSearchResultIndex(searchResults, activeParagraphIndex),
    [activeParagraphIndex, searchResults],
  );
  const handleDeepLinkScroll = useEffectEvent((index: number) => {
    scrollToParagraph(index, "auto");
  });
  const handleEnsureFilteredParagraphVisible = useEffectEvent((index: number) => {
    scrollToParagraph(index, "auto");
  });
  const completePendingParagraphNavigation = useEffectEvent(
    (pendingNavigation: {
      behavior: ScrollBehavior;
      index: number;
      syncUrl: boolean;
    }) => {
      goToParagraph(pendingNavigation.index, {
        behavior: pendingNavigation.behavior,
        revealHiddenParagraph: false,
        syncUrl: pendingNavigation.syncUrl,
      });
    },
  );
  const handleReaderKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!selectedBook) {
      return;
    }

    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isEditableKeyboardTarget(event.target)
    ) {
      return;
    }

    const normalizedKey = event.key.toLowerCase();

    if (normalizedKey === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      goToParagraph(activeParagraphIndex + 1);
      return;
    }

    if (normalizedKey === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      goToParagraph(activeParagraphIndex - 1);
      return;
    }

    if (normalizedKey === "n" && searchResults.length > 0) {
      event.preventDefault();
      handleJumpBetweenSearchResults(event.shiftKey ? "previous" : "next");
      return;
    }

    if (event.key === "/") {
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  });

  useEffect(() => {
    void refreshBooks();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      handleReaderKeyDown(event);
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!selectedBook) {
      return;
    }

    const pendingNavigation = pendingParagraphNavigationRef.current;

    if (!pendingNavigation || !filteredParagraphIndexSet.has(pendingNavigation.index)) {
      return;
    }

    pendingParagraphNavigationRef.current = null;

    window.requestAnimationFrame(() => {
      completePendingParagraphNavigation(pendingNavigation);
    });
  }, [filteredParagraphIndexSet, selectedBook]);

  useEffect(() => {
    if (!selectedBook || filteredParagraphs.length === 0) {
      return;
    }

    if (pendingParagraphNavigationRef.current) {
      return;
    }

    if (filteredParagraphIndexSet.has(activeParagraphIndex)) {
      return;
    }

    window.requestAnimationFrame(() => {
      handleEnsureFilteredParagraphVisible(filteredParagraphs[0]!.index);
    });
  }, [
    activeParagraphIndex,
    filteredParagraphIndexSet,
    filteredParagraphs,
    selectedBook,
  ]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
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
    setSearchInput(searchQueryFromUrl);
  }, [searchQueryFromUrl]);

  useEffect(() => {
    if (paragraphFilter === "search-results" && !normalizedSearchQuery) {
      setParagraphFilter("all");
    }
  }, [normalizedSearchQuery, paragraphFilter]);

  useEffect(() => {
    setBookmarkNoteInput(currentBookmark?.note ?? "");
  }, [activeParagraphIndex, currentBookmark?.id, currentBookmark?.note]);

  useEffect(() => {
    if (!books.length) {
      return;
    }

    const hasSelectedBook = books.some((book) => book.id === selectedBookIdFromUrl);

    if (!hasSelectedBook) {
      router.replace(
        buildReaderHref(books[0].id, {
          paragraph:
            paragraphIndexFromUrl !== null ? paragraphIndexFromUrl + 1 : null,
          query: searchQueryFromUrl || null,
        }),
        {
          scroll: false,
        },
      );
    }
  }, [books, paragraphIndexFromUrl, router, searchQueryFromUrl, selectedBookIdFromUrl]);

  useEffect(() => {
    if (!selectedBook) {
      return;
    }

    const isBookChanged = lastSelectedBookIdRef.current !== selectedBook.id;

    lastSelectedBookIdRef.current = selectedBook.id;

    const targetParagraphIndex =
      paragraphIndexFromUrl ??
      (isBookChanged ? selectedBook.readingProgress.lastReadParagraphIndex : null);

    if (targetParagraphIndex === null) {
      return;
    }

    const deepLinkKey = `${selectedBook.id}:${targetParagraphIndex}`;

    if (appliedReaderLocationRef.current === deepLinkKey) {
      return;
    }

    appliedReaderLocationRef.current = deepLinkKey;
    setJumpParagraphInput(String(targetParagraphIndex + 1));

    window.requestAnimationFrame(() => {
      handleDeepLinkScroll(targetParagraphIndex);
    });
  }, [paragraphIndexFromUrl, selectedBook]);

  useEffect(() => {
    if (!selectedBook) {
      return;
    }

    if (activeParagraphIndex === selectedBook.readingProgress.lastReadParagraphIndex) {
      return;
    }

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      const nextBook = updateBookReadingProgress(selectedBook, activeParagraphIndex);

      setBooks((current) =>
        current.map((book) => (book.id === nextBook.id ? nextBook : book)),
      );

      void saveBook(nextBook).catch(() => {
        setError("保存阅读进度失败，但不会影响当前阅读。");
      });
    }, 220);

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [activeParagraphIndex, selectedBook]);

  function replaceReaderLocation(options?: {
    bookId?: string;
    paragraph?: number | null;
    query?: string | null;
  }) {
    const bookId = options?.bookId ?? selectedBook?.id;

    if (!bookId) {
      return;
    }

    router.replace(
      buildReaderHref(bookId, {
        paragraph:
          options?.paragraph === undefined
            ? paragraphIndexFromUrl !== null
              ? paragraphIndexFromUrl + 1
              : null
            : options.paragraph,
        query:
          options?.query === undefined ? searchQueryFromUrl || null : options.query,
      }),
      {
        scroll: false,
      },
    );
  }

  function updateBookSelection(bookId: string) {
    if (bookId === selectedBookIdFromUrl) {
      return;
    }

    replaceReaderLocation({
      bookId,
      paragraph: null,
      query: searchInput.trim() || null,
    });
    setScrollProgress(0);
    setError("");
  }

  async function refreshBooks() {
    setIsLoading(true);

    try {
      const nextBooks = await listBooks();
      setBooks(nextBooks);
      setError("");
    } catch {
      setError("读取本地书库失败，请检查浏览器是否支持 IndexedDB。");
    } finally {
      setIsLoading(false);
    }
  }

  async function persistReaderBook(
    nextBook: BookRecord,
    successMessage: string,
    failureMessage: string,
  ) {
    setBooks((current) =>
      current.map((book) => (book.id === nextBook.id ? nextBook : book)),
    );

    try {
      await saveBook(nextBook);
      setError("");
      setNotice(successMessage);
    } catch {
      setError(failureMessage);
    }
  }

  function updateScrollProgress(element: HTMLDivElement) {
    const maxScrollTop = element.scrollHeight - element.clientHeight;

    if (maxScrollTop <= 0) {
      setScrollProgress(0);
      return;
    }

    setScrollProgress(Math.round((element.scrollTop / maxScrollTop) * 100));
  }

  function scrollToParagraph(index: number, behavior: ScrollBehavior = "smooth") {
    if (!selectedBook) {
      return null;
    }

    if (filteredParagraphs.length === 0) {
      return null;
    }

    const maxIndex = Math.max(selectedBook.paragraphs.length - 1, 0);
    const targetParagraphIndex = Math.min(Math.max(index, 0), maxIndex);
    const targetParagraph =
      filteredParagraphs.find((paragraph) => paragraph.index === targetParagraphIndex) ??
      filteredParagraphs.find((paragraph) => paragraph.index > targetParagraphIndex) ??
      filteredParagraphs[filteredParagraphs.length - 1];

    if (!targetParagraph) {
      return null;
    }

    const nextParagraphIndex = targetParagraph.index;
    const container = scrollContainerRef.current;
    const targetParagraphElement = paragraphRefs.current[targetParagraph.id];

    setActiveParagraphIndex(nextParagraphIndex);
    setJumpParagraphInput(String(nextParagraphIndex + 1));

    if (container && targetParagraphElement) {
      targetParagraphElement.scrollIntoView({
        behavior,
        block: "start",
      });
      updateScrollProgress(container);
      return nextParagraphIndex;
    }

    if (container) {
      container.scrollTo({
        top: 0,
        behavior,
      });
      updateScrollProgress(container);
    }

    return nextParagraphIndex;
  }

  function goToParagraph(
    index: number,
    options?: {
      behavior?: ScrollBehavior;
      hiddenParagraphNotice?: string | null;
      revealHiddenParagraph?: boolean;
      syncUrl?: boolean;
    },
  ) {
    if (!selectedBook) {
      return;
    }

    const maxIndex = Math.max(selectedBook.paragraphs.length - 1, 0);
    const nextParagraphIndex = Math.min(Math.max(index, 0), maxIndex);

    if (
      options?.revealHiddenParagraph &&
      paragraphFilter !== "all" &&
      !filteredParagraphIndexSet.has(nextParagraphIndex)
    ) {
      pendingParagraphNavigationRef.current = {
        behavior: options?.behavior ?? "smooth",
        index: nextParagraphIndex,
        syncUrl: options?.syncUrl !== false,
      };
      setParagraphFilter("all");
      setError("");

      if (options?.hiddenParagraphNotice !== null) {
        setNotice(
          options?.hiddenParagraphNotice ??
            "当前过滤隐藏了目标段落，已切回全部段落。",
        );
      }

      return;
    }

    const visibleParagraphIndex = scrollToParagraph(
      nextParagraphIndex,
      options?.behavior ?? "smooth",
    );

    if (visibleParagraphIndex === null) {
      return;
    }

    appliedReaderLocationRef.current = `${selectedBook.id}:${visibleParagraphIndex}`;

    if (options?.syncUrl !== false) {
      replaceReaderLocation({
        paragraph: visibleParagraphIndex + 1,
        query: searchInput.trim() || null,
      });
    }

    setError("");
  }

  function getCurrentParagraphIndex() {
    if (!selectedBook || !scrollContainerRef.current) {
      return 0;
    }

    const container = scrollContainerRef.current;
    const threshold = container.scrollTop + container.clientHeight * 0.28;

    let currentIndex = 0;

    for (const paragraph of filteredParagraphs) {
      const element = paragraphRefs.current[paragraph.id];

      if (!element) {
        continue;
      }

      if (element.offsetTop <= threshold) {
        currentIndex = paragraph.index;
      } else {
        break;
      }
    }

    return currentIndex;
  }

  function handleReaderScroll(event: UIEvent<HTMLDivElement>) {
    updateScrollProgress(event.currentTarget);
    setActiveParagraphIndex(getCurrentParagraphIndex());
  }

  function handleJumpToParagraph(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedBook) {
      return;
    }

    const paragraphNumber = Number.parseInt(jumpParagraphInput.trim(), 10);

    if (!Number.isFinite(paragraphNumber)) {
      setError("请输入有效的段落编号。");
      return;
    }

    goToParagraph(paragraphNumber - 1, {
      hiddenParagraphNotice: "当前过滤隐藏了该段，已切回全部段落。",
      revealHiddenParagraph: true,
    });
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuery = searchInput.trim();

    replaceReaderLocation({
      paragraph: null,
      query: trimmedQuery || null,
    });
    setError("");

    if (!trimmedQuery) {
      setNotice("已清除地址栏中的搜索词。");
      return;
    }

    setNotice(
      searchResults.length > 0
        ? `已更新搜索链接，当前命中 ${searchResults.length} 段。`
        : "已更新搜索链接，但当前没有匹配结果。",
    );
  }

  function handleClearSearch() {
    setSearchInput("");
    replaceReaderLocation({
      paragraph: null,
      query: null,
    });
    setError("");
    setNotice("已清除当前搜索。");
  }

  function handleJumpBetweenSearchResults(direction: SearchNavigationDirection) {
    if (searchResults.length === 0) {
      return;
    }

    const targetResultIndex = resolveSearchNavigationIndex(
      searchResults,
      activeParagraphIndex,
      direction,
    );
    const targetResult = searchResults[targetResultIndex];

    if (!targetResult) {
      return;
    }

    goToParagraph(targetResult.paragraphIndex, {
      hiddenParagraphNotice: "当前过滤隐藏了该搜索命中，已切回全部段落。",
      revealHiddenParagraph: true,
    });
    setNotice(
      `已跳到第 ${targetResult.paragraphIndex + 1} 段（搜索命中 ${targetResultIndex + 1}/${searchResults.length}）。`,
    );
  }

  async function handleCopyCurrentLink() {
    if (!selectedBook) {
      return;
    }

    try {
      const shareUrl = new URL(window.location.href);
      const normalizedQuery = searchInput.trim();

      shareUrl.search = "";
      shareUrl.hash = "";
      shareUrl.searchParams.set("book", selectedBook.id);
      shareUrl.searchParams.set("p", String(activeParagraphIndex + 1));

      if (normalizedQuery) {
        shareUrl.searchParams.set("q", normalizedQuery);
      }

      await navigator.clipboard.writeText(shareUrl.toString());
      setError("");
      setNotice(`已复制第 ${activeParagraphIndex + 1} 段的阅读链接。`);
    } catch {
      setError("复制链接失败，请手动复制地址栏。");
    }
  }

  async function handleToggleBookmark(paragraphIndex: number) {
    if (!selectedBook) {
      return;
    }

    const hasExistingBookmark = bookmarksByParagraphIndex.has(paragraphIndex);
    const nextBook = toggleBookBookmark(selectedBook, paragraphIndex);

    await persistReaderBook(
      nextBook,
      hasExistingBookmark
        ? `已移除第 ${paragraphIndex + 1} 段书签。`
        : `已收藏第 ${paragraphIndex + 1} 段。`,
      "保存书签失败，请稍后重试。",
    );
  }

  async function handleSaveBookmarkNote() {
    if (!selectedBook) {
      return;
    }

    const nextBook = updateBookBookmarkNote(
      selectedBook,
      activeParagraphIndex,
      bookmarkNoteInput,
    );

    await persistReaderBook(
      nextBook,
      bookmarkNoteInput.trim()
        ? `已保存第 ${activeParagraphIndex + 1} 段批注。`
        : `已保存第 ${activeParagraphIndex + 1} 段书签。`,
      "保存批注失败，请稍后重试。",
    );
  }

  async function handleUpdateParagraphReviewStatus(
    paragraphIndex: number,
    reviewStatus: TranslationReviewStatus,
  ) {
    if (!selectedBook) {
      return;
    }

    const nextBook = updateBookParagraphReviewStatus(
      selectedBook,
      paragraphIndex,
      reviewStatus,
    );

    await persistReaderBook(
      nextBook,
      `已将第 ${paragraphIndex + 1} 段标记为${getReviewStatusNoticeLabel(reviewStatus)}。`,
      "保存复查标记失败，请稍后重试。",
    );
  }

  function handleExportReadingNotes() {
    if (!selectedBook) {
      return;
    }

    const payload = buildReadingNotesExport(selectedBook);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = `${selectedBook.title
      .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
      .slice(0, 48)}-notes.json`;
    anchor.click();

    URL.revokeObjectURL(objectUrl);
    setError("");
    setNotice(`已导出《${selectedBook.title}》的 ${selectedBook.bookmarks.length} 条阅读笔记。`);
  }

  async function handleImportReadingNotes(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file || !selectedBook) {
      return;
    }

    try {
      const importedNotes = parseReadingNotesImport(await file.text());
      const importedBook = importedNotes.book;
      const looksLikeDifferentBook =
        importedBook &&
        ((importedBook.id && importedBook.id !== selectedBook.id) ||
          (importedBook.originalFileName &&
            importedBook.originalFileName !== selectedBook.originalFileName));

      if (
        looksLikeDifferentBook &&
        !window.confirm(
          `导入文件看起来来自《${importedBook.title || importedBook.originalFileName || "另一本文档"}》。继续导入会按段落编号合并到当前这本书，是否继续？`,
        )
      ) {
        return;
      }

      const nextBook = mergeBookBookmarks(selectedBook, importedNotes.bookmarks);

      await persistReaderBook(
        nextBook,
        `已导入 ${importedNotes.bookmarks.length} 条阅读笔记，并按段落合并到当前书。`,
        "导入阅读笔记失败，请稍后重试。",
      );
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "导入阅读笔记失败。");
    } finally {
      event.target.value = "";
    }
  }

  function setParagraphRef(paragraphId: string, element: HTMLElement | null) {
    paragraphRefs.current[paragraphId] = element;
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[0.34fr_0.66fr]">
      <section className="rounded-[34px] border border-[color:var(--line)] bg-[color:var(--panel-strong)]/90 p-7 shadow-[var(--shadow)] backdrop-blur-xl">
        <div className="border-b border-[color:var(--line)] pb-6">
          <p className="text-sm uppercase tracking-[0.3em] text-[color:var(--muted)]">
            Library
          </p>
          <h2 className="mt-3 font-serif text-4xl">选择一本书</h2>
          <p className="mt-3 text-sm leading-7 text-[color:var(--muted)]">
            阅读器直接读取浏览器本地书库。段落、译文和翻译状态都来自同一份 IndexedDB 数据。
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3 xl:grid-cols-1">
          <ReaderMetric label="本地书籍" value={String(books.length)} hint="IndexedDB" />
          <ReaderMetric
            label="当前译文"
            value={String(translationStats.translatedCount)}
            hint="selected book"
          />
          <ReaderMetric
            label="阅读进度"
            value={`${scrollProgress}%`}
            hint="scroll"
          />
        </div>

        <div className="mt-6 min-h-10 text-sm leading-6">
          {error ? <p className="text-red-600">{error}</p> : null}
          {!error && notice ? (
            <p className="font-semibold text-[color:var(--accent-strong)]">{notice}</p>
          ) : null}
          {!error && !notice ? (
            <p className="text-[color:var(--muted)]">
              阅读位置会自动保存在当前浏览器。重新进入同一本书时，会回到上次读到的段落。
            </p>
          ) : null}
        </div>

        <div className="mt-6 border-t border-[color:var(--line)] pt-6">
          <div className="mb-4 flex items-center gap-2">
            <LibraryBig className="h-5 w-5 text-[color:var(--accent-strong)]" />
            <p className="text-base font-semibold">书籍列表</p>
          </div>

          {isLoading ? (
            <div className="rounded-[24px] border border-[color:var(--line)] bg-white/70 p-5 text-sm text-[color:var(--muted)]">
              正在读取本地书库...
            </div>
          ) : books.length === 0 ? (
            <div className="rounded-[24px] border border-[color:var(--line)] bg-white/70 p-5 text-sm leading-6 text-[color:var(--muted)]">
              还没有可阅读的书籍。先回到书库页导入 `.txt` 并生成译文。
            </div>
          ) : (
            <div className="space-y-3">
              {books.map((book) => {
                const isSelected = selectedBook?.id === book.id;
                const bookTranslationStats = getBookTranslationStats(book);

                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => updateBookSelection(book.id)}
                    className={cn(
                      "block w-full rounded-[24px] border p-4 text-left transition",
                      isSelected
                        ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
                        : "border-[color:var(--line)] bg-white/75 hover:bg-white",
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold">{book.title}</p>
                        <p className="mt-1 text-sm text-[color:var(--muted)]">
                          {bookTranslationStats.translatedCount}/
                          {bookTranslationStats.totalCount} 段已翻译
                        </p>
                        <p className="mt-1 text-xs text-[color:var(--muted)]">
                          {book.bookmarks.length} 个书签
                        </p>
                        <p className="mt-1 text-xs text-[color:var(--muted)]">
                          上次读到第 {book.readingProgress.lastReadParagraphIndex + 1} 段
                        </p>
                        <p className="mt-1 text-xs text-[color:var(--muted)]">
                          {book.readingProgress.lastReadAt
                            ? `阅读于 ${formatRelativeDate(book.readingProgress.lastReadAt)}`
                            : `更新于 ${formatRelativeDate(book.updatedAt)}`}
                        </p>
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[color:var(--muted)]" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[34px] border border-[color:var(--line)] bg-[color:var(--panel)] p-7 shadow-[var(--shadow)] backdrop-blur-xl">
        <div className="border-b border-[color:var(--line)] pb-6">
          <p className="text-sm uppercase tracking-[0.3em] text-[color:var(--muted)]">
            Reader
          </p>
          <h3 className="mt-3 font-serif text-4xl">中英对照阅读</h3>
          <p className="mt-3 text-sm leading-7 text-[color:var(--muted)]">
            这里采用单滚动容器的双栏布局，段落天然对齐，滚动时不会出现左右列漂移。
          </p>
        </div>

        {!selectedBook ? (
          <div className="mt-6 rounded-[28px] border border-[color:var(--line)] bg-white/70 p-6 text-sm leading-6 text-[color:var(--muted)]">
            当前没有可阅读的书籍。先回到书库页完成导入和翻译。
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div className="rounded-[28px] border border-[color:var(--line)] bg-white/72 p-5">
              <div className="flex flex-col gap-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]">
                    <BookOpenText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-2xl font-semibold">{selectedBook.title}</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      共 {selectedBook.stats.paragraphCount} 段 · 已翻译{" "}
                      {translationStats.translatedCount} 段 · 未完成{" "}
                      {translationStats.pendingCount + translationStats.failedCount} 段
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      当前读到第 {activeParagraphIndex + 1} 段
                      {activeSection ? ` · 当前章节「${activeSection.title}」` : ""}
                      {selectedBook.readingProgress.lastReadAt
                        ? ` · 上次记录于 ${formatRelativeDate(selectedBook.readingProgress.lastReadAt)}`
                        : ""}
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-[0.22em] text-[color:var(--muted)]">
                      {selectedBook.originalFileName}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <ReaderMetric
                    label="完成率"
                    value={`${translationStats.progressPercent}%`}
                    hint="translation"
                  />
                  <ReaderMetric
                    label="已翻译"
                    value={String(translationStats.translatedCount)}
                    hint="paragraphs"
                  />
                  <ReaderMetric
                    label="当前位置"
                    value={`${activeParagraphIndex + 1}/${selectedBook.stats.paragraphCount}`}
                    hint="paragraph"
                  />
                </div>

                <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-strong)] p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    <PanelsLeftRight className="h-4 w-4" />
                    <span>左侧英文，右侧中文，按段落逐行对齐</span>
                  </div>
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-stone-200">
                    <div
                      className="h-full rounded-full bg-[color:var(--accent)] transition-[width]"
                      style={{ width: `${scrollProgress}%` }}
                    />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
                    当前阅读滚动进度 {scrollProgress}%。刷新页面或下次回来时，阅读器会自动回到这本书上次读到的位置。
                  </p>
                </div>

                <div className="grid gap-4 xl:grid-cols-[0.58fr_0.42fr]">
                  <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-strong)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                          章节导航
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                          当前章节：{activeSection?.title ?? "全文"} · 共{" "}
                          {selectedBook.sections.length} 节
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          goToParagraph(selectedBook.readingProgress.lastReadParagraphIndex, {
                            hiddenParagraphNotice:
                              "当前过滤隐藏了上次阅读位置，已切回全部段落。",
                            revealHiddenParagraph: true,
                          })
                        }
                        className="rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50"
                      >
                        回到上次位置
                      </button>
                    </div>

                    <div className="mt-4 max-h-48 space-y-2 overflow-y-auto pr-1">
                      {selectedBook.sections.map((section, index) => {
                        const sectionRange = getSectionParagraphRange(
                          selectedBook.sections,
                          index,
                          selectedBook.paragraphs.length,
                        );

                        return (
                          <button
                            key={section.id}
                            type="button"
                            onClick={() =>
                              goToParagraph(section.startParagraphIndex, {
                                hiddenParagraphNotice:
                                  "当前过滤隐藏了该章节起点，已切回全部段落。",
                                revealHiddenParagraph: true,
                              })
                            }
                            className={cn(
                              "block w-full rounded-[20px] border px-4 py-3 text-left transition",
                              index === activeSectionIndex
                                ? "border-[color:var(--accent)] bg-white"
                                : "border-[color:var(--line)] bg-white/70 hover:bg-white",
                            )}
                          >
                            <p className="truncate text-sm font-semibold">{section.title}</p>
                            <p className="mt-1 text-xs text-[color:var(--muted)]">
                              第 {sectionRange.startParagraphIndex + 1} 段 - 第{" "}
                              {sectionRange.endParagraphIndex + 1} 段
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-strong)] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                      段落定位
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      输入段落编号后直接跳转，适合从目录、术语表或外部笔记回到指定位置。
                    </p>

                    <form onSubmit={handleJumpToParagraph} className="mt-4 space-y-3">
                      <input
                        type="number"
                        min={1}
                        max={selectedBook.paragraphs.length}
                        value={jumpParagraphInput}
                        onChange={(event) => setJumpParagraphInput(event.target.value)}
                        className="w-full rounded-2xl border border-[color:var(--line)] bg-white px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]"
                        placeholder={`1 - ${selectedBook.paragraphs.length}`}
                      />
                      <button
                        type="submit"
                        className="w-full rounded-full bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
                      >
                        跳转到该段
                      </button>
                    </form>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() =>
                          goToParagraph(0, {
                            hiddenParagraphNotice:
                              "当前过滤隐藏了开头段落，已切回全部段落。",
                            revealHiddenParagraph: true,
                          })
                        }
                        className="rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50"
                      >
                        返回开头
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          goToParagraph(selectedBook.paragraphs.length - 1, {
                            hiddenParagraphNotice:
                              "当前过滤隐藏了末尾段落，已切回全部段落。",
                            revealHiddenParagraph: true,
                          })
                        }
                        className="rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50"
                      >
                        跳到末尾
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-strong)] p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        <Bookmark className="h-4 w-4" />
                        <span>书签与批注</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                        给关键段落加书签，并记录你的理解、术语选择或待回看的问题。所有内容都保存在当前浏览器。
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={readingNotesImportInputRef}
                        type="file"
                        accept=".json,application/json"
                        className="sr-only"
                        onChange={(event) => void handleImportReadingNotes(event)}
                      />
                      <button
                        type="button"
                        onClick={() => readingNotesImportInputRef.current?.click()}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50"
                      >
                        <Upload className="h-4 w-4" />
                        导入笔记
                      </button>
                      <button
                        type="button"
                        onClick={handleExportReadingNotes}
                        disabled={selectedBook.bookmarks.length === 0}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                      >
                        <Download className="h-4 w-4" />
                        导出笔记
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleBookmark(activeParagraphIndex)}
                        className={cn(
                          "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition",
                          currentBookmark
                            ? "border border-amber-300 bg-amber-100 text-amber-950 hover:bg-amber-200"
                            : "border border-[color:var(--line)] bg-white hover:bg-stone-50",
                        )}
                      >
                        <Bookmark className="h-4 w-4" />
                        {currentBookmark ? "取消当前书签" : "收藏当前段落"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <ReaderMetric
                      label="书签数"
                      value={String(bookmarkedCount)}
                      hint="current book"
                    />
                    <ReaderMetric
                      label="有批注"
                      value={String(bookmarksWithNotesCount)}
                      hint="bookmarks"
                    />
                    <ReaderMetric
                      label="当前状态"
                      value={currentBookmark ? "已收藏" : "未收藏"}
                      hint={`paragraph ${activeParagraphIndex + 1}`}
                    />
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[0.46fr_0.54fr]">
                    <div className="rounded-[20px] border border-[color:var(--line)] bg-white/80 p-4">
                      <p className="text-sm font-semibold">当前段落批注</p>
                      <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                        当前是第 {activeParagraphIndex + 1} 段。没有书签也可以直接写批注，保存时会自动创建书签。
                      </p>
                      <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                        导入时会按段落编号合并，导入文件中的同段落笔记会覆盖当前值。
                      </p>
                      <textarea
                        rows={5}
                        value={bookmarkNoteInput}
                        onChange={(event) => setBookmarkNoteInput(event.target.value)}
                        className="mt-3 w-full rounded-2xl border border-[color:var(--line)] bg-white px-4 py-3 text-sm leading-7 outline-none transition placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]"
                        placeholder="记录你的理解、伏笔、翻译疑问，或下次回来要继续看的点。"
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSaveBookmarkNote()}
                          className="rounded-full bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
                        >
                          保存批注
                        </button>
                        <button
                          type="button"
                          onClick={() => setBookmarkNoteInput(currentBookmark?.note ?? "")}
                          className="rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50"
                        >
                          恢复已保存内容
                        </button>
                      </div>
                    </div>

                    <div className="rounded-[20px] border border-[color:var(--line)] bg-white/80 p-4">
                      <p className="text-sm font-semibold">本书书签列表</p>
                      {selectedBook.bookmarks.length === 0 ? (
                        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                          这本书还没有书签。先收藏一段，再把你的批注写下来。
                        </p>
                      ) : (
                        <div className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
                          {bookmarksBySection.map((sectionGroup) => (
                            <section
                              key={`${selectedBook.id}-${sectionGroup.sectionIndex}`}
                              className="rounded-[18px] border border-[color:var(--line)] bg-[color:var(--panel-strong)] p-3"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold">
                                    {sectionGroup.sectionTitle}
                                  </p>
                                  <p className="mt-1 text-xs text-[color:var(--muted)]">
                                    第 {sectionGroup.sectionRange.startParagraphIndex + 1} 段 - 第{" "}
                                    {sectionGroup.sectionRange.endParagraphIndex + 1} 段
                                  </p>
                                </div>
                                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-[color:var(--muted)]">
                                  {sectionGroup.bookmarks.length} 条书签
                                </span>
                              </div>

                              <div className="mt-3 space-y-2">
                                {sectionGroup.bookmarks.map((bookmark) => (
                                  <article
                                    key={bookmark.id}
                                    className={cn(
                                      "rounded-[16px] border px-4 py-3",
                                      bookmark.paragraphIndex === activeParagraphIndex
                                        ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
                                        : "border-[color:var(--line)] bg-white",
                                    )}
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-sm font-semibold">
                                          Paragraph {bookmark.paragraphIndex + 1}
                                        </p>
                                        <p className="mt-1 text-xs text-[color:var(--muted)]">
                                          更新于 {formatRelativeDate(bookmark.updatedAt)}
                                        </p>
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            goToParagraph(bookmark.paragraphIndex, {
                                              hiddenParagraphNotice:
                                                "当前过滤隐藏了该书签段落，已切回全部段落。",
                                              revealHiddenParagraph: true,
                                            })
                                          }
                                          className="rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50"
                                        >
                                          跳转
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void handleToggleBookmark(bookmark.paragraphIndex)
                                          }
                                          className="rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:text-red-600"
                                        >
                                          删除
                                        </button>
                                      </div>
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                                      {bookmark.note || "还没有批注。"}
                                    </p>
                                  </article>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-strong)] p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        <BookOpenText className="h-4 w-4" />
                        <span>术语高亮</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                        阅读器会直接读取你在翻译偏好里保存的术语表，把原文术语和对应译文在双栏中高亮出来。
                      </p>
                    </div>

                    <label className="inline-flex items-center gap-3 rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold">
                      <input
                        type="checkbox"
                        checked={isGlossaryHighlightEnabled}
                        onChange={(event) =>
                          setIsGlossaryHighlightEnabled(event.target.checked)
                        }
                        className="h-4 w-4 accent-[color:var(--accent)]"
                      />
                      显示术语高亮
                    </label>
                  </div>

                  {!preferencesHydrated ? (
                    <p className="mt-4 text-sm leading-6 text-[color:var(--muted)]">
                      正在读取本地术语表...
                    </p>
                  ) : activeGlossaryTerms.length === 0 ? (
                    <div className="mt-4 rounded-[20px] border border-dashed border-[color:var(--line)] bg-white/70 px-4 py-5 text-sm leading-6 text-[color:var(--muted)]">
                      当前还没有配置术语。回到书库页补充 glossary terms 后，这里会自动出现高亮。
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-3 md:grid-cols-3">
                        <ReaderMetric
                          label="有效术语"
                          value={String(activeGlossaryTerms.length)}
                          hint="glossary"
                        />
                        <ReaderMetric
                          label="命中段落"
                          value={String(paragraphGlossaryMatches.size)}
                          hint="this book"
                        />
                        <ReaderMetric
                          label="命中术语"
                          value={String(glossaryMatchedTerms.length)}
                          hint="deduped"
                        />
                      </div>

                      <div className="rounded-[20px] border border-[color:var(--line)] bg-white/80 p-4">
                        <p className="text-sm font-semibold">当前段落命中</p>
                        {currentParagraphGlossaryMatch?.matchedTerms.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {currentParagraphGlossaryMatch.matchedTerms.map((term) => (
                              <span
                                key={term.id}
                                className="rounded-full border border-[color:var(--line)] bg-[color:var(--accent-soft)] px-3 py-2 text-xs font-semibold text-[color:var(--foreground)]"
                                title={term.note || undefined}
                              >
                                {term.source}
                                {" => "}
                                {term.target}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                            当前段落没有命中已配置术语。
                          </p>
                        )}
                      </div>

                      {glossaryMatchedTerms.length > 0 ? (
                        <div className="rounded-[20px] border border-[color:var(--line)] bg-white/80 p-4">
                          <p className="text-sm font-semibold">本书命中的术语</p>
                          <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-y-auto pr-1">
                            {glossaryMatchedTerms.slice(0, 24).map((term) => (
                              <span
                                key={term.id}
                                className="rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold text-[color:var(--muted)]"
                                title={term.note || undefined}
                              >
                                {term.source}
                                {" => "}
                                {term.target}
                              </span>
                            ))}
                          </div>
                          {glossaryMatchedTerms.length > 24 ? (
                            <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">
                              仅展示前 24 个命中术语。
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-sm leading-6 text-[color:var(--muted)]">
                          这本书目前还没有命中任何已配置术语。
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--panel-strong)] p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                        <Search className="h-4 w-4" />
                        <span>站内搜索</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                        搜索英文原文或中文译文。点击结果会跳到对应段落，并把搜索词与段落编号写进地址栏。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopyCurrentLink()}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50"
                    >
                      <Link2 className="h-4 w-4" />
                      复制当前位置链接
                    </button>
                  </div>

                  <form
                    onSubmit={handleSearchSubmit}
                    className="mt-4 flex flex-col gap-3 lg:flex-row"
                  >
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      className="min-w-0 flex-1 rounded-2xl border border-[color:var(--line)] bg-white px-4 py-3 text-sm outline-none transition placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]"
                      placeholder="搜索英文或中文，例如 chapter、winter、名字或关键词"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
                    >
                      <Search className="h-4 w-4" />
                      更新搜索链接
                    </button>
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      disabled={!searchInput.trim() && !searchQueryFromUrl}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-5 py-3 text-sm font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                    >
                      <X className="h-4 w-4" />
                      清空
                    </button>
                  </form>

                  {normalizedSearchQuery ? (
                    <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">
                      当前命中 {searchResults.length} 段。
                      {activeSearchResultIndex >= 0
                        ? ` 你正在查看第 ${activeSearchResultIndex + 1}/${searchResults.length} 个命中。`
                        : " 当前阅读位置还不在命中段落里。"}
                      地址栏中的 `q` 可直接分享给别人在同一本书里复现搜索，也可以在下方阅读过滤里切到“搜索命中”。
                    </p>
                  ) : (
                    <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">
                      输入关键词后会实时预览命中结果；提交后，地址栏会同步带上 `q` 参数。
                    </p>
                  )}

                  <p className="mt-2 text-xs leading-6 text-[color:var(--muted)]">
                    快捷键：`j` / `k` 或 `↑` / `↓` 切换段落，`n` / `Shift+n` 在搜索命中间跳转，`/` 聚焦搜索框。
                  </p>

                  {normalizedSearchQuery && searchResults.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleJumpBetweenSearchResults("previous")}
                        className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50"
                      >
                        上一处命中
                      </button>
                      <button
                        type="button"
                        onClick={() => handleJumpBetweenSearchResults("next")}
                        className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-stone-50"
                      >
                        下一处命中
                      </button>
                    </div>
                  ) : null}

                  {normalizedSearchQuery ? (
                    searchResults.length === 0 ? (
                      <div className="mt-4 rounded-[20px] border border-dashed border-[color:var(--line)] bg-white/70 px-4 py-5 text-sm leading-6 text-[color:var(--muted)]">
                        没有找到匹配段落。可以换一个关键词，或者先检查这本书是否已生成中文译文。
                      </div>
                    ) : (
                      <div className="mt-4">
                        <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                          {searchResults.slice(0, 18).map((result) => (
                            <button
                              key={result.paragraphIndex}
                              type="button"
                              onClick={() =>
                                goToParagraph(result.paragraphIndex, {
                                  hiddenParagraphNotice:
                                    "当前过滤隐藏了该搜索结果，已切回全部段落。",
                                  revealHiddenParagraph: true,
                                })
                              }
                              className="block w-full rounded-[20px] border border-[color:var(--line)] bg-white px-4 py-3 text-left transition hover:border-[color:var(--accent)]"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm font-semibold">
                                  Paragraph {result.paragraphIndex + 1}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {result.matchesSource ? (
                                    <span className="rounded-full bg-stone-200 px-3 py-1 text-[11px] font-semibold text-stone-700">
                                      英文命中
                                    </span>
                                  ) : null}
                                  {result.matchesTranslation ? (
                                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                                      中文命中
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              {result.sourceSnippet ? (
                                <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                                  EN: {result.sourceSnippet}
                                </p>
                              ) : null}

                              {result.translatedSnippet ? (
                                <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                                  ZH: {result.translatedSnippet}
                                </p>
                              ) : null}
                            </button>
                          ))}
                        </div>

                        {searchResults.length > 18 ? (
                          <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">
                            当前仅展示前 18 条结果。更具体的关键词能更快定位到目标段落。
                          </p>
                        ) : null}
                      </div>
                    )
                  ) : null}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-[color:var(--line)] bg-white/75">
              <div className="hidden grid-cols-2 border-b border-[color:var(--line)] bg-[color:var(--panel-strong)] lg:grid">
                <div className="flex items-center gap-2 px-5 py-4 text-sm font-semibold">
                  <BookOpenText className="h-4 w-4 text-[color:var(--accent-strong)]" />
                  English Original
                </div>
                <div className="flex items-center gap-2 border-l border-[color:var(--line)] px-5 py-4 text-sm font-semibold">
                  <Languages className="h-4 w-4 text-[color:var(--accent-strong)]" />
                  Chinese Translation
                </div>
              </div>

              <div className="border-b border-[color:var(--line)] bg-[color:var(--panel-strong)]/80 px-4 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold">阅读过滤</p>
                    <p className="mt-1 text-xs leading-6 text-[color:var(--muted)]">
                      当前显示 {filteredParagraphs.length}/{selectedBook.paragraphs.length} 段。
                      {paragraphFilter === "all"
                        ? " 全量视图适合通读。"
                        : ` 已切换到「${selectedParagraphFilterOption.label}」视图。`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {visibleParagraphFilterOptions.map((option) => {
                      const optionCount = paragraphFilterCounts[option.value];

                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={option.value !== "all" && optionCount === 0}
                          onClick={() => setParagraphFilter(option.value)}
                          className={cn(
                            "rounded-full border px-4 py-2 text-sm font-semibold transition",
                            paragraphFilter === option.value
                              ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]"
                              : "border-[color:var(--line)] bg-white hover:bg-stone-50",
                          )}
                        >
                          {option.label} ({optionCount})
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div
                ref={scrollContainerRef}
                className="max-h-[68vh] overflow-y-auto px-4 py-4"
                onScroll={handleReaderScroll}
              >
                {filteredParagraphs.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-[color:var(--line)] bg-white/70 px-4 py-8 text-sm leading-6 text-[color:var(--muted)]">
                    {paragraphFilter === "search-results"
                      ? "当前搜索还没有命中任何段落。可以换一个关键词，或切回“全部段落”继续阅读。"
                      : "当前过滤条件下没有可显示的段落。可以切回“全部段落”，或者换一本到有对应内容的书继续看。"}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredParagraphs.map((paragraph, visibleParagraphIndex) => {
                    const isSearchHit = searchHitParagraphIndexes.has(paragraph.index);
                    const isBookmarked = bookmarksByParagraphIndex.has(paragraph.index);
                    const glossaryMatch = paragraphGlossaryMatches.get(paragraph.index) ?? null;
                    const currentSection =
                      selectedBook.sections[
                        getSectionIndexForParagraph(
                          selectedBook.sections,
                          paragraph.index,
                        )
                      ] ?? null;
                    const previousVisibleParagraph =
                      filteredParagraphs[visibleParagraphIndex - 1] ?? null;
                    const previousSection =
                      previousVisibleParagraph
                        ? selectedBook.sections[
                            getSectionIndexForParagraph(
                              selectedBook.sections,
                              previousVisibleParagraph.index,
                            )
                          ] ?? null
                        : null;
                    const sectionMarker =
                      selectedBook.sections.length > 1
                        ? currentSection && currentSection.id !== previousSection?.id
                          ? currentSection
                          : null
                        : null;

                    return (
                      <article
                        key={paragraph.id}
                        ref={(element) => setParagraphRef(paragraph.id, element)}
                        className={cn(
                          "rounded-[24px] border p-4 transition",
                          paragraph.index === activeParagraphIndex
                            ? "border-[color:var(--accent)] bg-white"
                            : isBookmarked
                              ? "border-amber-300 bg-amber-50/70"
                            : isSearchHit
                              ? "border-[color:var(--accent)]/60 bg-[color:var(--accent-soft)]/45"
                              : "border-[color:var(--line)] bg-[color:var(--panel)]",
                        )}
                      >
                        {sectionMarker ? (
                          <div className="mb-4 rounded-[20px] border border-[color:var(--line)] bg-[color:var(--accent-soft)] px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--accent-strong)]">
                              Section
                            </p>
                            <p className="mt-1 text-base font-semibold">
                              {sectionMarker.title}
                            </p>
                          </div>
                        ) : null}

                        <div className="mb-4 flex items-center justify-between gap-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--muted)]">
                              Paragraph {paragraph.index + 1}
                            </p>
                            {isBookmarked ? (
                              <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-900">
                                已收藏
                              </span>
                            ) : null}
                            {glossaryMatch?.matchedTerms.length ? (
                              <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-900">
                                术语 {glossaryMatch.matchedTerms.length}
                              </span>
                            ) : null}
                            {isSearchHit ? (
                              <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-[11px] font-semibold text-[color:var(--accent-strong)]">
                                搜索命中
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {paragraph.translationStatus !== "done" ? (
                              <Link
                                href={buildLibraryHref(selectedBook.id, {
                                  paragraph: paragraph.index + 1,
                                })}
                                className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:border-[color:var(--accent)] hover:bg-stone-50"
                              >
                                去书库处理
                              </Link>
                            ) : null}
                            <span
                              className={cn(
                                "rounded-full px-3 py-1 text-xs font-semibold",
                                paragraph.translationStatus === "done"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : paragraph.translationStatus === "error"
                                    ? "bg-red-100 text-red-700"
                                    : paragraph.translationStatus === "translating"
                                      ? "bg-amber-100 text-amber-800"
                                      : "bg-stone-200 text-stone-700",
                              )}
                            >
                              {paragraph.translationStatus === "done"
                                ? "已翻译"
                                : paragraph.translationStatus === "error"
                                  ? "失败"
                                  : paragraph.translationStatus === "translating"
                                    ? "翻译中"
                                  : "待翻译"}
                            </span>
                            {paragraph.translationStatus === "done" ? (
                              <span
                                className={cn(
                                  "rounded-full px-3 py-1 text-xs font-semibold",
                                  getTranslationReviewStatusClassName(
                                    paragraph.reviewStatus,
                                  ),
                                )}
                              >
                                {getTranslationReviewStatusLabel(paragraph.reviewStatus)}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="rounded-[20px] border border-[color:var(--line)] bg-white p-4">
                            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)] lg:hidden">
                              English
                            </p>
                            <p className="mt-3 text-[15px] leading-8 text-[color:var(--foreground)]">
                              {isGlossaryHighlightEnabled && glossaryMatch
                                ? renderTextWithGlossaryHighlights(
                                    paragraph.sourceText,
                                    glossaryMatch.sourceMatches,
                                    `source-${paragraph.id}`,
                                  )
                                : paragraph.sourceText}
                            </p>
                          </div>

                          <div className="rounded-[20px] border border-[color:var(--line)] bg-[color:var(--panel-strong)] p-4">
                            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)] lg:hidden">
                              Chinese
                            </p>
                            <p className="mt-3 text-[15px] leading-8 text-[color:var(--foreground)]">
                              {paragraph.translatedText
                                ? isGlossaryHighlightEnabled && glossaryMatch
                                  ? renderTextWithGlossaryHighlights(
                                      paragraph.translatedText,
                                      glossaryMatch.targetMatches,
                                      `target-${paragraph.id}`,
                                    )
                                  : paragraph.translatedText
                                : "这段还没有译文。"}
                            </p>
                          </div>
                        </div>

                        {paragraph.translationError ? (
                          <p className="mt-3 text-sm text-red-600">
                            错误：{paragraph.translationError}
                          </p>
                        ) : null}

                        {paragraph.translationStatus === "done" ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void handleUpdateParagraphReviewStatus(
                                  paragraph.index,
                                  "reviewed",
                                )
                              }
                              disabled={paragraph.reviewStatus === "reviewed"}
                              className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                            >
                              标记已复核
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleUpdateParagraphReviewStatus(
                                  paragraph.index,
                                  "needs-revision",
                                )
                              }
                              disabled={paragraph.reviewStatus === "needs-revision"}
                              className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                            >
                              标记待修订
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleUpdateParagraphReviewStatus(
                                  paragraph.index,
                                  "unreviewed",
                                )
                              }
                              disabled={paragraph.reviewStatus === "unreviewed"}
                              className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white px-3 py-2 text-xs font-semibold transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                            >
                              清除标记
                            </button>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

type ReaderMetricProps = {
  hint: string;
  label: string;
  value: string;
};

function ReaderMetric({ hint, label, value }: ReaderMetricProps) {
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
