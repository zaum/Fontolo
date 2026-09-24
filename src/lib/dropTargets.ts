/**
 * Per-row drop filters for sidebar family drops. A row registers the
 * predicate that narrows the dragged families down to the ones it can
 * actually change; the card drag code consults it while hovering, so a row
 * with nothing to do never lights up, and the row re-checks at drop time.
 */
export type FamilyDropFilter = (families: string[]) => string[];

const filters = new Map<HTMLElement, FamilyDropFilter>();

export function registerDropFilter(el: HTMLElement, filter: FamilyDropFilter | undefined) {
  if (filter) filters.set(el, filter);
  else filters.delete(el);
}

export function applicableFamilies(el: HTMLElement, families: string[]): string[] {
  const filter = filters.get(el);
  return filter ? filter(families) : families;
}
