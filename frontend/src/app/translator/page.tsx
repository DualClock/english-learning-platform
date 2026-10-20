'use client';

import AppLayout from '@/components/AppLayout';
import AlexAvatar from '@/components/assistant/AlexAvatar';
import AnalysisCard, {
  type AssistantAnalysis,
} from '@/components/assistant/AnalysisCard';
import WelcomeScreen from '@/components/assistant/WelcomeScreen';
import { ApiError, apiMutate } from '@/app/lib/api-client';
import { useApiQuery } from '@/app/lib/use-api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  failed?: boolean;
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

  const greetedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const seen = localStorage.getItem('assistant_seen');
    setPhase(seen ? 'chat' : 'welcome');
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
    if (reply) setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
    else if (chatError) setError(chatError);
    setSending(false);
  }, [requestChat]);

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
    } catch {
      setAnalysisFailed((prev) => ({ ...prev, [idx]: true }));
    } finally {
      setAnalyzing((prev) => ({ ...prev, [idx]: false }));
    }
  };

  const speak = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
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
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
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
        <div className="max-w-3xl mx-auto" />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {phase === 'welcome' ? (
        <WelcomeScreen onStart={startChat} />
      ) : (
        <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-4rem)]">
          {/* Шапка */}
          <div className="flex items-center gap-3 py-4 border-b border-[var(--color-hairline-strong)]">
            <AlexAvatar size="md" />
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-[var(--color-ink)] leading-tight">Alex</h1>
              <p className="text-xs text-[var(--color-slate)]">
                AI-собеседник{userLevel ? ` · уровень ${userLevel}` : ''}
              </p>
            </div>
            <button
              onClick={startNewConversation}
              className="text-sm text-[var(--color-slate)] hover:text-[var(--color-ink)] px-3 py-1.5 rounded-lg hover:bg-[var(--color-tint-mint)] transition-colors"
            >
              🔄 Новый разговор
            </button>
          </div>

          {/* Лента сообщений */}
          <div className="flex-1 overflow-y-auto py-4 space-y-4">
            {messages.map((message, idx) =>
              message.role === 'assistant' ? (
                <div key={idx} className="flex gap-2 items-end assistant-message-in">
                  <AlexAvatar size="sm" />
                  <div className="max-w-[80%]">
                    <div className="bg-white border border-[var(--color-hairline-strong)] rounded-xl rounded-bl-sm px-4 py-2.5 text-[var(--color-ink)] whitespace-pre-wrap">
                      {message.text}
                    </div>
                    <button
                      onClick={() => speak(message.text)}
                      title="Озвучить"
                      className="mt-1 text-xs text-[var(--color-slate)] hover:text-[var(--color-primary)] transition-colors"
                    >
                      🔊 Озвучить
                    </button>
                  </div>
                </div>
              ) : (
                <div key={idx} className="flex flex-col items-end assistant-message-in">
                  <button
                    onClick={() => toggleAnalysis(idx)}
                    title="Разбор сообщения"
                    className="text-sm px-2 py-0.5 rounded-full text-[var(--color-slate)] hover:text-[var(--color-tint-yellow-bold)] hover:bg-white transition-colors mb-0.5"
                  >
                    💡
                  </button>
                  <div className="max-w-[80%] bg-[var(--color-primary)] text-white rounded-xl rounded-br-sm px-4 py-2.5 whitespace-pre-wrap">
                    {message.text}
                  </div>
                  {message.failed && (
                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-error)]">
                      <span>Не отправлено</span>
                      <button
                        onClick={() => retryMessage(idx)}
                        className="underline hover:text-[var(--color-ink)] transition-colors"
                      >
                        Повторить
                      </button>
                    </div>
                  )}
                  {openAnalyses[idx] && (
                    <>
                      {analyzing[idx] && (
                        <div className="mt-2 text-sm text-[var(--color-slate)] inline-flex items-center gap-1">
                          Разбираем сообщение
                          <span className="inline-flex gap-0.5">
                            <span className="assistant-typing-dot">·</span>
                            <span className="assistant-typing-dot">·</span>
                            <span className="assistant-typing-dot">·</span>
                          </span>
                        </div>
                      )}
                      {analysisFailed[idx] && !analyzing[idx] && (
                        <div className="mt-2 text-sm text-[var(--color-error)]">
                          Не получилось разобрать сообщение. Попробуй ещё раз.
                        </div>
                      )}
                      {analyses[idx] && <AnalysisCard analysis={analyses[idx]} />}
                    </>
                  )}
                </div>
              )
            )}

            {sending && (
              <div className="flex gap-2 items-end">
                <AlexAvatar size="sm" />
                <div className="bg-white border border-[var(--color-hairline-strong)] rounded-xl rounded-bl-sm px-4 py-3 inline-flex items-center gap-2 text-sm text-[var(--color-slate)]">
                  Alex печатает
                  <span className="inline-flex gap-0.5">
                    <span className="assistant-typing-dot">·</span>
                    <span className="assistant-typing-dot">·</span>
                    <span className="assistant-typing-dot">·</span>
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-[rgba(217,45,32,0.10)] border border-[rgba(217,45,32,0.40)] text-[var(--color-error)] text-sm text-center">
                {error}
                {messages.length === 0 && !sending && (
                  <button onClick={greet} className="ml-2 underline hover:text-[var(--color-ink)] transition-colors">
                    Повторить
                  </button>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Подсказки-фразы */}
          <div className="flex flex-wrap gap-2 py-2">
            {SUGGESTION_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => {
                  setInput(chip);
                  textareaRef.current?.focus();
                }}
                className="text-xs px-3 py-1.5 rounded-full bg-white border border-[var(--color-hairline-strong)] text-[var(--color-slate)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Поле ввода */}
          <div className="flex items-end gap-2 pb-4 pt-1">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Напиши сообщение на английском…"
              className="input flex-1 resize-none max-h-[120px] py-2.5"
            />
            <button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              className="btn-primary px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
