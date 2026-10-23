import test from 'node:test';
import assert from 'node:assert/strict';
import nextConfig from '../../next.config.mjs';

/**
 * Ссылка-код для канала и учителя (W2.1.2).
 *
 * В переписке учителю обещана «своя ссылка». Короткий вид `https://домен/t/<код>`
 * выглядит как приглашение, а не как аналитика, и помещается в сторис и в пост
 * VK-группы. Открываться он должен на лендинге с `?ref=<код>` — дальше ловлей
 * меток занимается src/lib/attribution.ts.
 *
 * Редирект живёт в next.config.mjs, а не в компоненте: он отрабатывает до
 * загрузки джаваскрипта и не добавляет страницу в бандл. Тест фиксирует контракт,
 * потому что опечатка в шаблоне превратилась бы в `?ref=:code` для всех сразу.
 */
test('существует правило редиректа /t/<код> → /?ref=<код>', async () => {
  assert.equal(typeof nextConfig.redirects, 'function', 'в next.config.mjs нет redirects()');

  const rules = await nextConfig.redirects();
  const rule = rules.find((item) => item.source === '/t/:code');

  assert.ok(rule, 'нет правила для /t/:code');
  assert.equal(rule.destination, '/?ref=:code');
});

test('код не закрепляется в кэше браузера: бета-ссылки меняются часто', async () => {
  const rules = await nextConfig.redirects();
  const rule = rules.find((item) => item.source === '/t/:code');

  // permanent: true даёт 308 и бесконечный кэш — учитель не сможет переназначить
  // свою ссылку, а браузер будет десять дней водить людей по старому адресу
  assert.equal(rule.permanent, false);
});
