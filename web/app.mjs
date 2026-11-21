// Менеджер проектов: точка входа бандла. SPA на hash-маршрутах внутри страницы ЛК/админки:
//   #/ — проекты, #/me — мои задачи, #/p/KEY[/board|backlog|list|team|settings], #/i/KEY-N — задача.
import { Q, M } from './api.mjs'
import { safe, typeIcon, priorityIcon, avatar, label, modal, useEscape, formatDate, isOverdue } from './ui.mjs'
import { ProjectView } from './project.mjs'

const { defineComponent, h, ref, reactive, computed, onMounted, onBeforeUnmount } = globalThis.__SB_HOST__.vue

const APP_PATH = '/account/x/rumantic.project-manager'

function parseHash() {
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'me') return { name: 'me' }
  if (parts[0] === 'p' && parts[1]) return { name: 'project', key: parts[1].toUpperCase(), tab: parts[2] || 'board' }
  if (parts[0] === 'i' && parts[1]) {
    const key = parts[1].toUpperCase()
    return { name: 'project', key: key.replace(/-\d+$/, ''), tab: 'board', open: key }
  }
  return { name: 'projects' }
}

// ---------------------------------------------------------------- создание проекта
const CreateProjectModal = defineComponent({
  name: 'TrackerCreateProject',
  props: { host: Object, onClose: Function, onCreated: Function },
  setup(props) {
    const { host } = props
    const { UButton, UInput, UTextarea } = host.components
    const f = reactive({ key: '', name: '', description: '' })
    const touchedKey = ref(false)
    useEscape(() => props.onClose())
    /** Ключ подсказывается из названия, пока его не правили руками. */
    function setName(v) {
      f.name = v
      if (!touchedKey.value) f.key = v.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase()
    }
    async function submit() {
      const data = await safe(host, () => host.gql(M.createProject, { input: { key: f.key.toUpperCase(), name: f.name.trim(), description: f.description || null } }))
      if (data) props.onCreated(data.trackerCreateProject)
    }
    return () => modal(host, { title: host.t('new_project'), onClose: props.onClose }, [
      h('form', { class: 'space-y-3', onSubmit: e => { e.preventDefault(); submit() } }, [
        label(host.t('f_name'), h(UInput, { modelValue: f.name, 'onUpdate:modelValue': setName, class: 'w-full', autofocus: true, maxlength: 120 })),
        label(host.t('f_key'), h(UInput, { modelValue: f.key, 'onUpdate:modelValue': v => { touchedKey.value = true; f.key = v.toUpperCase() }, class: 'w-40', maxlength: 8 }), host.t('f_key_hint')),
        label(host.t('f_description'), h(UTextarea, { modelValue: f.description, 'onUpdate:modelValue': v => f.description = v, rows: 3, class: 'w-full' })),
        h('div', { class: 'flex justify-end gap-2 pt-2' }, [
          h(UButton, { color: 'neutral', variant: 'ghost', onClick: props.onClose }, () => host.t('cancel')),
          h(UButton, { type: 'submit', disabled: !f.name.trim() || f.key.length < 2 }, () => host.t('create')),
        ]),
      ]),
    ])
  },
})

// ---------------------------------------------------------------- список задач (мои / для виджета)
function issueRow(host, i, { showProject = true } = {}) {
  const { UBadge } = host.components
  return h('a', { key: i.id, href: `${APP_PATH}#/i/${i.key}`, class: 'flex items-center gap-2 border-b border-(--ui-border) px-3 py-2 text-sm last:border-0 hover:bg-(--ui-bg-elevated)' }, [
    typeIcon(host, i.type), h('span', { class: 'w-24 shrink-0 font-mono text-xs text-muted' }, i.key),
    h('span', { class: 'min-w-0 flex-1 truncate' }, i.title),
    showProject ? h('span', { class: 'hidden text-xs text-muted sm:inline' }, i.project_name) : null,
    h(UBadge, { color: i.status_category === 'doing' ? 'primary' : 'neutral', variant: 'subtle', size: 'sm' }, () => i.status_name),
    i.due_date ? h('span', { class: `text-xs ${isOverdue(i) ? 'text-error' : 'text-muted'}` }, formatDate(host, i.due_date)) : null,
    priorityIcon(host, i.priority),
  ])
}

const MyIssues = defineComponent({
  name: 'TrackerMyIssues',
  props: { host: Object },
  setup(props) {
    const { host } = props
    const rows = ref(null)
    onMounted(async () => { const d = await safe(host, () => host.gql(Q.mine)); rows.value = d ? d.trackerMyIssues : [] })
    return () => h('div', { class: 'space-y-4' }, [
      h('div', { class: 'flex items-center gap-3' }, [
        h('a', { href: '#/', class: 'text-sm text-muted hover:text-default' }, `← ${host.t('all_projects')}`),
        h('h1', { class: 'text-2xl font-semibold text-highlighted' }, host.t('my_issues')),
      ]),
      rows.value === null ? h('p', { class: 'text-sm text-muted' }, host.t('loading'))
        : rows.value.length ? h('div', { class: 'overflow-hidden rounded-xl border border-(--ui-border)' }, rows.value.map(i => issueRow(host, i)))
          : h('p', { class: 'text-sm text-muted' }, host.t('no_my_issues')),
    ])
  },
})

// ---------------------------------------------------------------- проекты
const Projects = defineComponent({
  name: 'TrackerProjects',
  props: { host: Object, me: Object },
  setup(props) {
    const { host } = props
    const { UButton, UBadge } = host.components
    const rows = ref(null)
    const creating = ref(false)
    const showArchived = ref(false)
    async function load() { const d = await safe(host, () => host.gql(Q.projects)); rows.value = d ? d.trackerProjects : [] }
    onMounted(load)

    const progress = (p) => {
      const total = p.statuses.reduce((n, s) => n + s.issue_count, 0)
      const open = p.open_issues
      return total ? Math.round(((total - open) / total) * 100) : 0
    }
    return () => {
      const list = (rows.value || []).filter(p => showArchived.value || !p.is_archived)
      return h('div', { class: 'space-y-5' }, [
        h('div', { class: 'flex flex-wrap items-center gap-3' }, [
          h('h1', { class: 'text-2xl font-semibold text-highlighted' }, host.t('projects')),
          h('div', { class: 'flex-1' }),
          h('label', { class: 'flex items-center gap-1.5 text-sm text-muted' }, [h('input', { type: 'checkbox', checked: showArchived.value, onChange: e => showArchived.value = e.target.checked }), host.t('show_archived')]),
          h(UButton, { color: 'neutral', variant: 'soft', icon: 'i-lucide-user-check', as: 'a', href: '#/me' }, () => host.t('my_issues')),
          props.me.can_create_project ? h(UButton, { icon: 'i-lucide-plus', onClick: () => creating.value = true }, () => host.t('new_project')) : null,
        ]),
        rows.value === null ? h('p', { class: 'text-sm text-muted' }, host.t('loading'))
          : !list.length ? h('div', { class: 'rounded-xl border border-dashed border-(--ui-border) p-10 text-center text-muted' }, props.me.can_create_project ? host.t('no_projects_create') : host.t('no_projects'))
            : h('div', { class: 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' }, list.map(p => h('a', { key: p.id, href: `#/p/${p.key}`, class: 'block space-y-3 rounded-xl border border-(--ui-border) p-4 hover:border-primary/60 hover:shadow-sm' }, [
              h('div', { class: 'flex items-center gap-2' }, [
                h('span', { class: 'flex size-9 items-center justify-center rounded-lg bg-primary/15 text-xs font-bold text-primary' }, p.key.slice(0, 3)),
                h('div', { class: 'min-w-0 flex-1' }, [h('div', { class: 'truncate font-semibold text-highlighted' }, p.name), h('div', { class: 'text-xs text-muted' }, p.key)]),
                p.is_archived ? h(UBadge, { color: 'warning', variant: 'subtle', size: 'sm' }, () => host.t('archived')) : null,
              ]),
              p.description ? h('p', { class: 'line-clamp-2 text-sm text-muted' }, p.description) : null,
              h('div', { class: 'h-1.5 overflow-hidden rounded-full bg-(--ui-bg-elevated)' }, [h('div', { class: 'h-full bg-success', style: { width: `${progress(p)}%` } })]),
              h('div', { class: 'flex items-center gap-3 text-xs text-muted' }, [
                h('span', {}, `${p.open_issues} ${host.t('open_short')}`), h('span', {}, `${p.members.length} ${host.t('members_short')}`),
                p.my_role ? h('span', { class: 'ml-auto' }, host.t(`role_${p.my_role}`)) : null,
              ]),
            ]))),
        creating.value ? h(CreateProjectModal, { host, onClose: () => creating.value = false, onCreated: (p) => { creating.value = false; location.hash = `#/p/${p.key}` } }) : null,
      ])
    }
  },
})

// ---------------------------------------------------------------- приложение
const TrackerApp = defineComponent({
  name: 'TrackerApp',
  props: { host: { type: Object, required: true } },
  setup(props) {
    const { host } = props
    const route = ref(parseHash())
    const me = ref(null)
    const denied = ref(false)
    const onHash = () => { route.value = parseHash() }
    onMounted(async () => {
      window.addEventListener('hashchange', onHash)
      const d = await safe(host, () => host.gql(Q.me))
      if (d) me.value = d.trackerMe; else denied.value = true
    })
    onBeforeUnmount(() => window.removeEventListener('hashchange', onHash))

    const view = () => {
      if (denied.value) return h('p', { class: 'text-sm text-muted' }, host.t('err_forbidden'))
      if (!me.value) return h('p', { class: 'text-sm text-muted' }, host.t('loading'))
      const r = route.value
      if (r.name === 'me') return h(MyIssues, { host })
      // key — чтобы переход между проектами пересоздавал экран, а смена вкладки/задачи — нет.
      if (r.name === 'project') return h(ProjectView, { key: r.key, host, me: me.value, projectKey: r.key, tab: r.tab, openKey: r.open || null })
      return h(Projects, { host, me: me.value })
    }
    return () => h('div', { class: 'w-full min-w-0' }, [view()])
  },
})

// ---------------------------------------------------------------- настройки (админ сайта)
const TrackerSettingsPage = defineComponent({
  name: 'TrackerSettingsPage',
  props: { host: { type: Object, required: true } },
  setup(props) {
    const { host } = props
    const { UButton } = host.components
    const s = reactive({ members_can_create_projects: true, notify: true })
    const loaded = ref(false)
    onMounted(async () => { const d = await safe(host, () => host.gql(Q.settings)); if (d) { Object.assign(s, { members_can_create_projects: d.trackerSettings.members_can_create_projects, notify: d.trackerSettings.notify }); loaded.value = true } })
    async function save() {
      const d = await safe(host, () => host.gql(M.saveSettings, { input: { members_can_create_projects: s.members_can_create_projects, notify: s.notify } }))
      if (d) host.toast(host.t('saved'), 'success')
    }
    const check = (key, text, hint) => h('label', { class: 'flex items-start gap-3' }, [
      h('input', { type: 'checkbox', class: 'mt-1', checked: s[key], onChange: e => s[key] = e.target.checked }),
      h('span', {}, [h('span', { class: 'block text-sm font-medium' }, text), h('span', { class: 'block text-xs text-muted' }, hint)]),
    ])
    return () => h('div', { class: 'max-w-xl space-y-5' }, [
      h('h1', { class: 'text-2xl font-semibold text-highlighted' }, host.t('menu_settings')),
      loaded.value ? h('div', { class: 'space-y-4' }, [
        check('members_can_create_projects', host.t('set_members_create'), host.t('set_members_create_hint')),
        check('notify', host.t('set_notify'), host.t('set_notify_hint')),
        h(UButton, { onClick: save }, () => host.t('save')),
      ]) : h('p', { class: 'text-sm text-muted' }, host.t('loading')),
    ])
  },
})

// ---------------------------------------------------------------- виджеты
/** Мои открытые задачи + проекты: общий кусок дашборда админа и главной сайта. */
const Summary = defineComponent({
  name: 'TrackerSummary',
  props: { host: Object },
  setup(props) {
    const { host } = props
    const mine = ref(null)
    const projects = ref([])
    onMounted(async () => {
      const [a, b] = await Promise.all([safe(host, () => host.gql(Q.mine)), safe(host, () => host.gql(Q.projects))])
      mine.value = a ? a.trackerMyIssues : []
      projects.value = b ? b.trackerProjects.filter(p => !p.is_archived) : []
    })
    const tile = (title, value) => h('div', { class: 'rounded-xl border border-(--ui-border) p-4' }, [h('div', { class: 'text-xs text-muted' }, title), h('div', { class: 'mt-1 text-2xl font-semibold text-highlighted' }, value)])
    return () => {
      const overdue = (mine.value || []).filter(isOverdue).length
      return h('div', { class: 'space-y-5' }, [
        h('div', { class: 'grid grid-cols-2 gap-4 lg:grid-cols-3' }, [
          tile(host.t('widget_projects'), mine.value ? String(projects.value.length) : '…'),
          tile(host.t('widget_my_open'), mine.value ? String(mine.value.length) : '…'),
          tile(host.t('widget_overdue'), mine.value ? String(overdue) : '…'),
        ]),
        h('div', { class: 'grid gap-5 lg:grid-cols-2' }, [
          h('section', { class: 'space-y-2' }, [
            h('h2', { class: 'font-semibold text-highlighted' }, host.t('my_issues')),
            mine.value && mine.value.length ? h('div', { class: 'overflow-hidden rounded-xl border border-(--ui-border)' }, mine.value.slice(0, 8).map(i => issueRow(host, i))) : h('p', { class: 'text-sm text-muted' }, mine.value ? host.t('no_my_issues') : host.t('loading')),
          ]),
          h('section', { class: 'space-y-2' }, [
            h('h2', { class: 'font-semibold text-highlighted' }, host.t('projects')),
            projects.value.length ? h('div', { class: 'overflow-hidden rounded-xl border border-(--ui-border)' }, projects.value.slice(0, 8).map(p => h('a', { key: p.id, href: `${APP_PATH}#/p/${p.key}`, class: 'flex items-center gap-2 border-b border-(--ui-border) px-3 py-2 text-sm last:border-0 hover:bg-(--ui-bg-elevated)' }, [
              h('span', { class: 'font-mono text-xs text-muted' }, p.key), h('span', { class: 'flex-1 truncate' }, p.name), h('span', { class: 'text-xs text-muted' }, `${p.open_issues} ${host.t('open_short')}`),
            ]))) : h('p', { class: 'text-sm text-muted' }, host.t('no_projects')),
          ]),
        ]),
      ])
    }
  },
})

const TrackerDashboard = defineComponent({
  name: 'TrackerDashboard',
  props: { host: { type: Object, required: true } },
  setup(props) {
    return () => h('div', { class: 'space-y-4' }, [
      h('div', { class: 'flex items-center gap-3' }, [
        h('h1', { class: 'text-2xl font-semibold text-highlighted' }, props.host.t('app_name')),
        h('a', { href: `${APP_PATH}#/`, class: 'ml-auto text-sm text-primary hover:underline' }, props.host.t('open_app')),
      ]),
      h(Summary, { host: props.host }),
    ])
  },
})

/** Главная сайта: гостю — описание и вход, вошедшему — сводка. */
const TrackerHome = defineComponent({
  name: 'TrackerHome',
  props: { host: { type: Object, required: true } },
  setup(props) {
    const { host } = props
    const { UButton } = host.components
    return () => host.user
      ? h('div', { class: 'mx-auto max-w-6xl space-y-4 px-4 py-8' }, [
        h('div', { class: 'flex items-center gap-3' }, [h('h1', { class: 'text-3xl font-bold text-highlighted' }, host.t('app_name')), h(UButton, { class: 'ml-auto', as: 'a', href: host.localePath(APP_PATH), icon: 'i-lucide-kanban-square' }, () => host.t('open_app'))]),
        h(Summary, { host }),
      ])
      : h('div', { class: 'mx-auto max-w-2xl space-y-5 px-4 py-20 text-center' }, [
        h('h1', { class: 'text-4xl font-bold text-highlighted' }, host.t('app_name')),
        h('p', { class: 'text-lg text-muted' }, host.t('home_tagline')),
        h(UButton, { size: 'lg', as: 'a', href: host.localePath('/auth/login') }, () => host.t('sign_in')),
      ])
  },
})

const page = (name, Body) => defineComponent({ name, props: { host: { type: Object, required: true } }, setup(props) { return () => h(Body, { host: props.host }) } })

export const pages = { '': page('TrackerPage', TrackerApp), settings: page('TrackerSettingsRoute', TrackerSettingsPage) }
export const accountPages = { '': page('TrackerAccountPage', TrackerApp) }
export const widgets = { TrackerHome, TrackerDashboard }
