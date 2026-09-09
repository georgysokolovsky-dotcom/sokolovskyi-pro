# Funnel server

Локальный provider-neutral каркас мужской воронки. Он использует только встроенные модули Node.js и in-memory storage. Публичный Astro-сайт и production не затрагиваются.

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

## Запуск

Из корня repository:

```bash
npm run start:funnel
```

Для dev-режима передаются локальные значения `TOKEN_SIGNING_SECRET`, `TELEGRAM_WEBHOOK_SECRET` и `ADMIN_SESSION_SECRET` через environment. `WEBINAR_BASE_URL` можно задать для локальной HTTP-проверки; без него используется `lab://` reference. Production URL не задан.

## Проверка

```bash
npm run test:funnel
```

Тесты поднимают in-process fake Telegram Bot API на случайном локальном порту. Он принимает реальные HTTP payload и эмулирует success, HTTP 400/500, timeout, malformed JSON и `{ ok: false }`. Внешний интернет и Telegram в тестах не используются.

## Ограничения

- PostgreSQL, SQLite, ORM и другое persistent storage не подключены.
- После restart процесса теряются users, events, applications и защита от повтора `update_id`.
- Если шаг доставки завершился ошибкой, оставшиеся шаги цепочки не отправляются. Persistent retry и scheduler отложены.
- `server/migrations/001_core.sql` — только будущая PostgreSQL-схема; текущий runtime её не читает и не выполняет.
- Публичный webinar route, production hosting, CRM integration и реальное видео не подключены.
