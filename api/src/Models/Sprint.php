<?php

namespace SitebillApps\Rumantic\ProjectManager\Models;

use Sitebill\AppSdk\AppModel;

/** Спринт: planned → active → closed. В проекте не больше одного активного. */
class Sprint extends AppModel
{
    protected $table = 'app_rumantic_project_manager_sprints';

    protected $fillable = ['project_id', 'name', 'goal', 'state', 'starts_at', 'ends_at', 'closed_at'];

    protected $casts = ['project_id' => 'integer', 'starts_at' => 'date:Y-m-d', 'ends_at' => 'date:Y-m-d', 'closed_at' => 'datetime'];
}
