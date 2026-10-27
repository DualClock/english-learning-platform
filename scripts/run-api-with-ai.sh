#!/usr/bin/env bash
# Запуск API с OpenAI-совместимым провайдером, ключ которого лежит в окружении.
#
# Ключ НЕ передаётся аргументом командной строки: аргументы видны в списке
# процессов любому пользователю машины. Переменные окружения наследуются
# процессом и в ps не попадают.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERMES_ENV="$HOME/AppData/Local/hermes/.env"

# Берём ключ и BaseUrl из окружения Hermes, если своё не задано.
if [ -f "$HERMES_ENV" ]; then
  # shellcheck disable=SC1090
  AI_CHAT_API_KEY="${AI_CHAT_API_KEY:-$(grep -m1 '^DEEPSEEK_API_KEY=' "$HERMES_ENV" | cut -d= -f2- | tr -d '"'"'"'\r')}"
  AI_CHAT_BASE_URL="${AI_CHAT_BASE_URL:-$(grep -m1 '^DEEPSEEK_BASE_URL=' "$HERMES_ENV" | cut -d= -f2- | tr -d '"'"'"'\r')}"
fi

if [ -z "${AI_CHAT_API_KEY:-}" ]; then
  echo "Нет ключа: задайте AI_CHAT_API_KEY или DEEPSEEK_API_KEY в $HERMES_ENV" >&2
  exit 1
fi

export AiChat__Provider="${AiChat__Provider:-openai}"
export AiChat__BaseUrl="${AI_CHAT_BASE_URL:-https://api.deepseek.com/v1}"
export AiChat__ApiKey="$AI_CHAT_API_KEY"
export AiChat__Model="${AI_CHAT_MODEL:-deepseek-ai/DeepSeek-V4.1-Flash-1017}"
export AiChat__TimeoutSeconds="${AI_CHAT_TIMEOUT:-90}"

# Development обязателен: Jwt:Key и строка подключения живут в
# appsettings.Development.json. Без него Program.cs падает на старте
# («Jwt:Key не настроен») — ровно так и было при первом запуске этого скрипта.
export ASPNETCORE_ENVIRONMENT=Development
export ASPNETCORE_URLS="http://127.0.0.1:5226"

echo "AI-провайдер: $AiChat__BaseUrl ($AiChat__Model)"

cd "$ROOT/EnglishLearningPlatform.API"
exec dotnet run --no-launch-profile
