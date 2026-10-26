#!/usr/bin/env bash
#
# apply-migrations.sh — дамп, затем применение миграций, затем проверка.
#
# Зачем отдельный скрипт, если есть `dotnet ef database update`:
#   1. На боевом сервере НЕТ .NET (см. docs/beta-launch/EXECUTION_SEQUENCE.md §A9,
#      «Как это прошло на самом деле»): там стоит self-contained publish, а
#      design-time падает на валидации Jwt:Key. Поэтому скрипт работает в двух
#      режимах и по умолчанию выбирает тот, который на сервере РАБОТАЕТ: SQL через
#      psql. Режим dotnet — для машины разработчика.
#   2. Дамп делается ДО миграции и проверяется на читаемость. 24.10 бэкап был, но
#      его никто не восстанавливал — «файл лежит» и «из него можно подняться» это
#      разные утверждения. Проверка восстановлением — restore-check.sh.
#   3. Идемпотентность: скрипт использует --idempotent SQL, где каждая миграция
#      обёрнута в проверку __EFMigrationsHistory. Повторный запуск ничего не ломает.
#
# Секретов здесь нет: строка подключения приходит из окружения. Если PGPASSWORD не
# задан, psql спросит пароль сам — интерактивно или из ~/.pgpass.
#
# Использование:
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=... PGDATABASE=... ./deploy/apply-migrations.sh
#   MIGRATION_MODE=dotnet ./deploy/apply-migrations.sh
#
# Переменные:
#   PGHOST, PGPORT, PGUSER, PGDATABASE  — цель (обязательны)
#   PGPASSWORD                          — опционально, иначе спросит psql
#   MIGRATION_MODE                      — sql (по умолчанию) | dotnet
#   BACKUP_DIR                          — куда класть дампы (по умолчанию ./backups)
#   SKIP_BACKUP=1                       — только если дамп уже сделан этим же запуском
#   PG_DUMP_FMT                         — custom (по умолчанию) | plain
#
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly SQL_SCRIPT="${SCRIPT_DIR}/migrations/idempotent.sql"

MIGRATION_MODE="${MIGRATION_MODE:-sql}"
BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
PG_DUMP_FMT="${PG_DUMP_FMT:-custom}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { printf '[%s] ОШИБКА: %s\n' "$(date '+%F %T')" "$*" >&2; exit 1; }

# ── 0. Окружение ────────────────────────────────────────────────────────────

for var in PGHOST PGPORT PGUSER PGDATABASE; do
    [[ -n "${!var:-}" ]] || die "не задана ${var}. Скрипт не угадывает базу: явная цель обязательна."
done

command -v psql >/dev/null 2>&1 || die "нет psql в PATH — нечем применять SQL"

if [[ "${SKIP_BACKUP}" != "1" ]]; then
    command -v pg_dump >/dev/null 2>&1 || die "нет pg_dump в PATH. Без дампа миграция — это необратимая правка боевой базы."
fi

if [[ "${MIGRATION_MODE}" == "dotnet" ]]; then
    command -v dotnet >/dev/null 2>&1 || die "MIGRATION_MODE=dotnet, но .NET нет в PATH. На сервере используйте MIGRATION_MODE=sql."
    [[ -f "${SQL_SCRIPT}" ]] || die "нет ${SQL_SCRIPT} — режим sql всё равно нужен для проверки"
fi
[[ -f "${SQL_SCRIPT}" ]] || die "нет ${SQL_SCRIPT}. Сгенерируйте: dotnet ef migrations script --idempotent --project EnglishLearningPlatform.API -o deploy/migrations/idempotent.sql"

readonly CONN_DESC="${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"
export PHOST="${PGHOST}" PGPORT PGUSER PGDATABASE
readonly PSQL_STRICT=(psql -v ON_ERROR_STOP=1 --no-psqlrc --quiet)

log "цель: ${CONN_DESC}"
log "режим миграции: ${MIGRATION_MODE}"

# ── 1. Снимок состояния до: сколько миграций применено ──────────────────────

BEFORE=""
BEFORE="$("${PSQL_STRICT[@]}" -tAc \
    "SELECT count(*) FROM \"__EFMigrationsHistory\"" 2>/dev/null || echo "нет таблицы истории")"
log "миграций в базе до: ${BEFORE}"

# ── 2. Дамп ДО миграции ─────────────────────────────────────────────────────

BACKUP_FILE=""
if [[ "${SKIP_BACKUP}" != "1" ]]; then
    mkdir -p "${BACKUP_DIR}"
    stamp="$(date +%F-%H%M)"
    if [[ "${PG_DUMP_FMT}" == "plain" ]]; then
        BACKUP_FILE="${BACKUP_DIR}/predeploy-${stamp}.sql"
        log "дамп (plain) → ${BACKUP_FILE}"
        pg_dump --format=plain --no-owner --no-privileges --file="${BACKUP_FILE}"
    else
        BACKUP_FILE="${BACKUP_DIR}/predeploy-${stamp}.dump"
        log "дамп (custom) → ${BACKUP_FILE}"
        # -Fc: сжатый, восстанавливается pg_restore и читается pg_restore --list.
        # Пароля в командной строке нет — он идёт из PGPASSWORD или ~/.pgpass.
        pg_dump --format=custom --no-owner --no-privileges --file="${BACKUP_FILE}"
    fi

    # Дамп, из которого нельзя восстановиться, — это не бэкап, а файл.
    [[ -s "${BACKUP_FILE}" ]] || die "дамп пустой: ${BACKUP_FILE}. Миграцию не начинаем."

    if [[ "$(head -c 5 "${BACKUP_FILE}")" != "PGDMP" && "${PG_DUMP_FMT}" != "plain" ]]; then
        die "${BACKUP_FILE} не похож на дамп custom-формата (нет сигнатуры PGDMP)."
    fi
    log "дамп готов: $(du -h "${BACKUP_FILE}" | cut -f1)"
else
    log "SKIP_BACKUP=1 — предполагается дамп, сделанный в этом же запуске"
fi

# ── 3. Применение миграций ──────────────────────────────────────────────────

if [[ "${MIGRATION_MODE}" == "dotnet" ]]; then
    log "dotnet ef database update --no-build"
    ( cd "${REPO_ROOT}" && dotnet ef database update --no-build --project EnglishLearningPlatform.API )
else
    log "применяю ${SQL_SCRIPT} через psql -v ON_ERROR_STOP=1"
    # ON_ERROR_STOP обязателен: без него psql продолжит после ошибки, и база
    # останется в состоянии «половина миграции», которое страшнее, чем отказ.
    "${PSQL_STRICT[@]}" --single-transaction --file="${SQL_SCRIPT}"
fi

# ── 4. Проверка результата ──────────────────────────────────────────────────

AFTER="$("${PSQL_STRICT[@]}" -tAc "SELECT count(*) FROM \"__EFMigrationsHistory\"")"
log "миграций в базе после: ${AFTER}"

# Ожидаемое число берём из объявленных миграций, а не из головы: 29 сейчас, 31
# после AddReaderV3 и AddReaderSpeech — число меняется вместе с кодом.
DECLARED=0
if [[ -d "${REPO_ROOT}/EnglishLearningPlatform.API/Migrations" ]]; then
    DECLARED="$(find "${REPO_ROOT}/EnglishLearningPlatform.API/Migrations" -maxdepth 1 -name '[0-9]*.cs' ! -name '*.Designer.cs' | wc -l | tr -d '[:space:]')"
fi

if [[ "${DECLARED}" -gt 0 && "${AFTER}" != "${DECLARED}" ]]; then
    die "в базе ${AFTER} миграций, в коде ${DECLARED}. База и код разъехались — проверьте вручную:
  psql -c 'SELECT \"MigrationId\" FROM \"__EFMigrationsHistory\" ORDER BY 1 DESC LIMIT 5'
Дамп на случай отката: ${BACKUP_FILE:-не делался (SKIP_BACKUP=1)}"
fi

# Две миграции читалки проверяются поимённо: именно их отсутствие 24.10 дало
# 500 на живом запросе при зелёных локальных тестах.
for migration in AddReaderV3 AddReaderSpeech; do
    found="$("${PSQL_STRICT[@]}" -tAc \
        "SELECT count(*) FROM \"__EFMigrationsHistory\" WHERE \"MigrationId\" LIKE '%_${migration}'")"
    [[ "${found}" == "1" ]] || die "в истории нет миграции ${migration}. База отстала от кода — примените скрипт заново."
done
log "AddReaderV3 и AddReaderSpeech применены"

log "ГОТОВО. Было ${BEFORE} → стало ${AFTER}."
[[ -n "${BACKUP_FILE}" ]] && log "дамп для отката: ${BACKUP_FILE}"
cat <<EOF

Дальше, в этом же окне:
  1) ./deploy/restore-check.sh "${BACKUP_FILE:-}"
     — убедиться, что из дампа реально восстанавливаются данные;
  2) перезапустить сервис и смоук-тесты из docs/execution/GO_GATE_RUNBOOK.md §4.
EOF
