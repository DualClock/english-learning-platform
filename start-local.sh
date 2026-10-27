#!/usr/bin/env bash
#
# Lexicon — локальный запуск одной командой.
#
#   ./start-local.sh              поднять всё и открыть браузер
#   ./start-local.sh --no-open    поднять без открытия браузера
#   ./start-local.sh status       показать, что сейчас запущено
#   ./start-local.sh stop         остановить API и фронт (БД останется)
#   ./start-local.sh stop --db    остановить всё, включая контейнер Postgres
#
# Скрипт идемпотентен: если часть уже работает, он её не трогает и не падает
# на «порт занят». Логи пишутся в .local-run/, там же PID-файлы.
#
# Требования: Docker Desktop запущен, установлены dotnet и node.

set -uo pipefail

# ─────────────────────────── настройки стенда ───────────────────────────
#
# Корень проекта. Если скрипт лежит внутри проекта — берём его расположение.
# Если скрипт скопирован наружу (например, на рабочий стол) — ищем проект
# рядом и по известному пути ниже. Иначе ROOT станет рабочим столом, и скрипт
# создаст .local-run не там, а миграции/логи уйдут в пустоту.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

resolve_root() {
  local candidates
  candidates=(
    "$SCRIPT_DIR"
    "$SCRIPT_DIR/EnglishLearningPlatform"
    "$HOME/Desktop/EnglishLearningPlatform"
    "/c/Users/Nikita/Desktop/EnglishLearningPlatform"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate/EnglishLearningPlatform.API/EnglishLearningPlatform.API.csproj" ] \
      && [ -d "$candidate/frontend" ]; then
      (cd "$candidate" && pwd)
      return 0
    fi
  done

  return 1
}

if ! ROOT="$(resolve_root)"; then
  printf '\e[31m✗\e[0m Проект Lexicon не найден.\n'
  printf '  Искал в:\n'
  printf '    %s\n' "$SCRIPT_DIR" "$SCRIPT_DIR/EnglishLearningPlatform" \
    "$HOME/Desktop/EnglishLearningPlatform" \
    "/c/Users/Nikita/Desktop/EnglishLearningPlatform"
  printf '  Положите скрипт в корень проекта или поправьте путь в resolve_root().\n'
  exit 1
fi

cd "$ROOT" || exit 1

# База стенда — lexicon_gogate. НЕ english_learning: это база из docker-compose
# по умолчанию, и миграции в неё уже накатывались отдельно разными ветками.
DB_NAME="lexicon_gogate"
DB_PORT="5433"
DB_USER="appuser"
DB_PASS="apppass123"

API_PORT="5226"
WEB_PORT="3100"

# Ключи ТОЛЬКО для локального стенда. На проде они обязаны быть другими —
# см. docs/execution/SECRET_ROTATION.md.
JWT_KEY="gogate-only-key-min-32-characters-long!!"
JWT_ISSUER="GoGate"
JWT_AUDIENCE="GoGate.Users"
NEXTAUTH_SECRET="gogate-nextauth-secret-min-32-characters!!"

RUN_DIR="$ROOT/.local-run"
API_LOG="$RUN_DIR/api.log"
WEB_LOG="$RUN_DIR/web.log"
API_PID="$RUN_DIR/api.pid"
WEB_PID="$RUN_DIR/web.pid"

mkdir -p "$RUN_DIR"

# ──────────────────────────── оформление ────────────────────────────────
if [ -t 1 ]; then
  B=$'\e[1m'; DIM=$'\e[2m'; GREEN=$'\e[32m'; RED=$'\e[31m'
  YELLOW=$'\e[33m'; CYAN=$'\e[36m'; OFF=$'\e[0m'
else
  B=""; DIM=""; GREEN=""; RED=""; YELLOW=""; CYAN=""; OFF=""
fi

step()  { printf '%s▸%s %s\n' "$CYAN" "$OFF" "$1"; }
ok()    { printf '%s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn()  { printf '%s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
fail()  { printf '%s✗%s %s\n' "$RED" "$OFF" "$1"; }
hint()  { printf '  %s%s%s\n' "$DIM" "$1" "$OFF"; }

# ──────────────────────────── утилиты ───────────────────────────────────

# Порт занят? Работает и на Windows (netstat), и на Linux/macOS.
port_busy() {
  local port="$1"
  if command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | grep -qE "[:.]${port}[[:space:]].*LISTENING"
  else
    (echo >"/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1
  fi
}

# HTTP-ответ сервиса. Пусто, если не отвечает.
http_code() {
  local url="$1"
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || true
}

wait_for_http() {
  local url="$1" want="$2" seconds="$3" label="$4"
  local i
  for i in $(seq 1 "$seconds"); do
    if [ "$(http_code "$url")" = "$want" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Убить процесс по PID-файлу, если он ещё наш и жив.
#
# На Windows PID-файл хранит PID bash-обёртки, а порт держит ДОЧЕРНИЙ node/dotnet.
# Убийство обёртки оставляет ребёнка живым: «остановлено», но порт занят.
# Поэтому после сигнала дополнительно добиваем того, кто реально слушает порт.
kill_from_pidfile() {
  local pidfile="$1" label="$2" port="$3"
  [ -f "$pidfile" ] || return 0
  local pid
  pid="$(cat "$pidfile" 2>/dev/null | tr -d '[:space:]')"
  rm -f "$pidfile"
  [ -n "$pid" ] || return 0

  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null
    sleep 2
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null
  fi

  kill_port_listener "$port" "$label"
}

# Добить того, кто слушает порт. Нужен, когда PID-файл потерян или устарел.
kill_port_listener() {
  local port="$1" label="$2"

  if command -v netstat >/dev/null 2>&1; then
    local pids
    pids="$(netstat -ano 2>/dev/null \
      | grep -E "[:.]${port}[[:space:]].*LISTENING" \
      | awk '{print $NF}' | sort -u)"

    local p
    for p in $pids; do
      [ -z "$p" ] && continue
      [ "$p" = "0" ] && continue
      if command -v taskkill >/dev/null 2>&1; then
        taskkill /PID "$p" /F >/dev/null 2>&1
      else
        kill -KILL "$p" 2>/dev/null
      fi
    done

    if [ -n "$pids" ]; then
      sleep 1
    fi
  fi

  if port_busy "$port"; then
    warn "$label: порт $port всё ещё занят"
    hint "проверьте: netstat -ano | grep $port"
  else
    ok "$label остановлен"
  fi
}

# ──────────────────────────── шаги ──────────────────────────────────────

check_tools() {
  local missing=0

  if ! command -v docker >/dev/null 2>&1; then
    fail "Docker не найден в PATH"
    missing=1
  elif ! docker info >/dev/null 2>&1; then
    fail "Docker Desktop не запущен — запустите его и повторите"
    hint "Docker Desktop запускается вручную, демон по умолчанию не работает"
    missing=1
  fi

  if ! command -v dotnet >/dev/null 2>&1; then
    fail "dotnet не найден в PATH"
    missing=1
  fi

  if ! command -v node >/dev/null 2>&1; then
    fail "node не найден в PATH"
    missing=1
  fi

  if [ -z "${BASH_VERSION:-}" ] && [ -z "${ZSH_VERSION:-}" ]; then
    warn "запущено не из bash — функции могут вести себя иначе"
  fi

  return "$missing"
}

start_db() {
  step "Postgres (Docker, порт $DB_PORT)"

  if port_busy "$DB_PORT"; then
    ok "уже слушает $DB_PORT"
    return 0
  fi

  if ! docker compose up -d >/dev/null 2>&1; then
    fail "docker compose up не удался"
    hint "посмотрите: docker compose logs"
    return 1
  fi

  # Контейнер поднимается не мгновенно: ждём именно готовности порта.
  local i
  for i in $(seq 1 30); do
    if port_busy "$DB_PORT"; then
      ok "поднят на $DB_PORT"
      return 0
    fi
    sleep 1
  done

  fail "контейнер не открыл порт $DB_PORT за 30 с"
  hint "docker compose logs"
  return 1
}

apply_migrations() {
  step "Миграции базы $DB_NAME"

  export ConnectionStrings__DefaultConnection="Host=127.0.0.1;Port=$DB_PORT;Database=$DB_NAME;Username=$DB_USER;Password=$DB_PASS"
  export Jwt__Key="$JWT_KEY"
  export Jwt__Issuer="$JWT_ISSUER"
  export Jwt__Audience="$JWT_AUDIENCE"

  local out
  out="$(dotnet ef database update \
      --project EnglishLearningPlatform.API \
      --startup-project EnglishLearningPlatform.API \
      --no-build 2>&1)"

  if [ $? -ne 0 ]; then
    # --no-build падает, если проект ещё не собирался — пробуем со сборкой.
    out="$(dotnet ef database update \
        --project EnglishLearningPlatform.API \
        --startup-project EnglishLearningPlatform.API 2>&1)"
  fi

  if [ $? -ne 0 ]; then
    fail "миграции не применились"
    printf '%s\n' "$out" | tail -12 | sed 's/^/  /'
    return 1
  fi

  ok "база в актуальном состоянии"
}

start_api() {
  step "API (порт $API_PORT)"

  if [ "$(http_code "http://127.0.0.1:$API_PORT/health")" = "200" ]; then
    ok "уже работает — http://127.0.0.1:$API_PORT"
    return 0
  fi

  if port_busy "$API_PORT"; then
    warn "порт $API_PORT занят чужим процессом — освободите его"
    hint "на Windows: netstat -ano | grep $API_PORT, затем taskkill /PID <pid> /F"
    return 1
  fi

  export ConnectionStrings__DefaultConnection="Host=127.0.0.1;Port=$DB_PORT;Database=$DB_NAME;Username=$DB_USER;Password=$DB_PASS"
  export Jwt__Key="$JWT_KEY"
  export Jwt__Issuer="$JWT_ISSUER"
  export Jwt__Audience="$JWT_AUDIENCE"
  export ASPNETCORE_ENVIRONMENT="Development"
  export ASPNETCORE_URLS="http://127.0.0.1:$API_PORT"
  export Cors__Origins="http://localhost:$WEB_PORT,http://localhost:3000"

  : >"$API_LOG"
  nohup dotnet run --project EnglishLearningPlatform.API >>"$API_LOG" 2>&1 &
  echo $! >"$API_PID"

  if wait_for_http "http://127.0.0.1:$API_PORT/health" "200" 90 "API"; then
    ok "поднят — http://127.0.0.1:$API_PORT"
    hint "Swagger: http://127.0.0.1:$API_PORT/swagger"
    return 0
  fi

  fail "API не ответил за 90 с"
  hint "лог: $API_LOG"
  tail -20 "$API_LOG" | sed 's/^/  /'
  return 1
}

start_web() {
  step "Фронт (порт $WEB_PORT)"

  if [ "$(http_code "http://localhost:$WEB_PORT/")" = "200" ]; then
    ok "уже работает — http://localhost:$WEB_PORT"
    return 0
  fi

  if port_busy "$WEB_PORT"; then
    warn "порт $WEB_PORT занят чужим процессом — освободите его"
    return 1
  fi

  if [ ! -d "frontend/node_modules" ]; then
    step "первый запуск: npm install (может занять пару минут)"
    if ! (cd frontend && npm install --no-audit --no-fund >>"$RUN_DIR/npm.log" 2>&1); then
      fail "npm install не удался, лог: $RUN_DIR/npm.log"
      return 1
    fi
  fi

  # ВАЖНО: .env.local в репозитории указывает NEXTAUTH_URL на порт 3000.
  # Если оставить как есть, NextAuth отдаёт куку с неверным адресом, и вход
  # «проходит», но сессия не читается — выглядит как «логин не работает».
  # Поэтому переменные передаются процессу явно и перекрывают файл.
  (
    cd frontend || exit 1
    export NEXT_PUBLIC_API_URL="http://127.0.0.1:$API_PORT"
    export NEXTAUTH_URL="http://localhost:$WEB_PORT"
    export NEXTAUTH_SECRET="$NEXTAUTH_SECRET"
    # Прокси в окружении ломает локальные запросы — исключаем localhost.
    export NO_PROXY="localhost,127.0.0.1"
    unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
    : >"$WEB_LOG"
    nohup npm run dev -- --port "$WEB_PORT" >>"$WEB_LOG" 2>&1 &
    echo $! >"$WEB_PID"
  )

  if wait_for_http "http://localhost:$WEB_PORT/" "200" 120 "фронт"; then
    ok "поднят — http://localhost:$WEB_PORT"
    return 0
  fi

  fail "фронт не ответил за 120 с"
  hint "лог: $WEB_LOG"
  tail -25 "$WEB_LOG" | sed 's/^/  /'
  return 1
}

summary() {
  local db_ok="нет" api_ok="нет" web_ok="нет"
  port_busy "$DB_PORT" && db_ok="да"
  [ "$(http_code "http://127.0.0.1:$API_PORT/health")" = "200" ] && api_ok="да"
  [ "$(http_code "http://localhost:$WEB_PORT/")" = "200" ] && web_ok="да"

  echo
  printf '%s─────────────────────────────────────────────%s\n' "$DIM" "$OFF"
  printf '  Postgres  %s:%s   %s\n' "$DB_PORT" "$DB_NAME" "$db_ok"
  printf '  API       %s%s\n' "http://127.0.0.1:$API_PORT" "$( [ "$api_ok" = "да" ] && echo "" || echo "   не работает" )"
  printf '  Фронт     %s%s\n' "http://localhost:$WEB_PORT" "$( [ "$web_ok" = "да" ] && echo "" || echo "   не работает" )"
  printf '%s─────────────────────────────────────────────%s\n' "$DIM" "$OFF"

  if [ "$web_ok" = "да" ]; then
    echo
    printf '  %sОткрыть: http://localhost:%s%s\n' "$B" "$WEB_PORT" "$OFF"
  fi
}

show_status() {
  step "Что сейчас запущено"
  echo
  if port_busy "$DB_PORT"; then
    ok "Postgres слушает $DB_PORT"
    docker ps --filter "publish=$DB_PORT" --format '   {{.Names}} — {{.Status}}' 2>/dev/null
  else
    warn "Postgres не слушает $DB_PORT"
  fi

  local code
  code="$(http_code "http://127.0.0.1:$API_PORT/health")"
  if [ "$code" = "200" ]; then
    ok "API отвечает — $(curl -s --max-time 5 "http://127.0.0.1:$API_PORT/health")"
  else
    warn "API не отвечает (код: ${code:-нет соединения})"
  fi

  code="$(http_code "http://localhost:$WEB_PORT/")"
  if [ "$code" = "200" ]; then
    ok "Фронт отвечает — http://localhost:$WEB_PORT"
  else
    warn "Фронт не отвечает (код: ${code:-нет соединения})"
  fi

  echo
  hint "логи: $API_LOG"
  hint "      $WEB_LOG"
}

do_stop() {
  local with_db=0
  [ "${1:-}" = "--db" ] && with_db=1

  kill_from_pidfile "$WEB_PID" "Фронт" "$WEB_PORT"
  kill_from_pidfile "$API_PID" "API" "$API_PORT"

  # Сервисы могли быть подняты руками, без PID-файла — добиваем по порту.
  [ "$(http_code "http://localhost:$WEB_PORT/")" = "200" ] || port_busy "$WEB_PORT" \
    && kill_port_listener "$WEB_PORT" "Фронт"
  [ "$(http_code "http://127.0.0.1:$API_PORT/health")" = "200" ] || port_busy "$API_PORT" \
    && kill_port_listener "$API_PORT" "API"

  if [ "$with_db" = "1" ]; then
    step "Останавливаю Postgres"
    docker compose down >/dev/null 2>&1 && ok "контейнер остановлен (данные сохранены)"
    hint "полное удаление данных: docker compose down -v"
  else
    hint "Postgres оставлен запущенным. Остановить: ./start-local.sh stop --db"
  fi
}

open_browser() {
  local url="http://localhost:$WEB_PORT"
  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start "" "$url" >/dev/null 2>&1
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1
  fi
}

# ─────────────────────────────── main ───────────────────────────────────

COMMAND="${1:-start}"
OPEN_BROWSER=1
[ "${2:-}" = "--no-open" ] || [ "${1:-}" = "--no-open" ] && OPEN_BROWSER=0

case "$COMMAND" in
  stop)
    do_stop "${2:-}"
    exit 0
    ;;
  status)
    show_status
    exit 0
    ;;
  start|--no-open|"")
    ;;
  *)
    echo "Неизвестная команда: $COMMAND"
    echo "Использование: ./start-local.sh [start|status|stop [--db]] [--no-open]"
    exit 2
    ;;
esac

printf '%sLexicon — локальный запуск%s\n\n' "$B" "$OFF"

if ! check_tools; then
  echo
  fail "не хватает инструментов — см. сообщения выше"
  exit 1
fi

start_db || exit 1
apply_migrations || exit 1
start_api || exit 1
start_web || exit 1

summary

if [ "$OPEN_BROWSER" = "1" ]; then
  open_browser
fi

echo
hint "Остановить: ./start-local.sh stop"
hint "Состояние: ./start-local.sh status"
