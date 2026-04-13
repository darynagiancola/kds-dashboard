import type { Order, OrderItem, OrderStatus, OrderPriority } from '../types/orders'

const minutesAgo = (minutes: number): string => {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

let nextOrderId = 410
let nextItemId = 4_000
let nextModifierId = 8_000

const createItem = (name: string, modifiers: string[] = []): OrderItem => {
  const itemId = nextItemId
  nextItemId += 1

  return {
    id: itemId,
    name,
    modifiers: modifiers.map((text) => {
      const modifier = { id: nextModifierId, text }
      nextModifierId += 1
      return modifier
    }),
  }
}

const newOrderFromTemplate = (
  table_number: number,
  status: OrderStatus,
  priority: OrderPriority,
  ageMinutes: number,
  items: Array<{ name: string; modifiers?: string[] }>,
): Order => {
  const orderId = nextOrderId
  nextOrderId += 1

  return {
    id: orderId,
    table_number,
    status,
    priority,
    created_at: minutesAgo(ageMinutes),
    order_items: items.map((item) => createItem(item.name, item.modifiers)),
  }
}

export const initialMockOrders = (): Order[] => [
  newOrderFromTemplate(12, 'new', 'rush', 2, [
    { name: 'Smash Burger', modifiers: ['well done', 'no onion'] },
    { name: 'Fries', modifiers: ['extra crispy'] },
    { name: 'Iced Tea', modifiers: ['no ice'] },
  ]),
  newOrderFromTemplate(7, 'new', 'high', 4, [
    { name: 'Chicken Caesar Salad', modifiers: ['dressing on side'] },
    { name: 'Tomato Soup', modifiers: ['extra hot'] },
  ]),
  newOrderFromTemplate(4, 'prep', 'high', 11, [
    { name: 'Fish Tacos', modifiers: ['no cilantro', 'add avocado'] },
    { name: 'Street Corn', modifiers: ['light mayo'] },
  ]),
  newOrderFromTemplate(15, 'prep', 'normal', 9, [
    { name: 'Margherita Pizza', modifiers: ['well done crust'] },
    { name: 'House Salad', modifiers: ['no croutons'] },
  ]),
  newOrderFromTemplate(2, 'ready', 'normal', 14, [
    { name: 'Pasta Alfredo', modifiers: ['add grilled chicken'] },
    { name: 'Garlic Bread' },
  ]),
  newOrderFromTemplate(19, 'ready', 'rush', 7, [
    { name: 'Ribeye Steak', modifiers: ['medium rare', 'sauce on side'] },
    { name: 'Mashed Potatoes', modifiers: ['extra butter'] },
  ]),
]

const incomingOrderTemplates: Array<{
  table: number
  priority: OrderPriority
  items: Array<{ name: string; modifiers?: string[] }>
}> = [
  {
    table: 22,
    priority: 'high',
    items: [
      { name: 'Crispy Chicken Sandwich', modifiers: ['no pickles'] },
      { name: 'Sweet Potato Fries' },
    ],
  },
  {
    table: 3,
    priority: 'normal',
    items: [
      { name: 'Greek Salad', modifiers: ['no olives', 'feta on side'] },
      { name: 'Lemonade', modifiers: ['light sugar'] },
    ],
  },
  {
    table: 10,
    priority: 'rush',
    items: [
      { name: 'Kids Mac and Cheese', modifiers: ['cool quickly'] },
      { name: 'Apple Juice' },
    ],
  },
]

let templateIndex = 0

export const createIncomingMockOrder = (): Order => {
  const template = incomingOrderTemplates[templateIndex % incomingOrderTemplates.length]
  templateIndex += 1

  return newOrderFromTemplate(template.table, 'new', template.priority, 1, template.items)
}
