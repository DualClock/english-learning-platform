#!/usr/bin/env bash
# check-secrets.sh — ловит в ОТСЛЕЖИВАЕМЫХ git-файлах значения-заглушки,
# которые притворяются секретами. Не ищет «все секреты» (это работа gitleaks
# в CI), а закрывает конкретный класс ошибок, который уже случался:
# в прод уехал NEXTAUTH_SECRET из туториала, а в appsettings.json — SET_IN_ENV.
#
# Почему по отслеживаемым файлам, а не по всему дереву: git ls-files — это
# ровно то, что попадёт в историю и на сервер. Локальный .env с живым ключом
# не должен валить проверку (он в .gitignore), а вот .env, случайно
# добавленный в индекс, — должен, и он туда попадает.
#
# Исключения: документация и шаблоны. В .md плейсхолдеры — это и есть предмет
# разговора; .example/.sample/.template — намеренно пустые шаблоны.
#
# Коды выхода: 0 — чисто, 1 — найдены плейсхолдеры, 2 — ошибка окружения.

set -euo pipefail

# --strict: падать (exit 1) на находках. По умолчанию скрипт только
# предупреждает, потому что заглушки `SET_IN_ENV` в appsettings.json лежат
# в git намеренно — реальные значения приходят из окружения. В CI нужен
# --strict: там проверяется, что секреты уже ротированы перед выкаткой.
strict=0
for arg in "$@"; do
  case "$arg" in
    --strict) strict=1 ;;
    -h|--help)
      echo "Использование: check-secrets.sh [--strict]"
      echo "  --strict  падать с кодом 1 при находках (для CI)"
      exit 0
      ;;
    *)
      echo "Неизвестный аргумент: $arg" >&2
      exit 2
      ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "ОШИБКА: не git-репозиторий (нужен git в PATH и запуск внутри дерева)." >&2
  exit 2
fi
cd "$REPO_ROOT"

# Плейсхолдеры из документации next-auth и общая «заглушечная» лексика.
# Каждый регексп якорится на присваивание или литерал, а не на слово целиком:
# комментарий «не задавайте secret в git» не должен валить проверку.
PLACEHOLDER_RE='(CHANGE[_-]?ME|REPLACE[_-]?ME|your-super-secret|your_secret|YOUR_SECRET|SET_IN_ENV|changeme)'

# Код может ЗАКОННО ссылаться на литерал заглушки: Program.cs отказывается
# стартовать в Production, если Jwt:Key начинается с SET_IN_ENV. Это защита,
# а не секрет. Поэтому детектор заглушек в коде срабатывает только там, где
# литерал стоит ЗНАЧЕНИЕМ, а не аргументом проверки:
#   Key = "SET_IN_ENV..."   -> находка
#   StartsWith("SET_IN_ENV") -> не находка
SOURCE_PLACEHOLDER_RE='((=|:)[[:space:]]*["'\'']?(CHANGE[_-]?ME|REPLACE[_-]?ME|your-super-secret|SET_IN_ENV|changeme))'
CODE_EXT_RE='\.(cs|ts|tsx|js|mjs|cjs|json|yml|yaml|sh|ps1|py|conf|service|env|toml|ini)$'

# Значение-плейсхолдер NEXTAUTH_SECRET именно из туториала next-auth
# («your-super-secret-key» / «this-is-a-secret») — этот текст знает каждый,
# кто открывал документацию, то есть подделка сессии бесплатна.
NEXTAUTH_PLACEHOLDER_RE='NEXTAUTH_SECRET[[:space:]]*[=:][[:space:]]*["'\'']?(your|change|replace|changeme|secret|-this|this-is|test)[^"'\''[:space:]]*'

# Признак «настоящий пароль рядом с заглушкой»: SET_IN_ENV уже ловится выше,
# но Password=SET_IN_ENV в строке подключения опаснее прочих — учтём отдельно
# ради понятного сообщения.
#
# Голое Password=postgres или apppass123 — типичный docker-compose/CI-сервис.
# Это осознанно НЕ находка: такие пароли живут в эфемерном контейнере, который
# не выходит за loopback раннера, и валить на них проверку значит приучить
# игнорировать её вывод. Внимание: CI печатает такую строку в журнал сборки,
# поэтому в ней не должно быть ничего, кроме локальной базы.
CONN_PLACEHOLDER_RE='(Password|Pwd)[[:space:]]*=[[:space:]]*["'\'']?(SET_IN_ENV|CHANGE_ME|changeme)'

# Что исключаем: документация, шаблоны, бинарники, lock-файлы (там свои хеши,
# и «changeme» в имени npm-пакета — не плейсхолдер).
EXCLUDE_GLOBS=(
  ':(exclude)*.md'
  ':(exclude)*.mdx'
  ':(exclude)*.example'
  ':(exclude)*.sample'
  ':(exclude)*.template'
  ':(exclude)*.lock'
  ':(exclude)package-lock.json'
  ':(exclude)*.png'
  ':(exclude)*.jpg'
  ':(exclude)*.jpeg'
  ':(exclude)*.gif'
  ':(exclude)*.webp'
  ':(exclude)*.ico'
  ':(exclude)*.mp3'
  ':(exclude)*.wav'
  ':(exclude)*.pdf'
  # Сам чекер содержит эти строки по определению — иначе он ловит сам себя.
  ':(exclude)scripts/check-secrets.sh'
  ':(exclude)scripts/selftest.sh'
)

# Файлы, которые читаем: всё отслеживаемое, кроме исключений.
# -z + tr на NUL, а не «tr -d»: на git-bash в именах есть CRLF, и склейка
# строк без разделителя превращала список в одну строку (проверено — count=0).
mapfile -t FILES < <(git ls-files -z -- . "${EXCLUDE_GLOBS[@]}" | tr '\0' '\n')
# В git-bash имена приходят с CR в конце; обрезаем здесь, а не в цикле —
# иначе "[ -f "app.ts\r" ]" ложно, и файл молча пропускается.
FILES=("${FILES[@]%$'\r'}")

if [ ${#FILES[@]} -eq 0 ]; then
  # Два РАЗНЫХ случая, которые раньше склеивались в один:
  #   A. git ls-files пуст — проверять нечего, репозиторий пустой/битый, код 2;
  #   B. файлы в индексе есть, но все попали под исключения (.md/.example) —
  #      проверка корректно отработала, просто смотреть не на что, код 0.
  # Различить их можно только по сырому списку: если он непуст, а после
  # исключений пуст — это случай B. Иначе «репозиторий из одного README»
  # получал бы код 2 и валил поиск сломанного окружения на ровном месте.
  raw="$(git ls-files -z -- . | tr '\0' '\n' | tr -d '\r' | grep -c . || true)"
  if [ "${raw:-0}" -gt 0 ]; then
    echo "ВНИМАНИЕ: после исключений (.md/.example/.lock/бинарники) не осталось ни одного файла." >&2
    echo "Проверять нечего; это не признак чистоты дерева." >&2
    exit 0
  fi
  echo "ОШИБКА: git ls-files вернул пустой список — проверять нечего, это не нормально." >&2
  exit 2
fi

failures=0

report() {
  local file="$1" line_no="$2" pattern="$3" text="$4"
  # Значение НЕ печатаем целиком: в отчёте достаточно имени файла и строки,
  # иначе сам отчёт становится сливом.
  local shown
  shown="$(printf '%s' "$text" | sed -E 's/[[:space:]]+/ /g' | cut -c1-80)"
  printf 'ПЛЕЙСХОЛДЕР [%s] %s:%s\n    %s\n' "$pattern" "$file" "$line_no" "$shown"
  failures=$((failures + 1))
}

for file in "${FILES[@]}"; do
  [ -f "$file" ] || continue
  # В коде и конфигах проверяем только «литерал в позиции значения» — иначе
  # детектор ругается на защитную проверку StartsWith("SET_IN_ENV").
  if [[ "$file" =~ $CODE_EXT_RE ]]; then
    patterns="$SOURCE_PLACEHOLDER_RE|$NEXTAUTH_PLACEHOLDER_RE|$CONN_PLACEHOLDER_RE"
  else
    patterns="$PLACEHOLDER_RE|$NEXTAUTH_PLACEHOLDER_RE|$CONN_PLACEHOLDER_RE"
  fi
  # -I: пропустить двоичные; -n: номера строк; пустые совпадения не считаем.
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    line_no="${hit%%:*}"
    text="${hit#*:}"
    if printf '%s' "$text" | grep -Eq -- "$NEXTAUTH_PLACEHOLDER_RE"; then
      report "$file" "$line_no" "nextauth" "$text"
    elif printf '%s' "$text" | grep -Eq -- "$CONN_PLACEHOLDER_RE"; then
      report "$file" "$line_no" "connection-string" "$text"
    else
      report "$file" "$line_no" "placeholder" "$text"
    fi
  done < <(grep -nIE -- "$patterns" "$file" 2>/dev/null || true)
done

if [ "$failures" -gt 0 ]; then
  printf '\nНайдено плейсхолдеров: %s. Замените значения через менеджер секретов\n' "$failures"
  printf '(bash scripts/generate-secrets.sh), либо вынесите шаблон с суффиксом .example.\n'
  printf 'Порядок и последствия — docs/execution/SECRET_ROTATION.md.\n'
  printf 'Находки в appsettings.json — это ОЖИДАЕМО, если вы ещё не ротировали:\n'
  printf 'они и есть причина ротации.\n'
  # Режим по умолчанию — предупреждение (exit 0): заглушки `SET_IN_ENV` в
  # appsettings.json лежат в git намеренно, реальные значения приходят из
  # окружения. Валить локальное дерево из-за них — шум. В CI скрипт вызывается
  # с --strict и падает, потому что там проверяется уже ротированный секрет.
  if [ "$strict" = "1" ]; then
    exit 1
  fi
  printf 'Предупреждение: код возврата 0 (запустите с --strict, чтобы падать).\n'
  exit 0
fi

# Дословный повтор в одном файле — признак «скопировали значение в другой
# ключ». Сид-ключ и ключ отзывов должны различаться (SECRET_ROTATION.md),
# иначе компрометация одного даёт доступ к обоим.
dupes=0
for file in "${FILES[@]}"; do
  [ -f "$file" ] || continue
  dup="$(grep -oE '(Seeder__Key|Feedback__AdminKey|NEXTAUTH_SECRET|Jwt__Key)[[:space:]]*[=:][[:space:]]*["'\'']?[A-Za-z0-9+/=_-]{24,}' "$file" 2>/dev/null \
        | sed -E 's/^[^=:]*[=:][[:space:]]*["'\'']?//' | sort | uniq -d || true)"
  if [ -n "$dup" ]; then
    printf 'ОДИНАКОВОЕ ЗНАЧЕНИЕ У РАЗНЫХ КЛЮЧЕЙ: %s\n' "$file"
    dupes=$((dupes + 1))
  fi
done
if [ "$dupes" -gt 0 ]; then
  printf '  (значение не печатается) Один секрет — один ключ: перегенерируйте.\n'
  exit 1
fi

printf 'OK: плейсхолдеров не найдено (%s отслеживаемых файлов проверено).\n' ${#FILES[@]}
exit 0
