// Вкладки проекта «Команда» (роли участников) и «Настройки» (проект, статусы, удаление).
import { Q, M } from './api.mjs'
import { ROLES, CATEGORIES, safe, avatar, label, select, modal, useEscape } from './ui.mjs'

const { defineComponent, h, ref, reactive, computed } = globalThis.__SB_HOST__.vue

const roleOptions = (host) => ROLES.map(r => [r, host.t(`role_${r}`)])

// ---------------------------------------------------------------- команда
export const TeamTab = defineComponent({
  name: 'TrackerTeamTab',
  props: { host: Object, project: Object, me: Object, onProject: Function },
  setup(props) {
    const { host } = props
    const { UButton, UInput } = host.components
    const q = ref('')
    const found = ref([])
    const newRole = ref('member')
    let timer = null
    const isManager = computed(() => props.project.my_role === 'manager')

    function search(v) {
      q.value = v
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const data = await safe(host, () => host.gql(Q.users, { q: v || null }))
        const ids = new Set(props.project.members.map(m => m.user_id))
        found.value = data ? data.trackerUsers.filter(u => !ids.has(u.id)) : []
      }, 250)
    }
    async function setRole(userId, role) {
      const data = await safe(host, () => host.gql(M.setMember, { project_id: props.project.id, user_id: userId, role }))
      if (data) props.onProject(data.trackerSetMember)
      else props.onProject({ ...props.project })
    }
    async function add(u) {
      const data = await safe(host, () => host.gql(M.setMember, { project_id: props.project.id, user_id: u.id, role: newRole.value }))
      if (data) { props.onProject(data.trackerSetMember); found.value = found.value.filter(x => x.id !== u.id) }
    }
    async function remove(m) {
      if (!window.confirm(host.t('confirm_remove_member'))) return
      const data = await safe(host, () => host.gql(M.removeMember, { project_id: props.project.id, user_id: m.user_id }))
      if (data) props.onProject(data.trackerRemoveMember)
    }

    return () => h('div', { class: 'max-w-2xl space-y-5' }, [
      h('div', { class: 'overflow-hidden rounded-xl border border-(--ui-border)' }, props.project.members.map(m => h('div', { key: m.user_id, class: 'flex items-center gap-3 border-b border-(--ui-border) px-3 py-2 last:border-0' }, [
        avatar(m.name, 'size-8'), h('span', { class: 'flex-1 truncate text-sm font-medium' }, m.name),
        isManager.value ? select(m.role, roleOptions(host), v => setRole(m.user_id, v), { cls: '!w-auto' }) : h('span', { class: 'text-sm text-muted' }, host.t(`role_${m.role}`)),
        isManager.value ? h(UButton, { size: 'xs', color: 'neutral', variant: 'ghost', icon: 'i-lucide-x', 'aria-label': host.t('remove'), onClick: () => remove(m) }) : null,
      ]))),
      h('div', { class: 'space-y-1 text-xs text-muted' }, ROLES.map(r => h('p', { key: r }, [h('b', {}, `${host.t(`role_${r}`)}: `), host.t(`role_${r}_hint`)]))),
      isManager.value ? h('section', { class: 'space-y-2' }, [
        h('h3', { class: 'text-sm font-semibold text-highlighted' }, host.t('add_member')),
        props.me.can_search_users ? h('div', { class: 'flex gap-2' }, [
          h(UInput, { modelValue: q.value, 'onUpdate:modelValue': search, icon: 'i-lucide-search', placeholder: host.t('search_users'), class: 'flex-1', size: 'sm' }),
          select(newRole.value, roleOptions(host), v => newRole.value = v ?? 'member', { cls: '!w-auto' }),
        ]) : h('p', { class: 'text-sm text-muted' }, host.t('err_forbidden')),
        ...found.value.map(u => h('div', { key: u.id, class: 'flex items-center gap-3 rounded-lg border border-(--ui-border) px-3 py-1.5 text-sm' }, [
          avatar(u.name), h('span', { class: 'flex-1 truncate' }, u.name), h('span', { class: 'truncate text-xs text-muted' }, u.email),
          h(UButton, { size: 'xs', variant: 'soft', onClick: () => add(u) }, () => host.t('add')),
        ])),
        q.value && !found.value.length ? h('p', { class: 'text-xs text-muted' }, host.t('no_users')) : null,
      ]) : null,
    ])
  },
})

// ---------------------------------------------------------------- удаление статуса
const DeleteStatusModal = defineComponent({
  name: 'TrackerDeleteStatus',
  props: { host: Object, project: Object, status: Object, onClose: Function, onDone: Function },
  setup(props) {
    const { host } = props
    const { UButton } = host.components
    const target = ref('')
    useEscape(() => props.onClose())
    const options = props.project.statuses.filter(s => s.id !== props.status.id).map(s => [s.id, s.name])
    async function submit() {
      if (props.status.issue_count && !target.value) return host.toast(host.t('err_move_target_required'), 'error')
      const data = await safe(host, () => host.gql(M.deleteStatus, { project_id: props.project.id, id: props.status.id, move_to: target.value || null }))
      if (data) props.onDone(data.trackerDeleteStatus)
    }
    return () => modal(host, { title: `${host.t('delete')}: ${props.status.name}`, onClose: props.onClose }, [
      h('div', { class: 'space-y-3' }, [
        props.status.issue_count ? label(`${host.t('move_issues_to')} (${props.status.issue_count})`, select(target.value, [['', '—'], ...options], v => target.value = v ?? '')) : h('p', { class: 'text-sm' }, host.t('confirm_delete_status')),
        h('div', { class: 'flex justify-end gap-2' }, [
          h(UButton, { color: 'neutral', variant: 'ghost', onClick: props.onClose }, () => host.t('cancel')),
          h(UButton, { color: 'error', onClick: submit }, () => host.t('delete')),
        ]),
      ]),
    ])
  },
})

// ---------------------------------------------------------------- настройки проекта
export const SettingsTab = defineComponent({
  name: 'TrackerSettingsTab',
  props: { host: Object, project: Object, me: Object, onProject: Function, onChanged: Function },
  setup(props) {
    const { host } = props
    const { UButton, UInput, UTextarea } = host.components
    const form = reactive({ name: props.project.name, description: props.project.description || '' })
    const newStatus = reactive({ name: '', category: 'todo' })
    const deleting = ref(null)
    const confirmKey = ref('')

    async function saveProject(extra = {}) {
      const data = await safe(host, () => host.gql(M.updateProject, { id: props.project.id, input: { name: form.name, description: form.description || null, ...extra } }))
      if (data) { props.onProject(data.trackerUpdateProject); host.toast(host.t('saved'), 'success') }
    }
    async function saveStatus(s, patch) {
      const data = await safe(host, () => host.gql(M.saveStatus, { project_id: props.project.id, id: s?.id ?? null, name: patch.name ?? s.name, category: patch.category ?? s.category }))
      if (data) { props.onProject(data.trackerSaveStatus); if (!s) { newStatus.name = '' } await props.onChanged() }
      else props.onProject({ ...props.project })
    }
    async function moveStatus(index, delta) {
      const ids = props.project.statuses.map(s => s.id)
      const j = index + delta
      if (j < 0 || j >= ids.length) return
      ;[ids[index], ids[j]] = [ids[j], ids[index]]
      const data = await safe(host, () => host.gql(M.reorderStatuses, { project_id: props.project.id, ids }))
      if (data) props.onProject(data.trackerReorderStatuses)
    }
    async function deleteProject() {
      const data = await safe(host, () => host.gql(M.deleteProject, { id: props.project.id }))
      if (data) { host.toast(host.t('project_deleted'), 'success'); location.hash = '#/' }
    }

    return () => h('div', { class: 'max-w-2xl space-y-8' }, [
      h('section', { class: 'space-y-3' }, [
        h('h3', { class: 'text-lg font-semibold text-highlighted' }, host.t('project_settings')),
        label(host.t('f_name'), h(UInput, { modelValue: form.name, 'onUpdate:modelValue': v => form.name = v, class: 'w-full', maxlength: 120 })),
        label(host.t('f_description'), h(UTextarea, { modelValue: form.description, 'onUpdate:modelValue': v => form.description = v, rows: 3, class: 'w-full' })),
        h('div', { class: 'flex flex-wrap items-center gap-3' }, [
          h(UButton, { onClick: () => saveProject() }, () => host.t('save')),
          h(UButton, { color: 'neutral', variant: 'soft', onClick: () => saveProject({ is_archived: !props.project.is_archived }) }, () => props.project.is_archived ? host.t('unarchive') : host.t('archive')),
        ]),
      ]),
      h('section', { class: 'space-y-3' }, [
        h('h3', { class: 'text-lg font-semibold text-highlighted' }, host.t('statuses')),
        h('p', { class: 'text-xs text-muted' }, host.t('statuses_hint')),
        h('div', { class: 'space-y-2' }, props.project.statuses.map((s, idx) => h('div', { key: s.id, class: 'flex items-center gap-2' }, [
          h('input', { value: s.name, maxlength: 60, class: 'min-w-0 flex-1 rounded-md border border-(--ui-border) bg-(--ui-bg) px-2 py-1.5 text-sm', onChange: e => e.target.value.trim() ? saveStatus(s, { name: e.target.value.trim() }) : (e.target.value = s.name) }),
          select(s.category, CATEGORIES.map(c => [c, host.t(`cat_${c}`)]), v => saveStatus(s, { category: v }), { cls: '!w-auto' }),
          h('span', { class: 'w-8 text-center text-xs text-muted' }, s.issue_count),
          h(UButton, { size: 'xs', color: 'neutral', variant: 'ghost', icon: 'i-lucide-arrow-up', disabled: idx === 0, 'aria-label': host.t('up'), onClick: () => moveStatus(idx, -1) }),
          h(UButton, { size: 'xs', color: 'neutral', variant: 'ghost', icon: 'i-lucide-arrow-down', disabled: idx === props.project.statuses.length - 1, 'aria-label': host.t('down'), onClick: () => moveStatus(idx, 1) }),
          h(UButton, { size: 'xs', color: 'neutral', variant: 'ghost', icon: 'i-lucide-trash-2', disabled: props.project.statuses.length <= 1, 'aria-label': host.t('delete'), onClick: () => deleting.value = s }),
        ]))),
        h('form', { class: 'flex gap-2', onSubmit: e => { e.preventDefault(); if (newStatus.name.trim()) saveStatus(null, { name: newStatus.name.trim(), category: newStatus.category }) } }, [
          h(UInput, { modelValue: newStatus.name, 'onUpdate:modelValue': v => newStatus.name = v, class: 'flex-1', size: 'sm', placeholder: host.t('new_status') }),
          select(newStatus.category, CATEGORIES.map(c => [c, host.t(`cat_${c}`)]), v => newStatus.category = v ?? 'todo', { cls: '!w-auto' }),
          h(UButton, { type: 'submit', size: 'sm', variant: 'soft', icon: 'i-lucide-plus' }, () => host.t('add')),
        ]),
      ]),
      props.me?.is_admin ? h('section', { class: 'space-y-3 rounded-xl border border-error/40 p-4' }, [
        h('h3', { class: 'font-semibold text-error' }, host.t('danger_zone')),
        h('p', { class: 'text-sm text-muted' }, host.t('delete_project_hint')),
        h('div', { class: 'flex gap-2' }, [
          h(UInput, { modelValue: confirmKey.value, 'onUpdate:modelValue': v => confirmKey.value = v, size: 'sm', placeholder: props.project.key, class: 'w-40' }),
          h(UButton, { size: 'sm', color: 'error', disabled: confirmKey.value !== props.project.key, onClick: deleteProject }, () => host.t('delete_project')),
        ]),
      ]) : null,
      deleting.value ? h(DeleteStatusModal, { host, project: props.project, status: deleting.value, onClose: () => deleting.value = null, onDone: async (p) => { deleting.value = null; props.onProject(p); await props.onChanged() } }) : null,
    ])
  },
})
