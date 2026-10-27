export const FEEDBACK_OPEN_EVENT = 'lexicon:feedback:open';

/** Открыть форму отзыва из любого места: модалка слушает это событие. */
export function openFeedback() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FEEDBACK_OPEN_EVENT));
  }
}
