import type { OrderStatus } from '../types/orders'

export type DemoScenarioId =
  | 'order_disappears'
  | 'status_skips_stage'
  | 'wrong_column'
  | 'duplicate_status_change'
  | 'realtime_event_delayed'
  | 'stale_state'
  | 'inconsistent_screens'

export type DemoIssueCategory = 'logic_error' | 'race_condition' | 'realtime_delay' | 'data_inconsistency'

export type RecoveryStepState = 'pending' | 'running' | 'resolved'

export interface DemoScenarioDefinition {
  id: DemoScenarioId
  label: string
  summary: string
  category: DemoIssueCategory
}

export interface DemoDetectedIssue {
  id: string
  scenarioId: DemoScenarioId
  label: string
  category: DemoIssueCategory
  headline: string
  explanation: string
  detectedAt: number
}

export interface RecoveryStep {
  id: string
  title: string
  description: string
  status: RecoveryStepState
}

export const DEMO_SCENARIOS: DemoScenarioDefinition[] = [
  {
    id: 'order_disappears',
    label: 'Order disappears',
    summary: 'Simulates a dropped event that removes a ticket unexpectedly.',
    category: 'data_inconsistency',
  },
  {
    id: 'status_skips_stage',
    label: 'Status skips stage',
    summary: 'Simulates an invalid jump such as New -> Ready.',
    category: 'logic_error',
  },
  {
    id: 'wrong_column',
    label: 'Card lands in wrong column',
    summary: 'Simulates a transition acknowledged by UI but not reflected correctly.',
    category: 'logic_error',
  },
  {
    id: 'duplicate_status_change',
    label: 'Duplicate status change',
    summary: 'Simulates the same transition being applied twice.',
    category: 'race_condition',
  },
  {
    id: 'realtime_event_delayed',
    label: 'Realtime event delayed',
    summary: 'Simulates slow event delivery that arrives late.',
    category: 'realtime_delay',
  },
  {
    id: 'stale_state',
    label: 'Stale state',
    summary: 'Simulates stale cache where a client sees an old version.',
    category: 'data_inconsistency',
  },
  {
    id: 'inconsistent_screens',
    label: 'Inconsistent screens',
    summary: 'Simulates two displays showing different statuses.',
    category: 'data_inconsistency',
  },
]

export const SCENARIO_BY_ID: Record<DemoScenarioId, DemoScenarioDefinition> = DEMO_SCENARIOS.reduce(
  (acc, scenario) => ({ ...acc, [scenario.id]: scenario }),
  {} as Record<DemoScenarioId, DemoScenarioDefinition>,
)

export const nextStatus = (status: OrderStatus): OrderStatus => {
  if (status === 'new') return 'prep'
  if (status === 'prep') return 'ready'
  return 'ready'
}

const BASE_RECOVERY_STEPS: Array<{ id: string; title: string; description: string }> = [
  {
    id: 'detect',
    title: 'Detect anomaly',
    description: 'Inspect telemetry and confirm the exact mismatch in board state.',
  },
  {
    id: 'stabilize',
    title: 'Stabilize state',
    description: 'Pause automatic progression and lock the affected ticket snapshot.',
  },
  {
    id: 'repair',
    title: 'Apply repair',
    description: 'Reconcile ticket status and placement with the canonical progression.',
  },
  {
    id: 'verify',
    title: 'Verify consistency',
    description: 'Re-check board columns and simulated screens for agreement.',
  },
]

export const buildRecoveryPlaybook = (scenarioId: DemoScenarioId): RecoveryStep[] => {
  const repairStepDescription: Record<DemoScenarioId, string> = {
    order_disappears: 'Rehydrate the missing order payload back into the New/Prep/Ready pipeline.',
    status_skips_stage: 'Rollback to the nearest legal stage and replay transitions in proper order.',
    wrong_column: 'Move the card to the expected column based on latest transition intent.',
    duplicate_status_change: 'Discard duplicate transition event and keep the first accepted transition.',
    realtime_event_delayed: 'Flush delayed event queue and mark late delivery with a warning.',
    stale_state: 'Refresh stale snapshot from canonical board state and bump observed version.',
    inconsistent_screens: 'Synchronize all screen snapshots to a single canonical order list.',
  }

  return BASE_RECOVERY_STEPS.map((step) => ({
    ...step,
    description: step.id === 'repair' ? repairStepDescription[scenarioId] : step.description,
    status: 'pending',
  }))
}

