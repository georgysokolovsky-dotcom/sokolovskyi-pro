# Спецификация men funnel v1

**Funnel ID:** `men_webinar_v1`
**Статус:** архитектурные решения подтверждены; контент и legal-параметры ожидают отдельного подтверждения
**Область:** изолированный lab-контур в ветке `feature/men-funnel`

## 0. Рамка и исходное состояние

Эта спецификация описывает первую версию отдельной воронки для мужчин:

```text
traffic source
  → optional article
  → webinar landing
  → Telegram Start
  → bonus
  → warming
  → signed webinar
  → viewing events
  → follow-up
  → application
  → CRM
```

Воронка не входит в публичный Astro-сайт и не меняет его. До отдельной команды остаются без изменений:

- SEO-статьи и их CTA;
- публичные Astro-маршруты, layout и навигация;
- legal pages, analytics и cookies;
- production, DNS, hosting и внешние интеграции;
- существующая ветка `main`.

Связь задаётся так:

```text
Traffic Source → optional Article → Funnel → Telegram flow → Bonus → Webinar → Application
```

Статья — только один из возможных источников входа. Она не владеет bonus и не выбирает bonus напрямую.

### Что уже есть в репозитории

Фактическая основа спецификации:

- `lab/men-funnel/README.md` — filesystem-only прототип вне `src/pages/`;
- `lab/men-funnel/prototype/data/men-webinar-v1.js` — конфигурация funnel и bot;
- `lab/men-funnel/prototype/components/TelegramCta.astro` — генератор Telegram deep link;
- `lab/men-funnel/prototype/video/men-relationship-recovery.astro` — lab-экран webinar;
- `lab/men-funnel/prototype/apply/men.astro` — lab-экран application;
- `server/src/data/local-fixture.mjs` — локальная конфигурация funnel, bonus, message templates и webinar;
- `server/src/flow/men-webinar.mjs` — Telegram Start, выдача bonus, signed video token, события и application;
- `server/src/security/signed-tokens.mjs` — текущий HMAC token с TTL 1 час;
- `server/src/store/memory-store.mjs` — in-memory хранилище для lab;
- `server/src/store/postgres-store.mjs` — persistent implementation того же store contract;
- `server/migrations/001_core.sql` — initial PostgreSQL schema с Telegram update state и database-level idempotency;
- `server/migrations/002_delivery_operations.sql` — persistent delivery operations, lease и recovery state machine;
- `server/migrations/003_delivery_dependencies.sql` — порядок зависимых шагов delivery после restart;
- `server/tests/vertical-slice.test.mjs` — проверка пути от Telegram Start до application.

В server реализован Telegram Bot API-compatible transport с внедряемыми `fetch`, base URL и timeout. По умолчанию server использует dev/mock transport без сети. Настоящий bot token и production webhook не подключены; webhook secret и signing secret в репозитории не хранятся. Реальный видеоматериал не подключён.

### Конфигурация первой версии

| Объект | Значение | Статус |
|---|---|---|
| Funnel | `men_webinar_v1` | активная lab-конфигурация |
| Bot | `@sokolovskyi_men_bot` | username зафиксирован, token не подключён |
| Основной bonus | `https://t.me/georgy_sokolovsky/44` | audio, reference/placeholder |
| Дополнительный bonus | `https://t.me/georgy_sokolovsky/16` | `draft`, `inactive`, не выдаётся |
| Webinar | `lab-men-funnel-video-fixture` | lab fixture, не production-видео |
| Storage | `MemoryStore` / `PostgresStore` | memory — safe default; postgres — persistent local/staging-ready mode |

В текущей fixture bonus `/44` имеет `sourceId: null`. Это обязательное правило: bonus принадлежит funnel, а не отдельной статье.

## 1. Общие продуктовые правила

### 1.1. Идентификаторы

- `funnel_id` — постоянный идентификатор версии воронки: `men_webinar_v1`.
- `source_id` — зарегистрированная запись traffic source внутри funnel.
- `start_parameter` — короткий проверяемый ключ Telegram deep link. Он указывает на source mapping, а не содержит произвольные данные пользователя.
- `user_id` — внутренний непрозрачный ID пользователя в системе.
- `telegram_user_id` — основной внешний идентификатор после команды `/start`. Username, имя и язык — дополнительные атрибуты.
- `bonus_id` и `bonus_version` — идентификатор и версия bonus.
- `webinar_id` — идентификатор lab или реального webinar.
- `application_id` — идентификатор заявки.
- `token.purpose` — назначение signed token: `webinar` или `application`.

В URL, логах и аналитике нельзя раскрывать `telegram_user_id`, email, телефон, token или секреты. В token передаётся только непрозрачная ссылка на внутреннего пользователя.

### 1.2. Идентичность и отсутствие постоянного anonymous tracking

До `/start` пользователь считается анонимным посетителем funnel. Не создаются:

- постоянный anonymous profile;
- browser fingerprint;
- долгоживущий tracking identifier;
- CRM-профиль до Telegram Start.

До `/start` разрешена только передача attribution в рамках текущего перехода:

```text
article → landing → Telegram deep link
```

Предпочтительные механизмы:

- URL parameters;
- signed attribution reference;
- короткий server-generated attribution code.

Если для технической работы понадобится strictly necessary session (короткоживущая техническая сессия), она живёт только до завершения текущего перехода и не используется для маркетингового профилирования.

После Telegram `/start` основным идентификатором становится `telegram_user_id`. Повторный `/start` не создаёт второго пользователя.

### 1.3. Две attribution-записи

Для пользователя и CRM хранятся два разных понятия:

- `first_touch` — первый неизменяемый подтверждённый источник пользователя;
- `funnel_entry_touch` — источник, через который пользователь вошёл именно в текущую funnel.

`first_touch` после первого определения не перезаписывается. `funnel_entry_touch` фиксируется для `men_webinar_v1` при первом подтверждённом входе в эту funnel.

Полноценная multi-touch attribution в MVP не строится. Повторные touchpoints могут сохраняться как события, но не меняют основной отчёт.

### 1.4. Доступ к закрытым шагам

Каждый закрытый шаг открывается через серверный контекст пользователя:

- Telegram Start создаёт связь с funnel и source;
- server выдаёт отдельный `webinar_token` для webinar;
- CTA к application получает отдельный `application_token`;
- token привязан к `user_id`, `funnel_id` и purpose, но не содержит Telegram ID;
- webinar token не даёт полномочий application token.

## 2. Attribution: Traffic Source → optional Article → Funnel

### 2.1. Source mapping

Каноническая модель:

```text
Traffic Source → optional Article → Funnel
```

`article_slug` — nullable. Поддерживаются входы:

```text
Google article   → men_webinar_v1
Instagram        → men_webinar_v1
Telegram channel → men_webinar_v1
Reels            → men_webinar_v1
direct           → men_webinar_v1
other campaign   → men_webinar_v1
```

Каждый разрешённый вход получает source mapping с полями:

```text
source_id
funnel_id
source
medium
campaign
content
article_slug: nullable
start_parameter
```

Для direct или campaign entry `article_slug` остаётся `null`. Funnel не зависит от существования Article.

### 2.2. Lab source

Текущая lab-fixture содержит:

```text
articleSlug: kak-perezhit-izmenu-zheny
startParameter: article_wife_cheating
funnelId: men_webinar_v1
```

Это тестовая запись. Публичные статьи сейчас не изменяются и не импортируют `TelegramCta`.

### 2.3. Передача attribution до Telegram

Landing получает source context из URL, signed attribution reference или короткого server-generated кода. При клике CTA этот context превращается в разрешённый `start_parameter`.

Правила:

1. В Telegram deep link передаётся только валидный короткий ключ.
2. Сырые UTM и произвольные значения из URL нельзя без проверки переносить в Telegram deep link.
3. Полные traffic-поля хранятся в source mapping, а не в Telegram URL.
4. Неподтверждённый source не получает пользовательский профиль и не создаёт фальшивую attribution.
5. После `/start` в CRM видны отдельно `first_touch`, `funnel_entry_touch`, `article_slug` и `funnel_id`.

Примеры:

```text
first_touch: Google → article_slug → men_webinar_v1
funnel_entry_touch: Google → article_slug → men_webinar_v1
```

или:

```text
first_touch: Instagram → direct
funnel_entry_touch: Instagram → men_webinar_v1
```

## 3. Сценарий по экранам и событиям

## A. Webinar landing

### Что видит пользователь

Lab landing объясняет:

- что это отдельный webinar funnel;
- какой следующий шаг доступен после перехода в Telegram;
- что сначала пользователь получит bonus, а затем доступ к webinar;
- что заявка появится только после перехода к этому шагу;
- что на landing не требуются email, телефон, регистрация, аккаунт или пароль.

Финальные продающие тексты в эту спецификацию не входят. Для реализации используются роли блоков и черновые action labels.

При входе в Telegram пользователь должен заранее увидеть понятное описание возможных сообщений funnel:

- bonus;
- ссылка на видеоразбор;
- напоминания и сообщения по материалам этой программы.

Это описание фиксируется как версия notice/request, но окончательный юридический текст не утверждается этим документом.

### Доступные действия

- прочитать описание funnel;
- нажать основной CTA перехода в Telegram;
- вернуться назад или закрыть страницу.

Форма, поле email, телефон, пароль и регистрация на landing отсутствуют.

### После Telegram CTA

1. Клиент формирует deep link на `@sokolovskyi_men_bot`.
2. В ссылку передаётся только разрешённый `start_parameter` или короткий attribution code.
3. Ссылка открывает Telegram в новой вкладке или приложении.
4. До входящего `/start` нет постоянной пользовательской записи.
5. Если local server не подключён, landing остаётся lab-экраном и не обещает доставку bonus.

В первой lab-версии проверяется источник `article_wife_cheating`. Direct source для funnel поддерживается моделью, но его отдельная fixture-запись и текст входа появятся только на следующем этапе реализации.

## B. Telegram Start

### Что получает система

Telegram webhook принимает update только после проверки `TELEGRAM_WEBHOOK_SECRET`. Из update используются:

- `update_id` — ключ идемпотентности;
- `message.from.id` — `telegram_user_id`;
- `message.from.first_name`;
- `message.from.username`;
- `message.from.language_code`;
- текст `/start <start_parameter>`.

Сырые Telegram update и лишние поля не сохраняются.

### Что сохраняется

При валидном `start_parameter` система:

1. находит source mapping и его `funnel_id`;
2. находит пользователя по `telegram_user_id` или создаёт внутренний `user_id`;
3. сохраняет `first_touch`, если он ещё не определён;
4. сохраняет `funnel_entry_touch` для `men_webinar_v1`, если пользователь входит в эту funnel впервые;
5. создаёт или обновляет Telegram profile — имя, username, язык и timestamps;
6. создаёт событие `telegram_start`;
7. отправляет entry notice; после подтверждения transport записывает его версию, timestamp, source и `funnel_id`;
8. после успешного entry notice начинает delivery bonus, затем выдаёт signed webinar URL и отправляет invite.

Минимальная запись Telegram profile:

```text
user_id
telegram_user_id
first_name
username
language_code
first_started_at
last_started_at
```

`telegram_user_id` — основной идентификатор. Username может измениться и не используется как ключ.

### Entry notice/request record

До production должна существовать отдельная запись или поля с таким смыслом:

```text
consent_or_request_version
timestamp
source
funnel_id
```

Это версия понятного описания сообщений и запроса на их получение. Окончательный юридический статус и текст определяются отдельно.

### Attribution при `/start`

`start_parameter` разрешается только через source registry. При Start в CRM становятся доступны:

```text
first_touch
funnel_entry_touch
article_slug: nullable
funnel_id
source_id
start_parameter
```

Полные traffic-поля берутся из source mapping. Повторный `/start` не заменяет `first_touch` и не создаёт второй профиль.

### Идемпотентность

Повторная доставка одного update с тем же `update_id` не должна:

- создавать нового пользователя;
- повторно создавать entry touch;
- повторно запускать ту же delivery operation;
- создавать дубликат события `telegram_start`.

Текущий server использует ключи событий вида `telegram-update:<update_id>` и локальный тестовый endpoint `/v1/test/telegram/start`.

В `memory`-режиме защита работает только внутри одного процесса. В `postgres`-режиме `telegram_updates` имеет primary key `(funnel_id, update_id)`: первая транзакция атомарно регистрирует update, пользователя, attribution, Telegram profile и `telegram_start`. Concurrent и post-restart дубли не запускают delivery повторно.

Update хранит `processing`, `completed` или `failed`, timestamps, `error_stage` и `error_code`. Telegram HTTP не входит в DB transaction; delivery attempted/sent/failed фиксируются events и отдельными persistent operations. Ручной recovery не переписывает исторический статус update.

### Persistent delivery recovery

Для нового `/start` заранее создаётся зависимая цепочка операций:

```text
entry_notice → bonus → webinar_invite
```

Каждая запись содержит `operation_key`, `funnel_id`, `user_id`, `telegram_update_id`, технический recipient, тип сообщения, безопасный descriptor конфигурации, attempt counter, max attempts, next retry, lease, provider receipt и нормализованную ошибку. Signed webinar token и полный URL в operation не сохраняются: invite строится непосредственно перед безопасной попыткой отправки.

Состояния: `pending`, `processing`, `delivered`, `retryable_failed`, `delivery_unknown`, `dead_letter`, `suppressed`. Claim выполняется атомарно через PostgreSQL row lock; зависимый шаг доступен только после `delivered` предыдущего. Истёкший lease можно повторно взять лишь когда HTTP attempt ещё не был отмечен. Если запрос уже мог уйти провайдеру, операция закрывается в `delivery_unknown` и автоматически не повторяется.

Retry разрешён только для явного HTTP `429`/`5xx`, с exponential backoff и max attempts. HTTP `4xx`, API rejection и ошибки конфигурации переходят в `dead_letter`; timeout, network/malformed response — в `delivery_unknown`. Подтверждённый provider receipt запрещает повторную отправку при restart, повторном update и любом следующем запуске executor.

Перед каждой реальной попыткой заново проверяются `telegram_stop`, deletion request и `sold`. При запрете operation становится `suppressed`, transport не вызывается. Recovery запускается только вручную командой `npm --prefix server run recovery`; cron и scheduler отсутствуют.

### Команды управления

`/stop`:

- прекращает будущие promotional и follow-up сообщения;
- отменяет pending automation для этого пользователя и funnel;
- сохраняет факт запроса и timestamp;
- не удаляет уже сохранённую application автоматически.

`/delete` или эквивалентный понятный механизм:

- создаёт `data_deletion_requested`;
- фиксирует timestamp, source и funnel;
- запускает процесс удаления или анонимизации по retention policy;
- не требует email или телефон для создания запроса.

## C. Bonus delivery

### Первый bonus

Для `men_webinar_v1` активен один входной bonus:

```text
bonus_id: bonus_podcast_01
type: audio
delivery_mode: link
content_ref: https://t.me/georgy_sokolovsky/44
use_case: entry
status: active
```

Ссылка `/44` пока reference/placeholder. Внутренний `telegram_file_id` не задан, загрузка файла в Telegram не выполняется.

Запись `/16`:

```text
https://t.me/georgy_sokolovsky/16
status: draft
use_case: follow_up
```

не входит в message plan, не отправляется и не считается доступной пользователю.

### Как запускается delivery

После успешного `/start` Telegram flow:

1. создаёт `bonus_delivery_attempted`;
2. строит provider-neutral message plan;
3. при подключённом Telegram Bot API пытается отправить bonus;
4. при успешном ответе Telegram API создаёт `bonus_sent`;
5. при ошибке, timeout или отказе провайдера создаёт `bonus_delivery_failed`.

`bonus_sent` означает только успешный ответ Telegram API на отправку. Он не означает, что человек прочитал, открыл, прослушал или понял bonus.

В local fixture dev transport эмулирует принятие сообщения без сети. В тестах in-process fake Bot API принимает реальный HTTP payload. `bonus_sent` создаётся только после успешного нормализованного ответа transport.

### Итоговые bonus events

| Событие | Семантика | Условие |
|---|---|---|
| `bonus_delivery_attempted` | начата конкретная попытка доставки | до вызова provider |
| `bonus_sent` | provider подтвердил отправку | успешный ответ Telegram API |
| `bonus_delivery_failed` | конкретная попытка завершилась ошибкой | ошибка, timeout или отказ |
| `bonus_link_clicked` | пользователь нажал измеримую ссылку | только если клик можно безопасно измерить |
| `bonus_opened` | provider или link layer подтвердил открытие | только если появится надёжный сигнал |

Последние два события не создаются по предположению. Отсутствие измеримого клика или открытия не трактуется как отсутствие интереса.

### Доставка и идемпотентность

Payload delivery хранит:

```text
user_id
funnel_id
bonus_id
bonus_version
delivery_mode
attempt_number
provider_message_id: nullable
occurred_at
```

Каждая реальная попытка имеет свой idempotency key. Успешная отправка конкретной версии входного bonus не повторяется из-за повторной доставки webhook. Неуспешная попытка может быть повторена по правилу retry, но повтор не маскируется под первую попытку.

Текущий server использует подтверждённую модель `bonus_delivery_attempted` → `bonus_sent` или `bonus_delivery_failed`; прежнее событие `bonus_received` не используется.

## D. Warming sequence

Warming — ограниченная последовательность сообщений внутри Telegram flow одного funnel. Она не включает email automation и не превращается в SmartSender clone.

### Классы сообщений

Каждое сообщение получает `message_class`:

- `funnel_service` — выдача bonus, ссылка на webinar, техническое напоминание и сообщение по материалам этой программы;
- `promotional` — follow-up, который предлагает следующий коммерческий или консультационный шаг.

При входе пользователь заранее видит, что бот отправит bonus, ссылку на видеоразбор, напоминания и сообщения по материалам программы. Точная юридическая формулировка этого notice не утверждается сейчас.

### Поддерживаемые типы

1. **Bonus delivery** — выдача ссылки на входной bonus.
2. **Webinar invite** — кнопка для открытия `webinar_token`.
3. **Reminder** — напоминание о доступном шаге после задержки.
4. **Continue watching** — возврат к незавершённому просмотру.
5. **Behavior follow-up** — сообщение по порогу просмотра или клику.
6. **Application transition** — переход к application через `application_token`.
7. **Resume** — возврат к незавершённой application.
8. **Control message** — `/stop`, `/delete` и служебное подтверждение запроса.

Финальные продающие тексты, тональность и содержание сообщений не входят в эту техническую спецификацию.

### Первый сценарий v1 как рабочая гипотеза

```text
Telegram Start
  → bonus сразу

если webinar не начат
  → первое сообщение через 15 минут

если webinar всё ещё не начат
  → второе сообщение через 3 часа

если webinar_started, но просмотр остановился до 50%
  → сообщение «продолжить просмотр» через 6 часов отсутствия активности

если watched_75 или выше и application не отправлена
  → follow-up через 2 часа

если application_submitted
  → немедленно отменить все ожидающие sales/follow-up сообщения этой funnel
```

После успешной доставки bonus может быть подготовлено service-сообщение с webinar link. Его упаковка — отдельная content-задача; сама задержка первого reminder считается от подтверждённого доступного webinar step.

### Конфигурация вместо business logic

Все задержки, условия, лимиты повторов и cancellation rules хранятся в конфигурации:

```text
rule_id
funnel_id
trigger_event
delay_seconds
conditions
action_type
action_config
message_class
status
version
```

Business logic только читает правило, проверяет состояние пользователя и создаёт или отменяет scheduled message. Задержки нельзя зашивать непосредственно в обработчики событий.

Для первого сценария конфигурация должна выражать как минимум:

```text
after telegram_start:
  bonus delivery: 0 seconds

after webinar availability, if webinar_started absent:
  reminder_1: 900 seconds
  reminder_2: 10800 seconds

after webinar_started, if max_progress < 50 and inactive:
  continue_watching: 21600 seconds

after watched_75 or watched_90, if application_submitted absent:
  follow_up: 7200 seconds

after application_submitted:
  cancel pending sales/follow-up messages: immediately
```

При каждом новом событии scheduler повторно проверяет условия. Если пользователь уже перешёл дальше, pending message отменяется или не отправляется.

### Техническая модель сообщений

Шаблон хранит:

```text
template_id
funnel_id
name
role
message_class
text
buttons
status
version
```

Запланированное сообщение хранит:

```text
user_id
funnel_id
message_template_id
message_class
scheduled_at
status: pending | sent | cancelled | failed
cancellation_key
attempts
```

Ожидающие promotional и follow-up сообщения этой funnel отменяются после `application_submitted` и после `/stop`.

## E. Webinar

### Два purpose-bound token

В v1 используются два разных signed token.

#### `webinar_token`

Разрешает:

- открыть конкретный webinar;
- идентифицировать пользователя на server;
- записывать события этого webinar.

Минимальный payload по смыслу:

```json
{
  "purpose": "webinar",
  "funnel_id": "men_webinar_v1",
  "user_ref": "opaque-internal-user-reference",
  "issued_at": 0,
  "expires_at": 0
}
```

#### `application_token`

Разрешает:

- открыть application;
- идентифицировать пользователя на server;
- создать или продолжить application этого funnel.

Минимальный payload по смыслу:

```json
{
  "purpose": "application",
  "funnel_id": "men_webinar_v1",
  "user_ref": "opaque-internal-user-reference",
  "issued_at": 0,
  "expires_at": 0
}
```

Webinar token не принимается application endpoint автоматически. Application token не открывает webinar endpoint.

Каждый token подписывается server secret, имеет TTL и проверяется по purpose, funnel, user reference, issued time и expiry. Telegram ID открытым текстом в URL не передаётся. Полноценная authentication system сейчас не строится.

### Создание и передача token

1. После подтверждённого Telegram Start и доступного webinar server подготавливает `webinar_token`.
2. Telegram invite содержит ссылку с webinar token или ссылку на endpoint, который выдаёт такой URL в рамках разрешённого flow.
3. После webinar CTA server создаёт отдельный `application_token`.
4. Follow-up к application использует только application token.
5. Raw token не попадает в логи, CRM timeline или analytics.

Текущая реализация выдаёт отдельные HMAC token с purpose `webinar` и `application`. Webinar token не принимается application endpoint, application token не открывает webinar session.

### Lab webinar

До передачи реального материала используется:

```text
webinar_id: lab-men-funnel-video-fixture
video_provider: lab
video_url: null
status: draft
```

Lab URL может выглядеть так:

```text
lab://men-funnel/video/lab-men-funnel-video-fixture?t=<webinar_token>
```

Это fixture и не доказательство работы реального видеопровайдера.

Base URL для local/test HTTP-проверки задаётся через `WEBINAR_BASE_URL`. Если он не задан, сохраняется `lab://` reference. Production URL не установлен; полная signed URL не логируется.

### Проверка доступа

Server проверяет:

1. структуру token;
2. подпись;
3. `purpose=webinar`;
4. срок действия;
5. наличие пользователя;
6. совпадение `user.funnel_id` и `token.funnel_id`.

Невалидный или истёкший webinar token не открывает webinar и не позволяет записывать webinar events.

### Возврат пользователя на сайт

Telegram button открывает signed URL. На funnel-странице:

- token читается из query только на клиенте;
- token отправляется на server по HTTPS;
- server возвращает конфигурацию webinar;
- клиент показывает lab player или placeholder;
- после CTA server выдаёт application token;
- application открывается с новым purpose-bound token.

Token не выводится в интерфейсе и не включается в аналитику.

### Webinar events

| Событие | Когда фиксируется | Правило |
|---|---|---|
| `webinar_page_view` | доступ к webinar page подтверждён | не означает начало просмотра |
| `webinar_started` | player начал воспроизведение | один раз на context или session |
| `watched_25` | достигнут порог 25% | фиксируется один раз |
| `watched_50` | достигнут порог 50% | фиксируется один раз |
| `watched_75` | достигнут порог 75% | фиксируется один раз |
| `watched_90` | достигнут порог 90% | фиксируется один раз |
| `webinar_completed` | player сообщил завершение | не подменяется одним `watched_90` |
| `cta_clicked` | нажата CTA webinar | `placement=webinar` и идентификатор CTA |

Допустимые технические metadata — `video_id`, `placement`, `source_article_slug`, `threshold`. Event на server также связан с `user_id` и `funnel_id`.

Каждое событие получает idempotency key. Повторная отправка возвращает duplicate и не меняет timeline.

## F. Follow-up и Telegram automation

Automation реагирует только на события этого funnel и этого пользователя.

| Триггер | Условие | Задержка | Действие |
|---|---|---:|---|
| `telegram_start` | entry processing начат | 0 | bonus delivery |
| webinar available | `webinar_started` отсутствует | 15 минут | первое service reminder |
| первое reminder | `webinar_started` всё ещё отсутствует | 3 часа от того же базового события sequence | второе service reminder |
| `webinar_started` | `max_progress < 50`, нет активности | 6 часов | continue watching |
| `watched_75` или `watched_90` | `application_submitted` отсутствует | 2 часа | follow-up |
| `application_submitted` | заявка принята | 0 | отменить pending sales/follow-up |
| `/stop` | запрос пользователя | 0 | отменить promotional/follow-up |
| `/delete` | запрос пользователя | 0 | создать deletion request |

Числа хранятся в automation config и меняются без переписывания business logic. Оба напоминания считаются от одного базового события sequence; второе не сдвигается на 3 часа после первого. Сценарий — рабочая гипотеза MVP; корректировка возможна после реальной статистики.

### Lifecycle / Reactivation — будущий этап

Lifecycle executor должен работать поверх сохранённых событий и текущего lead status, а не создавать параллельную историю. В его будущую область входят пользователи, которые:

- получили bonus, но не открыли webinar;
- начали webinar, но не досмотрели;
- досмотрели webinar, но не перешли к CTA;
- перешли к CTA, но не отправили application;
- отправили application, но не дошли до разбора;
- прошли разбор, но не купили;
- давно находятся в базе без активности.

Для каждой группы до реализации должны быть заданы qualifying event, отсутствующее target event, минимальный период неактивности, лимит сообщений, канал, message class и exit condition. Повторный вход в один lifecycle step защищается стабильным idempotency key; факт отправки подтверждается provider receipt и delivery event.

Перед каждым warming или reactivation send executor заново проверяет suppression state. Автоматически исключаются покупатели, `telegram_stop`, deletion requested/processing/completed, недоступный Telegram channel и любые будущие legal/compliance запреты. Отмена имеет приоритет над уже поставленной задачей.

На текущем этапе Lifecycle / Reactivation остаётся только архитектурным требованием. Scheduler, warming executor и reactivation messages не реализуются и не запускаются. Ручной delivery recovery обслуживает только уже созданные операции входной цепочки и не создаёт lifecycle-сообщения.

## G. Application

### Переход к заявке

Пользователь переходит к application:

- из webinar CTA;
- или из Telegram follow-up по действующему `application_token`.

До этого перехода система не требует email, телефон, регистрацию, аккаунт или пароль.

`webinar_token` не принимается вместо `application_token`. При открытии формы фиксируется `application_started`; это не означает отправку данных.

### Поля application v1

В базовой первой версии пользователь вводит только:

| Поле | Обязательность | Смысл |
|---|---|---|
| `name` | обязательно | имя для ответа на заявку |
| `situation` | обязательно | краткое описание текущей ситуации |

Telegram user уже известен системе. Поле Telegram username повторно не запрашивается.

Не запрашиваются специально:

- email;
- адрес;
- документы;
- финансовые данные;
- медицинские диагнозы;
- данные детей;
- интимные подробности;
- другие чувствительные сведения, не нужные для принятия заявки.

Рядом с `situation` должно быть нейтральное уведомление: не указывать ненужные персональные данные третьих лиц.

Дополнительные поля позже добавляются конфигурацией allowlist, а не переписыванием application logic. До отдельного подтверждения они не входят в baseline UI и server contract.

### Проверка и отправка

Server:

1. проверяет `application_token`;
2. проверяет `purpose=application` и `funnel_id=men_webinar_v1`;
3. принимает только поля из allowlist;
4. ограничивает длину `name` и `situation` разумным конфигурационным пределом;
5. проверяет, что `situation` не пустое;
6. показывает или сохраняет версию notice о нежелательных персональных данных;
7. получает отдельное подтверждение обработки данных в форме, когда будет утверждён legal text;
8. создаёт одну application со статусом `submitted`;
9. создаёт событие `application_submitted`;
10. передаёт запись в локальный CRM view.

Повторная отправка с тем же idempotency key возвращает исходную application и не создаёт дубликат.

Финальный юридический текст согласия, lawful basis и набор обязательных чекбоксов не придумываются этим документом.

## H. CRM view

В первой версии CRM — локальная история lead, доступная только через защищённый lab admin endpoint. Это read model (сводное представление), а не universal CRM и не внешняя интеграция.

### История одного пользователя

```text
Lead
├── internal user_id
├── funnel_id = men_webinar_v1
├── lead_status
├── Telegram identity
│   ├── telegram_user_id
│   ├── first_name
│   ├── username
│   └── language_code
├── Attribution
│   ├── first_touch
│   ├── funnel_entry_touch
│   ├── traffic source
│   ├── article_slug: nullable
│   ├── source_id
│   ├── start_parameter
│   └── funnel_id
├── Entry notice/request
│   ├── consent_or_request_version
│   ├── timestamp
│   ├── source
│   └── funnel_id
├── Bonus delivery
│   ├── bonus_id
│   ├── bonus_version
│   ├── delivery attempts
│   ├── sent/failed status
│   └── provider message ID, если доступен
├── Webinar
│   ├── webinar_id
│   ├── webinar token events
│   ├── progress events
│   └── CTA events
├── Application
│   ├── application_id
│   ├── submitted_at
│   ├── answers: name, situation
│   └── legal/consent metadata, если утверждено
├── Automation
│   ├── scheduled messages
│   ├── sent messages
│   ├── cancelled messages
│   └── failed messages
└── Timeline
    └── ordered events with metadata and idempotency keys
```

### Lead status

```text
telegram_lead
→ warming
→ webinar_started
→ webinar_engaged
→ application_started
→ application_submitted
```

После application остаются отдельные CRM-статусы `contacted`, `consultation_booked`, `consultation_completed`, `sold` и `lost`, но их автоматизация в v1 не строится.

### Служебные token данные

CRM видит purpose, issued/expiry timestamps и связанные event IDs, но не хранит raw `webinar_token` или `application_token`.

## I. Итоговая attribution model

### Канонический путь

```text
traffic source
  → optional article
  → first_touch
  → funnel_entry_touch
  → funnel_id
  → start_parameter
  → telegram_user_id
  → user_id
  → webinar events
  → application
```

Для пользователя и funnel:

- `first_touch` — первый подтверждённый источник, immutable;
- `funnel_entry_touch` — первый подтверждённый вход в `men_webinar_v1`;
- `article_slug` — nullable;
- `funnel_id` — обязательный downstream key;
- повторные touchpoints — отдельные события без multi-touch scoring.

### Поля по этапам

| Этап | Канонические поля | Где связывается |
|---|---|---|
| Traffic source | `source`, `medium`, `campaign`, `content` | `traffic_sources` |
| Article | `article_slug: nullable`, article/content key | `traffic_sources` |
| First touch | source snapshot и timestamp | user attribution |
| Funnel entry touch | source snapshot и timestamp для funnel | funnel membership/lead |
| Funnel | `funnel_id`, `config_version` | `funnels`, все downstream records |
| Telegram | `start_parameter`, `telegram_user_id` | `telegram_users`, `events` |
| Bonus | `bonus_id`, `bonus_version`, delivery status | `bonuses`, delivery events |
| Webinar | `webinar_id`, `video_id`, progress events | `webinars`, `events` |
| Application | `application_id`, `user_id`, `funnel_id` | `applications` |

Ни один этап не должен переопределять `first_touch`, подменять `funnel_entry_touch` задним числом или связывать bonus напрямую со статьёй.

## J. Итоговая event model

### Identity and entry

| Событие | Кто/что создаёт | Обязательный контекст |
|---|---|---|
| `telegram_start` | Telegram webhook | `telegram_user_id`, `source_id`, `funnel_id`, `start_parameter` |
| `funnel_entry_notice_presented` | transport подтвердил отправку entry notice | `consent_or_request_version`, timestamp, source, `funnel_id` |
| `telegram_stop` | команда `/stop` | `telegram_user_id`, `funnel_id`, timestamp |
| `data_deletion_requested` | команда `/delete` или эквивалент | `telegram_user_id`, `funnel_id`, timestamp |

### Bonus delivery

| Событие | Смысл |
|---|---|
| `bonus_delivery_attempted` | начата попытка отправки конкретного bonus |
| `bonus_sent` | Telegram API успешно подтвердил отправку |
| `bonus_delivery_failed` | попытка завершилась ошибкой или timeout |
| `bonus_link_clicked` | измерен клик по bonus-ссылке |
| `bonus_opened` | измерено открытие, если появится надёжный сигнал |

`bonus_sent` не доказывает прочтение или прослушивание. Последние два события не создаются без измеримого сигнала.

### Webinar invite delivery

| Событие | Смысл |
|---|---|
| `webinar_invite_delivery_attempted` | начата попытка отправки invite с purpose `webinar` |
| `webinar_invite_sent` | transport подтвердил отправку invite |
| `webinar_invite_delivery_failed` | попытка завершилась ошибкой, timeout или отказом provider |

Создание signed webinar token не означает доставку. Raw token и полная signed URL в metadata событий не сохраняются.

### Webinar and application

| Событие | Token/purpose | Условие |
|---|---|---|
| `webinar_page_view` | `webinar` | server подтвердил доступ к странице |
| `webinar_started` | `webinar` | player начал воспроизведение |
| `watched_25` | `webinar` | достигнут порог 25% |
| `watched_50` | `webinar` | достигнут порог 50% |
| `watched_75` | `webinar` | достигнут порог 75% |
| `watched_90` | `webinar` | достигнут порог 90% |
| `webinar_completed` | `webinar` | player сообщил завершение |
| `cta_clicked` | `webinar` | нажата CTA с `placement=webinar` |
| `application_started` | `application` | открыта application form |
| `application_submitted` | `application` | заявка прошла валидацию и сохранена |

Все events имеют `occurred_at`, `funnel_id`, внутреннюю связь с пользователем и idempotency key. Raw tokens в events не сохраняются.

### Состояние, а не событие

Следующие данные хранятся как состояние или конфигурация:

- `first_touch`;
- `funnel_entry_touch`;
- `consent_or_request_version` и timestamp;
- текущий lead status;
- bonus delivery status;
- retention policy;
- subscription/stop state.

## K. Privacy, consent, retention, unsubscribe и deletion

### Что сохраняется

| Этап | Допустимые данные |
|---|---|
| Article / landing | source mapping, optional article slug, funnel ID, технический context текущего перехода |
| До `/start` | только короткоживущий strictly necessary session при технической необходимости; постоянный профиль не создаётся |
| Telegram Start | `telegram_user_id`, Telegram profile fields, first/funnel entry attribution, timestamps, entry notice/request record |
| Bonus | bonus ID/version, попытка, sent/failed status, template ID/version, provider message ID после реального подключения |
| Warming | rule/template IDs, schedule status, message class, delivery result |
| Webinar | webinar/video IDs, purpose-bound access events, progress thresholds, CTA events |
| Application | только на этом этапе: `name`, `situation`, application status и утверждённые consent metadata |
| CRM view | производный status и timeline с контролем доступа |

### Что не должно собираться

- email до application;
- телефон до application;
- email automation;
- регистрация, пароль и аккаунт;
- повторный запрос Telegram username для идентификации;
- адрес, документы и финансовые данные;
- медицинские диагнозы;
- данные детей;
- ненужные интимные подробности;
- данные третьих лиц, не нужные для принятия заявки;
- Telegram bot token;
- signing secret, webhook secret и admin secret;
- raw `webinar_token` или `application_token` в логах, CRM и analytics;
- raw Telegram update целиком;
- fingerprinting и долгоживущий tracking identifier;
- контакты устройства и данные адресной книги;
- платёжные данные;
- данные пользователей других funnel или EXPERTS-направления;
- сторонние analytics/cookies публичного сайта.

IP-адрес, user-agent и иные сетевые данные не сохраняются в CRM timeline без отдельного обоснования и подтверждённой политики хранения.

### `/stop`

`/stop` прекращает дальнейшие promotional и follow-up сообщения. Он не удаляет историю автоматически и не отменяет обязательные технические ответы на уже созданный запрос, если такие ответы потребуются для обработки deletion request.

### `/delete`

`/delete` или равнозначная команда создаёт запрос на удаление. После проверки retention policy данные:

- удаляются, если они больше не нужны для заявленной цели;
- или анонимизируются, если обезличенная агрегированная запись нужна для технической статистики.

Запрос не требует email, телефона, аккаунта или пароля.

### Configurable retention policy

Retention не зашивается глубоко в business logic. Для MVP/dev разрешены предварительные технические значения:

```text
inactive funnel event data: 90 days
application without further relationship: 12 months
```

Это не окончательная юридическая политика. До production сроки должны быть отдельно подтверждены. После истечения retention данные удаляются или анонимизируются по назначению записи.

## L. MVP boundaries

### Входит в первую версию

- одна изолированная конфигурация `men_webinar_v1`;
- source mapping `Traffic Source → optional Article → Funnel`;
- immutable `first_touch` и отдельный `funnel_entry_touch`;
- nullable `article_slug` и прямые source types;
- отсутствие постоянного anonymous tracking до `/start`;
- один активный входной bonus `/44` как link reference/placeholder;
- `/16` в `draft/inactive` без выдачи;
- `@sokolovskyi_men_bot` как конфигурационный username без token;
- Telegram Start с валидацией start parameter и идемпотентностью;
- `telegram_user_id` как основной идентификатор после `/start`;
- entry notice/request record с версией, timestamp, source и funnel ID;
- события `bonus_delivery_attempted`, `bonus_sent`, `bonus_delivery_failed`;
- события `webinar_invite_delivery_attempted`, `webinar_invite_sent`, `webinar_invite_delivery_failed`;
- provider-neutral entry notice/bonus/webinar message plan;
- dev transport по умолчанию, Telegram Bot API adapter и fail-closed staging configuration без сохранённых credentials;
- configurable `WEBINAR_BASE_URL` с `lab://` fallback;
- классы сообщений `funnel_service` и `promotional`;
- конфигурируемые warming rules с гипотезой 0 / 15 минут / 3 часа / 6 часов / 2 часа;
- `/stop` и `/delete` request path;
- configurable retention policy с предварительными dev-значениями;
- два purpose-bound token: `webinar_token` и `application_token`;
- lab webinar fixture и viewing events;
- application только с обязательными `name` и `situation`;
- нейтральное предупреждение о персональных данных третьих лиц;
- минимальный локальный CRM view с двумя attribution-полями и timeline;
- in-memory storage как safe-default lab implementation;
- PostgreSQL store для users, attribution, Telegram updates, events, applications и deletion requests;
- database-level duplicate `update_id` protection, сохраняющаяся после restart.

### Сознательно откладывается

- изменения публичного Astro-сайта, SEO-статей и навигации;
- подключение funnel к production и реальному домену;
- фактическая staging-активация Telegram Bot API, webhook registration и реальная отправка до credentialed acceptance test;
- реальный видеоматериал и production video provider;
- финальные тексты webinar, bonus и warming;
- полный SmartSender clone;
- visual funnel builder;
- universal CRM и внешняя CRM-интеграция;
- email automation;
- payment system;
- аккаунты, пароли и регистрация;
- бонусы, привязанные к конкретным статьям;
- публикация и интеграция `/16`;
- analytics/cookies и изменение legal pages;
- DNS, hosting, deploy и production secrets;
- автоматические CRM-статусы после отправки заявки;
- scheduler, warming executor и Lifecycle / Reactivation executor;
- полноценная multi-touch attribution;
- сложная authentication system.

## 4. Что всё ещё требует внешнего подтверждения

Эти вопросы нельзя окончательно решить только по текущей архитектуре.

### Нужен реальный контент webinar

- окончательный title, promise и описание webinar;
- длительность и формат видео;
- реальный provider, URL/route и правила возврата на сайт;
- техническая возможность измерять 25/50/75/90% и `webinar_completed`;
- финальный текст CTA к application;
- правила, по которым follow-up отличается для разных уровней просмотра.

### Нужен отдельный legal review

- окончательный текст entry notice/request;
- правовая квалификация `funnel_service` и `promotional` сообщений;
- lawful basis и формулировка consent на application;
- финальные сроки retention для event data и application;
- порядок обработки `/delete`, сроки ответа и границы анонимизации;
- нужно ли в будущем собирать дополнительные поля и на каком основании.

### Нужны отдельные production-решения

- активировать ли Telegram Bot API adapter и когда передавать token;
- способ размещения webhook и защита endpoint;
- production host для funnel routes;
- внешний CRM destination, если локального CRM view станет недостаточно;
- финальная структура direct source mappings и campaign registry.

До получения реального webinar-контента и legal-подтверждения эти пункты не блокируют lab-спецификацию, но блокируют production-подключение.

## 5. Контрольные критерии готовности спецификации

Документ считается обновлённым, если в нём одновременно зафиксированы:

- `first_touch` как immutable и `funnel_entry_touch` как отдельная запись;
- optional `article_slug` и direct entry без зависимости от Article;
- отсутствие постоянного anonymous tracking до `/start`;
- `telegram_user_id` как основной идентификатор после `/start`;
- `bonus_delivery_attempted`, `bonus_sent`, `bonus_delivery_failed` вместо предположения о прочтении;
- `webinar_invite_delivery_attempted`, `webinar_invite_sent`, `webinar_invite_delivery_failed` без подмены факта доставки фактом создания token;
- dev transport по умолчанию, Bot API-compatible adapter без live-активации и configurable `WEBINAR_BASE_URL`;
- два purpose-bound token с разными полномочиями;
- только `name` и `situation` как baseline application fields;
- config-driven warming и заданные MVP-задержки;
- классы `funnel_service` и `promotional`;
- `/stop`, `/delete` и configurable retention;
- разделение lab-архитектуры и production/legal решений.

Код, frontend, backend, tests, dependencies, публичный Astro-сайт и production в рамках подготовки этой версии документа не изменяются.
