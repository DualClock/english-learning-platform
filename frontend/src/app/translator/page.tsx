'use client';

import AppLayout from '@/components/AppLayout';
import AlexAvatar from '@/components/assistant/AlexAvatar';
import AnalysisCard, {
  type AssistantAnalysis,
} from '@/components/assistant/AnalysisCard';
import WelcomeScreen from '@/components/assistant/WelcomeScreen';
import { API_URL } from '@/app/lib/api-url';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const SUGGESTION_CHIPS = [
  'How was your day?',
  'What do you do for fun?',
  'I want to practice small talk',
];

export default function TranslatorPage() {
  const { data: session } = useSession();

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
    const token = session?.accessToken;
    if (!token) return;
    fetch(`${API_URL}/api/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.cefrLevel) setUserLevel(String(data.cefrLevel).toUpperCase());
      })
      .catch(() => {});
  }, [session?.accessToken]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  const requestChat = useCallback(
    async (history: ChatMessage[]): Promise<string | null> => {
      try {
        const res = await fetch(`${API_URL}/api/assistant/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.accessToken}`,
          },
          body: JSON.stringify({ messages: history, userLevel: userLevel || undefined }),
        });
        if (!res.ok) throw new Error('chat failed');
        const data = await res.json();
        return data.reply ?? null;
      } catch {
        setError('Alex временно недоступен. Попробуй ещё раз чуть позже.');
        return null;
      }
    },
    [session?.accessToken, userLevel]
  );

  // Приветствие: если история пуста, Alex пишет первым
  useEffect(() => {
    if (phase !== 'chat' || greetedRef.current || sending) return;
    greetedRef.current = true;
    (async () => {
      setSending(true);
      const reply = await requestChat([]);
      if (reply) setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
      setSending(false);
    })();
  }, [phase, sending, requestChat]);

  const startChat = () => {
    localStorage.setItem('assistant_seen', '1');
    setPhase('chat');
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const history = [...messages, { role: 'user' as const, text }];
    setMessages(history);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setError('');
    setSending(true);

    const reply = await requestChat(history);
    if (reply) setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
    setSending(false);
  };

  const toggleAnalysis = async (idx: number) => {
    const willOpen = !openAnalyses[idx];
    setOpenAnalyses((prev) => ({ ...prev, [idx]: willOpen }));
    if (!willOpen || analyses[idx] || analyzing[idx]) return;

    setAnalysisFailed((prev) => ({ ...prev, [idx]: false }));
    setAnalyzing((prev) => ({ ...prev, [idx]: true }));
    try {
      const res = await fetch(`${API_URL}/api/assistant/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.accessToken}`,
        },
        body: JSON.stringify({ text: messages[idx].text, userLevel: userLevel || undefined }),
      });
      if (!res.ok) throw new Error('analyze failed');
      const data: AssistantAnalysis = await res.json();
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
          <div className="flex items-center gap-3 py-4 border-b border-[#D6D3CC]">
            <AlexAvatar size="md" />
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-[#20231F] leading-tight">Alex</h1>
              <p className="text-xs text-[#5A5F5A]">
                AI-собеседник{userLevel ? ` · уровень ${userLevel}` : ''}
              </p>
            </div>
            <button
              onClick={startNewConversation}
              className="text-sm text-[#5A5F5A] hover:text-[#20231F] px-3 py-1.5 rounded-lg hover:bg-[#E7ECE4] transition-colors"
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
                    <div className="bg-white border border-[#D6D3CC] rounded-2xl rounded-bl-sm px-4 py-2.5 text-[#20231F] whitespace-pre-wrap">
                      {message.text}
                    </div>
                    <button
                      onClick={() => speak(message.text)}
                      title="Озвучить"
                      className="mt-1 text-xs text-[#5A5F5A] hover:text-[#356B52] transition-colors"
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
                    className="text-sm px-2 py-0.5 rounded-full text-[#5A5F5A] hover:text-[#EBCB75] hover:bg-white transition-colors mb-0.5"
                  >
                    💡
                  </button>
                  <div className="max-w-[80%] bg-[#356B52] text-white rounded-2xl rounded-br-sm px-4 py-2.5 whitespace-pre-wrap">
                    {message.text}
                  </div>
                  {openAnalyses[idx] && (
                    <>
                      {analyzing[idx] && (
                        <div className="mt-2 text-sm text-[#5A5F5A] inline-flex items-center gap-1">
                          Разбираем сообщение
                          <span className="inline-flex gap-0.5">
                            <span className="assistant-typing-dot">·</span>
                            <span className="assistant-typing-dot">·</span>
                            <span className="assistant-typing-dot">·</span>
                          </span>
                        </div>
                      )}
                      {analysisFailed[idx] && !analyzing[idx] && (
                        <div className="mt-2 text-sm text-[#B85C5C]">
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
                <div className="bg-white border border-[#D6D3CC] rounded-2xl rounded-bl-sm px-4 py-3 inline-flex items-center gap-2 text-sm text-[#5A5F5A]">
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
              <div className="p-3 rounded-lg bg-[#B85C5C]/10 border border-[#B85C5C]/40 text-[#B85C5C] text-sm text-center">
                {error}
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
                className="text-xs px-3 py-1.5 rounded-full bg-white border border-[#D6D3CC] text-[#5A5F5A] hover:border-[#356B52] hover:text-[#356B52] transition-colors"
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
