<script setup lang="ts">
import type { RulerTick } from '~/logic/ruler'
import { buildRulerTicks } from '~/logic/ruler'

const props = withDefaults(defineProps<{
  orientation: 'horizontal' | 'vertical'
  /** 尺子长度，屏幕像素 = 画布宽（或高）× scale */
  length: number
  /** 设计像素 → 屏幕像素 */
  scale: number
  /** 尺子厚度，默认 24 */
  thickness?: number
}>(), { thickness: 24 })

const ticks = computed(() => buildRulerTicks(props.length, props.scale))

/** 只有主刻度画数字 */
const labelTicks = computed(() => ticks.value.filter(tick => tick.major))

const rootStyle = computed(() => props.orientation === 'horizontal'
  ? { width: `${props.length}px`, height: `${props.thickness}px` }
  : { width: `${props.thickness}px`, height: `${props.length}px` })

/** 刻度线：横向贴底边、纵向贴右边；颜色吃 currentColor，靠 opacity 区分主次 */
function tickStyle(tick: RulerTick) {
  const size = tick.major ? '9px' : '4px'
  const opacity = tick.major ? 0.55 : 0.3
  if (props.orientation === 'horizontal') {
    return {
      left: `${tick.screen}px`,
      bottom: '0px',
      width: '1px',
      height: size,
      background: 'currentColor',
      opacity,
    }
  }
  return {
    top: `${tick.screen}px`,
    right: '0px',
    height: '1px',
    width: size,
    background: 'currentColor',
    opacity,
  }
}

/** 数字：只画主刻度。纵向尺子的数字保持水平文本，不旋转 */
function labelStyle(tick: RulerTick) {
  const typography = {
    fontSize: '9px',
    lineHeight: '1',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    opacity: 0.5,
  } as const
  if (props.orientation === 'horizontal') {
    // 画布尺寸恰好是刻度整数倍时，最后一个数字会越过尺子右边界被裁掉，改成右对齐贴边
    const labelWidth = formatLabel(tick.design).length * 5.4
    if (tick.screen + 3 + labelWidth > props.length) {
      return {
        ...typography,
        left: `${tick.screen - 3}px`,
        top: '1px',
        transform: 'translateX(-100%)',
      }
    }
    return { ...typography, left: `${tick.screen + 3}px`, top: '1px' }
  }
  // 纵向同理：末尾数字改为向上对齐，避免被尺子下边界裁掉
  if (tick.screen + 11 > props.length) {
    return {
      ...typography,
      top: `${tick.screen - 2}px`,
      left: '1px',
      transform: 'translateY(-100%)',
    }
  }
  return { ...typography, top: `${tick.screen + 1}px`, left: '1px' }
}

/** 10000 以上收成 10k / 12.5k 这种短写法，避免数字在尺子上过宽 */
function formatLabel(value: number) {
  const v = Math.round(value)
  if (v >= 10000)
    return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${v}`
}
</script>

<template>
  <div
    pointer-events-none relative select-none overflow-hidden bg-secondary
    :class="orientation === 'horizontal' ? 'border-b border-base' : 'border-r border-base'"
    :style="rootStyle"
  >
    <div
      v-for="tick, index of ticks" :key="`tick-${index}`"
      absolute
      :style="tickStyle(tick)"
    />
    <div
      v-for="tick, index of labelTicks" :key="`label-${index}`"
      absolute
      :style="labelStyle(tick)"
    >
      {{ formatLabel(tick.design) }}
    </div>
  </div>
</template>
