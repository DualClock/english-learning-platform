#!/usr/bin/env bash
# Поднимает весь локальный стенд CMS: Postgres → API → фронт.
#
# Зачем скрипт, а не три команды в трёх терминалах: у этой связки есть три
# неочевидных условия, каждое из которых ломает стенд молча.
#   1. Docker Desktop не стартует сам — контейнера нет, API падает без БД.
#   2. Admin__BootstrapEmail обязателен: без него роль Admin никому не выдана,
#      и /admin отдаёт 404 даже владельцу.
#   3. Старая копия API держит bin/Debug/.../EnglishLearningPlatform.API.exe,
#      и сборка падает с MSB3027 вместо понятной ошибки.
#
# Запуск:  bash scripts/dev-cms.sh
# Остановка: Ctrl+C (фронт и API живут в этом же процессе).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_URL="http://127.0.0.1:5226"
FRONT_URL="http://localhost:3000"
ADMIN_EMAIL="${Admin__BootstrapEmail:-nik@mail.com}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m    %s\033[0m\n' "$1"; }

# ─────────────────────────────────────────────────────────── 1. Postgres
say "Postgres (Docker)"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q english_platform_db; then
  echo "    контейнер english_platform_db работает"
else
  warn "контейнера нет — поднимаю docker compose"
  if ! docker info >/dev/null 2>&1; then
    echo "    Docker не запущен. Открой Docker Desktop и повтори." >&2
    exit 1
  fi
  (cd "$ROOT" && docker compose up -d)
  echo "    ждём готовности Postgres..."
  for _ in $(seq 1 30); do
    if docker exec english_platform_db pg_isready -U appuser -d english_learning >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

# ─────────────────────────────────────────────── 2. освободить порты
say "Освобождаю порты 5226 и 3000"
# Убиваем только того, кто реально держит порт, а не все процессы по имени:
# `Stop-Process -Name` задевает и тот API/Next, который этот же скрипт
# поднял секундой позже.
#
# Порт 3000 важен отдельно: если там сидит старый Next, новый молча уезжает
# на 3001, а проверка ниже смотрит на 3000 — стенд «поднят», но показывает
# чужой билд.
powershell -NoProfile -Command \
  "foreach (\$port in 5226,3000) { Get-NetTCPConnection -LocalPort \$port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue } }" \
  2>/dev/null || true
sleep 2

# ─────────────────────────────────────────────────── 3. миграции
say "Миграции"
cd "$ROOT"
ASPNETCORE_ENVIRONMENT=Development dotnet ef database update \
  --project EnglishLearningPlatform.API \
  --startup-project EnglishLearningPlatform.API \
  --no-build 2>&1 | tail -3 || {
    warn "миграции не применились без сборки — собираю и повторяю"
    ASPNETCORE_ENVIRONMENT=Development dotnet ef database update \
      --project EnglishLearningPlatform.API --startup-project EnglishLearningPlatform.API 2>&1 | tail -3
  }

# ─────────────────────────────────────────────────── 4. API
say "Запускаю API на $API_URL"
ASPNETCORE_ENVIRONMENT=Development \
ASPNETCORE_URLS="$API_URL" \
Admin__BootstrapEmail="$ADMIN_EMAIL" \
  dotnet run --project EnglishLearningPlatform.API > "$ROOT/.local-run/api.log" 2>&1 &
API_PID=$!

cleanup() {
  echo
  say "Останавливаю стенд"
  kill "$API_PID" 2>/dev/null || true
  [ -n "${FRONT_PID:-}" ] && kill "$FRONT_PID" 2>/dev/null || true
}
# trap только на сигналы, БЕЗ EXIT.
#
# С EXIT git-bash гасит и группу процессов, и `wait` ниже возвращается
# сразу — скрипт «успешно» завершается, убивая только что поднятый API.
# Именно из-за этого стенд отвечал 000 при живом логе «Now listening».
trap cleanup INT TERM

# curl -f в этом окружении возвращает 23 (write error при -o /dev/null),
# поэтому сравниваем код ответа, а не полагаемся на exit code.
echo "    ждём /health (сборка + миграции — до 3 минут)..."
API_OK=0
for _ in $(seq 1 180); do
  if [ "$(curl -s -m 3 -w '%{http_code}' -o /dev/null "$API_URL/health" 2>/dev/null)" = "200" ]; then API_OK=1; break; fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "    API упал. Хвост лога:" >&2
    tail -25 "$ROOT/.local-run/api.log" >&2
    exit 1
  fi
  sleep 1
done

if [ "$API_OK" -ne 1 ]; then
  echo "    API не поднялся за 180 секунд. Лог: $ROOT/.local-run/api.log" >&2
  tail -20 "$ROOT/.local-run/api.log" >&2
  exit 1
fi

echo "    API отвечает 200"

# grep возвращает 1, когда строк нет, а set -e на этом убил бы скрипт —
# поэтому `|| true` и никакого pipefail вокруг.
grep -E "Роли:" "$ROOT/.local-run/api.log" 2>/dev/null | tail -1 | sed 's/^/    /' || true

# ─────────────────────────────────────────────────── 5. фронт
say "Запускаю фронт на $FRONT_URL"
cd "$ROOT/frontend"
npm run dev > "$ROOT/.local-run/front.log" 2>&1 &
FRONT_PID=$!

echo "    ждём Next (первый старт компилирует — до 2 минут)..."
FRONT_OK=0
for _ in $(seq 1 120); do
  if [ "$(curl -s -m 3 -w '%{http_code}' -o /dev/null "$FRONT_URL" 2>/dev/null)" = "200" ]; then FRONT_OK=1; break; fi
  if ! kill -0 "$FRONT_PID" 2>/dev/null; then
    echo "    фронт упал. Хвост лога:" >&2
    tail -25 "$ROOT/.local-run/front.log" >&2
    exit 1
  fi
  sleep 1
done

if [ "$FRONT_OK" -ne 1 ]; then
  echo "    фронт не поднялся за 120 секунд. Лог: $ROOT/.local-run/front.log" >&2
  tail -20 "$ROOT/.local-run/front.log" >&2
  exit 1
fi

cat <<EOF

────────────────────────────────────────────────────────────────
  Стенд поднят

  Админка:  $FRONT_URL/admin/content/categories
  Вход:     $FRONT_URL/login  →  $ADMIN_EMAIL  (роль Admin)
  Сайт:     $FRONT_URL/categories  (то, что видит пользователь)

  Логи:     .local-run/api.log   и   .local-run/front.log
  Стоп:     Ctrl+C
────────────────────────────────────────────────────────────────
EOF

wait
