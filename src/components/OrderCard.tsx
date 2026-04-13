import type { Order, OrderStatus } from '../types/orders'
import { formatAge } from '../lib/time'

interface OrderCardProps {
  order: Order
  nowMs: number
  onMove: (orderId: number, nextStatus: OrderStatus) => Promise<void>
  isUpdating: boolean
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

  return (
    <article className="rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-lg">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-slate-100">Order #{order.id}</h3>
          <p className="text-lg text-slate-300">Table {order.table_number}</p>
        </div>
        <p className="rounded-md bg-slate-800 px-3 py-2 text-lg font-semibold text-amber-300">
          {formatAge(order.created_at, nowMs)}
        </p>
      </header>

      <ul className="space-y-3">
        {order.order_items.map((item) => (
          <li key={item.id} className="rounded-lg border border-slate-700 bg-slate-950 p-3">
            <p className="text-lg font-semibold text-white">{item.name}</p>
            {item.modifiers.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-base text-rose-300">
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
          className="mt-4 w-full rounded-lg bg-emerald-500 px-4 py-3 text-lg font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {isUpdating ? 'Updating...' : actionLabel}
        </button>
      ) : (
        <div className="mt-4 rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-4 py-3 text-center text-lg font-bold text-emerald-300">
          Ready for pickup
        </div>
      )}
    </article>
  )
}
