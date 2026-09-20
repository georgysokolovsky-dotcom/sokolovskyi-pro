# Production runbook MEN Funnel

## PostgreSQL TLS contract

Production подключается к private endpoint Railway с `DATABASE_SSL_MODE=verify-full`. Runtime требует `DATABASE_SSL_CA_BASE64`, декодирует его только в памяти процесса и передаёт полученный PEM в `pg.Pool` как `ssl.ca` с `rejectUnauthorized: true`. Не добавлять SSL query parameters в `DATABASE_URL`; не использовать `sslmode=require` или `rejectUnauthorized=false`.

Образ Railway `postgres-ssl` хранит сгенерированный root CA по адресу:

```text
/var/lib/postgresql/data/certs/root.crt
```

Если образ или mount path тома изменятся, найти файл read-only внутри Postgres service:

```bash
find "${RAILWAY_VOLUME_MOUNT_PATH:-/var/lib/postgresql/data}" -maxdepth 3 -type f -name root.crt -print
```

Проверить метаданные без вывода содержимого сертификата:

```bash
openssl x509 -in /var/lib/postgresql/data/certs/root.crt -noout -subject -issuer -dates -fingerprint -sha256
```

## Экспорт Railway CA

1. Открыть shell в production service `Postgres`. Для привязанного и авторизованного Railway CLI:

   ```bash
   railway ssh --service Postgres --environment production
   ```

2. Подтвердить path и метаданные read-only командами выше.
3. Закодировать сертификат в одну строку base64:

   ```bash
   base64 < /var/lib/postgresql/data/certs/root.crt | tr -d '\n'
   ```

4. Скопировать результат сразу в `MEN Funnel Production` → `men-api` → Variables как `DATABASE_SSL_CA_BASE64`. Не вставлять его в чат, source files, логи или Git.
5. Оставить изменение staged, пока не будут готовы остальные production variables и первый probe deployment.

## Первый production TLS probe

До подключения GitHub source задать в Railway временную start command для первого deployment:

```bash
npm --prefix server run test:production-db-tls
```

Скрипт импортирует только общие pool options. Он не импортирует `src/index.mjs`, не загружает fixtures, не запускает миграции, не создаёт таблицы и не пишет данные. Он выполняет только `SELECT 1`, требует encrypted и authorized TLS socket, закрывает pool и выводит одну из строк:

```text
DATABASE TLS PROBE: PASS
DATABASE TLS PROBE: FAIL (<safe category>)
```

Только PASS подтверждает runtime contract. После PASS заменить временную start command на обычную команду backend отдельным проверенным изменением. Во время probe не включать Telegram outbound, WebinarStars sync, follow-up или production traffic.

## Ротация CA

CA привязан к Postgres volume. Если volume пересоздан, certificate files сгенерированы заново или Railway ротировал root CA, значение в `men-api` устаревает.

Процедура ротации:

1. Оставить backend остановленным или на one-shot probe command.
2. Повторно прочитать fingerprint и expiry CA, не выводя сам сертификат.
3. Экспортировать текущий `root.crt` и заменить `DATABASE_SSL_CA_BASE64`.
4. Повторно запустить one-shot TLS probe.
5. Восстановить normal startup только после PASS.

Контролировать expiry сертификата и повторить процедуру до планового renewal. Не обходить устаревший CA отключением проверки сертификата или hostname.
