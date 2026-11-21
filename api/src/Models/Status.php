<?php

namespace SitebillApps\Rumantic\ProjectManager\Models;

use Sitebill\AppSdk\AppModel;

/** Колонка рабочего процесса проекта. Категория решает, считается ли задача закрытой. */
class Status extends AppModel
{
    public const CATEGORIES = ['todo', 'doing', 'done'];

    protected $table = 'app_rumantic_project_manager_statuses';

    protected $fillable = ['project_id', 'name', 'category', 'position'];

    protected $casts = ['project_id' => 'integer', 'position' => 'integer'];
}
