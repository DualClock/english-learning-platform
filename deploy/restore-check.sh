#!/usr/bin/env bash
#
# restore-check.sh — «бэкап есть» → «бэкап проверен».
#
# Зачем: 24.10 дамп в /opt/lexicon/backups/2026-10-24-predeploy/ существовал, но
# его никто не восстанавливал. Файл нужного размера ещё не значит, что из него
# поднимется база: обрезанный custom-дамп читается как валидный, пока не начнёшь
# в него писать. Единственная честная проверка — поднять дамп в отдельную базу и
# посчитать строки в таблицах, без которых продукт не работает.
#
# База называется lexicon_restore_check и удаляется в конце — даже при ошибке.
# Боевую базу скрипт не читает и не пишет: источник — только файл дампа.
#
# Использование:
#   ./deploy/restore-check.sh backups/predeploy-2026-10-26-1830.dump
#
# Переменные:
#   PGHOST, PGPORT, PGUSER       — куда восстанавливать (обязательны)
#   PGPASSWORD                   — опционально
#   RESTORE_DB                   — имя временной базы (по умолчанию lexicon_restore_check)
#
# Требуется право CREATE DATABASE у роли PGUSER.
#
set -euo pipefail

readonly RESTORE_DB="${RESTORE_DB:-lexicon_restore_check}"
DUMP_FILE="${1:-}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { printf '[%s] ОШИБКА: %s\n' "$(date '+%F %T')" "$*" >&2; exit 1; }

# ── 0. Вход ─────────────────────────────────────────────────────────────────

[[ -n "${DUMP_FILE}" ]] || die "укажите файл дампа: $0 backups/predeploy-YYYY-MM-DD-HHMM.dump"
[[ -f "${DUMP_FILE}" ]] || die "нет файла ${DUMP_FILE}"
[[ -s "${DUMP_FILE}" ]] || die "дамп ${DUMP_FILE} пустой — восстанавливать нечего"

for var in PGHOST PGPORT PGUSER; do
    [[ -n "${!var:-}" ]] || die "не задана ${var}"
done

command -v psql      >/dev/null 2>&1 || die "нет psql в PATH"
command -v pg_restore >/dev/null 2>&1 || die "нет pg_restore в PATH"

export PGHOST PGPORT PGUSER
readonly PSQL=(psql -v ON_ERROR_STOP=1 --no-psqlrc --quiet)

# Временная база не должна называться как боевая: одна опечатка в переменной
# окружения не должна приводить к DROP рабочей базы.
case "${RESTORE_DB}" in
    postgres|template0|template1|lexicon|english_learning)
        die "RESTORE_DB=${RESTORE_DB} похоже на настоящую базу. Проверка восстанавливает только в отдельную временную." ;;
esac

log "дамп: ${DUMP_FILE} ($(du -h "${DUMP_FILE}" | cut -f1))"
log "временная база: ${RESTORE_DB} на ${PGHOST}:${PGPORT}"

# ── 1. Формат и целостность дампа ───────────────────────────────────────────

DUMP_FMT="plain"
if [[ "$(head -c 5 "${DUMP_FILE}" 2>/dev/null || true)" == "PGDMP" ]]; then
    DUMP_FMT="custom"
    log "формат: custom — читаю оглавление pg_restore --list"
    TOC="$(pg_restore --list "${DUMP_FILE}")" || die "pg_restore не смог прочитать оглавление — дамп битый"
    entries="$(printf '%s\n' "${TOC}" | grep -cE '^[0-9]+;[[:space:]]' || true)"
    [[ "${entries}" -gt 0 ]] || die "в оглавлении дампа нет объектов"
    log "объектов в оглавлении: ${entries}"
else
    log "формат: plain (SQL-текст)"
    grep -qE 'CREATE TABLE|COPY ' "${DUMP_FILE}" || die "в SQL-файле нет ни CREATE TABLE, ни COPY — это не дамп базы"
fi

# ── 2. Уборка: удалить остаток прошлой упавшей проверки ─────────────────────

cleanup() {
    local code=$?
    set +e
    "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"${RESTORE_DB}\"" >/dev/null 2>&1
    if [[ ${code} -ne 0 ]]; then
        printf '[%s] проверка не прошла (код %s). Временная база %s удалена.\n' \
            "$(date '+%F %T')" "${code}" "${RESTORE_DB}" >&2
    fi
}
trap cleanup EXIT

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"${RESTORE_DB}\"" >/dev/null

log "создаю ${RESTORE_DB}"
"${PSQL[@]}" -d postgres -c "CREATE DATABASE \"${RESTORE_DB}\"" || die "нет права CREATE DATABASE у ${PGUSER}"

# ── 3. Восстановление ───────────────────────────────────────────────────────

log "восстанавливаю"
if [[ "${DUMP_FMT}" == "custom" ]]; then
    # --exit-on-error обязателен: без него pg_restore сообщает об ошибках в
    # stderr, но завершается успехом, и «восстановлено» оказывается ложью.
    pg_restore --exit-on-error --no-owner --no-privileges --dbname="${RESTORE_DB}" "${DUMP_FILE}" \
        || die "pg_restore завершился с ошибкой — из этого дампа база не поднимется"
else
    "${PSQL[@]}" --single-transaction -d "${RESTORE_DB}" --file="${DUMP_FILE}" \
        || die "psql не смог применить SQL-дамп"
fi

# ── 4. Счётчики по таблицам, без которых продукт не работает ────────────────
#
# AspNetUsers — есть ли кому входить; Books — каталог; WordLevels — словарь;
# UserWords — карточки повторения, то есть сохранённые слова. Если дамп
# восстановился, но все четыре по нулям, это пустая база нужной схемы, а не
# бэкап продукта.

readonly TABLES=(AspNetUsers Books WordLevels UserWords)
declare -A COUNTS=()

for table in "${TABLES[@]}"; do
    exists="$("${PSQL[@]}" -tAc \
        "SELECT to_regclass('\"${table}\"') IS NOT NULL" -d "${RESTORE_DB}")"
    if [[ "${exists}" != "t" ]]; then
        die "после восстановления нет таблицы ${table} — схема в дампе неполная"
    fi
    COUNTS["${table}"]="$("${PSQL[@]}" -tAc "SELECT count(*) FROM \"${table}\"" -d "${RESTORE_DB}")"
done

# Схема и история миграций: расхождение истории с таблицами — тихая поломка,
# при которой каталог работает, а следующая миграция падает.
HISTORY="$("${PSQL[@]}" -tAc \
    "SELECT count(*) FROM \"__EFMigrationsHistory\"" -d "${RESTORE_DB}" 2>/dev/null || echo "нет таблицы")"

# ── 5. Отчёт ────────────────────────────────────────────────────────────────

printf '\n%-16s %10s\n' "таблица" "строк"
printf '%-16s %10s\n' "----------------" "----------"
for table in "${TABLES[@]}"; do
    printf '%-16s %10s\n' "${table}" "${COUNTS[${table}]}"
done
printf '%-16s %10s\n\n' "__EFMigrationsHistory" "${HISTORY}"

# Ненулевой AspNetUsers и Books — минимум для того, чтобы бэкап считался бэкапом
# продукта. Ноль здесь означает пустую схему, а не «мало данных».
if [[ "${COUNTS[AspNetUsers]}" -eq 0 ]]; then
    die "в восстановленной базе 0 пользователей — это дамп пустой схемы, а не бэкап продукта"
fi
if [[ "${COUNTS[Books]}" -eq 0 ]]; then
    die "в восстановленной базе 0 книг — каталог из такого бэкапа не поднимется"
fi
if [[ "${COUNTS[WordLevels]}" -eq 0 ]]; then
    log "ВНИМАНИЕ: 0 строк в WordLevels — словарь не сидирован в этом дампе"
fi
if [[ "${COUNTS[UserWords]}" -eq 0 ]]; then
    log "ВНИМАНИЕ: 0 строк в UserWords — у пользователей нет сохранённых слов"
fi

log "ПРОВЕРКА ПРОЙДЕНА: дамп ${DUMP_FILE} восстанавливается, ключевые таблицы непустые"
