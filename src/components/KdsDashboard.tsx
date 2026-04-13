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
    dotClass: string
    headerBg: string
    countClass: string
    emptyClass: string
  }
> = {
  new: {
    label: 'New Orders',
    dotClass: 'bg-sky-400',
    headerBg: 'bg-sky-500/10',
    countClass: 'bg-slate-800 text-slate-300',
    emptyClass: 'border-sky-500/25 text-slate-400',
  },
  prep: {
    label: 'In Progress',
    dotClass: 'bg-amber-400',
    headerBg: 'bg-amber-500/10',
    countClass: 'bg-slate-800 text-slate-300',
    emptyClass: 'border-amber-500/25 text-slate-400',
  },
  ready: {
    label: 'Ready to Serve',
    dotClass: 'bg-emerald-400',
    headerBg: 'bg-emerald-500/10',
    countClass: 'bg-slate-800 text-slate-300',
    emptyClass: 'border-emerald-500/25 text-slate-400',
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
  const [movingOrderIds, setMovingOrderIds] = useState<number[]>([])

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

  const handleMoveOrder = async (orderId: number, currentStatus: OrderStatus) => {
    const nextStep: OrderStatus | 'complete' =
      currentStatus === 'new' ? 'prep' : currentStatus === 'prep' ? 'ready' : 'complete'

    setMovingOrderIds((current) => [...current, orderId])
    setUpdatingOrderId(orderId)
    setOrders((current) =>
      nextStep === 'complete'
        ? current.filter((order) => order.id !== orderId)
        : current.map((order) =>
            order.id === orderId
              ? {
                  ...order,
                  status: nextStep,
                }
              : order,
          ),
    )
    window.setTimeout(() => {
      setMovingOrderIds((current) => current.filter((id) => id !== orderId))
    }, 220)

    if (!supabase) {
      setTimeout(() => setUpdatingOrderId(null), 250)
      return
    }

    const { error: updateError } =
      nextStep === 'complete'
        ? await supabase.from('orders').delete().eq('id', orderId)
        : await supabase.from('orders').update({ status: nextStep }).eq('id', orderId)

    if (updateError) {
      setError(updateError.message)
      void fetchOrders()
    } else {
      setError(null)
    }

    setUpdatingOrderId(null)
  }

  const displayTime = useMemo(
    () =>
      new Intl.DateTimeFormat([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(nowMs),
    [nowMs],
  )

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur-lg md:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Kitchen Display</h1>
            <p className="text-sm text-slate-400">Real-time order management</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-mono text-base font-medium text-slate-200">
              {displayTime}
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300">
              {supabase ? 'Realtime connected' : 'Demo mode'}
            </div>
          </div>
        </div>
      </header>

      <div className="p-4 md:p-5">
        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/50 bg-rose-500/15 px-4 py-3 text-sm font-medium text-rose-100">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-6 py-10 text-center text-xl font-semibold text-slate-200">
            Loading orders...
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {ORDER_STATUSES.map((status) => {
              const meta = columnMeta[status]

              return (
                <section key={status} className="space-y-3">
                  <header
                    className={`flex items-center gap-3 rounded-xl border border-slate-700 px-4 py-3 ${meta.headerBg}`}
                  >
                    <div className={`h-2.5 w-2.5 rounded-full ${meta.dotClass}`} />
                    <h2 className="text-base font-semibold text-slate-100">{meta.label}</h2>
                    <span
                      className={`ml-auto rounded-lg px-2 py-1 text-xs font-semibold shadow-[0_2px_10px_rgba(2,6,23,0.35)] ${meta.countClass}`}
                    >
                      {groupedOrders[status].length}
                    </span>
                  </header>

                  <div className="space-y-3">
                    {groupedOrders[status].length === 0 ? (
                      <p
                        className={`rounded-xl border border-dashed bg-slate-900/50 px-4 py-8 text-center text-sm font-medium ${meta.emptyClass}`}
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
                          isMoving={movingOrderIds.includes(order.id)}
                        />
                      ))
                    )}
                  </div>
                </section>
              )
            })}
          </section>
        )}
      </div>
    </main>
  )
}
