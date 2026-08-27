/** "GET /users/:id" → "Users" — a PascalCase type name from the path. */
export function typeNameFor(id: string): string {
  const path = id.split(' ')[1] ?? ''
  const words = path.split('/').filter((part) => part && !part.startsWith(':'))
  const name = words
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ' '))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('')
  return name || 'Response'
}
