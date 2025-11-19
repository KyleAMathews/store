/* istanbul ignore file -- @preserve */
import { bench, describe } from 'vitest'
import { shallowRef, computed as vueComputed, watchEffect } from 'vue'
import { createEffect, createMemo, createSignal, createRoot } from 'solid-js'
import {
  computed as preactComputed,
  effect as preactEffect,
  signal as preactSignal,
} from '@preact/signals'
import {
  computed as angularComputed,
  signal as angularSignal,
} from '@angular/core'
import { createWatch } from '@angular/core/primitives/signals'
import { Store } from '../src/store'
import { Derived } from '../src/derived'

function noop(val: any) {
  val
}

/**
 * UPDATE PERFORMANCE ONLY (graph pre-created outside bench)
 *         A
 *        / \
 *       B   C
 *      / \  |
 *     D  E  F
 *      \ / |
 *       \ /
 *        G
 */
describe('Update Only', () => {
  // TanStack - create graph ONCE (like Vue/Solid/Angular: just create + subscribe)
  const tanstack_a = new Store(1)
  const tanstack_b = new Derived({ deps: [tanstack_a], fn: () => tanstack_a.state })
  const tanstack_c = new Derived({ deps: [tanstack_a], fn: () => tanstack_a.state })
  const tanstack_d = new Derived({ deps: [tanstack_b], fn: () => tanstack_b.state })
  const tanstack_e = new Derived({ deps: [tanstack_b], fn: () => tanstack_b.state })
  const tanstack_f = new Derived({ deps: [tanstack_c], fn: () => tanstack_c.state })
  const tanstack_g = new Derived({
    deps: [tanstack_d, tanstack_e, tanstack_f],
    fn: () => tanstack_d.state + tanstack_e.state + tanstack_f.state,
  })
  tanstack_g.subscribe(() => noop(tanstack_g.state))

  bench('TanStack', () => {
    tanstack_a.setState(() => Math.random())
  })

  // Vue - create graph ONCE
  const vue_a = shallowRef(1)
  const vue_b = vueComputed(() => vue_a.value)
  const vue_c = vueComputed(() => vue_a.value)
  const vue_d = vueComputed(() => vue_b.value)
  const vue_e = vueComputed(() => vue_b.value)
  const vue_f = vueComputed(() => vue_c.value)
  const vue_g = vueComputed(() => vue_d.value + vue_e.value + vue_f.value)
  watchEffect(() => {
    noop(vue_g.value)
  })

  bench('Vue', () => {
    vue_a.value = Math.random()
  })

  // Solid - create graph ONCE
  let solid_setA: any
  createRoot(() => {
    const [a, setA] = createSignal(1)
    solid_setA = setA
    const b = createMemo(() => a())
    const c = createMemo(() => a())
    const d = createMemo(() => b())
    const e = createMemo(() => b())
    const f = createMemo(() => c())
    const g = createMemo(() => d() + e() + f())
    createEffect(() => {
      noop(g())
    })
  })

  bench('Solid', () => {
    solid_setA(Math.random())
  })

  // Preact - create graph ONCE
  const preact_a = preactSignal(1)
  const preact_b = preactComputed(() => preact_a.value)
  const preact_c = preactComputed(() => preact_a.value)
  const preact_d = preactComputed(() => preact_b.value)
  const preact_e = preactComputed(() => preact_b.value)
  const preact_f = preactComputed(() => preact_c.value)
  const preact_g = preactComputed(() => preact_d.value + preact_e.value + preact_f.value)
  preactEffect(() => {
    noop(preact_g.value)
  })

  bench('Preact', () => {
    preact_a.value = Math.random()
  })

  // Angular - create graph ONCE
  const angular_a = angularSignal(1)
  const angular_b = angularComputed(() => angular_a())
  const angular_c = angularComputed(() => angular_a())
  const angular_d = angularComputed(() => angular_b())
  const angular_e = angularComputed(() => angular_b())
  const angular_f = angularComputed(() => angular_c())
  const angular_g = angularComputed(() => angular_d() + angular_e() + angular_f())
  createWatch(
    () => {
      noop(angular_g())
    },
    () => {},
    false,
  )

  bench('Angular', () => {
    angular_a.set(Math.random())
  })
})
