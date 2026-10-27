'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { wordAtPoint, type PointWord } from '@/lib/reader/wordAtPoint';
import { splitIntoSentences } from '@/lib/reader/sentences';
import { usePaginator } from '@/hooks/reader/usePaginator';
import type { ReaderAnchor } from '@/lib/reader/pagination';

type Theme = 'day' | 'sepia' | 'night';

interface LabSettings {
  fontSize: number;
  lineHeight: number;
  margin: number;
  theme: Theme;
}

type LabBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'listItem'; text: string }
  | { type: 'verse'; lines: string[] }
  | { type: 'separator' }
  | { type: 'image'; src: string; alt: string; caption: string; width: number; height: number };

const SETTINGS_KEY = 'reader_lab_settings_v1';
const ANCHOR_KEY = 'reader_lab_anchor_v1';

const DEFAULT_SETTINGS: LabSettings = {
  fontSize: 20,
  lineHeight: 1.8,
  margin: 8,
  theme: 'sepia',
};

const PARAGRAPHS = [
  `The lantern by the river was already burning when Mara reached the wooden bridge. She had walked for an hour through the wet fields, and her boots were heavy with mud. A thin rain moved over the water, turning the far bank into a soft grey shape. She stopped at the middle of the bridge and listened. Somewhere below, the river carried small stones against the piers, and the sound was steady, almost like breathing.`,
  `Mara took the folded letter from her pocket. The paper had softened at the edges, but the ink was still clear. "Meet me where the old ferry used to land," it said. There was no signature, only a small drawing of a bird with one wing raised. She had looked at that bird for three days and still did not know who had sent it.`,
  `A dog barked on the eastern bank. Then a light appeared between the trees, moving slowly toward the bridge. Mara stepped back into the shadow of the railing. She was not afraid, exactly; she was curious in the way that makes a person stand still when common sense says to go home.`,
  `The light belonged to a woman in a yellow coat. She carried a lantern in one hand and a canvas bag in the other, and she walked as if the muddy road were a ballroom floor. When she saw Mara, she smiled and raised the lantern. "You came," she said. "I hoped you would, but hope is not a very reliable arrangement."`,
  `"Who are you?" Mara asked. The woman put down the bag and opened it. Inside were dozens of letters, all folded the same way, all tied with the same red thread. "I am the person who writes to people who have lost something," she said. "The river keeps what it is given, but it sometimes returns what it was not asked to keep."`,
  `Mara wanted to laugh, but the woman's face was serious. "I have not lost anything," she said. The woman looked at the letter in Mara's hand. "Not yet," she said. "But you will, and when you do, you will remember this night. That is the whole trouble with important evenings. They arrive looking like ordinary ones."`,
  `They walked along the bank together. The rain grew lighter, then stopped. The woman told Mara about the ferry that had once crossed the river every morning, carrying farmers, schoolchildren, and one piano that nobody could explain. The ferryman had a rule: every passenger had to tell him one true thing before boarding. "It did not matter what the truth was," the woman said. "Only that it cost something to say."`,
  `"What was your true thing?" Mara asked. The woman was quiet for a moment. "That I was afraid of the water," she said. "I told him that every morning for eleven years." She laughed, and the sound moved across the river like a coin dropped into a well.`,
  `At the old landing, they found a wooden post and a bell with no rope. The woman rang it with the handle of her lantern. The note was low and clear. "The ferry will not come," she said. "But someone will hear. That is usually enough." She gave Mara one of the letters from her bag. It was addressed to a name Mara did not know, in a town she had never visited.`,
  `"Deliver it when you can," the woman said. "Not because it is urgent. Because it is a small thing that will make a large difference to one person. There are not many of those left." Then she picked up her bag and walked back toward the trees, her yellow coat growing smaller and darker until it was only a light among the branches.`,
  `Mara stood at the landing until the lantern disappeared. The river was black now, and the sky above it was the color of old silver. She put the letter in her pocket beside her own and began the walk home. The mud pulled at her boots, but she did not mind. For the first time in three days, she had a destination that felt larger than her own questions.`,
  `Years later, when people asked Mara how she became a letter carrier, she told them it began with a dog barking on the eastern bank. This was true, but it was not the whole truth. The whole truth cost something to say, and she was still learning how to pay.`,
];

function buildBlocks(): LabBlock[] {
  const blocks: LabBlock[] = [{ type: 'heading', text: 'The Lantern by the River' }];
  const parts = ['One', 'Two', 'Three', 'Four'];

  parts.forEach((part, partIndex) => {
    if (partIndex > 0) {
      blocks.push({ type: 'heading', text: `Part ${part}: The River Remembers` });
      blocks.push({
        type: 'paragraph',
        text: `The season had changed since the first night, but the river kept its old habit of returning the same questions. This part begins on the fourth page of the notebook, where the ink had smudged and someone had drawn a second bird beside the first.`,
      });
    }

    PARAGRAPHS.forEach((text, paragraphIndex) => {
      blocks.push({ type: 'paragraph', text });
      if (partIndex === 0 && paragraphIndex === 5) {
        blocks.push({
          type: 'image',
          src: '/words/nature/forest.webp',
          alt: 'Лес на другом берегу реки',
          caption: 'The far bank, where the lanterns were only lights among the branches.',
          width: 1024,
          height: 768,
        });
      }
      if (partIndex === 1 && paragraphIndex === 2) {
        blocks.push({
          type: 'quote',
          text: `"There are not many things left that cost something to say," the woman said. "A letter is one of them."`,
        });
      }
      if (partIndex === 1 && paragraphIndex === 4) {
        blocks.push({
          type: 'verse',
          lines: [
            'The ferry leaves at seven,',
            'the river keeps its own time,',
            'and every passenger carries',
            'one true thing across the water.',
          ],
        });
      }
      if (partIndex === 2 && paragraphIndex === 1) {
        blocks.push({
          type: 'listItem',
          text: 'The bell was hung above the landing on a Sunday morning, and it rang once for each person who had waited there.',
        });
        blocks.push({
          type: 'listItem',
          text: 'The letters were tied with red thread, but the thread was never the same color twice.',
        });
      }
    });
  });

  return blocks;
}

const BLOCKS = buildBlocks();

function blockSentences(block: LabBlock): string[] {
  if (block.type === 'image' || block.type === 'separator') return [];
  if (block.type === 'verse') return block.lines;
  return splitIntoSentences(block.text);
}

function LabTextBlock({ block, index }: { block: LabBlock; index: number }) {
  if (block.type === 'image') {
    return (
      <figure className="reader-block reader-figure" data-no-page-turn>
        <img
          src={block.src}
          alt={block.alt}
          width={block.width}
          height={block.height}
          draggable={false}
          loading="eager"
          style={{ aspectRatio: `${block.width} / ${block.height}` }}
        />
        <figcaption className="reader-figcaption">{block.caption}</figcaption>
      </figure>
    );
  }

  if (block.type === 'separator') {
    return <hr className="reader-block reader-separator" />;
  }

  const sentences = blockSentences(block);
  const content = sentences.map((sentence, sentenceIndex) => (
    <Fragment key={sentenceIndex}>
      <span data-s={`b${index}s${sentenceIndex}`}>{sentence}</span>
      {block.type === 'verse' ? '\n' : sentenceIndex < sentences.length - 1 ? ' ' : null}
    </Fragment>
  ));

  if (block.type === 'heading') {
    return <h2 className="reader-block reader-heading">{content}</h2>;
  }
  if (block.type === 'quote') {
    return <blockquote className="reader-block reader-quote">{content}</blockquote>;
  }
  if (block.type === 'listItem') {
    return <p className="reader-block reader-list-item">{content}</p>;
  }
  if (block.type === 'verse') {
    return <p className="reader-block reader-verse">{content}</p>;
  }

  return <p className="reader-block reader-paragraph">{content}</p>;
}

export default function ReaderLabPage() {
  const [settings, setSettings] = useState<LabSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [storedAnchor, setStoredAnchor] = useState<ReaderAnchor | null>(null);
  const [status, setStatus] = useState<{
    page: number;
    total: number;
    anchor: ReaderAnchor | null;
  }>({ page: 0, total: 1, anchor: null });
  const [picked, setPicked] = useState<PointWord | null>(null);
  const [pointerStart, setPointerStart] = useState<{ x: number; y: number } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const restoreAppliedRef = useRef(false);
  const storedAnchorRef = useRef<ReaderAnchor | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const layoutKey = `${settings.fontSize}|${settings.lineHeight}|${settings.margin}`;

  const handlePageChange = useCallback(
    (page: number, total: number, anchor: ReaderAnchor | null) => {
      setStatus({ page, total, anchor });
      if (!restoredRef.current || !anchor) return;

      // Первый layout после загрузки ещё не знает сохранённый якорь. Не даём
      // ему перетереть память нулевой страницей — ждём восстановления.
      if (storedAnchorRef.current && !restoreAppliedRef.current) {
        if (anchor.sentenceId !== storedAnchorRef.current.sentenceId) return;
        restoreAppliedRef.current = true;
      }

      try {
        window.localStorage.setItem(ANCHOR_KEY, JSON.stringify(anchor));
      } catch {
        // лаборатория переживёт и без памяти
      }
    },
    []
  );

  const paginator = usePaginator({
    viewportRef,
    flowRef,
    contentKey: 'reader-lab-v1',
    layoutKey,
    initialAnchor: storedAnchor,
    onPageChange: handlePageChange,
  });

  useEffect(() => {
    try {
      const rawSettings = window.localStorage.getItem(SETTINGS_KEY);
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings) as Partial<LabSettings>;
        setSettings((current) => ({
          ...current,
          ...parsed,
          theme:
            parsed.theme === 'day' || parsed.theme === 'sepia' || parsed.theme === 'night'
              ? parsed.theme
              : current.theme,
        }));
      }

      const rawAnchor = window.localStorage.getItem(ANCHOR_KEY);
      if (rawAnchor) {
        const parsed = JSON.parse(rawAnchor) as Partial<ReaderAnchor>;
        if (typeof parsed.sentenceId === 'string') {
          const anchor: ReaderAnchor = {
            sentenceId: parsed.sentenceId,
            charOffset: Number(parsed.charOffset) || 0,
          };
          storedAnchorRef.current = anchor;
          setStoredAnchor(anchor);
        }
      } else {
        restoreAppliedRef.current = true;
      }
    } catch {
      // local storage может быть недоступен
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // настройки не сохранятся — лаборатория всё равно работает
    }
  }, [settings, settingsLoaded]);

  useEffect(() => {
    if (restoredRef.current || !paginator.isReady) return;
    if (storedAnchor) {
      paginator.goToAnchor(storedAnchor);
    } else {
      restoreAppliedRef.current = true;
    }
    restoredRef.current = true;
  }, [paginator, storedAnchor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        paginator.nextPage();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        paginator.previousPage();
      } else if (event.key === 'Home') {
        event.preventDefault();
        paginator.goToPage(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        paginator.goToPage(paginator.totalPages - 1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paginator]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    setPointerStart({ x: event.clientX, y: event.clientY });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    setPointerStart(null);
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const selected = window.getSelection()?.toString().trim();

    if (!selected && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) paginator.nextPage();
      else paginator.previousPage();
      return;
    }

    if (selected || Math.abs(dx) > 10 || Math.abs(dy) > 10) return;

    const target = event.target as HTMLElement;
    if (target.closest('[data-no-page-turn]')) return;

    const word = wordAtPoint(event.clientX, event.clientY);
    if (word) {
      setPicked(word);
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    if (event.clientX < rect.left + rect.width * 0.15) {
      paginator.previousPage();
    } else if (event.clientX > rect.right - rect.width * 0.15) {
      paginator.nextPage();
    }
  };

  const stageStyle = {
    '--reader-size': `${settings.fontSize}px`,
    '--reader-leading': settings.lineHeight,
    '--reader-page-margin': `${settings.margin}%`,
  } as CSSProperties;

  const renderedBlocks = useMemo(
    () => BLOCKS.map((block, index) => <LabTextBlock key={index} block={block} index={index} />),
    []
  );

  const changeTheme = () => {
    setSettings((current) => ({
      ...current,
      theme: current.theme === 'sepia' ? 'day' : current.theme === 'day' ? 'night' : 'sepia',
    }));
  };

  const resetLab = () => {
    try {
      window.localStorage.removeItem(ANCHOR_KEY);
      window.localStorage.removeItem(SETTINGS_KEY);
    } catch {
      // ничего
    }
    window.location.reload();
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-canvas">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline-strong bg-canvas px-4 py-2 text-body-sm text-ink">
        <span className="font-heading font-semibold">Reader Lab</span>
        <span className="tabular-nums text-slate" aria-live="polite">
          {status.page + 1} / {status.total}
        </span>
        <span className="hidden max-w-[24ch] truncate text-caption text-slate sm:inline">
          anchor: {status.anchor ? `${status.anchor.sentenceId}:${status.anchor.charOffset}` : '—'}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <button
            type="button"
            className="icon-chip"
            onClick={() =>
              setSettings((current) => ({ ...current, fontSize: Math.max(17, current.fontSize - 1) }))
            }
            aria-label="Уменьшить кегль"
          >
            A−
          </button>
          <span className="w-12 text-center tabular-nums text-caption text-slate">{settings.fontSize}px</span>
          <button
            type="button"
            className="icon-chip"
            onClick={() =>
              setSettings((current) => ({ ...current, fontSize: Math.min(28, current.fontSize + 1) }))
            }
            aria-label="Увеличить кегль"
          >
            A+
          </button>

          <button
            type="button"
            className="icon-chip"
            onClick={() =>
              setSettings((current) => ({ ...current, margin: Math.max(4, current.margin - 1) }))
            }
            aria-label="Уменьшить поля"
          >
            ←→
          </button>
          <span className="w-10 text-center tabular-nums text-caption text-slate">{settings.margin}%</span>
          <button
            type="button"
            className="icon-chip"
            onClick={() =>
              setSettings((current) => ({ ...current, margin: Math.min(12, current.margin + 1) }))
            }
            aria-label="Увеличить поля"
          >
            →←
          </button>

          <button type="button" className="icon-chip" onClick={changeTheme}>
            {settings.theme}
          </button>
          <button type="button" className="icon-chip" onClick={resetLab}>
            Reset
          </button>
        </div>

        <div className="flex w-full items-center gap-2 text-caption text-slate">
          <button type="button" className="icon-chip" onClick={paginator.previousPage}>
            ←
          </button>
          <button type="button" className="icon-chip" onClick={paginator.nextPage}>
            →
          </button>
          <span className="min-w-0 truncate">
            {picked
              ? `${picked.word} · ${picked.sentenceId}:${picked.charOffset}`
              : 'Тапните слово или листайте свайпом'}
          </span>
          <span className="ml-auto shrink-0">{settings.theme}</span>
          <span className="shrink-0">{pointerStart ? '…' : 'ready'}</span>
        </div>
      </header>

      <main
        className="reader-stage min-h-0 flex-1"
        data-reader-theme={settings.theme}
        style={stageStyle}
      >
        <div className="reader-sheet">
          <div className="reader-page-pad">
            <div
              ref={viewportRef}
              className="reader-viewport"
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              style={{ touchAction: 'pan-y', opacity: paginator.isReady ? 1 : 0 }}
            >
              <div ref={flowRef} lang="en" className="reader-flow" aria-hidden={!paginator.isReady}>
                {renderedBlocks}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
