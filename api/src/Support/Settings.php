<?php

namespace SitebillApps\Rumantic\ProjectManager\Support;

use Sitebill\AppSdk\Host;

/** Настройки приложения текущего сайта (Host::settings()). */
final class Settings
{
    public const APP_ID = 'rumantic.project-manager';

    /** @return array{members_can_create_projects: bool, notify: bool} */
    public static function all(): array
    {
        $s = Host::settings()->all(self::APP_ID);

        return [
            'members_can_create_projects' => (bool) ($s['members_can_create_projects'] ?? false),
            'notify' => (bool) ($s['notify'] ?? true),
        ];
    }

    /** @param array<string, mixed> $input */
    public static function save(array $input): array
    {
        foreach (['members_can_create_projects', 'notify'] as $key) {
            if (array_key_exists($key, $input)) {
                Host::settings()->set(self::APP_ID, $key, (bool) $input[$key]);
            }
        }

        return self::all();
    }
}
