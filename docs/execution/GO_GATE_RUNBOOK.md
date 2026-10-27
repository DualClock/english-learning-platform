# GO GATE — одно окно исполнения на сервере

Этот рунбук выполняет владелец **один раз**, когда поднимает VPS. Не «когда-нибудь
потом» и не по частям: между шагами 4 и 6 API обязан быть остановлен, иначе на живую
базу поедет код, которому не хватает таблиц.

Все команды копируются как есть. `<...>` заменяете на своё, ничего не придумывая:
значения берутся из того, что уже лежит на сервере.

> **Откуда эти команды.** Пути, порт, отсутствие .NET, дропины systemd и порядок
> «дамп → SQL → restart» — не выдумка, а то, что реально прошло 24.10.2026:
> `docs/beta-launch/EXECUTION_SEQUENCE.md` §A9 («Как это прошло на самом деле»),
> `security/verification-log.md` (раздел «Выкатка»), `docs/beta-launch/KNOWN_GAPS.md`
> пп. 0, 4, 19–22, `DEPLOY.md`. Чего в этих источниках нет — того здесь тоже нет.

## Правила окна

1. **Фиксируйте время каждого шага.** В конце нужен один ответ на вопрос «во сколько
   это было», а не «примерно в два». Каждая команда печатает время сама; кроме того,
   пишите в блокнот `шаг → время → результат`.
2. **Порядок не переставляется.** Дамп строго до миграции, миграция строго до
   рестарта.
3. **Шаг упал — останавливайтесь.** Каждый шаг говорит, что делать при отказе. Не
   «попробуем дальше и посмотрим».
4. **Секретов в чат и в файлы.** Строка подключения и ключи читаются из юнитов
   systemd, в переписку и в отчёты не попадают. Если нужно показать отчёт — только
   имена переменных.

---

## Шаг 0. Что нужно под рукой (2 минуты)

```bash
export SERVER=root@5.129.192.216          # ваш адрес, как в KNOWN_GAPS §1
export SITE=https://5.129.192.216.sslip.io
ssh "$SERVER" 'echo "время сервера: $(date -u +%FT%TZ)"; echo "uptime: $(uptime -p)"'
```

**Ожидается:** два строки — UTC-время и uptime. Время сервера дальше используется как
метка окна.

**Если отказ:** `ssh` не пускает → окно не начинаем. Проверка SSH — не часть этого
рунбука и здесь не выдумывается; без доступа к серверу ничего из перечисленного
сделать нельзя.

Что должно быть на сервере (проверяется в шаге 1–2, не раньше):

- `psql`, `pg_dump` — есть, ими катились миграции 24.10;
- **`dotnet` нет и не будет** — там self-contained publish, apphost в
  `/opt/lexicon/api/EnglishLearningPlatform.API`;
- PostgreSQL слушает **5432** (`5433` в строке подключения — это самострел 24.10,
  из-за него каталог отдал `503`);
- systemd-юнит `lexicon-api.service` и дропины
  `/etc/systemd/system/lexicon-api.service.d/*.conf` (права 0600).

---

## Шаг 1. Зафиксировать время и состояние сервиса

```bash
ssh "$SERVER" 'date -u +%FT%TZ; systemctl is-active lexicon-api; systemctl show lexicon-api -p ActiveEnterTimestamp'
```

**Ожидается:**

```
2026-10-26T12:00:00Z
active
ActiveEnterTimestamp=<дата последнего старта>
```

**Если отказ:** `inactive`/`failed` → сначала поднять сервис (`systemctl start
lexicon-api`) и убедиться, что он живёт, иначе непонятно, что именно сломалось позже.
`ActiveEnterTimestamp` запишите: после шага 7 он обязан измениться.

---

## Шаг 2. Проверить, что развёрнутый код — тот самый (SHA)

24.10 выкатка шла `tar→rsync` мимо репозитория, пуша в GitHub не было, поэтому
«на сервере коммит X» ничем не доказывалось (KNOWN_GAPS п. 21,
verification-log «Что должно быть проверено до подписи GO» п. 1). Здесь мы не
выдумываем способ проверки — мы честно фиксируем то, что есть, и доказываем
принадлежность **в момент окна**.

```bash
ssh "$SERVER" '
  echo "--- файлы сборки ---"
  ls -l --time-style=full-iso /opt/lexicon/api/EnglishLearningPlatform.API*
  echo "--- отпечаток сборки ---"
  sha256sum /opt/lexicon/api/EnglishLearningPlatform.API.dll 2>/dev/null || \
  find /opt/lexicon/api -maxdepth 2 -name "*.dll" -printf "%T@ %p\n" | sort -rn | head -3
'
```

**Ожидается:** строка с датой сборки и `sha256` главного dll (если dll лежит не в
корне/называется иначе — сработает второй вариант и покажет три самых свежих dll).

Запишите вывод целиком. Это и есть доказательство «на сервере работает ровно этот
билд» на момент окна.

```bash
# локально, в репозитории — зафиксировать, какой код собираем
git rev-parse HEAD; git status --porcelain | head
```

**Ожидается:** `HEAD` и пустой `git status` (или список незакоммиченных правок —
тогда их надо назвать в отчёте, как 24.10 с `categories/[slug]/page.tsx`).

**Если отказ/расхождение:** если локальный `HEAD` собирает сборку, отпечаток которой
не совпадает с серверной, — **не катим код**. Сначала пересобираем и переносим
(`dotnet publish -r linux-x64 --self-contained`), не забывая `chmod +x` на apphost:
tar с Windows не сохраняет бит исполнения, и сервис падает с `203/EXEC`
(EXECUTION_SEQUENCE §A9).

> **Честное ограничение.** Полностью закрыть п. 21 (билд из зафиксированного SHA) этот
> шаг не может: он фиксирует отпечаток, а не происхождение. Происхождение закрывается
> только пушем в GitHub и первым прогоном CI — это отдельное решение владельца по
> публичности репозитория (KNOWN_GAPS п. 3), и оно в это окно не входит.

---

## Шаг 3. Проверить инструменты и цель базы (без изменений)

```bash
ssh "$SERVER" 'psql --version; pg_dump --version; systemctl cat lexicon-api | grep -E "ConnectionStrings__DefaultConnection|PG" | sed "s/Password=[^;\"]*/Password=***/g"'
```

**Ожидается:** версии `psql`/`pg_dump` и строка подключения с `Port=5432` и
замаскированным паролем.

**Если отказ:**

- `Port=5433` в выводе → **остановитесь**. Это ровно та ошибка, что уронила каталог
  24.10: дропин перебил порт из юнита, `/api/catalog/books` ответил `503
  Failed to connect to 127.0.0.1:5433`. Убрать строку подключения из дропина,
  оставить её только в юните.
- нет `pg_dump` → дампа не будет, а без дампа миграцию не начинаем. Установить клиент
  PostgreSQL и вернуться к шагу 3.

---

## Шаг 4. Остановить API и снять дамп ДО миграции

```bash
ssh "$SERVER" '
  set -e
  echo "stop: $(date -u +%FT%TZ)"
  systemctl stop lexicon-api
  mkdir -p /opt/lexicon/backups/$(date +%F)-predeploy
  B=/opt/lexicon/backups/$(date +%F)-predeploy/predeploy-$(date +%F-%H%M).dump
  pg_dump --format=custom --no-owner --no-privileges --file="$B"
  ls -l "$B"; echo "dump: $(date -u +%FT%TZ) -> $B"
'
```

**Ожидается:** `active` пропал (`stop`), затем строка `ls` с ненулевым размером и
путь к дампу. Запишите путь — он нужен в шагах 6 и 8.

**Если отказ:**

- `pg_dump` вернул ошибку → сервис остаётся остановленным, миграции НЕ применяем.
  Поднять сервис обратно (`systemctl start lexicon-api`), чинить доступ к базе.
- файл нулевого размера → то же самое. Пустой дамп — не бэкап.

**Почему останавливаем API:** новый код обращается к колонкам и таблицам, которых в
базе ещё нет. Пока идёт `ALTER`, живой трафик получит `500` на регистрации
(EXECUTION_SEQUENCE §A9: `INSERT` в `AspNetUsers` ссылается на
`AcquisitionSource`/`AcquisitionCode`). Короткое окно обслуживания дешевле, чем
битые записи.

---

## Шаг 5. Применить миграции (SQL, не `dotnet ef`)

**Ключевой факт:** на сервере `.NET` нет, поэтому `dotnet ef database update` здесь
не работает — design-time падает на валидации `Jwt:Key` (EXECUTION_SEQUENCE §A9).
Путь, который работал и должен работать: сгенерированный локально идемпотентный
скрипт → `psql -v ON_ERROR_STOP=1`.

Скрипт лежит в репозитории: `deploy/migrations/idempotent.sql` (29 миграций,
включая `AddReaderV3` и `AddReaderSpeech`). Переносится на сервер заранее, в шаге 0.

```bash
# локально: сколько миграций в файле — столько должно стать в истории
grep -oE '[0-9]{14}_[A-Za-z0-9]+' deploy/migrations/idempotent.sql | sort -u | wc -l
# → ожидается 29
```

```bash
scp deploy/migrations/idempotent.sql "$SERVER:/opt/lexicon/backups/idempotent.sql"
ssh "$SERVER" '
  set -e
  echo "before: $(date -u +%FT%TZ)"
  psql -v ON_ERROR_STOP=1 --no-psqlrc -tAc "SELECT count(*) FROM \"__EFMigrationsHistory\""
  psql -v ON_ERROR_STOP=1 --no-psqlrc --single-transaction -f /opt/lexicon/backups/idempotent.sql
  echo "after: $(date -u +%FT%TZ)"
  psql -v ON_ERROR_STOP=1 --no-psqlrc -tAc "SELECT count(*) FROM \"__EFMigrationsHistory\""
'
```

**Ожидается:**

```
before: 2026-10-26T12:05:00Z
27                      ← было 24, 24.10 применили три (24 → 27)
... (psql молчит, кроме NOTICE) ...
after: 2026-10-26T12:05:40Z
29                      ← +AddReaderV3, +AddReaderSpeech
```

Точные числа «было» могут отличаться, если с 24.10 что-то применялось. **Жёсткие
инварианты** — не «было N», а:

- `after` = `before` + 2, и `after` совпадает с числом из локального `grep` (29);
- в выводе нет `ERROR`.

Проверить обе миграции поимённо:

```bash
ssh "$SERVER" 'psql -v ON_ERROR_STOP=1 --no-psqlrc -tAc "SELECT \"MigrationId\" FROM \"__EFMigrationsHistory\" WHERE \"MigrationId\" LIKE '"'"'%AddReader%'"'"' ORDER BY 1"'
```

**Ожидается:**

```
20261025121400_AddReaderV3
20261025144251_AddReaderSpeech
```

**Если отказ:**

- `ERROR` в середине → `--single-transaction` откатил весь скрипт, база в исходном
  состоянии. Читаем ошибку: чаще всего это уже существующий объект или несовпадение
  типа. **Не повторяем** слепо, разбираемся, база цела.
- `after` не изменился → скрипт не нашёл, что применять. Значит `idempotent.sql` не
  тот (старая генерация) — перегенерировать по `deploy/migrations/README.md`.
- `after` не совпадает с числом миграций в коде → база и код разъехались, дальше не
  идём (сервис так и оставлен остановленным).
- сломалось непоправимо → откат по шагу 8 (дамп).

Почему `ON_ERROR_STOP=1` обязателен: без него `psql` продолжит после первой ошибки,
и база останется в состоянии «половина миграции применена» — хуже, чем чистый отказ.

---

## Шаг 6. Поднять сервис и проверить, что он жив

```bash
ssh "$SERVER" '
  systemctl start lexicon-api
  sleep 3
  systemctl is-active lexicon-api
  systemctl show lexicon-api -p ActiveEnterTimestamp
  journalctl -u lexicon-api --since "-2 min" --no-pager | grep -Ei "error|fail|exception|WRN" | tail -20
'
```

**Ожидается:** `active`, `ActiveEnterTimestamp` **новый** (отличается от шага 1), и в
журнале — только известные WRN: «почта не настроена» и
`Auth:RequireConfirmedEmail=false` (KNOWN_GAPS п. 19.0). Это ожидаемые строки, а не
поломка.

**Если отказ:**

- `203/EXEC` → нет бита исполнения на apphost: `chmod +x
  /opt/lexicon/api/EnglishLearningPlatform.API` и повторить с шага 6 (самострел 24.10).
- `activating` дольше 30 секунд → смотреть `journalctl -u lexicon-api -n 100`; чаще
  всего строка подключения (шаг 3).
- `500` в журнале на регистрации → миграции не применились, вернуться к шагу 5.

---

## Шаг 7. Живые запросы: каталог и регистрация

```bash
# 7a. Каталог — чтение, ничего не создаёт
curl -s -o /tmp/books.json -w "books: %{http_code} %{size_download}b %{time_total}s\n" \
  "$SITE/api/catalog/books"
python3 -c "import json;d=json.load(open('/tmp/books.json'));print('книг:',len(d) if isinstance(d,list) else d)"
```

**Ожидается:** `books: 200` и **18** книг (столько было после выкатки 24.10).

**Если отказ:** `503` → база недоступна или неверный порт (шаг 3). `500` → не
применена миграция (шаг 5). `200` с нулём книг → дамп/сид не в порядке.

```bash
# 7b. Регистрация — создаёт пользователя и проверяет ровно тот INSERT,
# который ломался без миграций атрибуции.
curl -s -o /tmp/signup.json -w "signup: %{http_code}\n" \
  -X POST "$SITE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"lexicon-gogate-'"$(date +%s)"'@example.com","password":"Gogate-Passw0rd-'"$(date +%s)"'","displayName":"GO gate"}'
python3 -c "import json;d=json.load(open('/tmp/signup.json'));print('поля:',sorted(d.keys()));print('emailConfirmed:',d.get('emailConfirmed'))"
```

**Ожидается:** `signup: 200`, в ответе есть `token`, `userId`, `emailConfirmed`.
Пользователь создан, `INSERT` в `AspNetUsers` прошёл вместе с
`AcquisitionSource`/`AcquisitionCode`.

**Если отказ:**

- `500` → **не применена миграция атрибуции**: колонок `AcquisitionSource`/
  `AcquisitionCode` в базе нет. Вернуться к шагу 5.
- `400` → форма/пароль (требования Identity). `429` → дневной/часовой кап
  регистраций, подождать или принять как норму.
- `403 email_confirmation_required` → это AI-гейт, не регистрация; для этого
  запроса появляться не должен.

**Убрать за собой** (тестовый аккаунт не должен жить в проде):

```bash
ssh "$SERVER" 'psql -v ON_ERROR_STOP=1 --no-psqlrc -tAc "DELETE FROM \"AspNetUsers\" WHERE \"Email\" LIKE '"'"'lexicon-gogate-%@example.com'"'"'"'
```

**Ожидается:** `DELETE 1`.

> Почему `Lexicon-gogate-*`, а не «просто тест»: 24.10 мусорные аккаунты
> `lexicon-smoke-*`/`lexicon-probe-*` пришлось вычищать руками, и счётчик
> возвращали к 23. Префикс делает уборку однозначной.

---

## Шаг 8. Проверить, что бэкап реально восстанавливается (restore-check)

«Бэкап есть» → «бэкап проверен». 24.10 дамп сделали, но не восстанавливали:
наличие файла не доказывает, что из него поднимется база.

```bash
ssh "$SERVER" '
  set -e
  export PGHOST=127.0.0.1 PGPORT=5432
  source <(grep -hE "^Environment=" /etc/systemd/system/lexicon-api.service /etc/systemd/system/lexicon-api.service.d/*.conf 2>/dev/null | sed -e "s/^Environment=//" | grep -E "PGUSER|PGPASSWORD|PGDATABASE") || true
  echo "restore db: lexicon_restore_check"
  ./deploy/restore-check.sh /opt/lexicon/backups/$(date +%F)-predeploy/predeploy-*.dump
'
```

Если `source` не сработал (переменные объявлены не по одной на строку) — задайте их
руками, взяв **имя** переменной из юнита; пароль не печатайте:

```bash
ssh "$SERVER" 'read -rp "PGUSER: " PGUSER; export PGHOST=127.0.0.1 PGPORT=5432 PGUSER; ./deploy/restore-check.sh <путь-к-дампу>'
```

**Ожидается:**

```
таблица               строк
----------------  ----------
AspNetUsers               24
Books                     18
WordLevels              4500
UserWords                <N>
__EFMigrationsHistory      29

ПРОВЕРКА ПРОЙДЕНА: дамп ... восстанавливается, ключевые таблицы непустые
```

Числа берутся из факта, важен инвариант: `AspNetUsers > 0`, `Books > 0`,
`__EFMigrationsHistory` = 29 (после шага 5), временная БД `lexicon_restore_check`
**удалена** в конце.

**Если отказ:**

- `нет права CREATE DATABASE` → дать право роли из шага 3 или выполнить проверку от
  владельца схемы.
- `pg_restore завершился с ошибкой` → дамп битый. **Это важный результат, а не
  досадная помеха:** значит бэкапа у вас не было. Миграции уже применены — данные
  целы, но защита на будущее отсутствует, и это надо чинить до приглашения людей.
- `0 пользователей`/`0 книг` → восстановилась пустая схема; дамп не тот файл.

---

## Шаг 9. Зафиксировать окно

```bash
ssh "$SERVER" 'echo "end: $(date -u +%FT%TZ)"; systemctl is-active lexicon-api; psql -v ON_ERROR_STOP=1 --no-psqlrc -tAc "SELECT count(*) FROM \"__EFMigrationsHistory\""; du -sh /opt/lexicon/backups/$(date +%F)-predeploy'
```

Записать в `security/verification-log.md` таблицей (это единственный артефакт
«это было сделано»):

```markdown
| Шаг | Время (UTC) | Что | Результат |
|---|---|---|---|
| 1 | 2026-10-26T12:00Z | сервис до окна | active, старт <ts> |
| 2 | … | отпечаток сборки | sha256 <…>, HEAD <…> |
| 4 | … | дамп | <путь>, <размер> |
| 5 | … | миграции | история 27 → 29, ERROR нет |
| 6 | … | restart | active, старт <новый ts> |
| 7 | … | /api/catalog/books | 200, 18 книг |
| 7 | … | /api/auth/register | 200, userId <…>, удалён |
| 8 | … | restore-check | ПРОЙДЕНА, AspNetUsers <N> |
| 9 | … | конец окна | active, история 29 |
```

---

## Откат (если шаг 5 или 6 сломался непоправимо)

```bash
ssh "$SERVER" '
  set -e
  systemctl stop lexicon-api
  pg_restore --clean --if-exists --no-owner --no-privileges \
    --dbname=<PGDATABASE> /opt/lexicon/backups/$(date +%F)-predeploy/predeploy-*.dump
  systemctl start lexicon-api
  systemctl is-active lexicon-api
'
```

`--clean --if-exists` требует прав на `DROP`: тот же пользователь, что владелец схемы.
После отката — шаг 6 и шаг 7a (`200`, 18 книг). Миграции читалки при этом исчезнут:
они были добавлены в этом окне, откат возвращает состояние «до».

---

## Чего этот рунбук сознательно НЕ делает

Чтобы окно не расползлось и не начало обещать больше, чем проверяет:

- **не закрывает KNOWN_GAPS п. 21** (билд из зафиксированного SHA) — см. шаг 2;
- **не ротирует секреты** (п. 2, 19, 20) — это отдельная работа со своим окном;
- **не проверяет AI-путь end-to-end** (п. 22): он упирается в отсутствие SMTP
  (п. 0), а поднимать транспорт — не эта задача;
- **не заменяет телефонный прогон** (п. 18) — его делает человек, и он же первый
  отзыв беты.
