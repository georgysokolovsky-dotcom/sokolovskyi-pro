# Men funnel — filesystem-only prototype

Эта папка содержит экспериментальный прототип мужской воронки и не является частью публичного Astro-сайта.

- файлы находятся вне `src/pages/`;
- Astro не строит из них маршруты, sitemap или production HTML;
- публичные статьи и их CTA не импортируют этот прототип;
- API и тестовая последовательность находятся в отдельном `server/`.

Текущая серверная fixture проверяет последовательность:

`Telegram Start → entry notice → bonus delivery → webinar token → webinar events → application token → application`

Для webinar используется token-protected route isolated server и 40-секундный local media fixture. После проверки webinar access server выдаёт отдельный короткоживущий `media_token`; MP4 без него не доступен. Реальный Telegram token в репозитории не хранится. По умолчанию delivery выполняется через dev/mock transport; отдельный staging может явно включить Bot API и PostgreSQL.

Lab Astro screen теперь только передаёт signed token в isolated server route. Player получает same-origin Range source через video-bound media token; telemetry, milestones и CTA обрабатываются server-side. Реальный provider остаётся заменяемым adapter и не подключён.

Целевая event model использует `bonus_delivery_attempted`, `bonus_sent` и `bonus_delivery_failed`; событие `bonus_received` в новом vertical slice не используется. Webinar и application используют разные purpose-bound signed token.

PostgreSQL-режим сохраняет операции `entry_notice`, `bonus`, `webinar_invite` и warming. Ручной recovery использует lease, ограниченные retry и fail-closed состояние `delivery_unknown`.

Persistent warming scheduler добавлен как ручной per-user executor поверх той же delivery model. Он планирует rules по событиям, добавляет малый jitter, перепроверяет cancellation/suppression и передаёт send recovery layer. Cron, массовая рассылка и Lifecycle / Reactivation не добавлены.
