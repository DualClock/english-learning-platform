'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface Question {
  wordId: number;
  text: string;
  options: string[];
  correctIndex: number;
}

export default function QuizPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isFinished, setIsFinished] = useState(false);

  const loadQuiz = useCallback(async () => {
    try {
      const token = session?.accessToken;
      const res = await fetch('http://localhost:5226/api/review/quiz?count=10', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) {
        router.push('/dictionary');
        return;
      }
      
      const data = await res.json();
      setQuestions(data.questions);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to load quiz:', error);
      setIsLoading(false);
    }
  }, [session, router]);

  useEffect(() => {
    if (status === 'authenticated') {
      loadQuiz();
    }
  }, [status, loadQuiz]);

  const handleAnswer = (index: number) => {
    if (showResult) return;
    
    setSelectedAnswer(index);
    setShowResult(true);
    
    if (index === questions[currentIndex].correctIndex) {
      setScore(score + 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    } else {
      setIsFinished(true);
    }
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    speechSynthesis.speak(utterance);
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-[#D6D3CC] border-t-[#356B52] rounded-full animate-spin"></div>
        </div>
      </AppLayout>
    );
  }

  if (isFinished) {
    const percentage = Math.round((score / questions.length) * 100);
    
    return (
      <AppLayout>
        <div className="max-w-md mx-auto text-center py-12">
          <div className={`w-16 h-16 mx-auto mb-6 rounded-full flex items-center justify-center ${
            percentage >= 80 ? 'bg-[#356B52]/10' : percentage >= 50 ? 'bg-[#EBCB75]/20' : 'bg-[#B85C5C]/10'
          }`}>
            <svg className={`w-8 h-8 ${
              percentage >= 80 ? 'text-[#356B52]' : percentage >= 50 ? 'text-[#8B6914]' : 'text-[#B85C5C]'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#20231F] mb-2">Тест завершён</h1>
          <p className="text-4xl font-bold text-[#356B52] my-4">{percentage}%</p>
          <p className="text-[#5A5F5A] mb-8">
            Правильно {score} из {questions.length}
          </p>
          <div className="flex gap-4 justify-center">
            <button onClick={() => { setCurrentIndex(0); setScore(0); setIsFinished(false); setSelectedAnswer(null); setShowResult(false); loadQuiz(); }} className="btn-primary">
              Ещё раз
            </button>
            <button onClick={() => router.push('/dashboard')} className="btn-secondary">
              На главную
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const currentQuestion = questions[currentIndex];

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        {/* Прогресс */}
        <div className="mb-8">
          <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
            <span>Вопрос {currentIndex + 1} из {questions.length}</span>
            <span>Score: {score}</span>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Вопрос */}
        <div className="card p-8">
          <p className="text-center text-[#5A5F5A] mb-4">Выбери правильный перевод:</p>
          
          <button
            onClick={() => speak(currentQuestion.text)}
            className="text-3xl font-bold text-[#20231F] hover:text-[#356B52] transition-colors flex items-center justify-center gap-3 mx-auto mb-8"
          >
            {currentQuestion.text}
            <svg className="w-6 h-6 text-[#5A5F5A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          </button>

          {/* Варианты ответов */}
          <div className="space-y-3">
            {currentQuestion.options.map((option, index) => {
              let buttonClass = "w-full p-4 rounded-xl border-2 text-left transition-all ";
              
              if (showResult) {
                if (index === currentQuestion.correctIndex) {
                  buttonClass += "border-[#4A7C59] bg-[#4A7C59]/10 text-[#4A7C59]";
                } else if (index === selectedAnswer) {
                  buttonClass += "border-[#B85C5C] bg-[#B85C5C]/10 text-[#B85C5C]";
                } else {
                  buttonClass += "border-[#D6D3CC] text-[#5A5F5A]";
                }
              } else {
                buttonClass += "border-[#D6D3CC] hover:border-[#356B52] hover:bg-[#E7ECE4]";
              }

              return (
                <button
                  key={index}
                  onClick={() => handleAnswer(index)}
                  disabled={showResult}
                  className={buttonClass}
                >
                  <span className="font-medium">{option}</span>
                </button>
              );
            })}
          </div>

          {/* Результат */}
          {showResult && (
            <div className="mt-6 text-center">
              <p className={`text-lg font-medium ${selectedAnswer === currentQuestion.correctIndex ? 'text-[#4A7C59]' : 'text-[#B85C5C]'}`}>
                {selectedAnswer === currentQuestion.correctIndex 
                  ? 'Правильно' 
                  : `Неправильно. Правильный ответ: ${currentQuestion.options[currentQuestion.correctIndex]}`}
              </p>
              
              <button onClick={handleNext} className="btn-primary mt-4">
                {currentIndex < questions.length - 1 ? 'Следующий вопрос' : 'Завершить'}
              </button>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}