# Финансовый дашборд Academy

Production-MVP для `finance.academy-management.ru`.

Продакшен:

```text
https://finance.academy-management.ru/
```

## Что делает приложение

- `owner` смотрит дашборд, план/факт, прогноз и сосуд выполнения плана.
- `viewer` смотрит только дашборд. Эту роль админ выдает пользователям, которым нужен доступ к результату без права менять данные.
- `accountant` вводит ежедневные данные, планы месяца и справочник банков.
- `admin` управляет только пользователями.

## Локальный запуск

```powershell
& 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server.js
```

Открыть:

```text
http://127.0.0.1:3020/
```

Dev-логины создаются автоматически при первом запуске:

| Роль | Логин | Пароль |
|---|---|---|
| Собственник | `owner` | `owner-change-me` |
| Бухгалтер | `accountant` | `accountant-change-me` |
| Админ | `admin` | `admin-change-me` |

На проде эти пароли обязательно заменить через переменные окружения.

## Проверка

```powershell
& 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check server.js
& 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check src\database.js
& 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check src\auth.js
```

## Данные

SQLite-файл создается здесь:

```text
data/finance-dashboard.sqlite
```

Эта папка не должна попадать в GitHub.

## GitHub

Репозиторий:

```text
https://github.com/borodinovaa66/academy-finance-dashboard
```

Команды после создания пустого репозитория:

```powershell
git init
git add .
git commit -m "Initial finance dashboard MVP"
git branch -M main
git remote add origin git@github.com:<account-or-org>/academy-finance-dashboard.git
git push -u origin main
```

## DNS в NIC.ru

Новый домен покупать не нужно. Нужно добавить поддомен:

```text
finance    A    93.77.178.9
```

Перед изменением DNS еще раз проверить IP сервера.

## Деплой на сервер

Целевой путь:

```text
/opt/finance-dashboard
```

Пример `.env`/systemd-переменных:

```env
PORT=3020
APP_URL=https://finance.academy-management.ru
SESSION_SECRET=long-random-secret
OWNER_LOGIN=...
OWNER_PASSWORD=...
OWNER_NAME=Андрей
ADMIN_LOGIN=...
ADMIN_PASSWORD=...
ADMIN_NAME=Администратор
ACCOUNTANT_LOGIN=...
ACCOUNTANT_PASSWORD=...
ACCOUNTANT_NAME=Бухгалтер
BITRIX_WEBHOOK_URL=https://your-domain.bitrix24.ru/rest/USER_ID/WEBHOOK_CODE/
BITRIX_DIALOG_ID=chat123
BITRIX_BOT_ID=
BITRIX_CLIENT_ID=
BITRIX_SYSTEM_MESSAGE=N
```

## Bitrix24

После сохранения ежедневных данных приложение может отправлять короткую сводку в групповой чат Bitrix24.

Нужны параметры:

- `BITRIX_WEBHOOK_URL` — входящий webhook Bitrix24 с доступом к методу `imbot.message.add`.
- `BITRIX_DIALOG_ID` — идентификатор группового чата в формате `chat123`.
- `BITRIX_BOT_ID` — опционально, если сообщение отправляется от конкретного чат-бота.
- `BITRIX_CLIENT_ID` — опционально, если webhook/бот требует client id.

Проверка отправки:

```bash
curl -X POST "https://finance.academy-management.ru/api/integrations/bitrix/test?month=2026-06" \
  --cookie "finance_session=..."
```

Nginx:

```nginx
server {
    server_name finance.academy-management.ru;

    location / {
        proxy_pass http://127.0.0.1:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

HTTPS:

```bash
sudo certbot --nginx -d finance.academy-management.ru
```

## Что не входит в MVP

- импорт из банка;
- сложная финансовая аналитика по статьям;
- восстановление пароля по email;
- резервное копирование SQLite по расписанию;
- журнал изменений в интерфейсе.

Перед передачей команде нужны backups и отдельная процедура смены паролей.
