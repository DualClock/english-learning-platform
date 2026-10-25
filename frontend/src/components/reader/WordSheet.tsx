'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { variants } from '@/lib/motion';
import {
  CheckIcon,
  CloseIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  VolumeIcon,
} from '@/components/ui/icons';
import Button from '@/components/ui/Button';
import { Tag } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/LoadingState';
import { useTts } from '@/hooks/useTts';
import {
  getWordLookup,
  translateSentence,
  translateWord,
  type UpsertPocketPayload,
} from '@/lib/reader/api';
import type { ReaderPocketItem } from '@/lib/reader/types';

interface Props {
  bookId: number;
  token?: string;
  word: string;
  sentence: string;
  chapterId: string;
  sentenceId: string;
  onClose: () => void;
  onSavePocket: (payload: UpsertPocketPayload) => Promise<ReaderPocketItem | null>;
  onPromotePocket: (pocketId: number) => Promise<boolean>;
  onMarkKnown: (pocketId: number) => Promise<boolean>;
  onDeletePocket: (pocketId: number) => Promise<boolean>;
  onPocketChanged: () => void;
}

type PocketState = 'saving' | 'saved' | 'delayed' | 'error';
type ActionState = 'idle' | 'working' | 'promoted' | 'known';

export default function WordSheet({
  bookId,
  token,
  word,
  sentence,
  chapterId,
  sentenceId,
  onClose,
  onSavePocket,
  onPromotePocket,
  onMarkKnown,
  onDeletePocket,
  onPocketChanged,
}: Props) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [partOfSpeech, setPartOfSpeech] = useState<string | null>(null);
  const [cefrLevel, setCefrLevel] = useState<string | null>(null);
  const [sentenceTranslation, setSentenceTranslation] = useState<string | null>(null);
  const [translationLoading, setTranslationLoading] = useState(true);
  const [sentenceLoading, setSentenceLoading] = useState(true);
  const [pocketItem, setPocketItem] = useState<ReaderPocketItem | null>(null);
  const [pocketState, setPocketState] = useState<PocketState>('saving');
  const [actionState, setActionState] = useState<ActionState>('idle');
  const [actionError, setActionError] = useState('');
  const latestWordRef = useRef(word);
  const latestSummaryRef = useRef<{ translation: string | null; partOfSpeech: string | null }>({
    translation: null,
    partOfSpeech: null,
  });
  const pocketItemRef = useRef<ReaderPocketItem | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const { speak } = useTts();

  latestWordRef.current = word;

  const savePocket = useCallback(
    (summary: { translation: string | null; partOfSpeech: string | null }) => {
      // Два сохранения одного слова (сразу и после перевода) не должны
      // обгонять друг друга: второй запрос — это обновление, а не гонка.
      const run = async () => {
        const item = await onSavePocket({
          word,
          chapterId,
          sentenceId,
          translation: summary.translation,
          partOfSpeech: summary.partOfSpeech,
        });

        if (latestWordRef.current !== word) return;
        if (item) {
          pocketItemRef.current = item;
          setPocketItem(item);
          setPocketState('saved');
        } else if (!pocketItemRef.current) {
          setPocketState('delayed');
        }
      };

      saveChainRef.current = saveChainRef.current.then(run, run);
      return saveChainRef.current;
    },
    [chapterId, onSavePocket, sentenceId, word]
  );

  useEffect(() => {
    latestWordRef.current = word;
    latestSummaryRef.current = { translation: null, partOfSpeech: null };
    setTranslation(null);
    setPartOfSpeech(null);
    setCefrLevel(null);
    setSentenceTranslation(null);
    setTranslationLoading(true);
    setSentenceLoading(true);
    pocketItemRef.current = null;
    setPocketItem(null);
    setPocketState('saving');
    setActionState('idle');
    setActionError('');

    if (!token) {
      setTranslationLoading(false);
      setSentenceLoading(false);
      setPocketState('error');
      return;
    }

    // Слово сохраняем сразу, не дожидаясь перевода: сервер уже умеет
    // подставить словарное значение, а сеть может ответить позже.
    void savePocket({ translation: null, partOfSpeech: null });

    let cancelled = false;

    const loadWord = async () => {
      let finalTranslation: string | null = null;
      let finalPart: string | null = null;

      try {
        const lookup = await getWordLookup(bookId, word, token);
        if (cancelled) return;

        setCefrLevel(lookup.cefrLevel ?? null);
        finalTranslation = lookup.translationRu || lookup.translation || null;
        finalPart = lookup.partOfSpeech ?? null;
      } catch {
        // справочник не ответил — ниже попробуем бесплатный перевод
      }

      if (!finalTranslation && !cancelled) {
        try {
          const ai = await translateWord(word, token);
          if (cancelled) return;
          finalTranslation = ai.translation || ai.translationRu || null;
          finalPart = finalPart || ai.partOfSpeech || null;
        } catch {
          // без быстрого перевода карточка всё равно покажет фразу
        }
      }

      if (cancelled) return;
      setTranslation(finalTranslation);
      setPartOfSpeech(finalPart);
      latestSummaryRef.current = {
        translation: finalTranslation,
        partOfSpeech: finalPart,
      };
      setTranslationLoading(false);

      if (finalTranslation) {
        void savePocket({ translation: finalTranslation, partOfSpeech: finalPart });
      }
    };

    const loadSentence = async () => {
      if (!sentence.trim()) {
        setSentenceLoading(false);
        return;
      }

      try {
        const result = await translateSentence(sentence, token);
        if (!cancelled) setSentenceTranslation(result.translation);
      } catch {
        // перевод фразы — необязательная помощь, не блокируем карточку
      } finally {
        if (!cancelled) setSentenceLoading(false);
      }
    };

    void loadWord();
    void loadSentence();

    return () => {
      cancelled = true;
    };
  }, [bookId, savePocket, sentence, token, word]);

  const retryPocket = async () => {
    setPocketState('saving');
    await savePocket(latestSummaryRef.current);
  };

  const promote = async () => {
    if (!pocketItem || actionState === 'working') return;
    setActionState('working');
    setActionError('');
    const ok = await onPromotePocket(pocketItem.id);
    if (ok) {
      setActionState('promoted');
      onPocketChanged();
    } else {
      setActionState('idle');
      setActionError('Не удалось добавить слово. Попробуйте ещё раз.');
    }
  };

  const markKnown = async () => {
    if (!pocketItem || actionState === 'working') return;
    setActionState('working');
    setActionError('');
    const ok = await onMarkKnown(pocketItem.id);
    if (ok) {
      setActionState('known');
      onPocketChanged();
    } else {
      setActionState('idle');
      setActionError('Не удалось отметить слово. Попробуйте ещё раз.');
    }
  };

  const remove = async () => {
    if (!pocketItem) {
      onClose();
      return;
    }
    const ok = await onDeletePocket(pocketItem.id);
    if (ok) {
      onPocketChanged();
      onClose();
    } else {
      setActionError('Не удалось убрать слово. Попробуйте ещё раз.');
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="scrim"
        className="fixed inset-0 z-40 bg-scrim lg:bg-transparent"
        variants={variants.overlay}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.section
        key="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Слово ${word}`}
        className="fixed inset-x-3 bottom-3 z-50 max-h-[80dvh] overflow-y-auto rounded-2xl border border-[var(--reader-hairline)] bg-[var(--reader-paper)] text-[var(--reader-ink)] shadow-modal
                   md:inset-x-auto md:bottom-auto md:right-6 md:top-20 md:w-[380px]"
        variants={variants.sheet}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 md:pb-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-caption font-semibold uppercase tracking-[0.16em] text-[var(--reader-ink-soft)]">
              Слово
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть карточку слова"
              className="rounded p-1 text-[var(--reader-ink-soft)] transition-colors hover:bg-[var(--reader-wash)] hover:text-[var(--reader-ink)]"
            >
              <CloseIcon size={20} />
            </button>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words font-reading text-[2rem] leading-tight">{word}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {partOfSpeech ? (
                  <span className="text-caption uppercase tracking-[0.12em] text-[var(--reader-ink-soft)]">
                    {partOfSpeech}
                  </span>
                ) : null}
                {cefrLevel ? <Tag tone="success">{cefrLevel}</Tag> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => speak(word)}
              aria-label={`Произнести ${word}`}
              title="Произнести"
              className="shrink-0 rounded p-2 text-[var(--reader-ink-soft)] transition-colors hover:bg-[var(--reader-wash)] hover:text-primary"
            >
              <VolumeIcon size={20} />
            </button>
          </div>

          <div className="mt-4 min-h-[2.25rem]">
            {translationLoading ? (
              <div className="space-y-2" role="status" aria-label="Переводим слово">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ) : translation ? (
              <p className="font-reading text-[1.3rem] font-medium leading-snug text-primary">
                {translation}
              </p>
            ) : (
              <p className="text-body-sm text-[var(--reader-ink-soft)]">
                Перевод не нашёлся — попробуйте открыть слово ещё раз.
              </p>
            )}
          </div>

          <div className="mt-5 rounded-lg border border-[var(--reader-hairline)] bg-[var(--reader-wash)] p-3.5">
            <div className="flex items-start justify-between gap-2">
              <p className="font-reading text-body-sm leading-relaxed text-[var(--reader-ink)]">
                {sentence}
              </p>
              <button
                type="button"
                onClick={() => speak(sentence)}
                aria-label="Произнести предложение"
                className="shrink-0 rounded p-1 text-[var(--reader-ink-soft)] hover:text-primary"
              >
                <VolumeIcon size={16} />
              </button>
            </div>
            <div className="mt-2 min-h-[1.25rem] text-body-sm leading-relaxed text-[var(--reader-ink-soft)]">
              {sentenceLoading ? (
                <Skeleton className="h-3 w-4/5" />
              ) : sentenceTranslation ? (
                sentenceTranslation
              ) : (
                <span className="italic">перевод фразы недоступен</span>
              )}
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <Button
              variant={actionState === 'promoted' ? 'secondary' : 'primary'}
              onClick={() => void promote()}
              disabled={!pocketItem || actionState === 'working' || actionState === 'promoted' || actionState === 'known'}
              className="w-full"
            >
              {actionState === 'promoted' ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
              {actionState === 'promoted' ? 'В словаре' : 'В словарь'}
            </Button>

            <Button
              variant={actionState === 'known' ? 'secondary' : 'ghost'}
              onClick={() => void markKnown()}
              disabled={!pocketItem || actionState === 'working' || actionState === 'promoted' || actionState === 'known'}
              className="w-full border border-[var(--reader-hairline)]"
            >
              <StarIcon size={16} />
              {actionState === 'known' ? 'Знакомое слово' : 'Уже знаю'}
            </Button>

            <Button
              variant="ghost"
              onClick={() => void remove()}
              disabled={actionState === 'working'}
              className="w-full text-[var(--reader-ink-soft)]"
            >
              <TrashIcon size={16} />
              Убрать из кармана
            </Button>
          </div>

          {actionError ? (
            <p className="mt-3 text-caption leading-snug text-danger" role="alert">
              {actionError}
            </p>
          ) : null}

          <div className="mt-4 text-caption text-[var(--reader-ink-soft)]">
            {pocketState === 'saving' ? (
              <span>Сохраняю в карман…</span>
            ) : pocketState === 'saved' ? (
              <span className="inline-flex items-center gap-1.5">
                <CheckIcon size={16} /> В кармане
              </span>
            ) : pocketState === 'delayed' ? (
              <button type="button" onClick={() => void retryPocket()} className="underline underline-offset-2">
                Сохраним, когда появится связь
              </button>
            ) : (
              <span>Без кармана: слово не сохранится</span>
            )}
          </div>
        </div>
      </motion.section>
    </AnimatePresence>
  );
}
