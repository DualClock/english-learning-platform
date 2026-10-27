# Ротация секретов Lexicon — процедура владельца

Проверено 26.10.2026 по коду. Все пути и строки указаны, чтобы процедуру можно было
выполнить не вспоминая.

## 0. Что именно считаем скомпрометированным

| Секрет | Где лежал | Почему считаем утёкшим |
|---|---|---|
| `Jwt__Key` | `appsettings.Development.json` в рабочем дереве, `DEPLOY.md` учил копировать руками | Ключ в файле на диске + инструкция «скопируй» = ключ проходил через буфер обмена и переписку |
| `NEXTAUTH_SECRET` | systemd-юнит, значение из туториала next-auth | Документированный плейсхолдер: подпись куки сессии воспроизводима любым, кто читал те же туториалы |
| `Gemini__ApiKey` | тот же `appsettings.Development.json` | Платный ключ на диске без менеджера секретов |
| `Gemini__ProxyUrl` (креды SOCKS5) | тот же файл + юнит `proxy.conf` | Пароль прокси в открытом тексте |
| `Seeder__Key` | юнит `lexicon-api.service`, добывался `grep -oP` в LAUNCH_DAY_RUNBOOK | Инструкция «достань ключ из юнита» означает, что он там есть |
| `Feedback__AdminKey` | юнит `feedback.conf` | то же |

Права `0600` на файлах ничего не меняют: любой, кто получил shell, читает их
одним `cat`, а `DEPLOY.md` раньше прямо предлагал это делать.

## 1. Сгенерировать значения

```bash
bash scripts/generate-secrets.sh
```

Скрипт печатает `KEY=value` и **ничего не пишет на диск**. Значения:

- `NEXTAUTH_SECRET`, `Jwt__Key`, `Analytics__GuestIpSalt` — 64 символа base64 (48 байт энтропии);
- `Seeder__Key`, `Feedback__AdminKey` — 44 символа;
- два прогона дают разные значения, все значения внутри прогона различны;
- в выводе нет запрещённых символов для systemd `EnvironmentFile` (без пробелов, кавычек, `$`).

Проверить сам скрипт: `bash scripts/selftest.sh` → 24 PASS, 0 FAIL.

## 2. Куда положить

`EnvironmentFile` в отдельном каталоге, НЕ в юните:

```bash
sudo install -d -m 0700 -o lexicon -g lexicon /etc/lexicon
sudo install -m 0600 -o lexicon -g lexicon /dev/null /etc/lexicon/api.env
sudo install -m 0600 -o lexicon -g lexicon /dev/null /etc/lexicon/frontend.env
```

`/etc/lexicon/api.env`:

```
Jwt__Key=<из generate-secrets.sh>
Jwt__Issuer=EnglishLearningPlatform
Jwt__Audience=EnglishLearningPlatform.Users
Gemini__ApiKey=<новый ключ из Google AI Studio, старый удалить>
Gemini__ProxyUrl=<новые креды прокси>
Seeder__Key=<из скрипта>
Feedback__AdminKey=<из скрипта>
ConnectionStrings__DefaultConnection=<строка подключения>
Analytics__GuestIpSalt=<из скрипта>
```

`/etc/lexicon/frontend.env`:

```
NEXTAUTH_SECRET=<из скрипта>
NEXTAUTH_URL=https://<боевой домен>
NEXT_PUBLIC_API_URL=http://127.0.0.1:5226
NEXT_PUBLIC_SITE_URL=https://<боевой домен>
```

Юнит меняется ровно в одном месте:

```ini
[Service]
EnvironmentFile=/etc/lexicon/api.env
```

Строки `Environment=` с реальными значениями из юнита **удаляются**, а не
закомментируются: комментарий с секретом — тот же секрет.

Проверить, что в юнитах не осталось значений:

```bash
grep -nE '=(eyJ|[A-Za-z0-9+/]{40,})' /etc/systemd/system/lexicon-*.{service,conf} || echo "чисто"
```

## 3. Порядок перезапуска (минимум downtime)

Сначала API, потом фронт: фронт на старте обращается к `/health`, и если API
перезапустится вторым, пользователь увидит «сервис недоступен».

```bash
sudo systemctl daemon-reload
sudo systemctl restart lexicon-api && sudo systemctl is-active lexicon-api
curl -fsS http://127.0.0.1:5226/health || echo "API не поднялся — не трогай фронт"
sudo systemctl restart lexicon-frontend
```

## 4. Что выстрелит и что с этим делать

**Все уже выданные JWT продолжают жить до 7 суток** (`appsettings.json`, `Jwt:ExpiryMinutes = 10080`).
Смена `Jwt__Key` их не отзывает — в токене нет `SecurityStamp`, а `OnTokenValidated`
не переопределён. Это осознанно принятый риск (ревокация — отдельная задача),
но владелец должен знать: **старый ключ продолжает действовать на уже выпущенные
токены до истечения их срока**, пока в коде не появится проверка версии токена.

Что снижает ущерб немедленно:

1. Новая `NEXTAUTH_SECRET` разлогинит всех на фронте — сессионная кука
   расшифровывается ею. Это ожидаемо и правильно: 23 аккаунта после ротации
   войдут заново.
2. Старый `Gemini__ApiKey` удаляется в консоли Google — платный ключ перестаёт
   работать сразу, независимо от того, жив ли он где-то ещё.

**Проверка, что ротация сработала:**

```bash
# старая кука не должна приниматься
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Cookie: next-auth.session-token=<старое значение>' \
  https://<домен>/api/auth/session
# ожидается пустой объект сессии, а не данные пользователя
```

**Отдельно, до прихода когорты:** репозиторий публичный, а `appsettings.Development.json`
защищён одной строкой `.gitignore`. Проверить историю:

```bash
git log --all --oneline -- appsettings.Development.json
```

Если файл когда-либо был в истории — `git filter-repo` обязателен, ротация ключей без
чистки истории не помогает: старые значения читаются из архива форка.

## 5. Чего НЕ делает эта процедура

- Не отзывает уже выданные JWT (см. выше).
- Не добавляет менеджер секретов (Vault/SOPS/systemd-creds) — это следующий шаг,
  и он не блокирует первую когорту.
- Не чистит историю git — это отдельная операция, требующая паузы на пуши.
