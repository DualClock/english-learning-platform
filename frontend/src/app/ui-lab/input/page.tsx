"use client";

import { useState } from "react";
import { PromptInput } from "@/components/ui/ai-chat-input";

interface Submission {
  id: number;
  text: string;
  model: string;
  effort: string;
  files: string[];
}

/**
 * Витрина PromptInput: показывает не только внешний вид, но и то, что
 * компонент реально отдаёт наружу — текст, модель, усилие и файлы.
 */
export default function InputLabPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  const handleSubmit = (
    text: string,
    meta: { model: string; effort: string; attachments: File[] }
  ) => {
    setSubmissions((prev) => [
      ...prev,
      {
        id: Date.now(),
        text,
        model: meta.model,
        effort: meta.effort,
        files: meta.attachments.map((file) => file.name),
      },
    ]);
  };

  return (
    <main className="min-h-screen bg-surface px-5 py-12 sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <header>
          <p className="text-caption font-semibold uppercase tracking-[0.18em] text-primary">UI Lab</p>
          <h1 className="mt-2 text-h1 text-ink">Поле ввода для Alex</h1>
          <p className="mt-2 max-w-measure text-body-sm text-slate">
            Свёрнутая пилюля разворачивается в карточку: вложения, выбор модели,
            усилие ответа и голосовой ввод. Enter отправляет, Shift+Enter переносит строку.
          </p>
        </header>

        <section aria-label="Поле ввода" className="mt-8 flex justify-center rounded-xl border border-hairline bg-surface px-4 py-10 shadow-soft">
          <PromptInput
            models={["Alex"]}
            efforts={["Коротко", "Обычно", "Подробно"]}
            placeholder="Спросите Alex о грамматике"
            onSubmit={handleSubmit}
          />
        </section>

        <section aria-label="Отправленные сообщения" className="mt-10">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-h3 text-ink">Отправленные сообщения</h2>
            <span className="text-caption text-slate">{submissions.length}</span>
          </div>

          {submissions.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-hairline px-5 py-8 text-center text-body-sm text-slate">
              Пока пусто. Отправьте сообщение — оно появится здесь вместе с моделью,
              усилием и именами файлов.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {submissions.map((item) => (
                <li
                  key={item.id}
                  className="animate-rise-in rounded-lg border border-hairline bg-canvas p-4 shadow-soft"
                >
                  <p className="whitespace-pre-wrap break-words text-body-sm text-ink">{item.text}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-caption text-slate">
                    <span className="rounded-full bg-surface px-2.5 py-1">Модель: {item.model}</span>
                    <span className="rounded-full bg-surface px-2.5 py-1">Усилие: {item.effort}</span>
                    <span className="rounded-full bg-surface px-2.5 py-1">
                      Файлы: {item.files.length > 0 ? item.files.join(", ") : "нет"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
