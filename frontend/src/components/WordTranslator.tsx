'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';

interface TranslationResult {
  translation: string;
  alternatives?: string[];
  partOfSpeech?: string;
  examples?: { english: string; translation: string }[];
}

interface WordTranslatorProps {
  word: string;
  context?: string;
  onAddToDictionary?: (word: string, translation: string, partOfSpeech?: string) => void;
}

export default function WordTranslator({ word, context, onAddToDictionary }: WordTranslatorProps) {
  const { data: session } = useSession();
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const translate = async () => {
    if (!word.trim()) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      const token = session?.accessToken;
      const res = await fetch('http://localhost:5226/api/ai/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          word: word.trim(),
          context: context || undefined,
          targetLanguage: 'ru'
        })
      });

      if (!res.ok) {
        throw new Error('Translation failed');
      }

      const data = await res.json();
      setResult(data);
    } catch {
      setError('Ошибка перевода');
    } finally {
      setIsLoading(false);
    }
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    speechSynthesis.speak(utterance);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-md">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Перевод слова</h3>
        <button
          onClick={() => speak(word)}
          className="p-2 text-gray-400 hover:text-indigo-600"
        >
          🔊
        </button>
      </div>

      <div className="mb-4">
        <p className="text-2xl font-bold text-gray-900">{word}</p>
        {context && (
          <p className="text-sm text-gray-500 mt-1 italic">«{context}»</p>
        )}
      </div>

      <button
        onClick={translate}
        disabled={isLoading}
        className="w-full py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 mb-4"
      >
        {isLoading ? 'Перевод...' : 'Перевести'}
      </button>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Основной перевод */}
          <div>
            <p className="text-xl text-gray-900 font-medium">{result.translation}</p>
            {result.partOfSpeech && (
              <span className="inline-block mt-1 px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                {result.partOfSpeech}
              </span>
            )}
          </div>

          {/* Альтернативы */}
          {result.alternatives && result.alternatives.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">Альтернативы:</p>
              <div className="flex flex-wrap gap-2">
                {result.alternatives.map((alt, idx) => (
                  <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-700 text-sm rounded">
                    {alt}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Примеры */}
          {result.examples && result.examples.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-2">Примеры:</p>
              <div className="space-y-2">
                {result.examples.map((ex, idx) => (
                  <div key={idx} className="p-3 bg-gray-50 rounded-lg">
                    <button
                      onClick={() => speak(ex.english)}
                      className="text-left w-full group"
                    >
                      <p className="text-gray-900 group-hover:text-indigo-600">{ex.english}</p>
                      <p className="text-gray-600 text-sm mt-1">{ex.translation}</p>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Кнопка добавить в словарь */}
          {onAddToDictionary && (
            <button
              onClick={() => onAddToDictionary(word, result.translation, result.partOfSpeech)}
              className="w-full py-2 px-4 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              + В мой словарь
            </button>
          )}
        </div>
      )}
    </div>
  );
}