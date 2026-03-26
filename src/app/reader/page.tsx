import Link from "next/link";
import { Suspense } from "react";
import { BookOpen, ChevronLeft, Languages, ScrollText } from "lucide-react";
import { ReaderWorkspace } from "@/components/reader/reader-workspace";

const principles = [
  {
    title: "段落对齐",
    description: "每一行固定对应一个段落，英文和中文天然保持同步。",
    icon: Languages,
  },
  {
    title: "沉浸阅读",
    description: "阅读器直接消费本地书库，不依赖任何服务端渲染。",
    icon: BookOpen,
  },
  {
    title: "继续迭代",
    description: "后续可以在这里继续接阅读位置、批注和术语表。",
    icon: ScrollText,
  },
];

function ReaderFallback() {
  return (
    <div className="rounded-[34px] border border-[color:var(--line)] bg-[color:var(--panel-strong)]/90 p-7 text-sm text-[color:var(--muted)] shadow-[var(--shadow)] backdrop-blur-xl">
      正在读取阅读器数据...
    </div>
  );
}

export default function ReaderPage() {
  return (
    <main className="relative overflow-hidden px-6 py-8 lg:px-10">
      <div className="grain-overlay absolute inset-0 opacity-35" />
      <div className="mx-auto max-w-7xl">
        <section className="mb-8 rounded-[34px] border border-[color:var(--line)] bg-[color:var(--panel)] p-7 shadow-[var(--shadow)] backdrop-blur-xl">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <Link
                href="/library"
                className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-white/80 px-4 py-2 text-sm font-semibold transition hover:bg-white"
              >
                <ChevronLeft className="h-4 w-4" />
                返回书库
              </Link>

              <div className="mt-8 space-y-4">
                <p className="text-sm uppercase tracking-[0.3em] text-[color:var(--muted)]">
                  Step 4
                </p>
                <h1 className="font-serif text-5xl leading-tight">
                  终于可以把原文和译文，
                  <br />
                  放在一起读了。
                </h1>
                <p className="max-w-2xl text-base leading-7 text-[color:var(--muted)]">
                  这就是 ReBabel 的阅读层。书库页负责导入和翻译，这一页负责把段落级数据组织成可读的中英对照界面。
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

        <Suspense fallback={<ReaderFallback />}>
          <ReaderWorkspace />
        </Suspense>
      </div>
    </main>
  );
}
