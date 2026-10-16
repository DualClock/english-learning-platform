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
  if (score >= 80) return 'bg-[rgba(26,156,60,0.15)] text-[var(--color-success)] border border-[rgba(26,156,60,0.30)]';
  if (score >= 50) return 'bg-[rgba(249,231,159,0.25)] text-[#7A3A00] border border-[var(--color-tint-yellow-bold)]';
  return 'bg-[rgba(217,45,32,0.10)] text-[var(--color-error)] border border-[rgba(217,45,32,0.30)]';
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
    <div className="mt-2 rounded-xl border border-[rgba(249,231,159,0.60)] bg-[var(--color-tint-yellow)] p-4 animate-fade-in">
      <div className="flex items-center gap-3 mb-3">
        <span className={`badge ${scoreBadgeClass(analysis.score)}`}>{analysis.score}/100</span>
        {analysis.praise && (
          <p className="text-sm text-[var(--color-ink)] font-medium">{analysis.praise}</p>
        )}
      </div>

      {analysis.issues.length > 0 ? (
        <ul className="space-y-2 mb-3">
          {analysis.issues.map((issue, idx) => (
            <li key={idx} className="rounded-lg bg-white border border-[var(--color-hairline-strong)] p-3">
              <span className="text-xs uppercase tracking-wide text-[var(--color-slate)]">
                {issueTypeLabel(issue.type)}
              </span>
              <p className="text-sm mt-1">
                <span className="text-[var(--color-error)]">✗ {issue.original}</span>
                <span className="text-[var(--color-slate)] mx-2">→</span>
                <span className="text-[var(--color-success)] font-medium">✓ {issue.suggestion}</span>
              </p>
              {issue.explanation && (
                <p className="text-xs text-[var(--color-slate)] mt-1">{issue.explanation}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--color-success)] mb-3">
          Ошибок не найдено — отличная работа!
        </p>
      )}

      {analysis.betterVersion && (
        <div className="rounded-lg bg-[var(--color-tint-mint)] p-3">
          <p className="text-xs uppercase tracking-wide text-[var(--color-primary)] mb-1">
            Как сказал бы носитель
          </p>
          <p className="text-sm text-[var(--color-ink)]">{analysis.betterVersion}</p>
        </div>
      )}
    </div>
  );
}
