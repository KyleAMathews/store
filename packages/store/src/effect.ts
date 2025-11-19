import { effect as alienEffect, effectScope } from 'alien-signals'
import { Derived } from './derived'
import type { Store } from './store'

interface EffectOptions {
  /**
   * Should the effect trigger immediately?
   * @default false
   */
  eager?: boolean
  deps: ReadonlyArray<Derived<any> | Store<any>>
  fn: () => void
}

export class Effect {
  /**
   * @private
   */
  private _stopEffect: (() => void) | null = null
  private options: EffectOptions

  constructor(opts: EffectOptions) {
    this.options = opts

    if (opts.eager) {
      opts.fn()
    }
  }

  mount() {
    let isFirstRun = true

    this._stopEffect = effectScope(() => {
      alienEffect(() => {
        for (const dep of this.options.deps) {
          dep.state
        }

        if (isFirstRun) {
          isFirstRun = false
          return
        }

        this.options.fn()
      })
    })

    return () => {
      this._stopEffect?.()
      this._stopEffect = null
    }
  }
}
