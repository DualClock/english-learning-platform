/**
 * Выбор движка озвучки для конкретного текста.
 *
 * Серверный Gemini-TTS (голос Kore) звучит заметно живее браузерного синтезатора,
 * но он обучен на английском и на кириллице начинает читать по-английски, то есть
 * русский перевод слово в слово превращается в кашу. Поэтому правило простое:
 * латиница — на сервер, кириллица — в браузер, где есть нормальный русский голос.
 */

const CYRILLIC = /[А-Яа-яЁё]/;
const LATIN = /[A-Za-z]/;

/** Кириллических букв больше, чем латинских — текст считаем русским. */
export function isMostlyCyrillic(text: string): boolean {
  let cyrillic = 0;
  let latin = 0;

  for (const char of text) {
    if (CYRILLIC.test(char)) cyrillic += 1;
    else if (LATIN.test(char)) latin += 1;
  }

  return cyrillic > latin;
}

/**
 * Идти ли за серверным аудио. Пустой текст не отправляем никогда: сервер
 * всё равно вернёт null, а запрос уже стоит места в очереди и в квоте.
 */
export function shouldUseServerTts(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  return !isMostlyCyrillic(clean);
}
