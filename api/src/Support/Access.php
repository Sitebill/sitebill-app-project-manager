<?php

namespace SitebillApps\Rumantic\ProjectManager\Support;

use GraphQL\Error\Error;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;
use Sitebill\AppSdk\Host;
use SitebillApps\Rumantic\ProjectManager\Models\Member;
use SitebillApps\Rumantic\ProjectManager\Models\Project;

/**
 * Единая точка прав приложения.
 *
 * Уровни: администратор сайта — менеджер всех проектов; в проекте роль manager (настройки, участники, спринты,
 * удаление), member (создаёт и правит задачи, комментирует), viewer (только чтение). Не участник проект не видит
 * вовсе: на чужой проект отвечаем «не найден», а не «запрещено», чтобы не раскрывать его существование.
 * Способности pm.* — для @can в схеме: пустить в API любого пользователя ЭТОГО сайта, дальше решает проект.
 */
final class Access
{
    public const USE = 'pm.use';

    public const CREATE_PROJECT = 'pm.create-project';

    private const RANK = ['viewer' => 1, 'member' => 2, 'manager' => 3];

    /** @return list<string> */
    public static function abilities(): array
    {
        return [self::USE, self::CREATE_PROJECT];
    }

    public static function can(?Authenticatable $user, string $ability): bool
    {
        if (! $user || ! self::sameSite($user)) {
            return false;
        }

        return match ($ability) {
            self::USE => true,
            // Создавать проекты: администратор сайта или все, если админ разрешил в настройках.
            self::CREATE_PROJECT => Host::users()->isAdmin($user) || Settings::all()['members_can_create_projects'],
            default => false,
        };
    }

    public static function user(): Authenticatable
    {
        $user = auth()->user();
        if (! $user || ! self::sameSite($user)) {
            throw new Error('forbidden');
        }

        return $user;
    }

    public static function userId(): int
    {
        return (int) self::user()->getAuthIdentifier();
    }

    public static function isAdmin(): bool
    {
        return Host::users()->isAdmin(self::user());
    }

    /** Пользователь принадлежит текущему сайту (пользователь другого сайта и платформенный не пускаются). */
    private static function sameSite(Authenticatable $user): bool
    {
        $site = Host::site()->current();

        return $site !== null && (int) ($user->tenant_id ?? 0) === $site->tenantId;
    }

    /** Роль текущего пользователя в проекте или null. */
    public static function role(Project $project): ?string
    {
        if (self::isAdmin()) {
            return 'manager';
        }

        return Member::query()->where('project_id', $project->id)->where('user_id', self::userId())->value('role');
    }

    /** Проект для действия не ниже роли $min (viewer|member|manager); иначе ошибка. */
    public static function project(int|string $id, string $min = 'viewer'): Project
    {
        $project = Project::query()->find((int) $id);
        $role = $project ? self::role($project) : null;
        if (! $project || ! $role) {
            throw new Error('not_found');
        }
        if (self::RANK[$role] < self::RANK[$min]) {
            throw new Error('forbidden');
        }

        return $project;
    }

    /** Проекты, видимые текущему пользователю. */
    public static function visibleProjects(): Builder
    {
        $query = Project::query();
        if (! self::isAdmin()) {
            $query->whereIn('id', Member::query()->where('user_id', self::userId())->select('project_id'));
        }

        return $query;
    }

    /** Может ли пользователь искать людей на сайте: менеджер хотя бы одного проекта или администратор. */
    public static function canSearchUsers(): bool
    {
        return self::isAdmin()
            || Member::query()->where('user_id', self::userId())->where('role', 'manager')->exists();
    }
}
