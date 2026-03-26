import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, Database, FileUp, Split } from "lucide-react";
import { LibraryWorkspace } from "@/components/library/library-workspace";

const principles = [
  {
    title: "本地书库",
    description: "书籍原文与后续翻译结果都保存在浏览器本地，适合 GitHub Pages 托管。",
    icon: Database,
  },
  {
    title: "TXT / EPUB 导入",
    description: "纯文本和 EPUB 都在浏览器本地解析，尽快把书籍导入、切段和保存链路跑通。",
    icon: FileUp,
  },
  {
    title: "段落切分",
    description: "当前按空行拆段，后面再补更细的 chunking 策略与上下文拼接。",
    icon: Split,
  },
];

function LibraryFallback() {
  return (
    <div className="rounded-[34px] border border-[color:var(--line)] bg-[color:var(--panel-strong)]/90 p-7 text-sm text-[color:var(--muted)] shadow-[var(--shadow)] backdrop-blur-xl">
      正在读取书库数据...
    </div>
  );
}

export default function LibraryPage() {
  return (
    <main className="relative overflow-hidden px-6 py-8 lg:px-10">
      <div className="grain-overlay absolute inset-0 opacity-35" />
      <div className="mx-auto max-w-6xl">
        <section className="mb-8 rounded-[34px] border border-[color:var(--line)] bg-[color:var(--panel)] p-7 shadow-[var(--shadow)] backdrop-blur-xl">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-white/80 px-4 py-2 text-sm font-semibold transition hover:bg-white"
              >
                <ChevronLeft className="h-4 w-4" />
                返回首页
              </Link>

              <div className="mt-8 space-y-4">
                <p className="text-sm uppercase tracking-[0.3em] text-[color:var(--muted)]">
                  Step 2 & 3
                </p>
                <h1 className="font-serif text-5xl leading-tight">
                  把书放进来，
                  <br />
                  继续把译文跑出来。
                </h1>
                <p className="max-w-2xl text-base leading-7 text-[color:var(--muted)]">
                  这一页现在同时承担两件事：先导入英文 `.txt` 或 `.epub`，按段落拆开存入 IndexedDB，
                  再用你自己的兼容 API 逐段生成中文译文。这样后面的阅读器就可以直接消费同一份本地数据。
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {principles.map(({ title, description, icon: Icon }) => (
                <div
                  key={title}
                  className="rounded-[24px] border border-[color:var(--line)] bg-white/72 p-4"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="mt-4 text-base font-semibold">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Suspense fallback={<LibraryFallback />}>
          <LibraryWorkspace />
        </Suspense>
      </div>
    </main>
  );
}
