# Деплой Lexicon — реальная архитектура

**Этот документ описывает то, что действительно работает.**
Прежняя версия описывала Neon → Render → Vercel. Этой инфраструктуры **не существует**:
боевой сервер — VPS с `systemd` и `nginx`, API и фронт живут на одной машине, база — там же.
Файл `render.yaml` (Render free) удалён: он описывал инфраструктуру, которой не существует.

Всё, что помечено **НЕ ПРОВЕРЕНО**, нельзя установить из репозитория. Не верьте такой
строке на слово — там указано, как её проверить.

---

## 0. Что где

| Слой | Технология | Где живёт |
|---|---|---|
| API | ASP.NET Core, self-contained publish | VPS, `systemd`-юнит `lexicon-api` |
| БД | PostgreSQL | тот же VPS |
| Фронт | Next.js 14, `next start` | тот же VPS, `systemd`-юнит `lexicon-frontend` |
| TLS | nginx + Let's Encrypt | тот же VPS |

Конфигурация nginx и systemd-юнитов **в репозитории отсутствует** — одна из причин,
по которой деплой невоспроизводим. Нужны `deploy/nginx/` и `deploy/systemd/` с
санитизированными шаблонами (без значений секретов).

**НЕ ПРОВЕРЕНО:** точные имена юнитов и пути. Из `docs/beta-launch/KNOWN_GAPS.md`
известны `/etc/systemd/system/lexicon-api.service` и дроп-ины
`…service.d/{feedback,proxy,prod-runtime}.conf`. Проверить: `systemctl list-units 'lexicon*' --all`.

---

## 1. Переменные окружения API

Значения **не** задаются в юните — только через `EnvironmentFile` (см.
`docs/execution/SECRET_ROTATION.md`).

| Переменная | Значение | Зачем |
|---|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` | иначе dev-поведение: креды из `appsettings.Development.json`, подробные ошибки |
| `ConnectionStrings__DefaultConnection` | строка Postgres | без неё стартует на дефолте `localhost:5433` и отдаёт 503 |
| `Jwt__Key` | ≥ 64 символа | подписывает access и refresh; слабый ключ = подделка любого аккаунта |
| `Jwt__Issuer` / `Jwt__Audience` | `EnglishLearningPlatform` / `…Users` | сверка токена |
| `Gemini__ApiKey` | ключ Gemini | разбор ошибок, ассистент, перевод по контексту, TTS |
| `Gemini__ProxyUrl` | прокси, если регион не поддерживается | пусто = напрямую |
| `Gemini__Model` | `gemini-2.5-flash` | — |
| `Azure__Speech__Key` / `Region` / `Voice` | ключ Azure, `westeurope`, `en-US-AriaNeural` | озвучка глав; пусто = голос браузера |
| `Azure__Speech__MonthlyCharLimit` | `400000` | **потолок 400k символов в месяц на весь сервис ≈ 16,7 минут аудио в сутки.** Поднять до реального AP-плана или перейти на предгенерацию по главам |
| `Seeder__Key` | секрет | доступ к сидированию |
| `Feedback__AdminKey` | секрет | доступ к `/admin/feedback` |
| `Analytics__GuestIpSalt` | ≥ 16 символов | соль хеша IP гостевой воронки; пусто = случайный ключ процесса, «уникальные гости за сутки» не сходятся между рестартами |
| `Analytics__GuestRetentionDays` | `30` | срок хранения гостевых событий; `0`/мусор не отключают чистку, а дают 30 |
| `Proxy__TrustedCidrs` | `127.0.0.1/32` | **без этого все лимиты партицируются по адресу прокси: один клиент блокирует всю бету.** При старте пишется WRN «задайте Proxy__TrustedCidrs» |
| `Registration__DailyGlobalLimit` | `500` | суточный кап регистраций на сервис |
| `Ai__GlobalDailyRequestLimit` | `2000` | дневной бюджет обращений к Gemini на сервис |
| `Ai__PerMinuteUserRequestLimit` | `30` | burst-тормоз на аккаунт |
| `Email__Smtp__{Host,Port,User,Password}` | SMTP | **без транспорта нет ни сброса пароля, ни подтверждения почты.** Сейчас на сервере SMTP нет — это блокер первого публичного трафика |
| `Email__From` | адрес отправителя | валидный `no-reply@lexicon.local` проходит проверку на абсолютность и молча ломает письма |
| `App__FrontendUrl` | боевой адрес | дефолт `http://localhost:3000` тоже «абсолютный» — проверка старта его пропускает |
| `Cors__Origins` | боевой домен | пусто = только `localhost:3000`, фронт не заработает |

> **SMTP обязателен.** Сброс пароля и подтверждение email работают только через письма:
> токен в ответе API не отдаётся ни в Development, ни в Production. Если
> `Email__Smtp__Host` пуст, письма остаются в журнале (`/api/notifications/outbox`).

### Лимиты и доверие прокси

`RemoteIpAddress` у всех запросов — адрес nginx, а не клиента. Пока прокси не описан в
`Proxy__TrustedCidrs`, `X-Forwarded-For` игнорируется, и **все** IP-лимиты делят одну
корзину на всю бету. При старте пишется WARNING «лимиты партицируются по IP прокси».

| Лимит | Значение | Где задаётся |
|---|---|---|
| Регистрации на один email | 5 / час | `RateLimitPolicies.SignupEmailPermitLimit` |
| Регистрации на один IP | 50 / час | `RateLimitPolicies.SignupIpPermitLimit` |
| Регистраций в сутки на сервис | 500 | `Registration__DailyGlobalLimit` |
| Обращений к Gemini в сутки | 2000 | `Ai__GlobalDailyRequestLimit` |
| Вход на связку IP+email | 10 / мин | политика `auth` |
| Админ-эндпоинты | 10 / 5 мин | политика `admin` |
| Гостевые события `/test` | 20 / мин на IP | политика `guest-analytics` |

> **Обратная связь беты.** Форма шлёт отзыв на `Feedback__ToEmail` (по умолчанию
> `kompasmini@yandex.com`). Копия всегда сохраняется в `EmailMessages` с `Kind = "feedback"`,
> поэтому отзыв не теряется даже при сбое SMTP. Все отзывы — на `/admin/feedback`,
> страница попросит `Feedback__AdminKey` (отдельно от `Seeder__Key`).

## 2. Переменные окружения фронта

| Переменная | Значение |
|---|---|
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:<порт API>` — **не публичный адрес**: он нужен только серверным route-handler'ам, браузер ходит на `/api/next/*` своего origin |
| `NEXT_PUBLIC_SITE_URL` | боевой адрес без завершающего слэша: от него строятся `metadataBase`, OG, `sitemap.xml`, `robots.txt` |
| `NEXTAUTH_URL` | боевой адрес |
| `NEXTAUTH_SECRET` | ≥ 64 символа из `scripts/generate-secrets.sh` |

---

## 3. Порядок деплоя

Порядок обязателен: **сначала БД, потом API, потом фронт**. Новый API без применённых
миграций падает на первом INSERT в регистрацию — так случился инцидент, когда из 30
миграций были применены 27, а `/health` при этом показывал зелёный (он проверяет
`CanConnectAsync`, а не схему).

### Шаг 1. Бэкап и миграции

```bash
cd /opt/lexicon
export ConnectionStrings__DefaultConnection='<строка подключения>'
bash deploy/apply-migrations.sh
```

Скрипт: `pg_dump -Fc` в `backups/predeploy-<дата-время>.dump` → **до** любой миграции;
затем `dotnet ef database update --no-build`; затем печатает список применённых миграций
и падает, если хоть одна из кода осталась неприменённой.

### Шаг 2. Проверить, что бэкап восстанавливается

```bash
bash deploy/restore-check.sh backups/predeploy-<дата>.dump
```

Скрипт разворачивает дамп в **отдельную** БД `lexicon_restore_check`, считает строки в
`AspNetUsers`, `Books`, `WordLevels`, `UserWords`, печатает результат и удаляет временную
БД. «Бэкап есть» без этого шага — не бэкап, а надежда.

### Шаг 3. API

```bash
sudo systemctl restart lexicon-api
sudo systemctl is-active lexicon-api
curl -fsS http://127.0.0.1:5226/health
curl -fsS http://127.0.0.1:5226/api/catalog/books | head -c 300
```

Второй `curl` обязателен: `/health` не знает про схему.

### Шаг 4. Фронт

**НЕ ПРОВЕРЕНО:** собирается ли фронт в юните или вручную. Из
`.workbuddy-ai/memory/MEMORY.md` известно, что сборка идёт на сервере с 886 МБ RAM и
2 ГБ swap. Проверить: `systemctl cat lexicon-frontend`.

```bash
sudo systemctl restart lexicon-frontend
curl -fsS -o /dev/null -w '%{http_code}\n' https://<домен>/
```

### Шаг 5. Смок живого продукта

Не «страница открылась», а «продукт работает». Ручной прогон в браузере:
войти → открыть главу → кликнуть слово → увидеть перевод → ответить на карточку в
`/review`. Это и есть критерий «деплой удался», а не зелёный `/health`.

---

## 4. Откат

Прод собирается **не из коммита**, а архивом (`tar` → `rsync`), поэтому `git revert`
невозможен. Пока это так, единственный откат — вернуть предыдущий бинарь/`.next` из
каталога прошлого деплоя и восстановить дамп, снятый на шаге 1.

**Это дыра, а не процедура.** Закрывается деплоем по SHA (сборка в CI, артефакт привязан
к коммиту) — задача следующего цикла, а не этого.

---

## 5. Бэкапы

| Что | Чем | Куда |
|---|---|---|
| БД | `pg_dump -Fc` | `/opt/lexicon/backups/` **и** вне VPS |

Второго места сейчас нет: БД, `uploads/`, TTS-кэш и сами бэкапы лежат на одном диске.
Потеря диска = потеря всего одновременно.

**Не сделано:** ежедневный `systemd`-таймер для `pg_dump`, выгрузка в S3-совместимое
хранилище. Оба — Must Have до реальных пользователей на сервере.

---

## 6. Чего в этом документе больше нет

Удалены как вводящие в заблуждение: инструкции Neon/Render/Vercel, `plan: free`,
«инстанс засыпает через 15 минут», «файлы эфемерны», «миграции применю я». Ни одно из
этих утверждений не описывает боевую систему.
