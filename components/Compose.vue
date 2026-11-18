<script setup lang="ts">
import type { ComposePresetId, ComposeStamp, State } from '~/logic/types'
import {
  addStampFromSource,
  applyPreset,
  COMPOSE_PRESETS,
  composeBackground,
  createStamp,
  exportComposeImage,
  getStampSource,
  isPlateActive,
  loadImage,
  normalizeComposeState,
  readFileAsDataUrl,
  registerStampSource,
  replaceStampSource,
  setCanvasSize,
  stampHeight,
  stampSourceLabel,
} from '~/logic/compose'
import { dataUrlGeneratedQRCode, dataUrlGeneratedQRCodeForCompose } from '~/logic/state'
import { view } from '~/logic/view'

const props = defineProps<{
  state: State
}>()

const compose = computed(() => props.state.compose)
const selected = computed(() => compose.value.stamps.find(stamp => stamp.id === compose.value.selectedId))
const reversedStamps = computed(() => [...compose.value.stamps].reverse())
const presetOptions = COMPOSE_PRESETS.map(preset => preset.id)
const exporting = ref(false)
const imageInput = ref<HTMLInputElement>()

const plateOptions = ['Auto', 'On', 'Off']
const plateMode = computed(() => {
  const stamp = selected.value
  if (!stamp)
    return 'Auto'
  if (stamp.plateAuto)
    return 'Auto'
  return stamp.plate
    ? 'On'
    : 'Off'
})
/** Auto 时白底板跟着图片来源走：图片本来透明就不垫白底 */
const plateDescription = computed(() => plateMode.value === 'Auto'
  ? 'Auto: a white plate only appears when the image itself is opaque'
  : 'A white plate is painted behind this layer and covers whatever is underneath')

function applyPlateMode(value?: string | number) {
  const mode = String(value ?? 'Auto')
  const stamp = selected.value
  if (!stamp)
    return
  if (mode === 'Auto') {
    stamp.plateAuto = true
    stamp.plate = true
    return
  }
  stamp.plateAuto = false
  stamp.plate = mode === 'On'
}

const checkerboardStyle = {
  backgroundImage: 'linear-gradient(45deg, rgba(127, 127, 127, 0.25) 25%, transparent 25%, transparent 75%, rgba(127, 127, 127, 0.25) 75%), linear-gradient(45deg, rgba(127, 127, 127, 0.25) 25%, transparent 25%, transparent 75%, rgba(127, 127, 127, 0.25) 75%)',
  backgroundPosition: '0 0, 4px 4px',
  backgroundSize: '8px 8px',
}

onMounted(() => normalizeComposeState(compose.value))

const backgroundSrc = computed<string>({
  get: () => composeBackground.value ?? '',
  set: (value) => {
    composeBackground.value = value || undefined
    if (value)
      compose.value.backgroundKind = 'image'
    else if (compose.value.backgroundKind === 'image')
      compose.value.backgroundKind = 'color'
  },
})

const mayNotScannable = computed(() => {
  const stamp = selected.value
  if (!stamp || stamp.kind !== 'qr')
    return false
  return stamp.w < compose.value.width * 0.12
})

// range 输入在 0.05 步长下会浮点抖动，落库前收敛到两位小数
watch(() => selected.value?.brightness, (value) => {
  const stamp = selected.value
  if (!stamp || value == null)
    return
  const rounded = Math.round(value * 100) / 100
  if (rounded !== value)
    stamp.brightness = rounded
})

function nextName(prefix: string) {
  return `${prefix} ${compose.value.stamps.length + 1}`
}

/** 取 Generator "创建时那张图"，透明背景保留 */
async function addCurrentQR() {
  const src = dataUrlGeneratedQRCodeForCompose.value ?? dataUrlGeneratedQRCode.value
  if (!src)
    return
  await addStampFromSource(compose.value, src, nextName('QR'), 'qr')
}

async function addImages(files: FileList | File[] | null | undefined) {
  const list = Array.from(files ?? []).filter(file => file.type.startsWith('image/'))
  for (const file of list) {
    const src = await readFileAsDataUrl(file)
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || nextName('Image')
    await addStampFromSource(compose.value, src, name, 'image')
  }
}

function pickImages() {
  imageInput.value?.click()
}

async function onPickImages(event: Event) {
  const input = event.target as HTMLInputElement
  await addImages(input.files)
  input.value = ''
}

async function replaceLayer(stamp: ComposeStamp, dataUrl: string) {
  await replaceStampSource(compose.value, stamp, dataUrl, 'image')
}

async function duplicateStamp(stamp: ComposeStamp) {
  const src = getStampSource(stamp)
  if (!src)
    return
  const copy = createStamp(`${stamp.name} copy`, stamp.naturalW, stamp.naturalH, compose.value, stamp.kind)
  registerStampSource(copy.id, src)
  Object.assign(copy, {
    w: stamp.w,
    plateAuto: stamp.plateAuto,
    plate: stamp.plate,
    padding: stamp.padding,
    radius: stamp.radius,
    opacity: stamp.opacity,
    brightness: stamp.brightness,
    rotation: stamp.rotation,
    x: stamp.x + 24,
    y: stamp.y + 24,
  })
  compose.value.stamps.push(copy)
  compose.value.selectedId = copy.id
}

function removeStamp(id: string) {
  compose.value.stamps = compose.value.stamps.filter(stamp => stamp.id !== id)
  if (compose.value.selectedId === id)
    compose.value.selectedId = compose.value.stamps.at(-1)?.id
}

function moveLayer(id: string, offset: number) {
  const list = compose.value.stamps
  const index = list.findIndex(stamp => stamp.id === id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= list.length)
    return
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
}

function changePreset(value?: string | number) {
  if (value == null)
    return
  applyPreset(compose.value, value as ComposePresetId)
}

async function useBackgroundSize() {
  if (!composeBackground.value)
    return
  const image = await loadImage(composeBackground.value)
  setCanvasSize(compose.value, image.naturalWidth, image.naturalHeight)
}

async function download() {
  if (!compose.value.stamps.length || exporting.value)
    return
  exporting.value = true
  try {
    await exportComposeImage(compose.value, props.state.qrcode.text)
  }
  finally {
    exporting.value = false
  }
}

watch(
  () => dataUrlGeneratedQRCode.value,
  (src) => {
    if (src && !compose.value.stamps.length)
      addCurrentQR()
  },
  { immediate: true },
)
</script>

<template>
  <div grid="~ cols-[1fr_24rem] gap-3" lt-lg="flex flex-col-reverse">
    <div flex="~ col gap-3">
      <ComposeStage :state="compose" />
      <div v-if="!compose.stamps.length" border="~ base rounded" flex="~ col gap-3 items-center" p8 text-center>
        <div i-ri-image-edit-line text-3xl op30 />
        <div text-sm op60>
          Nothing on the canvas yet. Place the current Generator output, import images, or drop files onto the canvas.
        </div>
        <div flex="~ gap-2 items-center" text-sm>
          <button text-button @click="addCurrentQR()">
            <div i-ri-qr-code-line />
            Place current QR code
          </button>
          <button text-button @click="pickImages()">
            <div i-ri-image-add-line />
            Import images
          </button>
        </div>
      </div>
    </div>

    <div flex="~ col gap-2">
      <div border="~ base rounded" flex="~ col gap-2" p4>
        <OptionItem title="Canvas" div>
          <OptionSelectGroup
            :model-value="compose.preset" :options="presetOptions"
            :titles="COMPOSE_PRESETS.map(preset => preset.label)"
            @update:model-value="changePreset"
          />
        </OptionItem>
        <OptionItem title="Size" div>
          <div flex="~ gap-2 items-center">
            <input
              :value="compose.width" type="number" border="~ base rounded" w-20 bg-secondary pl2 text-sm
              min="200" max="8000" step="10"
              @change="setCanvasSize(compose, Number(($event.target as HTMLInputElement).value), compose.height)"
            >
            <span text-sm op50>×</span>
            <input
              :value="compose.height" type="number" border="~ base rounded" w-20 bg-secondary pl2 text-sm
              min="200" max="8000" step="10"
              @change="setCanvasSize(compose, compose.width, Number(($event.target as HTMLInputElement).value))"
            >
          </div>
        </OptionItem>
        <OptionItem title="Background">
          <OptionColor v-model="compose.backgroundColor" />
        </OptionItem>
        <OptionItem title="Image" div>
          <div flex="~ gap-2 items-center">
            <div relative text-button text-sm>
              <div i-ri-image-add-line />
              <span>{{ backgroundSrc ? 'Replace' : 'Upload' }}</span>
              <ImageUpload v-model="backgroundSrc" />
            </div>
            <button
              v-if="backgroundSrc" text-button text-sm
              @click="backgroundSrc = ''"
            >
              <div i-ri-delete-bin-6-line />
            </button>
            <div flex-auto />
            <button
              v-if="backgroundSrc" text-button text-sm
              title="Use the background image's own pixel size as the canvas size"
              @click="useBackgroundSize()"
            >
              Image size
            </button>
          </div>
        </OptionItem>
        <OptionItem v-if="backgroundSrc" title="Fit">
          <OptionSelectGroup
            v-model="compose.backgroundFit"
            :options="['cover', 'contain', 'stretch']"
          />
        </OptionItem>
        <OptionItem v-if="backgroundSrc" title="Dim" description="Darken the background to keep the QR code readable">
          <OptionSlider v-model="compose.dim" :min="0" :max="0.9" :step="0.05" :default="0" />
        </OptionItem>
      </div>

      <div border="~ base rounded" flex="~ col gap-2" p4>
        <div flex="~ items-center justify-between gap-2">
          <div text-sm op50>
            Layers
          </div>
          <div flex="~ gap-1 items-center">
            <button text-button text-sm title="Add the current Generator output" @click="addCurrentQR()">
              <div i-ri-qr-code-line />
              QR
            </button>
            <button text-button text-sm title="Import images as layers" @click="pickImages()">
              <div i-ri-image-add-line />
              Image
            </button>
          </div>
        </div>
        <input ref="imageInput" type="file" accept="image/*" multiple hidden @change="onPickImages">
        <div v-if="!compose.stamps.length" text-sm op40>
          Nothing placed yet. Add a QR code, import images, or drop image files onto the canvas.
        </div>
        <div
          v-for="stamp, index of reversedStamps" :key="stamp.id"
          flex="~ items-center gap-2" border="~ transparent rounded"
          :class="stamp.id === compose.selectedId ? 'bg-active border-base' : 'hover:bg-secondary'"
          cursor-pointer px2 py1
          @click="compose.selectedId = stamp.id"
        >
          <div
            class="h-8 w-8 flex-none overflow-hidden border-box rounded"
            :style="checkerboardStyle"
          >
            <img
              v-if="getStampSource(stamp)" :src="getStampSource(stamp)"
              class="h-full w-full object-contain" alt="" draggable="false"
              :style="{ imageRendering: stamp.kind === 'qr' ? 'pixelated' : 'auto' }"
            >
          </div>
          <div flex="~ col" min-w-0 flex-auto>
            <input
              v-model="stamp.name"
              class="w-full border-none bg-transparent p0 text-sm outline-none"
              @click.stop
            >
            <div class="truncate text-[10px] op40">
              {{ stampSourceLabel(stamp) }} · {{ Math.round(stamp.naturalW) }}×{{ Math.round(stamp.naturalH) }}
            </div>
          </div>
          <button
            icon-button-sm
            title="Move up" :disabled="index === 0"
            :class="index === 0 ? 'op20 pointer-events-none' : ''"
            @click.stop="moveLayer(stamp.id, 1)"
          >
            <div i-ri-arrow-up-s-line />
          </button>
          <button
            icon-button-sm
            title="Move down" :disabled="index === reversedStamps.length - 1"
            :class="index === reversedStamps.length - 1 ? 'op20 pointer-events-none' : ''"
            @click.stop="moveLayer(stamp.id, -1)"
          >
            <div i-ri-arrow-down-s-line />
          </button>
          <button icon-button-sm title="Duplicate" @click.stop="duplicateStamp(stamp)">
            <div i-ri-file-copy-line />
          </button>
          <button icon-button-sm title="Remove" @click.stop="removeStamp(stamp.id)">
            <div i-ri-delete-bin-6-line />
          </button>
        </div>
      </div>

      <div v-if="selected" border="~ base rounded" flex="~ col gap-2" p4>
        <OptionItem title="Position" div>
          <div flex="~ gap-2 items-center">
            <input
              v-model.number="selected.x" type="number" border="~ base rounded" w-20 bg-secondary pl2 text-sm
              step="1"
            >
            <input
              v-model.number="selected.y" type="number" border="~ base rounded" w-20 bg-secondary pl2 text-sm
              step="1"
            >
          </div>
        </OptionItem>
        <OptionItem title="Source" div>
          <div flex="~ items-center gap-2">
            <div class="min-w-0 flex-auto truncate text-sm op60">
              {{ stampSourceLabel(selected) }}
            </div>
            <div relative text-button text-sm>
              <div i-ri-swap-box-line />
              <span>Replace</span>
              <ImageUpload @update:model-value="dataurl => selected && replaceLayer(selected, dataurl)" />
            </div>
          </div>
        </OptionItem>
        <OptionItem title="Width">
          <OptionSlider
            v-model="selected.w" :min="40" :max="Math.max(40, compose.width)"
            :step="1" unit="px"
          />
        </OptionItem>
        <OptionItem title="Brightness" description="1 is the original image; below 1 darkens, above 1 brightens">
          <OptionSlider v-model="selected.brightness" :min="0.2" :max="2" :step="0.05" :default="1" />
        </OptionItem>
        <OptionItem title="Rotation">
          <OptionSelectGroup
            v-model="selected.rotation" :options="[0, 90, 180, 270]"
            :titles="['0°', '90°', '180°', '270°']"
          />
        </OptionItem>
        <OptionItem title="Plate" :description="plateDescription">
          <OptionSelectGroup :model-value="plateMode" :options="plateOptions" @update:model-value="applyPlateMode" />
        </OptionItem>
        <OptionItem v-if="isPlateActive(selected)" title="Quiet zone" description="Extra white padding around the layer, helps scanners lock on">
          <OptionSlider v-model="selected.padding" :min="0" :max="80" :step="1" unit="px" />
        </OptionItem>
        <OptionItem title="Radius">
          <OptionSlider v-model="selected.radius" :min="0" :max="80" :step="1" unit="px" />
        </OptionItem>
        <OptionItem title="Opacity">
          <OptionSlider v-model="selected.opacity" :min="0.2" :max="1" :step="0.01" :default="1" />
        </OptionItem>
        <div text-xs op40>
          {{ Math.round(selected.w) }} × {{ Math.round(stampHeight(selected)) }} px
        </div>
      </div>

      <div border="~ base rounded" flex="~ col gap-2" p4>
        <OptionItem title="Format">
          <OptionSelectGroup v-model="compose.exportFormat" :options="['png', 'jpeg']" />
        </OptionItem>
        <OptionItem title="Scale">
          <OptionSelectGroup v-model="compose.exportScale" :options="[1, 2, 3]" :titles="['1x', '2x', '3x']" />
        </OptionItem>
        <OptionItem title="Snap">
          <OptionCheckbox v-model="compose.snap" />
        </OptionItem>
        <button
          text-button py2 text-sm
          :class="!compose.stamps.length || exporting ? 'op40 pointer-events-none' : ''"
          @click="download()"
        >
          <div i-ri-download-2-line />
          Download image
        </button>
        <div text-xs op40>
          {{ Math.round(compose.width * compose.exportScale) }} × {{ Math.round(compose.height * compose.exportScale) }} px
        </div>
      </div>

      <div v-if="mayNotScannable" border="~ amber-6/60 rounded" bg-amber-5:10 px3 py2 text-sm text-amber-6>
        This QR code is quite small relative to the canvas. Verify it scans before publishing.
      </div>

      <button text-button py2 text-sm @click="view = 'generator'">
        <div i-ri-arrow-left-line />
        Back to Generator
      </button>
    </div>
  </div>
</template>
