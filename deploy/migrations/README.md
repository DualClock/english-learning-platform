# deploy/migrations — миграции как артефакт, а не как действие на сервере

Здесь лежит **сгенерированный** идемпотентный SQL всех миграций проекта и
инструкция, как его применять. Причина, по которой каталог появился: деплой 24.10
был невоспроизводим — скрипт генерировали «на коленке» локально
(`dotnet ef migrations script 20261023111521_AddWordVisuals`) и переносили текстом.
Повторить ту же выкатку через месяц было нечем, а база отставала от кода молча
(см. `docs/beta-launch/KNOWN_GAPS.md` п. 4 и 21).

## Почему SQL, а не `dotnet ef database update` на сервере

На боевом VPS **нет .NET**: там лежит self-contained publish
(`dotnet publish -r linux-x64 --self-contained`, см.
`docs/beta-launch/EXECUTION_SEQUENCE.md` §A9, «Как это прошло на самом деле»).
Плюс design-time падает на валидации `Jwt:Key`. Поэтому на сервере работает только
путь «SQL + `psql`»:

```
psql -v ON_ERROR_STOP=1 --single-transaction --file=idempotent.sql
```

`deploy/apply-migrations.sh` выбирает этот путь по умолчанию (`MIGRATION_MODE=sql`)
и оставляет `dotnet` для машины разработчика.

## Перегенерация (после любой новой миграции)

Строго на Linux/macOS или в git-bash, из корня репозитория:

```bash
dotnet ef migrations script --idempotent \
  --project EnglishLearningPlatform.API \
  -o deploy/migrations/idempotent.sql

# EF на Windows пишет файл с BOM, а psql давится на нём ещё до первого CREATE:
python3 -c "p='deploy/migrations/idempotent.sql';b=open(p,'rb').read();open(p,'wb').write(b[3:] if b.startswith(b'\xef\xbb\xbf') else b)"
```

Проверьте, что скрипт покрывает всю историю. Считать надо не защитные блоки, а
уникальные идентификаторы миграций и записи в историю — EF оборачивает КАЖДУЮ
операцию DDL в свой `DO`-блок, поэтому блоков заведомо больше (сейчас 171), а
миграций — 29:

```bash
# сколько миграций скрипт знает (должно совпасть с числом файлов)
grep -oE '[0-9]{14}_[A-Za-z0-9]+' deploy/migrations/idempotent.sql | sort -u | wc -l
# сколько записей он готов вписать в историю (столько же)
grep -c 'INSERT INTO "__EFMigrationsHistory"' deploy/migrations/idempotent.sql
# сколько файлов миграций в коде
ls EnglishLearningPlatform.API/Migrations/[0-9]*.cs | grep -v Designer.cs | wc -l
```

Все три числа обязаны совпадать. Если нет — в скрипт попала не вся история, и
применять его нельзя.

## Что значит «идемпотентный»

Каждая миграция обёрнута в:

```sql
DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '...') THEN
        -- DDL этой миграции
    END IF;
END $EF$;
```

Поэтому скрипт безопасно запускать повторно: уже применённые миграции
пропускаются, недостающие добавляются. Это и есть защита от «прод отстаёт от HEAD»:
не нужно помнить, какие миграции применены, — скрипт сравнит историю с кодом сам.

## Порядок применения

Не изменяйте его. Подробная пошаговая версия с ожидаемым выводом и действиями при
отказе — `docs/execution/GO_GATE_RUNBOOK.md` (одно окно исполнения).

1. **Дамп** (обязательно до миграции):

   ```bash
   pg_dump --format=custom --no-owner --no-privileges \
     --file="backups/predeploy-$(date +%F-%H%M).dump"
   ```

2. **Проверка, что из дампа можно восстановиться** — до, а не после:

   ```bash
   deploy/restore-check.sh backups/predeploy-<stamp>.dump
   ```

3. **Применение**:

   ```bash
   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=lexicon PGDATABASE=lexicon \
     deploy/apply-migrations.sh
   ```

4. **Проверка**, что база догнала код: скрипт сам сверяет число миграций в
   `__EFMigrationsHistory` с числом файлов в `Migrations/` и падает, если они
   разъехались. Отдельный тест на это — `Migrations/PendingMigrationsTests.cs`.

## Откат

Миграции в этом проекте аддитивные (только новые таблицы, колонки и индексы),
поэтому откат SQL-ом не нужен: восстанавливаете дамп.

```bash
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname=lexicon backups/predeploy-<stamp>.dump
```

`--clean --if-exists` требует прав на DROP — тот же пользователь, что владелец схемы.

## Секреты

Ни одного пароля в этом каталоге нет и быть не должно. Всё приходит из окружения
(`PGPASSWORD`, `~/.pgpass`) или спрашивается `psql` интерактивно. Скрипты работают
только с `PGHOST/PGPORT/PGUSER/PGDATABASE` и не подставляют дефолтов — цель
указывается явно, чтобы запуск «куда-нибудь» был невозможен.
