/**
 * Complex model: what a real API model file looks like once it has been
 * alive for a while. Four levels of nesting
 * (`Order.customer.address.geo.lat`), literal unions behind aliases, a
 * discriminated union, intersections, `Pick`/`Omit`/`Partial`/`Record`,
 * tuples, `readonly`, template-literal strings, `Date`, `null`, optional
 * fields and inline objects inside arrays.
 *
 * Expected shape: an object rooted at `Order` (the first exported type is
 * `Currency`, so pass the name). Expected warnings: `payment` and
 * `metadata` carry mixed unions, which the checker narrows to one member.
 */
export type Currency = 'USD' | 'EUR' | 'PEN'
export type OrderStatus = 'draft' | 'paid' | 'shipped' | 'delivered' | 'cancelled'
export type IsoDate = `${number}-${number}-${number}`

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
