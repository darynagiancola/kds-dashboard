import { useCallback, useEffect, useMemo, useState } from 'react'
import { OrderCard } from './OrderCard'
import { supabase } from '../lib/supabaseClient'
import { ORDER_STATUSES, type Order, type OrderStatus } from '../types/orders'
import { createIncomingMockOrder, initialMockOrders } from '../lib/mockOrders'

type OrderRow = {
  id: number
  table_number: number
  status: OrderStatus
  priority?: Order['priority']
  created_at: string
  order_items: {
    id: number
    name: string
    modifiers: {
      id: number
      text: string
    }[]
  }[]
}

const columnMeta: Record<
  OrderStatus,
  {
    label: string
    accent: string
    panelClass: string
    countClass: string
    emptyClass: string
  }
> = {
  new: {
    label: 'New',
    accent: 'text-sky-200',
    panelClass: 'border-sky-500/35 bg-sky-500/5',
    countClass: 'border-sky-400/50 bg-sky-500/20 text-sky-100',
    emptyClass: 'border-sky-500/30 text-sky-200/75',
  },
  prep: {
    label: 'Prep',
    accent: 'text-amber-200',
    panelClass: 'border-amber-500/35 bg-amber-500/5',
    countClass: 'border-amber-400/50 bg-amber-500/20 text-amber-100',
    emptyClass: 'border-amber-500/30 text-amber-200/75',
  },
  ready: {
    label: 'Ready',
    accent: 'text-emerald-200',
    panelClass: 'border-emerald-500/35 bg-emerald-500/5',
    countClass: 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100',
    emptyClass: 'border-emerald-500/30 text-emerald-200/75',
  },
}

const EMPTY_COLUMN_TEXT: Record<OrderStatus, string> = {
  new: 'No new tickets',
  prep: 'Nothing in prep',
  ready: 'No finished orders',
}

export const KdsDashboard = () => {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [isDemoMode, setIsDemoMode] = useState(false)

  const fetchOrders = useCallback(async () => {
    if (!supabase) {
      setOrders(initialMockOrders())
      setIsDemoMode(true)
      setError('Missing Supabase credentials. Running in demo mode with sample kitchen orders.')
      setLoading(false)
      return
    }

    const { data, error: queryError } = await supabase
      .from('orders')
      .select('id, table_number, status, created_at, order_items(id, name, modifiers(id, text))')
      .order('created_at', { ascending: true })

    if (queryError) {
      setError(queryError.message)
    } else {
      const parsedOrders = ((data as OrderRow[] | null) ?? []).map((order) => ({
        ...order,
        priority: order.priority ?? 'normal',
        order_items: (order.order_items ?? []).map((item) => ({
          ...item,
          modifiers: item.modifiers ?? [],
        })),
      }))
      setOrders(parsedOrders)
      setIsDemoMode(false)
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchOrders()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchOrders])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const supabaseClient = supabase
    if (!supabaseClient) {
      return
    }

    const channel = supabaseClient
      .channel('kds-live-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        void fetchOrders()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        void fetchOrders()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'modifiers' }, () => {
        void fetchOrders()
      })
      .subscribe()

    return () => {
      void supabaseClient.removeChannel(channel)
    }
  }, [fetchOrders])

  useEffect(() => {
    if (!isDemoMode) {
      return
    }

    const timer = window.setInterval(() => {
      setOrders((current) => [createIncomingMockOrder(), ...current].slice(0, 18))
    }, 45_000)

    return () => window.clearInterval(timer)
  }, [isDemoMode])

  const groupedOrders = useMemo(() => {
    return ORDER_STATUSES.reduce<Record<OrderStatus, Order[]>>(
      (acc, status) => {
        acc[status] = orders.filter((order) => order.status === status)
        return acc
      },
      { new: [], prep: [], ready: [] },
    )
  }, [orders])

  const handleMoveOrder = async (orderId: number, nextStatus: OrderStatus) => {
    setUpdatingOrderId(orderId)
    setOrders((current) =>
      current.map((order) =>
        order.id === orderId
          ? {
              ...order,
              status: nextStatus,
            }
          : order,
      ),
    )

    if (!supabase) {
      setTimeout(() => setUpdatingOrderId(null), 250)
      return
    }

    const { error: updateError } = await supabase.from('orders').update({ status: nextStatus }).eq('id', orderId)

    if (updateError) {
      setError(updateError.message)
      void fetchOrders()
    } else {
      setError(null)
    }

    setUpdatingOrderId(null)
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-50 md:px-8 md:py-7">
      <header className="mb-6 flex flex-col gap-3 border-b border-slate-700 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight md:text-4xl">
            Kitchen Display System
          </h1>
          <p className="mt-2 text-base font-medium text-slate-300 md:text-lg">
            Live order board for the kitchen line
          </p>
        </div>
        <div className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-slate-200">
          {supabase ? 'Realtime connected' : 'Supabase not configured'}
        </div>
      </header>

      {error && (
        <div className="mb-5 rounded-xl border border-rose-500/60 bg-rose-500/15 px-4 py-3 text-base font-medium text-rose-100">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900 px-6 py-10 text-center text-xl font-semibold text-slate-200">
          Loading orders...
        </div>
      ) : (
        <section className="grid gap-4 xl:grid-cols-3 xl:gap-5">
          {ORDER_STATUSES.map((status) => {
            const meta = columnMeta[status]

            return (
              <section
                key={status}
                className={`rounded-2xl border p-4 shadow-[0_0_0_1px_rgba(15,23,42,0.7)] md:p-5 ${meta.panelClass}`}
              >
                <header className="mb-4 rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                        Line Status
                      </p>
                      <h2 className={`mt-1 text-3xl font-black tracking-tight ${meta.accent}`}>
                        {meta.label}
                      </h2>
                    </div>
                    <span
                      className={`min-w-12 rounded-lg border px-3 py-2 text-center text-2xl font-black tabular-nums ${meta.countClass}`}
                    >
                      {groupedOrders[status].length}
                    </span>
                  </div>
                </header>

                <div className="space-y-4">
                  {groupedOrders[status].length === 0 ? (
                    <p
                      className={`rounded-xl border border-dashed px-4 py-8 text-center text-lg font-semibold ${meta.emptyClass}`}
                    >
                      {EMPTY_COLUMN_TEXT[status]}
                    </p>
                  ) : (
                    groupedOrders[status].map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        nowMs={nowMs}
                        onMove={handleMoveOrder}
                        isUpdating={updatingOrderId === order.id}
                      />
                    ))
                  )}
                </div>
              </section>
            )
          })}
        </section>
      )}
    </main>
  )
}
