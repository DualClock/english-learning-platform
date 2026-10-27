import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// listening.ts импортирует './reader/sentences' без расширения — так требует tsc
// (moduleResolution: bundler) и Next, а Node по умолчанию расширение не
// достраивает. Хук достраивает './x' → './x.ts' только для этого прогона, так
// что тест проверяет ровно тот модуль, который уезжает в браузер.
//
// Модуль грузится динамически ПОСЛЕ регистрации хука: статический import в начале
// файла резолвится раньше, чем выполнится registerHooks, и падает с
// ERR_MODULE_NOT_FOUND.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('.') || /\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(specifier, context);
    }

    return nextResolve(`${specifier}.ts`, context);
  },
});

const {
  CHECK_MODES,
  PLAYBACK_RATES,
  activeSentenceAt,
  answerStatus,
  applyRate,
  buildSentences,
  canAccept,
  clampSentence,
  clickSentence,
  collapsePunctuation,
  estimateDuration,
  fallbackReasonLabel,
  formatRate,
  gapQuestion,
  isClozeComplete,
  moveCurrent,
  nextMode,
  nextRate,
  nextSentence,
  normalizeAnswer,
  normalizeMode,
  normalizeRate,
  paragraphBounds,
  parseLastStory,
  parsePosition,
  positionKey,
  prevSentence,
  primaryActionLabel,
  progressFraction,
  remainingLabel,
  seekTarget,
  sentenceTimings,
  serializeLanding,
  serializePosition,
  totalDuration,
  transition,
  typeAnswer,
} = await import('./listening.ts');

const STORY = [
  'One rainy morning, Mia heard a small sound. It was very quiet.',
  'Mr. Smith came later. He brought tea!',
];

test('рассказ режется на предложения через общий разбиватель читалки', () => {
  const sentences = buildSentences(STORY);

  assert.deepEqual(
    sentences.map((s) => s.text),
    [
      'One rainy morning, Mia heard a small sound.',
      'It was very quiet.',
      'Mr. Smith came later.',
      'He brought tea!',
    ],
  );
  // сокращение не рвёт предложение — иначе подсветка прыгала бы на «Mr.»
  assert.equal(sentences[2].text, 'Mr. Smith came later.');
});

test('нумерация предложений сквозная, абзацы запоминаются', () => {
  const sentences = buildSentences(STORY);

  assert.deepEqual(
    sentences.map((s) => [s.index, s.paragraph]),
    [
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ],
  );
});

test('пустой текст и пустые абзацы дают пустой список, а не пустое предложение', () => {
  assert.deepEqual(buildSentences([]), []);
  assert.deepEqual(buildSentences(['', '   ']), []);
  assert.deepEqual(buildSentences(null), []);
  assert.deepEqual(buildSentences(undefined), []);
});

test('границы абзацев: первое и последнее предложение каждого', () => {
  const bounds = paragraphBounds(buildSentences(STORY));

  assert.deepEqual(bounds.get(0), { first: 0, last: 1 });
  assert.deepEqual(bounds.get(1), { first: 2, last: 3 });
});

test('переходы автомата: штатный путь idle → loading → playing → paused → playing → ended', () => {
  let state = transition('idle', { type: 'play' });
  assert.equal(state, 'loading');

  state = transition(state, { type: 'loaded' });
  assert.equal(state, 'playing');

  state = transition(state, { type: 'pause' });
  assert.equal(state, 'paused');

  state = transition(state, { type: 'resume' });
  assert.equal(state, 'playing');

  state = transition(state, { type: 'finish' });
  assert.equal(state, 'ended');
});

test('запрещённые переходы не меняют состояние', () => {
  // пауза без звука — самая частая ошибка «умного» плеера
  assert.equal(transition('idle', { type: 'pause' }), null);
  assert.equal(transition('idle', { type: 'resume' }), null);
  assert.equal(transition('idle', { type: 'finish' }), null);
  assert.equal(transition('ended', { type: 'pause' }), null);
  assert.equal(transition('ended', { type: 'resume' }), null);
  // «загрузилось» без запроса — не наше событие
  assert.equal(transition('idle', { type: 'loaded' }), null);
  assert.equal(canAccept('idle', 'pause'), false);
  assert.equal(canAccept('playing', 'pause'), true);
});

test('поздний ответ сервера не возвращает в playing после стопа', () => {
  // именно это ломало озвучку: человек нажал стоп или выбрал другое предложение,
  // а пришедший через 6 секунд ответ запускал старый звук
  const stopped = transition('loading', { type: 'stop' });
  assert.equal(stopped, 'idle');
  assert.equal(transition(stopped, { type: 'loaded' }), null);
});

test('промах озвучки возвращает в idle, а не в вечную загрузку', () => {
  assert.equal(transition('loading', { type: 'fail' }), 'idle');
  assert.equal(transition('playing', { type: 'fail' }), 'idle');
});

test('подпись главной кнопки соответствует состоянию', () => {
  assert.equal(primaryActionLabel('idle'), 'Слушать');
  assert.equal(primaryActionLabel('loading'), 'Озвучиваю…');
  assert.equal(primaryActionLabel('playing'), 'Пауза');
  assert.equal(primaryActionLabel('paused'), 'Продолжить');
  assert.equal(primaryActionLabel('ended'), 'Слушать снова');
});

test('скорости только 0.75 / 1.0 / 1.25, переключаются по кругу', () => {
  assert.deepEqual([...PLAYBACK_RATES], [0.75, 1.0, 1.25]);
  assert.equal(nextRate(0.75), 1.0);
  assert.equal(nextRate(1.0), 1.25);
  assert.equal(nextRate(1.25), 0.75);
  assert.equal(nextRate(0.75, -1), 1.25);
  assert.equal(formatRate(0.75), '0.75×');
  assert.equal(formatRate(1.0), '1×');
});

test('неизвестная скорость приводится к ближайшей допустимой', () => {
  assert.equal(normalizeRate(1.1), 1.0);
  assert.equal(normalizeRate(0.9), 1.0);
  assert.equal(normalizeRate('1.25'), 1.25);
  assert.equal(normalizeRate('abc'), 1.0);
  assert.equal(normalizeRate(null), 1.0);
  assert.equal(normalizeRate(undefined), 1.0);
  assert.equal(normalizeRate(7), 1.25);
});

test('скорость делит время, но не текст', () => {
  assert.equal(applyRate(10, 1.0), 10);
  assert.equal(applyRate(10, 0.75), 10 / 0.75);
  assert.equal(applyRate(10, 1.25), 8);
  assert.equal(applyRate(0, 1.25), 0);
  assert.equal(applyRate(Number.NaN, 1.25), 0);
});

test('подсветка на границах предложений: правая граница отдана следующему', () => {
  const timings = sentenceTimings(buildSentences(STORY));
  const [first, second] = timings;

  assert.equal(activeSentenceAt(timings, 0), 0);
  assert.equal(activeSentenceAt(timings, first.end - 0.01), 0);
  assert.equal(activeSentenceAt(timings, first.end), 1);
  assert.equal(activeSentenceAt(timings, second.start), 1);
});

test('за концом звучания подсветка остаётся на последнем предложении', () => {
  const timings = sentenceTimings(buildSentences(STORY));
  const total = totalDuration(timings);

  assert.equal(activeSentenceAt(timings, total + 5), 3);
  assert.equal(activeSentenceAt(timings, 0.001), 0);
});

test('пустой рассказ: подсветки нет, время и прогресс не NaN', () => {
  const timings = sentenceTimings([]);

  assert.deepEqual(timings, []);
  assert.equal(activeSentenceAt(timings, 3), -1);
  assert.equal(totalDuration(timings), 0);
  assert.equal(progressFraction(timings, 1), 0);
  assert.equal(seekTarget(timings, 0), 0);
  assert.equal(clampSentence(0, 3), -1);
});

test('измеренные длительности перебивают оценку', () => {
  const sentences = buildSentences(['Short. Longer one.']);
  const measured = new Map([[0, 2], [1, 4]]);
  const timings = sentenceTimings(sentences, measured);

  assert.equal(timings[0].start, 0);
  assert.equal(timings[0].end, 2);
  assert.equal(timings[1].start, 2);
  assert.equal(timings[1].end, 6);
  assert.equal(seekTarget(timings, 1), 2);
});

test('оценка длительности: минимум 0.8 с, пустое — ноль', () => {
  assert.equal(estimateDuration(''), 0);
  assert.equal(estimateDuration('   '), 0);
  assert.ok(estimateDuration('One.') >= 0.8);
  assert.ok(estimateDuration('One two three four five six') > estimateDuration('One.'));
});

test('клик по активному предложению перематывает в его начало', () => {
  const sentences = buildSentences(STORY);
  const timings = sentenceTimings(sentences);

  // уже играет 2-е, кликнули по нему же — адрес тот же, перемотка на start
  const active = activeSentenceAt(timings, timings[2].start + 0.2);
  assert.equal(active, 2);
  assert.equal(clickSentence(sentences.length, active), 2);
  assert.equal(seekTarget(timings, 2), timings[2].start);
});

test('prev/next упираются в края, клик вне диапазона зажимается', () => {
  assert.equal(nextSentence(4, 3), 3);
  assert.equal(prevSentence(4, 0), 0);
  assert.equal(nextSentence(4, 1), 2);
  assert.equal(prevSentence(4, 2), 1);
  assert.equal(clickSentence(4, 99), 3);
  assert.equal(clickSentence(4, -7), 0);
  assert.equal(prevSentence(0, 0), -1);
  assert.equal(nextSentence(0, 0), -1);
});

test('прогресс полосы и остаток времени', () => {
  const timings = sentenceTimings(buildSentences(STORY), new Map([[0, 10], [1, 10], [2, 10], [3, 10]]));

  assert.equal(totalDuration(timings), 40);
  assert.equal(progressFraction(timings, 20), 0.5);
  assert.equal(progressFraction(timings, -5), 0);
  assert.equal(progressFraction(timings, 100), 1);
  assert.equal(remainingLabel(40), '40 с');
  assert.equal(remainingLabel(80), '1 мин 20 с');
  assert.equal(remainingLabel(180), '3 мин');
  assert.equal(remainingLabel(0), '0 с');
  assert.equal(remainingLabel(-3), '0 с');
});

test('сохранённое место: только свой рассказ, битое значение не роняет', () => {
  const raw = serializePosition({ storyId: 'lost-kitten', sentence: 7, rate: 1.25 });
  const parsed = parsePosition(raw, 'lost-kitten');

  assert.deepEqual(parsed, { storyId: 'lost-kitten', sentence: 7, rate: 1.25 });
  // чужой рассказ — начинаем сначала
  assert.equal(parsePosition(raw, 'other-story'), null);
  assert.equal(parsePosition(null, 'lost-kitten'), null);
  assert.equal(parsePosition('{не json', 'lost-kitten'), null);
  assert.equal(parsePosition('[]', 'lost-kitten'), null);
  assert.equal(parsePosition('{"storyId":"lost-kitten"}', 'lost-kitten'), null);
  assert.equal(positionKey('lost-kitten'), 'lexicon.listening.position.lost-kitten');
});

// ---------------------------------------------------------------------------
// Режимы прослушивания
// ---------------------------------------------------------------------------

test('режим «весь рассказ» идёт сквозняком через все предложения и упирается в конец', () => {
  // раньше проверялся только одиночный шаг, а не весь проход
  const count = 5;
  let index = 0;
  const visited = [index];

  while (index < count - 1) {
    index = moveCurrent('story', count, index);
    visited.push(index);
  }

  assert.deepEqual(visited, [0, 1, 2, 3, 4]);
  // на последнем предложении «дальше» больше не двигает — рассказ кончился
  assert.equal(moveCurrent('story', count, index), count - 1);
  assert.equal(moveCurrent('story', count, 99), count - 1);
  assert.equal(moveCurrent('story', 0, 0), -1);
});

test('режим «предложение за предложением» меняет место только по команде', () => {
  // в этом режиме очередь не идёт сама: место стоит, пока человек не нажал
  assert.equal(moveCurrent('sentence', 5, 2), 2);
  assert.equal(moveCurrent('sentence', 5, 2, 'next'), 3);
  assert.equal(moveCurrent('sentence', 5, 2, 'prev'), 1);
  assert.equal(moveCurrent('sentence', 5, 0, 'prev'), 0);
  assert.equal(moveCurrent('sentence', 0, 0), -1);
});

test('режимы переключаются по кругу, неизвестный режим приводится к «весь рассказ»', () => {
  assert.deepEqual([...CHECK_MODES], ['story', 'sentence']);
  assert.equal(nextMode('story'), 'sentence');
  assert.equal(nextMode('sentence'), 'story');
  assert.equal(normalizeMode('sentence'), 'sentence');
  assert.equal(normalizeMode('story'), 'story');
  assert.equal(normalizeMode('nonsense'), 'story');
  assert.equal(normalizeMode(null), 'story');
  assert.equal(normalizeMode(undefined), 'story');
});

test('перемотка на уже активное предложение возвращает его начало, а не следующее', () => {
  const sentences = buildSentences(STORY);
  const timings = sentenceTimings(sentences);
  const active = activeSentenceAt(timings, timings[1].start + 0.3);

  assert.equal(active, 1);
  // тот же адрес — значит плеер перезапустит его с начала, а не уедет на 2
  assert.equal(clickSentence(sentences.length, active), 1);
  assert.equal(seekTarget(timings, 1), timings[1].start);
  assert.equal(activeSentenceAt(timings, timings[1].start), 1);
});

// ---------------------------------------------------------------------------
// Проверка понимания
// ---------------------------------------------------------------------------

test('ответ сравнивается без регистра и пунктуации', () => {
  assert.equal(normalizeAnswer('  warm Towel!  '), 'warm towel');
  assert.equal(normalizeAnswer('Mia,'), 'mia');
  assert.equal(normalizeAnswer('“kitten.”'), 'kitten');
  assert.equal(normalizeAnswer(''), '');
  assert.equal(normalizeAnswer(null), '');
  assert.equal(answerStatus('Warm towel', 'warm towel.'), 'correct');
});

test('опечатка в ответе засчитывается частично, а не молча проваливается', () => {
  // человек слышит правильно, но набирает с ошибкой — это не «не понял»,
  // а орфография, и ему нужно сказать именно это
  // «towel» → «towle»: перестановка букв — опечатка в наборе, а не непонимание
  assert.equal(answerStatus('towel', 'towle'), 'close');
  assert.equal(answerStatus('sleeping', 'sleepping'), 'close');
  // а вот другое слово — уже непонимание, даже если отличается одной буквой:
  // лишняя буква и чужая буква — разные вещи. «warm»/«worm» — разные слова,
  // и засчитать их как «почти» значит соврать про понимание на слух
  assert.equal(answerStatus('warm', 'worm'), 'wrong');
  assert.equal(answerStatus('kitten', 'mitten'), 'wrong');
  assert.equal(answerStatus('towel', 'table'), 'wrong');
  assert.equal(answerStatus('quiet', 'very'), 'wrong');
});

test('пустой ответ — не «близко», а «пусто»', () => {
  // иначе можно нажать «Проверить» и получить частичный зачёт за ничего
  assert.equal(answerStatus('towel', ''), 'empty');
  assert.equal(answerStatus('towel', '   '), 'empty');
  assert.equal(answerStatus('towel', '...'), 'empty');
  assert.equal(answerStatus('towel', '!!!'), 'empty');
  assert.equal(answerStatus('', ''), 'empty');
  assert.equal(isClozeComplete('towel', ''), false);
  assert.equal(isClozeComplete('towel', '...'), false);
  assert.equal(isClozeComplete('towel', 'towel'), true);
  assert.equal(isClozeComplete('towel', 'towle'), true);
});

test('русский перевод отвечает по тем же правилам: регистр и ё не мешают', () => {
  // ё/е — самая частая «опечатка» в русской раскладке
  assert.equal(answerStatus('котёнок', 'Котенок'), 'correct');
  assert.equal(answerStatus('котёнок', 'котенок'), 'correct');
  // другая форма слова — это не опечатка в наборе, а недослышанное слово
  assert.equal(answerStatus('котёнок', 'кот'), 'wrong');
  assert.equal(answerStatus('котёнок', 'собака'), 'wrong');
});

test('вписывание слова режет ровно нужное слово и не трогает пунктуацию', () => {
  // точка в конце — конец предложения, а не часть слова: место для ввода
  // встаёт перед ней, иначе поле «слипалось» бы со знаком
  const question = gapQuestion('Mia gave it a warm towel.', 'towel');
  assert.notEqual(question, null);
  assert.equal(question.display, 'Mia gave it a warm ___.');

  // апостроф внутри слова — часть слова
  const possessive = gapQuestion("He found the kitten's home.", "kitten's");
  assert.equal(possessive.display, 'He found the ___ home.');
});

test('вписывание слова не трогает русский текст и слишком короткие слова', () => {
  // «a»/«I» выкидывать нельзя: в предложении они иногда больше его половины,
  // а угадать их без понимания легче, чем выучить
  assert.equal(gapQuestion('Привет, мир.', 'мир'), null);
  assert.equal(gapQuestion('He brought tea!', 'a'), null);
  assert.equal(gapQuestion('', 'tea'), null);
  assert.equal(gapQuestion('He brought tea!', ''), null);
});

test('в поле ввода буква дописывается, а Backspace стирает посимвольно', () => {
  assert.equal(typeAnswer('warm', 'tow'), 'warmtow');
  // Backspace с известным фрагментом (выделение)
  assert.equal(typeAnswer('warmtow', 'tow', true), 'warm');
  // Backspace без фрагмента приходит пустой строкой — это удаление, а не «ничего»
  assert.equal(typeAnswer('warmtow', '', true), 'warmto');
  // пустой input без пометки удаления — композиция IME, строку не трогаем
  assert.equal(typeAnswer('warm', ''), 'warm');
  assert.equal(typeAnswer('', 'x'), 'x');
  // уже набранное не дублируется (повторный символ из автоповтора)
  assert.equal(typeAnswer('worm', 'm'), 'worm');
});

test('collapsePunctuation убирает пунктуацию, но не буквы и не пробелы между словами', () => {
  assert.equal(collapsePunctuation('Well-known, isn’t it?'), 'well known isnt it');
  assert.equal(collapsePunctuation('кот-то, «молоко»!'), 'кот то молоко');
  assert.equal(collapsePunctuation('  a  b  '), 'a b');
});

// ---------------------------------------------------------------------------
// Выбор рассказа и честность бейджа
// ---------------------------------------------------------------------------

test('выбор рассказа: последний рассказ запоминается и валидируется', () => {
  assert.equal(parseLastStory(serializeLanding({ storyId: 'the-lost-kitten' }), 8), 'the-lost-kitten');
  // рассказ удалили из сида — не остаёмся на пустом месте
  assert.equal(parseLastStory(serializeLanding({ storyId: 'gone' }), 0), null);
  assert.equal(parseLastStory(null, 8), null);
  assert.equal(parseLastStory('{не json', 8), null);
  assert.equal(parseLastStory('{"storyId":5}', 8), null);
  assert.equal(parseLastStory('{"storyId":""}', 8), null);
});

test('бейдж базовой озвучки называет причину, а причины не совпадают', () => {
  assert.notEqual(fallbackReasonLabel('quota'), fallbackReasonLabel('timeout'));
  assert.notEqual(fallbackReasonLabel('error'), fallbackReasonLabel('quota'));
  assert.ok(fallbackReasonLabel('quota').includes('квот'));
});

test('скорость доходит и до браузерного голоса: rate — число, оценка времени сжимается', () => {
  // значение уходит в SpeechSynthesisUtterance.rate как есть; useSpeech его не
  // принимает (NEEDS), поэтому плеер ставит rate на utterance сам
  assert.equal(normalizeRate(0.75), 0.75);
  assert.equal(normalizeRate(1.25), 1.25);
  assert.ok(applyRate(10, 1.25) < applyRate(10, 0.75));
});
