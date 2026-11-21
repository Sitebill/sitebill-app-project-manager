<?php

namespace SitebillApps\Rumantic\ProjectManager\Services;

use GraphQL\Error\Error;
use Illuminate\Support\Facades\DB;
use Sitebill\AppSdk\Host;
use SitebillApps\Rumantic\ProjectManager\Models\Activity;
use SitebillApps\Rumantic\ProjectManager\Models\Comment;
use SitebillApps\Rumantic\ProjectManager\Models\Issue;
use SitebillApps\Rumantic\ProjectManager\Models\Member;
use SitebillApps\Rumantic\ProjectManager\Models\Project;
use SitebillApps\Rumantic\ProjectManager\Models\Sprint;
use SitebillApps\Rumantic\ProjectManager\Models\Status;
use SitebillApps\Rumantic\ProjectManager\Support\Settings;
use Throwable;

/** Задачи: создание, правка с историей, перенос по колонкам, комментарии, уведомления. Права проверяет вызывающий. */
final class IssueService
{
    /** Поля, которые правятся через update() (статус — только через move()). */
    private const EDITABLE = ['title', 'description', 'type', 'priority', 'assignee_id', 'sprint_id', 'estimate', 'due_date', 'labels', 'parent_id'];

    public function create(Project $project, array $in, int $actorId): Issue
    {
        $issue = DB::transaction(function () use ($project, $in, $actorId) {
            // Блокировка строки проекта: двое создающих одновременно не получат один номер.
            $locked = Project::query()->lockForUpdate()->findOrFail($project->id);
            $locked->increment('issue_counter');

            $statusId = ! empty($in['status_id'])
                ? Status::query()->where('project_id', $project->id)->findOrFail((int) $in['status_id'])->id
                : (int) Status::query()->where('project_id', $project->id)->orderBy('position')->orderBy('id')->value('id');
            $status = Status::query()->findOrFail($statusId);

            $values = $this->clean($project, $in, null);
            $issue = Issue::create($values + [
                'project_id' => $project->id,
                'number' => $locked->issue_counter,
                'status_id' => $status->id,
                'reporter_id' => $actorId,
                'position' => ((int) Issue::query()->where('status_id', $status->id)->max('position')) + 1,
                'resolved_at' => $status->category === 'done' ? now() : null,
            ]);
            $this->log($issue, $actorId, 'created');

            return $issue;
        });

        $this->notifyAssigned($issue, $project, $actorId);

        return $issue;
    }

    /** @param  array<string, mixed>  $in только изменяемые поля (ключ есть — поле меняется, в том числе на null) */
    public function update(Issue $issue, Project $project, array $in, int $actorId): Issue
    {
        $in = array_intersect_key($in, array_flip(self::EDITABLE));
        $values = $this->clean($project, $in, $issue);
        $oldAssignee = $issue->assignee_id;

        DB::transaction(function () use ($issue, $values, $actorId) {
            $names = $this->names($values, $issue);
            $issue->fill($values);
            foreach ($issue->getDirty() as $field => $new) {
                $this->log($issue, $actorId, $field, $this->show($field, $issue->getOriginal($field), $names), $this->show($field, $new, $names));
            }
            $issue->save();
        });

        if ($issue->assignee_id && $issue->assignee_id !== $oldAssignee) {
            $this->notifyAssigned($issue, $project, $actorId);
        }

        return $issue->refresh();
    }

    /** Перенос в колонку $statusId на место $index (0 — наверх; null — в конец). */
    public function move(Issue $issue, Project $project, int $statusId, ?int $index, int $actorId): Issue
    {
        $status = Status::query()->where('project_id', $project->id)->findOrFail($statusId);

        DB::transaction(function () use ($issue, $status, $index, $actorId) {
            $oldStatus = Status::query()->find($issue->status_id);
            $ids = Issue::query()->where('status_id', $status->id)->where('id', '!=', $issue->id)
                ->orderBy('position')->orderBy('id')->pluck('id')->all();
            array_splice($ids, $index === null ? count($ids) : max(0, min($index, count($ids))), 0, [$issue->id]);

            $issue->status_id = $status->id;
            // «Решена» ставится при входе в категорию done и снимается при выходе из неё.
            $issue->resolved_at = $status->category === 'done' ? ($issue->resolved_at ?? now()) : null;
            $issue->save();
            foreach ($ids as $pos => $id) {
                Issue::query()->whereKey($id)->update(['position' => $pos]);
            }
            if ($oldStatus && $oldStatus->id !== $status->id) {
                $this->log($issue, $actorId, 'status', $oldStatus->name, $status->name);
            }
        });

        return $issue->refresh();
    }

    public function delete(Issue $issue): void
    {
        DB::transaction(function () use ($issue) {
            // Подзадачи не удаляем молча: становятся обычными задачами.
            Issue::query()->where('parent_id', $issue->id)->update(['parent_id' => null]);
            Comment::query()->where('issue_id', $issue->id)->delete();
            Activity::query()->where('issue_id', $issue->id)->delete();
            $issue->delete();
        });
    }

    public function comment(Issue $issue, Project $project, string $body, int $actorId): Comment
    {
        $comment = Comment::create(['issue_id' => $issue->id, 'user_id' => $actorId, 'body' => trim($body)]);
        $this->log($issue, $actorId, 'comment');

        // Исполнителю и автору задачи, кроме самого комментатора.
        $this->notify(
            array_diff(array_unique(array_filter([$issue->assignee_id, $issue->reporter_id])), [$actorId]),
            $project->key.'-'.$issue->number.': '.__('новый комментарий'),
            mb_substr(trim($body), 0, 300),
            $issue,
            $project
        );

        return $comment;
    }

    // ---------------------------------------------------------------- внутреннее

    /** Проверка и нормализация входных полей. */
    private function clean(Project $project, array $in, ?Issue $current): array
    {
        $out = [];
        foreach (['title', 'description', 'type', 'priority', 'assignee_id', 'sprint_id', 'estimate', 'due_date', 'labels', 'parent_id'] as $f) {
            if (! array_key_exists($f, $in)) {
                continue;
            }
            $v = $in[$f];
            $out[$f] = match ($f) {
                'title' => $this->title($v),
                'type' => in_array($v, Issue::TYPES, true) ? $v : throw new Error('bad_type'),
                'priority' => in_array($v, Issue::PRIORITIES, true) ? $v : throw new Error('bad_priority'),
                'assignee_id' => $this->assignee($project, $v),
                'sprint_id' => $this->sprint($project, $v),
                'parent_id' => $this->parent($project, $v, $current),
                'estimate' => $v === null ? null : max(0, min(1000, (int) $v)),
                'labels' => $this->labels($v),
                default => $v === '' ? null : $v,
            };
        }

        return $out;
    }

    private function title(mixed $v): string
    {
        $v = trim((string) $v);
        if ($v === '') {
            throw new Error('title_required');
        }

        return mb_substr($v, 0, 250);
    }

    private function assignee(Project $project, mixed $id): ?int
    {
        if (! $id) {
            return null;
        }
        // Исполнитель — участник проекта, но не наблюдатель.
        $ok = Member::query()->where('project_id', $project->id)->where('user_id', (int) $id)->whereIn('role', ['manager', 'member'])->exists();
        if (! $ok) {
            throw new Error('bad_assignee');
        }

        return (int) $id;
    }

    private function sprint(Project $project, mixed $id): ?int
    {
        if (! $id) {
            return null;
        }
        $sprint = Sprint::query()->where('project_id', $project->id)->find((int) $id);
        if (! $sprint || $sprint->state === 'closed') {
            throw new Error('bad_sprint');
        }

        return $sprint->id;
    }

    private function parent(Project $project, mixed $id, ?Issue $current): ?int
    {
        if (! $id) {
            return null;
        }
        $parent = Issue::query()->where('project_id', $project->id)->find((int) $id);
        // Один уровень: родитель сам не подзадача, и задача не родитель самой себе и не родитель родителя.
        if (! $parent || $parent->parent_id || ($current && ($parent->id === $current->id || Issue::query()->where('parent_id', $current->id)->exists()))) {
            throw new Error('bad_parent');
        }

        return $parent->id;
    }

    /** @return list<string> */
    private function labels(mixed $v): array
    {
        return collect((array) $v)->map(fn ($l) => mb_strtolower(mb_substr(trim((string) $l), 0, 30)))
            ->filter()->unique()->take(10)->values()->all();
    }

    private function log(Issue $issue, int $actorId, string $field, ?string $from = null, ?string $to = null): void
    {
        Activity::create([
            'project_id' => $issue->project_id, 'issue_id' => $issue->id, 'user_id' => $actorId,
            'field' => $field, 'from_value' => $from !== null ? mb_substr($from, 0, 250) : null,
            'to_value' => $to !== null ? mb_substr($to, 0, 250) : null, 'created_at' => now(),
        ]);
    }

    /** Имена для истории: исполнитель и спринт показываются названием, а не id. */
    private function names(array $values, Issue $issue): array
    {
        $users = Host::users()->names(array_filter([$issue->assignee_id, $values['assignee_id'] ?? null]));
        $sprints = Sprint::query()->whereIn('id', array_filter([$issue->sprint_id, $values['sprint_id'] ?? null]))->pluck('name', 'id')->all();

        return ['assignee_id' => $users, 'sprint_id' => $sprints];
    }

    private function show(string $field, mixed $value, array $names): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        if ($field === 'labels') {
            return implode(', ', (array) (is_string($value) ? json_decode($value, true) : $value));
        }
        if (isset($names[$field])) {
            return $names[$field][$value] ?? (string) $value;
        }
        if ($field === 'description') {
            return mb_substr((string) $value, 0, 100);
        }

        return (string) $value;
    }

    private function notifyAssigned(Issue $issue, Project $project, int $actorId): void
    {
        if ($issue->assignee_id && $issue->assignee_id !== $actorId) {
            $this->notify([$issue->assignee_id], __('Вам назначена задача').' '.$project->key.'-'.$issue->number, $issue->title, $issue, $project);
        }
    }

    /** @param  array<int|string, int>  $userIds */
    private function notify(array $userIds, string $title, string $body, Issue $issue, Project $project): void
    {
        if ($userIds === [] || ! Settings::all()['notify']) {
            return;
        }
        try {
            $base = rtrim((string) Host::site()->current()?->url, '/');
            Host::notifier()->notifyUsers(Settings::APP_ID, array_values($userIds), $title, $body, $base.'/account/x/'.Settings::APP_ID.'#/i/'.$project->key.'-'.$issue->number);
        } catch (Throwable $e) {
            report($e);
        }
    }
}
