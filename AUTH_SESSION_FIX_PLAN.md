# План-промт: устранение потери сессии NextAuth при повторном заходе

## Контекст
- Сайт: Next.js 14 + next-auth 4.24.15 (Credentials JWT strategy).
- Деплой: самостоятельный VPS, домен `5.129.192.216.sslip.io`, HTTPS через reverse-proxy (nginx/Caddy).
- Симптом: пользователь входит в систему → сессия работает → при повторном открытии ссылки (новая вкладка / перезагрузка / повторный клик) — сессия потеряна, показан лендинг с кнопкой «Войти».
- Код сессии: `frontend/src/app/api/auth/[...nextauth]/route.ts`.
- Middleware проверяет только наличие куки (не валидность). AppLayout клиентский гейт вызывает `/api/auth/session` и редиректит на `/login`, если `data.user` отсутствует.

## Диагностика перед правкой (сделай первым делом)

1. **Chrome DevTools → Application → Cookies → `5.129.192.216.sslip.io`**
   - После входа найди куку `next-auth.session-token` или `__Secure-next-auth.session-token`.
   - Запиши её значение, флаги `Secure`, `SameSite`, `Expires/Max-Age`, `Domain` (должно быть `5.129.192.216.sslip.io` или пусто / Not Set).
   - Закрой вкладку, открой сайт снова. Проверь: кука **исчезла** (браузер её не отправил/не сохранил) или **изменилась** (сервер переписал — значит старую не смог декодировать).

2. **DevTools → Network → `/api/auth/session`**
   - Во вкладке, где ты уже залогинен, перезагрузи страницу. Смотри запрос `/api/auth/session`:
     - В `Request Headers` есть ли `Cookie: next-auth.session-token=...`?
     - В `Response` — пустой объект `{}` или есть `user`? Если запрос уходит с кукой, а ответ пустой — проблема в декодировании JWT (секрет/сигнатура).

3. **Проверка env на сервере** (выполни на VPS, где крутится `next start`):
   ```bash
   echo "NEXTAUTH_URL=$NEXTAUTH_URL"
   echo "NEXTAUTH_SECRET=${NEXTAUTH_SECRET:0:5}..."
   ```
   - Если `NEXTAUTH_SECRET` пуст — это **главная причина**.
   - Если `NEXTAUTH_URL` не равен `https://5.129.192.216.sslip.io` — это **дополнительная причина** (cookie-prefix / trustHost).

## Корневые причины (приоритеты)

### 1. Отсутствие стабильного `NEXTAUTH_SECRET` (КРИТИЧНО)
- next-auth v4 без `NEXTAUTH_SECRET` генерирует случайный ключ **на каждый процесс**.
- JWT, подписанный одним процессом, другим не расшифруется.
- Симптом: после входа работает, но после перезагрузки / новой вкладки (если процесс перезапустился или несколько воркеров) — сессия «испаряется».
- **Фикс**: задать `NEXTAUTH_SECRET` как стабильную env-переменную.

### 2. Не задан / неверный `NEXTAUTH_URL` (ВЫСОКИЙ)
- `NEXTAUTH_URL` определяет `useSecureCookies` (строка 9 `route.ts`):
  - `https://...` → cookie `__Secure-next-auth.session-token`, флаг `Secure=true`.
  - `http://...` или пусто → cookie `next-auth.session-token`, `Secure=false`.
- Без `NEXTAUTH_URL` NextAuth также может не доверять proxy-хосту.
- **Фикс**: установить `NEXTAUTH_URL=https://5.129.192.216.sslip.io`.

### 3. Reverse-proxy не прокидывает заголовки (СРЕДНИЙ)
- next-auth читает хост из `Host`, протокол из `X-Forwarded-Proto` (если есть trust).
- Если nginx/Caddy не прокидывает `Host` и `X-Forwarded-Proto`, internal URL может отличаться от public.
- **Фикс**: добавить `proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme;` в nginx.

### 4. Отсутствие `trustHost` в конфиге NextAuth (СРЕДНИЙ)
- За reverse-proxy NextAuth может считать запросы недоверенными.
- **Фикс**: добавить `trustHost: true` в `NextAuth({ ... })`.

### 5. Некорректный `sameSite` для кросс-сайта (НИЗКИЙ — скорее всего не причина)
- `sameSite: 'lax'` корректен для top-level навигации по тому же сайту.
- Менять на `'none'` не требуется (и опасно без явной необходимости).

## Что нужно изменить

### A. Код: `frontend/src/app/api/auth/[...nextauth]/route.ts`

Добавить `trustHost: true` в конфиг:

```typescript
const handler = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true, // <-- добавить
  session: { ... },
  ...
});
```

Это защищает от проблем с reverse-proxy и разными Host-заголовками.

### B. Окружение сервера (файл systemd / docker / .env / pm2 ecosystem)

Установить **обязательно**:
```bash
NEXTAUTH_URL="https://5.129.192.216.sslip.io"
NEXTAUTH_SECRET="<сгенерируй openssl rand -base64 32>"
```

Как сгенерировать:
```bash
openssl rand -base64 32
```

Вставь результат в env-файл или переменные окружения сервиса (systemd, pm2, docker-compose и т.д.).

### C. Reverse-proxy (nginx)

Если перед `next start` стоит nginx, убедись, что блок `location` выглядит так:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Если Caddy:
```caddy
reverse_proxy localhost:3000 {
    header_up Host {host}
    header_up X-Real-IP {remote}
    header_up X-Forwarded-For {remote}
    header_up X-Forwarded-Proto {scheme}
}
```

### D. Опционально: редирект залогиненных с `/` на `/dashboard`

В `frontend/src/app/page.tsx` нет редиректа для авторизованных пользователей — поэтому после «потери» сессии они видят лендинг. Если сессия на самом деле жива, а человек просто попал на `/`, UX можно улучшить:

```tsx
// В page.tsx добавить (Server Component):
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
// ... в начале компонента:
const session = await getServerSession();
if (session) redirect("/dashboard");
```

> Примечание: `getServerSession` требует импорта конфига NextAuth. Это отдельное улучшение, а не фикс бага.

## Проверка после изменений

1. Перезапусти frontend-сервер (чтобы env подтянулись).
2. Очисти все куки для `5.129.192.216.sslip.io` в браузере.
3. Войди в систему.
4. Открой DevTools → Cookies → убедись, что кука называется `__Secure-next-auth.session-token` (благодаря `NEXTAUTH_URL=https://`) и имеет `Secure=true`, `SameSite=Lax`, `Path=/`.
5. Закрой вкладку, открой `https://5.129.192.216.sslip.io/dashboard` — не должно редиректить на `/login`.
6. Подожди 5 минут, открой сайт снова — сессия должна сохраниться.
7. Перезагрузи frontend-процесс (pm2 restart / systemctl restart) и открой сайт без повторного входа — сессия **должна** сохраниться. Если после рестарта сессия слетает — `NEXTAUTH_SECRET` всё ещё нестабилен.

## Критерий успеха
- После входа повторный заход на сайт (в новой вкладке, после перезагрузки процесса, после закрытия браузера) сохраняет авторизацию.
- Кука `__Secure-next-auth.session-token` присутствует в DevTools и не меняется при перезагрузках.
