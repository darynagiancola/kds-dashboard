import type { Order, OrderStatus } from '../types/orders'
import { formatAge } from '../lib/time'

interface OrderCardProps {
  order: Order
  nowMs: number
  onMove: (orderId: number, currentStatus: OrderStatus) => Promise<void>
  isUpdating: boolean
  isMoving: boolean
  density: 'comfortable' | 'compact'
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

export const OrderCard = ({ order, nowMs, onMove, isUpdating, isMoving, density }: OrderCardProps) => {
  const actionMeta = actionByStatus[order.status]
  const priority = order.priority ?? 'normal'
  const compact = density === 'compact'

  return (
    <article
      className={`kds-card kds-card-enter rounded-xl border-2 border-slate-700 bg-slate-900 shadow-[0_10px_22px_rgba(2,6,23,0.45)] ${
        compact ? 'px-3 py-3' : 'px-4 py-4'
      } ${
        isMoving ? 'kds-card-moving' : ''
      }`}
    >
      <header className={`flex items-start justify-between gap-3 ${compact ? 'mb-2.5' : 'mb-3'}`}>
        <div className="flex items-center gap-2">
          <div className={`flex items-center justify-center rounded-lg bg-slate-800 ${compact ? 'h-8 w-8' : 'h-10 w-10'}`}>
            <span className={`font-bold text-slate-100 ${compact ? 'text-sm' : 'text-base'}`}>T{order.table_number}</span>
          </div>
          <div>
            <p className={`font-semibold uppercase tracking-[0.16em] text-slate-400 ${compact ? 'text-[10px]' : 'text-xs'}`}>
              Order #{order.id}
            </p>
            {priority !== 'normal' && (
              <span
                className={`mt-1 inline-flex rounded-lg border font-bold uppercase tracking-wide ${priorityStyles[priority]} ${
                  compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]'
                }`}
              >
                {priorityLabel[priority]}
              </span>
            )}
          </div>
        </div>
        <div className={`rounded-lg bg-slate-800 text-right ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'}`}>
          <p className={`font-medium uppercase tracking-[0.16em] text-slate-400 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
            Timer
          </p>
          <p className={`font-mono font-semibold text-slate-100 ${compact ? 'text-sm' : 'text-base'}`}>
            {formatAge(order.created_at, nowMs)}
          </p>
        </div>
      </header>

      <div className={compact ? 'mb-3 space-y-1.5' : 'mb-4 space-y-2'}>
        {order.order_items.map((item, idx) => (
          <div key={item.id} className={compact ? 'space-y-1' : 'space-y-1.5'}>
            <div className={`flex items-center gap-3 ${compact ? 'text-sm' : 'text-base'}`}>
              <span
                className={`flex items-center justify-center rounded bg-slate-800 text-xs font-bold text-slate-100 ${
                  compact ? 'h-5 w-5' : 'h-6 w-6'
                }`}
              >
                {idx + 1}
              </span>
              <span className="font-medium text-slate-100">{item.name}</span>
            </div>
            {item.modifiers.length > 0 && (
              <ul className={`ml-9 list-disc space-y-0.5 pl-4 text-rose-300 ${compact ? 'text-xs' : 'text-sm'}`}>
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
        className={`w-full rounded-lg border px-4 font-semibold transition-all disabled:cursor-not-allowed ${
          compact ? 'py-2 text-sm' : 'py-3 text-base'
        } ${actionMeta.buttonClass}`}
      >
        {isUpdating ? actionMeta.pendingLabel : actionMeta.label}
      </button>
    </article>
  )
}
