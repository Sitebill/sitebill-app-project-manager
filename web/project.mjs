// Экран проекта: доска (drag&drop), бэклог со спринтами, список задач, вкладки «Команда» и «Настройки».
import { Q, M } from './api.mjs'
import { PRIORITIES, TYPES, CATEGORY_COLOR, safe, avatar, typeIcon, priorityIcon, label, select, modal, useEscape, formatDate, isOverdue, labelChips } from './ui.mjs'
import { IssueModal, CreateIssueModal } from './issue.mjs'
import { TeamTab, SettingsTab } from './manage.mjs'

const { defineComponent, h, ref, reactive, computed, onMounted, watch } = globalThis.__SB_HOST__.vue

const byPosition = (a, b) => a.position - b.position || Number(a.id) - Number(b.id)
const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p, i) => [p, i]))

// ---------------------------------------------------------------- окно спринта
const SprintModal = defineComponent({
  name: 'TrackerSprintModal',
  props: { host: Object, project: Object, sprint: { default: null }, onClose: Function, onSaved: Function },
  setup(props) {
    const { host } = props
    const { UButton, UInput } = host.components
    const f = reactive({ name: props.sprint?.name || '', goal: props.sprint?.goal || '', starts_at: props.sprint?.starts_at || '', ends_at: props.sprint?.ends_at || '' })
    useEscape(() => props.onClose())
    async function save() {
      const data = await safe(host, () => host.gql(M.saveSprint, { project_id: props.project.id, id: props.sprint?.id ?? null, input: { name: f.name, goal: f.goal || null, starts_at: f.starts_at || null, ends_at: f.ends_at || null } }))
      if (data) props.onSaved(data.trackerSaveSprint)
    }
    const date = (key) => h('input', { type: 'date', value: f[key], class: 'w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-2 py-1.5 text-sm', onInput: e => f[key] = e.target.value })
    return () => modal(host, { title: props.sprint ? host.t('edit_sprint') : host.t('new_sprint'), onClose: props.onClose }, [
      h('form', { class: 'space-y-3', onSubmit: e => { e.preventDefault(); save() } }, [
        label(host.t('f_name'), h(UInput, { modelValue: f.name, 'onUpdate:modelValue': v => f.name = v, class: 'w-full', autofocus: true, maxlength: 100 })),
        label(host.t('f_goal'), h(UInput, { modelValue: f.goal, 'onUpdate:modelValue': v => f.goal = v, class: 'w-full', maxlength: 300 })),
        h('div', { class: 'grid grid-cols-2 gap-3' }, [label(host.t('f_starts'), date('starts_at')), label(host.t('f_ends'), date('ends_at'))]),
        h('div', { class: 'flex justify-end gap-2 pt-2' }, [
          h(UButton, { color: 'neutral', variant: 'ghost', onClick: props.onClose }, () => host.t('cancel')),
          h(UButton, { type: 'submit' }, () => host.t('save')),
        ]),
      ]),
    ])
  },
})

/** Завершение спринта: что делать с незавершёнными задачами. */
const CloseSprintModal = defineComponent({
  name: 'TrackerCloseSprintModal',
  props: { host: Object, project: Object, sprint: Object, onClose: Function, onDone: Function },
  setup(props) {
    const { host } = props
    const { UButton } = host.components
    const open = props.sprint.issue_count - props.sprint.done_count
    const target = ref('')
    useEscape(() => props.onClose())
    async function submit() {
      const data = await safe(host, () => host.gql(M.closeSprint, { project_id: props.project.id, id: props.sprint.id, move_to: target.value || null }))
      if (data) props.onDone(data.trackerCloseSprint)
    }
    const options = [['', host.t('backlog')], ...props.project.sprints.filter(s => s.state === 'planned' && s.id !== props.sprint.id).map(s => [s.id, s.name])]
    return () => modal(host, { title: `${host.t('complete_sprint')}: ${props.sprint.name}`, onClose: props.onClose }, [
      h('div', { class: 'space-y-3' }, [
        h('p', { class: 'text-sm' }, `${host.t('sprint_done_stat')}: ${props.sprint.done_count}/${props.sprint.issue_count}`),
        open > 0 ? label(`${host.t('move_open_to')} (${open})`, select(target.value, options, v => target.value = v ?? '')) : null,
        h('div', { class: 'flex justify-end gap-2 pt-2' }, [
          h(UButton, { color: 'neutral', variant: 'ghost', onClick: props.onClose }, () => host.t('cancel')),
          h(UButton, { onClick: submit }, () => host.t('complete_sprint')),
        ]),
      ]),
    ])
  },
})

// ---------------------------------------------------------------- проект
export const ProjectView = defineComponent({
  name: 'TrackerProjectView',
  props: { host: { type: Object, required: true }, me: { type: Object, required: true }, projectKey: { type: String, required: true }, tab: { type: String, default: 'board' }, openKey: { default: null } },
  setup(props) {
    const { host } = props
    const { UButton, UInput, UBadge } = host.components
    const project = ref(null)
    const issues = ref([])
    const failed = ref(false)
    const loading = ref(true)
    const f = reactive({ q: '', assignee: '', type: '', priority: '', label: '' })
    const boardSprint = ref('auto')
    const creating = ref(null) // { sprintId, statusId }
    const sprintModal = ref(null) // { sprint|null }
    const closing = ref(null)
    const quick = reactive({})
    const drag = reactive({ id: null, overStatus: null, overSprint: undefined, index: null })
    const sort = ref('position')

    const role = computed(() => project.value?.my_role)
    const canEdit = computed(() => ['manager', 'member'].includes(role.value))
    const isManager = computed(() => role.value === 'manager')
    const activeSprint = computed(() => project.value?.sprints.find(s => s.state === 'active') || null)

    async function loadIssues() {
      const data = await safe(host, () => host.gql(Q.issues, { project_id: project.value.id }))
      if (data) issues.value = data.trackerIssues
    }
    async function load() {
      loading.value = true
      const data = await safe(host, () => host.gql(Q.project, { key: props.projectKey }))
      if (!data) { failed.value = true; loading.value = false; return }
      project.value = data.trackerProject
      failed.value = false
      await loadIssues()
      loading.value = false
    }
    onMounted(load)
    watch(() => props.projectKey, load)
    const applyProject = (p) => { project.value = p }
    /** Проект перечитывается вместе с задачами: счётчики и спринты меняются от любой правки. */
    const refresh = async () => {
      const data = await safe(host, () => host.gql(Q.project, { key: props.projectKey }))
      if (data) project.value = data.trackerProject
      await loadIssues()
    }
    const go = (hash) => { location.hash = hash }
    const openIssue = (key) => go(`#/i/${key}`)
    const closeIssue = () => go(`#/p/${props.projectKey}/${props.tab}`)

    const filtered = computed(() => issues.value.filter((i) => {
      if (f.q) {
        const q = f.q.toLowerCase()
        if (!i.title.toLowerCase().includes(q) && !i.key.toLowerCase().includes(q)) return false
      }
      if (f.assignee === 'none' ? i.assignee_id : (f.assignee && String(i.assignee_id) !== f.assignee)) return false
      if (f.type && i.type !== f.type) return false
      if (f.priority && i.priority !== f.priority) return false
      if (f.label && !(i.labels || []).includes(f.label)) return false
      return true
    }))
    const allLabels = computed(() => [...new Set(issues.value.flatMap(i => i.labels || []))].sort())

    // ---- фильтры
    const filterBar = () => h('div', { class: 'flex flex-wrap items-center gap-2' }, [
      h(UInput, { modelValue: f.q, 'onUpdate:modelValue': v => f.q = v, icon: 'i-lucide-search', placeholder: host.t('search'), class: 'w-48', size: 'sm' }),
      select(f.assignee, [['', host.t('all_assignees')], ['none', host.t('unassigned')], ...project.value.members.map(m => [m.user_id, m.name])], v => f.assignee = v ?? '', { cls: '!w-auto' }),
      select(f.type, [['', host.t('all_types')], ...TYPES.map(v => [v, host.t(`type_${v}`)])], v => f.type = v ?? '', { cls: '!w-auto' }),
      select(f.priority, [['', host.t('all_priorities')], ...PRIORITIES.map(v => [v, host.t(`priority_${v}`)])], v => f.priority = v ?? '', { cls: '!w-auto' }),
      allLabels.value.length ? select(f.label, [['', host.t('all_labels')], ...allLabels.value.map(l => [l, l])], v => f.label = v ?? '', { cls: '!w-auto' }) : null,
      (f.q || f.assignee || f.type || f.priority || f.label) ? h('button', { type: 'button', class: 'text-sm text-primary hover:underline', onClick: () => Object.assign(f, { q: '', assignee: '', type: '', priority: '', label: '' }) }, host.t('reset')) : null,
    ])

    // ---- карточка на доске
    const card = (i) => h('div', {
      key: i.id, 'data-card': i.id, draggable: canEdit.value, role: 'button', tabindex: 0,
      class: `cursor-pointer space-y-2 rounded-lg border border-(--ui-border) bg-(--ui-bg) p-2.5 text-sm shadow-sm hover:border-primary/50 ${drag.id === i.id ? 'opacity-40' : ''}`,
      onDragstart: (e) => { drag.id = i.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i.id)) },
      onDragend: () => { drag.id = null; drag.overStatus = null },
      onClick: () => openIssue(i.key),
      onKeydown: (e) => { if (e.key === 'Enter') openIssue(i.key) },
    }, [
      h('div', { class: 'break-words font-medium text-highlighted' }, i.title),
      i.parent_key ? h('div', { class: 'truncate text-xs text-muted' }, `↳ ${i.parent_key} ${i.parent_title}`) : null,
      (i.labels || []).length ? h('div', { class: 'flex flex-wrap gap-1' }, labelChips(i.labels)) : null,
      h('div', { class: 'flex items-center gap-2 text-xs text-muted' }, [
        typeIcon(host, i.type), h('span', { class: 'font-mono' }, i.key), priorityIcon(host, i.priority),
        i.estimate != null ? h('span', { class: 'rounded-full bg-(--ui-bg-elevated) px-1.5' }, i.estimate) : null,
        i.due_date ? h('span', { class: isOverdue(i) ? 'text-error' : '' }, formatDate(host, i.due_date)) : null,
        i.subtasks_total ? h('span', { title: host.t('subtasks') }, `⊞ ${i.subtasks_done}/${i.subtasks_total}`) : null,
        i.comments_count ? h('span', {}, `💬 ${i.comments_count}`) : null,
        i.assignee_name ? h('span', { class: 'ml-auto' }, avatar(i.assignee_name)) : null,
      ]),
    ])

    /** Перенос карточки: индекс считается по видимым карточкам, на сервер уходит индекс в полной колонке. */
    async function dropOn(statusId, visibleIndex, visibleCards) {
      const id = drag.id
      drag.id = null; drag.overStatus = null
      const dragged = issues.value.find(i => i.id === id)
      if (!dragged || !canEdit.value) return
      const status = project.value.statuses.find(s => String(s.id) === String(statusId))
      const next = visibleCards[visibleIndex]
      const full = issues.value.filter(i => String(i.status_id) === String(statusId) && i.id !== id).sort(byPosition)
      const serverIndex = next ? full.findIndex(i => i.id === next.id) : null
      // оптимистично: сразу переставляем локально
      const order = [...full]
      order.splice(serverIndex === null ? order.length : serverIndex, 0, dragged)
      Object.assign(dragged, { status_id: Number(status.id), status_name: status.name, status_category: status.category })
      order.forEach((x, pos) => { x.position = pos })
      issues.value = [...issues.value]
      const data = await safe(host, () => host.gql(M.moveIssue, { id, status_id: statusId, index: serverIndex }))
      await refresh()
      return data
    }

    function onColumnDragOver(e, statusId, cards) {
      if (drag.id === null) return
      e.preventDefault()
      const els = [...e.currentTarget.querySelectorAll('[data-card]')].filter(c => c.dataset.card !== String(drag.id))
      let idx = els.length
      for (let k = 0; k < els.length; k++) {
        const r = els[k].getBoundingClientRect()
        if (e.clientY < r.top + r.height / 2) { idx = k; break }
      }
      drag.overStatus = statusId; drag.index = idx
    }

    // ---- доска
    const board = () => {
      const sel = boardSprint.value
      let list = filtered.value
      const sprintId = sel === 'auto' ? activeSprint.value?.id : (sel === 'all' ? null : sel)
      if (sprintId) list = list.filter(i => String(i.sprint_id) === String(sprintId))
      const open = project.value.sprints.filter(s => s.state !== 'closed')
      return h('div', { class: 'space-y-3' }, [
        h('div', { class: 'flex flex-wrap items-center gap-2' }, [
          select(sel, [['auto', activeSprint.value ? `${host.t('sprint')}: ${activeSprint.value.name}` : host.t('all_issues')], ['all', host.t('all_issues')], ...open.map(s => [s.id, s.name])], v => boardSprint.value = v ?? 'auto', { cls: '!w-auto' }),
          activeSprint.value && sel === 'auto' && activeSprint.value.ends_at ? h('span', { class: 'text-xs text-muted' }, `${host.t('f_ends')}: ${formatDate(host, activeSprint.value.ends_at)}`) : null,
          h('div', { class: 'flex-1' }),
          canEdit.value ? h(UButton, { size: 'sm', icon: 'i-lucide-plus', onClick: () => creating.value = { sprintId: sprintId || null } }, () => host.t('new_issue')) : null,
        ]),
        filterBar(),
        h('div', { class: 'flex gap-3 overflow-x-auto pb-3' }, project.value.statuses.map((s) => {
          const cards = list.filter(i => String(i.status_id) === String(s.id)).sort(byPosition)
          const over = drag.overStatus === s.id
          return h('div', {
            key: s.id, class: `flex w-72 shrink-0 flex-col rounded-xl bg-(--ui-bg-elevated)/60 p-2 ${over ? 'ring-2 ring-primary/60' : ''}`,
            onDragover: e => onColumnDragOver(e, s.id, cards), onDragleave: e => { if (!e.currentTarget.contains(e.relatedTarget)) drag.overStatus = null },
            onDrop: (e) => { e.preventDefault(); dropOn(s.id, drag.index ?? cards.length, cards.filter(c => c.id !== drag.id)) },
          }, [
            h('div', { class: 'mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted' }, [
              h('span', { class: `size-2 rounded-full ${s.category === 'done' ? 'bg-success' : s.category === 'doing' ? 'bg-primary' : 'bg-(--ui-border-accented)'}` }),
              h('span', { class: 'truncate' }, s.name), h('span', {}, cards.length),
            ]),
            h('div', { class: 'min-h-12 flex-1 space-y-2' }, cards.map(card)),
            canEdit.value ? h('button', { type: 'button', class: 'mt-2 rounded-md px-2 py-1 text-left text-xs text-muted hover:bg-(--ui-bg-elevated)', onClick: () => creating.value = { statusId: s.id, sprintId: sprintId || null } }, `+ ${host.t('create')}`) : null,
          ])
        })),
      ])
    }

    // ---- бэклог
    async function moveToSprint(issueId, sprintId) {
      const issue = issues.value.find(i => i.id === issueId)
      if (!issue || String(issue.sprint_id ?? '') === String(sprintId ?? '')) return
      if (await safe(host, () => host.gql(M.updateIssue, { id: issueId, input: { sprint_id: sprintId ? Number(sprintId) : null } }))) await refresh()
    }
    async function quickAdd(sprintId) {
      const key = String(sprintId ?? 'b')
      const title = (quick[key] || '').trim()
      if (!title) return
      const data = await safe(host, () => host.gql(M.createIssue, { project_id: project.value.id, input: { title, sprint_id: sprintId ? Number(sprintId) : null } }))
      if (data) { quick[key] = ''; await refresh() }
    }
    async function sprintAction(kind, s) {
      const m = { start: M.startSprint, delete: M.deleteSprint }[kind]
      if (kind === 'delete' && !window.confirm(host.t('confirm_delete_sprint'))) return
      const data = await safe(host, () => host.gql(m, { project_id: project.value.id, id: s.id }))
      if (data) { applyProject(Object.values(data)[0]); await refresh() }
    }

    const row = (i) => h('div', {
      key: i.id, draggable: canEdit.value, role: 'button', tabindex: 0,
      class: `flex cursor-pointer items-center gap-2 border-b border-(--ui-border) px-3 py-1.5 text-sm last:border-0 hover:bg-(--ui-bg-elevated) ${drag.id === i.id ? 'opacity-40' : ''}`,
      onDragstart: (e) => { drag.id = i.id; e.dataTransfer.setData('text/plain', String(i.id)) }, onDragend: () => { drag.id = null; drag.overSprint = undefined },
      onClick: () => openIssue(i.key), onKeydown: e => { if (e.key === 'Enter') openIssue(i.key) },
    }, [
      typeIcon(host, i.type), h('span', { class: 'w-20 shrink-0 font-mono text-xs text-muted' }, i.key),
      h('span', { class: `min-w-0 flex-1 truncate ${i.status_category === 'done' ? 'text-muted line-through' : ''}` }, i.title),
      ...labelChips(i.labels),
      h(UBadge, { color: CATEGORY_COLOR[i.status_category], variant: 'subtle', size: 'sm' }, () => i.status_name),
      i.estimate != null ? h('span', { class: 'rounded-full bg-(--ui-bg-elevated) px-1.5 text-xs' }, i.estimate) : null,
      priorityIcon(host, i.priority),
      i.assignee_name ? avatar(i.assignee_name) : h('span', { class: 'size-6' }),
    ])

    const section = (sprint) => {
      const sid = sprint ? sprint.id : null
      const list = filtered.value.filter(i => String(i.sprint_id ?? '') === String(sid ?? '')).sort(byPosition)
      const total = issues.value.filter(i => String(i.sprint_id ?? '') === String(sid ?? '')).length
      const over = drag.overSprint === (sid ?? 'b')
      return h('section', {
        key: sid ?? 'backlog', class: `rounded-xl border border-(--ui-border) ${over ? 'ring-2 ring-primary/60' : ''}`,
        onDragover: e => { if (drag.id !== null) { e.preventDefault(); drag.overSprint = sid ?? 'b' } },
        onDragleave: e => { if (!e.currentTarget.contains(e.relatedTarget)) drag.overSprint = undefined },
        onDrop: (e) => { e.preventDefault(); const id = drag.id; drag.id = null; drag.overSprint = undefined; moveToSprint(id, sid) },
      }, [
        h('div', { class: 'flex flex-wrap items-center gap-2 rounded-t-xl bg-(--ui-bg-elevated) px-3 py-2' }, [
          h('h3', { class: 'font-semibold text-highlighted' }, sprint ? sprint.name : host.t('backlog')),
          sprint ? h(UBadge, { color: sprint.state === 'active' ? 'primary' : 'neutral', variant: 'subtle', size: 'sm' }, () => host.t(`sprint_${sprint.state}`)) : null,
          sprint && (sprint.starts_at || sprint.ends_at) ? h('span', { class: 'text-xs text-muted' }, `${formatDate(host, sprint.starts_at)} – ${formatDate(host, sprint.ends_at)}`) : null,
          h('span', { class: 'text-xs text-muted' }, `${total} ${host.t('issues_short')}${sprint ? ` · ${sprint.points_done}/${sprint.points_total} ${host.t('points')}` : ''}`),
          sprint?.goal ? h('span', { class: 'hidden truncate text-xs italic text-muted md:inline' }, sprint.goal) : null,
          h('div', { class: 'flex-1' }),
          sprint && isManager.value ? h('div', { class: 'flex gap-1' }, [
            sprint.state === 'planned' ? h(UButton, { size: 'xs', variant: 'soft', disabled: !!activeSprint.value, title: activeSprint.value ? host.t('err_sprint_already_active') : '', onClick: () => sprintAction('start', sprint) }, () => host.t('start_sprint')) : null,
            sprint.state === 'active' ? h(UButton, { size: 'xs', variant: 'soft', onClick: () => closing.value = sprint }, () => host.t('complete_sprint')) : null,
            sprint.state !== 'closed' ? h(UButton, { size: 'xs', color: 'neutral', variant: 'ghost', icon: 'i-lucide-pencil', 'aria-label': host.t('edit'), onClick: () => sprintModal.value = { sprint } }) : null,
            sprint.state === 'planned' ? h(UButton, { size: 'xs', color: 'neutral', variant: 'ghost', icon: 'i-lucide-trash-2', 'aria-label': host.t('delete'), onClick: () => sprintAction('delete', sprint) }) : null,
          ]) : null,
        ]),
        list.length ? h('div', {}, list.map(row)) : h('p', { class: 'px-3 py-4 text-center text-sm text-muted' }, sprint ? host.t('sprint_empty') : host.t('backlog_empty')),
        canEdit.value ? h('form', { class: 'border-t border-(--ui-border) p-2', onSubmit: e => { e.preventDefault(); quickAdd(sid) } }, [
          h('input', { value: quick[String(sid ?? 'b')] || '', placeholder: `+ ${host.t('quick_add')}`, class: 'w-full rounded-md bg-transparent px-2 py-1 text-sm outline-none focus:bg-(--ui-bg-elevated)', onInput: e => quick[String(sid ?? 'b')] = e.target.value }),
        ]) : null,
      ])
    }

    const backlog = () => {
      const open = project.value.sprints.filter(s => s.state !== 'closed').sort((a, b) => (a.state === 'active' ? -1 : 1) - (b.state === 'active' ? -1 : 1) || Number(a.id) - Number(b.id))
      const closed = project.value.sprints.filter(s => s.state === 'closed')
      return h('div', { class: 'space-y-3' }, [
        h('div', { class: 'flex flex-wrap items-center gap-2' }, [filterBar(), h('div', { class: 'flex-1' }), isManager.value ? h(UButton, { size: 'sm', variant: 'soft', icon: 'i-lucide-plus', onClick: () => sprintModal.value = { sprint: null } }, () => host.t('new_sprint')) : null]),
        ...open.map(section), section(null),
        closed.length ? h('details', { class: 'text-sm' }, [
          h('summary', { class: 'cursor-pointer text-muted' }, `${host.t('closed_sprints')} (${closed.length})`),
          h('ul', { class: 'mt-2 space-y-1' }, closed.map(s => h('li', { key: s.id, class: 'flex gap-3 rounded-lg border border-(--ui-border) px-3 py-1.5' }, [
            h('span', { class: 'font-medium' }, s.name), h('span', { class: 'text-muted' }, `${s.done_count}/${s.issue_count} · ${s.points_done}/${s.points_total} ${host.t('points')}`),
            h('span', { class: 'text-xs text-muted' }, `${formatDate(host, s.starts_at)} – ${formatDate(host, s.ends_at)}`),
          ]))),
        ]) : null,
      ])
    }

    // ---- список
    const listTab = () => {
      const rows = [...filtered.value].sort((a, b) => {
        if (sort.value === 'priority') return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        if (sort.value === 'updated') return b.updated_at.localeCompare(a.updated_at)
        if (sort.value === 'due') return (a.due_date || '9999').localeCompare(b.due_date || '9999')
        return b.number - a.number
      })
      return h('div', { class: 'space-y-3' }, [
        h('div', { class: 'flex flex-wrap items-center gap-2' }, [filterBar(), h('div', { class: 'flex-1' }),
          select(sort.value, [['position', host.t('sort_new')], ['priority', host.t('sort_priority')], ['updated', host.t('sort_updated')], ['due', host.t('sort_due')]], v => sort.value = v ?? 'position', { cls: '!w-auto' }),
          canEdit.value ? h(UButton, { size: 'sm', icon: 'i-lucide-plus', onClick: () => creating.value = {} }, () => host.t('new_issue')) : null]),
        h('div', { class: 'overflow-hidden rounded-xl border border-(--ui-border)' }, rows.length ? rows.map(row) : [h('p', { class: 'p-6 text-center text-sm text-muted' }, host.t('no_issues'))]),
        h('p', { class: 'text-xs text-muted' }, `${rows.length} / ${issues.value.length}`),
      ])
    }

    const tabs = [['board', 'tab_board', 'i-lucide-kanban-square'], ['backlog', 'tab_backlog', 'i-lucide-list-todo'], ['list', 'tab_list', 'i-lucide-list'], ['team', 'tab_team', 'i-lucide-users'], ['settings', 'tab_settings', 'i-lucide-settings']]

    return () => {
      if (failed.value) return h('div', { class: 'space-y-3' }, [h('p', { class: 'text-muted' }, host.t('err_not_found')), h('a', { href: '#/', class: 'text-primary hover:underline' }, host.t('all_projects'))])
      if (!project.value) return h('p', { class: 'text-sm text-muted' }, host.t('loading'))
      const p = project.value
      const visibleTabs = tabs.filter(([k]) => k !== 'settings' || isManager.value)
      const tab = visibleTabs.some(([k]) => k === props.tab) ? props.tab : 'board'
      return h('div', { class: 'space-y-4' }, [
        h('div', { class: 'flex flex-wrap items-center gap-3' }, [
          h('a', { href: '#/', class: 'text-sm text-muted hover:text-default' }, `← ${host.t('all_projects')}`),
          h('h1', { class: 'text-2xl font-semibold text-highlighted' }, p.name), h(UBadge, { color: 'neutral', variant: 'subtle' }, () => p.key),
          p.is_archived ? h(UBadge, { color: 'warning', variant: 'subtle' }, () => host.t('archived')) : null,
          role.value ? h('span', { class: 'text-xs text-muted' }, host.t(`role_${role.value}`)) : null,
        ]),
        p.description ? h('p', { class: 'max-w-3xl text-sm text-muted' }, p.description) : null,
        h('nav', { class: 'flex gap-1 overflow-x-auto overflow-y-hidden border-b border-(--ui-border)' }, visibleTabs.map(([k, key, icon]) => h('a', {
          key: k, href: `#/p/${p.key}/${k}`,
          class: `-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-primary font-medium text-highlighted' : 'border-transparent text-muted hover:text-default'}`,
        }, [h(host.components.UIcon, { name: icon, class: 'size-4' }), host.t(key)]))),
        loading.value ? h('p', { class: 'text-sm text-muted' }, host.t('loading')) : (
          tab === 'board' ? board() : tab === 'backlog' ? backlog() : tab === 'list' ? listTab()
            : tab === 'team' ? h(TeamTab, { host, project: p, me: props.me, onProject: applyProject })
              : h(SettingsTab, { host, project: p, me: props.me, onProject: applyProject, onChanged: refresh })),
        creating.value ? h(CreateIssueModal, { host, project: p, sprintId: creating.value.sprintId, statusId: creating.value.statusId, onClose: () => creating.value = null, onCreated: async (i) => { creating.value = null; await refresh(); openIssue(i.key) } }) : null,
        sprintModal.value ? h(SprintModal, { host, project: p, sprint: sprintModal.value.sprint, onClose: () => sprintModal.value = null, onSaved: (np) => { sprintModal.value = null; applyProject(np) } }) : null,
        closing.value ? h(CloseSprintModal, { host, project: p, sprint: closing.value, onClose: () => closing.value = null, onDone: async (np) => { closing.value = null; applyProject(np); await refresh() } }) : null,
        props.openKey ? h(IssueModal, { host, issueKey: props.openKey, project: p, me: props.me, onClose: closeIssue, onChanged: refresh, onOpen: openIssue }) : null,
      ])
    }
  },
})
