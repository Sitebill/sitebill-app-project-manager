<?php

namespace SitebillApps\Rumantic\ProjectManager\GraphQL;

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
use SitebillApps\Rumantic\ProjectManager\Services\IssueService;
use SitebillApps\Rumantic\ProjectManager\Services\ProjectService;
use SitebillApps\Rumantic\ProjectManager\Support\Access;
use SitebillApps\Rumantic\ProjectManager\Support\Settings;

/**
 * GraphQL приложения. В схему пускает @guard + @can(pm.*) (любой пользователь ЭТОГО сайта), а что именно
 * можно в проекте — решает Access (роль участника). Не участник проект не видит.
 */
final class TrackerResolver
{
    public function __construct(private readonly ProjectService $projects, private readonly IssueService $issues) {}

    // ---------------------------------------------------------------- запросы

    public function me(): array
    {
        $user = Access::user();

        return [
            'id' => (int) $user->getAuthIdentifier(),
            'name' => (string) ($user->name ?? ''),
            'is_admin' => Access::isAdmin(),
            'can_create_project' => Access::can($user, Access::CREATE_PROJECT),
            'can_search_users' => Access::canSearchUsers(),
        ];
    }

    public function projectsList(): array
    {
        $projects = Access::visibleProjects()->orderBy('is_archived')->orderBy('name')->get();
        $open = $this->openCounts($projects->pluck('id')->all());
        $roles = Access::isAdmin() ? [] : Member::query()->where('user_id', Access::userId())->pluck('role', 'project_id')->all();

        return $projects->map(fn (Project $p) => [
            'id' => (string) $p->id, 'key' => $p->key, 'name' => $p->name, 'description' => $p->description,
            'is_archived' => $p->is_archived, 'my_role' => Access::isAdmin() ? 'manager' : ($roles[$p->id] ?? 'viewer'),
            'open_issues' => $open[$p->id] ?? 0, 'members' => [], 'statuses' => [], 'sprints' => [],
        ])->all();
    }

    public function project(mixed $root, array $args): array
    {
        $project = $this->byKey($args['key']);

        return $this->projectDetail($project);
    }

    public function issuesList(mixed $root, array $args): array
    {
        $project = Access::project($args['project_id']);
        $q = Issue::query()->where('project_id', $project->id)->orderBy('position')->orderBy('id');

        if (! empty($args['sprint_id'])) {
            $q->where('sprint_id', (int) $args['sprint_id']);
        }
        if (! empty($args['backlog'])) {
            $q->whereNull('sprint_id');
        }
        if (! empty($args['assignee_id'])) {
            $q->where('assignee_id', (int) $args['assignee_id']);
        }
        if (! empty($args['unassigned'])) {
            $q->whereNull('assignee_id');
        }
        foreach (['type', 'priority'] as $f) {
            if (! empty($args[$f])) {
                $q->where($f, $args[$f]);
            }
        }
        if (! empty($args['status_id'])) {
            $q->where('status_id', (int) $args['status_id']);
        }
        if (! empty($args['label'])) {
            $q->whereJsonContains('labels', mb_strtolower($args['label']));
        }
        if (! empty($args['q'])) {
            $like = '%'.addcslashes($args['q'], '%_\\').'%';
            $term = trim($args['q']);
            // «WEB-12» ищется и по номеру.
            $num = preg_match('/^'.preg_quote($project->key, '/').'-(\d+)$/i', $term, $m) ? (int) $m[1] : null;
            $q->where(fn ($w) => $w->where('title', 'like', $like)->when($num, fn ($x) => $x->orWhere('number', $num)));
        }

        return $this->issueRows($q->limit(max(1, min(1000, (int) ($args['limit'] ?? 500))))->get(), $project);
    }

    public function issue(mixed $root, array $args): array
    {
        [$key, $number] = $this->splitKey($args['key']);
        $project = $this->byKey($key);
        $issue = Issue::query()->where('project_id', $project->id)->where('number', $number)->first() ?? throw new Error('not_found');

        $row = $this->issueRows(collect([$issue]), $project)[0];
        $comments = Comment::query()->where('issue_id', $issue->id)->orderBy('id')->get();
        $activity = Activity::query()->where('issue_id', $issue->id)->orderByDesc('id')->limit(100)->get();
        $names = Host::users()->names(array_merge($comments->pluck('user_id')->all(), $activity->pluck('user_id')->all()));
        $subs = Issue::query()->where('parent_id', $issue->id)->orderBy('number')->get();
        $myRole = Access::role($project);

        return $row + [
            'comments' => $comments->map(fn (Comment $c) => [
                'id' => (string) $c->id, 'user_id' => $c->user_id, 'user_name' => $names[$c->user_id] ?? '—', 'body' => $c->body,
                'created_at' => $c->created_at?->toIso8601String() ?? '',
                // Править/удалять чужие комментарии — менеджер; свои — автор, если он не наблюдатель.
                'can_delete' => $myRole === 'manager' || ($c->user_id === Access::userId() && $myRole !== 'viewer'),
            ])->all(),
            'activity' => $activity->map(fn (Activity $a) => [
                'id' => (string) $a->id, 'user_name' => $names[$a->user_id] ?? '—', 'field' => $a->field,
                'from_value' => $a->from_value, 'to_value' => $a->to_value, 'created_at' => $a->created_at?->toIso8601String() ?? '',
            ])->all(),
            'subtasks' => $this->issueRows($subs, $project),
        ];
    }

    public function myIssues(): array
    {
        $projects = Access::visibleProjects()->where('is_archived', false)->get()->keyBy('id');
        if ($projects->isEmpty()) {
            return [];
        }
        $done = Status::query()->whereIn('project_id', $projects->keys())->where('category', 'done')->pluck('id');
        $issues = Issue::query()->whereIn('project_id', $projects->keys())->where('assignee_id', Access::userId())
            ->whereNotIn('status_id', $done)->orderByRaw("field(priority, 'highest','high','medium','low','lowest')")->orderBy('id')->limit(200)->get();

        return $issues->groupBy('project_id')->flatMap(fn ($list, $pid) => $this->issueRows($list, $projects[$pid]))->values()->all();
    }

    public function users(mixed $root, array $args): array
    {
        if (! Access::canSearchUsers()) {
            throw new Error('forbidden');
        }

        return Host::users()->search((string) ($args['q'] ?? ''), 20);
    }

    public function activityFeed(mixed $root, array $args): array
    {
        $project = Access::project($args['project_id']);
        $rows = Activity::query()->where('project_id', $project->id)->orderByDesc('id')->limit(40)->get();
        $names = Host::users()->names($rows->pluck('user_id')->all());
        $issues = Issue::query()->whereIn('id', $rows->pluck('issue_id'))->get(['id', 'number', 'title'])->keyBy('id');

        return $rows->map(fn (Activity $a) => [
            'id' => (string) $a->id, 'user_name' => $names[$a->user_id] ?? '—', 'field' => $a->field,
            'from_value' => $a->from_value, 'to_value' => $a->to_value, 'created_at' => $a->created_at?->toIso8601String() ?? '',
            'issue_key' => $project->key.'-'.($issues[$a->issue_id]->number ?? '?'), 'issue_title' => $issues[$a->issue_id]->title ?? '',
        ])->all();
    }

    public function settings(): array
    {
        $this->adminOnly();

        return Settings::all();
    }

    // ---------------------------------------------------------------- проекты

    public function createProject(mixed $root, array $args): array
    {
        if (! Access::can(Access::user(), Access::CREATE_PROJECT)) {
            throw new Error('forbidden');
        }
        $project = $this->projects->create($args['input'], Access::userId());

        return $this->projectDetail($project);
    }

    public function updateProject(mixed $root, array $args): array
    {
        $project = Access::project($args['id'], 'manager');
        $in = $args['input'];
        $project->update(array_filter([
            'name' => isset($in['name']) ? trim($in['name']) : null,
            'description' => $in['description'] ?? null,
        ], fn ($v) => $v !== null) + (array_key_exists('is_archived', $in) ? ['is_archived' => (bool) $in['is_archived']] : []));

        return $this->projectDetail($project->refresh());
    }

    public function deleteProject(mixed $root, array $args): bool
    {
        $project = Access::project($args['id'], 'manager');
        // Удаление проекта со всеми задачами — только администратор сайта: менеджеру остаётся архив.
        $this->adminOnly();
        DB::transaction(function () use ($project) {
            foreach ([Activity::class, Issue::class, Status::class, Sprint::class, Member::class] as $model) {
                $model::query()->where('project_id', $project->id)->delete();
            }
            Comment::query()->whereNotIn('issue_id', Issue::query()->select('id'))->delete();
            $project->delete();
        });

        return true;
    }

    public function setMember(mixed $root, array $args): array
    {
        $project = Access::project($args['project_id'], 'manager');
        $this->projects->setMember($project, (int) $args['user_id'], $args['role']);

        return $this->projectDetail($project);
    }

    public function removeMember(mixed $root, array $args): array
    {
        $project = Access::project($args['project_id'], 'manager');
        $this->projects->removeMember($project, (int) $args['user_id']);

        return $this->projectDetail($project);
    }

    public function saveStatus(mixed $root, array $args): array
    {
        $project = Access::project($args['project_id'], 'manager');
        $this->projects->saveStatus($project, ! empty($args['id']) ? (int) $args['id'] : null, $args['name'], $args['category']);

        return $this->projectDetail($project);
    }

    public function deleteStatus(mixed $root, array $args): array
    {
        $project = Access::project($args['project_id'], 'manager');
        $this->projects->deleteStatus($project, (int) $args['id'], ! empty($args['move_to']) ? (int) $args['move_to'] : null);

        return $this->projectDetail($project);
    }

    public function reorderStatuses(mixed $root, array $args): array
    {
        $project = Access::project($args['project_id'], 'manager');
        $this->projects->reorderStatuses($project, array_map('intval', $args['ids']));

        return $this->projectDetail($project);
    }

    public function saveSprint(mixed $root, array $args): array
    {
        $project = Access::project($args['project_id'], 'manager');
        $this->projects->saveSprint($project, ! empty($args['id']) ? (int) $args['id'] : null, $args['input']);

        return $this->projectDetail($project);
    }

    public function startSprint(mixed $root, array $args): array
    {
        $project = Access::project($args['project_id'], 'manager');
        $this->projects->startSprint($project, (int) $args['id']);

        return $this->projectDetail($project);
    }

    public function closeSprint(mixed $root, array $args): array
    {
        $project = Access::project($args['project_id'], 'manager');
        $this->projects->closeSprint($project, (int) $args['id'], ! empty($args['move_to']) ? (int) $args['move_to'] : null);

        return $this->projectDetail($project);
    }

    public function deleteSprint(mixed $root, array $args): array
    {
        $project = Access::project($args['project_id'], 'manager');
        $this->projects->deleteSprint($project, (int) $args['id']);

        return $this->projectDetail($project);
    }

    // ---------------------------------------------------------------- задачи

    public function createIssue(mixed $root, array $args): array
    {
        $project = Access::project($args['project_id'], 'member');
        $issue = $this->issues->create($project, $args['input'], Access::userId());

        return $this->issueRows(collect([$issue]), $project)[0];
    }

    public function updateIssue(mixed $root, array $args): array
    {
        [$issue, $project] = $this->issueFor($args['id'], 'member');
        $issue = $this->issues->update($issue, $project, $args['input'], Access::userId());

        return $this->issueRows(collect([$issue]), $project)[0];
    }

    public function moveIssue(mixed $root, array $args): array
    {
        [$issue, $project] = $this->issueFor($args['id'], 'member');
        $issue = $this->issues->move($issue, $project, (int) $args['status_id'], $args['index'] ?? null, Access::userId());

        return $this->issueRows(collect([$issue]), $project)[0];
    }

    public function deleteIssue(mixed $root, array $args): bool
    {
        [$issue] = $this->issueFor($args['id'], 'manager');
        $this->issues->delete($issue);

        return true;
    }

    public function addComment(mixed $root, array $args): array
    {
        [$issue, $project] = $this->issueFor($args['issue_id'], 'member');
        $c = $this->issues->comment($issue, $project, $args['body'], Access::userId());

        return ['id' => (string) $c->id, 'user_id' => $c->user_id, 'user_name' => (string) (Access::user()->name ?? ''), 'body' => $c->body,
            'created_at' => $c->created_at?->toIso8601String() ?? '', 'can_delete' => true];
    }

    public function deleteComment(mixed $root, array $args): bool
    {
        $comment = Comment::query()->findOrFail($args['id']);
        [, $project] = $this->issueFor($comment->issue_id, 'member');
        if ($comment->user_id !== Access::userId() && Access::role($project) !== 'manager') {
            throw new Error('forbidden');
        }
        $comment->delete();

        return true;
    }

    public function saveSettings(mixed $root, array $args): array
    {
        $this->adminOnly();

        return Settings::save($args['input']);
    }

    // ---------------------------------------------------------------- вспомогательное

    private function adminOnly(): void
    {
        if (! Access::isAdmin()) {
            throw new Error('forbidden');
        }
    }

    private function byKey(string $key): Project
    {
        $project = Project::query()->where('key', strtoupper($key))->first();

        return $project ? Access::project($project->id) : throw new Error('not_found');
    }

    /** @return array{0: string, 1: int} */
    private function splitKey(string $key): array
    {
        if (! preg_match('/^([A-Za-z][A-Za-z0-9]{1,7})-(\d+)$/', trim($key), $m)) {
            throw new Error('not_found');
        }

        return [strtoupper($m[1]), (int) $m[2]];
    }

    /** @return array{0: Issue, 1: Project} */
    private function issueFor(int|string $id, string $min): array
    {
        $issue = Issue::query()->find((int) $id) ?? throw new Error('not_found');
        $project = Access::project($issue->project_id, $min);

        return [$issue, $project];
    }

    /** @param  list<int>  $projectIds @return array<int, int> */
    private function openCounts(array $projectIds): array
    {
        if ($projectIds === []) {
            return [];
        }
        $done = Status::query()->whereIn('project_id', $projectIds)->where('category', 'done')->pluck('id');

        return Issue::query()->whereIn('project_id', $projectIds)->whereNotIn('status_id', $done)
            ->select('project_id', DB::raw('count(*) as c'))->groupBy('project_id')->pluck('c', 'project_id')->map(fn ($c) => (int) $c)->all();
    }

    private function projectDetail(Project $project): array
    {
        $members = Member::query()->where('project_id', $project->id)->get();
        $names = Host::users()->names($members->pluck('user_id')->all());
        $statuses = Status::query()->where('project_id', $project->id)->orderBy('position')->orderBy('id')->get();
        $perStatus = Issue::query()->where('project_id', $project->id)->select('status_id', DB::raw('count(*) as c'))->groupBy('status_id')->pluck('c', 'status_id');
        $sprints = Sprint::query()->where('project_id', $project->id)->orderByDesc('id')->get();
        $doneIds = $statuses->where('category', 'done')->pluck('id')->all();
        $bySprint = Issue::query()->where('project_id', $project->id)->whereNotNull('sprint_id')->get(['sprint_id', 'status_id', 'estimate'])->groupBy('sprint_id');

        return [
            'id' => (string) $project->id, 'key' => $project->key, 'name' => $project->name, 'description' => $project->description,
            'is_archived' => $project->is_archived, 'my_role' => Access::role($project),
            'open_issues' => $this->openCounts([$project->id])[$project->id] ?? 0,
            'members' => $members->map(fn (Member $m) => ['user_id' => $m->user_id, 'name' => $names[$m->user_id] ?? '—', 'role' => $m->role])
                ->sortBy(fn ($m) => [$m['role'] === 'manager' ? 0 : ($m['role'] === 'member' ? 1 : 2), $m['name']])->values()->all(),
            'statuses' => $statuses->map(fn (Status $s) => [
                'id' => (string) $s->id, 'name' => $s->name, 'category' => $s->category, 'position' => $s->position, 'issue_count' => (int) ($perStatus[$s->id] ?? 0),
            ])->all(),
            'sprints' => $sprints->map(function (Sprint $s) use ($bySprint, $doneIds) {
                $list = $bySprint[$s->id] ?? collect();
                $done = $list->whereIn('status_id', $doneIds);

                return [
                    'id' => (string) $s->id, 'name' => $s->name, 'goal' => $s->goal, 'state' => $s->state,
                    'starts_at' => $s->starts_at?->toDateString(), 'ends_at' => $s->ends_at?->toDateString(),
                    'issue_count' => $list->count(), 'done_count' => $done->count(),
                    'points_total' => (int) $list->sum('estimate'), 'points_done' => (int) $done->sum('estimate'),
                ];
            })->all(),
        ];
    }

    /** @param  \Illuminate\Support\Collection<int, Issue>  $issues */
    private function issueRows($issues, Project $project): array
    {
        if ($issues->isEmpty()) {
            return [];
        }
        $names = Host::users()->names($issues->pluck('assignee_id')->merge($issues->pluck('reporter_id'))->all());
        $statuses = Status::query()->where('project_id', $project->id)->get()->keyBy('id');
        $sprints = Sprint::query()->where('project_id', $project->id)->pluck('name', 'id');
        $parents = Issue::query()->whereIn('id', $issues->pluck('parent_id')->filter())->get(['id', 'number', 'title'])->keyBy('id');
        $ids = $issues->pluck('id');
        $subs = Issue::query()->whereIn('parent_id', $ids)->select('parent_id', 'status_id')->get()->groupBy('parent_id');
        $comments = Comment::query()->whereIn('issue_id', $ids)->select('issue_id', DB::raw('count(*) as c'))->groupBy('issue_id')->pluck('c', 'issue_id');

        return $issues->map(function (Issue $i) use ($project, $names, $statuses, $sprints, $parents, $subs, $comments) {
            $status = $statuses[$i->status_id] ?? null;
            $childs = $subs[$i->id] ?? collect();

            return [
                'id' => (string) $i->id, 'key' => $project->key.'-'.$i->number, 'number' => $i->number,
                'project_id' => (string) $project->id, 'project_key' => $project->key, 'project_name' => $project->name,
                'parent_id' => $i->parent_id, 'parent_key' => isset($parents[$i->parent_id]) ? $project->key.'-'.$parents[$i->parent_id]->number : null,
                'parent_title' => $parents[$i->parent_id]->title ?? null,
                'type' => $i->type, 'title' => $i->title, 'description' => $i->description,
                'status_id' => $i->status_id, 'status_name' => $status?->name ?? '', 'status_category' => $status?->category ?? 'todo',
                'priority' => $i->priority,
                'assignee_id' => $i->assignee_id, 'assignee_name' => $names[$i->assignee_id] ?? null,
                'reporter_id' => $i->reporter_id, 'reporter_name' => $names[$i->reporter_id] ?? null,
                'sprint_id' => $i->sprint_id, 'sprint_name' => $sprints[$i->sprint_id] ?? null,
                'estimate' => $i->estimate, 'due_date' => $i->due_date?->toDateString(), 'labels' => array_values((array) $i->labels),
                'position' => $i->position,
                'created_at' => $i->created_at?->toIso8601String() ?? '', 'updated_at' => $i->updated_at?->toIso8601String() ?? '',
                'resolved_at' => $i->resolved_at?->toIso8601String(),
                'subtasks_total' => $childs->count(),
                'subtasks_done' => $childs->filter(fn ($c) => ($statuses[$c->status_id]->category ?? '') === 'done')->count(),
                'comments_count' => (int) ($comments[$i->id] ?? 0),
            ];
        })->all();
    }
}
