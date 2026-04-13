import type { Order, OrderStatus } from '../types/orders'
import { formatAge } from '../lib/time'

interface OrderCardProps {
  order: Order
  nowMs: number
  onMove: (orderId: number, currentStatus: OrderStatus) => Promise<void>
  isUpdating: boolean
  isMoving: boolean
}

const priorityStyles: Record<NonNullable<Order['priority']>, string> = {
  normal: 'border-slate-600/80 bg-slate-800 text-slate-200',
  high: 'border-amber-400/60 bg-amber-500/12 text-amber-200',
  rush: 'border-rose-400/65 bg-rose-500/14 text-rose-200',
}

const priorityLabel: Record<NonNullable<Order['priority']>, string> = {
  normal: 'Normal',
  high: 'High',
  rush: 'Rush',
}

const actionByStatus: Record<
  OrderStatus,
  { label: string; pendingLabel: string; buttonClass: string }
> = {
  new: {
    label: 'Start Cooking',
    pendingLabel: 'Starting...',
    buttonClass:
      'border-amber-300/50 bg-amber-400 text-slate-950 hover:bg-amber-300 disabled:border-slate-600 disabled:bg-slate-700 disabled:text-slate-400',
  },
  prep: {
    label: 'Mark Ready',
    pendingLabel: 'Marking...',
    buttonClass:
      'border-emerald-300/50 bg-emerald-400 text-slate-950 hover:bg-emerald-300 disabled:border-slate-600 disabled:bg-slate-700 disabled:text-slate-400',
  },
  ready: {
    label: 'Served / Complete',
    pendingLabel: 'Completing...',
    buttonClass:
      'border-cyan-300/50 bg-cyan-400 text-slate-950 hover:bg-cyan-300 disabled:border-slate-600 disabled:bg-slate-700 disabled:text-slate-400',
  },
}

export const OrderCard = ({ order, nowMs, onMove, isUpdating, isMoving }: OrderCardProps) => {
  const actionMeta = actionByStatus[order.status]
  const priority = order.priority ?? 'normal'

  return (
    <article
      className={`kds-card kds-card-enter rounded-xl border-2 border-slate-700 bg-slate-900 px-4 py-4 shadow-[0_10px_22px_rgba(2,6,23,0.45)] ${
        isMoving ? 'kds-card-moving' : ''
      }`}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800">
            <span className="text-base font-bold text-slate-100">T{order.table_number}</span>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Order #{order.id}</p>
            {priority !== 'normal' && (
              <span
                className={`mt-1 inline-flex rounded-lg border px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${priorityStyles[priority]}`}
              >
                {priorityLabel[priority]}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-right">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Timer</p>
          <p className="font-mono text-base font-semibold text-slate-100">{formatAge(order.created_at, nowMs)}</p>
        </div>
      </header>

      <div className="mb-4 space-y-2">
        {order.order_items.map((item, idx) => (
          <div key={item.id} className="space-y-1.5">
            <div className="flex items-center gap-3 text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-slate-800 text-xs font-bold text-slate-100">
                {idx + 1}
              </span>
              <span className="font-medium text-slate-100">{item.name}</span>
            </div>
            {item.modifiers.length > 0 && (
              <ul className="ml-9 list-disc space-y-0.5 pl-4 text-sm text-rose-300">
                {item.modifiers.map((modifier) => (
                  <li key={modifier.id}>{modifier.text}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onMove(order.id, order.status)}
        disabled={isUpdating}
        className={`w-full rounded-lg border px-4 py-3 text-base font-semibold transition-all disabled:cursor-not-allowed ${actionMeta.buttonClass}`}
      >
        {isUpdating ? actionMeta.pendingLabel : actionMeta.label}
      </button>
    </article>
  )
}
