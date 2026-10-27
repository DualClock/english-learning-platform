# Outbox — сводка текстов бета-аутрича Lexicon

Все тексты — **не отправлены** и **ждут GO**. Боевого URL пока нет, поэтому домен везде ведётся как `[ДОМЕН]` (никогда не выдумывать). Ничего не публикуется и не рассылается до подписи GO владельцем. Каждый канал получает свой код `/t/<код>` (редирект `/t/<код>` → `/?ref=<код>`, атрибуция 30 дней — механизм в проде).

Правило по тексту: 4 условия беты есть в каждом письме/посте своими словами канала — **бета до 2 ноября · бесплатно · без карты · два коротких ответа за 14 дней: первый — одна кнопка прямо в читалке под прочитанной страницей (не анкета), второй — короткое сообщение в конце когорты, 15 ноября**. Цена изменена 24.10.2026 по решению менеджера (было «один отзыв»): первый ответ теперь собирается сам в продукте — блок Feedback Pulse (`frontend/src/lib/pulse.ts`, `components/feedback/BetaPulse.tsx`, коммиты `2a87fae` и `99f556f`), появляется у читателя после первой открытой главы, не чаще раза в 7 суток и никогда повторно после ответа или крестика. Формулировок «один отзыв» ни в одном тексте быть не должно. Из материалов к учительским письмам крепится **только** `materials/worksheet-alice-chapter1` (PDF/HTML); памятка учителя и внутренние FAQ/черновики не прикладываются и не упоминаются — формулировки про тест и правила берутся из самих страниц `[ДОМЕН]/test`, `[ДОМЕН]/terms`, `[ДОМЕН]/privacy`, и ссылки на них даны в тексте. С 24.10 в текстах появились ссылки на публичную витрину — полка `[ДОМЕН]/library` и страницы книг вида `[ДОМЕН]/library/alices-adventures-in-wonderland` (открываются анонимно, превью обрезано 150 словами): в учительских письмах primary-крючок остаётся рабочий лист и тест уровня, витрина даёт конкретику «на что смотреть»; в читательских — книга сама является крючком. Реестр кодов от этих ссылок не меняется: код канала по-прежнему один на файл.

## Календарь отправков

Дни в именах файлов (`d1…d5`) — не конкретные даты, а порядок относительно дня X, когда
подписан GO (см. `../MASTER_PLAN.md §6` и `../LAUNCH_DAY_RUNBOOK.md`): d1 = день X, d2 = X+1
и так далее. Набор закрывается 1 ноября, когорта стартует 2 ноября независимо от того, на
какое число пришёлся X: если GO подписан 27 октября, у тебя шесть дней посевов до старта;
если позже — сокращаешь цепочку, а не дату старта, потому что дата и есть обещание.

## Реестр: код → файл → кому → ссылка → статус

| Код | Файл | Кому | Ссылка канала | Статус |
|---|---|---|---|---|
| `/t/stasya` | `d1-stasya.md` | @StasyaKrapivka — BOOKSHELF for TEACHERS (36.8K) + ПЛЮШКИ для УЧИТЕЛЯ (13.3K), одно письмо на оба | https://t.me/englishteacherbookshelf · https://t.me/plyushkiforelt | ждёт GO |
| `/t/active-teach` | `d1-active-teach.md` | чат Active Teach «УЧИТЕЛЬСКАЯ» (10.3K) | https://t.me/Active_Teach_English | ждёт GO (сверить правила чата) |
| `/t/product-radar` | `d2-product-radar.md` | Product Radar (бесплатная подача, раздача на 15 площадок) | https://productradar.ru/start-benefits/ | ждёт GO + URL |
| `/t/dzen` | `d2-dzen.md` | свой канал в Дзене (длинный хвост) | https://dzen.ru | ждёт GO + URL (пометка «реклама») |
| `/t/metodbox` | `d2-metodbox.md` | vk.com/metodbox (ЛС админу) | https://vk.com/metodbox | ждёт GO (размер не проверен) |
| `/t/methodsay` | `d2-methodsay.md` | vk.com/methodsay (ЛС админу) | https://vk.com/methodsay | ждёт GO (размер не проверен) |
| `/t/teacherswitcher` | `d3-teacherswitcher.md` | vk.com/teacherswitcher (ЛС админу) | https://vk.com/teacherswitcher | ждёт GO |
| `/t/explorer` | `d3-explorer.md` | vk.com/explorer_teachers (ЛС админу) | https://vk.com/explorer_teachers | ждёт GO |
| `/t/making-easier` | `d3-making-easier.md` | vk.com/making_teachers_lives_easier (ЛС админу) | https://vk.com/making_teachers_lives_easier | ждёт GO |
| `/t/english-ppt` | `d3-english-ppt.md` | vk.com/english_ppt (ЛС админу) | https://vk.com/english_ppt | ждёт GO |
| `/t/giveandget` | `d4-giveandget.md` | vk.com/giveandget_english (ЛС админу) | https://vk.com/giveandget_english | ждёт GO |
| `/t/eflteachers` | `d4-eflteachers.md` | vk.com/eflteachers | https://vk.com/eflteachers | ждёт GO (размер не проверен) |
| `/t/ttt` | `d4-ttt.md` | Teachers Teach Teachers (профиль + заметка) | https://teachers-teach-teachers.com/community · https://vk.com/teachersteachteachers | ждёт GO (правила не проверены) |
| `/t/efl-forum` | `d4-efl-forum.md` | EFL-FORUM — только методический пост, все ссылки в профиле | https://efl-forum.ru | ждёт GO (рекламные ссылки в тексте запрещены) |
| `/t/englishteachers-ru` | `d5-englishteachers-ru.md` | englishteachers.ru/forum — раздел «интернет-ресурсы» | https://www.englishteachers.ru/forum/ | ждёт GO (читать шапку) |
| `/t/native-english` | `d5-native-english.md` | native-english.ru/forum | https://www.native-english.ru/forum | ждёт GO (читать шапку) |
| `/t/english-for-devs` | `d5-english-for-devs.md` | English for Developers (11.8K) — питч админу | https://t.me/englishfordeveloper | ждёт КОНТАКТА + GO |
| `/t/poisk-uchenikov` | `d5-poisk-uchenikov.md` | «Ищу репетитора» @shevchukvadim (6.9K) | https://t.me/poisk_uchenikov | ждёт GO |

## Правила обхода

1. **Одна рассылка в день.** В день — один заход (батч адресных писем), не размазанный по времени спам.
2. **Максимум два касания на канал.** Первое письмо + одно follow-up не раньше чем через 3–4 дня и только если ответа не было и канал реально даёт активных тестеров. Третьего касания нет.
3. **Никакого массового ЛС.** Каждое письмо адресное, с именем и под канал; нельзя одинаковый текст в ten лички.
4. **До GO — только подготовка.** Ни публикации, ни отправки: тексты готовы к копированию, но держим в outbox.
5. **После изменений беты** (появилась оплата/обязательное подтверждение почты и т. п.) перечитать все тексты — они описывают текущий срез.

## Календарь 28.10–01.11 (приоритет = кто даёт больше активных тестеров, а не охват)

| День | Дата | Файлы дня | Почему в этот день |
|---|---|---|---|
| d1 | Пн 28.10 | `d1-stasya`, `d1-active-teach` | Учительские мультипликаторы (1 учитель → группа): максимальное число активных тестеров с подтверждёнными контактами. |
| d2 | Вт 29.10 | `d2-product-radar`, `d2-dzen`, `d2-metodbox`, `d2-methodsay` | Разовые «подал и работает» площадки подаём рано (эффект Product Radar 3–7 дней и алгоритмический хвост Дзена должны успеть до конца беты) + первые два методических VK. |
| d3 | Ср 30.10 | `d3-teacherswitcher`, `d3-explorer`, `d3-making-easier`, `d3-english-ppt` | Остальные учительские VK-сообщества: тот же множитель групп. |
| d4 | Чт 31.10 | `d4-giveandget`, `d4-eflteachers`, `d4-ttt`, `d4-efl-forum` | Добираем VK-волну + профессиональные сети и форум: качественные тестеры, но медленнее; для efl-forum ссылку в профиле готовить заранее. |
| d5 | Пт 01.11 | `d5-englishteachers-ru`, `d5-native-english`, `d5-english-for-devs`, `d5-poisk-uchenikov` | Форумы-обзоры и одиночные читатель/ученические каналы: наименьший множитель активных тестеров; для english-for-devs сначала найти контакт админа. |
