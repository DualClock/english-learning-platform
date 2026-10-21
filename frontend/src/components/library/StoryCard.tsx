'use client';

import BookCover from './BookCover';
import LevelChip from '@/components/ui/LevelChip';
import Button from '@/components/ui/Button';

export interface Story {
  index: number;
  title: string;
  cefrLevel?: string;
  description?: string;
  coverUrl?: string;
  alreadyAdded?: boolean;
}

interface StoryCardProps {
  story: Story;
  addedBookId: number | null;
  adding: boolean;
  onAdd: (story: Story) => void;
  onOpen: (id: number) => void;
}

export default function StoryCard({ story, addedBookId, adding, onAdd, onOpen }: StoryCardProps) {
  return (
    <article className="card flex gap-4">
      <BookCover
        title={story.title}
        coverUrl={story.coverUrl}
        className="aspect-book w-14"
        size="sm"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-h3 text-ink">{story.title}</h3>
          <LevelChip level={story.cefrLevel} />
        </div>
        {story.description && (
          <p className="mt-1 line-clamp-2 text-body-sm text-slate">{story.description}</p>
        )}
        <div className="mt-auto pt-3">
          {addedBookId !== null ? (
            <Button variant="secondary" onClick={() => onOpen(addedBookId)}>
              Открыть
            </Button>
          ) : (
            <Button onClick={() => onAdd(story)} disabled={adding}>
              {adding ? 'Добавляем…' : 'Добавить и читать'}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
