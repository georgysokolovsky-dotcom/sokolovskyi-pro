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
- `server/src/webinar/` — token-protected page, native/HLS.js adapters, local media fixture и Mux signed-playback provider;
- `server/src/security/signed-tokens.mjs` — текущий HMAC token с TTL 1 час;
- `server/src/store/memory-store.mjs` — in-memory хранилище для lab;
- `server/src/store/postgres-store.mjs` — persistent implementation того же store contract;
- `server/migrations/001_core.sql` — initial PostgreSQL schema с Telegram update state и database-level idempotency;
- `server/migrations/002_delivery_operations.sql` — persistent delivery operations, lease и recovery state machine;
- `server/migrations/003_delivery_dependencies.sql` — порядок зависимых шагов delivery после restart;
- `server/migrations/004_warming_scheduler.sql` — persistent warming fields, scheduler lease, cancellation и per-entry uniqueness;
- `server/migrations/005_webinar_progress.sql` — first-party player sessions, idempotent telemetry requests и watched ranges;
- `server/tests/vertical-slice.test.mjs` — проверка пути от Telegram Start до application.

В server реализован Telegram Bot API-compatible transport с внедряемыми `fetch`, base URL и timeout. По умолчанию server использует dev/mock transport без сети. Настоящий bot token и production webhook не подключены; webhook secret и signing secret в репозитории не хранятся. Для обычных тестов подключён local media fixture; отдельный opt-in staging test использует signed Mux asset.

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
- `token.purpose` — назначение signed token: `webinar`, технический `media` или `application`.

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
- после проверки страницы server выдаёт короткоживущий `media_token` для конкретного video source;
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

Для обычного `/start` без payload используется direct source mapping:

```text
source: direct
medium: direct
campaign: men_webinar
content: telegram_start
articleSlug: null
startParameter: direct_men_webinar
funnelId: men_webinar_v1
```

Это внутренний ключ source registry: пользователь не обязан передавать его в Telegram-команде.

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

В lab-версии проверяются параметризованный вход `article_wife_cheating` и обычный `/start` через direct source mapping.

## B. Telegram Start

### Что получает система

Telegram webhook принимает update только после проверки `TELEGRAM_WEBHOOK_SECRET`. Из update используются:

- `update_id` — ключ идемпотентности;
- `message.from.id` — `telegram_user_id`;
- `message.from.first_name`;
- `message.from.username`;
- `message.from.language_code`;
- текст `/start` или `/start <start_parameter>`.

Сырые Telegram update и лишние поля не сохраняются.

### Что сохраняется

При обычном `/start` используется direct mapping, при `/start <start_parameter>` — валидный ключ из source registry. После разрешения source система:

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
Пустой payload выбирает direct mapping; неизвестный непустой параметр по-прежнему отклоняется. Для уже существующего пользователя `first_touch` и `funnel_entry_touch` сохраняют исходный вход.

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

если watched_75 и application не отправлена
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

after watched_75, if application_submitted absent:
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

Запланированное сообщение расширяет ту же `delivery_operations`, а не создаёт параллельную очередь. Оно хранит:

```text
user_id
funnel_id
warming_rule_id
message_template_id/version в safe descriptor
message_class
scheduled_for
earliest_execution_at
status: scheduled | scheduler_processing | pending | processing | delivered | cancelled | suppressed | retryable_failed | dead_letter | delivery_unknown
cancellation_reason
depends_on_operation_id
attempts
executed_at
```

Один rule/version может быть запланирован для одного funnel entry только один раз. На один entry разрешено не более четырёх warming operations. Promotional limit — не более двух подтверждённых deliveries за rolling 7 days. К timing добавляется конфигурируемый jitter 0–60 секунд.

Cancellation определяется по rule:

- reminders 15m/3h отменяются после `webinar_started` или любого последующего progress;
- continue watching отсчитывает 6 часов от последней активности ниже 50% и отменяется после 50%+ или `webinar_completed`;
- application follow-up отменяется после `cta_clicked`, `application_started` или `application_submitted`;
- `/stop`, deletion request и `sold` suppress все ожидающие warming operations без transport call.

Scheduler запускается только вручную. Он атомарно claims due operation, перепроверяет rule, events, dependency, limits и suppression, затем передаёт operation recovery layer. После crash обычный recovery снова проверяет cancellation перед send. `dead_letter` и `delivery_unknown` не возвращаются в scheduler автоматически.

`application_follow_up_2h` имеет один достаточный trigger `watched_75`; `watched_90` не требуется для scheduling.

## E. Webinar

### Purpose-bound token

В v1 используются два пользовательских access token и один внутренний playback token.

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

#### `media_token`

Разрешает только получить конкретный playback source после уже подтверждённого webinar access:

```json
{
  "purpose": "media",
  "funnel_id": "men_webinar_v1",
  "user_ref": "opaque-internal-user-reference",
  "video_id": "lab-men-funnel-video-fixture",
  "issued_at": 0,
  "expires_at": 0
}
```

Он HMAC-signed, привязан к user/funnel/video, не хранится в PostgreSQL и не принимается webinar, telemetry или application endpoints. Default TTL равен большему из 15 минут и video duration плюс 10 минут. Повторное открытие действующей webinar-ссылки выпускает новый media token.

Каждый token подписывается server secret, имеет TTL и проверяется по purpose, funnel, user reference, issued time и expiry. Telegram ID открытым текстом в URL не передаётся. Полноценная authentication system сейчас не строится.

### Создание и передача token

1. После подтверждённого Telegram Start и доступного webinar server подготавливает `webinar_token`.
2. Telegram invite содержит ссылку с webinar token или ссылку на endpoint, который выдаёт такой URL в рамках разрешённого flow.
3. После проверки webinar page server выпускает отдельный `media_token` и встраивает защищённый playback URL.
4. После webinar CTA server создаёт отдельный `application_token`.
5. Follow-up к application использует только application token.
6. Raw token не попадает в логи, CRM timeline или analytics.

Текущая реализация выдаёт отдельные HMAC token с purpose `webinar`, `media` и `application`. Ни один purpose не заменяет другой.

### Lab webinar

До передачи реального материала используется:

```text
webinar_id: lab-men-funnel-video-fixture
video_provider: native-html5
video_url: internal local fixture reference
duration_seconds: 40
status: active
```

Lab URL может выглядеть так:

```text
<WEBINAR_BASE_URL>/lab-men-funnel-video-fixture?t=<webinar_token>
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

- token из query проверяется server-side до отдачи player page;
- server проверяет signature, expiration, `purpose=webinar`, funnel и persistent user;
- valid token можно использовать повторно до истечения;
- клиент показывает provider-neutral native player adapter;
- после CTA server выдаёт application token;
- application открывается с новым purpose-bound token.

Token не выводится в интерфейсе и не включается в аналитику.

### Media authorization и Range

Webinar page не получает публичный MP4 URL. После валидного `webinar_token` server создаёт короткоживущий media URL вида `/v1/webinar/media/:videoId?mt=<media_token>`. Media endpoint fail closed проверяет signature, `purpose=media`, expiry, persistent user, funnel, `video_id`, active webinar и соответствие URL path конфигурации. Webinar/application token и media token другого video/funnel отклоняются.

Local MP4 читается через file stream, а не копируется целиком в память на каждый request. Поддержаны `200`, `HEAD`, одиночные byte ranges, `206`, suffix/open-ended range и `416`. Ответы имеют точные `Content-Length`/`Content-Range`, `Accept-Ranges: bytes`, MIME `video/mp4`, private cache, `Referrer-Policy: no-referrer` и `X-Content-Type-Options: nosniff`. Page, media, telemetry и CTA работают same-origin; wildcard CORS для webinar surface не используется.

### Mux signed playback

`WEBINAR_MEDIA_PROVIDER=local|mux` задаёт server-side provider; `local` — default. Mux mode без signing key ID, private key или signed Playback ID не запускается. Private key принимается как raw PEM, PEM с escaped newline или base64 PEM и существует только в памяти процесса.

После проверки MEN `webinar_token` provider создаёт RS256 JWT. Header содержит `alg=RS256` и `kid`; payload содержит только `sub=<MUX_PLAYBACK_ID>`, `aud=v`, `exp`. HLS URL имеет вид `https://stream.mux.com/{PLAYBACK_ID}.m3u8?token={JWT}`. Application/expired/wrong-purpose MEN token не запускает выдачу Mux JWT. Refresh страницы может получить новый playback JWT, но не создаёт повторный `webinar_page_view`.

Срок Mux JWT равен большему из configured TTL и webinar duration плюс safety buffer. Signing key, environment values и полный signed URL не логируются и не сохраняются в PostgreSQL. Mux API token не используется: asset lifecycle, upload и webhook находятся вне этого slice.

### Video provider adapter boundary

Native и HLS.js browser adapters:

- получить только разрешённый playback source от server;
- создать native или provider player;
- сообщать play, pause, seek, heartbeat/timeupdate и ended;
- отдавать currentTime, duration, paused и ended;
- не создавать funnel milestones самостоятельно.

Server provider отвечает только за разрешённый playback source и provider access. Server-side progress engine не зависит от provider: он принимает ограниченную telemetry, объединяет watched ranges в PostgreSQL и сам создаёт milestones. HLS.js поставляется same-origin; Mux Player, Mux Data и внешняя analytics не подключены. CSP разрешает Mux Video delivery origins без широкого `https:` wildcard.

### Webinar events

| Событие | Когда фиксируется | Правило |
|---|---|---|
| `webinar_page_view` | доступ к webinar page подтверждён | не означает начало просмотра |
| `webinar_started` | server принял первый `play` | один раз на funnel entry |
| `watched_25` | достигнут порог 25% | фиксируется один раз |
| `watched_50` | достигнут порог 50% | фиксируется один раз |
| `watched_75` | достигнут порог 75% | фиксируется один раз |
| `watched_90` | достигнут порог 90% | фиксируется один раз |
| `watched_100` | server-derived progress достиг 100% | фиксируется один раз |
| `webinar_completed` | server-derived progress достиг 100% | compatibility event текущей event model |
| `cta_clicked` | нажата CTA webinar | `placement=webinar` и идентификатор CTA |

Допустимые технические metadata — `video_id`, `placement`, `threshold`, `watched_seconds`, `progress_percent`. `user_id` и `funnel_id` server берёт только из signed token и persistent user.

Каждый milestone имеет стабильный idempotency key на user/webinar. Каждый browser request имеет отдельный UUID. Refresh, overlap вкладок и повтор request не дублируют event.

### Server-side progress semantics

Player передаёт только `play`, `heartbeat`, `pause`, `seek`, `ended`, playhead и duration. Server хранит последнюю позицию и server timestamp каждой вкладки. Участок засчитывается, если player был в состоянии play, playhead сдвинулся вперёд и его шаг не превышает server elapsed time с tolerance 2 секунды и gap limit 15 секунд.

`seek` не добавляет watched time и только задаёт новую baseline. `pause` закрывает допустимый участок; heartbeat после pause не возобновляет play. Resume начинается с нового `play`. Общий progress — union уникальных watched ranges всех sessions, поэтому повторный просмотр и две вкладки не завышают результат.

Для HLS событие `play` иногда приходит после первых долей секунды. Поэтому подтверждённый `ended` нормализует progress до 100% только при трёх server-side условиях: последний участок принят как допустимый, playhead находится в пределах 0,5 секунды от configured duration, а union watched ranges уже покрывает минимум 95%. Seek к концу без почти полного просмотра не создаёт `watched_100`.

### Browser E2E

Отдельный Playwright test запускает установленный Google Chrome, MEN server с fake Telegram transport и уникальную PostgreSQL schema. В настоящем HTML5 player он проверяет загрузку защищённого MP4, полный просмотр до completion, Range responses, refresh, две вкладки, seek protection, scheduler transitions, CTA, application token и переход в application flow. Негативный browser-сценарий проверяет отсутствие/expiry/wrong purpose webinar token и отсутствие/expiry/wrong purpose/wrong video/wrong funnel media token. Критический E2E не skipped и не обращается к analytics или Telegram.

Тот же сценарий допускает временный HTTPS-origin через Cloudflare Quick Tunnel. URL передаётся только process environment, не записывается в repository и удаляется остановкой tunnel. Permanent tunnel, DNS record и Cloudflare zone configuration не создаются.

Отдельный `test:mux-staging` использует ignored environment, реальный signed staging asset, PostgreSQL и Google Chrome. Он подтверждает HLS playback, server-derived milestones, persistence/restart, CTA/application и отрицательные Mux JWT cases. Обычные unit/PostgreSQL/local browser suites не обращаются к Mux или интернету.

## F. Follow-up и Telegram automation

Automation реагирует только на события этого funnel и этого пользователя.

| Триггер | Условие | Задержка | Действие |
|---|---|---:|---|
| `telegram_start` | entry processing начат | 0 | bonus delivery |
| webinar available | `webinar_started` отсутствует | 15 минут | первое service reminder |
| первое reminder | `webinar_started` всё ещё отсутствует | 3 часа от того же базового события sequence | второе service reminder |
| `webinar_started` | `max_progress < 50`, нет активности | 6 часов | continue watching |
| `watched_75` | `application_submitted` отсутствует | 2 часа | follow-up |
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

На текущем этапе Lifecycle / Reactivation остаётся только архитектурным требованием. Ручной warming scheduler обслуживает только индивидуальные operations текущего funnel entry. Automatic runner, массовый warming и reactivation messages не реализованы.

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

CRM видит purpose, issued/expiry timestamps и связанные event IDs, но не хранит raw `webinar_token`, `media_token` или `application_token`.

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
| `watched_100` | `webinar` | server-derived progress достиг 100% |
| `webinar_completed` | `webinar` | server-derived progress достиг 100% |
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
| Webinar | webinar/video IDs, purpose-bound access events, first-party player sessions, watched ranges, progress thresholds, CTA events |
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
- raw `webinar_token`, `media_token` или `application_token` в логах, CRM и analytics;
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
- три purpose-bound token: `webinar_token`, short-lived `media_token` и `application_token`;
- token-protected lab webinar page, protected Range-streamed local media fixture, native player adapter и server-derived viewing events;
- Playwright/Chrome E2E с отдельной PostgreSQL schema для real playback, scheduler, CTA, refresh, tabs и негативных token/seek cases;
- application только с обязательными `name` и `situation`;
- нейтральное предупреждение о персональных данных третьих лиц;
- минимальный локальный CRM view с двумя attribution-полями и timeline;
- in-memory storage как safe-default lab implementation;
- PostgreSQL store для users, attribution, Telegram updates, events, applications и deletion requests;
- database-level duplicate `update_id` protection, сохраняющаяся после restart.
- persistent per-user warming operations, manual scheduler, jitter, cancellation, limits и recovery compatibility.

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
- automatic scheduler runner, массовый warming и Lifecycle / Reactivation executor;
- полноценная multi-touch attribution;
- сложная authentication system.

## 4. Что всё ещё требует внешнего подтверждения

Эти вопросы нельзя окончательно решить только по текущей архитектуре.

### Нужен реальный контент webinar

- окончательный title, promise и описание webinar;
- длительность и формат видео;
- реальный provider, URL/route и правила возврата на сайт;
- способ получить у provider разрешённый playback source и player events, совместимые с существующим adapter;
- финальный текст CTA к application;
- правила, по которым follow-up отличается для разных уровней просмотра.

### Нужен отдельный legal review

- окончательный текст entry notice/request;
- правовая квалификация `funnel_service` и `promotional` сообщений;
- lawful basis и формулировка consent на application;
- финальные сроки retention для event data и application;
- порядок обработки `/delete`, сроки ответа и границы анонимизации;
- нужно ли в будущем собирать дополнительные поля и на каком основании.

### Production hardening: кодовый контракт

Production profile требует PostgreSQL, официальный Telegram Bot API и WebinarStars; default исходящие отправки, provider sync и follow-up выключены. Первый canary использует отдельный allowlisted Telegram ID, подтверждённый вне staging. Admin/test routes закрыты. Application требует явных HTTPS origin, privacy URL, consent version и отдельно утверждённого consent text. Для webinar 31195 daily resolver выбирает 19:00 Europe/Kiev на сегодня до старта, затем на следующий день, с end через 91 минуту и DST через IANA timezone. Первый выбор session сохраняется за funnel entry; report и visitor сопоставляются с этой привязкой, а стабильный `utm_content` не меняется. Worker команды и kill switches описаны в `server/README.md`. Этот контракт не означает production cutover, создание инфраструктуры или готовность юридических текстов.

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
- три purpose-bound token с разными полномочиями, включая video-bound media access;
- только `name` и `situation` как baseline application fields;
- config-driven warming и заданные MVP-задержки;
- классы `funnel_service` и `promotional`;
- `/stop`, `/delete` и configurable retention;
- разделение lab-архитектуры и production/legal решений.

Текущий vertical slice изменяет только `server/` и `lab/men-funnel/`. Публичный Astro `src/`, production website, analytics, DNS, Cloudflare zone и deploy остаются неизменными.

## 6. WebinarStars experience provider

WebinarStars — внешний experience provider: video, autowebinar scenario, chat, comments и buttons. MEN backend остаётся источником истины для identity, attribution, Telegram lifecycle, scheduler, applications и CRM timeline. Internal MEN page с local/Mux playback и first-party progress сохраняется как отдельный резервный experience path.

Для одного подтверждённого `funnel_entry_id` backend детерминированно создаёт stable opaque token contract v1 через HMAC-SHA256 и передаёт его только как `utm_content`. В PostgreSQL хранится полный lookup HMAC, provider, funnel entry, internal user и версия контракта; raw URL token и raw UTM не хранятся. Повторный invite восстанавливает тот же token. `men_ref`, Telegram ID, имя, телефон, email, SmartSender ID и raw UUID не используются.

После configured scheduled end persistent job опрашивает API в `+0/+1/+3/+5/+10/+15`. `get_reports` нужен для привязки report одновременно к `webinar_id`, scheduled start и scheduled end; выбор «последнего report» запрещён. `get_report` является authoritative source. Webhook dependency и публичный WebinarStars webhook endpoint отсутствуют.

Visitor correlation выполняется только через `utm_content` HMAC lookup. Неизвестный token сохраняет обезличенный `UNMATCHED_PROVIDER_VISITOR`, без эвристик по PII. Повторный poll безопасен по `report_id + visitor_id`; concurrent worker защищён lease и row lock. После исчерпания окна job переходит в `finalization_pending`, чтобы оператор мог повторить sync явно.

Provider events не подменяют first-party playback events. `date_start/date_end` нормализуются в `presence_started`, `presence_ended`, `presence_seconds` и ratio относительно scheduled session; это присутствие в WebinarStars room/page, а не просмотр видео. Они не создают `watched_25/50/75/90/100` или `webinar_completed`.

Production webinar `31195`: scheduled URL `https://efir.webinar-stars.com/webinar/5071c97bc4cfde5/`, ежедневный старт 19:00 Europe/Kiev, duration 91 минут, end 20:31. `buttons_info` сохраняется только как `type`, `show_number`, `status`; статусы ограничены `unseen|seen|clicked`. Sales CTA — configured show numbers `1,2`. Comments дают только boolean/count; text не сохраняется.

Post-webinar decision создаётся один раз после finalized report. Сегменты: `NO_SHOW`; `LEFT_BEFORE_OFFER` при presence < 3300 и обеих CTA unseen; `REACHED_OFFER_CTA_UNSEEN` при presence >= 3300 и обеих unseen; `CTA_SEEN_NOT_CLICKED`; `CTA_CLICKED_NO_APPLICATION`; `APPLICATION_SUBMITTED`; `SUPPRESSED`. Precedence: suppression, application, clicked, seen, presence segment, no-show. Длительное presence не доказывает просмотр оффера; ratio capped на 1.0 и остаётся вспомогательным.

Timing от report finalization: A +30 минут, B/C/D +60 минут, E +20 минут, F/G без follow-up. A/B ведут на следующий scheduled webinar с тем же stable correlation token. Application, sold, Telegram stop, deletion, deleted/anonymized и другие suppression states повторно проверяются перед delivery и отменяют scheduled operation, не изменяя исторический segment snapshot.

Persistence защищает decision по provider/funnel entry/report и follow-up по `(funnel_entry, report_id, segment, follow_up_rule)`. Пять v1 templates с точными текстами, purpose, single CTA и variables allowlist используются staging и явным production runner из одного источника. Production delivery по умолчанию выключен `WEBINARSTARS_FOLLOWUP_ENABLED=false` и `TELEGRAM_OUTBOUND_ENABLED=false`.

Для A/B MEN backend восстанавливает тот же stable `utm_content`. Для C/D/E static application URL запрещён: после повторной application/suppression проверки MEN backend выпускает персональный purpose-bound application token с `user_ref` и `funnel_id`. Статического `WEBINARSTARS_APPLICATION_URL` нет.
