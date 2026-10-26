#!/usr/bin/env bash
# selftest.sh — проверка самих scripts/*.sh на подложенных данных.
#
# Проверяем на ВРЕМЕННОМ git-репозитории, а не на рабочем дереве: рабочие
# файлы меняются параллельно, и тест, зависящий от них, ломается от чужой
# правки (а тест, зашитый в «рабочее дерево чисто», врёт).
#
# Запуск: bash scripts/selftest.sh
# Коды выхода: 0 — все проверки прошли, 1 — есть падение.

set -uo pipefail   # без -e: перебираем все проверки, а не падаем на первой

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEN="$HERE/generate-secrets.sh"
CHECK="$HERE/check-secrets.sh"

TMP_ROOT="${TMPDIR:-/tmp}"
# git — нативный бинарник, MSYS-путь /tmp/... ему не переводится (git-bash:
# «cannot change to '/tmp/...'»). Поэтому берём физический путь через pwd -W
# (git-bash) и падаем назад на cygpath -m / голый pwd в обычном Linux.
if native_root="$(cd "$TMP_ROOT" && pwd -W 2>/dev/null)" && [ -n "$native_root" ]; then
  TMP_ROOT="$native_root"
elif command -v cygpath >/dev/null 2>&1; then
  TMP_ROOT="$(cygpath -m "$TMP_ROOT")"
fi
TMP_ROOT="$TMP_ROOT/lexicon-selftest.$$"
mkdir -p "$TMP_ROOT"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()   { pass=$((pass + 1)); printf 'PASS  %s\n' "$1"; }
bad()  { fail=$((fail + 1)); printf 'FAIL  %s\n' "$1"; [ $# -gt 1 ] && printf '      %s\n' "$2"; }

for f in "$GEN" "$CHECK"; do
  [ -f "$f" ] || { bad "файл существует: $(basename "$f")"; exit 1; }
  bash -n "$f" 2>/dev/null && ok "синтаксис bash: $(basename "$f")" \
    || bad "синтаксис bash: $(basename "$f")" "$(bash -n "$f" 2>&1 | head -3)"
done

# ---------------------------------------------------------------- generate-secrets

OUT="$(bash "$GEN" 2>"$TMP_ROOT/gen.err")"
GEN_EXIT=$?
[ "$GEN_EXIT" -eq 0 ] && ok "generate-secrets.sh: код 0" || bad "generate-secrets.sh: код $GEN_EXIT" "$(cat "$TMP_ROOT/gen.err")"

# Ключи, которые скрипт обязан печатать, и их минимальные длины.
declare -A MINLEN=(
  [NEXTAUTH_SECRET]=64
  [Jwt__Key]=64
  [Seeder__Key]=43
  [Feedback__AdminKey]=43
  [Analytics__GuestIpSalt]=64
)

for key in "${!MINLEN[@]}"; do
  value="$(printf '%s\n' "$OUT" | grep -E "^${key}=" | head -1 | cut -d= -f2-)"
  if [ -z "$value" ]; then
    bad "generate: ключ $key присутствует"; continue
  fi
  len=${#value}
  if [ "$len" -ge "${MINLEN[$key]}" ]; then
    ok "generate: $key длиной $len (>= ${MINLEN[$key]})"
  else
    bad "generate: $key длиной $len, нужно >= ${MINLEN[$key]}"
  fi
  # Значение должно быть неплейсхолдером и не начинаться с мусора.
  if printf '%s' "$value" | grep -Eq 'CHANGE|secret|SET_IN_ENV|your'; then
    bad "generate: $key похож на плейсхолдер"
  fi
done

# Два прогона подряд не должны совпадать — иначе «генератор» печатает константу.
OUT2="$(bash "$GEN" 2>/dev/null)"
if [ "$OUT" != "$OUT2" ]; then
  ok "generate: два прогона дают разные значения"
else
  bad "generate: два прогона одинаковы — значения не случайны"
fi

# Скрипт не должен писать файлов рядом с собой: в каталоге scripts после
# прогона допустимы только известные файлы.
stray="$(cd "$HERE" && ls -1 | grep -vE '^(generate-secrets\.sh|check-secrets\.sh|selftest\.sh|README\.md)$' || true)"
[ -z "$stray" ] && ok "generate: не создал файлов рядом с собой" \
  || bad "generate: появились посторонние файлы" "$stray"

# Ключи не должны пересекаться значениями внутри одного вывода.
dupes="$(printf '%s\n' "$OUT" | grep -E '^[A-Za-z_]+=' | cut -d= -f2- | sort | uniq -d)"
[ -z "$dupes" ] && ok "generate: все значения различны" || bad "generate: есть одинаковые значения"

# ---------------------------------------------------------------- check-secrets

new_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" config user.email selftest@example.test
  git -C "$dir" config user.name selftest
  # Без этого git в git-bash пишет в stderr «LF will be replaced by CRLF»,
  # и вывод теста тонет в шуме, не связанном с проверками.
  git -C "$dir" config core.autocrlf false
}

run_check() {  # $1 = каталог репозитория; печатает вывод, возвращает код check-secrets
  # Проверки в selftest — про ДЕТЕКТОР, а не про режим по умолчанию: здесь
  # всегда --strict, иначе «нашёл плейсхолдер» и «упал» перестают быть
  # одним событием. Поведение без --strict проверяется отдельным кейсом ниже.
  ( cd "$1" && bash "$CHECK" --strict 2>&1 )
}

# 1. Чистое дерево -> 0.
REPO_CLEAN="$TMP_ROOT/clean"
new_repo "$REPO_CLEAN"
printf '{\n  "Jwt": { "Key": "%s" }\n}\n' "$(openssl rand -base64 64 | tr -d '\n')" > "$REPO_CLEAN/appsettings.json"
printf 'const x = 1;\n' > "$REPO_CLEAN/app.ts"
git -C "$REPO_CLEAN" add -A
out="$(run_check "$REPO_CLEAN")"; code=$?
[ "$code" -eq 0 ] && ok "check: чистое дерево -> код 0" \
  || bad "check: чистое дерево должно давать 0, получено $code" "$out"

# 2. CHANGE_ME в значении -> 1.
REPO_PH="$TMP_ROOT/placeholder"
new_repo "$REPO_PH"
printf '{"Jwt": {"Key": "CHANGE_ME_please"}}\n' > "$REPO_PH/appsettings.json"
git -C "$REPO_PH" add -A
out="$(run_check "$REPO_PH")"; code=$?
[ "$code" -eq 1 ] && ok "check: CHANGE_ME -> код 1" \
  || bad "check: CHANGE_ME должен давать 1, получено $code" "$out"
printf '%s' "$out" | grep -q "appsettings.json:1" \
  && ok "check: CHANGE_ME: путь и строка в отчёте" \
  || bad "check: CHANGE_ME: нет пути/строки в отчёте" "$out"

# 3. SET_IN_ENV в строке подключения -> 1, тип connection-string.
REPO_CONN="$TMP_ROOT/conn"
new_repo "$REPO_CONN"
printf '{"ConnectionStrings":{"DefaultConnection":"Host=db;Password=SET_IN_ENV"}}\n' > "$REPO_CONN/appsettings.json"
git -C "$REPO_CONN" add -A
out="$(run_check "$REPO_CONN")"; code=$?
[ "$code" -eq 1 ] && ok "check: Password=SET_IN_ENV -> код 1" \
  || bad "check: Password=SET_IN_ENV должен давать 1, получено $code" "$out"
printf '%s' "$out" | grep -q "connection-string" \
  && ok "check: SET_IN_ENV распознан как строка подключения" \
  || bad "check: SET_IN_ENV не помечен как connection-string" "$out"

# 4. Плейсхолдер NEXTAUTH_SECRET из туториала next-auth -> 1.
REPO_NA="$TMP_ROOT/nextauth"
new_repo "$REPO_NA"
printf 'NEXTAUTH_SECRET=your-super-secret-key\n' > "$REPO_NA/.env.production"
git -C "$REPO_NA" add -A
out="$(run_check "$REPO_NA")"; code=$?
[ "$code" -eq 1 ] && ok "check: NEXTAUTH_SECRET из туториала -> код 1" \
  || bad "check: плейсхолдер NEXTAUTH_SECRET должен давать 1, получено $code" "$out"
printf '%s' "$out" | grep -q "nextauth" \
  && ok "check: NEXTAUTH_SECRET распознан отдельным классом" \
  || bad "check: NEXTAUTH_SECRET не распознан" "$out"

# 5. .md и *.example исключены -> 0. Рядом кладём обычный файл: проверять
#    «чистоту» репозитория, где после исключений не осталось ни одного файла,
#    было бы самообманом (чекер в этом случае честно говорит «проверять нечего»).
REPO_DOC="$TMP_ROOT/docs"
new_repo "$REPO_DOC"
printf 'NEXTAUTH_SECRET=your-super-secret-key\n' > "$REPO_DOC/README.md"
printf 'Jwt__Key=CHANGE_ME\n' > "$REPO_DOC/env.example"
printf 'const build = 1;\n' > "$REPO_DOC/app.ts"
git -C "$REPO_DOC" add -A
out="$(run_check "$REPO_DOC")"; code=$?
[ "$code" -eq 0 ] && ok "check: .md и .example исключены -> код 0" \
  || bad "check: .md/.example должны исключаться, получено $code" "$out"

# 5b. Репозиторий из одной документации -> 0, но с явным «проверять нечего»,
#     а не молчаливым OK.
REPO_ONLYDOC="$TMP_ROOT/onlydoc"
new_repo "$REPO_ONLYDOC"
printf 'Jwt__Key=CHANGE_ME\n' > "$REPO_ONLYDOC/env.example"
git -C "$REPO_ONLYDOC" add -A
out="$(run_check "$REPO_ONLYDOC")"; code=$?
if [ "$code" -eq 0 ] && printf '%s' "$out" | grep -q "Проверять нечего"; then
  ok "check: только .example -> 0 + явное «проверять нечего»"
else
  bad "check: только .example должен давать 0 с пояснением, получено $code" "$out"
fi

# 6. ЗАЩИТНАЯ строка в коде (StartsWith("SET_IN_ENV")) — не находка.
#    Это регрессия на реальный ложно-положительный случай в Program.cs.
REPO_CODE="$TMP_ROOT/code"
new_repo "$REPO_CODE"
printf 'if (jwtKey.StartsWith("SET_IN_ENV", StringComparison.OrdinalIgnoreCase)) { throw; }\n' > "$REPO_CODE/Program.cs"
git -C "$REPO_CODE" add -A
out="$(run_check "$REPO_CODE")"; code=$?
[ "$code" -eq 0 ] && ok "check: защитная проверка SET_IN_ENV в коде не находка" \
  || bad "check: ложное срабатывание на StartsWith(\"SET_IN_ENV\")" "$out"

# 7. Одинаковое значение у двух разных ключей -> 1.
REPO_DUP="$TMP_ROOT/dup"
new_repo "$REPO_DUP"
shared="$(openssl rand -base64 48 | tr -d '\n')"
printf 'Seeder__Key=%s\nFeedback__AdminKey=%s\n' "$shared" "$shared" > "$REPO_DUP/runtime.env"
git -C "$REPO_DUP" add -A
out="$(run_check "$REPO_DUP")"; code=$?
[ "$code" -eq 1 ] && ok "check: один секрет на два ключа -> код 1" \
  || bad "check: повтор значения должен давать 1, получено $code" "$out"

# 8. Неотслеживаемый файл не валит проверку (он не уедет в историю).
REPO_UNTRACKED="$TMP_ROOT/untracked"
new_repo "$REPO_UNTRACKED"
printf 'ok\n' > "$REPO_UNTRACKED/tracked.txt"
git -C "$REPO_UNTRACKED" add -A
printf 'NEXTAUTH_SECRET=CHANGE_ME\n' > "$REPO_UNTRACKED/.env"
out="$(run_check "$REPO_UNTRACKED")"; code=$?
[ "$code" -eq 0 ] && ok "check: неотслеживаемый .env не валит проверку" \
  || bad "check: неотслеживаемый файл не должен проверяться, получено $code" "$out"

# 9. Вне git-репозитория -> код 2 (ошибка окружения, а не «чисто»).
mkdir -p "$TMP_ROOT/nogit"
out="$( cd "$TMP_ROOT/nogit" && bash "$CHECK" 2>&1 )"; code=$?
[ "$code" -eq 2 ] && ok "check: вне git-репозитория -> код 2" \
  || bad "check: вне git должен быть код 2, получено $code" "$out"

# 12. Режим по умолчанию (без --strict): находки есть, но код 0.
# Это не «проверка сломана», а осознанный контракт: заглушки SET_IN_ENV в
# appsettings.json лежат в git намеренно, и валить локальное дерево из-за них —
# шум, из-за которого красный CI перестают читать. CI вызывает скрипт с
# --strict, где код 1 сохраняется (кейсы 2-3 выше).
out="$(cd "$REPO_PH" && bash "$CHECK" 2>&1)"; code=$?
[ "$code" -eq 0 ] && ok "check: без --strict находки дают 0 (предупреждение)" \
  || bad "check: без --strict ожидался 0, получено $code" "$out"
printf '%s' "$out" | grep -q "Найдено плейсхолдеров" \
  && ok "check: без --strict находки всё равно печатаются" \
  || bad "check: без --strict отчёт пропал" "$out"

# ---------------------------------------------------------------- итог

printf '\nИтого: %s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
exit 0
