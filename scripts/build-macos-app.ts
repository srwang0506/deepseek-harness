/** Build the self-contained native macOS desktop distribution. */

import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertSafeOutput,
  outputArgument,
  populateCliDistribution,
  PRODUCT_NAME,
  removeAppleDouble,
  repoRoot,
  run,
  stagePackagedRuntime,
} from './distribution-runtime.ts'

interface SharpPipeline {
  resize(width: number, height: number): SharpPipeline
  png(): SharpPipeline
  toFile(path: string): Promise<unknown>
}

type SharpFactory = (input: Buffer) => SharpPipeline

const defaultOutput = resolve(repoRoot, '../../outputs')

async function iconFactory(): Promise<SharpFactory> {
  const entrypoint = join(
    repoRoot,
    'packages/attachment/attachment-local/node_modules/sharp/dist/index.mjs',
  )
  const module: unknown = await import(pathToFileURL(entrypoint).href)
  const candidate = (module as { default?: unknown }).default
  if (typeof candidate !== 'function') throw new Error('sharp did not expose its image factory')
  return candidate as SharpFactory
}

async function buildIcon(iconset: string, destination: string): Promise<void> {
  const official = await readFile(join(repoRoot, 'apps/web/public/favicon.svg'), 'utf8')
  const path = official.match(/<path id="path" d="([^"]+)"/)?.[1]
  if (path === undefined) throw new Error('official DeepSeek fish path is missing from favicon.svg')
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
      <rect width="1024" height="1024" rx="224" fill="#FFFFFF"/>
      <g transform="translate(128 128) scale(15.36)">
        <path d="${path}" fill="#111111"/>
      </g>
    </svg>
  `)
  const sharp = await iconFactory()
  const images: readonly [string, number][] = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ]
  await mkdir(iconset, { recursive: true })
  await Promise.all(images.map(async ([name, size]) => {
    await sharp(svg).resize(size, size).png().toFile(join(iconset, name))
  }))
  await run('iconutil', ['-c', 'icns', iconset, '-o', destination])
}

function infoPlist(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleDisplayName</key><string>${PRODUCT_NAME}</string>
  <key>CFBundleExecutable</key><string>deepseek-harness</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>ai.deepseek.harness.desktop</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>${PRODUCT_NAME}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
`
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('the desktop builder requires macOS')
  const outputRoot = outputArgument(process.argv.slice(2), defaultOutput)
  const appRoot = join(outputRoot, `${PRODUCT_NAME}.app`)
  const appZipPath = join(outputRoot, 'deepseek-harness-macos-arm64.zip')
  const cliRoot = join(outputRoot, `${PRODUCT_NAME} CLI`)
  const cliZipPath = join(outputRoot, 'deepseek-harness-cli-macos-arm64.zip')
  const stageRoot = join(outputRoot, '.desktop-build')
  const legacyTargets = [
    join(outputRoot, 'deepseek harness.app'),
    join(outputRoot, 'DeeepSeek Harness.app'),
    join(outputRoot, 'DeeepSeek Harness CLI'),
    join(outputRoot, 'deeepseek-harness-macos-arm64.zip'),
    join(outputRoot, 'deeepseek-harness-cli-macos-arm64.zip'),
  ]
  for (const target of [appRoot, appZipPath, cliRoot, cliZipPath, stageRoot, ...legacyTargets]) {
    assertSafeOutput(outputRoot, target)
  }
  await mkdir(outputRoot, { recursive: true })
  await Promise.all([
    appRoot, appZipPath, cliRoot, cliZipPath, stageRoot, ...legacyTargets,
  ].map(target => rm(target, { recursive: true, force: true })))

  await run('pnpm', ['run', 'build'])

  const contents = join(appRoot, 'Contents')
  const macOS = join(contents, 'MacOS')
  const resources = join(contents, 'Resources')
  const runtime = join(resources, 'runtime')
  await Promise.all([
    mkdir(macOS, { recursive: true }),
    mkdir(join(resources, 'config'), { recursive: true }),
    mkdir(runtime, { recursive: true }),
    mkdir(stageRoot, { recursive: true }),
  ])

  await stagePackagedRuntime(runtime, join(resources, 'config'))
  await copyFile(join(repoRoot, 'desktop/openai-auth-bridge.js'), join(resources, 'openai-auth-bridge.js'))

  const executable = join(macOS, 'deepseek-harness')
  await run('xcrun', [
    'clang', '-fobjc-arc', '-fmodules',
    `-fmodules-cache-path=${join(stageRoot, 'clang-cache')}`,
    '-mmacosx-version-min=13.0', '-framework', 'Cocoa', '-framework', 'WebKit',
    '-o', executable, join(repoRoot, 'desktop/DeepSeekHarnessApp.m'),
  ])
  await chmod(executable, 0o755)

  const rootPackage = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as { version: string }
  await writeFile(join(contents, 'Info.plist'), infoPlist(rootPackage.version))
  await buildIcon(join(stageRoot, 'AppIcon.iconset'), join(resources, 'AppIcon.icns'))
  await removeAppleDouble(appRoot)
  await run('codesign', ['--force', '--deep', '--sign', '-', appRoot])
  await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appRoot])
  await run('ditto', [
    '-c', '-k', '--norsrc', '--noextattr', '--noqtn', '--noacl', '--keepParent', appRoot, appZipPath,
  ])

  await populateCliDistribution(cliRoot, runtime, join(resources, 'config'))
  await run('ditto', [
    '-c', '-k', '--norsrc', '--noextattr', '--noqtn', '--noacl', '--keepParent', cliRoot, cliZipPath,
  ])
  await rm(stageRoot, { recursive: true, force: true })

  console.log(`Built ${appRoot}`)
  console.log(`Archive ${appZipPath}`)
  console.log(`Built ${cliRoot}`)
  console.log(`Archive ${cliZipPath}`)
}

await main()
