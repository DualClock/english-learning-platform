import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  COHORT_DAYS,
  COHORT_FAQ,
  COHORT_SEATS,
  COHORT_START_ISO,
  FAKE_SEATS_LEFT,
  FEEDBACK_CHECKPOINTS,
  FORBIDDEN_PROMISES,
  addIsoDays,
  checkpointSchedule,
  cohortDates,
  cohortDayNumber,
  cohortEndIso,
  cohortPhase,
  formatRuDate,
  formatRuDay,
  isoFromDate,
} from './beta.ts';

/*
 * Контракт страницы когорты (W3.3).
 *
 * /beta — единственная цель всех писем и постов из outreach-кита, и её текст
 * обещает две вещи, за которые отвечает не только маркетинг: расписание
 * (2 → 15 ноября, 14 дней, два отзыва) и лимит мест. Первая часть — чистая
 * арифметика дат, её легко сломать сдвигом старта; вторая — список того, чего
 * в продукте нет, и он же причина, почему страница не показывает «осталось 12
 * мест». Проверки ниже читают и саму страницу: JSX-разметка без SSR-тестов
 * остаётся единственным местом, где эти обещания можно сверить.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(join(here, ...segments), 'utf8');

const betaPage = read('..', 'app', 'beta', 'page.tsx');
const sitemap = read('..', 'app', 'sitemap.ts');
const middleware = read('..', 'middleware.ts');
const testPage = read('..', 'app', 'test', 'page.tsx');
const landing = read('..', 'app', 'page.tsx');

test('расписание: 14 дней со 2 ноября заканчиваются 15 ноября', () => {
  const dates = cohortDates();
  assert.equal(dates.length, COHORT_DAYS);
  assert.equal(dates[0], '2026-11-02');
  assert.equal(dates[COHORT_DAYS - 1], '2026-11-15');
  assert.equal(cohortEndIso(), '2026-11-15');
  // Соседние даты всегда расходятся ровно на сутки: без пропусков и дублей
  // расписание на странице выглядит рядом дат, а не календарной кашей.
  for (let i = 1; i < dates.length; i += 1) {
    assert.equal(addIsoDays(dates[i - 1], 1), dates[i]);
  }
});

test('расписание не боится границы месяца и года', () => {
  // Тот же аддитивный счёт, что и у когорты, но на краях календаря.
  assert.equal(addIsoDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addIsoDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addIsoDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addIsoDays('2028-02-27', 2), '2028-02-29');
  // Несуществующая дата — ошибка, а не молчаливый перенос на март.
  assert.throws(() => addIsoDays('2027-02-30', 1), TypeError);
  assert.throws(() => cohortDates('2026-11-2'), TypeError);
});

test('фаза когорты: набор → чтение → всё прошло', () => {
  assert.equal(cohortPhase('2026-11-01'), 'signups');
  assert.equal(cohortPhase(COHORT_START_ISO), 'reading');
  assert.equal(cohortPhase('2026-11-08'), 'reading');
  assert.equal(cohortPhase('2026-11-15'), 'reading');
  assert.equal(cohortPhase('2026-11-16'), 'finished');
  assert.equal(cohortDayNumber(COHORT_START_ISO), 1);
  assert.equal(cohortDayNumber('2026-11-04'), 3);
  assert.equal(cohortDayNumber('2026-11-15'), COHORT_DAYS);
  assert.equal(cohortDayNumber('2026-11-16'), null);
  assert.equal(cohortDayNumber('2026-11-01'), null);
});

test('isoFromDate режет время и не зависит от часового пояса машины', () => {
  assert.equal(isoFromDate(new Date(Date.UTC(2026, 10, 2, 23, 59, 59))), '2026-11-02');
  assert.equal(isoFromDate(new Date(Date.UTC(2026, 10, 1, 0, 0))), '2026-11-01');
  assert.throws(() => isoFromDate(new Date('не дата')), TypeError);
});

test('русские даты: родительный падеж и год в длинной форме', () => {
  assert.equal(formatRuDay('2026-11-02'), '2 ноября');
  assert.equal(formatRuDay('2026-12-01'), '1 декабря');
  assert.equal(formatRuDate('2026-11-02'), '2 ноября 2026 года');
  assert.equal(formatRuDate('2027-01-07'), '7 января 2027 года');
});

test('отзывов ровно два, они внутри когорты и заданы конкретным вопросом', () => {
  assert.equal(FEEDBACK_CHECKPOINTS.length, 2);
  const days = FEEDBACK_CHECKPOINTS.map((item) => item.day);
  assert.equal(new Set(days).size, days.length);
  for (const day of days) {
    assert.ok(day > 1 && day <= COHORT_DAYS, `день ${day} вне когорты`);
  }
  // Первый отзыв не в день старта: человек должен успеть чем-то попользоваться.
  assert.ok(Math.min(...days) >= 3, 'первый отзыв слишком рано');

  const schedule = checkpointSchedule();
  assert.equal(schedule[0].iso, '2026-11-05');
  assert.equal(schedule[0].dateLabel, '5 ноября');
  assert.equal(schedule[1].iso, '2026-11-15');
  assert.equal(schedule[1].dateLabel, '15 ноября');
  // «Расскажите о впечатлениях» — не отзыв: просим одно konkretное наблюдение.
  for (const checkpoint of schedule) {
    assert.match(checkpoint.ask, /[?.:]/);
    assert.ok(checkpoint.ask.length > 40, 'формулировка отзыва слишком расплывчатая');
  }
});

test('FAQ: 4–6 коротких вопросов с пригодными для ссылки якорями', () => {
  assert.ok(COHORT_FAQ.length >= 4 && COHORT_FAQ.length <= 6, `${COHORT_FAQ.length} пунктов`);
  const ids = COHORT_FAQ.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'id FAQ повторяются');
  for (const item of COHORT_FAQ) {
    // Якорь `/beta#<id>` обязан быть url-safe и не ломаться на кириллице.
    assert.match(item.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(item.question.trim().endsWith('?'), `вопрос без знака вопроса: ${item.question}`);
    assert.ok(item.answer.trim().length > 60, 'ответ стал заглушкой');
  }
});

test('страница не обещает того, чего нет в продукте', () => {
  const texts = [betaPage, ...COHORT_FAQ.map((item) => `${item.question} ${item.answer}`)];
  for (const text of texts) {
    for (const forbidden of FORBIDDEN_PROMISES) {
      assert.doesNotMatch(
        text,
        new RegExp(forbidden, 'i'),
        `обещание «${forbidden}» появилось в тексте когорты`
      );
    }
  }
});

test('лимит мест честный: без фейкового счётчика остатка', () => {
  assert.equal(COHORT_SEATS, 80);
  assert.doesNotMatch(betaPage, FAKE_SEATS_LEFT, 'на странице вырос «осталось N мест»');
  // Число мест обязано стоять и в исходнике страницы — иначе обещание
  // расходится с тем, что видит человек.
  assert.match(betaPage, /COHORT_SEATS/);
});

test('контент /beta лежит в серверном HTML, а не доезжает анимацией', () => {
  // Урок SEO-аудита: блоки ниже сгиба на лендинге стартовали с opacity 0
  // (components/landing/Reveal.tsx) и без JS не читались. На странице когорты
  // никаких motion/Reveal быть не должно.
  assert.doesNotMatch(betaPage, /from ['"]motion\/react['"]/);
  assert.doesNotMatch(betaPage, /components\/landing\/Reveal/);
  assert.doesNotMatch(betaPage, /initial=\{\{/);
  // CTA — настоящие ссылки, а не «кликабельные div».
  assert.match(betaPage, /href="\/test"/);
  assert.match(betaPage, /href="\/onboarding"/);
  // И один h1 на страницу.
  assert.equal((betaPage.match(/<h1/g) ?? []).length, 1);
  assert.equal((betaPage.match(/aria-labelledby=/g) ?? []).length >= 5, true);
});

test('/beta открыт краулеру и живёт в sitemap', () => {
  assert.match(sitemap, /'\/beta'/);
  // Приватные префиксы из middleware: /beta обязан отсутствовать, иначе
  // страница когорты отдаёт 307 на /login и все посты ведут в пустоту.
  const matcherBlock = /matcher:\s*\[([\s\S]*?)\]/.exec(middleware);
  assert.ok(matcherBlock, 'не найден config.matcher в middleware.ts');
  assert.doesNotMatch(matcherBlock[1], /\/beta/);
});

test('/beta виден с главной и из теста — альтернатива вместо тупика', () => {
  assert.match(landing, /href="\/beta"/);
  assert.match(testPage, /href="\/beta"/);
});
