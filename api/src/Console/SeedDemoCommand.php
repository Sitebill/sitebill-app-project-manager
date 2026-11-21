<?php

namespace SitebillApps\Rumantic\ProjectManager\Console;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Sitebill\AppSdk\Host;
use SitebillApps\Rumantic\ProjectManager\Demo;

/** Демо-проект с задачами. Зовёт установщик (--demo); повторный запуск безопасен. */
final class SeedDemoCommand extends Command
{
    protected $signature = 'rumantic-project-manager:seed-demo {--tenant= : id сайта (по умолчанию — первый)}';

    protected $description = 'Create a demo project with issues and sprints if the app is empty';

    public function handle(): int
    {
        // В консоли сайт не привязан: Community — один сайт, берём его (или --tenant).
        $tenantId = (int) ($this->option('tenant') ?: DB::table('tenants')->orderBy('id')->value('id'));
        if (! $tenantId) {
            $this->error('No site found');

            return self::FAILURE;
        }

        $created = Host::site()->runAs($tenantId, function () {
            $userId = Demo::firstUserId();
            if (! $userId) {
                return null;
            }
            $ru = str_starts_with((string) Host::site()->current()?->locale, 'ru');

            return Demo::seed($userId, $ru);
        });
        if ($created === null) {
            $this->error('No users on the site: create the administrator first');

            return self::FAILURE;
        }
        $this->info("Demo issues created: {$created}");

        return self::SUCCESS;
    }
}
