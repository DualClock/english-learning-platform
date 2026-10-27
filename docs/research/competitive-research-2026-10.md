# Lexicon — конкурентный анализ и боли пользователей

Дата: 26.10.2026. Метод: web_search + web_extract (первичные источники: IR Duolingo/SEC, сайты цен, Reddit через поисковые сниппеты, App Store, RB.RU/roem.ru, отзывы). Reddit и App Store блокируют прямое извлечение (403) — их утверждения даны по **сниппетам поисковика** и помечены. Где цифры нет — «не найдено» с указанием, где искали.

Сокращения по Lexicon: **[код]** = проверено в репозитории, файл указан.

---

## 0. Базовые цифры рынка (для контекста)

| Метрика | Значение | Источник |
|---|---|---|
| Онлайн-изучение языков, мир | $17.7 млрд (2026) → $50.6 млрд (2036), CAGR 11.1% | [Research and Markets / GlobeNewswire, 12.10.2026](https://www.globenewswire.com/news-release/2026/10/12/3379084/28124/en/online-language-learning-market-size-share-trends-and-global-forecast-2026-2036-ai-tutors-and-corporate-training-to-propel-market-to-50-6-billion-at-11-1-cagr.html) |
| Тренд | «Tutoring» — самый быстрорастущий сегмент, драйвер — AI-виртуальные тьюторы; self-learning apps — крупнейшая доля | там же |
| Русский рынок английского | $329.8 млн (оценка, текущий год) | [Cognitive Market Research](https://cognitivemarketresearch.com/english-language-learning-market-report) — цифра вендорская, низкая достоверность |
| EdTech РФ | $5.47 млрд (2025) | [IMARC](https://imarcgroup.com/russia-edtech-market) — вендорская оценка |
| Спрос именно на «читать книги с подсказками слов» | **не найдено** ни в одном публичном отчёте. Ни Research and Markets, ни IMARC, ни Smart Ranking не дают такой сегмент. Это придётся мерить самому (см. раздел 2c) | — |

Главный вывод раздела 0: рынок растёт, но **растёт за счёт speaking/AI-тьюторов**, а не за счёт чтения. Позиционирование Lexicon сейчас («без зубрёжки, по книгам») идёт против течения, зато в незанятой нише — но ниша не подтверждена цифрами.

---

## 1. КРИТИЧЕСКИЕ ОШИБКИ

### 1.1. Позиционирование «английский по книгам» уже занято, и занято дёшево

| Конкурент | Что делает | Цена | Источник |
|---|---|---|---|
| **LingQ** | Ровно то же: клик по слову → перевод → сохранение → SRS-повторы; импорт книг, EPUB, YouTube, Netflix | Free: **20 слов и 5 импортов** (демо). Premium $14.99/мес, $10/мес год, $8.99/мес при 24 мес; $119.99/12 мес. Premium Plus ~$22.50/мес | [LingQ Free vs Premium](https://www.lingq.com/blog/lingq-free-vs-premium/), [цены](https://www.lingq.com/en/signup) |
| **Readlang** | Клик по слову на любой веб-странице/EPUB, контекстный перевод, флешкарты из книги | **Free: неограниченные переводы слов** + 10 фразовых/день. Premium **$6/мес или $48/год** | [readlang.com/pricing](https://readlang.com/pricing) |
| **Beelinguapp** | Параллельный текст + озвучка, 12 языков | $1.99/мес, одноразово $24.99 | [PCMag](https://www.pcmag.com/reviews/beelinguapp) |
| **Kindle Word Wise** | Бесплатно, поверх настоящих книг: определения над сложными словами | включено в книгу | [Amazon](https://press.aboutamazon.com/uk/2014/11/new-features-for-kindle-e-readers-now-available) |

**Вывод:** «читать книгу и кликать по словам» — это commodity стоимостью $0 (Kindle) — $6/мес (Readlang). Lexicon бесплатный, но бесплатность не преимущество, если Readlang уже даёт неограниченные переводы слов бесплатно. Позиционирование «по книгам» само по себе **не дифференцирует** — оно описывает категорию, а не выбор.

### 1.2. Ложное обещание «без зубрёжки» — при том что ядро продукта и есть SRS

Lexicon обещает «без зубрёжки», но содержит SM-2 с learning steps, leech-словами и undo 10 мин — это буквально управляемая зубрёжка, только автоматизированная. Обещание ложно не по факту, а по ощущению: если пользователь открывает SRS-очередь и видит «повтори 40 слов», он чувствует зубрёжку, независимо от алгоритма. Конкуренты тоже это обещают — LingQ прямо продаёт «no grammar drills» ([LingQ](https://lingqcentral-en.lingq.com)). Обещание-антипод становится неотличимым.

Дополнительно: у LingQ **намеренно нет грамматики** («Learn Languages By Reading (And With No Grammar!)» — [Autolingual](https://autolingual.com/lingq-review), AI-коуч объясняет грамматику по запросу — [GTM Sauce](https://gtmsauce.com/companies/lingq)). То есть Lexicon с грамматикой на русском — это отличие, но не то, которое продано в позиционировании.

### 1.3. Отсутствие проверенного спроса и невозможность его измерить — 23 аккаунта

23 аккаунта при 55k строк кода — это соотношение, которое говорит: продукт строился кодом, а не спросом. Хуже другое: **интерфейс только на русском, домен sslip.io, нет мобильного приложения, нет монетизации** — то есть нет ни одного канала, через который можно проверить готовность платить. Ты не можешь узнать, есть ли спрос, потому что нечего купить и некуда прийти.

### 1.4. Вход без регистрации фактически отсутствует там, где он нужен
- Тест уровня — анонимный: `[AllowAnonymous]` на `GetPlacementTest()`/`SubmitPlacementResult()` — `EnglishLearningPlatform.API/Controllers/ProfileController.cs:130–148` **[код]**.
- Каталог — анонимный: `CatalogController` **[код]**.
- **Чтение книги требует авторизации**: из `ReaderController` анонимны только выдача аудио и статических ассетов (`ReaderController.cs:198, 296`) **[код]**. То есть ключевой вау-эффект («кликай по словам в книге») нельзя показать до регистрации. Duolingo пускает в первый урок без аккаунта; Readlang вообще не требует аккаунта, чтобы переводить слова.

### 1.5. Монетизации нет — при том, что конкуренты уже отработали ценообразование
Нет ни одной цены, ни одного paywall-эксперимента. ЛингQ, Readlang, Beelinguapp уже показывают вилки ($6–15/мес). У Lexicon нет ни данных о готовности платить, ни инфраструктуры (нет SMTP → нет чека, нет восстановления пароля → нет платящего пользователя).

---

## 2. ПРОБЕЛЫ (без чего Lexicon не конкурент)

| # | Пробел | Почему критично | Источник |
|---|---|---|---|
| 1 | **Мобильное приложение / хотя бы рабочая PWA** | PWA-манифест есть ([[код] `frontend/src/app/manifest.ts`]), но без push-уведомлений он не удерживает. Duolingo держит retention через push к времени привычки | [Greta.Agency](https://greta.agency/blog/duolingo-retention-engine) |
| 2 | **Push/напоминания** | Без них нет возврата на D1/D7. 22:00 «твой streak сгорит» — задокументированная механика Duolingo | там же |
| 3 | **Озвучка книги целиком (TTS по главам / read-along)** | У LingQ auto-audio для импорта, у Readlang — аудио-хранение и озвучка текстов. Чтение без слушания проигрывает методически и по восприятию ценности | [LingQ Premium](https://www.lingq.com/blog/lingq-free-vs-premium/), [Readlang pricing](https://readlang.com/pricing) |
| 4 | **Импорт своего контента** (EPUB/URL/YouTube) | У LingQ и Readlang это ядро. Только EPUB недостаточно: пользователь хочет свою статью/подкаст | [GTM Sauce — LingQ](https://gtmsauce.com/companies/lingq) |
| 5 | **Контекстный перевод фразы, а не только слова** | Жалоба на LinguaLeo прямо: «переводит слово по отдельности… не определяет значение слова в контексте» | [znanio.ru](https://znanio.ru/media/sravnenie-duolingo-i-lingualeo-2845997) |
| 6 | **Восстановление пароля и подтверждение почты** | Нет SMTP → нет сброса пароля. Это не «фича», это блокер доверия и блокер монетизации | контекст задачи |
| 7 | **Speaking-практика** (не только произношение слова/диктант) | Главный тренд рынка: AI-тьюторы = самый быстрый рост сегмента; Duolingo перенёс Video Call в Super | [GlobeNewswire 2026](https://www.globenewswire.com/news-release/2026/10/12/3379084/28124/en/online-language-learning-market-size-share-trends-and-global-forecast-2026-2036-ai-tutors-and-corporate-training-to-propel-market-to-50-6-billion-at-11-1-cagr.html), [SEC Q4 FY25](https://www.sec.gov/Archives/edgar/data/1562088/000162828026012246/q4fy25duolingo12-31x25shar.htm) |
| 8 | **Понятный «план на сегодня»** | Ключевая жалоба на Anki: «ничего не настроено из коробки… почему мне нужно уметь кодить, чтобы это работало?» | [r/Anki](https://reddit.com/r/Anki/comments/1nv5ks6/who_made_anki_and_why_is_it_so_incredibly_bad_to) |
| 9 | **Прозрачная экономика прогресса** («сколько слов знаю», «сколько до B2») | LingQ продаёт именно это: known-words count как мотиватор | [LingQ Premium](https://www.lingq.com/blog/lingq-free-vs-premium/) |
| 10 | **Собственная библиотека адаптированных книг по уровням** | Beelinguapp выигрывает контентом, а не технологией («Excellent for reading in foreign languages» — PCMag) | [PCMag](https://www.pcmag.com/reviews/beelinguapp) |

---

## 3. СКРЫТЫЕ РИСКИ

1. **Копирование механики LingQ без его причины существования.** LingQ растёт не продуктом, а YouTube-каналом Стива Кауфмана: 181 млн просмотров, 1.5 млн подписчиков, «зрители с канала конвертятся лучше» ([GTM Sauce](https://gtmsauce.com/companies/lingq)). У Lexicon нет ни медиа-актива, ни известного основателя, ни 6M+ регистраций. Скопировав продукт, ты не копируешь дистрибуцию.

2. **LingQ видит утечку и уже пошёл в AI-коуча.** LingQ строит «AI coach, который объясняет грамматику, переводит, ищет контент» ([GTM Sauce](https://gtmsauce.com/companies/lingq)) — то есть закрывает твоё единственное устойчивое отличие (грамматика на русском) на своём же рынке.

3. **Юридический риск на контенте.** Библиотека EPUB «классики/популярной литературы» — риск. У LingQ репутация страдала как раз из-за загруженных пользователями книг (в треде упоминается загрузка Harry Potter третьими лицами). Русскоязычный рынок в этом смысле не мягче.

4. **Односторонняя языковая пара и односторонняя локаль.** Интерфейс только на русском = потолок TAM и невозможность расти. Одновременно это единственная защита от LingQ — то есть защита есть ровно до тех пор, пока LingQ не сделает русский UI.

5. **Геймификация может ухудшить метрику обучения.** Hearts-система Duolingo одновременно монетизация и «естественная остановка»; перенос лиг/XP без понимания, что они мотивируют, легко даёт «играю в игру, а не учу». Уже есть публичная формулировка этой претензии к Duolingo: «Duolingo is now a language learning game not a language learning resource» ([r/duolingo](https://reddit.com/r/duolingo/comments/1kd2761/lets_just_be_honest_here_duolingo_is_now_a)).

6. **AI-first отталкивает пользователей.** Одна из главных причин оттока от Duolingo в 2025 — «AI-first» (письмо CEO): «It is mostly the AI first approach, rendering the lessons quite boring and standardized» ([r/duolingo](https://reddit.com/r/duolingo/comments/1o4yffg/why_are_people_leaving_duolingo)). У Lexicon AI (Gemini) — в ассистенте, озвучке, writing. Подавать это как «AI-платформа» — повторять ошибку.

7. **23 аккаунта + нет почты = нет обратной связи.** Продукт нельзя валидировать: даже отзывы не получить, потому что нет email-цикла.

8. **sslip.io домен** — блокеры в РФ-мессенджерах/антивирусах, нулевое доверие к оплате картой.

---

## 4. Таблица «конкурент → их боль → наш ответ → есть ли у нас (файл)»

Пометки: **[код]** — проверено в файле; **нет** — не найдено в коде; **частично**.

| Конкурент | Их реальная боль (источник, цитата) | Наш ответ | Есть? |
|---|---|---|---|
| **Duolingo** | «Too repetitive. They throw you into the deep end without teaching you the basics» — [App Store reviews](https://apps.apple.com/us/app/570060128?platform=iphone&see-all=reviews) (сниппет) | Грамматика на русском с объяснением правил | **частично** — `frontend/src/app/grammar/[id]/page.tsx`, `GrammarController.cs` [код]; объяснения на русском, но не привязаны к ошибкам пользователя |
| **Duolingo** | Убрали грамматику: «removed the grammar» — [r/duolingo](https://reddit.com/r/duolingo/comments/1opirrf/duolingo_became_so_bad_i_wish_there_was_an_open) (сниппет) | Грамматика не удалена, а встроена | **да** — `grammar/`, `GrammarController.cs` [код] |
| **Duolingo** | «won't learn an entire language… Duo won't/can't teach» грамматику и культуру — [r/duolingo](https://reddit.com/r/duolingo/comments/1kd2761/lets_just_be_honest_here_duolingo_is_now_a) | Чтение настоящих книг = реальный язык, не синтетические фразы | **да** — `frontend/src/app/reader/`, `ReaderController.cs` [код] |
| **Duolingo** | Раздувание курса ради удержания: «padding it out so you can't [finish]» — [r/duolingo](https://reddit.com/r/duolingo/comments/1nvklui/duolingo_is_just_bloating_courses_to_keep_you) | В книге финал настоящий, а не искусственный гейт | **да** — по природе формата |
| **Duolingo** | AI-first сделал уроки «boring and standardized» — [r/duolingo](https://reddit.com/r/duolingo/comments/1o4yffg/why_are_people_leaving_duolingo) | AI не в ядре урока: ассистент по запросу | **частично** — `AssistantController.cs`, `AiController.cs` [код]; риск — продавать это как главную фичу |
| **Duolingo** | Пассивно-агрессивные нотификации, «nasty, pernicious little app» — [Trustpilot](https://nz.trustpilot.com/review/duolingo.com?page=6) | Мягче: напоминания без стыда | **нет** — push-механики нет |
| **LingQ** | «core idea and main function of learning through reading are great… [but] $15 a month for a subpar service»; «still lacks curated content, the user interface [is bad]» — [r/languagelearning](https://www.reddit.com/r/languagelearning/comments/1g7h5zw/lingq_is_a_horrible_service/) (сниппет) | Готовая курированная библиотека на русском + бесплатно | **частично** — `library/`, `books/` [код]; но курирование и объём не подтверждены |
| **LingQ** | «Extremely laggy and slow… features missing» — [r/LingQ](https://www.reddit.com/r/LingQ/comments/1lsu61n/what_are_they_actually_doing_with_this_money_i/) (сниппет) | Быстрый веб + кэш офлайн | **не найдено** (перф-тестов в репозитории не искал; PWA-манифест есть) |
| **LingQ** | «Free version is pretty much unusable since it limits you to 20 words saved» — [r/German](https://www.reddit.com/r/German/comments/1l1ocpd/is_lingq_worth_the_15_a_month_for_vocab/) (сниппет) | Бесплатно, без лимита слов | **да** — 20 слов, 0 paywall; ограничение только «23 аккаунта» |
| **LingQ** | «agonizingly boring short stories» в библиотеке — [r/languagelearning](https://www.reddit.com/r/languagelearning/comments/1t2fily/lingq_is_overpriced_and_a_bad_product_rant/) (сниппет) | Читать то, что сам выбрал (своя книга — но лишь EPUB) | **частично** — `reader/` EPUB [код]; импорта URL/YouTube нет |
| **LingQ** | Free-план урезали намеренно, потому что «many learners quit within a day or two» — [GTM Sauce](https://gtmsauce.com/companies/lingq) | Не строить стену перед D2 | **да** — стены нет |
| **Anki** | «nothing is set up out of the box. Why do I need to know how to code to run this application» — [r/Anki](https://reddit.com/r/Anki/comments/1nv5ks6/who_made_anki_and_why_is_it_so_incredibly_bad_to) | Настройки не нужны: карточки рождаются из чтения, план на день готов | **частично** — SRS есть, «что делать сегодня» — не проверил (не нашёл отдельного daily-plan экрана) |
| **Anki** | Перегруз повторений, тревога: «genuinely making me anxious… 2nd year med student» — [r/Anki](https://reddit.com/r/Anki/comments/1j91e2g/need_help_with_overwhelming_reviews_genuinely) | Hard-кап новой лексики, leech, learning steps | **да** — SRS SM-2 с leech [код] |
| **Anki** | Колоды из книг взрываются: «2,870 flashcards from five books… 20 sub-decks» — [r/Anki](https://reddit.com/r/Anki/comments/1fu1c8u/overwhelmed_by_too_many_new_flashcards_every_day) | Отбор слов из текста + категории с 3 режимами | **да** — категории/режимы [код] |
| **Anki** | Нет понимания, что делать: «does not tell you how much is overdue» — [HN](https://news.ycombinator.com/item?id=25161946) | Прогресс и очередь явные | **частично** — `progress/`, heatmap [код] |
| **LinguaLeo** | Перевод без контекста: «сервис переводит слово по отдельности… не определяет конкретное значение слова в контексте» — [znanio.ru](https://znanio.ru/media/sravnenie-duolingo-i-lingualeo-2845997) | Перевод слова в контексте предложения (AI) | **частично** — `AiController.cs` / ассистент [код]; контекстный перевод в ридере не подтверждён |
| **LinguaLeo** | «Материал поверхностный, много значений у слов без нормального объяснения контекста» — [mooc.ru](https://mooc.ru/company/lingualeo) | То же + категории слов | **частично** |
| **LinguaLeo** | «Рассчитан на длительное и достаточно медленное обучение», «нет фонетики» — [znanio.ru](https://znanio.ru/media/sravnenie-duolingo-i-lingualeo-2845997) | Произношение и диктант через Azure Speech | **да** — `PronunciationController.cs`, `AudioController.cs` [код] |
| **LinguaLeo** | Списывания: «втихую сами подключили мне подписку… совершили кражу денег с карты» — [appvisor.ru](https://appvisor.ru/app/ios/angliyskiy-yazyk-s-leo-555/) | Честная отмена подписки | **нет монетизации** — никуда не спешить, но это и не ответ |
| **Puzzle English** | «Очень дорого, даже со скидками» — [App Store RU](https://apps.apple.com/ru/app/puzzle-english/id1032671465); 990 ₽/мес | Бесплатно | **да** |
| **Puzzle English** | «Требует самостоятельности. Может дать задания, словарь, курсы… но не заставит» — [DTF](https://dtf.ru/u4i_online/3181473-vsya-pravda-o-puzzle-english-otzyvy-plyusy-i-minusy-obzor-eksperta) | Streak/лиги как внешний привод | **да** — `StreakCard.tsx`, `WeeklyLeague.tsx` [код] |
| **Readlang** | Free: 10 фразовых переводов/день, «нужен аккаунт для сохранения» | Бесплатно, весь цикл | **да** |
| **Memrise** | «there is a learning path, but it's difficult to find… Memrise is slow» — [PCMag](https://www.pcmag.com/reviews/memrise) | План чтения — основной экран | **не найдено** (отдельного plan-экрана не подтвердил) |

---

## 5. Retention: что реально работает (данные, а не мнения) и бенчмарки

| Утверждение | Данные | Источник |
|---|---|---|
| Streak работает через loss aversion + нотификация в 22:00 | Duolingo D30 > 70% (по когорте завершивших первый урок) при 40M+ DAU | [Greta.Agency](https://greta.agency/blog/duolingo-retention-engine) — **это вторичный блог, не раскрытие Duolingo; цифра не подтверждена первоисточником** |
| Лиги (30 человек, повышение/вылет) — реальный рычаг | Качественное описание механики, без A/B-данных | там же |
| Стена на free-плане повышает конверсию | LingQ урезал free-лимит несколько раз; **каждый раз конверсия росла** (цифр нет) | [GTM Sauce](https://gtmsauce.com/companies/lingq) |
| Импорт своего контента повышает удержание | LingQ: после YouTube/Netflix-импорта «stickiness rose as friction fell» (цифр нет) | там же |
| Длинные стрики достижимы | Один пользователь: 4.8 млн слов, **2,125-дневный streak** | [Lingtuitive](https://lingtuitive.com/blog/lingq-review) |
| D30 у Duolingo в 10-месячном письме CEO | DAU 50M+ за 2025, bookings > $1 млрд, net income > $300M (в Q4-версии — >$40M) | [Duolingo IR, 05.11.2025](http://investors.duolingo.com/news-releases/news-release-details/duolingo-surpasses-50-million-daily-active-users-grows-dau-36), [SEC Q4 FY25](https://www.sec.gov/Archives/edgar/data/1562088/000162828026012246/q4fy25duolingo12-31x25shar.htm) |
| MAU Duolingo Q3 2025 | **135.3 млн** | [Statista](https://www.statista.com/statistics/1309610/duolingo-quarterly-mau/) |

### Бенчмарки D1/D7/D30 для EdTech

| Категория | D1 | D7 | D30 | Источник |
|---|---|---|---|---|
| Consumer apps в среднем | ~25% | — | ~6% | [Passion.io](https://passion.io/blog/mobile-app-retention-benchmarks-for-creators-course-coaching-apps) |
| **Education (медиана)** | **14–15%** | — | **2–3%** (некоторые 2.1%) | там же |
| Pushwoosh 2025: iOS | — | 6.89% | 3.10% | [Pushwoosh](https://www.pushwoosh.com/blog/increase-user-retention-rate/) |
| Social/consumer «OK → Great» | 50–70% | 35–50% | 20–30% | [Omega Point](https://omegapoint.systems/benchmarks/d1-d7-d30-retention) |
| Правило «40/20/10» | 40% | 20% | 10% | топ-перцентиль, не медиана — там же |

**Зелёные цели для Lexicon (мой вывод на основе этих данных):**
- D1 ≥ 25% (2× медианы образования) — иначе onboarding сломан.
- D7 ≥ 8% (выше среднего Pushwoosh 6.89%).
- D30 ≥ 8–10% («40/20/10»-класс, но у образовательных это верхний перцентиль).
- Опорная метрика важнее D30: **% новых, дошедших до 1-й книги и 50 сохранённых слов** — при 23 аккаунтах только она статистически осмысленна.

**Прямое следствие для продукта:** медиана образования — 2–3% D30. Значит, «у нас будут удерживаться» — не аргумент. Нужен канал, который приводит людей с намерением читать, а не «учить язык».

---

## 6. EdTech-тренды 2025–2026

1. **AI-тьюторы и speaking** — самый быстрый сегмент; Duolingo переносит Video Call с Lily в Super-тир, Max — в экспериментальную надстройку ([SEC Q4 FY25](https://www.sec.gov/Archives/edgar/data/1562088/000162828026012246/q4fy25duolingo12-31x25shar.htm)). AI-стартапы получают pre-seed под «speaking from day one» ([Tech.eu, Eevi](https://tech.eu/2026/09/22/eevi-raises-pre-seed-funding-to-get-language-learners-speaking-from-day-one/)). Preply строит AI поверх живых тьюторов ([Axios](https://www.axios.com/sponsored/preply-is-building-the-worlds-best-ai-for-language-learning-powered-by-real-tutors)).
2. **Персонализация по контенту пользователя** — LingQ: «turn Netflix/YouTube into a lesson» ([LingQ](https://lingqcentral-en.lingq.com)).
3. **Отказ от «drill-приложений» в маркетинге** — LingQ прямо противопоставляет себя «gamified drilling apps» (там же). Это война нарративов, в которой Lexicon сейчас на стороне проигравшего: он одновременно геймифицирован (лиги/XP) и обещает «без зубрёжки».
4. **Коммодитизация перевода** — Kindle Word Wise (бесплатно), Readlang (free unlimited words), словари-расширения. Перевод слова как фича умер.

---

## 7. 10 причин отвала + закрывает ли Lexicon

| # | Причина отвала | Источник | Lexicon закрывает? |
|---|---|---|---|
| 1 | Скука/повторяемость | [App Store Duolingo](https://apps.apple.com/us/app/570060128?platform=iphone&see-all=reviews), [r/duolingo](https://reddit.com/r/duolingo/comments/1kd2761/lets_just_be_honest_here_duolingo_is_now_a) | **частично** — книга интереснее дрилла, но SRS-очередь воспроизводит ту же скуку |
| 2 | Нет объяснений грамматики | [r/duolingo](https://reddit.com/r/duolingo/comments/1opirrf/duolingo_became_so_bad_i_wish_there_was_an_open) | **да** — `grammar/`, но на русском и не привязана к ошибкам |
| 3 | Не работает без мотивации | [DTF про Puzzle English](https://dtf.ru/u4i_online/3181473-vsya-pravda-o-puzzle-english-otzyvy-plyusy-i-minusy-obzor-eksperta) | **частично** — streak/лиги есть; push нет |
| 4 | Зубрёжка слов без контекста | [znanio.ru про LinguaLeo](https://znanio.ru/media/sravnenie-duolingo-i-lingualeo-2845997) | **да** — слова приходят из книги. Но слово сохраняется как карточка — контекст надо удерживать в карточке |
| 5 | Дорого | [App Store Puzzle](https://apps.apple.com/ru/app/puzzle-english/id1032671465), [LingQ rant](https://www.reddit.com/r/languagelearning/comments/1t2fily/lingq_is_overpriced_and_a_bad_product_rant/) | **да** — бесплатно, но не монетизируемо |
| 6 | Непонятно, что делать сегодня | [r/Anki](https://reddit.com/r/Anki/comments/1nv5ks6/who_made_anki_and_why_is_it_so_incredibly_bad_to) | **частично** — SRS-очередь + дашборд, единого «плана дня» не нашёл |
| 7 | Перегруз повторами | [r/Anki](https://reddit.com/r/Anki/comments/1j91e2g/need_help_with_overwhelming_reviews_genuinely) | **да** — leech, learning steps |
| 8 | Медленно/тормозит | [r/LingQ](https://www.reddit.com/r/LingQ/comments/1lsu61n/what_are_they_actually_doing_with_this_money_i/) | **не проверено** |
| 9 | Нет практики речи | тренд рынка ([GlobeNewswire](https://www.globenewswire.com/news-release/2026/10/12/3379084/28124/en/online-language-learning-market-size-share-trends-and-global-forecast-2026-2036-ai-tutors-and-corporate-training-to-propel-market-to-50-6-billion-at-11-1-cagr.html)) | **нет** — только произношение слова и диктант |
| 10 | Ложь в биллинге (в тихую продлевают) | [appvisor.ru про LinguaLeo](https://appvisor.ru/app/ios/angliyskiy-yazyk-s-leo-555/) | **n/a** — нет подписки |

---

## 8. Ответ по LingQ: единственное выживающее позиционирование

**Что LingQ уже имеет:** 5M+ learners (сайт), 6M+ регистраций ([GTM Sauce](https://gtmsauce.com/companies/lingq)), 50+ языков, EPUB/YouTube/Netflix-импорт, known-words-счётчик, 2,125-дневные стрики у пользователей. По твоим вводным — цель «100 лет чтения»; публичного подтверждения формулировки я **не нашёл** (искал на lingq.com, forum.lingq.com, в App Store) — ближайшее найденное: word-count-цели в 1–5 млн слов ([форум LingQ](https://forum.lingq.com/t/what-is-a-good-%E2%80%98words-of-reading%E2%80%99-goal-to-set-for-yourself/328982)) и competition «earn points by reading» ([App Store](https://apps.apple.com/bt/app/lingq-learn-languages/id379385811)). Направление совпадает, конкретная формулировка — не подтверждена.

**Почему «учись по книгам» проигрывает напрямую:** LingQ делает это 18 лет, на 50 языках, за $10–15/мес, с импортом любого контента и с медиа-активом 1.5 млн подписчиков. Readlang делает ключевую часть (клик + перевод) **бесплатно и без аккаунта**. Конкурировать «мы тоже по книгам» — это конкурировать объёмом библиотеки и брендом, где у тебя 23 аккаунта.

**Единственное, что может выжить:**

> **«Грамматика, которую ты не понимаешь в книге, — объяснённая по-русски, из твоего же предложения».**

Не «чтение с переводом слов» (это commodity), а **разбор**: пользователь кликает не только «что значит слово», а «почему здесь *had been waiting*, а не *waited*» — и получает объяснение на русском, привязанное к конкретному предложению из его книги, с русскоязычными типичными ошибками (артикли, Perfect, предлоги — то, на чём спотыкаются именно русскоязычные A1–B2).

Почему это выживает:
1. **LingQ методически против грамматики** — он продаёт «no grammar», а AI-коуч только начинает объяснять её ([Autolingual](https://autolingual.com/lingq-review), [GTM Sauce](https://gtmsauce.com/companies/lingq)). Их нарратив не позволяет им стать «объяснялкой грамматики» — это противоречит ДНК продукта.
2. **Readlang/Beelinguapp не объясняют** — переводят. Разница между «перевёл» и «понял» — и есть продукт.
3. **Языковая пара RU→EN** — у LingQ нет русского интерфейса как преимущества; у тебя русский по умолчанию. Но это защита на 1–2 года, пока LingQ не локализуется.
4. Грамматика у Lexicon уже есть в коде (`grammar/`, `GrammarController.cs`) — это не стройка с нуля, а переупаковка.

**Чего делать нельзя:** продавать «SRS», «лиги», «streak», «AI-ассистент» как отличия — это ровно те фичи, из-за которых люди уходят от Duolingo («it's a game», «AI-first boring»).

**Тест позиционирования (до кода):** лендинг на 1 экран — «Вставь абзац из своей книги → получи разбор непонятной грамматики по-русски». Без регистрации. Мерить, сколько вставили абзац и сколько нажали «объясни ещё».

---

## 9. Конкретный план

### Must Have (до любой публичной попытки)

| # | Что | Зачем (источник) | Сложность |
|---|---|---|---|
| 1 | **Анонимное чтение 1 главы без регистрации** | Ключевой wow-эффект сейчас за логином (`ReaderController.cs:198,296` — анонимны только аудио/ассеты) **[код]**; Duolingo/Readlang пускают без аккаунта | S |
| 2 | **SMTP + восстановление пароля** | Без этого нет ни платящего пользователя, ни обратной связи от 23 аккаунтов | S |
| 3 | **Свой домен** | sslip.io убивает доверие и оплату | S |
| 4 | **Экран «План на сегодня»** (10 мин: 1 глава → 8 слов → 1 грамматический разбор) | Главная жалоба на Anki — «непонятно, что делать» ([r/Anki](https://reddit.com/r/Anki/comments/1nv5ks6/who_made_anki_and_why_is_it_so_incredibly_bad_to)) | M |
| 5 | **Контекстный разбор грамматики по-русски из предложения пользователя** | Единственное защищаемое позиционирование (раздел 8) | M |
| 6 | **Перевод фразы, а не слова** | Прямая жалоба на LinguaLeo ([znanio.ru](https://znanio.ru/media/sravnenie-duolingo-i-lingualeo-2845997)); Readlang продаёт это как Premium | S |
| 7 | **PWA + Web Push напоминание** | Retention без push не строится ([Greta.Agency](https://greta.agency/blog/duolingo-retention-engine), [Pushwoosh](https://www.pushwoosh.com/blog/increase-user-retention-rate/)) | M |
| 8 | **Событийная аналитика воронки** | При 23 аккаунтах только воронка «регистрация → 1-я книга → 50 слов → D7» даст решение. Частично есть: `AnonymousAnalyticsController.cs` **[код]** | S |
| 9 | **Убрать «без зубрёжки» из позиционирования** | Ложно по факту: SRS — это зубрёжка. Заменить на «понятно, а не зазубрено» | XS |
| 10 | **20–30 курированных книг с уровнями A2/B1/B2** | Beelinguapp выигрывает контентом ([PCMag](https://www.pcmag.com/reviews/beelinguapp)); LingQ ругают за «boring short stories» | L |

### Nice to Have

| # | Что | Обоснование |
|---|---|---|
| 1 | Импорт URL/статьи (не только EPUB) | LingQ: импорт повышал stickiness ([GTM Sauce](https://gtmsauce.com/companies/lingq)) |
| 2 | TTS-озвучка главы целиком (read-along) | Конкуренты продают это в premium ([Readlang pricing](https://readlang.com/pricing)) |
| 3 | Мини-диалог с ассистентом по содержанию главы (asking-questions, не speaking) | Закрывает «нет практики речи» частично, не повторяя AI-first ошибку Duolingo |
| 4 | Публичный прогресс «знаю N слов» с оценкой до B2 | LingQ продаёт known-words как мотиватор ([LingQ Premium](https://www.lingq.com/blog/lingq-free-vs-premium/)) |
| 5 | Упрощённые лиги (только среди друзей) | Лиги на 30 незнакомцев требуют массы — при 23 аккаунтах они не работают и выглядят мёртвыми |
| 6 | Мобильное приложение / TWA | PWA-манифест есть **[код]**, но без push — полдела |
| 7 | Английский UI | Потолок роста, но после подтверждения RU-спроса |

### Чего НЕ делать
- Не добавлять фичи до валидации спроса (23 аккаунта при 55k строк — уже переинвестировано в код).
- Не соревноваться с LingQ по объёму библиотеки и числу языков.
- Не строить «AI-платформу» в маркетинге — это триггер оттока от Duolingo.
- Не запускать монетизацию до SMTP и домена.

---

## Отдельный вывод по вопросу «сколько спроса на чтение с подсказками»

Спрос **не измерен публично**. Ориентиры: LingQ 5–6M регистраций за 18 лет (не MAU, не платящие) ([сайт](https://www.lingq.com/en/), [GTM Sauce](https://gtmsauce.com/companies/lingq)); Readlang — «тысячи» пользователей, точной цифры не найдено; русскоязычный сегмент — не найдено ни одного отчёта. Это значит: **ниша не подтверждена и не опровергнута**. Проверять надо не рынком, а лендингом на 1 экран (раздел 8).
