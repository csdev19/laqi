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
export type ExampleModelId = 'simple' | 'medium' | 'complex' | 'flat'

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

// Deliberately one declaration and nothing else: no `extends`, no helper
// aliases, no imports. Everything a model can say, said inline, so the
// parser is exercised without anything to flatten first.
const FLAT = `export interface Invoice {
  readonly id: string
  number: string
  status: 'draft' | 'issued' | 'paid' | 'void'
  issuedAt: Date
  dueAt: Date | null
  currency: 'USD' | 'EUR' | 'PEN'
  customer: {
    id: number
    name: string
    email: string
    vatId?: string
    billing: {
      street: string
      city: string
      country: 'PE' | 'US' | 'DE'
      postalCode?: string
      coordinates: [number, number]
      contact: {
        name: string
        phone: string | null
        preferred: 'email' | 'phone' | 'none'
      }
    }
  }
  lines: Array<{
    sku: string
    description: string
    quantity: number
    unitPrice: number
    taxRate: 0 | 0.1 | 0.18
    discount?: {
      code: string
      percent: number
    }
  }>
  totals: {
    subtotal: number
    tax: number
    total: number
    perCurrency: Record<string, number>
  }
  payments: Array<{
    method: 'card' | 'transfer' | 'cash'
    amount: number
    at: Date
    reference: string | null
  }>
  attachments?: Array<{
    name: string
    sizeBytes: number
    url: string
  }>
  tags: string[]
  metadata: Record<string, string>
  notes: string | null
  createdBy: {
    userId: string
    role: 'system' | 'agent' | 'human'
  }
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
  {
    id: 'flat',
    title: 'flat',
    blurb:
      'One big self-contained interface: no extends, no helper types, four levels written inline.',
    typeName: 'Invoice',
    source: FLAT,
  },
]

export function exampleModel(id: ExampleModelId): ExampleModel {
  const found = EXAMPLE_MODELS.find((model) => model.id === id)
  if (!found) throw new Error(`no example model ${JSON.stringify(id)}`)
  return found
}

/** A JSON body the panel can paste into its "from JSON" flow. */
export type ExampleBodyId = 'list' | 'invoice'

export type ExampleBody = {
  id: ExampleBodyId
  title: string
  blurb: string
  source: string
}

const LIST_BODY = `{
  "items": [
    { "id": 1, "title": "Buy milk", "completed": false },
    { "id": 2, "title": "Ship the release", "completed": true }
  ],
  "total": 2,
  "page": 1,
  "hasMore": false
}
`

// The same data the FLAT model describes. Pasting this and asking the
// endpoint for its types gives back that interface, give or take what JSON
// cannot carry: a date arrives as a string, and an absent optional field is
// simply not there to be seen.
const INVOICE_BODY = `{
  "id": "inv_9c1f2a",
  "number": "INV-2026-0042",
  "status": "issued",
  "issuedAt": "2026-09-01T10:15:00.000Z",
  "dueAt": "2026-09-30T23:59:59.000Z",
  "currency": "PEN",
  "customer": {
    "id": 187,
    "name": "Andina Software SAC",
    "email": "cuentas@andina.pe",
    "vatId": "20554873291",
    "billing": {
      "street": "Av. Larco 1301",
      "city": "Miraflores",
      "country": "PE",
      "postalCode": "15074",
      "coordinates": [-12.1301, -77.0301],
      "contact": {
        "name": "Rosa Quispe",
        "phone": "+51 987 654 321",
        "preferred": "email"
      }
    }
  },
  "lines": [
    {
      "sku": "LAQI-TEAM",
      "description": "laqi, team plan, 12 months",
      "quantity": 1,
      "unitPrice": 1200,
      "taxRate": 0.18,
      "discount": { "code": "LAUNCH", "percent": 15 }
    },
    {
      "sku": "SUPPORT-8H",
      "description": "Onboarding support, 8 hours",
      "quantity": 8,
      "unitPrice": 90,
      "taxRate": 0.18
    }
  ],
  "totals": {
    "subtotal": 1740,
    "tax": 313.2,
    "total": 2053.2,
    "perCurrency": { "PEN": 2053.2, "USD": 545.8 }
  },
  "payments": [
    {
      "method": "transfer",
      "amount": 1000,
      "at": "2026-09-05T14:02:11.000Z",
      "reference": "BCP-88213"
    },
    {
      "method": "card",
      "amount": 1053.2,
      "at": "2026-09-12T09:40:00.000Z",
      "reference": null
    }
  ],
  "attachments": [
    { "name": "invoice.pdf", "sizeBytes": 84213, "url": "https://files.example.com/inv_9c1f2a.pdf" }
  ],
  "tags": ["renewal", "priority"],
  "metadata": { "channel": "web", "owner": "billing" },
  "notes": null,
  "createdBy": { "userId": "usr_31", "role": "human" }
}
`

export const EXAMPLE_BODIES: readonly ExampleBody[] = [
  {
    id: 'list',
    title: 'list',
    blurb: 'A paginated collection, the shape most endpoints return.',
    source: LIST_BODY,
  },
  {
    id: 'invoice',
    title: 'invoice',
    blurb: 'The same data the flat model describes: paste it, then read its types back.',
    source: INVOICE_BODY,
  },
]

export function exampleBody(id: ExampleBodyId): ExampleBody {
  const found = EXAMPLE_BODIES.find((body) => body.id === id)
  if (!found) throw new Error(`no example body ${JSON.stringify(id)}`)
  return found
}
