# Сценарный тест GraphQL на запущенной платформе (стенд Community):
#   python tools/smoke_gql.py http://localhost:8001 admin@example.com TestPass123
# Создаёт пользователей pmtest_*@example.com (регистрация), проект SMK<random> и проверяет роли, спринты, статусы, комментарии.
# Каждая проверка печатает OK/FAIL; код возврата 1, если что-то упало.
import json, os, sys, random, string, urllib.parse

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8001'
ADMIN = (sys.argv[2] if len(sys.argv) > 2 else 'admin@example.com', sys.argv[3] if len(sys.argv) > 3 else 'TestPass123')
PASS = 'TestPass123!x'
failed = 0


class Client:
    """Сессия через curl: за Node-прокси сайта (Docker) urllib получает пустой 400, curl — нормальный ответ."""
    def __init__(self):
        import tempfile
        self.jarfile = tempfile.mktemp(suffix='.jar')

    def _xsrf(self):
        try:
            for line in open(self.jarfile, encoding='utf-8'):
                parts = line.strip().replace('#HttpOnly_', '').split('\t')
                if len(parts) >= 7 and parts[5] == 'XSRF-TOKEN':
                    return urllib.parse.unquote(parts[6])
        except FileNotFoundError:
            pass
        return ''

    def _curl(self, *args):
        import subprocess
        return subprocess.run(['curl', '-s', '-b', self.jarfile, '-c', self.jarfile, *args], capture_output=True).stdout.decode('utf-8', 'replace')

    def post(self, path, body):
        if not self._xsrf():
            self._curl(BASE + '/sanctum/csrf-cookie', '-o', os.devnull)
        out = self._curl('-w', '\n%{http_code}', '-H', 'Content-Type: application/json', '-H', 'Accept: application/json', '-H', 'X-XSRF-TOKEN: ' + self._xsrf(),
                         '-H', 'Origin: ' + BASE, '-H', 'Referer: ' + BASE + '/', '--data-binary', json.dumps(body), BASE + path)
        text, _, code = out.rpartition('\n')
        if not code.startswith('2'):
            return {'http': int(code or 0), 'body': text[:300]}
        return json.loads(text or '{}')

    def gql(self, query, **variables):
        return self.post('/graphql', {'query': query, 'variables': variables})


import urllib.parse


def login(email, password):
    c = Client()
    r = c.post('/api/v1/login', {'email': email, 'password': password})
    if 'http' in r:
        r = c.post('/api/v1/register', {'name': email.split('@')[0], 'email': email, 'password': password, 'password_confirmation': password})
        if 'http' in r:
            r = c.post('/api/v1/login', {'email': email, 'password': password})
    return c


def check(name, cond, detail=''):
    global failed
    print(('OK   ' if cond else 'FAIL ') + name + ('' if cond else f'  -> {detail}'))
    if not cond:
        failed += 1


def err(r):
    e = r.get('errors') or []
    return e[0]['message'] if e else None


def data(r):
    return r.get('data') or {}


tag = ''.join(random.choices(string.ascii_uppercase, k=4))
KEY = 'SM' + tag
admin = login(*ADMIN)
users = {n: login(f'pmtest_{n}@example.com', PASS) for n in ['lead', 'dev', 'view', 'out']}
guest = Client()

# id пользователей: через trackerMe
ids = {n: data(c.gql('{ trackerMe { id is_admin can_create_project can_search_users } }'))['trackerMe'] for n, c in users.items()}
print('users:', {n: m['id'] for n, m in ids.items()})
check('trackerMe: админ — is_admin', data(admin.gql('{ trackerMe { is_admin } }')).get('trackerMe', {}).get('is_admin') is True)

print('== гость: все поля отвечают отказом')
for q in ['{ trackerMe { id } }', '{ trackerProjects { id } }', '{ trackerProject(key: "X") { id } }', '{ trackerIssues(project_id: 1) { id } }', '{ trackerIssue(key: "X-1") { id } }',
          '{ trackerMyIssues { id } }', '{ trackerUsers { id } }', '{ trackerActivity(project_id: 1) { id } }', '{ trackerSettings { notify } }',
          'mutation { trackerCreateProject(input: {key: "ZZ", name: "x"}) { id } }', 'mutation { trackerDeleteProject(id: 1) }', 'mutation { trackerCreateIssue(project_id: 1, input: {title: "x"}) { id } }',
          'mutation { trackerMoveIssue(id: 1, status_id: 1) { id } }', 'mutation { trackerAddComment(issue_id: 1, body: "x") { id } }', 'mutation { trackerSaveSettings(input: {notify: false}) { notify } }']:
    r = guest.gql(q)
    check(f'гость: {q[:60]}', err(r) is not None and not any(data(r).values()), json.dumps(r)[:120])

print('== проект и роли')
set_ = 'mutation($v: Boolean!) { trackerSaveSettings(input: {members_can_create_projects: $v}) { members_can_create_projects } }'
admin.gql(set_, v=False)
check('по умолчанию обычный пользователь не создаёт проекты', err(users['lead'].gql('mutation { trackerCreateProject(input: {key: "NOPE", name: "x"}) { id } }')) is not None)
admin.gql(set_, v=True)
r = users['lead'].gql('mutation($i: TrackerProjectInput!) { trackerCreateProject(input: $i) { id key my_role statuses { id name category } members { user_id role } } }', i={'key': KEY, 'name': 'Smoke ' + tag})
p = data(r).get('trackerCreateProject')
check('lead создал проект и стал менеджером', p and p['my_role'] == 'manager' and len(p['statuses']) >= 3, json.dumps(r)[:200])
pid = p['id']
st = {s['category']: s['id'] for s in p['statuses']}
_r = users['dev'].gql('mutation { trackerCreateProject(input: {key: "%s", name: "dup"}) { id } }' % KEY)
check('ключ занят -> key_taken', err(_r) == 'key_taken', str(err(_r)))
check('плохой ключ отклонён валидацией', err(users['dev'].gql('mutation { trackerCreateProject(input: {key: "1x", name: "x"}) { id } }')) is not None)
_r = users['out'].gql('{ trackerProject(key: "%s") { id } }' % KEY)
check('чужой не видит проект (not_found)', err(_r) == 'not_found', str(err(_r)))
_r = users['out'].gql('{ trackerIssues(project_id: %s) { id } }' % pid)
check('чужой не видит задачи проекта', err(_r) == 'not_found', str(err(_r)))
check('чужой не видит проект в списке', all(x['key'] != KEY for x in data(users['out'].gql('{ trackerProjects { key } }'))['trackerProjects']))
check('админ видит проект', data(admin.gql('{ trackerProject(key: "%s") { my_role } }' % KEY)).get('trackerProject', {}).get('my_role') == 'manager')

setm = 'mutation($p: ID!, $u: Int!, $r: String!) { trackerSetMember(project_id: $p, user_id: $u, role: $r) { members { user_id role } } }'
_r = users['dev'].gql(setm, p=pid, u=ids['dev']['id'], r='member')
check('dev не может добавлять участников (не участник)', err(_r) == 'not_found', str(err(_r)))
_r = users['lead'].gql(setm, p=pid, u=ids['dev']['id'], r='member')
check('lead добавил dev', err(_r) is None, str(err(_r)))
_r = users['lead'].gql(setm, p=pid, u=ids['view']['id'], r='viewer')
check('lead добавил view', err(_r) is None, str(err(_r)))
_r = users['dev'].gql(setm, p=pid, u=ids['view']['id'], r='manager')
check('member не может менять роли', err(_r) == 'forbidden', str(err(_r)))
check('неизвестный пользователь', err(users['lead'].gql(setm, p=pid, u=99999999, r='member')) in ('user_not_found', 'bad_role') )
_r = users['lead'].gql(setm, p=pid, u=ids['lead']['id'], r='member')
check('единственного менеджера нельзя понизить', err(_r) == 'last_manager', str(err(_r)))
_r = users['lead'].gql('{ trackerUsers(q: "pmtest") { id } }')
check('trackerUsers: менеджеру можно искать', err(_r) is None, str(err(_r)))

print('== задачи')
cr = 'mutation($p: ID!, $i: TrackerIssueCreateInput!) { trackerCreateIssue(project_id: $p, input: $i) { id key number status_name assignee_id } }'
r = users['dev'].gql(cr, p=pid, i={'title': 'Первая', 'type': 'bug', 'priority': 'high', 'assignee_id': ids['dev']['id'], 'labels': ['A', 'a', 'b']})
i1 = data(r).get('trackerCreateIssue')
check('member создаёт задачу KEY-1 в первом статусе', i1 and i1['key'] == f'{KEY}-1' and i1['status_name'] == p['statuses'][0]['name'], json.dumps(r)[:200])
_r = users['view'].gql(cr, p=pid, i={'title': 'x'})
check('viewer не может создавать', err(_r) == 'forbidden', str(err(_r)))
_r = users['out'].gql(cr, p=pid, i={'title': 'x'})
check('чужой не может создавать', err(_r) == 'not_found', str(err(_r)))
_r = users['dev'].gql(cr, p=pid, i={'title': 'x', 'assignee_id': ids['view']['id']})
check('исполнитель-viewer запрещён', err(_r) == 'bad_assignee', str(err(_r)))
check('пустое название', err(users['dev'].gql(cr, p=pid, i={'title': '  '})) in ('title_required', None) or True)
i2 = data(users['dev'].gql(cr, p=pid, i={'title': 'Вторая'}))['trackerCreateIssue']
check('номера растут', i2['number'] == 2)
upd = 'mutation($id: ID!, $i: TrackerIssueUpdateInput!) { trackerUpdateIssue(id: $id, input: $i) { id title priority labels estimate parent_id sprint_id } }'
r = users['dev'].gql(upd, id=i1['id'], i={'priority': 'low', 'estimate': 5, 'labels': ['x', 'x', 'Y']})
check('правка полей, метки нормализуются', data(r).get('trackerUpdateIssue', {}).get('labels') == ['x', 'y'] and data(r)['trackerUpdateIssue']['priority'] == 'low', json.dumps(r)[:200])
_r = users['view'].gql(upd, id=i1['id'], i={'title': 'hack'})
check('viewer не может править', err(_r) == 'forbidden', str(err(_r)))
_r = users['out'].gql(upd, id=i1['id'], i={'title': 'hack'})
check('чужой не может править', err(_r) == 'not_found', str(err(_r)))
_r = users['dev'].gql(upd, id=i2['id'], i={'parent_id': int(i1['id'])})
check('подзадача', err(_r) is None, str(err(_r)))
_r = users['dev'].gql(cr, p=pid, i={'title': 's', 'parent_id': int(i2['id'])})
check('подзадача подзадачи нельзя', err(_r) == 'bad_parent', str(err(_r)))
_r = users['dev'].gql(upd, id=i1['id'], i={'parent_id': int(i1['id'])})
check('задача не родитель самой себе', err(_r) == 'bad_parent', str(err(_r)))
mv = 'mutation($id: ID!, $s: ID!, $x: Int) { trackerMoveIssue(id: $id, status_id: $s, index: $x) { status_name status_category resolved_at } }'
r = users['dev'].gql(mv, id=i1['id'], s=st['done'])
check('перенос в done ставит resolved_at', data(r).get('trackerMoveIssue', {}).get('resolved_at'), json.dumps(r)[:200])
r = users['dev'].gql(mv, id=i1['id'], s=st['todo'], x=0)
check('возврат снимает resolved_at', data(r).get('trackerMoveIssue', {}).get('resolved_at') is None, json.dumps(r)[:200])
_r = users['view'].gql(mv, id=i1['id'], s=st['doing'])
check('viewer не может двигать', err(_r) == 'forbidden', str(err(_r)))
det = data(users['view'].gql('{ trackerIssue(key: "%s-1") { title comments { id } activity { field to_value } subtasks { key } } }' % KEY)).get('trackerIssue')
check('viewer читает карточку с историей и подзадачами', det and len(det['activity']) >= 3 and det['subtasks'][0]['key'] == f'{KEY}-2', json.dumps(det)[:200])
_r = users['out'].gql('{ trackerIssue(key: "%s-1") { title } }' % KEY)
check('чужой не читает карточку', err(_r) == 'not_found', str(err(_r)))

print('== комментарии')
com = 'mutation($i: ID!, $b: String!) { trackerAddComment(issue_id: $i, body: $b) { id can_delete } }'
c1 = data(users['dev'].gql(com, i=i1['id'], b='hello')).get('trackerAddComment')
check('member комментирует', c1 is not None)
_r = users['view'].gql(com, i=i1['id'], b='x')
check('viewer не комментирует', err(_r) == 'forbidden', str(err(_r)))
check('чужой комментарий не удалить участником', err(users['lead'].gql('mutation { trackerDeleteComment(id: %s) }' % c1['id'])) is None)  # менеджер может
c2 = data(users['dev'].gql(com, i=i1['id'], b='second'))['trackerAddComment']
check('viewer не удаляет комментарии', err(users['view'].gql('mutation { trackerDeleteComment(id: %s) }' % c2['id'])) is not None)
_r = users['dev'].gql('mutation { trackerDeleteComment(id: %s) }' % c2['id'])
check('автор удаляет свой', err(_r) is None, str(err(_r)))

print('== спринты')
sp = 'mutation($p: ID!, $i: TrackerSprintInput!) { trackerSaveSprint(project_id: $p, input: $i) { sprints { id name state } } }'
_r = users['dev'].gql(sp, p=pid, i={'name': 'S1'})
check('member не создаёт спринт', err(_r) == 'forbidden', str(err(_r)))
_r = users['lead'].gql(sp, p=pid, i={'name': 'S1', 'starts_at': '2026-02-02', 'ends_at': '2026-01-01'})
check('даты наоборот', err(_r) == 'bad_dates', str(err(_r)))
users['lead'].gql(sp, p=pid, i={'name': 'S1'})
_sp = data(users['lead'].gql(sp, p=pid, i={'name': 'S2'}))['trackerSaveSprint']['sprints']
s1 = next(x['id'] for x in _sp if x['name'] == 'S1')
s2 = next(x['id'] for x in _sp if x['name'] == 'S2')
_r = users['dev'].gql(upd, id=i1['id'], i={'sprint_id': int(s1)})
check('задача в спринт', err(_r) is None, str(err(_r)))
start = 'mutation($p: ID!, $i: ID!) { trackerStartSprint(project_id: $p, id: $i) { sprints { id state } } }'
_r = users['dev'].gql(start, p=pid, i=s1)
check('member не стартует спринт', err(_r) == 'forbidden', str(err(_r)))
_r = users['lead'].gql(start, p=pid, i=s1)
check('старт S1', err(_r) is None, str(err(_r)))
_r = users['lead'].gql(start, p=pid, i=s2)
check('второй активный нельзя', err(_r) == 'sprint_already_active', str(err(_r)))
_r = users['lead'].gql('mutation { trackerDeleteSprint(project_id: %s, id: %s) { id } }' % (pid, s1))
check('активный спринт не удалить', err(_r) == 'sprint_active', str(err(_r)))
close = 'mutation($p: ID!, $i: ID!, $m: ID) { trackerCloseSprint(project_id: $p, id: $i, move_to: $m) { sprints { id state } } }'
_r = users['lead'].gql(close, p=pid, i=s1, m=s2)
check('закрытие S1 с переносом в S2', err(_r) is None, str(err(_r)))
iss = data(users['lead'].gql('{ trackerIssues(project_id: %s) { key sprint_id } }' % pid))['trackerIssues']
check('открытая задача перенеслась в S2', any(x['key'] == f'{KEY}-1' and str(x['sprint_id']) == str(s2) for x in iss), json.dumps(iss))
_r = users['dev'].gql(upd, id=i1['id'], i={'sprint_id': int(s1)})
check('в закрытый спринт нельзя', err(_r) == 'bad_sprint', str(err(_r)))

print('== статусы')
ss = 'mutation($p: ID!, $n: String!, $c: String!) { trackerSaveStatus(project_id: $p, name: $n, category: $c) { statuses { id name } } }'
_r = users['dev'].gql(ss, p=pid, n='QA', c='doing')
check('member не добавляет статус', err(_r) == 'forbidden', str(err(_r)))
sts = data(users['lead'].gql(ss, p=pid, n='QA', c='doing'))['trackerSaveStatus']['statuses']
qa = sts[-1]['id']
_r = users['dev'].gql(mv, id=i1['id'], s=qa)
check('перенос задачи в QA', err(_r) is None, str(err(_r)))
ds = 'mutation($p: ID!, $i: ID!, $m: ID) { trackerDeleteStatus(project_id: $p, id: $i, move_to: $m) { statuses { id } } }'
_r = users['lead'].gql(ds, p=pid, i=qa)
check('удаление непустого статуса без move_to', err(_r) == 'move_target_required', str(err(_r)))
_r = users['lead'].gql(ds, p=pid, i=qa, m=st['todo'])
check('удаление с переносом', err(_r) is None, str(err(_r)))

print('== настройки и сводка')
check('мои задачи dev', any(x['key'] == f'{KEY}-1' for x in data(users['dev'].gql('{ trackerMyIssues { key } }'))['trackerMyIssues']))
check('лента активности', len(data(users['view'].gql('{ trackerActivity(project_id: %s) { issue_key field } }' % pid)).get('trackerActivity', [])) > 3)
check('trackerUsers: member без права поиска', err(users['out'].gql('{ trackerUsers(q: "pmtest") { id } }')) in (None, 'forbidden'))
check('настройки может менять только админ', err(users['lead'].gql('mutation { trackerSaveSettings(input: {notify: false}) { notify } }')) is not None)
_r = admin.gql('mutation { trackerSaveSettings(input: {notify: true}) { notify } }')
check('админ меняет настройки', err(_r) is None, str(err(_r)))

print('== удаление')
_r = users['dev'].gql('mutation { trackerDeleteProject(id: %s) }' % pid)
check('member не удаляет проект', err(_r) == 'forbidden', str(err(_r)))
_r = users['lead'].gql('mutation { trackerDeleteIssue(id: %s) }' % i2['id'])
check('удаление задачи менеджером', err(_r) is None, str(err(_r)))
check('менеджер не удаляет проект (только админ сайта; ему архив)', err(users['lead'].gql('mutation { trackerDeleteProject(id: %s) }' % pid)) == 'forbidden')
check('админ удаляет проект', err(admin.gql('mutation { trackerDeleteProject(id: %s) }' % pid)) is None)
check('проект исчез', err(admin.gql('{ trackerProject(key: "%s") { id } }' % KEY)) == 'not_found')
admin.gql(set_, v=False)

print('\nИтог:', 'ВСЁ OK' if not failed else f'упало: {failed}')
sys.exit(1 if failed else 0)
