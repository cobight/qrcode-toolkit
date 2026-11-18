export default defineNuxtConfig({
  // Keep the Nuxt 3-style root layout (app.vue, pages/, components/ at root) instead of src/app/
  srcDir: '.',

  modules: [
    '@vueuse/nuxt',
    '@unocss/nuxt',
    '@nuxtjs/color-mode',
    'floating-vue/nuxt',
  ],

  ssr: false,

  experimental: {
    payloadExtraction: false,
    renderJsonPayloads: true,
  },

  nitro: {
    routeRules: {
      '/*': {
        cors: true,
      },
    },
  },

  spaLoadingTemplate: false,

  vite: {
    server: {
      cors: true,
    },
  },

  imports: {
    dirs: [],
  },

  css: [
    '@unocss/reset/tailwind.css',
  ],

  typescript: {
    tsConfig: {
      compilerOptions: {
        // Nuxt 4 turns this on by default; the codebase was written under Nuxt 3 rules.
        noUncheckedIndexedAccess: false,
      },
    },
  },

  devtools: {
    enabled: true,
  },
})
