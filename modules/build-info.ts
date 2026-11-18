import process from 'node:process'
import { defineNuxtModule } from '@nuxt/kit'
import { simpleGit } from 'simple-git'
import { version } from '../package.json'

async function resolveGitInfo() {
  // CI providers hand the metadata over through env vars; use it when present
  // so builds without a .git directory (tarball, Cloudflare Pages, ...) keep working.
  const envBranch = process.env.CF_PAGES_BRANCH || process.env.GITHUB_REF_NAME || process.env.BRANCH || ''
  const envSha = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || process.env.COMMIT_REF || ''

  try {
    const git = simpleGit()
    return {
      branch: envBranch || (await git.branch()).current,
      sha: envSha || (await git.revparse(['HEAD'])).trim(),
    }
  }
  catch {
    return {
      branch: envBranch || 'unknown',
      sha: envSha || 'unknown',
    }
  }
}

export default defineNuxtModule({
  async setup(_, nuxt) {
    nuxt.options.runtimeConfig.public.version = version
    nuxt.options.runtimeConfig.public.buildTime = Date.now()
    nuxt.options.runtimeConfig.public.git = await resolveGitInfo()
  },
})
