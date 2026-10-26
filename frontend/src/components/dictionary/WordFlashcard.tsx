'use client';

import { SpinnerIcon, VolumeIcon } from '@/components/ui/icons';
import { useTts } from '@/hooks/useTts';
import WordIllustration from './WordIllustration';

export interface FlashcardWord {
  english: string;
  translation: string;
  transcription?: string;
  example?: string;
  /** Перевод примера из справочника (R11). Мельче английского: читается как подсказка. */
  exampleRu?: string;
}

interface WordFlashcardProps {
  word: FlashcardWord;
  categorySlug: string;
  flipped: boolean;
  onFlip: () => void;
  /** Подсказка под карточкой: карточка ссылается на неё в aria-describedby. */
  hintId?: string;
}

/**
 * Бумажная карточка слова. Слово и перевод — две стороны одной кнопки, поэтому
 * переворот работает и мышью, и с клавиатуры, а фиксированное 4:5 не даёт
 * карточке менять высоту. Кнопка озвучки живёт рядом с переворотом, а не внутри:
 * вложенная кнопка открывала бы перевод при попытке услышать слово.
 */
export default function WordFlashcard({
  word,
  categorySlug,
  flipped,
  onFlip,
  hintId,
}: WordFlashcardProps) {
  const { speak, isLoading, isSpeaking } = useTts();

  return (
    <div className="flashcard-stack">
      <span className="flashcard-paper flashcard-paper-back" aria-hidden="true" />
      <span className="flashcard-paper flashcard-paper-middle" aria-hidden="true" />

      <div className="flashcard-card-shell">
        <button
          type="button"
          className={`flashcard-flipper${flipped ? ' is-flipped' : ''}`}
          onClick={onFlip}
          aria-pressed={flipped}
          aria-describedby={hintId}
        >
          <span className="flashcard-face flashcard-face-front" aria-hidden={flipped}>
            <span className="flashcard-art">
              <WordIllustration
                categorySlug={categorySlug}
                word={word.english}
                translation={word.translation}
                alt={word.english}
                size="lg"
                variant="bare"
                priority
                className="mix-blend-darken"
              />
            </span>
            <span className="flashcard-word" lang="en">
              {word.english}
            </span>
            {word.transcription && (
              <span className="flashcard-phonetic">{word.transcription}</span>
            )}
          </span>

          <span className="flashcard-face flashcard-face-back" aria-hidden={!flipped}>
            <span className="flashcard-back-label">Перевод</span>
            <span className="flashcard-translation">{word.translation}</span>
            {word.example && (
              <span className="flashcard-example" lang="en">
                «{word.example}»
              </span>
            )}
            {word.exampleRu && (
              <span className="flashcard-example-translation" lang="ru">
                {word.exampleRu}
              </span>
            )}
          </span>
        </button>

        <button
          type="button"
          className={`flashcard-sound${isSpeaking ? ' is-speaking' : ''}`}
          onClick={() => speak(word.english)}
          data-no-swipe
          aria-label={`Прослушать ${word.english}`}
          aria-busy={isLoading}
          title={isLoading ? 'Озвучиваем…' : 'Прослушать'}
        >
          {isLoading ? (
            <SpinnerIcon size={20} label="Озвучиваем" />
          ) : (
            <VolumeIcon size={24} />
          )}
        </button>
      </div>
    </div>
  );
}
