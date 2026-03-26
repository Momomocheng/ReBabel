"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Eye, EyeOff, RotateCcw, Save, Shield } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  normalizeBaseUrl,
  settingsSchema,
  type SettingsInput,
} from "@/lib/settings/schema";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";

type FormErrors = Partial<Record<keyof SettingsInput, string>>;

const inputClassName =
  "mt-2 w-full rounded-2xl border border-[color:var(--line)] bg-white/85 px-4 py-3 text-sm outline-none transition placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]";

function mapFormErrors(error: ReturnType<typeof settingsSchema.safeParse>) {
  if (error.success) {
    return {};
  }

  const fieldErrors: FormErrors = {};

  for (const issue of error.error.issues) {
    const [field] = issue.path;

    if (typeof field === "string" && !fieldErrors[field as keyof SettingsInput]) {
      fieldErrors[field as keyof SettingsInput] = issue.message;
    }
  }

  return fieldErrors;
}

function maskApiKey(apiKey: string) {
  if (!apiKey) {
    return "未保存";
  }

  if (apiKey.length <= 8) {
    return "已保存";
  }

  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
}

function getPersistedSettings(settings: SettingsInput) {
  return {
    providerLabel: settings.providerLabel,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
  };
}

function getEmptySettings(): SettingsInput {
  return {
    providerLabel: "OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    apiKey: "",
  };
}

export function SettingsForm() {
  const {
    providerLabel,
    baseUrl,
    model,
    apiKey,
    isHydrated,
    saveSettings,
    resetSettings,
  } = useSettingsStore(
    useShallow((state) => ({
      providerLabel: state.providerLabel,
      baseUrl: state.baseUrl,
      model: state.model,
      apiKey: state.apiKey,
      isHydrated: state.isHydrated,
      saveSettings: state.saveSettings,
      resetSettings: state.resetSettings,
    })),
  );

  const [notice, setNotice] = useState("");

  const storedSettings = useMemo(
    () => getPersistedSettings({ providerLabel, baseUrl, model, apiKey }),
    [providerLabel, baseUrl, model, apiKey],
  );

  const isConfigured = Boolean(baseUrl && model && apiKey);
  const formKey = JSON.stringify(storedSettings);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(""), 2400);

    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <div className="rounded-[34px] border border-[color:var(--line)] bg-[color:var(--panel-strong)]/90 p-7 shadow-[var(--shadow)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 border-b border-[color:var(--line)] pb-6 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-[color:var(--muted)]">
            Settings
          </p>
          <h2 className="mt-3 font-serif text-4xl">模型配置</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[color:var(--muted)]">
            当前阶段先保存四项核心配置：服务商标签、Base URL、模型名和 API Key。
            后续翻译引擎会直接读取这里的本地配置。
          </p>
        </div>

        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold",
            isConfigured
              ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]"
              : "bg-stone-200 text-stone-700",
          )}
        >
          <Shield className="h-4 w-4" />
          {isConfigured ? "已完成基础配置" : "尚未完成配置"}
        </div>
      </div>

      {!isHydrated ? (
        <div aria-live="polite" className="py-16 text-sm text-[color:var(--muted)]">
          正在读取本地配置...
        </div>
      ) : (
        <HydratedSettingsForm
          key={formKey}
          notice={notice}
          onNoticeChange={setNotice}
          onReset={resetSettings}
          onSave={saveSettings}
          storedSettings={storedSettings}
        />
      )}
    </div>
  );
}

type HydratedSettingsFormProps = {
  notice: string;
  onNoticeChange: (message: string) => void;
  onReset: () => void;
  onSave: (settings: SettingsInput) => void;
  storedSettings: SettingsInput;
};

function HydratedSettingsForm({
  notice,
  onNoticeChange,
  onReset,
  onSave,
  storedSettings,
}: HydratedSettingsFormProps) {
  const [draft, setDraft] = useState<SettingsInput>(storedSettings);
  const [errors, setErrors] = useState<FormErrors>({});
  const [showApiKey, setShowApiKey] = useState(false);

  const isDirty =
    draft.providerLabel !== storedSettings.providerLabel ||
    draft.baseUrl !== storedSettings.baseUrl ||
    draft.model !== storedSettings.model ||
    draft.apiKey !== storedSettings.apiKey;

  function updateField(field: keyof SettingsInput, value: string) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));

    setErrors((current) => ({
      ...current,
      [field]: undefined,
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedDraft = {
      ...draft,
      baseUrl: normalizeBaseUrl(draft.baseUrl),
    };

    const result = settingsSchema.safeParse(normalizedDraft);

    if (!result.success) {
      setErrors(mapFormErrors(result));
      onNoticeChange("");
      return;
    }

    onSave(result.data);
    onNoticeChange("配置已保存到当前浏览器。");
  }

  function handleReset() {
    onReset();
    setDraft(getEmptySettings());
    setErrors({});
    setShowApiKey(false);
    onNoticeChange("已恢复默认设置。");
  }

  return (
    <form className="space-y-6 pt-7" onSubmit={handleSubmit}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label="服务商标签"
          htmlFor="providerLabel"
          help="只是本地展示用。默认采用 OpenAI 兼容接口的思路。"
          error={errors.providerLabel}
        >
          <input
            id="providerLabel"
            name="providerLabel"
            className={inputClassName}
            value={draft.providerLabel}
            onChange={(event) => updateField("providerLabel", event.target.value)}
            placeholder="例如 OpenAI Compatible"
          />
        </Field>

        <Field
          label="模型名称"
          htmlFor="model"
          help="后续翻译请求将直接使用这个 model 字段。"
          error={errors.model}
        >
          <input
            id="model"
            name="model"
            className={inputClassName}
            value={draft.model}
            onChange={(event) => updateField("model", event.target.value)}
            placeholder="例如 gpt-4.1-mini"
          />
        </Field>
      </div>

      <Field
        label="Base URL"
        htmlFor="baseUrl"
        help="需要填写完整接口根路径，例如 https://api.openai.com/v1。保存时会自动去掉末尾斜杠。"
        error={errors.baseUrl}
      >
        <input
          id="baseUrl"
          name="baseUrl"
          className={inputClassName}
          value={draft.baseUrl}
          onChange={(event) => updateField("baseUrl", event.target.value)}
          placeholder="https://api.openai.com/v1"
        />
      </Field>

      <Field
        label="API Key"
        htmlFor="apiKey"
        help="只保存在当前浏览器 LocalStorage，不上传到服务器。"
        error={errors.apiKey}
      >
        <div className="relative">
          <input
            id="apiKey"
            name="apiKey"
            className={cn(inputClassName, "pr-14")}
            type={showApiKey ? "text" : "password"}
            value={draft.apiKey}
            onChange={(event) => updateField("apiKey", event.target.value)}
            placeholder="sk-..."
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowApiKey((current) => !current)}
            className="absolute top-1/2 right-3 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--line)] bg-white text-[color:var(--muted)] transition hover:text-[color:var(--foreground)]"
            aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
          >
            {showApiKey ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </Field>

      <div className="grid gap-4 rounded-[28px] border border-[color:var(--line)] bg-white/70 p-5 md:grid-cols-3">
        <MetricCard label="服务商" value={storedSettings.providerLabel || "未填写"} />
        <MetricCard label="当前模型" value={storedSettings.model || "未填写"} />
        <MetricCard label="API Key" value={maskApiKey(storedSettings.apiKey)} />
      </div>

      <div className="flex flex-col gap-4 border-t border-[color:var(--line)] pt-6 md:flex-row md:items-center md:justify-between">
        <div aria-live="polite" className="text-sm leading-6 text-[color:var(--muted)]">
          <p>第一步完成后，下一步就能接上传 `.txt`、段落分块和翻译进度条。</p>
          {notice ? (
            <p className="font-semibold text-[color:var(--accent-strong)]">
              {notice}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line)] bg-white px-5 py-3 text-sm font-semibold transition hover:bg-stone-50"
          >
            <RotateCcw className="h-4 w-4" />
            恢复默认
          </button>
          <button
            type="submit"
            disabled={!isDirty}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow)] transition enabled:hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            <Save className="h-4 w-4" />
            保存到本地
          </button>
        </div>
      </div>
    </form>
  );
}

type FieldProps = {
  children: ReactNode;
  error?: string;
  help: string;
  htmlFor: string;
  label: string;
};

function Field({ children, error, help, htmlFor, label }: FieldProps) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      <p
        className={cn(
          "mt-2 text-xs leading-6",
          error ? "text-red-600" : "text-[color:var(--muted)]",
        )}
      >
        {error ?? help}
      </p>
    </label>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
};

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="rounded-[22px] border border-[color:var(--line)] bg-[color:var(--panel-strong)] px-4 py-4">
      <p className="text-xs uppercase tracking-[0.22em] text-[color:var(--muted)]">
        {label}
      </p>
      <p className="mt-2 truncate text-sm font-semibold text-[color:var(--foreground)]">
        {value}
      </p>
    </div>
  );
}
