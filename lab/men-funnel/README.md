# Men funnel — filesystem-only prototype

Эта папка содержит экспериментальный прототип мужской воронки и не является частью публичного Astro-сайта.

- файлы находятся вне `src/pages/`;
- Astro не строит из них маршруты, sitemap или production HTML;
- публичные статьи и их CTA не импортируют этот прототип;
- API и тестовая последовательность находятся в отдельном `server/`.

Текущая серверная fixture проверяет последовательность:

`Telegram Start → entry notice → bonus delivery → webinar token → webinar events → application token → application`

Для видео используется внутренний reference `lab://men-funnel/video/lab-men-funnel-video-fixture`. Реальный Telegram token в репозитории не хранится. Bonus delivery выполняется через dev/mock transport.

Целевая event model использует `bonus_delivery_attempted`, `bonus_sent` и `bonus_delivery_failed`; событие `bonus_received` в новом vertical slice не используется. Webinar и application используют разные purpose-bound signed token.
