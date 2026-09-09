# Funnel server

Локальный provider-neutral каркас мужской воронки. Бизнес-логика работает через общий store contract и не зависит от PostgreSQL. Публичный Astro-сайт и production не затрагиваются.

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

`TELEGRAM_TRANSPORT=bot-api` создаёт Telegram Bot API-compatible transport только при явном выборе режима и наличии `TELEGRAM_BOT_TOKEN` и `TELEGRAM_BOT_API_BASE_URL`. Adapter реализован, но live-режим не активирован, настоящий bot token не подключён, webhook в Telegram не зарегистрирован.

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
