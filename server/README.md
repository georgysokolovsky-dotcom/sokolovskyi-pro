# Funnel server

Изолированный provider-neutral каркас мужской воронки. Бизнес-логика работает через общий store contract и не зависит от PostgreSQL. Публичный Astro-сайт и production не затрагиваются.

Текущий vertical slice обрабатывает:

```text
Telegram /start
  → attribution
  → entry notice
  → bonus https://t.me/georgy_sokolovsky/44
  → purpose-bound webinar token
  → webinar invite с подписанной URL
  → token-protected webinar page
  → short-lived video-bound media token
  → protected MP4 Range streaming
  → server-derived progress milestones
  → CTA → application token
  → persistent warming schedule
```

Бонус `/16` остаётся draft и не отправляется. Warming scheduler реализован только как ручной per-user executor: cron, daemon и массовый обход базы не запускаются.

## Telegram transport

`TELEGRAM_TRANSPORT=dev` используется по умолчанию. Он никуда не подключается и эмулирует принятие трёх сообщений.

`TELEGRAM_TRANSPORT=bot-api` создаёт Telegram Bot API transport только при явном выборе режима и наличии `TELEGRAM_BOT_TOKEN` и `TELEGRAM_BOT_API_BASE_URL`. Реальная активация выполняется только отдельной staging-конфигурацией.

Bot token и полные signed URL не логируются. Успех `bonus_sent` и `webinar_invite_sent` означает только, что provider принял запрос.

## Storage

- `FUNNEL_STORE=memory` — безопасный default для unit/local тестов. Данные теряются после restart.
- `FUNNEL_STORE=postgres` — persistent store на лёгком driver `pg`. Без `DATABASE_URL` запуск завершается с понятной ошибкой.

PostgreSQL хранит users, Telegram identity/chat ID, immutable `first_touch`, `funnel_entry_touch`, entry notice, events, applications, deletion requests, processing state Telegram update и persistent delivery operations. `telegram_updates` имеет primary key `(funnel_id, update_id)`, поэтому concurrent-дубли блокируются на уровне базы.

Статусы `processing`, `completed` и `failed`, timestamps и `error_stage`/`error_code` отделяют полученный update от успешно завершённого. Внешние HTTP-вызовы Telegram не держат DB transaction. Попытка и результат каждой доставки фиксируются отдельными events.

### Локальная migration

Сначала задать `DATABASE_URL` на свою локальную тестовую базу, затем выполнить:

```bash
npm --prefix server run migrate
```

Runner применяет только ещё не записанные SQL-файлы из `server/migrations/` и фиксирует их в `schema_migrations`. К production-базе эта команда автоматически не подключается.

`002_delivery_operations.sql` добавляет persistent operation state, а `003_delivery_dependencies.sql` — безопасную последовательность `entry_notice` → `bonus` → `webinar_invite`. Запись хранит стабильный ключ, update/user/funnel/recipient, descriptor без signed URL, attempts, lease, нормализованную ошибку и Telegram receipt.

`004_warming_scheduler.sql` расширяет ту же таблицу scheduled-полями, warming rule, message class, cancellation reason и отдельным scheduler lease. Параллельная очередь не создаётся.

`005_webinar_progress.sql` добавляет first-party player sessions и просмотренные диапазоны. Telegram, delivery, recovery и scheduler tables не дублируются.

## Webinar page и прогресс

Server отдаёт изолированную page по адресу `/webinar/:videoId?t=<webinar_token>`. До валидации signature, expiration, `purpose=webinar`, funnel и user страница не создаёт tracking-записей. Refresh не погашает действующий token.

После успешной проверки страницы server выпускает отдельный HMAC token с `purpose=media`. Он привязан к internal user, funnel и конкретному `video_id`, не сохраняется в PostgreSQL и живёт не меньше 15 минут или configured video duration плюс 10 минут — берётся большее значение. Webinar и application token media endpoint не принимает.

Local fixture выдаётся по `/v1/webinar/media/:videoId?mt=<media_token>`. Endpoint повторно проверяет signature, expiry, purpose, user, funnel, video и active webinar. MP4 читается потоком с диска: поддерживаются полный `200`, одиночные `Range: bytes=...`, `206`, suffix/open-ended ranges, `Content-Range`, `Accept-Ranges`, точный `Content-Length`, `HEAD` и `416`. Filesystem path не раскрывается. Ответ использует `video/mp4`, private cache, `no-referrer`, `nosniff` и same-origin без wildcard CORS.

Native player adapter получает разрешённый playback source из server-rendered page и предоставляет узкий интерфейс: подписка на play/pause/timeupdate/seeked/ended, чтение currentTime, duration, paused и ended. Он отправляет только `play`, `heartbeat`, `pause`, `seek`, `ended` в `/v1/webinar/telemetry`. Browser не выбирает funnel event, `user_id` или `funnel_id`. Server принимает только участки, где playhead двигался вперёд не быстрее server elapsed time с малым tolerance. Seek только меняет baseline.

Будущий provider adapter должен получить server-authorized playback source, создать provider player и реализовать тот же интерфейс событий/состояния. Provider-specific playback не определяет funnel milestones: PostgreSQL watched ranges и MEN server остаются источником истины.

Прогресс — длина объединения уникальных просмотренных диапазонов из всех вкладок, делённая на configured duration. Повтор, overlap и refresh не увеличивают его дважды. Server создаёт один раз `webinar_started`, `watched_25/50/75/90/100` и `webinar_completed`.

CTA имеет отдельный `/v1/webinar/cta`; application start — `/v1/applications/events`. Общий browser endpoint для произвольных funnel events отсутствует.

## Ручной recovery

После migration незавершённые операции можно обработать вручную:

```bash
npm --prefix server run recovery
```

Команда требует явных `FUNNEL_STORE=postgres` и `TELEGRAM_TRANSPORT=bot-api`; автоматического запуска и cron нет. Executor атомарно захватывает одну доступную операцию, повторно проверяет suppression, отмечает начало HTTP-запроса и сохраняет результат. Зависимая операция становится доступной только после `delivered` предыдущей.

State machine:

```text
pending → processing → delivered
                    ↘ retryable_failed → processing → dead_letter
                    ↘ delivery_unknown
                    ↘ dead_letter
                    ↘ suppressed
```

- HTTP `429` и `5xx` считаются однозначно временными и получают exponential backoff без бесконечных попыток.
- `4xx`, Telegram API rejection, неверный payload или config закрываются в `dead_letter`.
- timeout, network error, malformed response и истёкший lease после начала запроса дают `delivery_unknown`; автоматическая повторная отправка запрещена.
- истёкший lease до отметки начала HTTP-запроса можно безопасно захватить повторно.
- `delivered` с provider receipt никогда не выбирается executor повторно.
- перед каждой отправкой проверяются `/stop`, deletion request и `lead_status=sold`; операция становится `suppressed` без transport-вызова.

Логи recovery содержат только operation ID, message type, attempt, result category и факт запланированного retry. Bot token, `DATABASE_URL`, Telegram identity и signed webinar URL не выводятся.

## Ручной warming scheduler

```bash
npm --prefix server run scheduler
```

Один запуск выбирает только due operations, атомарно захватывает их scheduler lease, повторно читает user/events/rule/dependency, а затем переводит запись в обычный delivery `pending`. Саму отправку выполняет recovery layer.

Текущие rules:

- `webinar_reminder_15m` и `webinar_reminder_3h` — от `bonus_sent`, с общей dependency на delivered webinar invite; cancellation после `webinar_started` или progress;
- `continue_watching_6h` — от `webinar_started`; `watched_25` переносит окно ещё на 6 часов, cancellation после 50%+ или completion;
- `application_follow_up_2h` — от `watched_75`; cancellation после `cta_clicked`, `application_started` или `application_submitted`.

К номинальному timing добавляется deterministic-testable jitter `0–60` секунд. Policy ограничивает один funnel entry четырьмя scheduled operations и двумя delivered promotional messages за rolling 7 days. Одна rule/version планируется для entry только один раз.

Структурированный итог содержит `considered`, `due`, `claimed`, `cancelled`, `suppressed`, `delivered`, `errors`, `deferred`, `notDue`. `dead_letter` и `delivery_unknown` доступны read-only:

```bash
npm --prefix server run operations:inspect
```

## Запуск

Из корня repository:

```bash
npm run start:funnel
```

Для dev-режима передаются локальные значения `TOKEN_SIGNING_SECRET`, `TELEGRAM_WEBHOOK_SECRET` и `ADMIN_SESSION_SECRET` через environment. `WEBINAR_BASE_URL` можно задать для локальной HTTP-проверки; без него используется `lab://` reference. Production URL не задан.

Для persistent local-запуска добавить `FUNNEL_STORE=postgres` и `DATABASE_URL`. В memory-режиме `DATABASE_URL` не нужен.

## Изолированный staging

`FUNNEL_MODE=staging` работает fail-closed: server запускается только с `FUNNEL_STORE=postgres`, `TELEGRAM_TRANSPORT=bot-api`, официальным `https://api.telegram.org`, отдельным ожидаемым bot username и HTTPS URL для webhook и webinar. Перед открытием порта server вызывает `getMe` и останавливается, если token принадлежит другому bot.

Все значения задаются только через environment текущего staging runtime:

- `DATABASE_URL`;
- `TELEGRAM_BOT_TOKEN`;
- `TELEGRAM_WEBHOOK_SECRET`;
- `TOKEN_SIGNING_SECRET`;
- `ADMIN_SESSION_SECRET`;
- `TELEGRAM_BOT_API_BASE_URL`;
- `TELEGRAM_WEBHOOK_URL`;
- `TELEGRAM_EXPECTED_BOT_USERNAME`;
- `WEBINAR_BASE_URL`.

Рекомендуемый порядок отдельного staging-прогона:

1. Применить migration командой `npm --prefix server run migrate` к отдельной staging database.
2. Запустить server с `FUNNEL_MODE=staging`; endpoint `/v1/test/telegram/start` и local CORS в этом режиме отключены.
3. После доступности HTTPS endpoint выполнить первоначальную регистрацию `npm --prefix server run staging:webhook -- set --drop-pending`. Флаг удаляет только старые случайные pending updates staging-бота. Последующие обновления webhook выполняются без этого флага. Команда проверяет bot identity и не печатает token, secret или URL.
4. Отправить staging bot команду `/start article_wife_cheating` из отдельного тестового Telegram account.
5. Задать полученный `update_id` как `STAGING_TEST_UPDATE_ID` и выполнить `npm --prefix server run staging:verify`.
6. Перезапустить тот же server с той же database и выполнить `npm --prefix server run staging:verify -- --replay`. Команда повторяет тот же update через HTTPS webhook и подтверждает `duplicate: true` и неизменившийся event timeline.
7. Проверить текущую регистрацию без изменений командой `npm --prefix server run staging:webhook -- check`.
8. После завершения временного теста снять webhook и удалить случайные pending updates командой `npm --prefix server run staging:webhook -- delete --drop-pending`, затем остановить Quick Tunnel и Node server.

Команды проверки выводят только нормализованный итог. Telegram token, webhook secret, database URL, signed webinar token и полный webinar URL не выводятся.

## Проверка

```bash
npm run test:funnel
```

Тесты поднимают in-process fake Telegram Bot API на случайном локальном порту. Он принимает реальные HTTP payload и эмулирует success, HTTP 400/500, timeout, malformed JSON и `{ ok: false }`. Внешний интернет и Telegram в тестах не используются.

Настоящий browser E2E запускается отдельно в установленном Google Chrome:

```bash
npm --prefix server run test:browser
```

Он требует `FUNNEL_TEST_DATABASE_URL`, создаёт и удаляет отдельную PostgreSQL schema, запускает MEN server с fake transport и воспроизводит 40-секундный fixture в реальном HTML5 player. Проверяются media authorization/Range, milestones, refresh, две вкладки, seek protection, scheduler, CTA и application transition. Артефакты Playwright пишутся только в `/tmp`, критические browser tests не skipped.

Для временной HTTPS-проверки тот же E2E принимает process-only `FUNNEL_E2E_PORT` и `FUNNEL_E2E_ORIGIN`. При задержке локального DNS допускается process-only `FUNNEL_E2E_RESOLVE_IP`. Quick Tunnel URL и signed token не записываются в repository; после теста tunnel останавливается. Эта проверка не создаёт DNS records и не использует Telegram transport.

Настоящие PostgreSQL integration/restart/recovery tests запускаются только с отдельным URL безопасной тестовой базы:

```bash
FUNNEL_TEST_DATABASE_URL='postgresql://localhost/men_funnel_test' npm --prefix server run test:postgres
```

Тесты создают и удаляют уникальные schema внутри этой базы. Они проверяют recovery, scheduler A–O, player telemetry, seek, refresh, concurrent tabs, milestones и restart. Без `FUNNEL_TEST_DATABASE_URL` PostgreSQL tests явно отмечаются как skipped.

## Ограничения

- PostgreSQL store реализован, но локальная и production-базы не подключены автоматически.
- В `memory`-режиме restart по-прежнему стирает состояние; в `postgres`-режиме users, attribution, events, applications и `update_id` сохраняются.
- При ошибке текущего шага немедленный webhook-flow останавливается. Подготовленные зависимые operations остаются заблокированными до подтверждённой доставки предыдущего шага; ручной recovery продолжает цепочку только по безопасным состояниям.
- Telegram update сохраняет исходный `failed`/`error_stage`; recovery имеет отдельную operation timeline и не переписывает исторический результат webhook.
- Webinar route работает только в isolated server. Production hosting, CRM integration и реальный video provider не подключены; fixture использует защищённый 40-секундный local media source.
- Media token защищает доступ к fixture, но не является DRM. До реального provider остаётся определить его playback authorization, срок URL/session и серверный способ обновления доступа для длинного видео.
- Recovery и scheduler остаются ручными. Operator UI, ручное разрешение `delivery_unknown`, alerts и automatic runner отсутствуют.
- Telegram Bot API не поддерживает idempotency key для `sendMessage`. Если provider принял сообщение, а процесс умер до сохранения receipt, операция намеренно остаётся `delivery_unknown`; автоматический дубль не создаётся.
