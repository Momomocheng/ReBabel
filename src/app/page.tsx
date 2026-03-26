import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  KeyRound,
  Languages,
  PanelsTopLeft,
} from "lucide-react";

const steps = [
  {
    title: "设置模型与 API Key",
    description: "先完成 BYOK 配置，把 Base URL、模型名和密钥保存在当前浏览器。",
    icon: KeyRound,
    status: "done",
  },
  {
    title: "上传英文纯文本",
    description: "MVP 先支持 .txt，后续再接 EPUB 解析。",
    icon: BookOpenText,
    status: "done",
  },
  {
    title: "按段落分块翻译",
    description: "为每个 chunk 携带必要上下文，保证译文一致性。",
    icon: Languages,
    status: "done",
  },
  {
    title: "双栏对照阅读",
    description: "英文原文与中文译文段落对齐，同步滚动阅读。",
    icon: PanelsTopLeft,
    status: "active",
  },
];

export default function Home() {
  return (
    <main className="relative overflow-hidden">
      <div className="grain-overlay absolute inset-0 opacity-40" />
      <div className="absolute top-12 right-[8%] h-40 w-40 rounded-full bg-[color:var(--accent-soft)] blur-3xl" />
      <div className="absolute left-[6%] bottom-16 h-56 w-56 rounded-full bg-white/45 blur-3xl" />

      <section className="mx-auto flex min-h-screen max-w-6xl flex-col justify-between px-6 py-8 lg:px-10">
        <header className="flex items-center justify-between rounded-full border border-[color:var(--line)] bg-white/55 px-5 py-3 backdrop-blur-md">
          <div>
            <p className="font-serif text-xl tracking-wide">ReBabel 焕译</p>
            <p className="text-xs text-[color:var(--muted)]">
              AI 重译与双语阅读
            </p>
          </div>
          <Link
            href="/library"
            className="inline-flex items-center gap-2 rounded-full bg-[color:var(--foreground)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
          >
            进入书库
            <ArrowRight className="h-4 w-4" />
          </Link>
        </header>

        <div className="grid items-end gap-10 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-white/70 px-4 py-2 text-sm text-[color:var(--muted)] backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-[color:var(--accent)]" />
              翻译链路已就绪，继续打通双栏阅读
            </div>

            <div className="space-y-5">
              <h1 className="max-w-4xl font-serif text-5xl leading-[1.05] tracking-tight text-[color:var(--foreground)] md:text-7xl">
                别让糟糕的翻译，
                <br />
                毁了一本好书。
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-[color:var(--muted)] md:text-xl">
                ReBabel 现在已经具备从导入、翻译到本地持久化的完整链路，接下来就是把这些段落真正组织成可读的双语阅读界面。
                你可以直接进入书库继续翻译，也可以打开阅读器查看中英对照效果。
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/reader"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--accent)] px-6 py-3 text-sm font-semibold text-white shadow-[var(--shadow)] transition hover:bg-[color:var(--accent-strong)]"
              >
                打开阅读器
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/library"
                className="inline-flex items-center justify-center rounded-full border border-[color:var(--line)] bg-white/70 px-6 py-3 text-sm font-semibold text-[color:var(--foreground)] backdrop-blur transition hover:bg-white"
              >
                查看书库与翻译
              </Link>
            </div>
          </div>

          <div className="rounded-[32px] border border-[color:var(--line)] bg-[color:var(--panel)] p-6 shadow-[var(--shadow)] backdrop-blur-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.28em] text-[color:var(--muted)]">
                  MVP Roadmap
                </p>
                <p className="mt-2 font-serif text-3xl">我们就按这个顺序做</p>
              </div>
              <div className="rounded-full border border-[color:var(--line)] bg-white/80 px-3 py-1 text-xs font-semibold text-[color:var(--accent-strong)]">
                Step 4 Active
              </div>
            </div>

            <div id="roadmap" className="space-y-3">
              {steps.map(({ title, description, icon: Icon, status }) => (
                <div
                  key={title}
                  className="flex gap-4 rounded-[24px] border border-[color:var(--line)] bg-white/72 p-4 transition hover:bg-white"
                >
                  <div
                    className={`mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                      status === "active"
                        ? "bg-[color:var(--accent)] text-white"
                        : status === "done"
                          ? "bg-[color:var(--foreground)] text-white"
                          : "bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-base font-semibold">{title}</p>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">
                      {description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="grid gap-4 border-t border-[color:var(--line)] py-6 text-sm text-[color:var(--muted)] lg:grid-cols-3">
          <p>数据策略：书籍内容与 API Key 默认只保存在本地浏览器。</p>
          <p>技术基线：Next.js App Router、TypeScript、Tailwind CSS、Zustand、IndexedDB。</p>
          <p>当前起点：双栏对照阅读，以及后续的阅读位置与批注能力。</p>
        </footer>
      </section>
    </main>
  );
}
