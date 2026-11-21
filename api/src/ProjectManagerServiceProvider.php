<?php

namespace SitebillApps\Rumantic\ProjectManager;

use Illuminate\Support\Facades\Gate;
use Sitebill\AppSdk\AppServiceProvider;
use SitebillApps\Rumantic\ProjectManager\Console\SeedDemoCommand;
use SitebillApps\Rumantic\ProjectManager\Support\Access;

/**
 * Менеджер проектов. Миграции, GraphQL и переводы платформа подключает по соглашению; здесь — способности
 * pm.* для @can в схеме (Lighthouse без model вызывает Gate::check(ability)) и команда демо-данных.
 */
final class ProjectManagerServiceProvider extends AppServiceProvider
{
    protected function bootApp(): void
    {
        if ($this->app->runningInConsole()) {
            $this->commands([SeedDemoCommand::class]);
        }

        foreach (Access::abilities() as $ability) {
            Gate::define($ability, fn ($user) => Access::can($user, $ability));
        }
    }
}
