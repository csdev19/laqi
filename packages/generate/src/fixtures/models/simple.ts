/**
 * Simple model: one flat interface with primitives, an optional field and a
 * Date. Paste it into the panel's "from a model" box as is, or read it in a
 * test with `readModel('simple')`.
 *
 * Expected shape: an object with 5 fields, no warnings.
 */
export interface Todo {
  id: number
  title: string
  completed: boolean
  priority: 'low' | 'medium' | 'high'
  dueDate?: Date
}
