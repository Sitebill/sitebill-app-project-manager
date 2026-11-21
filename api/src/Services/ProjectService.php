<?php

namespace SitebillApps\Rumantic\ProjectManager\Services;

use GraphQL\Error\Error;
use Illuminate\Support\Facades\DB;
use Sitebill\AppSdk\Host;
use SitebillApps\Rumantic\ProjectManager\Models\Issue;
use SitebillApps\Rumantic\ProjectManager\Models\Member;
use SitebillApps\Rumantic\ProjectManager\Models\Project;
use SitebillApps\Rumantic\ProjectManager\Models\Sprint;
use SitebillApps\Rumantic\ProjectManager\Models\Status;

/** Проекты, участники, рабочий процесс (статусы) и спринты. Права проверяет вызывающий (Access). */
final class ProjectService
{
    /** Стартовый процесс; названия задаёт интерфейс на языке сайта, здесь — английские по умолчанию. */
    public const DEFAULT_STATUSES = [['To Do', 'todo'], ['In Progress', 'doing'], ['In Review', 'doing'], ['Done', 'done']];

    /** @param  list<array{0: string, 1: string}>|null  $statuses */
    public function create(array $in, int $creatorId, ?array $statuses = null): Project
    {
        $key = strtoupper(trim($in['key']));
        if (! preg_match('/^[A-Z][A-Z0-9]{1,7}$/', $key)) {
            throw new Error('bad_key');
        }
        if (Project::query()->where('key', $key)->exists()) {
            throw new Error('key_taken');
        }

        return DB::transaction(function () use ($in, $key, $creatorId, $statuses) {
            $project = Project::create([
                'key' => $key,
                'name' => trim($in['name']),
                'description' => $in['description'] ?? null,
                'lead_id' => $creatorId,
            ]);
            // Создатель — менеджер проекта (даже если это администратор сайта: так он виден в списке участников).
            Member::create(['project_id' => $project->id, 'user_id' => $creatorId, 'role' => 'manager']);
            foreach ($statuses ?? self::DEFAULT_STATUSES as $i => [$name, $category]) {
                Status::create(['project_id' => $project->id, 'name' => $name, 'category' => $category, 'position' => $i]);
            }

            return $project;
        });
    }

    public function setMember(Project $project, int $userId, string $role): Member
    {
        if (! in_array($role, Member::ROLES, true)) {
            throw new Error('bad_role');
        }
        // Только пользователи этого сайта: names() отдаёт имена лишь своих.
        if (! Host::users()->names([$userId])) {
            throw new Error('user_not_found');
        }
        $member = Member::query()->where('project_id', $project->id)->where('user_id', $userId)->first();
        // Последнего менеджера не разжаловать: проект остался бы без управления (кроме администратора сайта).
        if ($member && $member->role === 'manager' && $role !== 'manager' && $this->managers($project) <= 1) {
            throw new Error('last_manager');
        }

        return $member
            ? tap($member)->update(['role' => $role])
            : Member::create(['project_id' => $project->id, 'user_id' => $userId, 'role' => $role]);
    }

    public function removeMember(Project $project, int $userId): void
    {
        $member = Member::query()->where('project_id', $project->id)->where('user_id', $userId)->first();
        if (! $member) {
            return;
        }
        if ($member->role === 'manager' && $this->managers($project) <= 1) {
            throw new Error('last_manager');
        }
        DB::transaction(function () use ($project, $userId, $member) {
            // Задачи ушедшего остаются без исполнителя, а не с «призраком».
            Issue::query()->where('project_id', $project->id)->where('assignee_id', $userId)->update(['assignee_id' => null]);
            $member->delete();
        });
    }

    private function managers(Project $project): int
    {
        return Member::query()->where('project_id', $project->id)->where('role', 'manager')->count();
    }

    // ---------------------------------------------------------------- статусы

    public function saveStatus(Project $project, ?int $id, string $name, string $category): Status
    {
        if (! in_array($category, Status::CATEGORIES, true)) {
            throw new Error('bad_category');
        }
        if ($id) {
            $status = Status::query()->where('project_id', $project->id)->findOrFail($id);
            $status->update(['name' => trim($name), 'category' => $category]);
            // Смена категории пересчитывает «решена»: задача в колонке «Done» должна быть закрыта.
            Issue::query()->where('status_id', $status->id)->update(['resolved_at' => $category === 'done' ? now() : null]);

            return $status;
        }

        return Status::create([
            'project_id' => $project->id, 'name' => trim($name), 'category' => $category,
            'position' => ((int) Status::query()->where('project_id', $project->id)->max('position')) + 1,
        ]);
    }

    /** Удаление статуса: задачи переезжают в $moveTo (обязательно, если они есть). Последний статус не удалить. */
    public function deleteStatus(Project $project, int $id, ?int $moveTo): void
    {
        $status = Status::query()->where('project_id', $project->id)->findOrFail($id);
        if (Status::query()->where('project_id', $project->id)->count() <= 1) {
            throw new Error('last_status');
        }
        $has = Issue::query()->where('status_id', $status->id)->exists();
        $target = $moveTo ? Status::query()->where('project_id', $project->id)->where('id', '!=', $id)->find($moveTo) : null;
        if ($has && ! $target) {
            throw new Error('move_target_required');
        }
        DB::transaction(function () use ($status, $target) {
            if ($target) {
                $base = (int) Issue::query()->where('status_id', $target->id)->max('position');
                Issue::query()->where('status_id', $status->id)->orderBy('position')->get()->each(
                    fn (Issue $i) => $i->update([
                        'status_id' => $target->id, 'position' => ++$base,
                        'resolved_at' => $target->category === 'done' ? ($i->resolved_at ?? now()) : null,
                    ])
                );
            }
            $status->delete();
        });
    }

    /** @param  list<int>  $ids новый порядок id статусов проекта */
    public function reorderStatuses(Project $project, array $ids): void
    {
        $own = Status::query()->where('project_id', $project->id)->pluck('id')->all();
        if (count($ids) !== count($own) || array_diff($ids, $own) !== []) {
            throw new Error('bad_order');
        }
        foreach (array_values($ids) as $pos => $id) {
            Status::query()->whereKey($id)->update(['position' => $pos]);
        }
    }

    // ---------------------------------------------------------------- спринты

    public function saveSprint(Project $project, ?int $id, array $in): Sprint
    {
        $values = [
            'name' => trim($in['name']),
            'goal' => $in['goal'] ?? null,
            'starts_at' => $in['starts_at'] ?? null,
            'ends_at' => $in['ends_at'] ?? null,
        ];
        if ($values['starts_at'] && $values['ends_at'] && $values['ends_at'] < $values['starts_at']) {
            throw new Error('bad_dates');
        }
        if ($id) {
            $sprint = Sprint::query()->where('project_id', $project->id)->findOrFail($id);
            if ($sprint->state === 'closed') {
                throw new Error('sprint_closed');
            }

            return tap($sprint)->update($values);
        }

        return Sprint::create($values + ['project_id' => $project->id, 'state' => 'planned']);
    }

    public function startSprint(Project $project, int $id): Sprint
    {
        $sprint = Sprint::query()->where('project_id', $project->id)->findOrFail($id);
        if ($sprint->state !== 'planned') {
            throw new Error('sprint_not_planned');
        }
        if (Sprint::query()->where('project_id', $project->id)->where('state', 'active')->exists()) {
            throw new Error('sprint_already_active');
        }

        return tap($sprint)->update([
            'state' => 'active',
            'starts_at' => $sprint->starts_at ?? now()->toDateString(),
        ]);
    }

    /** Завершение: незакрытые задачи уходят в $moveTo (другой незавершённый спринт) или обратно в бэклог. */
    public function closeSprint(Project $project, int $id, ?int $moveTo): Sprint
    {
        $sprint = Sprint::query()->where('project_id', $project->id)->findOrFail($id);
        if ($sprint->state !== 'active') {
            throw new Error('sprint_not_active');
        }
        $target = $moveTo ? Sprint::query()->where('project_id', $project->id)->where('state', 'planned')->find($moveTo) : null;
        if ($moveTo && ! $target) {
            throw new Error('bad_sprint');
        }
        DB::transaction(function () use ($sprint, $target) {
            $doneIds = Status::query()->where('project_id', $sprint->project_id)->where('category', 'done')->pluck('id');
            Issue::query()->where('sprint_id', $sprint->id)->whereNotIn('status_id', $doneIds)
                ->update(['sprint_id' => $target?->id]);
            $sprint->update(['state' => 'closed', 'closed_at' => now(), 'ends_at' => $sprint->ends_at ?? now()->toDateString()]);
        });

        return $sprint->refresh();
    }

    public function deleteSprint(Project $project, int $id): void
    {
        $sprint = Sprint::query()->where('project_id', $project->id)->findOrFail($id);
        if ($sprint->state === 'active') {
            throw new Error('sprint_active');
        }
        DB::transaction(function () use ($sprint) {
            Issue::query()->where('sprint_id', $sprint->id)->update(['sprint_id' => null]);
            $sprint->delete();
        });
    }
}
