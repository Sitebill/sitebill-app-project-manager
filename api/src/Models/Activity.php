<?php

namespace SitebillApps\Rumantic\ProjectManager\Models;

use Sitebill\AppSdk\AppModel;

/** Строка истории задачи: что и кем изменено. Только создаётся, не редактируется. */
class Activity extends AppModel
{
    public $timestamps = false;

    protected $table = 'app_rumantic_project_manager_activity';

    protected $fillable = ['project_id', 'issue_id', 'user_id', 'field', 'from_value', 'to_value', 'created_at'];

    protected $casts = ['project_id' => 'integer', 'issue_id' => 'integer', 'user_id' => 'integer', 'created_at' => 'datetime'];
}
