import { signal, effect, effectScope } from 'alien-signals'
import { queueSignalUpdate, __flush, __storeToDerived } from './scheduler'
import { isUpdaterFunction } from './types'
import type { AnyUpdater, Listener, Updater } from './types'

export interface StoreOptions<
  TState,
  TUpdater extends AnyUpdater = (cb: TState) => TState,
> {
  /**
   * Replace the default update function with a custom one.
   */
  updateFn?: (previous: TState) => (updater: TUpdater) => TState
  /**
   * Called when a listener subscribes to the store.
   *
   * @return a function to unsubscribe the listener
   */
  onSubscribe?: (
    listener: Listener<TState>,
    store: Store<TState, TUpdater>,
  ) => () => void
  /**
   * Called after the state has been updated, used to derive other state.
   */
  onUpdate?: () => void
}

export class Store<
  TState,
  TUpdater extends AnyUpdater = (cb: TState) => TState,
> {
  listeners = new Set<Listener<TState>>()
  private _signal: ReturnType<typeof signal<TState>>
  prevState: TState
  options?: StoreOptions<TState, TUpdater>

  constructor(initialState: TState, options?: StoreOptions<TState, TUpdater>) {
    this.prevState = initialState
    this._signal = signal(initialState)
    this.options = options
  }

  get state(): TState {
    return this._signal()
  }

  set state(value: TState) {
    this._signal(value)
  }

  subscribe = (listener: Listener<TState>) => {
    this.listeners.add(listener)
    const unsub = this.options?.onSubscribe?.(listener, this)

    let prevVal = this.state
    let isFirstRun = true

    const stopEffect = effectScope(() => {
      effect(() => {
        const currentVal = this.state
        if (isFirstRun) {
          isFirstRun = false
          prevVal = currentVal
          return
        }
        listener({ prevVal: prevVal as never, currentVal: currentVal as never })
        prevVal = currentVal
      })
    })

    return () => {
      this.listeners.delete(listener)
      stopEffect()
      unsub?.()
    }
  }

  /**
   * Update the store state safely with improved type checking
   */
  setState(updater: (prevState: TState) => TState): void
  setState(updater: TState): void
  setState(updater: TUpdater): void
  setState(updater: Updater<TState> | TUpdater): void {
    // Queue the signal update - will be applied immediately if not batching,
    // or deferred until batch ends if batching. Use 'this' as key to only
    // keep last update per store during batch.
    queueSignalUpdate(this, () => {
      const prevState = this.state

      // Update prevState BEFORE setting the signal so that when alien-signals
      // propagates to computed values, they see the correct prevState
      this.prevState = prevState

      if (this.options?.updateFn) {
        this.state = this.options.updateFn(prevState)(updater as TUpdater)
      } else {
        if (isUpdaterFunction(updater)) {
          this.state = updater(prevState)
        } else {
          this.state = updater as TState
        }
      }

      this.options?.onUpdate?.()

      // Only flush if deriveds are mounted (registered on graph)
      // alien-signals effects handle subscribed deriveds automatically
      if (__storeToDerived.has(this as unknown as Store<unknown>)) {
        __flush(this as unknown as Store<unknown>)
      }
    })
  }
}
