# Менеджер проектов для Sitebill (`rumantic.project-manager`)

Мини-Jira как устанавливаемое приложение Sitebill Community: проекты, роли участников, задачи с подзадачами, доска
с drag&drop, бэклог со спринтами, комментарии, история изменений и уведомления о назначении и комментариях.

**Self-hosted альтернатива Jira и Trello**: открытый (MIT) трекер задач и канбан-доска для небольших команд — на вашем сервере, без подписки и лимитов на пользователей.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE) ![Sitebill Community app](https://img.shields.io/badge/Sitebill-Community%20app-blue) ![Host API](https://img.shields.io/badge/Host%20API-%E2%89%A51.3-lightgrey)

> **EN:** An open-source, self-hosted Jira / Trello alternative: a project management and issue tracker app for
> [Sitebill Community](https://sitebillcms.com/) with Kanban board (drag & drop), backlog and sprints, subtasks,
> per-project roles (manager / member / viewer), comments, change history and notifications. Laravel + GraphQL backend,
> Vue/Nuxt UI, 4 languages (ru, en, sr, tg). MIT license.

Подходит, если нужны: трекер задач для команды или агентства, канбан-доска и бэклог со спринтами (Scrum), учёт задач
по проектам с ролями, своя «мини-Jira» на собственном хостинге.

## Установка

Приложение занимает весь сайт (главная, меню и панель — свои), поэтому ставится на чистый профиль `blank`:

```bash
curl -fsSL https://sitebillcms.com/install.sh | sh -s -- --profile blank --apps rumantic.project-manager --demo
```

`--demo` создаёт проект «Website launch» с двумя спринтами и 13 задачами. Вручную:
`php artisan apps install rumantic.project-manager-<версия>.sbapp --shell` (или `php artisan apps install rumantic.project-manager` из каталога). Нужен Host API 1.3 (Community не старше релиза с `Users::search` и `Notifier::notifyUsers`).

## Что умеет

**Проекты и роли.** Ключ проекта (`KEY`) задаёт номера задач `KEY-1, KEY-2…`. Роли *в каждом проекте*:
`manager` (проект, команда, спринты, статусы), `member` (создаёт и правит задачи, комментирует), `viewer` (только чтение).
Администратор сайта — менеджер всех проектов, удалять проекты может только он (менеджеру остаётся архив).
Не участник проекта получает `not_found`: о существовании проекта он не узнаёт.

**Задачи.** Типы (задача, ошибка, история, улучшение), приоритеты, исполнитель, спринт, оценка в очках, срок, метки,
подзадачи (один уровень), описание, комментарии, история изменений по полям.

**Доска.** Колонки — статусы проекта (категории «к выполнению / в работе / готово»), перенос карточек мышью, фильтры
по исполнителю, типу, приоритету, метке и тексту. По умолчанию показан активный спринт.

**Бэклог и спринты.** Планирование → запуск → завершение (с переносом незавершённых задач в следующий спринт или бэклог);
активный спринт один; задачи переносятся между секциями перетаскиванием; быстрое добавление задач одной строкой.

**Уведомления.** Исполнителю — о назначении, исполнителю и автору — о новых комментариях (колокольчик сайта и каналы,
которые включил пользователь). Выключаются в «Настройки».

**Настройки приложения** (админ сайта): могут ли обычные участники создавать проекты (по умолчанию нет), уведомления.

## Ограничения версии 0.1

- Нет вложений, трекинга времени, настраиваемых полей и workflow-переходов (любой статус → любой).
- Подзадачи — один уровень; метки свободные.
- Переводы `sr` и `tg` — машинные, нужна вычитка.

## Разработка

Контракт SDK — [AGENT_GUIDE](https://github.com/Sitebill/sitebill-app-starter/blob/main/AGENT_GUIDE.md).

```bash
python tools/gen_locales.py        # locales/*.json из одной таблицы (ключи совпадают)
python tools/check_keys.py         # все host.t('…') есть в локалях
npx --package @sitebill/app-sdk sitebill-app check
npx --package @sitebill/app-sdk sitebill-app pack         # → rumantic.project-manager-<версия>.sbapp
python tools/smoke_gql.py http://localhost:8001 admin@example.com <пароль>   # роли, спринты, статусы, гость
```

`smoke_gql.py` заводит четырёх пользователей `pmtest_*@example.com` (на стенде, где регистрация закрыта, создайте их
заранее) и проходит ~75 проверок. GraphQL-имена приложения начинаются с `tracker`/`Tracker`.

Лицензия: MIT.
