import { useCallback, useEffect, useMemo, useState } from 'react'
import { OrderCard } from './OrderCard'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient'
import { ORDER_STATUSES, type Order, type OrderStatus } from '../types/orders'
import { createIncomingMockOrder, initialMockOrders } from '../lib/mockOrders'

type DatabaseOrderStatus = 'new' | 'in_progress' | 'ready' | 'delivered' | 'prep'

type OrderRow = {
  id: number
  table_number: number
  status: DatabaseOrderStatus
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

type SortMode = 'oldest' | 'newest' | 'priority'
type DensityMode = 'comfortable' | 'compact'

const LATE_ORDER_MINUTES = 15

const priorityRank: Record<NonNullable<Order['priority']>, number> = {
  rush: 0,
  high: 1,
  normal: 2,
}

const toUiStatus = (status: DatabaseOrderStatus): OrderStatus | null => {
  if (status === 'new') {
    return 'new'
  }
  if (status === 'in_progress' || status === 'prep') {
    return 'prep'
  }
  if (status === 'ready') {
    return 'ready'
  }
  return null
}

const toDatabaseStatus = (status: OrderStatus): 'new' | 'in_progress' | 'ready' => {
  if (status === 'prep') {
    return 'in_progress'
  }
  return status
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
  const [modeNotice, setModeNotice] = useState<string | null>(null)
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [isDemoMode, setIsDemoMode] = useState(false)
  const [movingOrderIds, setMovingOrderIds] = useState<number[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showLateOnly, setShowLateOnly] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [sortMode, setSortMode] = useState<SortMode>('oldest')
  const [densityMode, setDensityMode] = useState<DensityMode>('comfortable')

  const getAgeMinutes = useCallback(
    (createdAt: string) => Math.max(0, Math.floor((nowMs - Date.parse(createdAt)) / 60_000)),
    [nowMs],
  )

  const isLateOrder = useCallback(
    (order: Order) => getAgeMinutes(order.created_at) >= LATE_ORDER_MINUTES,
    [getAgeMinutes],
  )

  const fetchOrders = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setOrders(initialMockOrders())
      setIsDemoMode(true)
      setModeNotice('Demo mode active. Simulated live kitchen activity is running locally.')
      setError(null)
      setLoading(false)
      return
    }

    setIsDemoMode(false)
    setModeNotice(null)

    const canonicalSelect =
      'id, table_number, status, created_at, order_items(id, name, modifiers:order_item_modifiers(id, text))'
    const legacySelect = 'id, table_number, status, created_at, order_items(id, name, modifiers(id, text))'

    let { data, error: queryError } = await supabase
      .from('orders')
      .select(canonicalSelect)
      .order('created_at', { ascending: true })

    if (
      queryError &&
      queryError.message.toLowerCase().includes('relationship') &&
      queryError.message.includes('order_item_modifiers')
    ) {
      const fallbackResult = await supabase
        .from('orders')
        .select(legacySelect)
        .order('created_at', { ascending: true })
      data = fallbackResult.data
      queryError = fallbackResult.error
    }

    if (queryError) {
      setError(queryError.message)
    } else {
      const parsedOrders = ((data as OrderRow[] | null) ?? [])
        .map((order) => {
          const normalizedStatus = toUiStatus(order.status)
          if (!normalizedStatus) {
            return null
          }

          return {
            ...order,
            status: normalizedStatus,
            priority: order.priority ?? 'normal',
            order_items: (order.order_items ?? []).map((item) => ({
              ...item,
              modifiers: item.modifiers ?? [],
            })),
          }
        })
        .filter((order): order is Order => order !== null)

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
    if (!isSupabaseConfigured || !supabaseClient) {
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_item_modifiers' }, () => {
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
    }, 35_000)

    return () => window.clearInterval(timer)
  }, [isDemoMode])

  useEffect(() => {
    if (!isDemoMode) {
      return
    }

    const timer = window.setInterval(() => {
      if (updatingOrderId !== null) {
        return
      }

      setOrders((current) => {
        if (current.length === 0) {
          return current
        }

        const oldestFirst = [...current].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        const readyCandidate = oldestFirst.find((order) => order.status === 'ready')
        const prepCandidate = oldestFirst.find((order) => order.status === 'prep')
        const newCandidate = oldestFirst.find((order) => order.status === 'new')

        if (readyCandidate && Math.random() < 0.35) {
          return current.filter((order) => order.id !== readyCandidate.id)
        }

        if (prepCandidate) {
          return current.map((order) =>
            order.id === prepCandidate.id
              ? {
                  ...order,
                  status: 'ready',
                }
              : order,
          )
        }

        if (newCandidate) {
          return current.map((order) =>
            order.id === newCandidate.id
              ? {
                  ...order,
                  status: 'prep',
                }
              : order,
          )
        }

        if (readyCandidate) {
          return current.filter((order) => order.id !== readyCandidate.id)
        }

        return current
      })
    }, 22_000)

    return () => window.clearInterval(timer)
  }, [isDemoMode, updatingOrderId])

  const groupedOrders = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()

    const filteredOrders = orders.filter((order) => {
      if (showLateOnly && !isLateOrder(order)) {
        return false
      }

      if (normalizedQuery.length === 0) {
        return true
      }

      if (String(order.id).includes(normalizedQuery)) {
        return true
      }

      return order.order_items.some((item) => {
        if (item.name.toLowerCase().includes(normalizedQuery)) {
          return true
        }

        return item.modifiers.some((modifier) => modifier.text.toLowerCase().includes(normalizedQuery))
      })
    })

    const sortedOrders = [...filteredOrders].sort((a, b) => {
      if (sortMode === 'newest') {
        return Date.parse(b.created_at) - Date.parse(a.created_at)
      }

      if (sortMode === 'priority') {
        const priorityDifference = priorityRank[a.priority] - priorityRank[b.priority]
        if (priorityDifference !== 0) {
          return priorityDifference
        }
      }

      return Date.parse(a.created_at) - Date.parse(b.created_at)
    })

    return sortedOrders.reduce<Record<OrderStatus, Order[]>>(
      (acc, order) => {
        acc[order.status].push(order)
        return acc
      },
      { new: [], prep: [], ready: [] },
    )
  }, [orders, searchQuery, showLateOnly, sortMode, isLateOrder])

  const visibleOrders = useMemo(() => ORDER_STATUSES.flatMap((status) => groupedOrders[status]), [groupedOrders])

  const metrics = useMemo(() => {
    const activeOrders = visibleOrders.length
    const lateOrders = visibleOrders.filter(isLateOrder).length
    const totalMinutes = visibleOrders.reduce((total, order) => total + getAgeMinutes(order.created_at), 0)
    const avgWait = activeOrders === 0 ? 0 : Math.round(totalMinutes / activeOrders)
    const readyToServe = groupedOrders.ready.length

    return {
      activeOrders,
      lateOrders,
      avgWait,
      readyToServe,
    }
  }, [visibleOrders, groupedOrders.ready.length, isLateOrder, getAgeMinutes])

  const handleMoveOrder = async (orderId: number, currentStatus: OrderStatus) => {
    const nextStep: OrderStatus | 'complete' =
      currentStatus === 'new' ? 'prep' : currentStatus === 'prep' ? 'ready' : 'complete'

    setUpdatingOrderId(orderId)

    if (!isSupabaseConfigured || !supabase) {
      setMovingOrderIds((current) => (current.includes(orderId) ? current : [...current, orderId]))
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
      setTimeout(() => setUpdatingOrderId(null), 250)
      return
    }

    const databaseNextStatus = nextStep === 'complete' ? 'delivered' : toDatabaseStatus(nextStep)

    const { count: updatedCount, error: updateError } = await supabase
      .from('orders')
      .update({ status: databaseNextStatus }, { count: 'exact' })
      .eq('id', orderId)

    if (updateError || !updatedCount) {
      setError(
        updateError?.message ??
          'Supabase did not apply the status update. Check RLS policies for orders updates.',
      )
      void fetchOrders()
    } else {
      setError(null)
      setMovingOrderIds((current) => (current.includes(orderId) ? current : [...current, orderId]))
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
    }

    setUpdatingOrderId(null)
  }

  const resetDemoOrders = () => {
    if (!isDemoMode) {
      return
    }

    setOrders(initialMockOrders())
    setMovingOrderIds([])
    setModeNotice('Demo mode active. Simulated live kitchen activity is running locally.')
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
              {isSupabaseConfigured ? 'Realtime connected' : 'Demo mode'}
            </div>
          </div>
        </div>
      </header>

      <div className="p-4 md:p-5">
        {modeNotice && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm font-medium text-sky-100">
            <span className="h-2 w-2 rounded-full bg-sky-300" />
            {modeNotice}
          </div>
        )}
        <section className="mb-4 rounded-xl border border-slate-700 bg-slate-900/75 p-3.5 shadow-[0_4px_16px_rgba(2,6,23,0.28)]">
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search order #, item, modifier"
              className="min-w-[220px] flex-1 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-medium text-slate-100 outline-none transition focus:border-cyan-400"
            />

            <button
              type="button"
              onClick={() => setShowLateOnly((current) => !current)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                showLateOnly
                  ? 'border-rose-400/70 bg-rose-500/20 text-rose-100'
                  : 'border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              Late only
            </button>

            <button
              type="button"
              onClick={() => setSoundEnabled((current) => !current)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                soundEnabled
                  ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-100'
                  : 'border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              Sound {soundEnabled ? 'On' : 'Off'}
            </button>

            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition focus:border-cyan-400"
            >
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
              <option value="priority">Priority first</option>
            </select>

            <div className="inline-flex rounded-lg border border-slate-600 bg-slate-950 p-1">
              <button
                type="button"
                onClick={() => setDensityMode('comfortable')}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                  densityMode === 'comfortable'
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Comfortable
              </button>
              <button
                type="button"
                onClick={() => setDensityMode('compact')}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                  densityMode === 'compact'
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Compact
              </button>
            </div>

            {isDemoMode && (
              <button
                type="button"
                onClick={resetDemoOrders}
                className="rounded-lg border border-indigo-400/70 bg-indigo-500/20 px-3 py-2 text-sm font-semibold text-indigo-100 transition hover:bg-indigo-500/30"
              >
                Reset demo
              </button>
            )}
          </div>
        </section>

        <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <article className="rounded-xl border border-slate-700 bg-slate-900/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Active orders</p>
            <p className="mt-2 text-3xl font-black text-slate-100">{metrics.activeOrders}</p>
          </article>
          <article className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-200/90">Late orders</p>
            <p className="mt-2 text-3xl font-black text-rose-100">{metrics.lateOrders}</p>
          </article>
          <article className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200/90">Average wait time</p>
            <p className="mt-2 text-3xl font-black text-amber-100">{metrics.avgWait}m</p>
          </article>
          <article className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200/90">Ready to serve</p>
            <p className="mt-2 text-3xl font-black text-emerald-100">{metrics.readyToServe}</p>
          </article>
        </section>

        {error && (
          <div
            className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
              isDemoMode
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-100'
                : 'border-rose-500/60 bg-rose-500/15 text-rose-100'
            }`}
          >
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

                  <div className={densityMode === 'compact' ? 'space-y-2' : 'space-y-3'}>
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
                          density={densityMode}
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
