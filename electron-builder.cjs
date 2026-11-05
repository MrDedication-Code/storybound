const RUNTIME = 'node_modules/onnxruntime-node/bin/napi-v6'

const files = [
  '!apps/**',
  '!packages/**',
  '!scripts/**',
  '!patches/**',
  '!supabase/**',
  '!tests/**',
  '!node_modules/@storybound/**',
  '!**/.vscode/*',
  '!src/*',
  '!electron.vite.config.{js,ts,mjs,cjs}',
  '!electron-builder.cjs',
  '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
  '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
  '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json,*.tsbuildinfo}',
  // Build and test output must never ride along: electron-builder only skips its *current*
  // output folder, so earlier builds under dist/ and Playwright's throwaway profiles in
  // test-results/ were otherwise packed into app.asar.
  '!{dist,dist-*,test-results,playwright-report,coverage,build}/**',
  '!*.md',
  '!{vitest.config.ts,playwright.config.ts}'
]

/**
 * The free voice's runtime ships binaries for every system; each build keeps only its target's.
 * This has to be set per target: `${platform}` in a files rule means the computer doing the build,
 * so a Windows build made on a Mac would keep the Mac binaries. A target's `files` replaces the
 * shared list rather than adding to it, hence the spread.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JavaScript
const filesWithout = (...folders) => [
  ...files,
  ...folders.map((folder) => `!${RUNTIME}/${folder}/**`)
]

module.exports = {
  appId: 'com.storybound.library',
  productName: 'Storybound',
  directories: { buildResources: 'build' },
  files,
  asarUnpack: [
    'resources/**',
    'node_modules/better-sqlite3/**',
    'node_modules/onnxruntime-node/**'
  ],
  win: {
    executableName: 'Storybound',
    files: filesWithout('darwin', 'linux', 'win32/arm64')
  },
  nsis: {
    artifactName: '${name}-${version}-setup.${ext}',
    shortcutName: '${productName}',
    uninstallDisplayName: '${productName}',
    createDesktopShortcut: 'always'
  },
  mac: {
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: false,
    files: filesWithout('win32', 'linux')
  },
  dmg: { artifactName: '${name}-${version}.${ext}' },
  linux: {
    target: ['AppImage', 'deb'],
    maintainer: 'Storybound',
    category: 'Office',
    files: filesWithout('darwin', 'win32')
  },
  appImage: { artifactName: '${name}-${version}.${ext}' },
  npmRebuild: false
}
