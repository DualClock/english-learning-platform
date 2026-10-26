# Блокировка `/_next/image` на reverse-proxy

**Задача:** W1.2 Frontend Hardening · **Дата:** 23.10.2026 · **Ветка:** `release/beta`

## Зачем это нужно, если `unoptimized: true` уже стоит

`next@14.2.35` содержит критические CVE в Image Optimization — endpoint
`GET /^/_next/image?url=…&w=…&q=…`. Апгрейд на Next 15.5.x/16.x сознательно
отложен (тянет React 19, а фронтенд без тестов), поэтому эксплуатируемость
снимаем двумя независимыми слоями:

1. `frontend/next.config.mjs` → `images.unoptimized: true`. В коде **нет ни
   одного `next/image`** (`grep -rn "next/image" frontend/src` пустой), так что
   рендер это не меняет; слой работает как страховка на будущее.
2. **Этот файл** — блок конфига прокси, который закрывает endpoint на входе,
   независимо от того, что оказалось в конфиге Next на момент деплоя.

Двойная защита нужна потому, что слои отказывают по-разному: конфиг Next можно
откатить/перезатереть при мердже, а правило прокси живёт в инфраструктуре и
проверяется одним `curl`. Плюс прокси отбивает запрос **до** того, как он
дойдёт до Node-процесса, то есть не даёт нагрузку раскладывать SVG/SSL через
`sharp` и не тратит CPU на разбор `url=`.

Отдельная причина не возвращать оптимизацию позже: доки Next прямо говорят, что
Image Optimization API **не пробрасывает заголовки авторизации** при fetch
исходника. А приватные картинки проекта (`/api/avatar/[name]`,
`/api/word-image/[name]`) защищены кукой сессии, поэтому `next/image` для них
всё равно непригоден — см. `frontend/src/app/api/avatar/[name]/route.ts:8-10`.

## Проверено локально (прод-сборка, `next start`, 23.10.2026)

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:3111/_next/image?url=%2Fog.png&w=640&q=75'
# 404
```

Причина именно `unoptimized`, а не совпадение — код самого `next@14.2.35`,
`node_modules/next/dist/server/next-server.js:167`:

```js
const imagesConfig = this.nextConfig.images;
if (imagesConfig.loader !== "default" || imagesConfig.unoptimized) {
    await this.render404(req, res);
    return true;
}
```

То есть при `unoptimized: true` роут `/_next/image` уходит в 404 **до** разбора
`url=`, до проверки подписанного URL и до декода в `sharp` — уязвимый путь
становится недостижимым, а не просто «не используется». Правило прокси ниже всё
равно нужно: оно закрывает путь, если кто-то откатит `unoptimized` при мердже,
если на ноде останется старый билд, или если endpoint оживёт в другой сборке.

## nginx

Внутри `server { … }`, **до** общего `location /`, который проксирует на Next:

```nginx
# Next.js Image Optimization (CVE в next@14.2.35). Приложение next/image не
# использует, endpoint не нужен никому — закрываем на входе.
location ~ ^/_next/image {
    return 403;
}
```

Регулярка без якоря `$` намеренная: Next обращается к `/_next/image?url=…`, где
путь заканчивается на `image`, но запросы вида `/_next/image/anything` тоже
должны попадать под блок. Если в конфиге уже есть `location /_next/static`
(для кэша хешей), порядок не важен — regex-локейшены проверяются раньше
префиксных, но положите блок выше, чтобы читатель не искал его по всему файлу.

Проверка после `nginx -s reload`:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'https://<домен>/_next/image?url=%2Fog.png&w=640&q=75'   # ожидаем 403
```

## Caddy

Внутри блока `site { … }`, **до** `reverse_proxy` (Caddy совпадает с более
специфичным route, но порядок сверху вниз читаемее и надёжнее при будущих
правках):

```caddyfile
# Next.js Image Optimization (CVE в next@14.2.35). next/image в коде нет.
handle /_next/image* {
    respond "Forbidden" 403
}
```

Проверка:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'https://<домен>/_next/image?url=%2Fog.png&w=640&q=75'   # ожидаем 403
```

## Важно: это не работает на Vercel

`DEPLOY.md:85-98` описывает фронтенд на **Vercel**, а `frontend/vercel.json`
содержит только `framework`/`buildCommand`. На управляемом Vercel свой nginx или
Caddy поднять нельзя — туда этот блок ставится **только если** фронт переедет на
self-host (Render/Docker/VPS за своим прокси). Для Vercel остаются:
`images.unoptimized`, заголовки из `next.config.mjs`, и при необходимости
`headers` в `vercel.json`.

Если решите закрывать endpoint на Vercel, путь один — `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/_next/image",
      "has": [{ "type": "query", "key": "url" }],
      "headers": [{ "key": "X-Blocked", "value": "image-optimization-disabled" }]
    }
  ]
}
```

Замечание честности: `vercel.json` умеет **выдавать** заголовки, но не умеет
`return 403` по пути, как nginx. Поэтому на Vercel реальным барьером является
только `unoptimized` из `next.config.mjs`, а не этот блок.

## Что проверять после любого деплоя

```bash
# 1. endpoint мёртв (self-host): ожидаем 403, на Vercel — 404/200 с unoptimized-конфигом
curl -sS -o /dev/null -w '%{http_code}\n' 'https://<домен>/_next/image?url=%2Fog.png&w=640&q=75'

# 2. заголовки из next.config.mjs доехали
curl -sSI 'https://<домен>/' | grep -iE 'content-security|x-frame|x-content-type|referrer|permissions-policy|strict-transport'

# 3. приватные картинки-прокси не сломаны кукой/заголовками (ожидаем 401 без сессии)
curl -sS -o /dev/null -w '%{http_code}\n' 'https://<домен>/api/avatar/deadbeefdeadbeefdeadbeefdeadbeef.png'
```

Последняя проверка обязательна: `Content-Security-Policy: frame-ancestors` и
`X-Content-Type-Options: nosniff` на `<img>` не влияют, но их случайно можно
распространить на `source: '/api/:path*'` с `default-src`, и тогда картинки
пропадут.
