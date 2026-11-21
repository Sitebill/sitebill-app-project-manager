// GraphQL-запросы Менеджера проектов. Имена полей — в api/graphql/schema.graphql.
const ISSUE = `id key number project_id project_key project_name parent_id parent_key parent_title type title description
  status_id status_name status_category priority assignee_id assignee_name reporter_id reporter_name sprint_id sprint_name
  estimate due_date labels position created_at updated_at resolved_at subtasks_total subtasks_done comments_count`

const PROJECT = `id key name description is_archived my_role open_issues
  members { user_id name role }
  statuses { id name category position issue_count }
  sprints { id name goal state starts_at ends_at issue_count done_count points_total points_done }`

export const Q = {
  me: 'query TrackerMeQ { trackerMe { id name is_admin can_create_project can_search_users } }',
  projects: `query TrackerProjectsQ { trackerProjects { ${PROJECT} } }`,
  project: `query TrackerProjectQ($key: String!) { trackerProject(key: $key) { ${PROJECT} } }`,
  issues: `query TrackerIssuesQ($project_id: ID!) { trackerIssues(project_id: $project_id, limit: 2000) { ${ISSUE} } }`,
  issue: `query TrackerIssueQ($key: String!) { trackerIssue(key: $key) { ${ISSUE}
    comments { id user_id user_name body created_at can_delete }
    activity { id user_name field from_value to_value created_at }
    subtasks { ${ISSUE} } } }`,
  mine: `query TrackerMineQ { trackerMyIssues { ${ISSUE} } }`,
  users: 'query TrackerUsersQ($q: String) { trackerUsers(q: $q) { id name email } }',
  feed: 'query TrackerFeedQ($project_id: ID!) { trackerActivity(project_id: $project_id) { id user_name field from_value to_value created_at issue_key issue_title } }',
  settings: 'query TrackerSettingsQ { trackerSettings { members_can_create_projects notify } }',
}

export const M = {
  createProject: `mutation TrackerCreateProjectM($input: TrackerProjectInput!) { trackerCreateProject(input: $input) { ${PROJECT} } }`,
  updateProject: `mutation TrackerUpdateProjectM($id: ID!, $input: TrackerProjectUpdateInput!) { trackerUpdateProject(id: $id, input: $input) { ${PROJECT} } }`,
  deleteProject: 'mutation TrackerDeleteProjectM($id: ID!) { trackerDeleteProject(id: $id) }',
  setMember: `mutation TrackerSetMemberM($project_id: ID!, $user_id: Int!, $role: String!) { trackerSetMember(project_id: $project_id, user_id: $user_id, role: $role) { ${PROJECT} } }`,
  removeMember: `mutation TrackerRemoveMemberM($project_id: ID!, $user_id: Int!) { trackerRemoveMember(project_id: $project_id, user_id: $user_id) { ${PROJECT} } }`,
  saveStatus: `mutation TrackerSaveStatusM($project_id: ID!, $id: ID, $name: String!, $category: String!) { trackerSaveStatus(project_id: $project_id, id: $id, name: $name, category: $category) { ${PROJECT} } }`,
  deleteStatus: `mutation TrackerDeleteStatusM($project_id: ID!, $id: ID!, $move_to: ID) { trackerDeleteStatus(project_id: $project_id, id: $id, move_to: $move_to) { ${PROJECT} } }`,
  reorderStatuses: `mutation TrackerReorderStatusesM($project_id: ID!, $ids: [ID!]!) { trackerReorderStatuses(project_id: $project_id, ids: $ids) { ${PROJECT} } }`,
  saveSprint: `mutation TrackerSaveSprintM($project_id: ID!, $id: ID, $input: TrackerSprintInput!) { trackerSaveSprint(project_id: $project_id, id: $id, input: $input) { ${PROJECT} } }`,
  startSprint: `mutation TrackerStartSprintM($project_id: ID!, $id: ID!) { trackerStartSprint(project_id: $project_id, id: $id) { ${PROJECT} } }`,
  closeSprint: `mutation TrackerCloseSprintM($project_id: ID!, $id: ID!, $move_to: ID) { trackerCloseSprint(project_id: $project_id, id: $id, move_to: $move_to) { ${PROJECT} } }`,
  deleteSprint: `mutation TrackerDeleteSprintM($project_id: ID!, $id: ID!) { trackerDeleteSprint(project_id: $project_id, id: $id) { ${PROJECT} } }`,
  createIssue: `mutation TrackerCreateIssueM($project_id: ID!, $input: TrackerIssueCreateInput!) { trackerCreateIssue(project_id: $project_id, input: $input) { ${ISSUE} } }`,
  updateIssue: `mutation TrackerUpdateIssueM($id: ID!, $input: TrackerIssueUpdateInput!) { trackerUpdateIssue(id: $id, input: $input) { ${ISSUE} } }`,
  moveIssue: `mutation TrackerMoveIssueM($id: ID!, $status_id: ID!, $index: Int) { trackerMoveIssue(id: $id, status_id: $status_id, index: $index) { ${ISSUE} } }`,
  deleteIssue: 'mutation TrackerDeleteIssueM($id: ID!) { trackerDeleteIssue(id: $id) }',
  addComment: 'mutation TrackerAddCommentM($issue_id: ID!, $body: String!) { trackerAddComment(issue_id: $issue_id, body: $body) { id } }',
  deleteComment: 'mutation TrackerDeleteCommentM($id: ID!) { trackerDeleteComment(id: $id) }',
  saveSettings: 'mutation TrackerSaveSettingsM($input: TrackerSettingsInput!) { trackerSaveSettings(input: $input) { members_can_create_projects notify } }',
}
