"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  createInitialSettings,
  type SettingsInput,
} from "@/lib/settings/schema";

type SettingsState = SettingsInput & {
  isHydrated: boolean;
  resetSettings: () => void;
  saveSettings: (settings: SettingsInput) => void;
  setHydrated: (isHydrated: boolean) => void;
};

const STORAGE_KEY = "rebabel.settings.v1";

function getDefaultState() {
  return {
    ...createInitialSettings(),
    isHydrated: false,
  };
}

function getPersistedFields(state: SettingsState): SettingsInput {
  return {
    providerLabel: state.providerLabel,
    baseUrl: state.baseUrl,
    model: state.model,
    apiKey: state.apiKey,
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...getDefaultState(),
      saveSettings: (settings) => set(() => settings),
      resetSettings: () => set(() => createInitialSettings()),
      setHydrated: (isHydrated) => set(() => ({ isHydrated })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: getPersistedFields,
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);
