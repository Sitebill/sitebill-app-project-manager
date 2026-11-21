// Карточка задачи (просмотр/правка) и окно создания задачи.
import { Q, M } from './api.mjs'
import { TYPES, PRIORITIES, safe, avatar, typeIcon, priorityIcon, label, select, modal, useEscape, formatDate, isOverdue } from './ui.mjs'

const { defineComponent, h, ref, reactive, onMounted, computed } = globalThis.__SB_HOST__.vue

const canEditRole = (project) => ['manager', 'member'].includes(project?.my_role)
const assignable = (project) => (project?.members || []).filter(m => m.role !== 'viewer')
const parseLabels = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean)

const typeOptions = (host) => TYPES.map(v => [v, host.t(`type_${v}`)])
const priorityOptions = (host) => PRIORITIES.map(v => [v, host.t(`priority_${v}`)])
const userOptions = (host, project) => [['', host.t('unassigned')], ...assignable(project).map(m => [m.user_id, m.name])]
const sprintOptions = (host, project) => [['', host.t('backlog')], ...(project.sprints || []).filter(s => s.state !== 'closed').map(s => [s.id, s.name])]

/** Значение поля в истории: типы и приоритеты — переводом. */
function showValue(host, field, v) {
  if (v === null || v === undefined || v === '') return '—'
  if (field === 'type') return host.t(`type_${v}`)
  if (field === 'priority') return host.t(`priority_${v}`)
  return v
}

function describe(host, a) {
  if (a.field === 'created') return host.t('act_created')
  if (a.field === 'comment') return host.t('act_comment')
  const name = host.t(`field_${a.field}`)
  if (a.field === 'description') return `${name} ${host.t('act_changed')}`
  return `${name}: ${showValue(host, a.field, a.from_value)} → ${showValue(host, a.field, a.to_value)}`
}

// ---------------------------------------------------------------- создание
export const CreateIssueModal = defineComponent({
  name: 'TrackerCreateIssue',
  props: { host: { type: Object, required: true }, project: { type: Object, required: true }, sprintId: { default: null }, statusId: { default: null }, parent: { default: null }, onClose: Function, onCreated: Function },
  setup(props) {
    const { host, project } = props
    const { UButton, UInput, UTextarea } = host.components
    const f = reactive({ title: '', description: '', type: props.parent ? 'task' : 'task', priority: 'medium', assignee_id: '', sprint_id: props.sprintId ? String(props.sprintId) : '', status_id: props.statusId ? String(props.statusId) : '', estimate: '', due_date: '', labels: '' })
    const busy = ref(false)
    useEscape(() => props.onClose())

    async function submit() {
      if (!f.title.trim()) return host.toast(host.t('err_title_required'), 'error')
      busy.value = true
      const input = {
        title: f.title.trim(), description: f.description || null, type: f.type, priority: f.priority,
        assignee_id: f.assignee_id ? Number(f.assignee_id) : null, sprint_id: f.sprint_id ? Number(f.sprint_id) : null,
        status_id: f.status_id ? Number(f.status_id) : null, estimate: f.estimate === '' ? null : Number(f.estimate),
        due_date: f.due_date || null, labels: parseLabels(f.labels), parent_id: props.parent ? Number(props.parent.id) : null,
      }
      const data = await safe(host, () => host.gql(M.createIssue, { project_id: project.id, input }))
      busy.value = false
      if (data) { host.toast(host.t('issue_created'), 'success'); props.onCreated(data.trackerCreateIssue) }
    }

    return () => modal(host, { title: props.parent ? `${host.t('new_subtask')} · ${props.parent.key}` : host.t('new_issue'), onClose: props.onClose }, [
      h('form', { class: 'space-y-3', onSubmit: (e) => { e.preventDefault(); submit() } }, [
        label(host.t('f_title'), h(UInput, { modelValue: f.title, 'onUpdate:modelValue': v => f.title = v, class: 'w-full', autofocus: true, maxlength: 250 })),
        h('div', { class: 'grid grid-cols-2 gap-3' }, [
          label(host.t('f_type'), select(f.type, typeOptions(host), v => f.type = v)),
          label(host.t('f_priority'), select(f.priority, priorityOptions(host), v => f.priority = v)),
          label(host.t('f_assignee'), select(f.assignee_id, userOptions(host, project), v => f.assignee_id = v ?? '')),
          props.parent ? null : label(host.t('f_sprint'), select(f.sprint_id, sprintOptions(host, project), v => f.sprint_id = v ?? '')),
          label(host.t('f_estimate'), h(UInput, { modelValue: f.estimate, 'onUpdate:modelValue': v => f.estimate = v, type: 'number', min: 0, max: 1000, class: 'w-full' })),
          label(host.t('f_due'), h('input', { type: 'date', value: f.due_date, class: 'w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-2 py-1.5 text-sm', onInput: e => f.due_date = e.target.value })),
        ]),
        label(host.t('f_labels'), h(UInput, { modelValue: f.labels, 'onUpdate:modelValue': v => f.labels = v, class: 'w-full', placeholder: host.t('labels_hint') })),
        label(host.t('f_description'), h(UTextarea, { modelValue: f.description, 'onUpdate:modelValue': v => f.description = v, rows: 4, class: 'w-full' })),
        h('div', { class: 'flex justify-end gap-2 pt-2' }, [
          h(UButton, { color: 'neutral', variant: 'ghost', onClick: props.onClose }, () => host.t('cancel')),
          h(UButton, { type: 'submit', loading: busy.value }, () => host.t('create')),
        ]),
      ]),
    ])
  },
})

// ---------------------------------------------------------------- карточка
export const IssueModal = defineComponent({
  name: 'TrackerIssueModal',
  props: { host: { type: Object, required: true }, issueKey: { type: String, required: true }, project: { type: Object, required: true }, me: { type: Object, required: true }, onClose: Function, onChanged: Function, onOpen: Function },
  setup(props) {
    const { host } = props
    const { UButton, UInput, UTextarea, UBadge } = host.components
    const issue = ref(null)
    const failed = ref(false)
    const tab = ref('comments')
    const draft = reactive({ title: '', description: '', labels: '', comment: '' })
    const editingDesc = ref(false)
    const busy = ref(false)
    const subtaskTitle = ref('')
    useEscape(() => props.onClose())

    const canEdit = computed(() => canEditRole(props.project))
    const isManager = computed(() => props.project.my_role === 'manager')

    async function load() {
      const data = await safe(host, () => host.gql(Q.issue, { key: props.issueKey }))
      if (!data) { failed.value = true; return }
      const i = data.trackerIssue
      issue.value = i
      draft.title = i.title; draft.labels = (i.labels || []).join(', ')
      if (!editingDesc.value) draft.description = i.description || ''
    }
    onMounted(load)

    /** Одно поле: сохранить, обновить карточку и список за ней. */
    async function patch(input) {
      const data = await safe(host, () => host.gql(M.updateIssue, { id: issue.value.id, input }))
      if (data) { await load(); props.onChanged() } else await load()
    }
    async function setStatus(statusId) {
      const data = await safe(host, () => host.gql(M.moveIssue, { id: issue.value.id, status_id: statusId }))
      if (data) { await load(); props.onChanged() }
    }
    async function saveTitle() {
      const v = draft.title.trim()
      if (v && v !== issue.value.title) await patch({ title: v }); else draft.title = issue.value.title
    }
    async function saveDescription() {
      editingDesc.value = false
      if ((draft.description || '') !== (issue.value.description || '')) await patch({ description: draft.description || null })
    }
    async function addComment() {
      if (!draft.comment.trim()) return
      busy.value = true
      const data = await safe(host, () => host.gql(M.addComment, { issue_id: issue.value.id, body: draft.comment }))
      busy.value = false
      if (data) { draft.comment = ''; await load(); props.onChanged() }
    }
    async function delComment(c) {
      if (!window.confirm(host.t('confirm_delete_comment'))) return
      if (await safe(host, () => host.gql(M.deleteComment, { id: c.id }))) await load()
    }
    async function addSubtask() {
      const title = subtaskTitle.value.trim()
      if (!title) return
      const data = await safe(host, () => host.gql(M.createIssue, { project_id: props.project.id, input: { title, parent_id: Number(issue.value.id), type: 'task' } }))
      if (data) { subtaskTitle.value = ''; await load(); props.onChanged() }
    }
    async function remove() {
      if (!window.confirm(host.t('confirm_delete_issue'))) return
      if (await safe(host, () => host.gql(M.deleteIssue, { id: issue.value.id }))) { props.onChanged(); props.onClose() }
    }

    const side = (i) => h('div', { class: 'space-y-3' }, [
      label(host.t('f_status'), select(i.status_id, props.project.statuses.map(s => [s.id, s.name]), v => setStatus(v), { disabled: !canEdit.value })),
      label(host.t('f_assignee'), select(i.assignee_id, userOptions(host, props.project), v => patch({ assignee_id: v ? Number(v) : null }), { disabled: !canEdit.value })),
      label(host.t('f_priority'), select(i.priority, priorityOptions(host), v => patch({ priority: v }), { disabled: !canEdit.value })),
      label(host.t('f_type'), select(i.type, typeOptions(host), v => patch({ type: v }), { disabled: !canEdit.value })),
      i.parent_id ? null : label(host.t('f_sprint'), select(i.sprint_id, sprintOptions(host, props.project), v => patch({ sprint_id: v ? Number(v) : null }), { disabled: !canEdit.value })),
      h('div', { class: 'grid grid-cols-2 gap-3' }, [
        label(host.t('f_estimate'), h('input', { type: 'number', min: 0, max: 1000, value: i.estimate ?? '', disabled: !canEdit.value, class: 'w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-2 py-1.5 text-sm', onChange: e => patch({ estimate: e.target.value === '' ? null : Number(e.target.value) }) })),
        label(host.t('f_due'), h('input', { type: 'date', value: i.due_date || '', disabled: !canEdit.value, class: `w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-2 py-1.5 text-sm ${isOverdue(i) ? 'text-error' : ''}`, onChange: e => patch({ due_date: e.target.value || null }) })),
      ]),
      label(host.t('f_labels'), h('input', { value: draft.labels, disabled: !canEdit.value, placeholder: host.t('labels_hint'), class: 'w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-2 py-1.5 text-sm', onInput: e => draft.labels = e.target.value, onChange: () => patch({ labels: parseLabels(draft.labels) }) })),
      h('div', { class: 'space-y-1 border-t border-(--ui-border) pt-3 text-xs text-muted' }, [
        h('div', {}, `${host.t('f_reporter')}: ${i.reporter_name || '—'}`),
        h('div', {}, `${host.t('created')}: ${formatDate(host, i.created_at)}`),
        h('div', {}, `${host.t('updated')}: ${formatDate(host, i.updated_at)}`),
        i.resolved_at ? h('div', {}, `${host.t('resolved')}: ${formatDate(host, i.resolved_at)}`) : null,
      ]),
      isManager.value ? h(UButton, { color: 'error', variant: 'soft', size: 'sm', icon: 'i-lucide-trash-2', onClick: remove }, () => host.t('delete')) : null,
    ])

    const main = (i) => h('div', { class: 'space-y-5' }, [
      // заголовок
      canEdit.value
        ? h(UInput, { modelValue: draft.title, 'onUpdate:modelValue': v => draft.title = v, class: 'w-full', size: 'xl', maxlength: 250, onBlur: saveTitle, onKeydown: e => { if (e.key === 'Enter') e.target.blur() } })
        : h('h3', { class: 'text-xl font-semibold text-highlighted' }, i.title),
      i.parent_key ? h('p', { class: 'text-sm text-muted' }, [`${host.t('subtask_of')} `, h('a', { href: `#/i/${i.parent_key}`, class: 'text-primary hover:underline' }, `${i.parent_key} ${i.parent_title}`)]) : null,
      // описание
      h('section', { class: 'space-y-2' }, [
        h('h4', { class: 'text-sm font-semibold text-highlighted' }, host.t('f_description')),
        editingDesc.value
          ? h('div', { class: 'space-y-2' }, [
            h(UTextarea, { modelValue: draft.description, 'onUpdate:modelValue': v => draft.description = v, rows: 6, class: 'w-full', autofocus: true }),
            h('div', { class: 'flex gap-2' }, [
              h(UButton, { size: 'sm', onClick: saveDescription }, () => host.t('save')),
              h(UButton, { size: 'sm', color: 'neutral', variant: 'ghost', onClick: () => { editingDesc.value = false; draft.description = i.description || '' } }, () => host.t('cancel')),
            ]),
          ])
          : h('div', {
            class: `whitespace-pre-wrap rounded-lg p-2 text-sm ${canEdit.value ? 'cursor-text hover:bg-(--ui-bg-elevated)' : ''} ${i.description ? '' : 'text-muted'}`,
            onClick: () => { if (canEdit.value) editingDesc.value = true },
          }, i.description || (canEdit.value ? host.t('add_description') : '—')),
      ]),
      // подзадачи
      !i.parent_id ? h('section', { class: 'space-y-2' }, [
        h('h4', { class: 'text-sm font-semibold text-highlighted' }, `${host.t('subtasks')} ${i.subtasks_total ? `(${i.subtasks_done}/${i.subtasks_total})` : ''}`),
        ...(i.subtasks || []).map(s => h('a', { key: s.id, href: `#/i/${s.key}`, class: 'flex items-center gap-2 rounded-lg border border-(--ui-border) px-3 py-1.5 text-sm hover:bg-(--ui-bg-elevated)' }, [
          typeIcon(host, s.type), h('span', { class: 'text-xs text-muted' }, s.key),
          h('span', { class: `flex-1 truncate ${s.status_category === 'done' ? 'line-through text-muted' : ''}` }, s.title),
          h(UBadge, { color: s.status_category === 'done' ? 'success' : s.status_category === 'doing' ? 'primary' : 'neutral', variant: 'subtle', size: 'sm' }, () => s.status_name),
          s.assignee_name ? avatar(s.assignee_name) : null,
        ])),
        canEdit.value ? h('form', { class: 'flex gap-2', onSubmit: e => { e.preventDefault(); addSubtask() } }, [
          h(UInput, { modelValue: subtaskTitle.value, 'onUpdate:modelValue': v => subtaskTitle.value = v, class: 'flex-1', size: 'sm', placeholder: host.t('add_subtask') }),
          h(UButton, { type: 'submit', size: 'sm', variant: 'soft', icon: 'i-lucide-plus' }),
        ]) : null,
      ]) : null,
      // комментарии и история
      h('section', { class: 'space-y-3' }, [
        h('div', { class: 'flex gap-1 border-b border-(--ui-border)' }, ['comments', 'history'].map(k => h('button', {
          key: k, type: 'button', onClick: () => tab.value = k,
          class: `-mb-px border-b-2 px-3 py-1.5 text-sm ${tab.value === k ? 'border-primary font-medium text-highlighted' : 'border-transparent text-muted hover:text-default'}`,
        }, k === 'comments' ? `${host.t('comments')} (${(i.comments || []).length})` : host.t('history')))),
        tab.value === 'comments' ? h('div', { class: 'space-y-3' }, [
          ...(i.comments || []).map(c => h('div', { key: c.id, class: 'flex gap-2' }, [
            avatar(c.user_name, 'size-7'),
            h('div', { class: 'min-w-0 flex-1 rounded-lg bg-(--ui-bg-elevated) px-3 py-2' }, [
              h('div', { class: 'flex items-center gap-2 text-xs text-muted' }, [
                h('span', { class: 'font-medium text-default' }, c.user_name), h('span', {}, formatDate(host, c.created_at)),
                c.can_delete ? h('button', { type: 'button', class: 'ml-auto hover:text-error', onClick: () => delComment(c) }, host.t('delete')) : null,
              ]),
              h('p', { class: 'mt-1 whitespace-pre-wrap break-words text-sm' }, c.body),
            ]),
          ])),
          !(i.comments || []).length ? h('p', { class: 'text-sm text-muted' }, host.t('no_comments')) : null,
          canEdit.value ? h('div', { class: 'space-y-2' }, [
            h(UTextarea, { modelValue: draft.comment, 'onUpdate:modelValue': v => draft.comment = v, rows: 3, class: 'w-full', placeholder: host.t('write_comment') }),
            h(UButton, { size: 'sm', loading: busy.value, disabled: !draft.comment.trim(), onClick: addComment }, () => host.t('send')),
          ]) : null,
        ]) : h('ul', { class: 'space-y-2 text-sm' }, (i.activity || []).map(a => h('li', { key: a.id, class: 'flex gap-2' }, [
          avatar(a.user_name),
          h('div', {}, [h('span', { class: 'font-medium' }, a.user_name), ' ', h('span', { class: 'text-muted' }, describe(host, a)), h('div', { class: 'text-xs text-muted' }, formatDate(host, a.created_at))]),
        ]))),
      ]),
    ])

    return () => {
      const i = issue.value
      if (failed.value) return modal(host, { title: props.issueKey, onClose: props.onClose }, [h('p', { class: 'text-sm text-muted' }, host.t('err_not_found'))])
      if (!i) return modal(host, { title: props.issueKey, onClose: props.onClose, wide: true }, [h('p', { class: 'text-sm text-muted' }, host.t('loading'))])
      return modal(host, { onClose: props.onClose, wide: true }, [
        h('div', { class: 'mb-4 flex items-center gap-2 text-sm' }, [
          typeIcon(host, i.type), h('span', { class: 'font-mono text-muted' }, i.key), priorityIcon(host, i.priority),
          h(UBadge, { color: i.status_category === 'done' ? 'success' : i.status_category === 'doing' ? 'primary' : 'neutral', variant: 'subtle' }, () => i.status_name),
          h(UButton, { class: 'ml-auto', icon: 'i-lucide-x', color: 'neutral', variant: 'ghost', size: 'sm', 'aria-label': host.t('close'), onClick: props.onClose }),
        ]),
        // flex-wrap вместо grid: на узком экране боковая колонка уходит под основную без media-классов бандла.
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '1.5rem' } }, [
          h('div', { style: { flex: '1 1 26rem', minWidth: 0 } }, [main(i)]),
          h('div', { style: { flex: '1 1 16rem', maxWidth: '100%', minWidth: 0 } }, [side(i)]),
        ]),
      ])
    }
  },
})
