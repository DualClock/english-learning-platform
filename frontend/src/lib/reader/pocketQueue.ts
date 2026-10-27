import type { UpsertPocketPayload } from './api';

/**
 * Карман не должен терять слово, если человек закрыл вкладку раньше ответа
 * сервера. Держим маленькую очередь в localStorage и досылаем при следующем
 * открытии читалки. Ключ включает книгу и предложение: одно и то же слово в
 * разных местах — это разные встречи.
 */
export interface PocketQueueEntry extends UpsertPocketPayload {
  bookId: number;
  createdAt: number;
}

const QUEUE_KEY = 'reader_pocket_queue_v1';
const MAX_QUEUE = 100;

export function pocketQueueKey(entry: PocketQueueEntry): string {
  return `${entry.bookId}|${entry.chapterId}|${entry.sentenceId}|${entry.word.toLowerCase()}`;
}

export function readPocketQueue(): PocketQueueEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PocketQueueEntry =>
        Boolean(item) &&
        typeof item.bookId === 'number' &&
        typeof item.word === 'string' &&
        typeof item.chapterId === 'string' &&
        typeof item.sentenceId === 'string'
    );
  } catch {
    return [];
  }
}

function writePocketQueue(entries: PocketQueueEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(entries.slice(-MAX_QUEUE)));
  } catch {
    // очередь — страховка, а не условие чтения
  }
}

export function enqueuePocket(entry: PocketQueueEntry): void {
  const entries = readPocketQueue().filter((item) => pocketQueueKey(item) !== pocketQueueKey(entry));
  entries.push(entry);
  writePocketQueue(entries);
}

export function removePocketFromQueue(entry: PocketQueueEntry): void {
  writePocketQueue(
    readPocketQueue().filter((item) => pocketQueueKey(item) !== pocketQueueKey(entry))
  );
}

/**
 * Досылает очередь по порядку. Успех и «сервер отверг навсегда» (400/404)
 * снимают запись; сетевой сбой оставляет её до следующего открытия.
 */
export async function flushPocketQueue(
  send: (entry: PocketQueueEntry) => Promise<{ ok: boolean; drop?: boolean }>,
  shouldSend: (entry: PocketQueueEntry) => boolean = () => true
): Promise<void> {
  const entries = readPocketQueue();
  for (const entry of entries) {
    if (!shouldSend(entry)) continue;

    try {
      const result = await send(entry);
      if (result.ok || result.drop) {
        removePocketFromQueue(entry);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}
