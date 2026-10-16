'use client';

interface StepProps {
  onNext: () => void;
}

export default function StepWelcome({ onNext }: StepProps) {
  return (
    <div className="min-h-screen bg-[#F7F5EF] flex flex-col items-center justify-center p-6">
      {/* Лого */}
      <div className="mb-12">
        <h1 className="text-3xl font-bold text-[#20231F]">Lexicon</h1>
      </div>

      {/* Иллюстрация — книга в руках */}
      <div className="relative mb-12">
        <div className="w-48 h-48 bg-[#E7ECE4] rounded-full flex items-center justify-center">
          <span className="text-7xl">📚</span>
        </div>
        <div className="absolute -bottom-2 -right-2 w-16 h-16 bg-[#EBCB75] rounded-full flex items-center justify-center text-2xl">
          ✨
        </div>
      </div>

      {/* Текст */}
      <h2 className="text-2xl font-bold text-[#20231F] text-center mb-4">
        Добро пожаловать!
      </h2>
      <p className="text-[#5A5F5A] text-center max-w-sm mb-12">
        Учи английский через настоящие книги, а не скучные учебники
      </p>

      {/* Кнопка */}
      <button
        onClick={onNext}
        className="btn-primary w-full max-w-xs py-4 text-lg"
      >
        Начать →
      </button>

      {/* Уже есть аккаунт */}
      <a href="/login" className="mt-6 text-[#5A5F5A] hover:text-[#20231F]">
        У меня уже есть аккаунт
      </a>
    </div>
  );
}