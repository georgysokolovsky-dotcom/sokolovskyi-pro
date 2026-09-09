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
```

Бонус `/16` остаётся draft и не отправляется. Warming хранится только как конфигурация: scheduler и background jobs не запускаются.

## Telegram transport

`TELEGRAM_TRANSPORT=dev` используется по умолчанию. Он никуда не подключается и эмулирует принятие трёх сообщений.

`TELEGRAM_TRANSPORT=bot-api` создаёт Telegram Bot API transport только при явном выборе режима и наличии `TELEGRAM_BOT_TOKEN` и `TELEGRAM_BOT_API_BASE_URL`. Реальная активация выполняется только отдельной staging-конфигурацией.

Bot token и полные signed URL не логируются. Успех `bonus_sent` и `webinar_invite_sent` означает только, что provider принял запрос.

## Storage

- `FUNNEL_STORE=memory` — безопасный default для unit/local тестов. Данные теряются после restart.
- `FUNNEL_STORE=postgres` — persistent store на лёгком driver `pg`. Без `DATABASE_URL` запуск завершается с понятной ошибкой.

PostgreSQL хранит users, Telegram identity/chat ID, immutable `first_touch`, `funnel_entry_touch`, entry notice, events, applications, deletion requests и processing state Telegram update. `telegram_updates` имеет primary key `(funnel_id, update_id)`, поэтому concurrent-дубли блокируются на уровне базы.

Статусы `processing`, `completed` и `failed`, timestamps и `error_stage`/`error_code` отделяют полученный update от успешно завершённого. Внешние HTTP-вызовы Telegram не держат DB transaction. Попытка и результат каждой доставки фиксируются отдельными events.

### Локальная migration

Сначала задать `DATABASE_URL` на свою локальную тестовую базу, затем выполнить:

```bash
npm --prefix server run migrate
```

Runner применяет только ещё не записанные SQL-файлы из `server/migrations/` и фиксирует их в `schema_migrations`. К production-базе эта команда автоматически не подключается.

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

Настоящий PostgreSQL integration/restart test запускается только с отдельным URL безопасной тестовой базы:

```bash
FUNNEL_TEST_DATABASE_URL='postgresql://localhost/men_funnel_test' npm --prefix server run test:postgres
```

Тест создаёт и удаляет уникальную schema внутри этой базы. Без `FUNNEL_TEST_DATABASE_URL` он явно отмечается как skipped.

## Ограничения

- PostgreSQL store реализован, но локальная и production-базы не подключены автоматически.
- В `memory`-режиме restart по-прежнему стирает состояние; в `postgres`-режиме users, attribution, events, applications и `update_id` сохраняются.
- Если шаг доставки завершился ошибкой, оставшиеся шаги цепочки не отправляются. Persistent retry и scheduler отложены.
- Автоматического retry для `failed` или зависшего `processing` update пока нет; статус сохраняется для будущего retry/executor slice.
- Публичный webinar route, production hosting, CRM integration и реальное видео не подключены.

### План recovery без реализации executor

- `failed` допускается к ручному или будущему автоматическому retry только по allowlist временных ошибок: timeout, network error и HTTP 429/5xx. Ошибки payload, 4xx и неверная конфигурация требуют исправления без автоматического повтора.
- `processing` считается зависшим только после lease timeout. Executor должен захватывать запись атомарно через `FOR UPDATE SKIP LOCKED`, записывать новый lease и ограниченный `attempt_number`.
- Повтор начинается с первого шага без подтверждённого `*_sent` event. Уже подтверждённые entry notice, bonus и webinar invite повторно не отправляются.
- Каждый delivery attempt получает стабильный operation/idempotency key. Provider message ID сохраняется сразу после ответа Telegram.
- Между принятием сообщения Telegram и commit в PostgreSQL остаётся окно неопределённости. Для него нужен статус `delivery_unknown` и ручная сверка, а не слепая повторная отправка.
- `telegram_stop`, deletion requested/processing/completed, sold и другие запрещённые состояния проверяются непосредственно перед каждым retry и исключают дальнейшую коммуникацию.
- Нужны max attempts, exponential backoff с jitter, dead-letter status, audit event и operator-visible reason. Scheduler и массовый warming не должны использовать recovery queue.
