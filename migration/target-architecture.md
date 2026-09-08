# Целевая архитектура `sokolovskyi.pro`

Статус документа: этапы 1–5 выполнены в параллельной Astro-сборке, без production-переключения.

## Поток публикации

```text
GitHub
  -> Astro 6 static build
  -> dist/
  -> Cloudflare Workers Static Assets
  -> sokolovskyi.pro
```

Cloudflare Pages в целевую архитектуру не входит.

## Astro и Content Layer

- Используется Astro 6.
- Сайт собирается с `output: 'static'`.
- Страницы статей генерируются через `getStaticPaths()`.
- Коллекция объявляется в `src/content.config.ts`.
- Используются `defineCollection()` из `astro:content`, `glob()` из `astro/loaders` и `z` из `astro/zod`.
- Legacy-вариант `type: 'content'` не используется.
- Для локальных Markdown/MDX применяется build-time Content Layer, без live loader.
- SSR, адаптер Cloudflare, база данных, CMS и API для статей не добавляются.
- `src/content/articles/*.md` — публичный источник статей; приватные рабочие материалы в него не импортируются.
- Старый `public/` сохраняется для React/Vite/GitHub Pages. Параллельный Astro build использует `public-astro/` только как зеркало публичных изображений, чтобы Astro endpoints `robots.txt` и `sitemap.xml` не конфликтовали со старыми файлами.

## Статические ресурсы Workers

Основной Worker позднее должен обслуживать содержимое `dist/` как Static Assets. Запросы к HTML, CSS, изображениям и статьям идут напрямую к static assets и не требуют запуска Worker-кода.

Единственный специальный маршрут — `/go/webinar`. В будущем для него можно включить выполнение Worker-кода первым, вернуть HTTP redirect на текущую страницу вебинара и перенести только разрешённые query-параметры:

```text
utm_source
utm_medium
utm_campaign
utm_content
article_id
topic
placement
```

Остальные маршруты должны передаваться в `env.ASSETS.fetch(request)` или обслуживаться напрямую как статические файлы. Это не превращает сайт в SSR-приложение.

## Workers Builds и previews

Подготовленная архитектура допускает Git integration через Workers Builds:

- production branch — `main`;
- push в `main` запускает Astro build и production deployment;
- non-production branch builds включаются отдельно;
- Pull Request получает preview deployment;
- preview разворачивается через версию Worker и не меняет production deployment;
- custom domain подключается только после отдельной проверки.

На этапах 1–5 Git integration, Wrangler, Worker и Cloudflare account не настраиваются.

## Юридические страницы

Юридическая страница должна иметь собственный статус публикации:

- `draft` или `unconfirmed` — страница может иметь технический HTTP 200 для отдельного URL, но не публикуется как окончательная и получает `noindex`;
- `approved` — допускается `index, follow`, если страница действительно готова к публичной индексации.

Постоянное правило `noindex` для всех legal pages не используется. Сейчас пять legal URL собраны из существующего незавершённого каркаса со статусом `unconfirmed`; окончательный юридический текст не придуман.

## Маршруты этапов 4–5

Статически собираются: `/`, `/about/`, `/method/`, `/webinar/`, `/articles/`, `/topics/`, `/contacts/`, пять заполненных topic URL и все 15 article URL. Пустые `/topics/obescenivanie/`, `/topics/uverennost/` и `/cases/` не создаются.

`/go/webinar` собран как отдельный статический endpoint с минимальным fallback-скриптом переноса allowlist query-параметров в ссылку. HTTP redirect Worker пока не подключён; это следующий deployment-слой, не часть текущей Astro-сборки.

`sitemap.xml` включает только indexable pages, заполненные темы и published articles. Legal draft/unconfirmed pages, `/go/`, `/404` и пустые разделы исключены. `robots.txt` явно разрешает `OAI-SearchBot` публичные страницы и запрещает только `/go/`.

## Граница масштабирования

Cloudflare Workers Static Assets ограничивает количество файлов в одной версии Worker. Актуальное ограничение зависит от плана: 20 000 файлов на Free и до 100 000 на Paid. Поэтому при приближении примерно к 50 000 публичных страниц необходимо остановить дальнейшее наращивание и провести отдельный аудит архитектуры публикации, количества assets, sitemap и стратегии разбиения сайта.

До такого аудита дополнительные хранилища, CMS, базы данных, live collections и усложнение deployment-схемы не добавляются.

## Приватные материалы

Следующие источники не должны попадать в `src/content/articles`, публичный Astro build или `dist/`:

- `private-sources/`;
- транскрибации;
- кейсы;
- внутренние редакционные документы;
- личная база знаний.

В публичной frontmatter допускаются только безопасные для публикации записи `sources`. Приватная provenance-информация хранится отдельно и не выводится компонентами сайта.

## Контрольные правила build

Build должен завершаться ошибкой при:

- дубликате `slug`;
- дубликате canonical;
- пустом `title`;
- пустом `description`;
- неизвестном `topic`;
- неизвестном `author`;
- несуществующем slug в `relatedArticles`.

Порог и правила зафиксированы до начала следующих этапов миграции.
