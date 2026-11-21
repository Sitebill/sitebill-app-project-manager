// Общие кирпичики интерфейса Менеджера проектов. Vue общий с сайтом (globalThis.__SB_HOST__), bare-импортов нет.
const { h, ref, onMounted, onBeforeUnmount } = globalThis.__SB_HOST__.vue

export const TYPES = ['task', 'bug', 'story', 'improvement']
export const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest']
export const ROLES = ['manager', 'member', 'viewer']
export const CATEGORIES = ['todo', 'doing', 'done']

const TYPE_ICON = { task: 'i-lucide-square-check-big', bug: 'i-lucide-bug', story: 'i-lucide-bookmark', improvement: 'i-lucide-trending-up' }
const TYPE_COLOR = { task: 'text-info', bug: 'text-error', story: 'text-success', improvement: 'text-warning' }
const PRIORITY_ICON = { highest: 'i-lucide-chevrons-up', high: 'i-lucide-chevron-up', medium: 'i-lucide-equal', low: 'i-lucide-chevron-down', lowest: 'i-lucide-chevrons-down' }
const PRIORITY_COLOR = { highest: 'text-error', high: 'text-warning', medium: 'text-warning', low: 'text-info', lowest: 'text-info' }
export const CATEGORY_COLOR = { todo: 'neutral', doing: 'primary', done: 'success' }

/** Текст ошибки: коды бэкенда (not_found, key_taken…) переводятся, остальное показывается как есть. */
export function errorText(host, e) {
  const raw = String(e?.graphQLErrors?.[0]?.message ?? e?.errors?.[0]?.message ?? e?.message ?? e ?? '')
  const key = `err_${raw.replace(/^GraphQL error:\s*/, '').trim()}`
  const text = host.t(key)
  return text !== key ? text : raw
}

/** Запрос с показом ошибки тостом. Возвращает data или null. */
export async function safe(host, fn) {
  try { return await fn() } catch (e) { host.toast(errorText(host, e), 'error'); return null }
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function avatar(name, size = 'size-6') {
  return h('span', {
    title: name || '', class: `inline-flex ${size} shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary`,
  }, initials(name))
}

export function typeIcon(host, type, cls = 'size-4') {
  const { UIcon } = host.components
  return h(UIcon, { name: TYPE_ICON[type] ?? TYPE_ICON.task, class: `${cls} ${TYPE_COLOR[type] ?? ''}`, title: host.t(`type_${type}`) })
}

export function priorityIcon(host, priority, cls = 'size-4') {
  const { UIcon } = host.components
  return h(UIcon, { name: PRIORITY_ICON[priority] ?? PRIORITY_ICON.medium, class: `${cls} ${PRIORITY_COLOR[priority] ?? ''}`, title: host.t(`priority_${priority}`) })
}

export const label = (text, control, hint) => h('label', { class: 'block space-y-1' }, [
  h('span', { class: 'block text-xs font-medium text-muted' }, text), h('div', {}, [control]), hint ? h('span', { class: 'block text-xs text-muted' }, hint) : null,
])

const SELECT_CLASS = 'w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-2 py-1.5 text-sm disabled:opacity-60'

/** Нативный select: options = [[value, text]], value сравнивается как строка. */
export function select(value, options, onChange, { disabled = false, cls = '' } = {}) {
  return h('select', {
    class: `${SELECT_CLASS} ${cls}`, disabled, value: value ?? '',
    onChange: (e) => onChange(e.target.value === '' ? null : e.target.value),
  }, options.map(([v, text]) => h('option', { key: String(v), value: v, selected: String(v) === String(value ?? '') }, text)))
}

/** Затемнение + карточка по центру; закрытие по Esc и клику на фон. */
export function modal(host, { title, onClose, wide = false }, children) {
  return h('div', {
    class: 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-8', role: 'dialog', 'aria-modal': 'true',
    onMousedown: (e) => { if (e.target === e.currentTarget) onClose() },
  }, [
    h('div', { class: `w-full ${wide ? 'max-w-5xl' : 'max-w-lg'} rounded-2xl border border-(--ui-border) bg-(--ui-bg) shadow-xl` }, [
      title ? h('div', { class: 'flex items-center justify-between border-b border-(--ui-border) px-5 py-3' }, [
        h('h2', { class: 'text-lg font-semibold text-highlighted' }, title),
        h(host.components.UButton, { icon: 'i-lucide-x', color: 'neutral', variant: 'ghost', size: 'sm', 'aria-label': host.t('close'), onClick: onClose }),
      ]) : null,
      h('div', { class: 'p-5' }, children),
    ]),
  ])
}

/** Esc закрывает верхний оверлей. */
export function useEscape(handler) {
  const fn = (e) => { if (e.key === 'Escape') handler() }
  onMounted(() => window.addEventListener('keydown', fn))
  onBeforeUnmount(() => window.removeEventListener('keydown', fn))
}

export function formatDate(host, iso) {
  if (!iso) return ''
  try { return new Intl.DateTimeFormat(host.locale?.value || undefined, { dateStyle: 'medium' }).format(new Date(iso)) } catch { return iso }
}

export function isOverdue(issue) {
  return !!issue.due_date && issue.status_category !== 'done' && issue.due_date < new Date().toISOString().slice(0, 10)
}

/** Метки задачи маленькими бейджами. */
export const labelChips = (labels) => (labels || []).slice(0, 4).map(l => h('span', { key: l, class: 'rounded bg-(--ui-bg-elevated) px-1.5 py-0.5 text-[11px] text-muted' }, l))

export { ref }
