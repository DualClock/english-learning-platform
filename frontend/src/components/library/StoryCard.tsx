'use client';

import BookCard from './BookCard';

/**
 * Рассказ для уровня. Отличается от классики только типом на карточке —
 * геометрия общая, см. BookCard.
 */
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
    <BookCard
      kind="story"
      title={story.title}
      description={story.description}
      level={story.cefrLevel}
      coverUrl={story.coverUrl}
      addedBookId={addedBookId}
      adding={adding}
      onAdd={() => onAdd(story)}
      onOpen={onOpen}
    />
  );
}
