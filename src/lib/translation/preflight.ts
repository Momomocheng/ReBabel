import { normalizeBaseUrl } from "@/lib/settings/schema";
import type { TranslationErrorCategory } from "@/lib/translation/error-classification";
import type { TranslationBatchScope } from "@/lib/translation/preferences";

export type TranslationPreflightIssueLevel = "blocking" | "warning" | "info";

export type TranslationPreflightIssue = {
  code: string;
  description: string;
  level: TranslationPreflightIssueLevel;
  title: string;
};

type FailedCategorySummary = {
  category: TranslationErrorCategory;
  count: number;
};

type TranslationPreflightInput = {
  apiKey: string;
  baseUrl: string;
  batchScope: TranslationBatchScope;
  contextSize: number;
  failedCategories: FailedCategorySummary[];
  model: string;
  requestDelayMs: number;
};

function isLikelyPlaceholderApiKey(apiKey: string) {
  const normalizedApiKey = apiKey.toLocaleLowerCase();

  return (
    normalizedApiKey.includes("your-api-key") ||
    normalizedApiKey.includes("placeholder") ||
    normalizedApiKey.includes("xxxxx") ||
    normalizedApiKey === "sk-..." ||
    normalizedApiKey === "api-key"
  );
}

function getFailedCategoryCount(
  failedCategories: FailedCategorySummary[],
  category: TranslationErrorCategory,
) {
  return failedCategories.find((item) => item.category === category)?.count ?? 0;
}

export function buildTranslationPreflightIssues({
  apiKey,
  baseUrl,
  batchScope,
  contextSize,
  failedCategories,
  model,
  requestDelayMs,
}: TranslationPreflightInput) {
  const issues: TranslationPreflightIssue[] = [];
  const normalizedApiKey = apiKey.trim();
  const normalizedModel = model.trim();
  const normalizedBaseUrl = baseUrl.trim() ? normalizeBaseUrl(baseUrl.trim()) : "";

  if (!normalizedBaseUrl) {
    issues.push({
      code: "missing-base-url",
      description: "还没有填写 Base URL。先去设置页补全兼容接口根路径，再开始翻译。",
      level: "blocking",
      title: "缺少 Base URL",
    });
  }

  if (!normalizedModel) {
    issues.push({
      code: "missing-model",
      description: "还没有填写模型名称。当前请求无法知道该调用哪个模型。",
      level: "blocking",
      title: "缺少模型名",
    });
  }

  if (!normalizedApiKey) {
    issues.push({
      code: "missing-api-key",
      description: "还没有填写 API Key。先去设置页补全鉴权信息。",
      level: "blocking",
      title: "缺少 API Key",
    });
  }

  let parsedBaseUrl: URL | null = null;

  if (normalizedBaseUrl) {
    try {
      parsedBaseUrl = new URL(normalizedBaseUrl);
    } catch {
      issues.push({
        code: "invalid-base-url",
        description: "Base URL 不是合法地址。请填写接口根路径，例如 `https://api.openai.com/v1`。",
        level: "blocking",
        title: "Base URL 格式无效",
      });
    }
  }

  if (
    parsedBaseUrl &&
    (parsedBaseUrl.pathname.endsWith("/chat/completions") ||
      parsedBaseUrl.pathname.endsWith("/responses"))
  ) {
    issues.push({
      code: "base-url-looks-like-endpoint",
      description: "当前 Base URL 看起来填成了完整接口地址。这里应填写 API 根路径，而不是 `/chat/completions` 这类具体 endpoint。",
      level: "blocking",
      title: "Base URL 填成了具体接口",
    });
  }

  if (
    parsedBaseUrl &&
    parsedBaseUrl.protocol !== "https:" &&
    parsedBaseUrl.hostname !== "localhost" &&
    parsedBaseUrl.hostname !== "127.0.0.1"
  ) {
    issues.push({
      code: "insecure-base-url",
      description: "当前 Base URL 不是 HTTPS。除本地开发外，这通常意味着浏览器会遇到安全或跨域问题。",
      level: "warning",
      title: "Base URL 不是 HTTPS",
    });
  }

  if (
    parsedBaseUrl &&
    parsedBaseUrl.hostname === "api.openai.com" &&
    !parsedBaseUrl.pathname.startsWith("/v1")
  ) {
    issues.push({
      code: "openai-base-url-missing-v1",
      description: "如果你在直连 OpenAI 兼容接口，通常应该填写 `https://api.openai.com/v1`，否则请求会打到错误路径。",
      level: "warning",
      title: "OpenAI 地址可能缺少 /v1",
    });
  }

  if (normalizedApiKey && isLikelyPlaceholderApiKey(normalizedApiKey)) {
    issues.push({
      code: "placeholder-api-key",
      description: "当前 API Key 看起来像占位符。继续请求大概率只会得到鉴权错误。",
      level: "warning",
      title: "API Key 像是示例值",
    });
  }

  if (normalizedApiKey && normalizedApiKey.length < 12) {
    issues.push({
      code: "short-api-key",
      description: "当前 API Key 很短，像是被截断或只粘贴了一部分。建议先回设置页确认。",
      level: "warning",
      title: "API Key 长度可疑",
    });
  }

  if (getFailedCategoryCount(failedCategories, "auth") >= 2) {
    issues.push({
      code: "repeated-auth-failures",
      description: "这本书最近已经出现多次鉴权失败。继续重跑前，最好先核对 API Key、Base URL 和项目权限。",
      level: "warning",
      title: "近期多次鉴权失败",
    });
  }

  if (getFailedCategoryCount(failedCategories, "model") >= 2) {
    issues.push({
      code: "repeated-model-failures",
      description: "最近多次命中模型或端点配置错误。优先检查模型名是否写对，以及当前 Base URL 是否支持它。",
      level: "warning",
      title: "近期多次模型配置失败",
    });
  }

  if (
    getFailedCategoryCount(failedCategories, "rate-limit") >= 2 &&
    requestDelayMs === 0
  ) {
    issues.push({
      code: "rate-limit-with-zero-delay",
      description: "最近多次遇到限流，而当前请求间隔仍是 0 ms。继续跑批前，建议先把间隔调高。",
      level: "warning",
      title: "限流风险高",
    });
  }

  if (
    getFailedCategoryCount(failedCategories, "request") >= 2 &&
    contextSize >= 4
  ) {
    issues.push({
      code: "request-errors-with-large-context",
      description: "最近多次出现请求格式或上下文问题，而当前前文段数偏大。可以先把上下文缩短后再试。",
      level: "warning",
      title: "上下文可能过大",
    });
  }

  if (
    batchScope === "remaining" &&
    failedCategories.length > 0 &&
    failedCategories.some((item) => item.count > 0)
  ) {
    issues.push({
      code: "remaining-scope-includes-failures",
      description: "当前范围会把失败段也一起重试。若你只想先验证配置修复是否生效，可以切到“仅失败段落”或按错误类型重试。",
      level: "info",
      title: "当前范围包含失败段重试",
    });
  }

  return issues;
}
