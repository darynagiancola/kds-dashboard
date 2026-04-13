export const ORDER_STATUSES = ['new', 'prep', 'ready'] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]
export const ORDER_PRIORITIES = ['normal', 'high', 'rush'] as const
export type OrderPriority = (typeof ORDER_PRIORITIES)[number]

export interface Modifier {
  id: number
  text: string
}

export interface OrderItem {
  id: number
  name: string
  modifiers: Modifier[]
}

export interface Order {
  id: number
  table_number: number
  status: OrderStatus
  priority: OrderPriority
  created_at: string
  order_items: OrderItem[]
}
