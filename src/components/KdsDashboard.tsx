import { useCallback, useEffect, useMemo, useState } from 'react'
import { OrderCard } from './OrderCard'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient'
import { ORDER_STATUSES, type Order, type OrderStatus } from '../types/orders'
import { createIncomingMockOrder, initialMockOrders } from '../lib/mockOrders'
import {
  DEMO_SCENARIOS,
  SCENARIO_BY_ID,
  buildRecoveryPlaybook,
  nextStatus,
  type DemoDetectedIssue,
  type DemoIssueCategory,
  type DemoScenarioId,
  type RecoveryStep,
} from '../lib/demoSimulator'

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
type DataMode = 'demo' | 'live'
type TriggerSource = 'manual' | 'auto'

type DemoSimulationSignal = {
  id: string
  scenarioId: DemoScenarioId
  details: string
  createdAt: number
}

type DemoRecoveryContext =
  | { scenarioId: 'order_disappears'; removedOrder: Order }
  | { scenarioId: 'status_skips_stage'; orderId: number; expected: OrderStatus; actual: OrderStatus }
  | { scenarioId: 'wrong_column'; orderId: number; expected: OrderStatus; actual: OrderStatus }
  | { scenarioId: 'duplicate_status_change'; orderId: number; expected: OrderStatus; actual: OrderStatus }
  | { scenarioId: 'realtime_event_delayed'; orderId: number; queuedStatus: OrderStatus; delayMs: number }
  | { scenarioId: 'stale_state'; orderId: number; staleStatus: OrderStatus; canonicalStatus: OrderStatus }
  | { scenarioId: 'inconsistent_screens'; orderId: number; screenA: OrderStatus; screenB: OrderStatus }

type DemoScreenSnapshot = {
  orderId: number
  screenA: OrderStatus
  screenB: OrderStatus
  capturedAt: number
}

type DelayedDemoEvent = {
  id: string
  orderId: number
  toStatus: OrderStatus
  applyAt: number
}

const LATE_ORDER_MINUTES = 15
const ERROR_PERSIST_MS = 10_000
const DEMO_RECOVERY_STEP_MS = 900
const DEMO_EVENT_DELAY_MS = 8_000
const DEMO_AUTOSTART_SESSION_KEY = 'kds-demo-simulator-autostarted-v1'

const priorityRank: Record<NonNullable<Order['priority']>, number> = {
  rush: 0,
  high: 1,
  normal: 2,
}

const demoCategoryLabel: Record<DemoIssueCategory, string> = {
  logic_error: 'Logic Error',
  race_condition: 'Race Condition',
  realtime_delay: 'Realtime Delay',
  data_inconsistency: 'Data Inconsistency',
}

const demoCategoryClass: Record<DemoIssueCategory, string> = {
  logic_error: 'border-amber-500/40 bg-amber-500/15 text-amber-100',
  race_condition: 'border-orange-500/40 bg-orange-500/15 text-orange-100',
  realtime_delay: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-100',
  data_inconsistency: 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-100',
}

const recoveryStepClass: Record<RecoveryStep['status'], string> = {
  pending: 'border-slate-700 bg-slate-900 text-slate-300',
  running: 'border-sky-500/45 bg-sky-500/15 text-sky-100',
  resolved: 'border-emerald-500/45 bg-emerald-500/15 text-emerald-100',
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

const formatSupabaseErrorMessage = (
  error: { message?: string; details?: string | null; hint?: string | null; code?: string | null } | null,
  fallback: string,
) => {
  if (!error) {
    return fallback
  }

  const parts = [error.message]
  if (error.details) {
    parts.push(`Details: ${error.details}`)
  }
  if (error.hint) {
    parts.push(`Hint: ${error.hint}`)
  }
  if (error.code) {
    parts.push(`Code: ${error.code}`)
  }

  return parts.filter(Boolean).join(' | ')
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
  const liveModeAvailable = isSupabaseConfigured && Boolean(supabase)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorVisibleUntil, setErrorVisibleUntil] = useState(0)
  const [modeNotice, setModeNotice] = useState<string | null>(null)
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [dataMode, setDataMode] = useState<DataMode>(liveModeAvailable ? 'live' : 'demo')
  const [isDemoMode, setIsDemoMode] = useState(!liveModeAvailable)
  const [movingOrderIds, setMovingOrderIds] = useState<number[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showLateOnly, setShowLateOnly] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [sortMode, setSortMode] = useState<SortMode>('oldest')
  const [densityMode, setDensityMode] = useState<DensityMode>('comfortable')

  const [demoSignals, setDemoSignals] = useState<DemoSimulationSignal[]>([])
  const [detectedIssue, setDetectedIssue] = useState<DemoDetectedIssue | null>(null)
  const [recoverySteps, setRecoverySteps] = useState<RecoveryStep[]>([])
  const [recoveryContext, setRecoveryContext] = useState<DemoRecoveryContext | null>(null)
  const [isRecoveryRunning, setIsRecoveryRunning] = useState(false)
  const [lastResolvedIssueId, setLastResolvedIssueId] = useState<string | null>(null)
  const [delayedDemoEvents, setDelayedDemoEvents] = useState<DelayedDemoEvent[]>([])
  const [screenSnapshot, setScreenSnapshot] = useState<DemoScreenSnapshot | null>(null)

  const activeMode: DataMode = liveModeAvailable ? dataMode : 'demo'

  const showPersistentError = useCallback((message: string) => {
    setError(message)
    setErrorVisibleUntil(Date.now() + ERROR_PERSIST_MS)
  }, [])

  const clearErrorIfExpired = useCallback(() => {
    setError((current) => {
      if (!current) {
        return current
      }
      return Date.now() >= errorVisibleUntil ? null : current
    })
  }, [errorVisibleUntil])

  const clearDemoSimulatorState = useCallback(() => {
    setDemoSignals([])
    setDetectedIssue(null)
    setRecoverySteps([])
    setRecoveryContext(null)
    setIsRecoveryRunning(false)
    setLastResolvedIssueId(null)
    setDelayedDemoEvents([])
    setScreenSnapshot(null)
  }, [])

  const getAgeMinutes = useCallback(
    (createdAt: string) => Math.max(0, Math.floor((nowMs - Date.parse(createdAt)) / 60_000)),
    [nowMs],
  )

  const isLateOrder = useCallback(
    (order: Order) => getAgeMinutes(order.created_at) >= LATE_ORDER_MINUTES,
    [getAgeMinutes],
  )

  const fetchOrders = useCallback(async () => {
    if (activeMode === 'demo' || !supabase) {
      setOrders(initialMockOrders())
      setIsDemoMode(true)
      setModeNotice('Demo mode active. Simulated live kitchen activity is running locally.')
      clearErrorIfExpired()
      setLoading(false)
      return
    }

    setIsDemoMode(false)
    setModeNotice('Live mode active. Orders are synced with Supabase.')
    clearDemoSimulatorState()

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
      clearErrorIfExpired()
    }
    setLoading(false)
  }, [activeMode, clearDemoSimulatorState, clearErrorIfExpired])

  const applyDemoRecovery = useCallback((context: DemoRecoveryContext | null) => {
    if (!context) {
      return
    }

    if (context.scenarioId === 'order_disappears') {
      setOrders((current) => {
        if (current.some((order) => order.id === context.removedOrder.id)) {
          return current
        }
        return [context.removedOrder, ...current]
      })
      return
    }

    if (context.scenarioId === 'status_skips_stage' || context.scenarioId === 'wrong_column') {
      setOrders((current) =>
        current.map((order) => (order.id === context.orderId ? { ...order, status: context.expected } : order)),
      )
      return
    }

    if (context.scenarioId === 'duplicate_status_change') {
      setOrders((current) =>
        current.map((order) => (order.id === context.orderId ? { ...order, status: context.expected } : order)),
      )
      return
    }

    if (context.scenarioId === 'realtime_event_delayed') {
      setDelayedDemoEvents((queue) => {
        if (queue.length === 0) {
          return queue
        }
        setOrders((current) => {
          let next = current
          for (const delayed of queue) {
            next = next.map((order) =>
              order.id === delayed.orderId
                ? {
                    ...order,
                    status: delayed.toStatus,
                  }
                : order,
            )
          }
          return next
        })
        return []
      })
      return
    }

    if (context.scenarioId === 'stale_state') {
      setOrders((current) =>
        current.map((order) =>
          order.id === context.orderId
            ? {
                ...order,
                status: context.canonicalStatus,
              }
            : order,
        ),
      )
      setScreenSnapshot((current) =>
        current && current.orderId === context.orderId
          ? {
              ...current,
              screenA: context.canonicalStatus,
              screenB: context.canonicalStatus,
              capturedAt: Date.now(),
            }
          : current,
      )
      return
    }

    if (context.scenarioId === 'inconsistent_screens') {
      setScreenSnapshot((current) =>
        current && current.orderId === context.orderId
          ? {
              ...current,
              screenA: current.screenA,
              screenB: current.screenA,
              capturedAt: Date.now(),
            }
          : current,
      )
    }
  }, [])

  const runRecoveryPath = useCallback(
    async (issue: DemoDetectedIssue, context: DemoRecoveryContext | null) => {
      const playbook = buildRecoveryPlaybook(issue.scenarioId)
      setRecoverySteps(playbook)
      setIsRecoveryRunning(true)

      for (let index = 0; index < playbook.length; index += 1) {
        setRecoverySteps((current) =>
          current.map((step, stepIndex) => {
            if (stepIndex < index) {
              return { ...step, status: 'resolved' }
            }
            if (stepIndex === index) {
              return { ...step, status: 'running' }
            }
            return { ...step, status: 'pending' }
          }),
        )

        if (playbook[index]?.id === 'repair') {
          applyDemoRecovery(context)
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), DEMO_RECOVERY_STEP_MS)
        })

        setRecoverySteps((current) =>
          current.map((step, stepIndex) => (stepIndex === index ? { ...step, status: 'resolved' } : step)),
        )
      }

      setIsRecoveryRunning(false)
      setLastResolvedIssueId(issue.id)
      setModeNotice(`Recovery completed for "${issue.label}". Simulator state is now reconciled.`)
    },
    [applyDemoRecovery],
  )

  const triggerRecoveryForCurrentIssue = useCallback(() => {
    if (!detectedIssue || activeMode !== 'demo') {
      return
    }
    void runRecoveryPath(detectedIssue, recoveryContext)
  }, [activeMode, detectedIssue, recoveryContext, runRecoveryPath])

  const triggerDemoScenario = useCallback(
    (scenarioId: DemoScenarioId, source: TriggerSource = 'manual') => {
      if (activeMode !== 'demo') {
        return
      }

      const findOrder = (preferredStatuses: OrderStatus[]): Order => {
        const found = orders.find((order) => preferredStatuses.includes(order.status))
        if (found) {
          return found
        }
        const fallback = createIncomingMockOrder()
        setOrders((current) => [fallback, ...current])
        return fallback
      }

      const registerIssue = (
        headline: string,
        explanation: string,
        details: string,
        context: DemoRecoveryContext,
      ): DemoDetectedIssue => {
        const now = Date.now()
        const scenario = SCENARIO_BY_ID[scenarioId]
        const issue: DemoDetectedIssue = {
          id: `${scenarioId}-${now}`,
          scenarioId,
          label: scenario.label,
          category: scenario.category,
          headline,
          explanation,
          detectedAt: now,
        }

        setDetectedIssue(issue)
        setRecoveryContext(context)
        setRecoverySteps(buildRecoveryPlaybook(scenarioId))
        setIsRecoveryRunning(false)
        setLastResolvedIssueId(null)
        setDemoSignals((current) =>
          [
            {
              id: `signal-${now}`,
              scenarioId,
              details,
              createdAt: now,
            },
            ...current,
          ].slice(0, 8),
        )

        return issue
      }

      let issue: DemoDetectedIssue | null = null
      let context: DemoRecoveryContext | null = null

      if (scenarioId === 'order_disappears') {
        const target = findOrder(['prep', 'new', 'ready'])
        setOrders((current) => current.filter((order) => order.id !== target.id))
        context = { scenarioId, removedOrder: target }
        issue = registerIssue(
          `Order #${target.id} disappeared from board`,
          'A dropped event removed the ticket from all columns before completion.',
          `Removed order #${target.id} from visible board state.`,
          context,
        )
      }

      if (scenarioId === 'status_skips_stage') {
        const target = findOrder(['new'])
        const expected: OrderStatus = 'prep'
        const actual: OrderStatus = 'ready'
        setOrders((current) =>
          current.map((order) => (order.id === target.id ? { ...order, status: actual } : order)),
        )
        context = { scenarioId, orderId: target.id, expected, actual }
        issue = registerIssue(
          `Order #${target.id} skipped ${expected} stage`,
          'Transition chain violated expected state machine (New -> Prep -> Ready).',
          `Forced order #${target.id} from new directly to ready.`,
          context,
        )
      }

      if (scenarioId === 'wrong_column') {
        const target = findOrder(['new', 'prep'])
        const expected = nextStatus(target.status)
        const actual = target.status
        setMovingOrderIds((current) => (current.includes(target.id) ? current : [...current, target.id]))
        window.setTimeout(() => {
          setMovingOrderIds((current) => current.filter((id) => id !== target.id))
        }, 260)
        context = { scenarioId, orderId: target.id, expected, actual }
        issue = registerIssue(
          `Order #${target.id} failed to reach target column`,
          'The UI acknowledged a move intent but card placement did not update as expected.',
          `Expected ${expected}, but order #${target.id} remained in ${actual}.`,
          context,
        )
      }

      if (scenarioId === 'duplicate_status_change') {
        const target = findOrder(['new'])
        const expected = nextStatus(target.status)
        const actual = nextStatus(expected)
        setOrders((current) =>
          current.map((order) => (order.id === target.id ? { ...order, status: actual } : order)),
        )
        context = { scenarioId, orderId: target.id, expected, actual }
        issue = registerIssue(
          `Order #${target.id} received duplicate transition`,
          'Two transition applications raced and advanced the card more than once.',
          `Applied duplicate transition for order #${target.id}: expected ${expected}, got ${actual}.`,
          context,
        )
      }

      if (scenarioId === 'realtime_event_delayed') {
        const target = findOrder(['new', 'prep'])
        const queuedStatus = nextStatus(target.status)
        const delayedEvent: DelayedDemoEvent = {
          id: `delay-${Date.now()}`,
          orderId: target.id,
          toStatus: queuedStatus,
          applyAt: Date.now() + DEMO_EVENT_DELAY_MS,
        }
        setDelayedDemoEvents((current) => [delayedEvent, ...current])
        context = { scenarioId, orderId: target.id, queuedStatus, delayMs: DEMO_EVENT_DELAY_MS }
        issue = registerIssue(
          `Realtime update delayed for order #${target.id}`,
          'Incoming event is queued and arrives late, causing temporary board drift.',
          `Queued delayed transition for order #${target.id} to ${queuedStatus}.`,
          context,
        )
      }

      if (scenarioId === 'stale_state') {
        const target = findOrder(['new', 'prep'])
        const staleStatus = target.status
        const canonicalStatus = nextStatus(staleStatus)
        setOrders((current) =>
          current.map((order) =>
            order.id === target.id
              ? {
                  ...order,
                  status: canonicalStatus,
                }
              : order,
          ),
        )
        setScreenSnapshot({
          orderId: target.id,
          screenA: staleStatus,
          screenB: canonicalStatus,
          capturedAt: Date.now(),
        })
        context = { scenarioId, orderId: target.id, staleStatus, canonicalStatus }
        issue = registerIssue(
          `Stale state detected on order #${target.id}`,
          'One client snapshot remained stale while canonical state advanced.',
          `Screen A stale=${staleStatus}; canonical=${canonicalStatus} for order #${target.id}.`,
          context,
        )
      }

      if (scenarioId === 'inconsistent_screens') {
        const target = findOrder(['new', 'prep', 'ready'])
        const screenA = target.status
        const screenB: OrderStatus = screenA === 'ready' ? 'prep' : 'ready'
        setScreenSnapshot({
          orderId: target.id,
          screenA,
          screenB,
          capturedAt: Date.now(),
        })
        context = { scenarioId, orderId: target.id, screenA, screenB }
        issue = registerIssue(
          `Screen mismatch for order #${target.id}`,
          'Two displays diverged and now show different order statuses.',
          `Display A=${screenA} while Display B=${screenB} for order #${target.id}.`,
          context,
        )
      }

      if (issue) {
        setModeNotice(
          source === 'auto'
            ? `Demo simulator auto-triggered "${issue.label}" and started recovery analysis.`
            : `Demo simulator triggered "${issue.label}" (${demoCategoryLabel[issue.category]}).`,
        )
      }

      if (source === 'auto' && issue && context) {
        void runRecoveryPath(issue, context)
      }
    },
    [activeMode, orders, runRecoveryPath],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchOrders()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchOrders])

  useEffect(() => {
    if (!error) {
      return
    }

    const remainingMs = errorVisibleUntil - Date.now()
    if (remainingMs <= 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setError((current) => {
        if (!current) {
          return current
        }
        return Date.now() >= errorVisibleUntil ? null : current
      })
    }, remainingMs)

    return () => window.clearTimeout(timer)
  }, [error, errorVisibleUntil])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const supabaseClient = supabase
    if (activeMode !== 'live' || !supabaseClient) {
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
  }, [fetchOrders, activeMode])

  useEffect(() => {
    if (!isDemoMode || activeMode !== 'demo') {
      return
    }
    if (isRecoveryRunning || detectedIssue) {
      return
    }

    const timer = window.setInterval(() => {
      setOrders((current) => [createIncomingMockOrder(), ...current].slice(0, 18))
    }, 35_000)

    return () => window.clearInterval(timer)
  }, [activeMode, detectedIssue, isDemoMode, isRecoveryRunning])

  useEffect(() => {
    if (!isDemoMode || activeMode !== 'demo') {
      return
    }
    if (isRecoveryRunning || detectedIssue) {
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
  }, [activeMode, detectedIssue, isDemoMode, isRecoveryRunning, updatingOrderId])

  useEffect(() => {
    if (!isDemoMode || activeMode !== 'demo') {
      return
    }
    if (delayedDemoEvents.length === 0) {
      return
    }

    const timer = window.setInterval(() => {
      const now = Date.now()
      setDelayedDemoEvents((current) => {
        const dueEvents = current.filter((event) => event.applyAt <= now)
        if (dueEvents.length === 0) {
          return current
        }

        setOrders((orderList) => {
          let next = orderList
          for (const event of dueEvents) {
            next = next.map((order) =>
              order.id === event.orderId
                ? {
                    ...order,
                    status: event.toStatus,
                  }
                : order,
            )
          }
          return next
        })

        return current.filter((event) => event.applyAt > now)
      })
    }, 350)

    return () => window.clearInterval(timer)
  }, [activeMode, delayedDemoEvents.length, isDemoMode])

  useEffect(() => {
    if (!isDemoMode || activeMode !== 'demo' || loading || orders.length === 0) {
      return
    }
    if (typeof window === 'undefined') {
      return
    }
    if (window.sessionStorage.getItem(DEMO_AUTOSTART_SESSION_KEY) === '1') {
      return
    }

    window.sessionStorage.setItem(DEMO_AUTOSTART_SESSION_KEY, '1')
    const timer = window.setTimeout(() => {
      triggerDemoScenario('realtime_event_delayed', 'auto')
    }, 400)

    return () => window.clearTimeout(timer)
  }, [activeMode, isDemoMode, loading, orders.length, triggerDemoScenario])

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

  const handleModeChange = (nextMode: DataMode) => {
    if (nextMode === dataMode) {
      return
    }

    if (nextMode === 'live' && !liveModeAvailable) {
      setError('Live mode is unavailable. Add Supabase environment variables to enable it.')
      return
    }

    setLoading(true)
    setOrders([])
    setMovingOrderIds([])
    setUpdatingOrderId(null)
    setIsDemoMode(nextMode === 'demo')
    clearErrorIfExpired()
    clearDemoSimulatorState()
    setDataMode(nextMode)
  }

  const handleMoveOrder = async (orderId: number, currentStatus: OrderStatus) => {
    const nextStep: OrderStatus | 'complete' =
      currentStatus === 'new' ? 'prep' : currentStatus === 'prep' ? 'ready' : 'complete'

    setUpdatingOrderId(orderId)

    if (activeMode === 'demo' || !supabase) {
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

    const updateSucceeded = nextStep === 'complete' ? !updateError : !updateError && Boolean(updatedCount)

    if (!updateSucceeded) {
      const fallbackError = 'Supabase did not apply the status update. Check RLS policies for orders updates.'
      const readableError = formatSupabaseErrorMessage(updateError, fallbackError)
      console.error('KDS status update failed', {
        orderId,
        currentStatus,
        nextStep,
        databaseNextStatus,
        updatedCount,
        supabaseError: updateError,
      })
      showPersistentError(readableError)
      void fetchOrders()
    } else {
      clearErrorIfExpired()
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
      if (nextStep === 'complete') {
        window.setTimeout(() => {
          void fetchOrders()
        }, 300)
      }
    }

    setUpdatingOrderId(null)
  }

  const clearDetectedDemoIssue = () => {
    setDetectedIssue(null)
    setRecoveryContext(null)
    setRecoverySteps([])
    setIsRecoveryRunning(false)
    setLastResolvedIssueId(null)
    setScreenSnapshot(null)
  }

  const resetDemoOrders = () => {
    if (!isDemoMode) {
      return
    }

    setOrders(initialMockOrders())
    setMovingOrderIds([])
    clearDemoSimulatorState()
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
              {activeMode === 'live' ? 'Realtime connected' : 'Demo mode'}
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
                onClick={() => handleModeChange('demo')}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                  activeMode === 'demo'
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Demo
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('live')}
                disabled={!liveModeAvailable}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:text-slate-600 ${
                  activeMode === 'live'
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Live
              </button>
            </div>

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

        {isDemoMode && (
          <section className="mb-4 rounded-xl border border-violet-500/30 bg-violet-500/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-violet-200">
                  Demo Simulator / Debug Panel
                </h2>
                <p className="mt-1 text-sm text-violet-100/85">
                  Trigger realistic failures, auto-detect root cause, and run recovery playbooks.
                </p>
              </div>
              <div className="rounded-lg border border-violet-400/40 bg-violet-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-violet-100">
                Demo only
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {DEMO_SCENARIOS.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => triggerDemoScenario(scenario.id)}
                  className="rounded-lg border border-violet-400/40 bg-slate-900/75 px-3 py-2 text-left transition hover:border-violet-300 hover:bg-slate-900"
                >
                  <p className="text-sm font-semibold text-violet-100">{scenario.label}</p>
                  <p className="mt-1 text-xs text-slate-300">{scenario.summary}</p>
                </button>
              ))}
            </div>

            {detectedIssue && (
              <div className={`mt-3 rounded-lg border px-3 py-3 ${demoCategoryClass[detectedIssue.category]}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{detectedIssue.headline}</span>
                  <span className="rounded-md border border-current/40 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide">
                    {demoCategoryLabel[detectedIssue.category]}
                  </span>
                  {lastResolvedIssueId === detectedIssue.id && (
                    <span className="rounded-md border border-emerald-300/45 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-100">
                      Resolved
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm">{detectedIssue.explanation}</p>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={triggerRecoveryForCurrentIssue}
                disabled={!detectedIssue || isRecoveryRunning}
                className="rounded-lg border border-cyan-400/70 bg-cyan-500/20 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
              >
                Show Recovery Path
              </button>
              <button
                type="button"
                onClick={clearDetectedDemoIssue}
                disabled={isRecoveryRunning}
                className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600"
              >
                Clear issue
              </button>
              <span className="text-xs text-slate-300">
                Delayed events: {delayedDemoEvents.length} | Signal history: {demoSignals.length}
              </span>
            </div>

            {recoverySteps.length > 0 && (
              <ol className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                {recoverySteps.map((step, index) => (
                  <li key={step.id} className={`rounded-lg border px-3 py-2 ${recoveryStepClass[step.status]}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide">Step {index + 1}</p>
                    <p className="mt-1 text-sm font-semibold">{step.title}</p>
                    <p className="mt-1 text-xs">{step.description}</p>
                  </li>
                ))}
              </ol>
            )}

            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="rounded-lg border border-slate-700 bg-slate-900/75 px-3 py-2 text-xs text-slate-300">
                {screenSnapshot
                  ? `Screens diverged for #${screenSnapshot.orderId}: A=${screenSnapshot.screenA}, B=${screenSnapshot.screenB}`
                  : 'No multi-screen divergence currently simulated.'}
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-900/75 px-3 py-2 text-xs text-slate-300">
                {detectedIssue
                  ? `Detected: ${detectedIssue.label} at ${new Date(detectedIssue.detectedAt).toLocaleTimeString()}`
                  : 'No active simulated issue.'}
              </div>
            </div>

            {demoSignals.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-slate-300">
                {demoSignals.map((signal) => (
                  <li key={signal.id} className="rounded border border-slate-700 bg-slate-900/70 px-2.5 py-1.5">
                    <span className="font-semibold text-slate-100">{SCENARIO_BY_ID[signal.scenarioId].label}:</span>{' '}
                    {signal.details}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

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
