<?php

namespace SitebillApps\Rumantic\ProjectManager\Models;

use Sitebill\AppSdk\AppModel;

class Comment extends AppModel
{
    protected $table = 'app_rumantic_project_manager_comments';

    protected $fillable = ['issue_id', 'user_id', 'body'];

    protected $casts = ['issue_id' => 'integer', 'user_id' => 'integer'];
}
