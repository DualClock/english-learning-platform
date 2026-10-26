'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpeech } from '@/hooks/useSpeech';
import { toProxyUrl } from '@/app/lib/proxy-path';
import Button from '@/components/ui/Button';
import { Tag } from '@/components/ui/Badge';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  HeadphonesIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  SpinnerIcon,
} from '@/components/ui/icons';
import {
  CHECK_MODES,
  DEFAULT_MODE,
  DEFAULT_RATE,
  LAST_STORY_KEY,
  PLAYBACK_RATES,
  RATE_STORAGE_KEY,
  activeSentenceAt,
  answerStatus,
  buildSentences,
  clampSentence,
  clickSentence,
  fallbackReasonLabel,
  formatRate,
  gapQuestion,
  isActive,
  isClozeComplete,
  moveCurrent,
  nextRate,
  normalizeMode,
  normalizeRate,
  paragraphBounds,
  parseLastStory,
  parsePosition,
  positionKey,
  primaryActionLabel,
  progressFraction,
  remainingLabel,
  seekTarget,
  sentenceTimings,
  serializeLanding,
  serializePosition,
  totalDuration,
  transition,
  type FallbackReason,
  type ListeningMode,
  type ListeningSentence,
  type PlaybackRate,
  type PlayerState,
} from '@/lib/listening';

export interface ListeningStory {
  /** Стабильный ключ рассказа в сиде: им же адресуется сохранённое место */
  id: string;
  title: string;
  author: string;
  cefrLevel: string;
  description: string;
  paragraphs: string[];
  /** Слова рассказа из словаря без повторов — из них делается пропуск слова */
  practiceWords?: PracticeWord[];
}

export interface PracticeWord {
  word: string;
  /** Русский перевод из сида (`categories.json`), не сгенерированный на клиенте */
  translation: string;
}

interface ListeningPlayerProps {
  stories: ListeningStory[];
}

type Engine = 'server' | 'browser';

/** Режим проверки понимания: слушать / вписать слово / сверить перевод. */
type Practice = 'listen' | 'gap' | 'translate';

const PRACTICE_LABEL: Record<Practice, string> = {
  listen: 'Слушать',
  gap: 'Вписать слово',
  translate: 'Перевод',
};

const PRACTICE_HINT: Record<Practice, string> = {
  listen: 'Слушайте и следите за подсветкой. Когда рассказ кончится, поменяйте способ проверки.',
  gap: 'Одно слово в предложении заменено пропуском. Включите предложение и найдите слово на слух.',
  translate: 'Сверьте, что вы услышали, с переводом предложения — он приходит с сервера проекта.',
};

/*
 * Настоящее аудирование: рассказ целиком, подсветка звучащего предложения,
 * скорость 0.75/1.0/1.25, режимы «весь рассказ» / «по предложению» и три
 * способа проверить, понял ли человек услышанное.
 *
 * Почему не useTts, хотя он уже есть: useTts умеет одно — произнести фразу по
 * клику. Он не отдаёт конец звука (браузерный путь снимает индикатор таймером от
 * длины строки), не знает скорости, не даёт позицию воспроизведения и не умеет
 * «продолжить с предложения N». Аудирование — это очередь предложений, поэтому
 * здесь свой маленький проигрыватель на одном <audio>: позиция берётся из
 * currentTime (точная подсветка), пауза и скорость — бесплатно.
 *
 * Откат на голос браузера остаётся, но теперь он честный: когда сервер молчит
 * или отказывает, играет системный голос, а над текстом висит бейдж «Базовая
 * озвучка» с причиной и кнопкой повтора серверной речи.
 *
 * Скорость на системном голосе: useSpeech не принимает rate и жёстко ставит
 * 0.9, поэтому браузерная фраза произносится здесь напрямую через то же
 * браузерное API — 1× даёт ровно тот же 0.9, а 0.75/1.25 работают как у
 * серверного звука. Правка хука записана как NEEDS: она уберёт дублирование,
 * но не добавляет возможностей.
 */

/** Окно ожидания серверного голоса — то же, что у useTts (замеры на проде 24.10). */
const SERVER_GRACE_MS = 6000;

/** Запас, чтобы не срезать последний слог при оценке конца фразы. */
const TAIL_MS = 180;

/** Темп Web Speech при 1×: тот же 0.9, что в useSpeech, чтобы 1× звучал одинаково. */
const BROWSER_BASE_RATE = 0.9;

const browserRate = (rate: PlaybackRate): number => Number((BROWSER_BASE_RATE * rate).toFixed(2));

/** Сколько звучит предложение в системном голосе — для страховочного таймера. */
function browserDurationSeconds(text: string, rate: PlaybackRate): number {
  return Math.max(1.2, text.length * 0.075) / rate;
}

export default function ListeningPlayer({ stories }: ListeningPlayerProps) {
  const [storyIndex, setStoryIndex] = useState(0);
  const story = stories[storyIndex];

  // Рассказы приезжают пропсом и пересоздаются при каждом рендере страницы.
  // Список предложений зависит от самих абзацев, а не от объекта рассказа:
  // иначе каждая копия рассказа давала бы новый массив предложений, новые
  // тайминги и новые зависимости callbacks — и звук обрывался бы посреди фразы.
  const paragraphs = story?.paragraphs;
  const sentences = useMemo<ListeningSentence[]>(
    () => buildSentences(paragraphs),
    [paragraphs],
  );
  const bounds = useMemo(() => paragraphBounds(sentences), [sentences]);
  const timings = useMemo(() => sentenceTimings(sentences), [sentences]);
  const total = totalDuration(timings);

  const [state, setState] = useState<PlayerState>('idle');
  const [current, setCurrent] = useState(0);
  const [rate, setRate] = useState<PlaybackRate>(DEFAULT_RATE);
  const [position, setPosition] = useState(0);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [fallback, setFallback] = useState<FallbackReason | null>(null);
  const [speechUnsupported, setSpeechUnsupported] = useState(false);
  const [mode, setMode] = useState<ListeningMode>(DEFAULT_MODE);
  const [practice, setPractice] = useState<Practice>('listen');

  // Проверка понимания привязана к номеру предложения: новый вопрос — новый
  // ответ, старый вердикт не должен «переезжать» на соседнее предложение.
  const [answer, setAnswer] = useState('');
  const [verdictSentence, setVerdictSentence] = useState<number | null>(null);

  // Переводы предложений приходят с сервера. Ключ — «рассказ:предложение»,
  // значение null — «сервер не ответил»: подставлять чужой вариант только чтобы
  // показать хоть что-то нельзя, это учит неправильному переводу.
  const [translations, setTranslations] = useState<Record<string, string | null>>({});
  const translationRequests = useRef(new Set<string>());

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const timersRef = useRef<number[]>([]);

  // Токен текущего воспроизведения: единственное, что отличает «звук этого
  // предложения» от «звук, пришедший с опозданием из прошлого».
  const tokenRef = useRef(0);
  // Синхронное зеркало движка: таймеру ожидания нельзя ждать ре-рендера.
  const engineRef = useRef<Engine | null>(null);
  // Продолжение очереди объявлено ниже, а нужно уже обработчику onended.
  const advanceRef = useRef<(index: number) => void>(() => undefined);

  const speech = useSpeech();

  // useSpeech возвращает новый объект на каждый рендер, а его stop/speak — новые
  // функции. Держать их в зависимостях нельзя: stopPlayback менялся бы каждый
  // рендер, эффект-очистка «уход со страницы» перезапускался бы на КАЖДОМ
  // рендере и в своём cleanup'е останавливал звук посреди фразы — так плеер
  // молча возвращался в idle и «не играл» вовсе.
  const speechRef = useRef(speech);
  useEffect(() => {
    speechRef.current = speech;
  }, [speech]);

  const isSpeechSupported = speech.isSupported;

  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
  }, []);

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.ontimeupdate = null;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    audioRef.current = null;

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  /**
   * Всё воспроизведение разом: новый токен обесценивает поздние ответы сети.
   *
   * `speech.stop()` вызывается только когда браузер умеет Web Speech: у
   * useSpeech.stop нет такой проверки (он всегда дёргает window.speechSynthesis),
   * а без API это исключение прерывало бы запуск серверного звука — плеер
   * оставался в idle и молчал. Правка хука не в моих файлах (см. NEEDS).
   */
  const stopPlayback = useCallback(() => {
    tokenRef.current += 1;
    clearTimers();
    releaseAudio();
    if (speechRef.current.isSupported) speechRef.current.stop();
    setEngine(null);
    setState('idle');
  }, [clearTimers, releaseAudio]);

  // Уход со страницы не должен оставить играющий звук.
  useEffect(() => () => stopPlayback(), [stopPlayback]);

  // Место в рассказе восстанавливается при смене рассказа; скорость — привычка,
  // поэтому берётся из сохранения места, а если места нет — из общего ключа.
  //
  // Ключ рассказа, а не объект: `story` пересоздаётся при каждом рендере страницы
  // (список приходит пропсом), и эффект с ним в зависимостях перезапускался бы
  // прямо во время звука — сбрасывая место и останавливая воспроизведение.
  const storyId = story?.id ?? '';

  useEffect(() => {
    setCurrent(0);
    setPosition(0);
    setAnswer('');
    setVerdictSentence(null);

    if (!storyId) return;

    try {
      const saved = parsePosition(window.localStorage.getItem(positionKey(storyId)), storyId);
      if (saved) {
        setCurrent(clampSentence(sentences.length, saved.sentence));
        setRate(saved.rate);
        return;
      }

      setRate(normalizeRate(window.localStorage.getItem(RATE_STORAGE_KEY)));
    } catch {
      // нет доступа к localStorage — начинаем сначала
    }
  }, [storyId, sentences.length]);

  // Последний рассказ восстанавливается один раз: localStorage недоступен на
  // сервере, и в первом HTML всегда первый рассказ списка.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || stories.length === 0) return;
    restoredRef.current = true;

    try {
      const savedId = parseLastStory(window.localStorage.getItem(LAST_STORY_KEY), stories.length);
      const index = stories.findIndex((item) => item.id === savedId);
      if (index > 0) setStoryIndex(index);
    } catch {
      // хранилище недоступно — открываем первый рассказ
    }
  }, [stories]);

  // Подсветка не должна уезжать за пределы экрана при автопереходе.
  useEffect(() => {
    if (!isActive(state)) return;

    document
      .querySelector('[data-listening-current="true"]')
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [current, state]);

  useEffect(() => {
    if (!storyId) return;

    try {
      window.localStorage.setItem(RATE_STORAGE_KEY, String(rate));
      window.localStorage.setItem(
        positionKey(storyId),
        serializePosition({ storyId, sentence: current, rate }),
      );
      window.localStorage.setItem(LAST_STORY_KEY, serializeLanding({ storyId }));
    } catch {
      // хранилище недоступно — плеер работает без сохранения
    }
  }, [storyId, current, rate]);

  /**
   * Системный голос. useSpeech не принимает скорость и всегда ставит 0.9,
   * поэтому фраза произносится здесь: 1× даёт тот же 0.9, а 0.75/1.25 — темп
   * ровно как у серверного звука (audio.playbackRate).
   */
  const playBrowserVoice = useCallback(
    (sentence: ListeningSentence, reason: FallbackReason, token: number) => {
      if (!isSpeechSupported) {
        setSpeechUnsupported(true);
        setState('idle');
        return;
      }

      setEngine('browser');
      setFallback(reason);
      speechRef.current.stop();

      const utterance = new SpeechSynthesisUtterance(sentence.text);
      utterance.lang = 'en-US';
      utterance.rate = browserRate(rate);
      utterance.pitch = 1;

      const finish = () => {
        if (token !== tokenRef.current) return;
        advanceRef.current(sentence.index);
      };

      // onend в Web Speech врёт не во всех браузерах (Chrome теряет событие на
      // длинных фразах), поэтому страховочный таймер нужен — но он делит время
      // на скорость: иначе на 0.75× следующее предложение начиналось бы раньше,
      // чем закончилось текущее.
      utterance.onend = finish;

      window.speechSynthesis.speak(utterance);
      setState('playing');

      const timer = window.setTimeout(finish, browserDurationSeconds(sentence.text, rate) * 1000 + TAIL_MS);
      timersRef.current.push(timer);
    },
    [isSpeechSupported, rate],
  );

  const startServerAudio = useCallback(
    async (sentence: ListeningSentence, token: number) => {
      const response = await fetch(
        toProxyUrl(`/api/audio/tts?text=${encodeURIComponent(sentence.text)}`),
      ).catch(() => null);

      if (token !== tokenRef.current) return;

      if (!response || !response.ok) {
        playBrowserVoice(sentence, response ? 'quota' : 'error', token);
        return;
      }

      const blob = await response.blob().catch(() => null);
      if (token !== tokenRef.current) return;

      if (!blob || blob.size === 0) {
        playBrowserVoice(sentence, 'error', token);
        return;
      }

      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;

      const audio = new Audio(url);
      audio.playbackRate = rate;
      audio.preload = 'auto';
      audioRef.current = audio;

      const base = timings[sentence.index]?.start ?? 0;

      audio.ontimeupdate = () => {
        // Время внутри предложения переводим в шкалу рассказа, чтобы полоса
        // прогресса и подсветка считались одной функцией по всему тексту.
        setPosition(base + (audio.currentTime || 0) / rate);
      };

      audio.onended = () => {
        if (token !== tokenRef.current) return;
        advanceRef.current(sentence.index);
      };

      audio.onerror = () => {
        if (token !== tokenRef.current) return;
        releaseAudio();
        playBrowserVoice(sentence, 'error', token);
      };

      setEngine('server');
      setFallback(null);
      setState((previous) => transition(previous, { type: 'loaded' }) ?? previous);

      try {
        await audio.play();
      } catch {
        // Автовоспроизведение заблокировал браузер — это не повод уходить на
        // системный голос: показываем паузу и ждём настоящего клика.
        if (token === tokenRef.current) setState('paused');
      }
    },
    [playBrowserVoice, rate, releaseAudio, timings],
  );

  const startSentence = useCallback(
    (index: number) => {
      const sentence = sentences[clampSentence(sentences.length, index)];
      if (!sentence) return;

      stopPlayback();
      setEngine(null);
      setFallback(null);
      setCurrent(sentence.index);
      setPosition(seekTarget(timings, sentence.index));

      // Токен берётся ПОСЛЕ stopPlayback: тот сам его увеличивает, и токен,
      // снятый до вызова, был бы уже устаревшим — первая же проверка
      // `token !== tokenRef.current` в startServerAudio отбрасывала ответ.
      const token = tokenRef.current;
      setState((previous) => transition(previous, { type: 'play' }) ?? previous);

      const pending = startServerAudio(sentence, token);

      const timer = window.setTimeout(() => {
        // Сервер молчит дольше окна ожидания: играем системным голосом, а
        // запрос оставляем жить — ответ ляжет в серверный кэш.
        if (token !== tokenRef.current || engineRef.current !== null) return;

        playBrowserVoice(sentence, 'timeout', token);
      }, SERVER_GRACE_MS);
      timersRef.current.push(timer);

      void pending;
    },
    [playBrowserVoice, sentences, startServerAudio, stopPlayback, timings],
  );

  /**
   * Конец предложения. В режиме «весь рассказ» очередь идёт дальше сама, в режиме
   * «по предложению» — останавливается и ждёт нажатия: там фразу слушают
   * повторно, и автопереход воровал бы у человека второе прослушивание.
   */
  useEffect(() => {
    advanceRef.current = (index: number) => {
      const next = moveCurrent(mode, sentences.length, index);

      if (next > index) {
        startSentence(next);
        return;
      }

      releaseAudio();
      setPosition(total);
      setState((previous) => transition(previous, { type: 'finish' }) ?? previous);
    };
  }, [mode, releaseAudio, sentences.length, startSentence, total]);

  const handlePrimary = useCallback(() => {
    if (state === 'playing') {
      if (isSpeechSupported) speechRef.current.stop();
      audioRef.current?.pause();
      clearTimers();
      setState('paused');
      return;
    }

    if (state === 'paused') {
      const audio = audioRef.current;

      // Системный голос нельзя «снять с паузы» — начинаем предложение заново.
      if (audio) {
        void audio.play().catch(() => undefined);
        setState('playing');
      } else {
        startSentence(current);
      }
      return;
    }

    // idle, ended, loading: loading означает, что прошлый запрос не ответил —
    // новый клик перезапускает, а не игнорируется.
    startSentence(state === 'ended' ? 0 : current);
  }, [clearTimers, current, isSpeechSupported, startSentence, state]);

  const move = useCallback(
    (direction: 'next' | 'prev') => {
      const target = moveCurrent(mode, sentences.length, current, direction);

      if (target >= 0 && target !== current) startSentence(target);
    },
    [current, mode, sentences.length, startSentence],
  );

  const changeRate = useCallback(
    (next: PlaybackRate) => {
      if (next === rate) return;
      setRate(next);

      const audio = audioRef.current;
      if (audio) {
        audio.playbackRate = next;
        return;
      }

      // В системном голосе темп задаётся при произнесении, поэтому текущее
      // предложение начинается заново — уже с новой скоростью.
      if (engine === 'browser' && state === 'playing') startSentence(current);
    },
    [current, engine, rate, startSentence, state],
  );

  const chooseStory = useCallback(
    (index: number) => {
      stopPlayback();
      setStoryIndex(index);
    },
    [stopPlayback],
  );

  // -------------------------------------------------------------------------
  // Проверка понимания
  // -------------------------------------------------------------------------

  /**
   * Слово для пропуска. Выбирается из слов этого рассказа и обязательно из этого
   * предложения: брать «первое по кругу» нельзя — тогда на большинстве
   * предложений задания не было бы вовсе.
   */
  const practiceWord = useMemo<PracticeWord | null>(() => {
    const words = story?.practiceWords ?? [];
    const sentence = sentences[current];
    if (words.length === 0 || !sentence) return null;

    const lower = sentence.text.toLowerCase();
    const matches = words.filter((item) => lower.includes(item.word.toLowerCase()));
    if (matches.length === 0) return null;

    return matches[current % matches.length];
  }, [current, sentences, story]);

  const gap = useMemo(() => {
    const sentence = sentences[current];
    if (!sentence || !practiceWord) return null;

    return gapQuestion(sentence.text, practiceWord.word);
  }, [current, practiceWord, sentences]);

  const translationKey = `${story?.id ?? ''}:${current}`;
  const currentTranslation = translations[translationKey] ?? null;

  const loadTranslation = useCallback(
    (index: number) => {
      if (!story) return;

      const key = `${story.id}:${index}`;
      if (translationRequests.current.has(key)) return;

      translationRequests.current.add(key);

      // Перевод берётся у существующего серверного эндпоинта — того же, что
      // использует читалка (/api/ai/translate-sentence). Вариантов, собранных
      // на клиенте из соседних предложений, нет сознательно: неверный «перевод»
      // в упражнении на понимание учит неправильному.
      void fetch(toProxyUrl('/api/ai/translate-sentence'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentences[index]?.text ?? '' }),
      })
        .then(async (response) => (response.ok ? ((await response.json()) as { translation?: unknown }) : null))
        .catch(() => null)
        .then((payload) => {
          const value = typeof payload?.translation === 'string' ? payload.translation.trim() : '';
          setTranslations((previous) => ({ ...previous, [key]: value || null }));
        });
    },
    [sentences, story],
  );

  // Перевод подгружается, когда до предложения дошла очередь.
  useEffect(() => {
    if (practice !== 'translate') return;
    if (translations[translationKey] !== undefined) return;

    loadTranslation(current);
  }, [current, loadTranslation, practice, translationKey, translations]);

  const verdict = verdictSentence === current ? answerStatus(gap?.expected ?? '', answer) : null;
  const gapPassed = gap !== null && isClozeComplete(gap.expected, answer);

  const renderPractice = () => {
    if (practice === 'gap') {
      if (!gap) {
        return (
          <p className="text-body-sm text-slate">
            В этом предложении нет слова из словаря рассказа — перемотайте дальше, чтобы
            появилось задание.
          </p>
        );
      }

      return (
        <div className="space-y-3">
          <p className="text-body-sm text-slate">Впишите пропущенное слово</p>
          <p className="text-body text-ink sm:text-h3" lang="en">
            {gap.display}
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Пропущенное слово"
              value={answer}
              onChange={(event) => {
                setAnswer(event.target.value);
                setVerdictSentence(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                setVerdictSentence(current);
              }}
              className="input min-h-[44px] flex-1"
              placeholder="слово на слух…"
            />
            <Button
              className="min-h-[44px]"
              onClick={() => setVerdictSentence(current)}
              disabled={!answer.trim()}
            >
              Проверить
            </Button>
          </div>

          {verdict && gapPassed && (
            <p role="status" aria-live="polite" className="flex items-start gap-2 text-body-sm text-success">
              <CheckIcon size={16} />
              <span>
                {verdict === 'correct'
                  ? 'Точно. Слышите слово в потоке речи — это главное.'
                  : `Почти: правильное написание — «${gap.expected}». Слово услышано.`}
              </span>
            </p>
          )}

          {verdict && !gapPassed && (
            <p role="status" aria-live="polite" className="flex items-start gap-2 text-body-sm text-danger">
              <CloseIcon size={16} />
              <span>
                {verdict === 'empty'
                  ? 'Сначала впишите слово.'
                  : `Не то: вы вписали «${answer.trim()}», звучало — «${gap.expected}».`}
              </span>
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-body-sm text-slate">Сверьте, что вы услышали</p>
        <p className="text-body text-ink" lang="en">
          {sentences[current]?.text}
        </p>

        {currentTranslation ? (
          <div className="rounded-md bg-surface p-3">
            <p className="text-caption text-slate">Перевод предложения</p>
            <p className="mt-1 text-body text-ink">{currentTranslation}</p>
          </div>
        ) : translations[translationKey] === null ? (
          <div className="space-y-2">
            <p className="text-body-sm text-slate">
              Перевод не получился: сервис перевода не ответил. Это не ошибка плеера —
              предложение можно прослушать ещё раз, а перевод запросить снова.
            </p>
            <Button
              variant="secondary"
              className="min-h-[44px]"
              onClick={() => {
                translationRequests.current.delete(translationKey);
                setTranslations((previous) => {
                  const next = { ...previous };
                  delete next[translationKey];
                  return next;
                });
                loadTranslation(current);
              }}
            >
              <RefreshIcon size={16} className="mr-2" />
              Запросить перевод
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-body-sm text-slate">
            <SpinnerIcon size={16} className="animate-spin" />
            Запрашиваю перевод…
          </p>
        )}
      </div>
    );
  };

  // Пробел — пауза, стрелки — предложения. Кнопки и поле выбора не перехватываем.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;

      if (event.code === 'Space') {
        event.preventDefault();
        handlePrimary();
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        move('next');
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault();
        move('prev');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePrimary, move]);

  if (!story || sentences.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-h3 text-ink">Текст рассказа не загрузился</p>
        <p className="mt-2 text-body-sm text-slate">
          Без текста аудирование невозможно: слушать нечего. Обновите страницу.
        </p>
        <Button className="mt-4" variant="secondary" href="/library">
          Другие книги
        </Button>
      </div>
    );
  }

  const activeIndex = state === 'playing' || state === 'paused'
    ? current
    : activeSentenceAt(timings, position);
  const fraction = progressFraction(timings, position);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Рассказ: список пришёл с сервера в первом HTML, без клиентского fetch */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1">
          <label className="sr-only" htmlFor="listening-story">
            Выбрать рассказ
          </label>
          <select
            id="listening-story"
            className="input min-h-[44px] w-full appearance-none pr-10"
            value={storyIndex}
            onChange={(event) => chooseStory(Number(event.target.value))}
          >
            {stories.map((item, index) => (
              <option key={item.id} value={index}>
                {item.title} · {item.cefrLevel.toUpperCase()}
              </option>
            ))}
          </select>
          <ChevronDownIcon
            size={16}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="neutral">{story.cefrLevel.toUpperCase()}</Tag>
          <Tag tone="neutral">{sentences.length} предл.</Tag>
          <Tag tone="neutral">{remainingLabel(total)}</Tag>
        </div>
      </div>

      {fallback && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-surface p-3 text-body-sm text-slate"
        >
          <Tag tone="warning">Базовая озвучка</Tag>
          <p className="min-w-0 flex-1">{fallbackReasonLabel(fallback)}</p>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => startSentence(current)}>
            Попробовать серверный голос
          </Button>
        </div>
      )}

      {speechUnsupported && (
        <div role="alert" className="rounded-md bg-surface-danger p-3 text-body-sm text-on-danger">
          Браузер не умеет синтезировать речь. Текст можно прочитать — он ниже.
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="max-h-[46vh] overflow-y-auto p-4 sm:max-h-[62vh] sm:p-6">
          <p className="text-body leading-relaxed text-ink sm:text-body-lg" lang="en">
            {sentences.map((sentence) => {
              const paragraph = bounds.get(sentence.paragraph);
              const isParagraphStart = paragraph?.first === sentence.index && sentence.index > 0;
              const isParagraphEnd = paragraph?.last === sentence.index;
              const isCurrent = current === sentence.index;
              const isNow = activeIndex === sentence.index;

              return (
                <span key={sentence.index}>
                  {isParagraphStart && <br />}
                  <button
                    type="button"
                    onClick={() => startSentence(clickSentence(sentences.length, sentence.index))}
                    aria-current={isCurrent ? 'true' : undefined}
                    aria-label={`Предложение ${sentence.index + 1}: ${sentence.text}`}
                    data-listening-current={isCurrent ? 'true' : undefined}
                    className={[
                      'cursor-pointer rounded-[3px] text-left transition-colors',
                      isCurrent
                        ? 'bg-surface-accent font-medium text-ink'
                        : isNow
                          ? 'bg-surface'
                          : 'hover:bg-surface',
                    ].join(' ')}
                  >
                    {sentence.text}
                  </button>
                  {isParagraphEnd && <br />}
                  {' '}
                </span>
              );
            })}
          </p>
        </div>

        <div className="h-1 w-full bg-surface" role="presentation">
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-line p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="flex items-center justify-center gap-1 sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => move('prev')}
              disabled={current === 0 || state === 'loading'}
              aria-label="Предыдущее предложение"
              className="min-h-[44px] min-w-[44px]"
            >
              <ArrowLeftIcon size={20} />
            </Button>

            <Button
              onClick={handlePrimary}
              aria-label={primaryActionLabel(state)}
              className="min-h-[48px] min-w-[48px] gap-2"
              disabled={state === 'loading'}
            >
              {state === 'loading' ? (
                <SpinnerIcon size={20} className="animate-spin" />
              ) : state === 'playing' ? (
                <PauseIcon size={20} />
              ) : (
                <PlayIcon size={20} />
              )}
              <span className="hidden sm:inline">{primaryActionLabel(state)}</span>
            </Button>

            <Button
              variant="ghost"
              onClick={() => move('next')}
              disabled={current >= sentences.length - 1 || state === 'loading'}
              aria-label="Следующее предложение"
              className="min-h-[44px] min-w-[44px]"
            >
              <ArrowRightIcon size={20} />
            </Button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <span className="text-center text-caption tabular-nums text-slate sm:text-right">
              {remainingLabel(Math.max(0, total - position))} осталось
            </span>

            <div
              role="group"
              aria-label="Скорость"
              className="flex items-center justify-center gap-1 rounded-md bg-surface p-1"
            >
              {PLAYBACK_RATES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => changeRate(option)}
                  aria-pressed={option === rate}
                  className={[
                    'min-h-[40px] min-w-[44px] rounded-[4px] px-2.5 text-caption font-semibold tabular-nums transition-colors',
                    option === rate ? 'bg-surface-inverse text-on-dark' : 'text-slate hover:text-ink',
                  ].join(' ')}
                >
                  {formatRate(option)}
                </button>
              ))}
            </div>

            <Button
              variant="ghost"
              onClick={() => changeRate(nextRate(rate))}
              aria-label={`Скорость ${formatRate(rate)}, сменить`}
              className="hidden min-h-[44px] sm:inline-flex"
            >
              <HeadphonesIcon size={20} />
            </Button>
          </div>
        </div>
      </div>

      {/* Режимы: весь рассказ или по предложению — и способ проверки понимания */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card p-3 sm:p-4">
          <p className="text-caption text-slate">Режим прослушивания</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            {CHECK_MODES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(normalizeMode(option))}
                aria-pressed={mode === option}
                className={[
                  'min-h-[44px] flex-1 rounded-md px-3 text-body-sm font-semibold transition-colors',
                  mode === option ? 'bg-surface-inverse text-on-dark' : 'bg-surface text-slate hover:text-ink',
                ].join(' ')}
              >
                {option === 'story' ? 'Весь рассказ' : 'По предложению'}
              </button>
            ))}
          </div>
          <p className="mt-2 text-caption text-slate">
            {mode === 'story'
              ? 'Предложения идут одно за другим без остановки.'
              : 'Звучит одно предложение и останавливается — можно слушать повторно.'}
          </p>
        </div>

        <div className="card p-3 sm:p-4">
          <p className="text-caption text-slate">Проверка понимания</p>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {(Object.keys(PRACTICE_LABEL) as Practice[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setPractice(option);
                  setAnswer('');
                  setVerdictSentence(null);
                }}
                aria-pressed={practice === option}
                className={[
                  'min-h-[44px] rounded-md px-1 text-caption font-semibold transition-colors sm:text-body-sm',
                  practice === option
                    ? 'bg-surface-inverse text-on-dark'
                    : 'bg-surface text-slate hover:text-ink',
                ].join(' ')}
              >
                {PRACTICE_LABEL[option]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-caption text-slate">{PRACTICE_HINT[practice]}</p>
        </div>
      </div>

      {practice !== 'listen' && <div className="card p-4 sm:p-5">{renderPractice()}</div>}

      <p className="hidden text-caption text-slate sm:block">
        Пробел — пауза, ← и → — предложения. Клик по предложению перематывает к нему.
        {engine === 'server' && ' Читает серверный нейроголос.'}
        {engine === 'browser' && ` Читает голос браузера, темп ${formatRate(rate)}.`}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" href="/library" className="min-h-[44px]">
          <BookOpenIcon size={20} className="mr-2" />
          Читать с переводом
        </Button>
      </div>
    </div>
  );
}
