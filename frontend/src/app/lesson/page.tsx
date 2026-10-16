'use client';

import { useState } from 'react';
import Link from 'next/link';

const lessonContent = {
  title: 'The Great Gatsby',
  author: 'F. Scott Fitzgerald',
  chapter: 'Chapter 3',
  level: 'B2',
  paragraphs: [
    {
      id: 1,
      text: 'There was music from my neighbor\'s house through the summer nights. In his blue gardens men and girls came and went like moths among the whisperings and the champagne and the stars.',
      words: [
        { word: 'whisperings', translation: 'шепот', context: 'whisperings among the trees' },
      ]
    },
    {
      id: 2,
      text: 'At high tide in the afternoon I watched his guests diving from the tower of his raft, or taking the sun on the hot sand of his beach while his two motor-boats slit the waters of the Sound, drawing aquaplanes over the cataracts of foam.',
      words: [
        { word: 'cataracts', translation: 'водопады', context: 'cataracts of foam' },
      ]
    },
    {
      id: 3,
      text: 'And every Friday five crates of oranges and lemons arrived from a fruiterer in New York—every Monday these same oranges and lemons left his back door in a pyramid of pulpless halves.',
      words: [
        { word: 'fruiterer', translation: 'фруктовщик', context: 'a fruiterer in New York' },
        { word: 'pulpless', translation: 'без мякоти', context: 'pulpless halves' },
      ]
    },
  ]
};

export default function LessonPage() {
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());

  const handleWordClick = (word: string) => {
    setSelectedWord(word);
  };

  const handleSaveWord = (word: string) => {
    setSavedWords(prev => new Set(prev).add(word));
    setSelectedWord(null);
  };

  const renderParagraph = (paragraph: typeof lessonContent.paragraphs[0]) => {
    const words = paragraph.text.split(' ');
    
    return words.map((word, index) => {
      const cleanWord = word.replace(/[.,;:!?"]/g, '').toLowerCase();
      const isClickable = paragraph.words.some(w => w.word.toLowerCase() === cleanWord);
      const isSaved = savedWords.has(cleanWord);
      
      return (
        <span
          key={index}
          onClick={() => isClickable && handleWordClick(cleanWord)}
          className={`${
            isClickable
              ? 'cursor-pointer hover:bg-[#EBCB75] hover:px-1 transition-colors rounded'
              : ''
          } ${
            isSaved
              ? 'bg-[#E7ECE4] px-1 rounded text-[#356B52]'
              : ''
          }`}
        >
          {word}{' '}
        </span>
      );
    });
  };

  const selectedWordData = selectedWord
    ? lessonContent.paragraphs
        .flatMap(p => p.words)
        .find(w => w.word.toLowerCase() === selectedWord)
    : null;

  return (
    <div className="min-h-screen bg-[#F7F5EF]">
      {/* Header */}
      <header className="border-b border-[#D6D3CC] bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-3 text-[#5A5F5A] hover:text-[#20231F] transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm">К дашборду</span>
          </Link>

          <div className="flex items-center gap-4">
            <div className="text-sm text-[#5A5F5A]">
              <span className="text-[#356B52] font-medium">{savedWords.size}</span> слов сохранено
            </div>
            <Link href="/review" className="btn-primary text-sm">
              Повторить
            </Link>
          </div>
        </div>
      </header>

      {/* Lesson info */}
      <div className="border-b border-[#D6D3CC] bg-white">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-[#20231F] mb-1">
                {lessonContent.title}
              </h1>
              <p className="text-[#5A5F5A]">{lessonContent.author}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="badge badge-primary">{lessonContent.level}</span>
              <span className="text-sm text-[#5A5F5A]">{lessonContent.chapter}</span>
            </div>
          </div>

          <div className="progress-bar">
            <div className="progress-fill" style={{ width: '15%' }} />
          </div>
          <p className="text-sm text-[#5A5F5A] mt-2">Прочитано 15%</p>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="bg-white rounded-2xl border border-[#D6D3CC] p-8 md:p-12 shadow-soft">
          {lessonContent.paragraphs.map((paragraph) => (
            <p key={paragraph.id} className="text-lg md:text-xl leading-relaxed text-[#20231F] mb-6 font-serif">
              {renderParagraph(paragraph)}
            </p>
          ))}

          <div className="flex items-center justify-between pt-8 border-t border-[#D6D3CC]">
            <button className="btn-ghost text-sm">
              ← Предыдущая глава
            </button>
            <button className="btn-primary text-sm">
              Следующая глава →
            </button>
          </div>
        </div>
      </main>

      {/* Word popup */}
      {selectedWordData && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md px-6 z-20">
          <div className="bg-white rounded-xl border border-[#D6D3CC] shadow-medium p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold text-[#20231F] mb-1">
                  {selectedWordData.word}
                </h3>
                <p className="text-sm text-[#5A5F5A] italic">
                  «{selectedWordData.context}»
                </p>
              </div>
              <button
                onClick={() => setSelectedWord(null)}
                className="text-[#5A5F5A] hover:text-[#20231F] transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-4">
              <div className="text-2xl font-bold text-[#356B52] mb-2">
                {selectedWordData.translation}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => handleSaveWord(selectedWord!)}
                disabled={savedWords.has(selectedWord!)}
                className="flex-1 btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savedWords.has(selectedWord!) ? 'Сохранено ✓' : 'В словарь'}
              </button>
              <button
                onClick={() => setSelectedWord(null)}
                className="btn-secondary text-sm"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay */}
      {selectedWordData && (
        <div
          className="fixed inset-0 bg-[#20231F]/20 z-10"
          onClick={() => setSelectedWord(null)}
        />
      )}
    </div>
  );
}
