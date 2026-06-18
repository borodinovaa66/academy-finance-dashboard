# Передача проекта Academy Finance Dashboard в разработку

Документ для разработчика или инженера сопровождения, который принимает финансовые дашборды Академии.

## 1. Что это за проект

`Academy Finance Dashboard` - внутренний финансовый SaaS-инструмент для собственника, бухгалтера и администратора.

Основной production:

```text
https://finance.academy-management.ru/
```

GitHub:

```text
https://github.com/borodinovaa66/academy-finance-dashboard
```

Локальная папка:

```text
D:\Codex\BI
```

## 2. Что входит в папку

### Основное приложение

Корень `D:\Codex\BI`:

- backend на Node.js;
- frontend без фреймворка;
- SQLite;
- роли `owner`, `accountant`, `admin`, `viewer`;
- production-домен `finance.academy-management.ru`.

### CEO Dashboard

Папка:

```text
ceo-dashboard/
```

Отдельный прототип CEO-дашборда для верхнеуровневого управленческого слоя: деньги, продажи, маркетинг, воронка, продукт, риски и решения.

Важно: в `ceo-dashboard/secrets/` локально может лежать Google service account JSON. Эта папка не должна попадать в GitHub.

### Voronka Dashboard

Папка:

```text
voronka-dashboard/
```

Отдельный прототип дашборда воронки. Внутри есть SQLite-база в `voronka-dashboard/data/`. Эта папка не должна попадать в GitHub.

## 3. Главные документы

Читать в таком порядке:

1. `README.md`
2. `DEPLOY.md`
3. `CEO_DASHBOARD_SPEC.md`
4. `ceo-dashboard/README.md`
5. `voronka-dashboard/README.md`

## 4. Локальный запуск основного дашборда

```powershell
node server.js
```

Открыть:

```text
http://127.0.0.1:3020/
```

Проверка:

```powershell
node --check server.js
node --check src\database.js
node --check src\auth.js
```

## 5. Секреты и данные

Не коммитить:

- `.env`;
- `data/`;
- `*.sqlite`;
- `*.sqlite-shm`;
- `*.sqlite-wal`;
- `ceo-dashboard/secrets/`;
- `voronka-dashboard/data/`;
- любые Google service account JSON;
- production-пароли;
- session secrets.

Передача секретов только через password vault или отдельный защищенный канал.

## 6. Что нужно сделать разработчику

1. Получить доступ к GitHub.
2. Склонировать репозиторий.
3. Прочитать `README.md` и `DEPLOY.md`.
4. Поднять основной дашборд локально.
5. Проверить роли и авторизацию.
6. Отдельно разобраться с `ceo-dashboard` и `voronka-dashboard`.
7. Проверить, какие из прототипов нужно переносить в единый production-контур, а какие оставить отдельными.
8. Подготовить план нормализации архитектуры: единая база, единые роли, единый деплой или отдельные сервисы.

## 7. Риски

- Сейчас в папке несколько связанных, но не полностью объединенных дашбордов.
- Нельзя смешивать production-базу, тестовые SQLite и локальные Google-секреты.
- Перед промышленной эксплуатацией нужно решить: это один продукт с несколькими разделами или несколько отдельных сервисов.
