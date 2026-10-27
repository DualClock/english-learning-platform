import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBulkWords } from './bulkWords.ts';

test('разбирает запятые и переносы строк, сохраняя порядок', () => {
  const preview = parseBulkWords('listen, whisper\nsilence\n\nanswer,');
  assert.deepEqual(preview.valid, ['listen', 'whisper', 'silence', 'answer']);
  assert.equal(preview.emptyCount, 2);
});

test('убирает повторы без учёта регистра', () => {
  const preview = parseBulkWords('Listen, listen\nLISTEN, whisper');
  assert.deepEqual(preview.valid, ['Listen', 'whisper']);
  assert.deepEqual(preview.duplicates, ['listen', 'LISTEN']);
});

test('помечает не-английские токены и слишком длинные слова', () => {
  const preview = parseBulkWords(`listen, привет, word123, a, ${'a'.repeat(101)}`);
  assert.deepEqual(preview.invalid.map((item) => item.value), [
    'привет',
    'word123',
    'a'.repeat(101),
  ]);
  assert.deepEqual(preview.valid, ['listen', 'a']);
});

test('ограничивает пачку пятьюдесятью словами', () => {
  const suffix = (index) =>
    String.fromCharCode(97 + Math.floor(index / 26)) +
    String.fromCharCode(97 + (index % 26));
  const input = Array.from({ length: 51 }, (_, index) => `word${suffix(index)}`).join(', ');

  const preview = parseBulkWords(input);

  assert.equal(preview.valid.length, 51);
  assert.equal(preview.exceedsLimit, true);
});
