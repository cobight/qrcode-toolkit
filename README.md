# Anthony's QR Toolkit

A toolkit mainly for AI-Generated QR Codes, with the ability to generate base QR codes, and compare with the output to find misaligned pixels.

👋 Walkthrough Guide - [Refining AI Generated QR Code](https://antfu.me/posts/ai-qrcode-refine)

📸 Go to the App - [qrcode.antfu.me](https://qrcode.antfu.me)

<img alt="Screenshot" src="https://antfu.me/images/ai-qrcode-refine-compare-2.png">

## Stable Diffusion Web UI Extension

This app also provides [Stable Diffusion Web UI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) integration. Please go to [antfu/sd-webui-qrcode-toolkit](https://github.com/antfu/sd-webui-qrcode-toolkit) for more details.

## Deploy

This is a client-only Nuxt app (`ssr: false`): `pnpm run generate` emits plain static files to `.output/public`.

📘 **Cloudflare Pages 部署手册：[docs/CLOUDFLARE-PAGES.md](docs/CLOUDFLARE-PAGES.md)**（构建参数、环境变量、wrangler 直传、故障排查、验收清单）

TL;DR for Cloudflare Pages:

| Setting | Value |
| --- | --- |
| Build command | `pnpm run generate` |
| Build output directory | `.output/public` |
| Node.js | 24.x (from `.nvmrc`) |
| pnpm | 10.x (from `packageManager`) |

## Stack

| Piece | Version | Notes |
| --- | --- | --- |
| Nuxt | 4.x | `srcDir: '.'` keeps the root-level layout |
| Vite | 8.x (Rolldown) | bundled with Nuxt |
| UnoCSS | 66.x | `presetWind3` |
| ESLint | 10.x | flat config in `eslint.config.mjs` |
| Node.js | 24.x | `.nvmrc` |
| pnpm | 10.x | `packageManager` |

## License

MIT
