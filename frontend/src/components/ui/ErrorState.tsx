import { type ReactNode } from 'react';
import EmptyState from './EmptyState';
import Button from './Button';

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Второй выход из ошибки: ссылка назад, повтор later, поддержка. */
  action?: ReactNode;
}

export default function ErrorState({
  title = 'Не удалось загрузить данные',
  description = 'Что-то пошло не так при соединении с сервером. Проверь подключение и попробуй ещё раз.',
  onRetry,
  retryLabel = 'Попробовать снова',
  action,
}: ErrorStateProps) {
  const actions = (
    <>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
      {action}
    </>
  );
  return (
    <EmptyState
      lexi="sleep"
      title={title}
      description={description}
      action={onRetry || action ? actions : undefined}
    />
  );
}
