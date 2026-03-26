import Link from "next/link";
import { ShieldCheck, DatabaseZap, ChevronLeft, ArrowRight } from "lucide-react";
import { SettingsForm } from "@/components/settings/settings-form";

const principles = [
  {
    title: "BYOK 优先",
    description: "API Key 不经过 ReBabel 服务器，默认只写入当前浏览器。",
    icon: ShieldCheck,
  },
  {
    title: "兼容多模型入口",
    description: "先以 OpenAI 兼容接口为起点，后续再扩展 Anthropic 与 Gemini 适配层。",
    icon: DatabaseZap,
  },
];

export default function SettingsPage() {
  return (
    <main className="relative overflow-hidden px-6 py-8 lg:px-10">
      <div className="grain-overlay absolute inset-0 opacity-35" />
      <div className="mx-auto grid min-h-screen max-w-6xl gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="relative flex flex-col justify-between rounded-[34px] border border-[color:var(--line)] bg-[color:var(--panel)] p-7 shadow-[var(--shadow)] backdrop-blur-xl">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-white/80 px-4 py-2 text-sm font-semibold transition hover:bg-white"
            >
              <ChevronLeft className="h-4 w-4" />
              返回首页
            </Link>

            <div className="mt-10 space-y-5">
              <p className="text-sm uppercase tracking-[0.3em] text-[color:var(--muted)]">
                Step 1
              </p>
              <h1 className="font-serif text-5xl leading-tight">
                先把翻译引擎
                <br />
                接起来。
              </h1>
              <p className="max-w-xl text-base leading-7 text-[color:var(--muted)]">
                上传、分块、翻译、阅读，这四个模块都依赖同一份模型配置。
                所以第一步最合理的切入点就是设置模块。我们先把 API Key、
                Base URL 和模型名稳定地保存在本地。
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/library"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
                >
                  继续导入书籍
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {principles.map(({ title, description, icon: Icon }) => (
              <div
                key={title}
                className="rounded-[24px] border border-[color:var(--line)] bg-white/72 p-5"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{title}</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      {description}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            <div className="rounded-[24px] border border-dashed border-[color:var(--line)] bg-white/55 p-5 text-sm leading-6 text-[color:var(--muted)]">
              本阶段先使用 `localStorage` 保存配置。
              等上传模块和书籍持久化开始做时，再引入 IndexedDB 存书籍、章节和翻译结果。
            </div>
          </div>
        </section>

        <section className="relative py-1">
          <SettingsForm />
        </section>
      </div>
    </main>
  );
}
