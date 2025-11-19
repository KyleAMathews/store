import type { Derived } from './derived'
import type { Store } from './store'

/**
 * This is here to solve the pyramid dependency problem where:
 *       A
 *      / \
 *     B   C
 *      \ /
 *       D
 *
 * Where we deeply traverse this tree, how do we avoid D being recomputed twice; once when B is updated, once when C is.
 *
 * To solve this, we create linkedDeps that allows us to sync avoid writes to the state until all of the deps have been
 * resolved.
 *
 * This is a record of stores, because derived stores are not able to write values to, but stores are
 */
export const __storeToDerived = new WeakMap<
  Store<unknown>,
  Array<Derived<unknown>>
>()
export const __derivedToStore = new WeakMap<
  Derived<unknown>,
  Set<Store<unknown>>
>()

let __depsThatHaveWrittenThisTick = new Set<Derived<unknown> | Store<unknown>>()

let __isFlushing = false
let __batchDepth = 0
const __pendingUpdates = new Set<Store<unknown>>()
const __initialBatchValues = new Map<Store<unknown>, unknown>()
const __pendingSignalUpdates = new Map<any, () => void>()

export function getBatchDepth() {
  return __batchDepth
}

export function queueSignalUpdate(storeId: any, fn: () => void) {
  if (__batchDepth > 0) {
    // Only keep the last update for each store during batch
    __pendingSignalUpdates.set(storeId, fn)
  } else {
    fn()
  }
}

function __flush_internals(relatedVals: ReadonlyArray<Derived<unknown>>) {
  for (const derived of relatedVals) {
    if (__depsThatHaveWrittenThisTick.has(derived)) {
      continue
    }

    __depsThatHaveWrittenThisTick.add(derived)
    derived.recompute()
    __notifyDerivedListeners(derived)

    const stores = __derivedToStore.get(derived)
    if (stores) {
      for (const store of stores) {
        const relatedLinkedDerivedVals = __storeToDerived.get(store)
        if (!relatedLinkedDerivedVals?.length) continue
        __flush_internals(relatedLinkedDerivedVals)
      }
    }
  }
}

// Listener notification is now handled by alien-signals effects in subscribe()
// These functions are no longer needed but kept for reference
function __notifyListeners(_store: Store<unknown>) {
  // No-op: alien-signals effects handle this
}

function __notifyDerivedListeners(_derived: Derived<unknown>) {
  // No-op: alien-signals effects handle this
}

/**
 * @private only to be called from `Store` on write
 */
export function __flush(store: Store<unknown>) {
  if (__batchDepth > 0 && !__initialBatchValues.has(store)) {
    __initialBatchValues.set(store, store.prevState)
  }

  __pendingUpdates.add(store)

  if (__batchDepth > 0) return
  if (__isFlushing) return

  try {
    __isFlushing = true

    while (__pendingUpdates.size > 0) {
      const stores = Array.from(__pendingUpdates)
      __pendingUpdates.clear()

      for (const store of stores) {
        const prevState = __initialBatchValues.get(store) ?? store.prevState
        store.prevState = prevState
        __notifyListeners(store)
      }

      for (const store of stores) {
        const derivedVals = __storeToDerived.get(store)
        if (!derivedVals) continue

        __depsThatHaveWrittenThisTick.add(store)
        __flush_internals(derivedVals)
      }
    }
  } finally {
    __isFlushing = false
    __depsThatHaveWrittenThisTick.clear()
    __initialBatchValues.clear()
  }
}

export function batch(fn: () => void) {
  __batchDepth++
  try {
    fn()
  } finally {
    __batchDepth--
    if (__batchDepth === 0) {
      // Apply all queued signal updates
      // Since we only kept the last update per store, each effect fires once
      const updates = Array.from(__pendingSignalUpdates.values())
      __pendingSignalUpdates.clear()
      for (const update of updates) {
        update()
      }
    }
  }
}
