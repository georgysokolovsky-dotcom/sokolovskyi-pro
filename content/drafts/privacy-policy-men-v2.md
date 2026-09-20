# MEN application: пакет конфиденциальности v2 — черновик для юридического согласования

**Статус:** рабочий черновик, не публиковать и не использовать как юридически утверждённый текст.

**Дата подготовки:** 20 сентября 2026 года.

**Дата вступления в силу:** [LEGAL DECISION REQUIRED]

**Версия документа:** [LEGAL DECISION REQUIRED]

Этот документ описывает фактически реализованную MEN funnel и вопросы, которые нужно утвердить до запуска сбора production-заявок. Он не заменяет действующую публичную страницу политики конфиденциальности.

## 1. Границы документа

Документ относится к пути:

```text
Telegram
→ MEN backend в Railway
→ PostgreSQL в Railway
→ WebinarStars
→ MEN application form в MEN backend
```

Публичный Astro-сайт на GitHub Pages может быть точкой входа в воронку, но не принимает MEN application form и не получает её содержимое.

Marketing consent в текущую форму не входит. Если он понадобится позже, его нужно проектировать отдельным необязательным действием.

## 2. Фактический поток данных

### 2.1. Вход через Telegram

После команды `/start` MEN backend получает от Telegram Bot API и сохраняет:

- Telegram user ID и chat ID;
- имя профиля, username и language code, если Telegram их передал;
- update ID, время получения и технический статус обработки;
- источник входа и атрибуцию воронки;
- версию entry notice/request;
- события доставки и технические статусы сообщений.

Telegram-пользователь связывается с внутренним непрозрачным `user_id`. Повторный `/start` не должен создавать второго пользователя.

### 2.2. WebinarStars

MEN backend создаёт короткий псевдонимный correlation token. В URL WebinarStars передаются только технические UTM-метки и этот token; Telegram ID, имя, email, телефон и внутренний UUID в URL не передаются.

В PostgreSQL сохраняются:

- HMAC от correlation token, но не исходный token;
- provider visitor ID и report ID;
- scheduled start/end и идентификатор вебинара;
- факт посещения, время входа и выхода, длительность присутствия;
- статусы показа и клика целевых кнопок;
- наличие и количество комментариев без текста комментариев;
- результат псевдонимного сопоставления с внутренним пользователем;
- segment decision и статусы follow-up.

Backend не использует имя, телефон или email из отчёта WebinarStars для сопоставления и не сохраняет их в provider-таблицах. WebinarStars при этом может обрабатывать собственные данные участника на своей платформе. Точный состав данных в используемом аккаунте и договорные роли нужно подтвердить отдельно.

### 2.3. MEN application form

Форма открывается по короткоживущему подписанному token с назначением `application`. Token связан с внутренними `user_id` и `funnel_id`, но не содержит Telegram ID. После загрузки страницы token удаляется из видимого URL браузера.

Пользователь вводит только:

- `name` — обязательная строка, до 200 символов;
- `phone` — обязательный номер телефона, который backend нормализует до необязательного `+` и 7–15 цифр.

Свободного описания ситуации и поля email в форме нет. Номер телефона хранится строкой; код страны не добавляется автоматически.

Вместе с заявкой сохраняются:

- отметка `accepted=true`;
- версия текста/политики;
- источник фиксации согласия или ознакомления;
- timestamp, который backend добавляет при сохранении, если браузер его не передал;
- дата создания и обновления заявки;
- внутренние user ID, funnel ID и idempotency key;
- статус заявки.

Заявка связана с ранее созданной Telegram-записью через внутренний `user_id`. Повторная отправка для того же пользователя и воронки не создаёт вторую заявку.

### 2.4. Логи и события

Backend хранит технические события воронки, delivery operations, Telegram update state, provider sync state и application event. По runtime contract логи не должны содержать Telegram ID, signed URL, correlation token или ответы заявки.

## 3. Цели обработки

До запуска юрист должен утвердить точную формулировку каждой цели и её правовое основание.

| Операция | Предварительное фактическое описание | Правовое основание |
|---|---|---|
| Обработать Telegram `/start` | Создать запись участника, выдать материалы и обеспечить переходы по MEN funnel | [LEGAL DECISION REQUIRED] |
| Провести вебинар и оценить этап прохождения | Связать посещение WebinarStars с внутренним пользователем, определить технический сегмент и остановить нерелевантные сообщения | [LEGAL DECISION REQUIRED] |
| Рассмотреть заявку и связаться с заявителем | Получить имя и телефон, проверить заявку, связаться с заявителем и организовать консультацию или разбор по его запросу | [LEGAL DECISION REQUIRED] |
| Обеспечить безопасность и идемпотентность | Предотвращать дубли, злоупотребления и повторную доставку | [LEGAL DECISION REQUIRED] |
| Выполнить запрос на удаление | Найти связанные записи, остановить сообщения и выполнить утверждённую процедуру удаления или обезличивания | [LEGAL DECISION REQUIRED] |

Автоматизированное решение, которое создаёт юридические или аналогично значимые последствия для пользователя, в текущем коде не заявлено. Сегментация управляет follow-up сообщениями. Юрист должен подтвердить, как её описывать пользователю.

## 4. Категории данных

| Категория | Примеры |
|---|---|
| Идентификаторы Telegram | user ID, chat ID, username, first name, language code |
| Внутренние идентификаторы | user ID, funnel ID, source ID, application ID |
| Атрибуция | source, medium, campaign, article slug, start parameter |
| Поведение на вебинаре | посещение, время присутствия, показ/клик CTA, comment count |
| Данные заявки | `name`, `phone` |
| Доказательство действия | версия notice/consent, source, timestamp |
| Технические данные | update ID, provider visitor/report ID, timestamps, статусы и нормализованные error codes |

## 5. Минимизация данных заявки

MEN application form собирает только имя и номер телефона. Свободного текстового поля нет, поэтому форма не запрашивает описание отношений, сведения о здоровье, сексуальной жизни, убеждениях или другие специальные категории данных.

Если свободный текст появится позднее, это будет отдельным изменением legal и технического контракта. До такого решения backend должен отклонять `situation`, `email` и любые другие поля вне allowlist `name`, `phone`.

## 6. First-layer notice для формы

Ниже — структура первого слоя. Это не финальный пользовательский текст.

> **Кто обрабатывает данные:** [RESPONSIBLE — LEGAL DECISION REQUIRED].
>
> **Зачем:** [PURPOSE — LEGAL DECISION REQUIRED].
>
> **Правовое основание:** [LEGAL BASIS — LEGAL DECISION REQUIRED].
>
> **Кому доступны данные:** [RECIPIENTS / PROCESSORS — LEGAL DECISION REQUIRED].
>
> **Международные передачи:** [INTERNATIONAL TRANSFERS — LEGAL DECISION REQUIRED].
>
> **Срок хранения:** [RETENTION — LEGAL DECISION REQUIRED].
>
> **Ваши права:** доступ, исправление, удаление, ограничение, возражение и переносимость — в применимом объёме; отзыв согласия, если обработка основана на согласии; жалоба в компетентный надзорный орган. Порядок обращения: [RIGHTS CONTACT — LEGAL DECISION REQUIRED].
>
> **Подробнее:** [LINK TO FULL PRIVACY POLICY — LEGAL DECISION REQUIRED].

Первый слой должен быть в поле зрения пользователя до кнопки «Отправить заявку». Полная информация должна открываться по постоянной ссылке.

## 7. Checkbox ознакомления

Точный интерфейсный текст:

> Я ознакомился с Политикой конфиденциальности.

Слова «Политикой конфиденциальности» должны быть ссылкой на опубликованную policy из `PRIVACY_POLICY_URL`. Checkbox обязателен, не предвыбран и фиксирует ознакомление с информацией об обработке данных. Он не является marketing consent или отдельным согласием на обработку специальных категорий данных.

### Marketing consent

В текущей MEN application form не добавляется. Если появится отдельная маркетинговая цель, нужен отдельный необязательный checkbox и отдельная версия текста.

## 8. Ответственный / controller

В существующем legal draft указаны следующие данные:

- legal name: **ФОП Соколовський Георгій Джоржевич**;
- business registration: украинский ФОП; подтверждённая выписка/номер записи — [LEGAL DECISION REQUIRED];
- tax identifier: указан в существующем draft; допустимость и формат публичного раскрытия — [LEGAL DECISION REQUIRED];
- contact email: указан в существующем draft;
- postal address: указан украинский адрес регистрации; формат и объём публикации — [LEGAL DECISION REQUIRED];
- фактическое управление из Испании: отражено в draft;
- испанский NIE, адрес, establishment и вопрос представителя по Article 27 GDPR: [LEGAL DECISION REQUIRED].

До подтверждения нельзя автоматически считать, что сведения украинского ФОП полностью закрывают требования для работы из Испании и с пользователями ЕС.

## 9. Получатели и processors: factual table

Таблица фиксирует обнаруженные документы и техническое участие. Она не подтверждает достаточность договора или механизма передачи.

| Сервис | Фактическая роль в MEN flow | Категории данных | Цель | Entity / страна по найденному документу | DPA | Передача / источник |
|---|---|---|---|---|---|---|
| Railway | Хостинг MEN backend и PostgreSQL; потенциальный processor по поручению владельца | Telegram identifiers, attribution, имя и телефон заявки, acknowledgement metadata, provider correlation, logs | Выполнение backend и хранение БД | Railway Corporation, США | YES, публичный DPA; факт принятия для аккаунта [LEGAL DECISION REQUIRED] | DPA включает SCC и список subprocessors. Источники: <https://railway.com/legal/dpa>, <https://docs.railway.com/enterprise/compliance> |
| Telegram | Самостоятельный сервис для Telegram-аккаунта пользователя; роль оператора MEN bot для полученных bot-данных [LEGAL DECISION REQUIRED] | Telegram user/chat ID, профильные поля, `/start`, кнопки и delivery metadata | Вход в воронку и сообщения | Telegram Messenger Inc.; для ЕЭЗ указан EDPO | Публичный controller–processor DPA для MEN bot не найден | Telegram описывает собственные трансграничные процессы; bot developer обязан дать доступную policy. Источники: <https://telegram.org/privacy>, <https://telegram.org/tos/bot-developers> |
| WebinarStars | Платформа вебинара; хранит данные участников по поручению пользователя платформы согласно собственной policy | Pseudonymous token/UTM, provider visitor ID, посещение, timing, CTA statuses, comment count; другие participant data на стороне платформы [LEGAL DECISION REQUIRED] | Проведение вебинара, отчёт и сегментация | ФОП Чепік Андрій Андрійович, Украина, по публичной оферте | NO / публичный DPA не найден | Policy заявляет EU data centres и хранение participant data по поручению пользователя до удаления, но договорный transfer mechanism не установлен. Источники: <https://efir.webinar-stars.com/policy/>, <https://efir.webinar-stars.com/agreements/> |
| GitHub Pages | Хостинг публичного Astro-сайта до перехода в Telegram; application form и её ответы через Pages не проходят | IP посетителя и технический запрос к публичной странице; безопасная attribution при переходе | Доставка публичного сайта | GitHub, Inc. / применимая GitHub entity [LEGAL DECISION REQUIRED] | [LEGAL DECISION REQUIRED для используемого плана/аккаунта] | GitHub Docs подтверждает логирование IP посетителя Pages: <https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages> |
| Cloudflare | Участие в production application path не подтверждено | — | — | — | — | Не включать в финальную policy, пока реальный production DNS/proxy path не подтвердит его участие |

Нужно отдельно получить и сохранить договорные документы фактических аккаунтов, список subprocessors, выбранные регионы размещения и настройки удаления.

## 10. Международные передачи

До публикации нужно утвердить:

- какие страны и юридические лица участвуют в Railway hosting и subprocessors;
- какой SCC-модуль и дополнительные меры относятся к фактическому Railway workspace;
- роль Telegram как самостоятельного controller и роль MEN bot operator;
- договорную роль WebinarStars для данных участников, фактические data centres и механизм передачи;
- участвует ли GitHub Pages только в публичном сайте или также в каком-либо application request;
- нужен ли EU/Spain representative для controller.

**Итог:** [LEGAL DECISION REQUIRED]

## 11. Сроки хранения: decision table

Сроки не утверждены. Для каждой строки нужно выбрать срок или проверяемый критерий удаления.

| Категория | Срок | Операционное последствие решения |
|---|---|---|
| Заявка без конверсии | [RETENTION PERIOD TO APPROVE] | Нужна автоматическая выборка по `created_at`, удаление/обезличивание answers и согласованная судьба связанной Telegram-записи |
| Заявка, ставшая клиентом | [RETENTION PERIOD TO APPROVE] | Нужно разделить данные заявки, договорные/налоговые записи и рабочие заметки; сроки могут отличаться |
| Запрос на удаление | [RETENTION PERIOD TO APPROVE] | Нужен срок обработки запроса, перечень удаляемых таблиц, исключения по закону и запись о выполнении без лишних данных |
| Технические логи | [RETENTION PERIOD TO APPROVE] | Настроить Railway/application log retention и исключить application answers, identifiers и signed tokens из логов |
| Provider correlation | [RETENTION PERIOD TO APPROVE] | Удалять HMAC mapping, session binding, visitor signals, segment decisions и pending follow-ups согласованно |
| Telegram events и delivery state | [RETENTION PERIOD TO APPROVE] | Сохранить только необходимую идемпотентность и доказательство доставки; определить удаление update IDs, receipts и ошибок |

Существующая таблица `deletion_requests` фиксирует запрос, но сама по себе не реализует полное удаление всех связанных записей. До запуска нужно утвердить и проверить operational deletion procedure.

## 12. Безопасность

Фактически реализованные меры:

- production PostgreSQL использует TLS `verify-full` с проверкой CA и hostname;
- секреты находятся вне Git;
- application и webinar URL подписаны и ограничены по назначению;
- raw correlation token не сохраняется в provider tables;
- provider matching не использует имя, email или телефон;
- raw API response и текст комментариев WebinarStars не сохраняются;
- outbound, WebinarStars sync и follow-up управляются отдельными kill switches;
- runtime fail-closed требует утверждённые legal variables до production startup.

До production-запуска требуется подтвердить доступы, резервные копии, удаление и incident response: [LEGAL DECISION REQUIRED].

## 13. Права пользователя

Полная policy должна описать применимые права на доступ, исправление, удаление, ограничение, возражение и переносимость, а также:

- способ подтвердить личность без избыточного сбора;
- канал обращения и срок ответа;
- отзыв согласия, если обработка основана на согласии;
- последствия отзыва для уже законной обработки;
- компетентный надзорный орган и право на жалобу;
- порядок удаления данных в Railway, Telegram и WebinarStars;
- ограничения удаления, если хранение обязательно по закону.

Контакт и окончательная процедура: [LEGAL DECISION REQUIRED]

## 14. Изменения интерфейса после юридического решения

До production-сбора заявок потребуется:

1. Разместить first-layer notice в поле зрения кнопки submit.
2. Показать в checkbox ссылку на полную опубликованную privacy policy.
3. Оставить в форме только `name` и `phone`; отклонять `situation`, `email` и другие дополнительные поля.
4. Использовать точный acknowledgement text из раздела 7 без marketing consent.
5. Хранить стабильный version identifier и timestamp ознакомления.
6. Убедиться, что пользователь видит сведения до отправки, а не только после неё.
7. Проверить доступность текста на мобильном экране и корректный переход к policy.
8. Обновить BotFather privacy policy URL, если собственная policy должна применяться к MEN bot: [LEGAL DECISION REQUIRED].

## 15. Mapping Railway variables

Переменные не получают значения до юридического утверждения.

| Railway variable | Источник будущего значения | Условие готовности |
|---|---|---|
| `PRIVACY_POLICY_URL` | Постоянный URL опубликованной полной policy v2 | Policy утверждена, опубликована и соответствует реальному flow |
| `APPLICATION_CONSENT_VERSION` | `men_application_privacy_v1_2026_09_20` | Утверждены policy version, effective date и неизменяемый текст checkbox |
| `APPLICATION_CONSENT_TEXT` | `Я ознакомился с Политикой конфиденциальности.` | Текст утверждён как acknowledgement; слова «Политикой конфиденциальности» ведут на `PRIVACY_POLICY_URL` |

## 16. Источники

- GDPR, Articles 5, 6, 9, 13, 25, 27, 28, 30 и 35: <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679>
- AEPD, информация при прямом сборе данных: <https://www.aepd.es/preguntas-frecuentes/2-tus-obligaciones-como-responsable-del-tratamiento/6-el-deber-de-informacion/FAQ-0217-que-informacion-debe-facilitarse-cuando-los-datos-se-obtengan-directamente-del-afectado>
- AEPD, модель layered notice: <https://www.aepd.es/guias/guia-modelo-clausula-informativa.pdf>
- Railway DPA: <https://railway.com/legal/dpa>
- Railway compliance: <https://docs.railway.com/enterprise/compliance>
- Telegram Privacy Policy: <https://telegram.org/privacy>
- Telegram Bot Platform Developer Terms: <https://telegram.org/tos/bot-developers>
- WebinarStars Privacy Policy: <https://efir.webinar-stars.com/policy/>
- WebinarStars public offer: <https://efir.webinar-stars.com/agreements/>
- GitHub Pages data collection: <https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages>

## 17. Статус готовности

**READY FOR LEGAL REVIEW: YES**

**READY FOR PUBLICATION: NO**

**READY TO SET RAILWAY LEGAL VARIABLES: NO**
