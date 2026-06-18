# Рука на Пульсе

Read-only веб-дашборд РнП для вкладки `CEO Dashboard` в Google Sheets `РнП+план-факт 2.0`.

## Что показывает

- 15-20 KPI из управленческой вкладки Google Sheets.
- План, факт, выполнение, статус и комментарий.
- Блок `Продукт и сервис`.
- Блок `Решения недели`.

## Локальный запуск

```powershell
cd D:\Codex\BI\ceo-dashboard
$env:PORT="3040"
$env:GOOGLE_SERVICE_ACCOUNT_JSON_FILE="C:\secure\ceo-dashboard-reader.json"
node server.js
```

Открыть:

```text
http://127.0.0.1:3040
```

## Google-доступ

Прямой CSV-экспорт таблицы закрыт и возвращает `401 Unauthorized`, поэтому сервер читает данные через Google Sheets API.

Нужно:

1. Создать Google Service Account.
2. Скопировать `client_email`.
3. Расшарить таблицу `РнП+план-факт 2.0` на этот email с правом просмотра.
4. Передать JSON ключ через защищенный файл или secret manager.

Можно также задать переменные отдельно:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=use-secret-manager-or-secure-env
GOOGLE_SHEET_ID=1Sq4hb_OrWKvA5MBXA8aeqjzN9-LUsd422lQ7mD4ONvA
GOOGLE_SHEET_NAME=CEO Dashboard
```

## Проверка

```powershell
node --check server.js
```
