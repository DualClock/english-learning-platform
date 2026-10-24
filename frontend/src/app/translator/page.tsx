'use client';

import AppLayout from '@/components/AppLayout';
import AlexAvatar from '@/components/assistant/AlexAvatar';
import AnalysisCard, {
  type AssistantAnalysis,
} from '@/components/assistant/AnalysisCard';
import WelcomeScreen from '@/components/assistant/WelcomeScreen';
import Button from '@/components/ui/Button';
import LoadingState from '@/components/ui/LoadingState';
import Notice from '@/components/ui/Notice';
import {
  BulbIcon,
  ChevronDownIcon,
  MicIcon,
  PinIcon,
  RefreshIcon,
  SendIcon,
  SpinnerIcon,
  StopIcon,
  VolumeIcon,
  VolumeOffIcon,
} from '@/components/ui/icons';
import { AnimatePresence, motion } from 'motion/react';
import { variants } from '@/lib/motion';
import { ApiError, apiMutate } from '@/app/lib/api-client';
import { useApiQuery } from '@/app/lib/use-api';
import { useTts } from '@/hooks/useTts';
import { useRecorder } from '@/hooks/useRecorder';
import { blobToWavBase64 } from '@/app/lib/wav';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  failed?: boolean;
}

interface ErrorBankEntry {
  id: number;
  original: string;
  suggestion: string;
  type: string;
  explanation?: string | null;
  createdAt: string;
  resolved: boolean;
}

interface ErrorBankResponse {
  items: ErrorBankEntry[];
  unresolvedCount: number;
}

const SUGGESTION_CHIPS = [
  'How was your day?',
  'What do you do for fun?',
  'I want to practice small talk',
];

export default function TranslatorPage() {
  const { data: session } = useSession();
  const { data: profileData } = useApiQuery<{ cefrLevel?: string | null }>('/api/profile');

  const [phase, setPhase] = useState<'loading' | 'welcome' | 'chat'>('loading');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const [analyses, setAnalyses] = useState<Record<number, AssistantAnalysis>>({});
  const [analyzing, setAnalyzing] = useState<Record<number, boolean>>({});
  const [analysisFailed, setAnalysisFailed] = useState<Record<number, boolean>>({});
  const [openAnalyses, setOpenAnalyses] = useState<Record<number, boolean>>({});

  const [userLevel, setUserLevel] = useState<string | null>(null);

  // Голос: озвучка ответов Alex и голосовой ввод с микрофона
  const { speak, stop: stopSpeaking } = useTts();
  const recorder = useRecorder();
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micError, setMicError] = useState('');

  // Банк типичных ошибок
  const [showErrors, setShowErrors] = useState(false);
  const {
    data: errorBank,
    refresh: refreshErrors,
  } = useApiQuery<ErrorBankResponse>('/api/assistant/errors', {
    enabled: phase === 'chat',
  });

  const greetedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const seen = localStorage.getItem('assistant_seen');
    setPhase(seen ? 'chat' : 'welcome');
    setAutoSpeak(localStorage.getItem('assistant_autospeak') === '1');
  }, []);

  useEffect(() => {
    if (profileData?.cefrLevel) setUserLevel(String(profileData.cefrLevel).toUpperCase());
  }, [profileData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  const requestChat = useCallback(
    async (history: ChatMessage[]): Promise<{ reply: string | null; error: string | null }> => {
      try {
        const data = await apiMutate<{ reply?: string }>('/api/assistant/chat', {
          token: session?.accessToken,
          method: 'POST',
          body: { messages: history, userLevel: userLevel || undefined },
        });
        if (!data?.reply) {
          return { reply: null, error: 'Alex временно недоступен. Попробуй ещё раз чуть позже.' };
        }
        return { reply: data.reply, error: null };
      } catch (err) {
        if (err instanceof ApiError) {
          const message =
            err.message && !err.message.startsWith('Ошибка запроса')
              ? err.message
              : 'Alex временно недоступен. Попробуй ещё раз чуть позже.';
          return { reply: null, error: message };
        }
        return { reply: null, error: 'Нет соединения с сервером. Проверь интернет и попробуй ещё раз.' };
      }
    },
    [session?.accessToken, userLevel]
  );

  // Приветствие: если история пуста, Alex пишет первым
  const greet = useCallback(async () => {
    setSending(true);
    setError('');
    const { reply, error: chatError } = await requestChat([]);
    if (reply) {
      setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
      if (autoSpeak) speak(reply);
    } else if (chatError) setError(chatError);
    setSending(false);
  }, [autoSpeak, requestChat, speak]);

  useEffect(() => {
    if (phase !== 'chat' || greetedRef.current || sending) return;
    greetedRef.current = true;
    greet();
  }, [phase, sending, greet]);

  const startChat = () => {
    localStorage.setItem('assistant_seen', '1');
    setPhase('chat');
  };

  // Отправка истории в чат. При ошибке последнее сообщение пользователя
  // остаётся в ленте со статусом «не отправлено» и кнопкой «Повторить».
  const deliverMessage = async (history: ChatMessage[]) => {
    setError('');
    setSending(true);
    const { reply, error: chatError } = await requestChat(history);
    setSending(false);
    if (reply) {
      setMessages([...history, { role: 'assistant', text: reply }]);
      if (autoSpeak) speak(reply);
    } else {
      setMessages(
        history.map((m, i) =>
          i === history.length - 1 && m.role === 'user' ? { ...m, failed: true } : m
        )
      );
      if (chatError) setError(chatError);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const history = [...messages, { role: 'user' as const, text }];
    setMessages(history);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await deliverMessage(history);
  };

  const retryMessage = (idx: number) => {
    if (sending) return;
    const history = messages.slice(0, idx + 1).map((m) => ({ ...m, failed: false }));
    setMessages(history);
    deliverMessage(history);
  };

  const toggleAnalysis = async (idx: number) => {
    const willOpen = !openAnalyses[idx];
    setOpenAnalyses((prev) => ({ ...prev, [idx]: willOpen }));
    if (!willOpen || analyses[idx] || analyzing[idx]) return;

    setAnalysisFailed((prev) => ({ ...prev, [idx]: false }));
    setAnalyzing((prev) => ({ ...prev, [idx]: true }));
    try {
      const data = await apiMutate<AssistantAnalysis>('/api/assistant/analyze', {
        token: session?.accessToken,
        method: 'POST',
        body: { text: messages[idx].text, userLevel: userLevel || undefined },
      });
      setAnalyses((prev) => ({ ...prev, [idx]: data }));
      // Разбор пополняет банк ошибок — обновляем счётчик
      refreshErrors();
    } catch {
      setAnalysisFailed((prev) => ({ ...prev, [idx]: true }));
    } finally {
      setAnalyzing((prev) => ({ ...prev, [idx]: false }));
    }
  };

  // Микрофон: запись -> распознавание -> текст в поле ввода.
  // Alex отвечает голосом, но ввод остаётся обычным текстом — его можно поправить.
  const toggleMic = async () => {
    setMicError('');
    stopSpeaking();

    if (recorder.isRecording) {
      const blob = await recorder.stop();
      if (!blob) return;

      setTranscribing(true);
      try {
        const audioBase64 = await blobToWavBase64(blob);
        const result = await apiMutate<{ transcribed?: string }>('/api/pronunciation/transcribe', {
          token: session?.accessToken,
          method: 'POST',
          body: { audioBase64, mimeType: 'audio/wav' },
        });

        const text = result?.transcribed?.trim();
        if (text) {
          setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
          textareaRef.current?.focus();
        } else {
          setMicError('Не расслышали. Попробуйте сказать чуть громче.');
        }
      } catch (err) {
        setMicError(
          err instanceof ApiError
            ? err.message
            : 'Не удалось распознать речь. Попробуйте ещё раз.'
        );
      } finally {
        setTranscribing(false);
      }
      return;
    }

    await recorder.start();
  };

  const toggleAutoSpeak = () => {
    setAutoSpeak((value) => {
      const next = !value;
      localStorage.setItem('assistant_autospeak', next ? '1' : '0');
      if (!next) stopSpeaking();
      return next;
    });
  };

  const resolveError = async (id: number) => {
    try {
      await apiMutate(`/api/assistant/errors/${id}/resolve`, {
        token: session?.accessToken,
        method: 'POST',
        invalidate: ['/api/assistant/errors'],
      });
      refreshErrors();
    } catch {
      // не критично: панель обновится при следующем заходе
    }
  };

  const startNewConversation = () => {
    if (messages.length > 0 && !confirm('Начать новый разговор? Текущая история будет удалена.')) {
      return;
    }
    setMessages([]);
    setAnalyses({});
    setAnalyzing({});
    setAnalysisFailed({});
    setOpenAnalyses({});
    setError('');
    greetedRef.current = false;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    // 112px = 7rem, тот же потолок, что и max-h-28 у поля
    e.target.style.height = `${Math.min(e.target.scrollHeight, 112)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (phase === 'loading') {
    return (
      <AppLayout>
        <div className="mx-auto max-w-3xl">
          <LoadingState rows={4} label="Загрузка разговора" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {phase === 'welcome' ? (
        <WelcomeScreen onStart={startChat} />
      ) : (
        <div className="chat-shell mx-auto flex max-w-3xl flex-col">
          {/* Шапка */}
          <div className="flex flex-wrap items-center gap-3 border-b border-hairline py-4">
            <AlexAvatar size="md" />
            <div className="min-w-0 flex-1">
              <h1 className="text-h3 text-ink">Alex</h1>
              <p className="text-caption text-slate">
                AI-собеседник{userLevel ? ` · уровень ${userLevel}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleAutoSpeak}
              aria-pressed={autoSpeak}
              className={`${autoSpeak ? 'icon-chip-active' : 'icon-chip'}`}
            >
              {autoSpeak ? <VolumeIcon size={16} /> : <VolumeOffIcon size={16} />}
              Голос
            </button>
            <Button variant="ghost" onClick={startNewConversation}>
              <RefreshIcon size={16} />
              <span className="hidden sm:inline">Новый разговор</span>
              <span className="sm:hidden">Заново</span>
            </Button>
          </div>

          {/* Банк типичных ошибок */}
          {errorBank && errorBank.unresolvedCount > 0 && (
            <div className="border-b border-hairline py-2">
              <button
                type="button"
                onClick={() => setShowErrors((value) => !value)}
                aria-expanded={showErrors}
                className="btn-ghost px-2"
              >
                <PinIcon size={16} />
                Мои типичные ошибки ({errorBank.unresolvedCount})
                <ChevronDownIcon
                  size={16}
                  className={`transition-transform duration-fast ease-soft ${
                    showErrors ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {showErrors && (
                <ul className="stagger mt-2 max-h-56 space-y-2 overflow-y-auto">
                  {errorBank.items.map((entry) => (
                    <li key={entry.id} className="rounded-lg border border-hairline bg-canvas p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-body-sm leading-snug text-ink">
                          <span className="text-semantic-error line-through">{entry.original}</span>
                          <span className="mx-1.5 text-slate">→</span>
                          <span className="text-semantic-success">{entry.suggestion}</span>
                        </p>
                        <Button
                          variant="secondary"
                          className="shrink-0 px-3 py-1 text-caption"
                          onClick={() => resolveError(entry.id)}
                        >
                          Отработал
                        </Button>
                      </div>
                      {entry.explanation && (
                        <p className="mt-1 text-caption text-slate">{entry.explanation}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Лента сообщений */}
          <div className="flex-1 space-y-4 overflow-y-auto py-4">
            {messages.map((message, idx) =>
              message.role === 'assistant' ? (
                <div key={idx} className="assistant-message-in flex items-end gap-2">
                  <AlexAvatar size="sm" />
                  <div className="chat-col flex flex-col items-start gap-1">
                    <div className="chat-bubble-in">{message.text}</div>
                    <button
                      type="button"
                      onClick={() => speak(message.text)}
                      className="btn-ghost px-1 py-0 text-caption"
                    >
                      <VolumeIcon size={16} />
                      Озвучить
                    </button>
                  </div>
                </div>
              ) : (
                <div key={idx} className="assistant-message-in flex flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={() => toggleAnalysis(idx)}
                    aria-expanded={Boolean(openAnalyses[idx])}
                    aria-label="Разбор сообщения"
                    className="btn-ghost px-2 py-0.5"
                  >
                    <BulbIcon size={16} />
                  </button>
                  <div className="chat-col chat-bubble-out">{message.text}</div>
                  {message.failed && (
                    <div className="flex items-center gap-2 text-caption text-semantic-error">
                      <span>Не отправлено</span>
                      <button
                        type="button"
                        onClick={() => retryMessage(idx)}
                        className="font-medium underline hover:text-ink transition-colors"
                      >
                        Повторить
                      </button>
                    </div>
                  )}
                  {openAnalyses[idx] && (
                    <>
                      {analyzing[idx] && (
                        <div role="status" className="inline-flex items-center gap-1 text-body-sm text-slate">
                          Разбираем сообщение
                          <span className="inline-flex gap-0.5">
                            <span className="assistant-typing-dot">·</span>
                            <span className="assistant-typing-dot">·</span>
                            <span className="assistant-typing-dot">·</span>
                          </span>
                        </div>
                      )}
                      {analysisFailed[idx] && !analyzing[idx] && (
                        <div role="alert" className="text-body-sm text-semantic-error">
                          Не получилось разобрать сообщение. Попробуй ещё раз.
                        </div>
                      )}
                      {analyses[idx] && <AnalysisCard analysis={analyses[idx]} />}
                    </>
                  )}
                </div>
              )
            )}

            <AnimatePresence>
              {sending && (
                <motion.div
                  key="typing"
                  variants={variants.fadeOnly}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="flex items-end gap-2"
                >
                  <AlexAvatar size="sm" />
                  <div
                    role="status"
                    className="chat-bubble-in inline-flex items-center gap-2 text-body-sm text-slate"
                  >
                    Alex печатает
                    <span className="inline-flex gap-0.5">
                      <span className="assistant-typing-dot">·</span>
                      <span className="assistant-typing-dot">·</span>
                      <span className="assistant-typing-dot">·</span>
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <Notice tone="danger">
                <span>{error}</span>
                {messages.length === 0 && !sending && (
                  <button
                    type="button"
                    onClick={greet}
                    className="ml-2 font-medium underline hover:text-ink transition-colors"
                  >
                    Повторить
                  </button>
                )}
              </Notice>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Подсказки-фразы */}
          <div className="flex flex-wrap gap-2 py-2">
            {SUGGESTION_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => {
                  setInput(chip);
                  textareaRef.current?.focus();
                }}
                className="chip-button"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Поле ввода */}
          {(micError || recorder.error || recorder.isRecording) && (
            <p
              role={micError || recorder.error ? 'alert' : 'status'}
              aria-live={micError || recorder.error ? undefined : 'polite'}
              className={`pb-1 text-caption ${
                micError || recorder.error ? 'text-semantic-error' : 'text-slate'
              }`}
            >
              {micError || recorder.error
                ? micError || recorder.error
                : `Идёт запись · ${recorder.seconds} с из ${recorder.maxSeconds} — нажмите «Стоп», чтобы закончить`}
            </p>
          )}
          <div className="flex items-end gap-2 pb-4 pt-1">
            <button
              type="button"
              onClick={toggleMic}
              disabled={transcribing}
              aria-label={
                transcribing
                  ? 'Распознаём речь'
                  : recorder.isRecording
                    ? 'Остановить запись'
                    : 'Голосовой ввод'
              }
              className={recorder.isRecording ? 'mic-chip-recording' : 'mic-chip'}
            >
              {transcribing ? (
                <SpinnerIcon size={20} label="Распознаём речь" />
              ) : recorder.isRecording ? (
                <StopIcon size={20} />
              ) : (
                <MicIcon size={20} />
              )}
            </button>
            <label className="sr-only" htmlFor="assistant-input">
              Сообщение для Alex
            </label>
            <textarea
              id="assistant-input"
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Напиши сообщение на английском…"
              className="input max-h-28 flex-1 resize-none py-2.5"
            />
            <Button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              aria-label="Отправить сообщение"
              className="px-4"
            >
              <SendIcon size={20} />
            </Button>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
