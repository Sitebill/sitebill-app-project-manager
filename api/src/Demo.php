<?php

namespace SitebillApps\Rumantic\ProjectManager;

use Sitebill\AppSdk\Host;
use SitebillApps\Rumantic\ProjectManager\Models\Comment;
use SitebillApps\Rumantic\ProjectManager\Models\Issue;
use SitebillApps\Rumantic\ProjectManager\Models\Project;
use SitebillApps\Rumantic\ProjectManager\Models\Sprint;
use SitebillApps\Rumantic\ProjectManager\Models\Status;
use SitebillApps\Rumantic\ProjectManager\Services\IssueService;
use SitebillApps\Rumantic\ProjectManager\Services\ProjectService;

/** Демо-проект с задачами и двумя спринтами. Идемпотентен: если в приложении уже есть проекты — ничего не делает. */
final class Demo
{
    /** @return int сколько задач создано */
    public static function seed(int $userId, bool $ru): int
    {
        if (Project::query()->exists()) {
            return 0;
        }
        $t = fn (string $ruText, string $en) => $ru ? $ruText : $en;

        $statuses = [[$t('К выполнению', 'To Do'), 'todo'], [$t('В работе', 'In Progress'), 'doing'], [$t('На проверке', 'In Review'), 'doing'], [$t('Готово', 'Done'), 'done']];
        $project = (new ProjectService)->create(
            ['key' => 'DEMO', 'name' => $t('Запуск сайта', 'Website launch'), 'description' => $t('Демо-проект: так выглядит доска, бэклог и спринты.', 'A demo project: this is how the board, backlog and sprints look.')],
            $userId,
            $statuses
        );
        $s = Status::query()->where('project_id', $project->id)->orderBy('position')->pluck('id')->all();
        $sprint1 = Sprint::create(['project_id' => $project->id, 'name' => $t('Спринт 1', 'Sprint 1'), 'goal' => $t('Собрать главную страницу и форму заявки', 'Build the home page and the request form'), 'state' => 'active', 'starts_at' => now()->subDays(5)->toDateString(), 'ends_at' => now()->addDays(9)->toDateString()]);
        $sprint2 = Sprint::create(['project_id' => $project->id, 'name' => $t('Спринт 2', 'Sprint 2'), 'state' => 'planned']);

        $service = new IssueService;
        // [заголовок en/ru, тип, приоритет, статус (индекс), спринт, оценка, метки]
        $rows = [
            [$t('Дизайн главной страницы', 'Home page design'), 'story', 'high', 3, $sprint1, 5, ['design']],
            [$t('Вёрстка шапки и подвала', 'Header and footer markup'), 'task', 'medium', 3, $sprint1, 3, ['frontend']],
            [$t('Форма заявки на сайте', 'Request form on the site'), 'story', 'highest', 1, $sprint1, 8, ['frontend', 'backend']],
            [$t('Письмо клиенту после заявки', 'Confirmation e-mail to the customer'), 'task', 'medium', 2, $sprint1, 2, ['backend']],
            [$t('Кнопка «Отправить» не нажимается в Safari', 'The Send button does not work in Safari'), 'bug', 'high', 1, $sprint1, 3, ['frontend']],
            [$t('Подключить аналитику', 'Connect analytics'), 'task', 'low', 0, $sprint1, 1, []],
            [$t('Страница «О компании»', 'About page'), 'story', 'medium', 0, $sprint2, 5, ['content']],
            [$t('Ускорить загрузку картинок', 'Speed up image loading'), 'improvement', 'medium', 0, $sprint2, 3, ['performance']],
            [$t('Тексты для блока «Услуги»', 'Copy for the Services block'), 'task', 'low', 0, null, null, ['content']],
            [$t('Настроить резервное копирование', 'Set up backups'), 'task', 'high', 0, null, 2, ['ops']],
            [$t('Тёмная тема', 'Dark theme'), 'improvement', 'lowest', 0, null, 8, ['design']],
        ];
        foreach ($rows as [$title, $type, $priority, $statusIdx, $sprint, $estimate, $labels]) {
            $issue = $service->create($project, [
                'title' => $title, 'type' => $type, 'priority' => $priority, 'status_id' => $s[$statusIdx],
                'sprint_id' => $sprint?->id, 'estimate' => $estimate, 'labels' => $labels,
                'assignee_id' => $statusIdx > 0 ? $userId : null,
                'due_date' => $statusIdx === 1 ? now()->addDays(3)->toDateString() : null,
            ], $userId);
            if ($title === $rows[2][0]) {
                $service->comment($issue, $project, $t('Начал: поля имя и телефон готовы, осталась валидация.', 'Started: name and phone fields are ready, validation is left.'), $userId);
            }
        }
        // Подзадачи формы заявки
        $parent = Issue::query()->where('project_id', $project->id)->where('number', 3)->first();
        foreach ([[$t('Валидация телефона', 'Phone validation'), 3], [$t('Защита от спама', 'Spam protection'), 0]] as [$title, $statusIdx]) {
            $service->create($project, ['title' => $title, 'parent_id' => $parent->id, 'status_id' => $s[$statusIdx], 'sprint_id' => $sprint1->id], $userId);
        }

        return Issue::query()->count();
    }

    /** Первый пользователь сайта, в чьём контексте создаётся демо. */
    public static function firstUserId(): ?int
    {
        return Host::users()->search('', 1)[0]['id'] ?? null;
    }
}
