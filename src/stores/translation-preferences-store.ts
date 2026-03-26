"use client";

import {
  createGlossaryTerm,
  createGlossaryTermId,
} from "@/lib/translation/glossary";
import {
  DEFAULT_BOOK_READABLE_EXPORT_FORMAT,
  DEFAULT_BOOK_TEXT_EXPORT_SCOPE,
  normalizeBookReadableExportFormat,
  normalizeBookTextExportScope,
  type BookReadableExportFormat,
  type BookTextExportScope,
} from "@/lib/books/export-options";
import {
  DEFAULT_TRANSLATION_BATCH_SCOPE,
  TRANSLATION_BATCH_HISTORY_LIMIT,
  DEFAULT_TRANSLATION_CONTEXT_SIZE,
  MIN_TRANSLATION_REQUEST_DELAY_MS,
  normalizeTranslationBatchScope,
  normalizeTranslationContextSize,
  normalizeTranslationRequestDelayMs,
  type TranslationBatchHistoryEntry,
  type TranslationBatchSession,
  type TranslationBatchScope,
} from "@/lib/translation/preferences";
import type { GlossaryTerm } from "@/lib/translation/types";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type TranslationPreferencesState = {
  addBatchHistoryEntry: (entry: TranslationBatchHistoryEntry) => void;
  batchHistoryEntries: TranslationBatchHistoryEntry[];
  batchScope: TranslationBatchScope;
  clearBatchHistoryForBook: (bookId: string) => void;
  clearLastBatchSession: () => void;
  contextSize: number;
  extraInstructions: string;
  glossaryTerms: GlossaryTerm[];
  isHydrated: boolean;
  lastBatchSession: TranslationBatchSession | null;
  preferredReadableExportFormat: BookReadableExportFormat;
  requestDelayMs: number;
  resetPreferredReadableExportFormat: () => void;
  resetTextExportScope: () => void;
  addGlossaryTerm: () => void;
  resetBatchScope: () => void;
  replaceGlossaryTerms: (glossaryTerms: GlossaryTerm[]) => void;
  resetContextSize: () => void;
  resetRequestDelayMs: () => void;
  removeGlossaryTerm: (id: string) => void;
  resetExtraInstructions: () => void;
  resetGlossaryTerms: () => void;
  setPreferredReadableExportFormat: (
    preferredReadableExportFormat: BookReadableExportFormat,
  ) => void;
  setBatchScope: (batchScope: TranslationBatchScope) => void;
  setContextSize: (contextSize: number) => void;
  setExtraInstructions: (extraInstructions: string) => void;
  setHydrated: (isHydrated: boolean) => void;
  setLastBatchSession: (lastBatchSession: TranslationBatchSession | null) => void;
  setRequestDelayMs: (requestDelayMs: number) => void;
  setTextExportScope: (textExportScope: BookTextExportScope) => void;
  textExportScope: BookTextExportScope;
  updateGlossaryTerm: (
    id: string,
    patch: Partial<Pick<GlossaryTerm, "note" | "source" | "target">>,
  ) => void;
};

const STORAGE_KEY = "rebabel.translation-preferences.v1";

function getDefaultState(): Pick<
  TranslationPreferencesState,
  | "batchHistoryEntries"
  | "batchScope"
  | "contextSize"
  | "extraInstructions"
  | "glossaryTerms"
  | "isHydrated"
  | "lastBatchSession"
  | "preferredReadableExportFormat"
  | "requestDelayMs"
  | "textExportScope"
> {
  return {
    batchHistoryEntries: [],
    batchScope: DEFAULT_TRANSLATION_BATCH_SCOPE,
    contextSize: DEFAULT_TRANSLATION_CONTEXT_SIZE,
    extraInstructions: "",
    glossaryTerms: [],
    isHydrated: false,
    lastBatchSession: null,
    preferredReadableExportFormat: DEFAULT_BOOK_READABLE_EXPORT_FORMAT,
    requestDelayMs: MIN_TRANSLATION_REQUEST_DELAY_MS,
    textExportScope: DEFAULT_BOOK_TEXT_EXPORT_SCOPE,
  };
}

function createBatchHistoryEntryId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `batch-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useTranslationPreferencesStore =
  create<TranslationPreferencesState>()(
    persist(
      (set) => ({
        ...getDefaultState(),
        addBatchHistoryEntry: (entry) =>
          set((state) => ({
            batchHistoryEntries: [
              {
                ...entry,
                id: entry.id || createBatchHistoryEntryId(),
              },
              ...state.batchHistoryEntries,
            ].slice(0, TRANSLATION_BATCH_HISTORY_LIMIT),
          })),
        addGlossaryTerm: () =>
          set((state) => ({
            glossaryTerms: [...state.glossaryTerms, createGlossaryTerm()],
          })),
        clearBatchHistoryForBook: (bookId) =>
          set((state) => ({
            batchHistoryEntries: state.batchHistoryEntries.filter(
              (entry) => entry.bookId !== bookId,
            ),
          })),
        resetPreferredReadableExportFormat: () =>
          set(() => ({
            preferredReadableExportFormat: DEFAULT_BOOK_READABLE_EXPORT_FORMAT,
          })),
        resetTextExportScope: () =>
          set(() => ({
            textExportScope: DEFAULT_BOOK_TEXT_EXPORT_SCOPE,
          })),
        resetBatchScope: () =>
          set(() => ({
            batchScope: DEFAULT_TRANSLATION_BATCH_SCOPE,
          })),
        clearLastBatchSession: () =>
          set(() => ({
            lastBatchSession: null,
          })),
        replaceGlossaryTerms: (glossaryTerms) =>
          set(() => ({
            glossaryTerms: glossaryTerms.map((term) => ({
              ...term,
              id: term.id || createGlossaryTermId(),
            })),
          })),
        resetContextSize: () =>
          set(() => ({
            contextSize: DEFAULT_TRANSLATION_CONTEXT_SIZE,
          })),
        resetRequestDelayMs: () =>
          set(() => ({
            requestDelayMs: MIN_TRANSLATION_REQUEST_DELAY_MS,
          })),
        removeGlossaryTerm: (id) =>
          set((state) => ({
            glossaryTerms: state.glossaryTerms.filter((term) => term.id !== id),
          })),
        setExtraInstructions: (extraInstructions) =>
          set(() => ({
            extraInstructions,
          })),
        resetExtraInstructions: () =>
          set(() => ({
            extraInstructions: "",
          })),
        resetGlossaryTerms: () =>
          set(() => ({
            glossaryTerms: [],
          })),
        setPreferredReadableExportFormat: (preferredReadableExportFormat) =>
          set(() => ({
            preferredReadableExportFormat: normalizeBookReadableExportFormat(
              preferredReadableExportFormat,
            ),
          })),
        setBatchScope: (batchScope) =>
          set(() => ({
            batchScope: normalizeTranslationBatchScope(batchScope),
          })),
        setContextSize: (contextSize) =>
          set(() => ({
            contextSize: normalizeTranslationContextSize(contextSize),
          })),
        setHydrated: (isHydrated) =>
          set(() => ({
            isHydrated,
          })),
        setLastBatchSession: (lastBatchSession) =>
          set(() => ({
            lastBatchSession,
          })),
        setRequestDelayMs: (requestDelayMs) =>
          set(() => ({
            requestDelayMs: normalizeTranslationRequestDelayMs(requestDelayMs),
          })),
        setTextExportScope: (textExportScope) =>
          set(() => ({
            textExportScope: normalizeBookTextExportScope(textExportScope),
          })),
        updateGlossaryTerm: (id, patch) =>
          set((state) => ({
            glossaryTerms: state.glossaryTerms.map((term) =>
              term.id === id
                ? {
                    ...term,
                    ...patch,
                  }
                : term,
            ),
          })),
      }),
      {
        name: STORAGE_KEY,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          batchHistoryEntries: state.batchHistoryEntries,
          batchScope: state.batchScope,
          contextSize: state.contextSize,
          extraInstructions: state.extraInstructions,
          glossaryTerms: state.glossaryTerms,
          lastBatchSession: state.lastBatchSession,
          preferredReadableExportFormat: state.preferredReadableExportFormat,
          requestDelayMs: state.requestDelayMs,
          textExportScope: state.textExportScope,
        }),
        onRehydrateStorage: () => (state) => {
          state?.setHydrated(true);
        },
      },
    ),
  );
