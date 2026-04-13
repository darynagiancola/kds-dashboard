import { useCallback, useEffect, useMemo, useState } from 'react'
import { OrderCard } from './OrderCard'
import { supabase } from '../lib/supabaseClient'
import { ORDER_STATUSES, type Order, type OrderStatus } from '../types/orders'

type OrderRow = {
  id: number
  table_number: number
  status: OrderStatus
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

const columnMeta: Record<OrderStatus, { label: string; accent: string }> = {
  new: { label: 'New', accent: 'text-sky-300' },
  prep: { label: 'Prep', accent: 'text-amber-300' },
  ready: { label: 'Ready', accent: 'text-emerald-300' },
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

  const fetchOrders = useCallback(async () => {
      if (!supabase) {
        setError(
          'Missing Supabase credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
        )
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
          order_items: (order.order_items ?? []).map((item) => ({
            ...item,
            modifiers: item.modifiers ?? [],
          })),
        }))
        setOrders(parsedOrders)
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
    if (!supabase) {
      return
    }

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

    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: nextStatus })
      .eq('id', orderId)

    if (updateError) {
      setError(updateError.message)
      void fetchOrders()
    } else {
      setError(null)
    }

    setUpdatingOrderId(null)
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-50 md:px-8">
      <header className="mb-6 flex flex-col gap-3 border-b border-slate-800 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
            Kitchen Display System
          </h1>
          <p className="mt-2 text-base text-slate-300 md:text-lg">
            Live order board for the kitchen line
          </p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-300">
          {supabase ? 'Realtime connected' : 'Supabase not configured'}
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-500/60 bg-rose-500/10 px-4 py-3 text-base text-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900 px-6 py-10 text-center text-xl font-semibold text-slate-200">
          Loading orders...
        </div>
      ) : (
        <section className="grid gap-4 xl:grid-cols-3">
          {ORDER_STATUSES.map((status) => (
            <section key={status} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <header className="mb-4 flex items-center justify-between">
                <h2 className={`text-2xl font-bold ${columnMeta[status].accent}`}>
                  {columnMeta[status].label}
                </h2>
                <span className="rounded-md bg-slate-800 px-3 py-1 text-lg font-semibold text-slate-100">
                  {groupedOrders[status].length}
                </span>
              </header>

              <div className="space-y-4">
                {groupedOrders[status].length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-700 px-4 py-6 text-center text-base text-slate-400">
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
          ))}
        </section>
      )}
    </main>
  )
}
