import EmptyState from './EmptyState';
import { AlertIcon } from './icons';
import Button from './Button';

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export default function ErrorState({
  title = 'Не удалось загрузить данные',
  description = 'Что-то пошло не так при соединении с сервером. Проверь подключение и попробуй ещё раз.',
  onRetry,
  retryLabel = 'Попробовать снова',
}: ErrorStateProps) {
  return (
    <EmptyState
      icon={<AlertIcon size={24} className="text-semantic-error" />}
      title={title}
      description={description}
      action={onRetry ? <Button variant="secondary" onClick={onRetry}>{retryLabel}</Button> : undefined}
    />
  );
}
