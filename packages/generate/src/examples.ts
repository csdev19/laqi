/**
 * The example models the panel offers and the parser tests exercise.
 *
 * Strings, not files, and no imports at all: this module is loaded in the
 * browser (the panel's "from a model" box) and in Node (the tests), and one
 * source is what keeps the button and the test honest about each other.
 * That the source is valid TypeScript is proved by `examples.test.ts`,
 * which compiles each one and asserts the checker reports nothing — a
 * stronger guarantee than `tsc` over a fixture file, because it checks the
 * exact text that ships to the panel.
 */
export type ExampleModelId = 'simple' | 'medium' | 'complex'

export type ExampleModel = {
  id: ExampleModelId
  /** What the button says. */
  title: string
  /** One line on what makes it worth pasting. */
  blurb: string
  /** The type the parser should be pointed at. */
  typeName: string
  source: string
}

const SIMPLE = `export interface Todo {
  id: number
  title: string
  completed: boolean
  priority: 'low' | 'medium' | 'high'
  dueDate?: Date
}
`

const MEDIUM = `export type Role = 'owner' | 'editor' | 'viewer'

interface Timestamped {
  createdAt: Date
  updatedAt: Date | null
}

export interface User {
  id: number
  name: string
  email: string
  avatarUrl?: string
}

export interface Member extends Timestamped {
  user: User
  role: Role
  active: boolean
}

export interface Project extends Timestamped {
  id: string
  name: string
  description: string | null
  visibility: 'public' | 'private'
  owner: User
  members: Member[]
  labels: Record<string, string>
  settings: {
    notifications: boolean
    defaultBranch: string
    retentionDays?: number
  }
  stars: number
  archived: boolean
}
`

// The one escaped line is IsoDate: a template literal type inside a
// template literal string. Everything else is the model as written.
const COMPLEX = `export type Currency = 'USD' | 'EUR' | 'PEN'
export type OrderStatus = 'draft' | 'paid' | 'shipped' | 'delivered' | 'cancelled'
export type IsoDate = \`\${number}-\${number}-\${number}\`

interface Identified {
  readonly id: string
}

interface Timestamps {
  createdAt: Date
  updatedAt: Date | null
}

export type Money = {
  amount: number
  currency: Currency
}

export interface GeoPoint {
  lat: number
  lng: number
  accuracy?: number
}

export interface Address extends Identified {
  street: string
  city: string
  zip?: string
  country: 'PE' | 'US' | 'DE'
  geo: GeoPoint
}

export interface Customer extends Identified, Timestamps {
  name: string
  email: string
  phone: string | null
  tier: 'free' | 'pro' | 'enterprise'
  address: Address
  preferences: Partial<{
    newsletter: boolean
    locale: 'en' | 'es'
  }>
  tags: string[]
}

export interface Product extends Identified {
  name: string
  price: Money
  dimensions: [number, number, number]
  attributes: Record<string, string>
}

export type Sku = Pick<Product, 'id' | 'name'> & { variant?: string }

export interface LineItem {
  product: Sku
  quantity: number
  unitPrice: Money
  discounts: Array<{ code: string; percent: number }>
}

export type Payment =
  | { method: 'card'; last4: string; brand: 'visa' | 'mastercard' }
  | { method: 'transfer'; reference: string }
  | { method: 'cash' }

export type Shipment = Omit<Address, 'geo'> & {
  carrier: 'dhl' | 'ups' | 'serpost'
  eta: Date
  tracking: readonly string[]
}

export interface Order extends Identified, Timestamps {
  status: OrderStatus
  placedOn: IsoDate
  customer: Customer
  items: LineItem[]
  payment: Payment
  shipment?: Shipment
  totals: {
    subtotal: Money
    tax: Money
    grand: Money
    breakdown: Array<[Currency, number]>
  }
  notes: string | null
  history: Array<{
    at: Date
    from: OrderStatus
    to: OrderStatus
    by: { userId: string; role: 'system' | 'agent' }
  }>
  metadata: Record<string, string | number>
}
`

export const EXAMPLE_MODELS: readonly ExampleModel[] = [
  {
    id: 'simple',
    title: 'simple',
    blurb: 'One flat interface: primitives, a literal union, an optional Date.',
    typeName: 'Todo',
    source: SIMPLE,
  },
  {
    id: 'medium',
    title: 'medium',
    blurb: 'Interfaces referencing each other, extends, arrays of objects, a Record.',
    typeName: 'Project',
    source: MEDIUM,
  },
  {
    id: 'complex',
    title: 'complex',
    blurb:
      'Four levels deep: unions, intersections, Pick/Omit/Partial, tuples, readonly, template literals.',
    typeName: 'Order',
    source: COMPLEX,
  },
]

export function exampleModel(id: ExampleModelId): ExampleModel {
  const found = EXAMPLE_MODELS.find((model) => model.id === id)
  if (!found) throw new Error(`no example model ${JSON.stringify(id)}`)
  return found
}
