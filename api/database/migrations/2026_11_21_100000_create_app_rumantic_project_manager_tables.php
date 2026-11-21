<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('app_rumantic_project_manager_projects', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id')->index();
            // Ключ проекта в номерах задач: WEB-12
            $table->string('key', 8);
            $table->string('name', 120);
            $table->text('description')->nullable();
            $table->unsignedBigInteger('lead_id')->nullable();
            // Счётчик номеров задач проекта (растёт под блокировкой строки проекта)
            $table->unsignedInteger('issue_counter')->default(0);
            $table->boolean('is_archived')->default(false);
            $table->timestamps();
            $table->unique(['tenant_id', 'key'], 'app_rumantic_pm_projects_key');
        });

        Schema::create('app_rumantic_project_manager_members', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id')->index();
            $table->unsignedBigInteger('project_id');
            $table->unsignedBigInteger('user_id');
            // manager | member | viewer
            $table->string('role', 10)->default('member');
            $table->timestamps();
            $table->unique(['project_id', 'user_id'], 'app_rumantic_pm_members_uniq');
            $table->index(['tenant_id', 'user_id'], 'app_rumantic_pm_members_user');
        });

        Schema::create('app_rumantic_project_manager_statuses', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id')->index();
            $table->unsignedBigInteger('project_id')->index();
            $table->string('name', 60);
            // todo | doing | done — «закрыта» задача по категории, а не по названию колонки
            $table->string('category', 6)->default('todo');
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
        });

        Schema::create('app_rumantic_project_manager_sprints', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id')->index();
            $table->unsignedBigInteger('project_id')->index();
            $table->string('name', 100);
            $table->string('goal', 300)->nullable();
            // planned | active | closed
            $table->string('state', 8)->default('planned');
            $table->date('starts_at')->nullable();
            $table->date('ends_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->timestamps();
        });

        Schema::create('app_rumantic_project_manager_issues', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id')->index();
            $table->unsignedBigInteger('project_id');
            $table->unsignedInteger('number');
            $table->unsignedBigInteger('parent_id')->nullable();
            // task | bug | story | improvement
            $table->string('type', 12)->default('task');
            $table->string('title', 250);
            $table->text('description')->nullable();
            $table->unsignedBigInteger('status_id');
            // lowest | low | medium | high | highest
            $table->string('priority', 8)->default('medium');
            $table->unsignedBigInteger('assignee_id')->nullable();
            $table->unsignedBigInteger('reporter_id')->nullable();
            $table->unsignedBigInteger('sprint_id')->nullable();
            $table->unsignedSmallInteger('estimate')->nullable();
            $table->date('due_date')->nullable();
            $table->json('labels')->nullable();
            // порядок внутри колонки статуса
            $table->unsignedInteger('position')->default(0);
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();
            $table->unique(['project_id', 'number'], 'app_rumantic_pm_issues_num');
            $table->index(['tenant_id', 'project_id', 'status_id'], 'app_rumantic_pm_issues_status');
            $table->index(['tenant_id', 'assignee_id'], 'app_rumantic_pm_issues_assignee');
            $table->index(['tenant_id', 'sprint_id'], 'app_rumantic_pm_issues_sprint');
        });

        Schema::create('app_rumantic_project_manager_comments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id')->index();
            $table->unsignedBigInteger('issue_id')->index();
            $table->unsignedBigInteger('user_id');
            $table->text('body');
            $table->timestamps();
        });

        // История изменений задачи: одна строка = одно поле
        Schema::create('app_rumantic_project_manager_activity', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id')->index();
            $table->unsignedBigInteger('project_id');
            $table->unsignedBigInteger('issue_id')->index();
            $table->unsignedBigInteger('user_id')->nullable();
            // created | status | assignee | priority | ... или comment
            $table->string('field', 20);
            $table->string('from_value', 250)->nullable();
            $table->string('to_value', 250)->nullable();
            $table->timestamp('created_at')->nullable();
            $table->index(['tenant_id', 'project_id', 'created_at'], 'app_rumantic_pm_activity_feed');
        });
    }

    public function down(): void
    {
        foreach (['activity', 'comments', 'issues', 'sprints', 'statuses', 'members', 'projects'] as $t) {
            Schema::dropIfExists('app_rumantic_project_manager_'.$t);
        }
    }
};
