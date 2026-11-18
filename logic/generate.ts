import type { QRCodeGeneratorState } from './types'
import Perspective from '../vendor/perspective'
import { createQrLayout, getBackgroundColor, getInkColor, paintQr } from './draw'
import { effects } from './effects'
import { drawCenterIcon } from './icon'
import { alphaKeyBackground, CanvasPainter } from './painter'

export interface GenerateQRCodeOptions {
  /**
   * Render on a transparent surface: the background color is erased instead of
   * painted, and the background image is ignored. The result is a PNG with a
   * proper alpha channel.
   */
  transparent?: boolean
}

export async function generateQRCode(
  outCanvas: HTMLCanvasElement,
  state: QRCodeGeneratorState,
  options: GenerateQRCodeOptions = {},
) {
  if (!outCanvas)
    return

  const { transparent = false } = options

  const layout = createQrLayout(state)
  const { width, height } = layout
  const backgroundColor = getBackgroundColor(state)
  const inkColor = getInkColor(state)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.style.imageRendering = 'pixelated'
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = false

  const painter = new CanvasPainter(ctx, {
    transparent,
    backgroundColor,
    cell: layout.cell,
  })
  paintQr(painter, layout, state)
  ctx.globalCompositeOperation = 'source-over'

  await applyPerspective()

  if (state.effectTiming === 'after')
    await applyBackground()

  if (state.effect !== 'none')
    applyEffect()

  if (state.effectTiming === 'before')
    await applyBackground()

  // final, copy offscreen canvas to the real one
  outCanvas.width = width
  outCanvas.height = height
  const realCtx = outCanvas.getContext('2d')!
  realCtx.save()
  if (!transparent) {
    realCtx.fillStyle = backgroundColor
    realCtx.fillRect(0, 0, width, height)
  }
  realCtx.setTransform(
    state.transformScale,
    0,
    0,
    state.transformScale,
    -(state.transformScale - 1) * width / 2,
    -(state.transformScale - 1) * height / 2,
  )
  realCtx.drawImage(canvas, 0, 0, width, height)
  // 中心图画在效果与背景之后，且在 transformScale 变换区间内 → 清晰、随内容同步缩放
  if (layout.icon)
    await drawCenterIcon(realCtx, layout.icon, { transparent, backgroundColor })
  realCtx.restore()

  async function applyPerspective() {
    if (state.transformPerspectiveX === 0 && state.transformPerspectiveY === 0)
      return

    const data = ctx.getImageData(0, 0, width, height)
    ctx.clearRect(0, 0, width, height)
    const perspective = new Perspective(ctx as any, data)

    const perspectiveX = state.transformPerspectiveX
    const perspectiveY = state.transformPerspectiveY

    const pos = {
      topLeftX: 0,
      topLeftY: 0,
      bottomLeftX: 0,
      bottomLeftY: height,
      topRightX: width,
      topRightY: 0,
      bottomRightX: width,
      bottomRightY: height,
    }

    if (perspectiveX !== 0) {
      const offsetX = Math.abs(width * perspectiveX / 2)
      const offsetY = Math.abs(height * perspectiveX / 3)

      // perspectiveX
      pos.topLeftX += offsetX
      pos.topRightX -= offsetX
      pos.bottomLeftX += offsetX
      pos.bottomRightX -= offsetX
      if (perspectiveX > 0) {
        pos.topRightY += offsetY
        pos.bottomRightY -= offsetY
      }
      else {
        pos.topLeftY += offsetY
        pos.bottomLeftY -= offsetY
      }
    }

    // perspectiveY
    if (perspectiveY !== 0) {
      const offsetX = Math.abs(width * perspectiveY / 3)
      const offsetY = Math.abs(height * perspectiveY / 2)

      pos.topLeftY += offsetY
      pos.topRightY += offsetY
      pos.bottomLeftY -= offsetY
      pos.bottomRightY -= offsetY
      if (perspectiveY > 0) {
        pos.bottomLeftX += offsetX
        pos.bottomRightX -= offsetX
      }
      else {
        pos.topLeftX += offsetX
        pos.topRightX -= offsetX
      }
    }

    perspective.draw(pos)
  }

  /** Apply the configured effect. Rendered in place, on an opaque surface. */
  function applyEffect() {
    if (transparent) {
      applyEffectWithTransparency()
      return
    }

    if (state.effect === 'crystalize') {
      const data = ctx.getImageData(0, 0, width, height)
      const newData = effects.crystalize(data, state.effectCrystalizeRadius, state.seed)
      ctx.putImageData(newData, 0, 0)
    }
    else if (state.effect === 'liquidify') {
      const data = ctx.getImageData(0, 0, width, height)
      const newData1 = state.effectLiquidifyDistortRadius
        ? effects.crystalize(data, state.effectLiquidifyDistortRadius, state.seed)
        : data
      const newData2 = effects.liquidify(
        newData1,
        state.effectLiquidifyRadius,
        state.effectLiquidifyThreshold,
        state.lightColor,
        state.darkColor,
      )
      ctx.putImageData(newData2, 0, 0)
    }
  }

  /**
   * Effects blend pixels with their neighbors, which needs an opaque surface to
   * sample from. So flatten the transparent layer onto the background color,
   * apply the effect, then key that color back out into the alpha channel.
   */
  function applyEffectWithTransparency() {
    const flat = document.createElement('canvas')
    flat.width = width
    flat.height = height
    const flatCtx = flat.getContext('2d', { willReadFrequently: true })!
    flatCtx.fillStyle = backgroundColor
    flatCtx.fillRect(0, 0, width, height)
    flatCtx.drawImage(canvas, 0, 0)

    if (state.effect === 'crystalize') {
      const data = flatCtx.getImageData(0, 0, width, height)
      const newData = effects.crystalize(data, state.effectCrystalizeRadius, state.seed)
      flatCtx.putImageData(newData, 0, 0)
    }
    else if (state.effect === 'liquidify') {
      const data = flatCtx.getImageData(0, 0, width, height)
      const newData1 = state.effectLiquidifyDistortRadius
        ? effects.crystalize(data, state.effectLiquidifyDistortRadius, state.seed)
        : data
      const newData2 = effects.liquidify(
        newData1,
        state.effectLiquidifyRadius,
        state.effectLiquidifyThreshold,
        state.lightColor,
        state.darkColor,
      )
      flatCtx.putImageData(newData2, 0, 0)
    }

    const result = flatCtx.getImageData(0, 0, width, height)
    alphaKeyBackground(result, backgroundColor, inkColor)
    ctx.putImageData(result, 0, 0)
  }

  async function applyBackground() {
    if (transparent)
      return

    ctx.restore()
    const clone = document.createElement('canvas')
    clone.width = width
    clone.height = height
    clone.getContext('2d')!.putImageData(ctx.getImageData(0, 0, width, height), 0, 0)

    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, width, height)
    if (state.backgroundImage) {
      if (state.backgroundImage.startsWith('#')) {
        ctx.fillStyle = state.backgroundImage
        ctx.fillRect(0, 0, width, height)
      }
      else {
        const img = new Image()
        img.src = state.backgroundImage
        await new Promise(resolve => img.onload = resolve).then()
        // draw the image full cover the canvas with aspect ratio
        const imgRatio = img.width / img.height
        const canvasRatio = width / height
        if (imgRatio < canvasRatio)
          ctx.drawImage(img, 0, (height - width / imgRatio) / 2, width, width / imgRatio)
        else
          ctx.drawImage(img, (width - height * imgRatio) / 2, 0, height * imgRatio, height)
      }
    }

    ctx.drawImage(clone, 0, 0)
  }
}
