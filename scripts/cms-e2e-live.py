"""
Сквозная проверка CMS на живом API: правка админа доходит до пользователя.

Запуск (API должен быть на 127.0.0.1:5226):
    python3 scripts/cms-e2e-live.py

Проверяет именно переход «админ → пользователь», а не код возврата:
каждое утверждение — это ответ того запроса, которым ходит обычный человек.
"""
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:5226"
ADMIN = {"email": "admin@lexicon.local", "password": "7PQVucBrU7tn"}
USER = {"email": "proverka-user@test.local", "password": "THTVNKHA6YUe"}

passed, failed = [], []


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


def check(name, condition, detail=""):
    if condition:
        passed.append(name)
        print(f"  PASS  {name}")
    else:
        failed.append(f"{name} — {detail}")
        print(f"  FAIL  {name} — {detail}")


def login(creds):
    status, data = call("POST", "/api/auth/login", creds)
    if status != 200:
        print(f"Логин {creds['email']} не удался: {status} {data}")
        sys.exit(1)
    return data["token"]


print("=" * 68)
print("CMS сквозная проверка: админ правит → пользователь видит")
print("=" * 68)

admin = login(ADMIN)
user = login(USER)

# ───────────────────────────────────────────── 1. создание категории админом
print("\n[1] Админ создаёт категорию")
slug = "e2e-live-check"
status, created = call("POST", "/api/admin/content/categories",
                       {"name": "Проверка видимости", "slug": slug,
                        "description": "Создано админом в сквозном тесте"}, admin)
check("админ создал категорию (200)", status == 200, f"получили {status}: {created}")
cat_id = created.get("id") if isinstance(created, dict) else None
check("категория получила id", cat_id is not None, str(created))

# ─────────────────────────────────────────── 2. пользователь её видит
print("\n[2] Пользователь открывает каталог категорий")
status, cats = call("GET", "/api/categories", token=user)
check("GET /api/categories отвечает 200", status == 200, str(status))
user_cat = next((c for c in cats if c.get("slug") == slug), None) if isinstance(cats, list) else None
check("новая категория видна пользователю", user_cat is not None,
      f"среди {len(cats) if isinstance(cats, list) else '?'} категорий нет {slug}")

# ─────────────────────────────────────────── 3. админ добавляет слово
print("\n[3] Админ добавляет слово в категорию")
status, word = call("POST", f"/api/admin/content/categories/{cat_id}/words",
                    {"english": "serendipity", "translation": "счастливая случайность",
                     "transcription": "ˌserənˈdɪpəti",
                     "example": "Finding that book was pure serendipity."}, admin)
check("слово создано (200)", status == 200, f"{status}: {word}")
word_id = word.get("id") if isinstance(word, dict) else None

# ─────────────────────────────────────────── 4. пользователь видит слово
print("\n[4] Пользователь открывает категорию и видит слово")
status, detail = call("GET", f"/api/categories/{slug}/words", token=user)
check("страница категории отвечает 200", status == 200, str(status))
words = detail.get("words", []) if isinstance(detail, dict) else []
found = next((w for w in words if w.get("english") == "serendipity"), None)
check("слово видно пользователю", found is not None,
      f"в категории {len(words)} слов, serendipity нет")
if found:
    check("перевод сохранился", found.get("translation") == "счастливая случайность",
          found.get("translation"))
    check("транскрипция сохранилась", found.get("transcription") == "ˌserənˈdɪpəti",
          found.get("transcription"))

# ─────────────────────────────────────────── 5. пользователь учит слово
print("\n[5] Пользователь отмечает слово как выученное")
status, prog = call("POST", f"/api/categories/words/{word_id}/progress",
                    {"status": "learned"}, user)
check("прогресс записан (200)", status == 200, f"{status}: {prog}")

# ─────────────────────────────────────────── 6. админ удаляет слово
print("\n[6] Админ удаляет слово")
status, deleted = call("DELETE", f"/api/admin/content/words/{word_id}", token=admin)
check("слово удалено (200)", status == 200, f"{status}: {deleted}")

# ─────────────────────────────────────────── 7. слово исчезло у пользователя
print("\n[7] Слово исчезло из выдачи у пользователя")
status, detail2 = call("GET", f"/api/categories/{slug}/words", token=user)
words2 = detail2.get("words", []) if isinstance(detail2, dict) else []
check("удалённого слова больше нет",
      not any(w.get("english") == "serendipity" for w in words2),
      f"в категории {len(words2)} слов")

# ─────────────────────────────────────────── 8. прогресс не потерян
print("\n[8] Прогресс пользователя сохранился после удаления")
# Через админский список с includeDeleted видно, что строка жива
status, all_cats = call("GET", "/api/admin/content/categories?includeDeleted=true", token=admin)
all_words = []
for c in all_cats if isinstance(all_cats, list) else []:
    for w in c.get("words", []):
        if w.get("id") == word_id:
            all_words.append(w)
check("слово физически осталось в базе", len(all_words) == 1, str(all_words))
check("у него выставлен DeletedAt", bool(all_words and all_words[0].get("deletedAt")),
      str(all_words))

# ─────────────────────────────────────────── 9. восстановление
print("\n[9] Админ восстанавливает слово — оно снова у пользователя")
status, restored = call("POST", f"/api/admin/content/words/{word_id}/restore", token=admin)
check("восстановление (200)", status == 200, f"{status}: {restored}")
status, detail3 = call("GET", f"/api/categories/{slug}/words", token=user)
words3 = detail3.get("words", []) if isinstance(detail3, dict) else []
back = next((w for w in words3 if w.get("english") == "serendipity"), None)
check("слово вернулось к пользователю", back is not None, f"{len(words3)} слов")
if back:
    check("статус прогресса сохранился у слова", back.get("status") == "learned",
          str(back.get("status")))

# ─────────────────────────────────────────── 10. обычный юзер не админ
print("\n[10] Обычный пользователь не может править контент")
status, _ = call("POST", "/api/admin/content/categories",
                 {"name": "Взлом", "slug": "hack"}, user)
check("POST категории от юзера → 403", status == 403, f"получили {status}")
status, _ = call("DELETE", f"/api/admin/content/words/{word_id}", token=user)
check("DELETE слова от юзера → 403", status == 403, f"получили {status}")

# ─────────────────────────────────────────── 11. уборка
print("\n[11] Уборка тестовой категории")
status, _ = call("DELETE", f"/api/admin/content/categories/{cat_id}", token=admin)
check("категория удалена (200)", status == 200, str(status))
status, cats_after = call("GET", "/api/categories", token=user)
check("категории больше нет у пользователя",
      not any(c.get("slug") == slug for c in cats_after if isinstance(cats_after, list)),
      "категория всё ещё в списке")

print("\n" + "=" * 68)
print(f"ИТОГ: {len(passed)} passed, {len(failed)} failed")
if failed:
    print("\nПровалы:")
    for f in failed:
        print("  -", f)
print("=" * 68)
sys.exit(1 if failed else 0)
