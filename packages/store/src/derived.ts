import { computed } from 'alien-signals'
import { Store } from './store'
import { __derivedToStore, __storeToDerived } from './scheduler'
import type { Listener } from './types'

export type UnwrapDerivedOrStore<T> =
  T extends Derived<infer InnerD>
    ? InnerD
    : T extends Store<infer InnerS>
      ? InnerS
      : never

type UnwrapReadonlyDerivedOrStoreArray<
  TArr extends ReadonlyArray<Derived<any> | Store<any>>,
> = TArr extends readonly []
  ? []
  : TArr extends readonly [infer Head, ...infer Tail]
    ? Head extends Derived<any> | Store<any>
      ? Tail extends ReadonlyArray<Derived<any> | Store<any>>
        ? [
            UnwrapDerivedOrStore<Head>,
            ...UnwrapReadonlyDerivedOrStoreArray<Tail>,
          ]
        : [UnwrapDerivedOrStore<Head>]
      : []
    : TArr extends ReadonlyArray<Derived<any> | Store<any>>
      ? Array<UnwrapDerivedOrStore<TArr[number]>>
      : []

export interface DerivedFnProps<
  TArr extends ReadonlyArray<Derived<any> | Store<any>> = ReadonlyArray<any>,
  TUnwrappedArr extends
    UnwrapReadonlyDerivedOrStoreArray<TArr> = UnwrapReadonlyDerivedOrStoreArray<TArr>,
> {
  /**
   * `undefined` if it's the first run
   * @privateRemarks this also cannot be typed as TState, as it breaks the inferencing of the function's return type when an argument is used - even with `NoInfer` usage
   */
  prevVal: unknown | undefined
  prevDepVals: TUnwrappedArr | undefined
  currDepVals: TUnwrappedArr
}

export interface DerivedOptions<
  TState,
  TArr extends ReadonlyArray<Derived<any> | Store<any>> = ReadonlyArray<any>,
> {
  onSubscribe?: (
    listener: Listener<TState>,
    derived: Derived<TState>,
  ) => () => void
  onUpdate?: () => void
  deps: TArr
  /**
   * Values of the `deps` from before and after the current invocation of `fn`
   */
  fn: (props: DerivedFnProps<TArr>) => TState
}

export class Derived<
  TState,
  const TArr extends ReadonlyArray<
    Derived<any> | Store<any>
  > = ReadonlyArray<any>,
> {
  listeners = new Set<Listener<TState>>()
  private _computed: ReturnType<typeof computed<TState>>
  private _cachedState: TState
  prevState: TState | undefined
  options: DerivedOptions<TState, TArr>
  private _isFirstRun = true

  /**
   * Functions representing the subscriptions. Call a function to cleanup
   * @private
   */
  _subscriptions: Array<() => void> = []

  lastSeenDepValues: Array<unknown> = []
  getDepVals = () => {
    const l = this.options.deps.length
    const prevDepVals = new Array<unknown>(l)
    const currDepVals = new Array<unknown>(l)
    for (let i = 0; i < l; i++) {
      const dep = this.options.deps[i]!
      prevDepVals[i] = dep.prevState
      currDepVals[i] = dep.state
    }
    this.lastSeenDepValues = currDepVals
    return {
      prevDepVals: this._isFirstRun ? undefined : prevDepVals,
      currDepVals,
      prevVal: this.prevState ?? undefined,
    }
  }

  constructor(options: DerivedOptions<TState, TArr>) {
    this.options = options

    this._computed = computed(() => {
      const depVals = this.getDepVals()
      const result = options.fn(depVals as never)
      this._isFirstRun = false
      return result
    })

    this._cachedState = this._computed()
  }

  get state(): TState {
    this._cachedState = this._computed()
    return this._cachedState
  }

  registerOnGraph(
    deps: ReadonlyArray<Derived<any> | Store<any>> = this.options.deps,
  ) {
    const toSort = new Set<Array<Derived<unknown>>>()
    for (const dep of deps) {
      if (dep instanceof Derived) {
        dep.registerOnGraph()
        this.registerOnGraph(dep.options.deps)
      } else if (dep instanceof Store) {
        let relatedLinkedDerivedVals = __storeToDerived.get(dep)
        if (!relatedLinkedDerivedVals) {
          relatedLinkedDerivedVals = [this as never]
          __storeToDerived.set(dep, relatedLinkedDerivedVals)
        } else if (!relatedLinkedDerivedVals.includes(this as never)) {
          relatedLinkedDerivedVals.push(this as never)
          toSort.add(relatedLinkedDerivedVals)
        }

        let relatedStores = __derivedToStore.get(this as never)
        if (!relatedStores) {
          relatedStores = new Set()
          __derivedToStore.set(this as never, relatedStores)
        }
        relatedStores.add(dep)
      }
    }
    for (const arr of toSort) {
      arr.sort((a, b) => {
        if (a instanceof Derived && a.options.deps.includes(b)) return 1
        if (b instanceof Derived && b.options.deps.includes(a)) return -1
        return 0
      })
    }
  }

  unregisterFromGraph(
    deps: ReadonlyArray<Derived<any> | Store<any>> = this.options.deps,
  ) {
    for (const dep of deps) {
      if (dep instanceof Derived) {
        this.unregisterFromGraph(dep.options.deps)
      } else if (dep instanceof Store) {
        const relatedLinkedDerivedVals = __storeToDerived.get(dep)
        if (relatedLinkedDerivedVals) {
          relatedLinkedDerivedVals.splice(
            relatedLinkedDerivedVals.indexOf(this as never),
            1,
          )
        }

        const relatedStores = __derivedToStore.get(this as never)
        if (relatedStores) {
          relatedStores.delete(dep)
        }
      }
    }
  }

  recompute = () => {
    this.prevState = this._cachedState
    this._cachedState = this._computed()

    this.options.onUpdate?.()
  }

  checkIfRecalculationNeededDeeply = () => {
    for (const dep of this.options.deps) {
      if (dep instanceof Derived) {
        dep.checkIfRecalculationNeededDeeply()
      }
    }
    let shouldRecompute = false
    const lastSeenDepValues = this.lastSeenDepValues
    const { currDepVals } = this.getDepVals()
    for (let i = 0; i < currDepVals.length; i++) {
      if (currDepVals[i] !== lastSeenDepValues[i]) {
        shouldRecompute = true
        break
      }
    }

    if (shouldRecompute) {
      this.recompute()
    }
  }

  mount = () => {
    this.registerOnGraph()
    this.checkIfRecalculationNeededDeeply()

    return () => {
      this.unregisterFromGraph()
      for (const cleanup of this._subscriptions) {
        cleanup()
      }
    }
  }

  subscribe = (listener: Listener<TState>) => {
    this.listeners.add(listener)
    const unsub = this.options.onSubscribe?.(listener, this)
    return () => {
      this.listeners.delete(listener)
      unsub?.()
    }
  }
}
