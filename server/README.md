# Funnel server

Локальный provider-neutral каркас мужской воронки. Сейчас он использует только встроенные модули Node.js и in-memory storage, чтобы проверить vertical slice без Telegram token, базы и production-подключения. Основной bonus — ссылка на существующий подкаст; пул `/16` хранится как draft и не используется. Публичный username бота зафиксирован как `@sokolovskyi_men_bot`; Bot API пока не вызывается.

Dev transport эмулирует успешную или неуспешную отправку bonus. Доменный flow фиксирует `bonus_delivery_attempted`, затем `bonus_sent` или `bonus_delivery_failed`. Для webinar и application используются отдельные purpose-bound signed token. Warming представлен конфигурацией правил, scheduler и background jobs не запускаются.

## Запуск

Из корня repository:

```bash
npm run start:funnel
```

Перед запуском локально задаются значения `TOKEN_SIGNING_SECRET`, `TELEGRAM_WEBHOOK_SECRET` и `ADMIN_SESSION_SECRET` через environment. Сервер слушает `http://127.0.0.1:8787` и работает только с локальной fixture-конфигурацией. В ней используется ссылка на существующий подкаст `/44`; отправка через Bot API ещё не включена.

## Проверка

```bash
npm run test:funnel
```

PostgreSQL подключается отдельным этапом через `migrations/001_core.sql`. Telegram token, webhook secret, signing secret и admin secret передаются только через environment; в этот каталог их записывать нельзя.
