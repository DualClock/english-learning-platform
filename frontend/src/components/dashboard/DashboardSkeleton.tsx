export default function DashboardSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden="true">
      {/* Шапка */}
      <div className="mb-8">
        <div className="h-4 w-40 bg-[#E7ECE4] rounded mb-3"></div>
        <div className="h-8 w-72 bg-[#E7ECE4] rounded mb-3"></div>
        <div className="h-4 w-96 max-w-full bg-[#E7ECE4] rounded"></div>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="bg-white rounded-2xl border border-[#D6D3CC] p-5 flex items-center gap-4"
          >
            <div className="w-11 h-11 rounded-xl bg-[#E7ECE4] shrink-0"></div>
            <div className="flex-1">
              <div className="h-7 w-12 bg-[#E7ECE4] rounded mb-2"></div>
              <div className="h-3 w-24 bg-[#E7ECE4] rounded"></div>
            </div>
          </div>
        ))}
      </div>

      {/* Главная карточка */}
      <div className="h-5 w-44 bg-[#E7ECE4] rounded mb-4"></div>
      <div className="bg-white rounded-2xl border border-[#D6D3CC] p-6 flex flex-col sm:flex-row gap-6 mb-8">
        <div className="w-28 aspect-[3/4] bg-[#E7ECE4] rounded-xl shrink-0"></div>
        <div className="flex-1 flex flex-col justify-center">
          <div className="h-6 w-64 max-w-full bg-[#E7ECE4] rounded mb-3"></div>
          <div className="h-4 w-40 bg-[#E7ECE4] rounded mb-5"></div>
          <div className="h-2 w-full max-w-md bg-[#E7ECE4] rounded-full mb-6"></div>
          <div className="h-11 w-40 bg-[#E7ECE4] rounded-lg"></div>
        </div>
      </div>

      {/* Быстрые действия */}
      <div className="h-5 w-40 bg-[#E7ECE4] rounded mb-4"></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-2xl border border-[#D6D3CC] p-4">
            <div className="w-10 h-10 rounded-xl bg-[#E7ECE4] mb-3"></div>
            <div className="h-4 w-24 bg-[#E7ECE4] rounded mb-2"></div>
            <div className="h-3 w-20 bg-[#E7ECE4] rounded"></div>
          </div>
        ))}
      </div>
    </div>
  );
}
