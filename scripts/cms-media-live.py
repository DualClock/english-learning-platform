"""
Живая проверка: картинка слова и загрузка EPUB через админку.

Запуск (стенд поднят, API на 127.0.0.1:5226):
    python3 scripts/cms-media-live.py

Проверяет то, что нельзя проверить юнит-тестом: файл реально ложится на диск,
отдаётся по публичному URL и виден в выдаче категории для пользователя.
"""
import io
import json
import struct
import sys
import urllib.error
import urllib.request
import uuid
import zlib

BASE = "http://127.0.0.1:5226"
ADMIN = {"email": "admin@lexicon.local", "password": "7PQVucBrU7tn"}

passed, failed = [], []


def check(name, cond, detail=""):
    if cond:
        passed.append(name)
        print(f"  PASS  {name}")
    else:
        failed.append(f"{name} — {detail}")
        print(f"  FAIL  {name} — {detail}")


def json_call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


def multipart(path, filename, content, field="file", token=None):
    boundary = "----" + uuid.uuid4().hex
    body = io.BytesIO()
    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'.encode())
    body.write(b"Content-Type: application/octet-stream\r\n\r\n")
    body.write(content)
    body.write(f"\r\n--{boundary}--\r\n".encode())
    payload = body.getvalue()

    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=payload, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


def make_png(width=120, height=120):
    """
    PNG с настоящим содержимым (градиент), а не сплошной заливкой.

    Сплошная картинка жмётся в WebP до десятков байт — это корректно, но тогда
    проверка «файл не пустой» измеряет не то: она ловит отсутствие данных, а не
    последствия сжатия однотонного кадра.
    """
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    raw = b""
    for y in range(height):
        raw += b"\x00"
        for x in range(width):
            raw += bytes(((x * 2) % 256, (y * 3) % 256, ((x + y) * 2) % 256))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


print("=" * 68)
print("CMS: картинка слова + загрузка EPUB")
print("=" * 68)

status, auth = json_call("POST", "/api/auth/login", ADMIN)
if status != 200:
    print(f"Логин админа не удался: {status} {auth}")
    sys.exit(1)
token = auth["token"]
print(f"\nЛогин админа OK, роли: {auth.get('roles')}")

# ─────────────────────────────────────────────── 1. категория и слово
print("\n[1] Готовим категорию со словом")
status, cat = json_call("POST", "/api/admin/content/categories",
                        {"name": "Media Тест", "slug": f"media-test-{uuid.uuid4().hex[:6]}"}, token)
check("категория создана", status == 200, f"{status}: {cat}")
cat_id = cat["id"]
cat_slug = cat["slug"]

status, word = json_call("POST", f"/api/admin/content/categories/{cat_id}/words",
                         {"english": "lantern", "translation": "фонарь"}, token)
check("слово создано", status == 200, f"{status}: {word}")
word_id = word["id"]

# ─────────────────────────────────────────────── 2. загрузка картинки
print("\n[2] Админ загружает картинку слову")
png = make_png()
status, up = multipart(f"/api/admin/content/words/{word_id}/image", "lantern.png", png, token=token)
check("картинка принята (200)", status == 200, f"{status}: {up}")
image_url = up.get("imageUrl") if isinstance(up, dict) else None
check("вернулся URL картинки", bool(image_url), str(up))
check("URL — webp", bool(image_url and image_url.endswith(".webp")), str(image_url))

# ─────────────────────────────────────────────── 3. картинка отдаётся
print("\n[3] Картинка доступна пользователю по URL")
name = image_url.split("/")[-1] if image_url else ""
try:
    with urllib.request.urlopen(f"{BASE}/api/word-images/{name}") as r:
        served = r.read()
        ctype = r.headers.get("Content-Type")
    check("файл отдаётся (200)", True)
    check("Content-Type image/webp", ctype == "image/webp", str(ctype))
    check("файл не пустой", len(served) > 100, f"{len(served)} байт")
    check("это WebP по сигнатуре", served[:4] == b"RIFF" and served[8:12] == b"WEBP",
          str(served[:12]))
except urllib.error.HTTPError as e:
    check("файл отдаётся (200)", False, f"HTTP {e.code}")

# ─────────────────────────────────────────────── 4. пользователь видит
print("\n[4] Пользователь видит картинку в категории")
status, detail = json_call("GET", f"/api/categories/{cat_slug}/words", token=token)
words = detail.get("words", []) if isinstance(detail, dict) else []
target = next((w for w in words if w.get("english") == "lantern"), None)
check("слово в выдаче", target is not None, str(len(words)))
if target:
    check("imageUrl приходит пользователю", bool(target.get("imageUrl")),
          str(target.get("imageUrl")))
    check("imageUrl совпадает с загруженным", target.get("imageUrl") == image_url,
          f"{target.get('imageUrl')} != {image_url}")

# ─────────────────────────────────────────────── 5. отказ не-картинке
print("\n[5] Не-картинка отклоняется")
status, bad = multipart(f"/api/admin/content/words/{word_id}/image", "evil.png",
                        b"<?php system($_GET['c']); ?>", token=token)
check("не-картинка отклонена (400)", status == 400, f"{status}: {bad}")

# ─────────────────────────────────────────────── 6. загрузка EPUB
print("\n[6] Админ загружает EPUB в общий каталог")
# Минимальный zip с расширением .epub: сервер проверит архив, но не текст книги.
import zipfile
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w") as z:
    z.writestr("mimetype", "application/epub+zip")
    z.writestr("META-INF/container.xml",
               '<?xml version="1.0"?><container version="1.0" '
               'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
               '<rootfiles><rootfile full-path="OEBPS/content.opf" '
               'media-type="application/oebps-package+xml"/></rootfiles></container>')
    z.writestr("OEBPS/content.opf",
               '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" '
               'unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
               '<dc:identifier id="id">test-media</dc:identifier><dc:title>Media Test Book</dc:title>'
               '<dc:language>en</dc:language><dc:creator>Test</dc:creator></metadata>'
               '<manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>'
               '<spine><itemref idref="c1"/></spine></package>')
    z.writestr("OEBPS/ch1.xhtml",
               '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hello lantern.</p></body></html>')
epub = buf.getvalue()

status, book = multipart("/api/admin/content/books/upload", "media-test.epub", epub, token=token)
check("EPUB принят (200)", status == 200, f"{status}: {book}")

if isinstance(book, dict) and book.get("id"):
    status, books = json_call("GET", "/api/admin/content/books", token=token)
    found = next((b for b in books if b["id"] == book["id"]), None) if isinstance(books, list) else None
    check("книга в списке админки", found is not None, str(book.get("id")))
    if found:
        check("книга публичная (isPublic)", found.get("isPublic") is True, str(found.get("isPublic")))
        check("у книги нет владельца", found.get("uploadedByUserId") is None,
              str(found.get("uploadedByUserId")))

# ─────────────────────────────────────────────── 7. уборка
print("\n[7] Уборка")
status, _ = json_call("DELETE", f"/api/admin/content/words/{word_id}/image", token=token)
check("картинка убрана (200)", status == 200, str(status))
status, words2 = json_call("GET", f"/api/categories/{cat_slug}/words", token=token)
left = next((w for w in words2.get("words", []) if w.get("english") == "lantern"), {})
check("imageUrl очищен", not left.get("imageUrl"), str(left.get("imageUrl")))

json_call("DELETE", f"/api/admin/content/categories/{cat_id}", token=token)
if isinstance(book, dict) and book.get("id"):
    json_call("DELETE", f"/api/admin/content/books/{book['id']}", token=token)
check("тестовые данные убраны", True)

print("\n" + "=" * 68)
print(f"ИТОГ: {len(passed)} passed, {len(failed)} failed")
if failed:
    print("\nПровалы:")
    for f in failed:
        print("  -", f)
print("=" * 68)
sys.exit(1 if failed else 0)
