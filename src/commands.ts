// The single place actions are defined. Buttons, keybinds and the palette all run these.

export interface Command {
  id: string
  label: string
  /** Default key combo, e.g. "Ctrl+Shift+S". */
  keys?: string
  /** Icon name from ui/icons.ts; commands with an icon can appear in the top bar. */
  icon?: string
  /** Hide from the command palette. */
  hidden?: boolean
  run: () => unknown
}

const registry = new Map<string, Command>()

export function register(...cmds: Command[]): void {
  for (const c of cmds) registry.set(c.id, c)
}

export function unregister(prefix: string): void {
  for (const id of [...registry.keys()]) if (id.startsWith(prefix)) registry.delete(id)
}

export function get(id: string): Command | undefined {
  return registry.get(id)
}

export function all(): Command[] {
  return [...registry.values()]
}

export function run(id: string): boolean {
  const c = registry.get(id)
  if (!c) return false
  try {
    const r = c.run()
    if (r instanceof Promise) r.catch((e) => console.error(`command ${id}:`, e))
  } catch (e) {
    console.error(`command ${id}:`, e)
  }
  return true
}
