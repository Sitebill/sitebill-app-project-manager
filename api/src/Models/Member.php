<?php

namespace SitebillApps\Rumantic\ProjectManager\Models;

use Sitebill\AppSdk\AppModel;

/** Участник проекта и его роль: manager | member | viewer. */
class Member extends AppModel
{
    public const ROLES = ['manager', 'member', 'viewer'];

    protected $table = 'app_rumantic_project_manager_members';

    protected $fillable = ['project_id', 'user_id', 'role'];

    protected $casts = ['project_id' => 'integer', 'user_id' => 'integer'];
}
