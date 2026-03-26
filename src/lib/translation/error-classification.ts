export const TRANSLATION_ERROR_CATEGORY_VALUES = [
  "auth",
  "permission",
  "rate-limit",
  "quota",
  "network",
  "model",
  "request",
  "empty-response",
  "unknown",
] as const;

export type TranslationErrorCategory =
  (typeof TRANSLATION_ERROR_CATEGORY_VALUES)[number];

export type TranslationErrorClassification = {
  category: TranslationErrorCategory;
  hint: string;
  label: string;
  requiresSettingsChange: boolean;
  retryable: boolean;
};

const ERROR_CLASSIFICATION_MAP: Record<
  TranslationErrorCategory,
  Omit<TranslationErrorClassification, "category">
> = {
  auth: {
    hint: "通常是 API Key 无效、过期，或服务商拒绝鉴权。先去设置页检查 Key 和 Base URL。",
    label: "鉴权失败",
    requiresSettingsChange: true,
    retryable: false,
  },
  permission: {
    hint: "当前账号或项目缺少访问权限。需要先确认服务商侧的模型权限或项目授权。",
    label: "权限不足",
    requiresSettingsChange: true,
    retryable: false,
  },
  "rate-limit": {
    hint: "请求打得太快了。可以提高请求间隔，稍后再重试这一批失败段落。",
    label: "限流 / 速率限制",
    requiresSettingsChange: false,
    retryable: true,
  },
  quota: {
    hint: "配额、余额或计费额度不足。需要先补充额度，再继续跑批。",
    label: "额度 / 配额不足",
    requiresSettingsChange: true,
    retryable: false,
  },
  network: {
    hint: "通常是浏览器网络、CORS、网关波动或上游暂时不可用。适合稍后重试。",
    label: "网络 / 网关异常",
    requiresSettingsChange: false,
    retryable: true,
  },
  model: {
    hint: "常见于模型名写错、端点不兼容，或当前 Base URL 下没有这个模型。",
    label: "模型 / 端点配置问题",
    requiresSettingsChange: true,
    retryable: false,
  },
  request: {
    hint: "请求参数、上下文长度或输入内容不被接受。通常要先缩短上下文或调整配置。",
    label: "请求格式 / 上下文问题",
    requiresSettingsChange: true,
    retryable: false,
  },
  "empty-response": {
    hint: "接口返回成功了，但没有有效译文。通常可以直接再试一次。",
    label: "空响应",
    requiresSettingsChange: false,
    retryable: true,
  },
  unknown: {
    hint: "暂时无法自动归类。先定位首段查看错误原文，再决定是改设置还是稍后重试。",
    label: "未分类错误",
    requiresSettingsChange: false,
    retryable: true,
  },
};

export function classifyTranslationError(
  rawMessage: string | null | undefined,
): TranslationErrorClassification {
  const message = rawMessage?.trim() ?? "";
  const normalizedMessage = message.toLocaleLowerCase();

  let category: TranslationErrorCategory = "unknown";

  if (
    normalizedMessage.includes("incorrect api key") ||
    normalizedMessage.includes("invalid api key") ||
    normalizedMessage.includes("unauthorized") ||
    normalizedMessage.includes("authentication") ||
    normalizedMessage.includes("authentication_error") ||
    normalizedMessage.includes("http 401") ||
    normalizedMessage.includes("401")
  ) {
    category = "auth";
  } else if (
    normalizedMessage.includes("forbidden") ||
    normalizedMessage.includes("permission") ||
    normalizedMessage.includes("access denied") ||
    normalizedMessage.includes("http 403") ||
    normalizedMessage.includes("403")
  ) {
    category = "permission";
  } else if (
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("too many requests") ||
    normalizedMessage.includes("http 429") ||
    normalizedMessage.includes("429")
  ) {
    category = "rate-limit";
  } else if (
    normalizedMessage.includes("quota") ||
    normalizedMessage.includes("billing") ||
    normalizedMessage.includes("credit") ||
    normalizedMessage.includes("insufficient_quota") ||
    normalizedMessage.includes("余额") ||
    normalizedMessage.includes("额度")
  ) {
    category = "quota";
  } else if (
    normalizedMessage.includes("failed to fetch") ||
    normalizedMessage.includes("networkerror") ||
    normalizedMessage.includes("network error") ||
    normalizedMessage.includes("cors") ||
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("timed out") ||
    normalizedMessage.includes("gateway") ||
    normalizedMessage.includes("bad gateway") ||
    normalizedMessage.includes("service unavailable") ||
    normalizedMessage.includes("http 502") ||
    normalizedMessage.includes("http 503") ||
    normalizedMessage.includes("http 504")
  ) {
    category = "network";
  } else if (
    normalizedMessage.includes("model") &&
    (normalizedMessage.includes("not found") ||
      normalizedMessage.includes("does not exist") ||
      normalizedMessage.includes("invalid"))
  ) {
    category = "model";
  } else if (
    normalizedMessage.includes("context length") ||
    normalizedMessage.includes("maximum context length") ||
    normalizedMessage.includes("invalid request") ||
    normalizedMessage.includes("unsupported parameter") ||
    normalizedMessage.includes("bad request") ||
    normalizedMessage.includes("http 400") ||
    normalizedMessage.includes("400")
  ) {
    category = "request";
  } else if (
    normalizedMessage.includes("模型返回为空") ||
    normalizedMessage.includes("未拿到有效译文") ||
    normalizedMessage.includes("empty")
  ) {
    category = "empty-response";
  }

  return {
    category,
    ...ERROR_CLASSIFICATION_MAP[category],
  };
}
