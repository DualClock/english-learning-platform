'use client';

import { CheckIcon, CloseIcon } from '@/components/ui/icons';

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

/**
 * Оценка внутри жёлтой карточки: тон плашки совпал бы с тоном бейджа,
 * поэтому цифра получает цвет, а подложка — нейтральную.
 */
function scoreClass(score: number): string {
  if (score >= 80) return 'text-semantic-success';
  if (score >= 50) return 'text-on-warning';
  return 'text-semantic-error';
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
    <div className="animate-fade-in mt-2 rounded-xl border border-hairline bg-surface-warning p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className={`badge bg-canvas ${scoreClass(analysis.score)}`}>{analysis.score}/100</span>
        {analysis.praise && (
          <p className="text-body-sm font-medium text-ink">{analysis.praise}</p>
        )}
      </div>

      {analysis.issues.length > 0 ? (
        <ul className="stagger mb-3 space-y-2">
          {analysis.issues.map((issue, idx) => (
            <li key={idx} className="rounded-lg border border-hairline bg-canvas p-3">
              <span className="text-caption uppercase tracking-wide text-slate">
                {issueTypeLabel(issue.type)}
              </span>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                <span className="inline-flex items-center gap-1 text-semantic-error">
                  <CloseIcon size={16} />
                  {issue.original}
                </span>
                <span className="text-slate">→</span>
                <span className="inline-flex items-center gap-1 font-medium text-semantic-success">
                  <CheckIcon size={16} />
                  {issue.suggestion}
                </span>
              </p>
              {issue.explanation && (
                <p className="mt-1 text-caption text-slate">{issue.explanation}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-body-sm text-semantic-success">
          Ошибок не найдено — отличная работа!
        </p>
      )}

      {analysis.betterVersion && (
        <div className="rounded-lg bg-surface-success p-3">
          <p className="mb-1 text-caption uppercase tracking-wide text-on-success">
            Как сказал бы носитель
          </p>
          <p className="text-body-sm text-ink">{analysis.betterVersion}</p>
        </div>
      )}
    </div>
  );
}
