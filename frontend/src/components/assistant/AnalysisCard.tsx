'use client';

export interface AssistantIssue {
  type: string;
  original: string;
  suggestion: string;
  explanation: string;
}

export interface AssistantAnalysis {
  score: number;
  isCorrect: boolean;
  issues: AssistantIssue[];
  betterVersion: string;
  praise: string;
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) return 'bg-[#4A7C59]/15 text-[#4A7C59] border border-[#4A7C59]/30';
  if (score >= 50) return 'bg-[#EBCB75]/25 text-[#8A6D1F] border border-[#EBCB75]';
  return 'bg-[#B85C5C]/10 text-[#B85C5C] border border-[#B85C5C]/30';
}

function issueTypeLabel(type: string): string {
  switch (type) {
    case 'grammar':
      return 'грамматика';
    case 'word_choice':
      return 'выбор слова';
    case 'naturalness':
      return 'естественность';
    default:
      return type;
  }
}

export default function AnalysisCard({ analysis }: { analysis: AssistantAnalysis }) {
  return (
    <div className="mt-2 rounded-xl border border-[#EBCB75]/60 bg-[#FFFDF5] p-4 animate-fade-in">
      <div className="flex items-center gap-3 mb-3">
        <span className={`badge ${scoreBadgeClass(analysis.score)}`}>{analysis.score}/100</span>
        {analysis.praise && (
          <p className="text-sm text-[#20231F] font-medium">{analysis.praise}</p>
        )}
      </div>

      {analysis.issues.length > 0 ? (
        <ul className="space-y-2 mb-3">
          {analysis.issues.map((issue, idx) => (
            <li key={idx} className="rounded-lg bg-white border border-[#D6D3CC] p-3">
              <span className="text-xs uppercase tracking-wide text-[#5A5F5A]">
                {issueTypeLabel(issue.type)}
              </span>
              <p className="text-sm mt-1">
                <span className="text-[#B85C5C]">✗ {issue.original}</span>
                <span className="text-[#5A5F5A] mx-2">→</span>
                <span className="text-[#4A7C59] font-medium">✓ {issue.suggestion}</span>
              </p>
              {issue.explanation && (
                <p className="text-xs text-[#5A5F5A] mt-1">{issue.explanation}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#4A7C59] mb-3">
          Ошибок не найдено — отличная работа!
        </p>
      )}

      {analysis.betterVersion && (
        <div className="rounded-lg bg-[#E7ECE4] p-3">
          <p className="text-xs uppercase tracking-wide text-[#356B52] mb-1">
            Как сказал бы носитель
          </p>
          <p className="text-sm text-[#20231F]">{analysis.betterVersion}</p>
        </div>
      )}
    </div>
  );
}
