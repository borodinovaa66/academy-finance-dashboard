# План деплоя `finance.academy-management.ru`

Статус: выполнено.

Продакшен:

```text
https://finance.academy-management.ru/
```

Репозиторий:

```text
https://github.com/borodinovaa66/academy-finance-dashboard
```

## 1. Что делаем сначала

1. Создать GitHub-репозиторий `academy-finance-dashboard`.
2. Залить туда код из `D:\Codex\BI`.
3. На сервере создать `/opt/finance-dashboard`.
4. Склонировать репозиторий.
5. Настроить systemd-сервис.
6. Настроить Nginx.
7. Добавить DNS-запись в NIC.ru.
8. Выпустить HTTPS-сертификат.
9. Проверить вход под тремя ролями.

## 2. Systemd-сервис

Файл:

```text
/etc/systemd/system/finance-dashboard.service
```

Содержимое:

```ini
[Unit]
Description=Academy Finance Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/finance-dashboard
Environment=NODE_ENV=production
Environment=PORT=3020
Environment=APP_URL=https://finance.academy-management.ru
Environment=SESSION_SECRET=replace-with-long-random-secret
Environment=OWNER_LOGIN=replace-owner-login
Environment=OWNER_PASSWORD=replace-owner-password
Environment=OWNER_NAME=Андрей
Environment=ADMIN_LOGIN=replace-admin-login
Environment=ADMIN_PASSWORD=replace-admin-password
Environment=ADMIN_NAME=Администратор
Environment=ACCOUNTANT_LOGIN=replace-accountant-login
Environment=ACCOUNTANT_PASSWORD=replace-accountant-password
Environment=ACCOUNTANT_NAME=Бухгалтер
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
User=ubuntu

[Install]
WantedBy=multi-user.target
```

Команды:

```bash
sudo systemctl daemon-reload
sudo systemctl enable finance-dashboard
sudo systemctl start finance-dashboard
sudo systemctl status finance-dashboard
```

## 3. Nginx

Файл:

```text
/etc/nginx/sites-available/finance-dashboard
```

Содержимое:

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

Команды:

```bash
sudo ln -s /etc/nginx/sites-available/finance-dashboard /etc/nginx/sites-enabled/finance-dashboard
sudo nginx -t
sudo systemctl reload nginx
```

## 4. NIC.ru

Добавить A-запись:

```text
finance    A    93.77.178.9
```

Проверка:

```bash
dig +short finance.academy-management.ru
```

## 5. HTTPS

```bash
sudo certbot --nginx -d finance.academy-management.ru
```

## 6. Smoke-test

Проверить:

- `https://finance.academy-management.ru/` открывает страницу логина;
- `owner` видит только дашборд;
- `accountant` видит дашборд и ввод данных;
- `admin` видит только пользователей;
- `admin` не может открыть API планов;
- `owner` не может отправить API ввода данных;
- после перезапуска сервиса данные сохраняются.
