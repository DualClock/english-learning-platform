'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import LevelChip from '@/components/ui/LevelChip';
import ProgressBar from '@/components/ui/ProgressBar';
import { BookOpenIcon, CheckIcon, PlusIcon, VolumeIcon } from '@/components/ui/icons';
import { useSpeech } from '@/hooks/useSpeech';
import { transition, variants } from '@/lib/motion';

type WordKey = 'tired' | 'bank' | 'conversations';

interface WordEntry {
  text: string;
  ipa: string;
  partOfSpeech: string;
  translation: string;
  context: string;
}

const WORDS: Record<WordKey, WordEntry> = {
  tired: {
    text: 'tired',
    ipa: '/ˈtaɪəd/',
    partOfSpeech: 'прилагательное',
    translation: 'усталый, уставший',
    context: 'get tired of — устать от чего-то',
  },
  bank: {
    text: 'bank',
    ipa: '/bæŋk/',
    partOfSpeech: 'существительное',
    translation: 'берег',
    context: 'bank of the river — берег реки',
  },
  conversations: {
    text: 'conversations',
    ipa: '/ˌkɒnvəˈseɪʃənz/',
    partOfSpeech: 'существительное',
    translation: 'разговоры',
    context: 'conversation — разговор, беседа',
  },
};

interface WordButtonProps {
  wordKey: WordKey;
  isActive: boolean;
  onSelect: (key: WordKey) => void;
}

function WordButton({ wordKey, isActive, onSelect }: WordButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(wordKey)}
      aria-pressed={isActive}
      aria-controls="reader-definition"
      className={`-mx-0.5 rounded-sm px-0.5 transition-colors duration-fast ease-soft ${
        isActive
          ? 'bg-primary text-on-primary'
          : 'bg-surface-highlight text-ink hover:bg-tint-yellow-bold'
      }`}
    >
      {WORDS[wordKey].text}
    </button>
  );
}

export default function ReaderDemo() {
  const [activeKey, setActiveKey] = useState<WordKey>('tired');
  const [savedKeys, setSavedKeys] = useState<WordKey[]>([]);
  const { speak } = useSpeech();

  const activeWord = WORDS[activeKey];
  const isSaved = savedKeys.includes(activeKey);

  const saveWord = () => {
    if (isSaved) return;
    setSavedKeys((current) => [...current, activeKey]);
  };

  return (
    <div className="relative">
      <div data-ui className="relative rounded-xl bg-canvas p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-caption text-charcoal">
            <BookOpenIcon size={16} aria-hidden />
            Alice in Wonderland
          </span>
          <LevelChip level="A2" />
        </div>

        <p lang="en" className="mt-5 font-reading text-reading text-ink">
          Alice was beginning to get very{' '}
          <WordButton
            wordKey="tired"
            isActive={activeKey === 'tired'}
            onSelect={setActiveKey}
          />{' '}
          of sitting by her sister on the{' '}
          <WordButton wordKey="bank" isActive={activeKey === 'bank'} onSelect={setActiveKey} />
          , and of having nothing to do: once or twice she had peeped into the book her sister
          was reading, but it had no pictures or{' '}
          <WordButton
            wordKey="conversations"
            isActive={activeKey === 'conversations'}
            onSelect={setActiveKey}
          />{' '}
          in it.
        </p>

        <div className="mt-6 flex items-center justify-between gap-4 text-caption text-slate">
          <span>Глава 1</span>
          <span className="flex items-center gap-3">
            <span className="tabular-nums">12%</span>
            <ProgressBar value={12} label="Прогресс главы" className="w-20" />
          </span>
        </div>
      </div>

      <div data-ui className="relative z-10 -mt-5 sm:ml-10">
        <div className="rounded-xl bg-surface-accent p-5">
          <div id="reader-definition" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeKey}
                variants={variants.fadeOnly}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-h1 text-ink">{activeWord.text}</p>
                    <p className="mt-1 text-caption text-charcoal">
                      {activeWord.ipa} · {activeWord.partOfSpeech}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => speak(activeWord.text)}
                    aria-label={`Произнести ${activeWord.text}`}
                    className="mt-1 rounded-md p-2 text-charcoal transition-colors duration-fast ease-soft hover:bg-canvas hover:text-ink"
                  >
                    <VolumeIcon size={20} aria-hidden />
                  </button>
                </div>

                <p className="mt-3 text-h3 text-ink">{activeWord.translation}</p>
                <p className="mt-1 min-h-12 text-body-sm text-charcoal">{activeWord.context}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="mt-4 flex min-h-8 flex-wrap items-center gap-1.5">
            {savedKeys.length === 0 ? (
              <span className="text-caption text-charcoal">
                Сохранённые слова появятся здесь
              </span>
            ) : (
              savedKeys.map((key) => (
                <motion.span
                  key={key}
                  layout
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={transition.fast}
                  className="rounded-full bg-canvas px-2.5 py-1 text-caption text-ink"
                >
                  {WORDS[key].text}
                </motion.span>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={saveWord}
            aria-disabled={isSaved || undefined}
            className={
              isSaved
                ? 'mt-2 inline-flex w-full cursor-default items-center justify-center gap-2 rounded-md bg-surface-success px-4 py-2.5 text-body-sm font-medium text-on-success'
                : 'btn-primary mt-2 w-full'
            }
          >
            {isSaved ? <CheckIcon size={16} aria-hidden /> : <PlusIcon size={16} aria-hidden />}
            {isSaved ? 'В словаре' : 'В словарь'}
          </button>
        </div>
      </div>

      <p className="mt-4 text-caption text-charcoal">
        Демо читалки. Нажми на слово в тексте.
      </p>
    </div>
  );
}
