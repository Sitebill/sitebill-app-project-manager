<?php

namespace SitebillApps\Rumantic\ProjectManager\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Sitebill\AppSdk\AppModel;

/** Проект (в пределах сайта). Ключ используется в номерах задач: WEB-12. */
class Project extends AppModel
{
    protected $table = 'app_rumantic_project_manager_projects';

    protected $fillable = ['key', 'name', 'description', 'lead_id', 'issue_counter', 'is_archived'];

    protected $casts = ['lead_id' => 'integer', 'issue_counter' => 'integer', 'is_archived' => 'boolean'];

    public function members(): HasMany
    {
        return $this->hasMany(Member::class, 'project_id');
    }

    public function statuses(): HasMany
    {
        return $this->hasMany(Status::class, 'project_id')->orderBy('position')->orderBy('id');
    }

    public function sprints(): HasMany
    {
        return $this->hasMany(Sprint::class, 'project_id')->orderByDesc('id');
    }
}
