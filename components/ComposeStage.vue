<script setup lang="ts">
import type { ComposeStamp, ComposeState } from '~/logic/types'
import { addStampFromSource, backgroundSizeCss, clamp, clampStamp, composeBackground, getStampSource, isPlateActive, readFileAsDataUrl, stampHeight, syncSourceAlpha } from '~/logic/compose'

const props = defineProps<{
  state: ComposeState
}>()

const wrapEl = ref<HTMLElement>()
const stageEl = ref<HTMLElement>()
const { width: wrapWidth } = useElementSize(wrapEl)
const { height: windowHeight } = useWindowSize()

const SNAP_DISTANCE = 10

/** 尺子厚度：横尺 / 纵尺 / 左上角块共用，可用空间也要扣掉 */
const RULER_SIZE = 24

/** 预览缩放：设计像素 → 屏幕像素（可用宽高已扣除尺子占用） */
const scale = computed(() => {
  const availableHeight = Math.max(360, windowHeight.value - 260) - RULER_SIZE
  const availableWidth = Math.max(120, (wrapWidth.value || 640) - RULER_SIZE)
  return Math.max(Math.min(availableWidth / props.state.width, availableHeight / props.state.height), 0.005)
})

/** 画布在屏幕上的宽高（尺子长度直接复用它，保证与画布边缘严格对齐） */
const stageW = computed(() => props.state.width * scale.value)
const stageH = computed(() => props.state.height * scale.value)

const stageStyle = computed(() => ({
  width: `${stageW.value}px`,
  height: `${stageH.value}px`,
}))

/** 两行两列网格：角块 / 横尺 / 纵尺 / 画布 */
const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `${RULER_SIZE}px ${stageW.value}px`,
  gridTemplateRows: `${RULER_SIZE}px ${stageH.value}px`,
}))

const backgroundStyle = computed(() => {
  if (props.state.backgroundKind === 'image' && composeBackground.value) {
    return {
      backgroundImage: `url(${composeBackground.value})`,
      backgroundSize: backgroundSizeCss(props.state.backgroundFit),
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    }
  }
  return { background: props.state.backgroundColor }
})

const guides = reactive({
  x: 0,
  y: 0,
  showX: false,
  showY: false,
})

/** 几何真源是"图片内容 + 可选白底板"：left 要减掉 padding，预览才和导出对齐 */
function stampStyle(stamp: ComposeStamp, index: number) {
  const k = scale.value
  const src = getStampSource(stamp)
  if (src)
    syncSourceAlpha(src).catch(() => {})
  const plate = isPlateActive(stamp)
  const pad = plate ? stamp.padding : 0
  return {
    left: `${(stamp.x - pad) * k}px`,
    top: `${(stamp.y - pad) * k}px`,
    width: `${stamp.w * k}px`,
    height: `${stampHeight(stamp) * k}px`,
    padding: `${pad * k}px`,
    boxSizing: 'content-box' as const,
    borderRadius: `${stamp.radius * k}px`,
    backgroundColor: pad > 0
      ? '#ffffff'
      : 'transparent',
    opacity: stamp.opacity,
    transform: `rotate(${stamp.rotation}deg)`,
    zIndex: index + 1,
  }
}

function imageStyle(stamp: ComposeStamp) {
  const k = scale.value
  const brightness = stamp.brightness ?? 1
  const plate = isPlateActive(stamp)
  return {
    // QR 用最近邻保持像素锐利，照片类走平滑缩放
    imageRendering: (stamp.kind === 'qr'
      ? 'pixelated'
      : 'auto') as 'pixelated' | 'auto',
    borderRadius: plate
      ? '0px'
      : `${stamp.radius * k}px`,
    filter: Math.abs(brightness - 1) < 0.005
      ? 'none'
      : `brightness(${brightness})`,
  }
}

function select(id?: string) {
  props.state.selectedId = id
}

/** 正在拖动的图层 id：拖动时在框上方显示实时尺寸，松手就收起 */
const activeDragId = ref<string>()

/** 选中框：白线 + 深色描边，任何底色上都看得见；只是提示，不参与导出 */
const frameStyle = {
  boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.95), 0 0 0 2.5px rgba(0, 0, 0, 0.5)',
}

const cornerStyle = {
  width: '6px',
  height: '6px',
  background: '#ffffff',
  boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.55)',
}

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const

function cornerOffset(corner: typeof CORNERS[number]) {
  const x = corner.endsWith('l')
    ? 'left'
    : 'right'
  const y = corner.startsWith('t')
    ? 'top'
    : 'bottom'
  return {
    [x]: '-3px',
    [y]: '-3px',
  }
}

function applySnap(stamp: ComposeStamp) {
  const { width, height } = props.state
  const centerX = stamp.x + stamp.w / 2
  const centerY = stamp.y + stampHeight(stamp) / 2
  const candidatesX = [width / 2, width / 3, width * 2 / 3]
  const candidatesY = [height / 2, height / 3, height * 2 / 3]

  for (const target of candidatesX) {
    if (Math.abs(centerX - target) < SNAP_DISTANCE) {
      stamp.x = target - stamp.w / 2
      guides.x = target
      guides.showX = true
      break
    }
  }
  for (const target of candidatesY) {
    if (Math.abs(centerY - target) < SNAP_DISTANCE) {
      stamp.y = target - stampHeight(stamp) / 2
      guides.y = target
      guides.showY = true
      break
    }
  }
}

function clearGuides() {
  guides.showX = false
  guides.showY = false
}

function startDrag(event: PointerEvent, stamp: ComposeStamp, mode: 'move' | 'resize') {
  if (event.button !== 0)
    return
  event.preventDefault()
  event.stopPropagation()
  stageEl.value?.focus()
  select(stamp.id)
  activeDragId.value = stamp.id

  const k = scale.value
  const startX = event.clientX
  const startY = event.clientY
  const originX = stamp.x
  const originY = stamp.y
  const originWidth = stamp.w

  function onMove(moveEvent: PointerEvent) {
    const target = props.state.stamps.find(item => item.id === stamp.id)
    if (!target)
      return
    const dx = (moveEvent.clientX - startX) / k
    const dy = (moveEvent.clientY - startY) / k

    clearGuides()
    if (mode === 'move') {
      target.x = originX + dx
      target.y = originY + dy
      clampStamp(target, props.state.width, props.state.height)
      if (props.state.snap) {
        applySnap(target)
        clampStamp(target, props.state.width, props.state.height)
      }
    }
    else {
      const ratio = target.naturalH / Math.max(1, target.naturalW)
      const maxWidth = Math.min(
        props.state.width - target.padding * 2,
        (props.state.height - target.padding * 2) / Math.max(0.001, ratio),
      )
      target.w = clamp(originWidth + dx, 40, Math.max(40, maxWidth))
      clampStamp(target, props.state.width, props.state.height)
    }
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    activeDragId.value = undefined
    clearGuides()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

const dragging = ref(false)

/** 直接把图片拖到画布上：以指针位置为中心落图，多文件依次错开 */
async function onDrop(event: DragEvent) {
  dragging.value = false
  const files = Array.from(event.dataTransfer?.files ?? []).filter(file => file.type.startsWith('image/'))
  if (!files.length)
    return
  const rect = stageEl.value?.getBoundingClientRect()
  const centerX = rect
    ? (event.clientX - rect.left) / scale.value
    : props.state.width / 2
  const centerY = rect
    ? (event.clientY - rect.top) / scale.value
    : props.state.height / 2
  for (const [index, file] of files.entries()) {
    const src = await readFileAsDataUrl(file)
    const fallback = `Image ${props.state.stamps.length + 1}`
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || fallback
    const stamp = await addStampFromSource(props.state, src, name, 'image')
    stamp.x = Math.round(centerX - stamp.w / 2 + index * 24)
    stamp.y = Math.round(centerY - stampHeight(stamp) / 2 + index * 24)
    clampStamp(stamp, props.state.width, props.state.height)
  }
}

function nudge(event: KeyboardEvent) {
  const stamp = props.state.stamps.find(item => item.id === props.state.selectedId)
  if (!stamp)
    return
  const step = event.shiftKey ? 10 : 1
  const deltas: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  const delta = deltas[event.key]
  if (!delta)
    return
  event.preventDefault()
  stamp.x += delta[0]
  stamp.y += delta[1]
  clampStamp(stamp, props.state.width, props.state.height)
}
</script>

<template>
  <div ref="wrapEl" w-full>
    <div class="mx-auto w-max" :style="gridStyle">
      <!-- 角块：与两条尺子的分隔线相接，形成连续的内侧边框 -->
      <div class="border-b border-r border-base bg-secondary" />
      <ComposeRuler orientation="horizontal" :length="stageW" :scale="scale" :thickness="RULER_SIZE" />
      <ComposeRuler orientation="vertical" :length="stageH" :scale="scale" :thickness="RULER_SIZE" />
      <div
        ref="stageEl"
        class="relative select-none of-hidden border-box outline-none"
        :style="[{ ...stageStyle, ...backgroundStyle, touchAction: 'none' }]"
        tabindex="0"
        @pointerdown.self="select(undefined)"
        @keydown="nudge"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <div
          v-if="dragging"
          pointer-events-none absolute inset-0 z-200 flex items-center justify-center
          border="~ dashed 2 primary rounded" bg-active text-sm
        >
          Drop image to add a layer
        </div>
        <div
          v-if="state.dim > 0"
          pointer-events-none absolute inset-0 z-0
          :style="{ background: `rgba(0, 0, 0, ${state.dim})` }"
        />
        <div
          v-for="stamp, index of state.stamps" :key="stamp.id"
          absolute cursor-move
          :style="stampStyle(stamp, index)"
          @pointerdown="startDrag($event, stamp, 'move')"
        >
          <img
            v-if="getStampSource(stamp)"
            :src="getStampSource(stamp)"
            class="pointer-events-none h-full w-full"
            :style="imageStyle(stamp)"
            alt=""
            draggable="false"
          >
          <template v-if="stamp.id === state.selectedId">
            <div class="pointer-events-none absolute inset-0 z-9" :style="frameStyle" />
            <div
              v-for="corner in CORNERS" :key="corner"
              class="pointer-events-none absolute z-10 rounded-[1px]"
              :style="[{ ...cornerStyle }, cornerOffset(corner)]"
            />
            <div
              v-if="activeDragId === stamp.id"
              class="pointer-events-none absolute bottom-full left-0 z-10 mb-1 whitespace-nowrap rounded bg-black/80 px-1 py-0.5 text-[10px] text-white leading-[1.2]"
            >
              {{ Math.round(stamp.w) }} × {{ Math.round(stampHeight(stamp)) }}
            </div>
            <div
              class="absolute z-10 h-4 w-4 cursor-nwse-resize border border-box border-base rounded-full bg-base shadow -bottom-3 -right-3"
              @pointerdown="startDrag($event, stamp, 'resize')"
            />
          </template>
        </div>

        <div
          v-if="guides.showX" pointer-events-none absolute bottom-0 top-0 z-100 w-px
          :style="{ left: `${guides.x * scale}px`, background: 'var(--c-red-5, #f43f5e)' }"
        />
        <div
          v-if="guides.showY" pointer-events-none absolute left-0 right-0 z-100 h-px
          :style="{ top: `${guides.y * scale}px`, background: 'var(--c-red-5, #f43f5e)' }"
        />
      </div>
    </div>
    <div mt-2 text-center text-xs op40>
      {{ state.width }} × {{ state.height }} · 拖动移动，右下角缩放，方向键微调（Shift 加速）· 可直接拖入图片 · Rulers show design pixels
    </div>
  </div>
</template>
