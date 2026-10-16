'use client';

import BookCover from './BookCover';
import LevelChip from './LevelChip';

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
    <div className="flex gap-4 rounded-2xl border border-[var(--color-hairline-strong)] bg-white p-4 transition-all duration-200 hover:border-[var(--color-primary-pressed)] hover:shadow-md">
      <BookCover
        title={story.title}
        coverUrl={story.coverUrl}
        className="aspect-[2/3] w-14 shrink-0 rounded-lg"
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate font-semibold text-[var(--color-ink)]">{story.title}</h3>
          <LevelChip level={story.cefrLevel} />
        </div>
        {story.description && (
          <p className="mt-1 line-clamp-2 text-sm text-[var(--color-slate)]">{story.description}</p>
        )}
        <div className="mt-3">
          {addedBookId !== null ? (
            <button
              onClick={() => onOpen(addedBookId)}
              className="btn-secondary py-1.5 px-4 text-sm"
            >
              Открыть
            </button>
          ) : (
            <button
              onClick={() => onAdd(story)}
              disabled={adding}
              className="btn-primary py-1.5 px-4 text-sm disabled:opacity-60"
            >
              {adding ? 'Добавляем…' : 'Добавить и читать'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
