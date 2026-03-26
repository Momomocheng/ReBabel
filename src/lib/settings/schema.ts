import { z } from "zod";

export const settingsSchema = z.object({
  providerLabel: z
    .string()
    .trim()
    .min(1, "请输入服务商标签。")
    .max(40, "服务商标签不要超过 40 个字符。"),
  baseUrl: z
    .string()
    .trim()
    .url("请输入有效的 Base URL，例如 https://api.openai.com/v1。"),
  model: z.string().trim().min(1, "请输入模型名称。"),
  apiKey: z.string().trim().min(1, "请输入 API Key。"),
});

export type SettingsInput = z.infer<typeof settingsSchema>;

export const defaultSettings: SettingsInput = {
  providerLabel: "OpenAI Compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
};

export function createInitialSettings(): SettingsInput {
  return { ...defaultSettings };
}

export function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}
