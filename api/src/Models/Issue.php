<?php

namespace SitebillApps\Rumantic\ProjectManager\Models;

use Sitebill\AppSdk\AppModel;

/** Задача. Подзадача — задача с parent_id (один уровень вложенности). */
class Issue extends AppModel
{
    public const TYPES = ['task', 'bug', 'story', 'improvement'];

    public const PRIORITIES = ['lowest', 'low', 'medium', 'high', 'highest'];

    protected $table = 'app_rumantic_project_manager_issues';

    protected $fillable = [
        'project_id', 'number', 'parent_id', 'type', 'title', 'description', 'status_id', 'priority',
        'assignee_id', 'reporter_id', 'sprint_id', 'estimate', 'due_date', 'labels', 'position', 'resolved_at',
    ];

    protected $casts = [
        'project_id' => 'integer', 'number' => 'integer', 'parent_id' => 'integer', 'status_id' => 'integer',
        'assignee_id' => 'integer', 'reporter_id' => 'integer', 'sprint_id' => 'integer', 'estimate' => 'integer',
        'position' => 'integer', 'labels' => 'array', 'due_date' => 'date:Y-m-d', 'resolved_at' => 'datetime',
    ];
}
