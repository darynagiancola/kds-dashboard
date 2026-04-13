import type { Order, OrderStatus } from '../types/orders'
import { formatAge } from '../lib/time'

interface OrderCardProps {
  order: Order
  nowMs: number
  onMove: (orderId: number, nextStatus: OrderStatus) => Promise<void>
  isUpdating: boolean
}

const priorityStyles: Record<NonNullable<Order['priority']>, string> = {
  normal: 'border-slate-600 bg-slate-800 text-slate-200',
  high: 'border-amber-400/70 bg-amber-500/20 text-amber-200',
  rush: 'border-rose-400/80 bg-rose-500/20 text-rose-200',
}

const priorityLabel: Record<NonNullable<Order['priority']>, string> = {
  normal: 'Normal',
  high: 'High',
  rush: 'Rush',
}

const nextStatusByCurrent: Partial<Record<OrderStatus, OrderStatus>> = {
  new: 'prep',
  prep: 'ready',
}

const buttonLabelByStatus: Partial<Record<OrderStatus, string>> = {
  new: 'Move to Prep',
  prep: 'Move to Ready',
}

export const OrderCard = ({ order, nowMs, onMove, isUpdating }: OrderCardProps) => {
  const nextStatus = nextStatusByCurrent[order.status]
  const actionLabel = buttonLabelByStatus[order.status]
  const priority = order.priority ?? 'normal'

  return (
    <article className="rounded-2xl border border-slate-600 bg-slate-900 px-5 py-4 shadow-[0_10px_24px_rgba(2,6,23,0.55)]">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Table</p>
          <h3 className="text-3xl font-black leading-none text-slate-50">{order.table_number}</h3>
          <p className="text-base font-semibold text-slate-300">Order #{order.id}</p>
          {priority !== 'normal' && (
            <span
              className={`mt-2 inline-flex rounded-md border px-2.5 py-1 text-sm font-black uppercase tracking-wide ${priorityStyles[priority]}`}
            >
              {priorityLabel[priority]}
            </span>
          )}
        </div>
        <div className="rounded-lg border border-amber-300/40 bg-amber-400/15 px-3 py-2 text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/90">Timer</p>
          <p className="text-2xl font-black leading-none text-amber-300">{formatAge(order.created_at, nowMs)}</p>
        </div>
      </header>

      <ul className="space-y-2.5">
        {order.order_items.map((item) => (
          <li key={item.id} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5">
            <p className="text-lg font-bold leading-snug text-white">{item.name}</p>
            {item.modifiers.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm font-medium text-rose-300">
                {item.modifiers.map((modifier) => (
                  <li key={modifier.id}>{modifier.text}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {nextStatus && actionLabel ? (
        <button
          type="button"
          onClick={() => onMove(order.id, nextStatus)}
          disabled={isUpdating}
          className="mt-5 w-full rounded-xl border border-emerald-300/40 bg-emerald-400 px-4 py-4 text-xl font-black uppercase tracking-[0.08em] text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:border-slate-600 disabled:bg-slate-700 disabled:text-slate-400"
        >
          {isUpdating ? 'Updating...' : actionLabel}
        </button>
      ) : (
        <div className="mt-5 rounded-xl border border-emerald-500/70 bg-emerald-500/15 px-4 py-4 text-center text-xl font-black uppercase tracking-[0.08em] text-emerald-300">
          Ready for pickup
        </div>
      )}
    </article>
  )
}
