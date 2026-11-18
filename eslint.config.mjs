import antfu from '@antfu/eslint-config'
import unocss from '@unocss/eslint-config/flat'

export default antfu({
  vue: true,
  typescript: true,
  rules: {
    'vue/no-mutating-props': 'off',
  },
  ignores: [
    'vendor/**',
    // 文档不参与 lint：eslint 10 的 markdown 处理器会把 ```vue 代码块当 JS 解析，
    // 直接抛 TypeError ERR_UNKNOWN_FILE_EXTENSION（docs/plan 里的规格文档必然触发）
    '**/*.md',
  ],
}, unocss)
