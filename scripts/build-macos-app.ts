/** Build the self-contained native macOS desktop distribution. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

interface SharpPipeline {
  resize(width: number, height: number): SharpPipeline
  png(): SharpPipeline
  toFile(path: string): Promise<unknown>
}

type SharpFactory = (input: Buffer) => SharpPipeline

const PRODUCT_NAME = 'DeeepSeek Harness'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultOutput = resolve(repoRoot, '../../outputs')

function outputArgument(argv: readonly string[]): string {
  const index = argv.indexOf('--output')
  if (index < 0) return defaultOutput
  const value = argv[index + 1]
  if (value === undefined || value.length === 0) throw new Error('--output needs a directory')
  return resolve(value)
}

async function run(command: string, args: readonly string[], cwd = repoRoot): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: 'inherit', env: process.env })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} exited with ${code ?? signal ?? 'unknown status'}`))
    })
  })
}

function assertSafeOutput(outputRoot: string, target: string): void {
  const relative = target.slice(outputRoot.length)
  if (!target.startsWith(`${outputRoot}/`) || relative.length < 4) {
    throw new Error(`refusing to replace unsafe desktop output ${target}`)
  }
}

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

/**
 * Legacy deploy can hoist direct workspace dependencies beside the source
 * manifest instead of materializing them in the target. Restore only those
 * declared packages, without copying their package-local node_modules trees.
 */
async function restoreLegacyHoists(deployedRoot: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(deployedRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const sourceNodeModules = join(repoRoot, 'apps/desktop-runtime/node_modules')
  const restored: string[] = []
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(deployedRoot, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(`desktop runtime dependency ${dependency} is missing from deploy and source install`)
    }
    const nestedNodeModules = join(source, 'node_modules')
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(`${nestedNodeModules}${sep}`),
    })
    restored.push(dependency)
  }
  if (restored.length > 0) console.log(`Restored legacy deploy hoists: ${restored.join(', ')}`)
}

/** Replace every package-manager link with movable bytes inside the app. */
async function materializeStagedLinks(deployedRoot: string): Promise<void> {
  const nodeModules = join(deployedRoot, 'node_modules')
  let remaining = await findSymlink(nodeModules)
  while (remaining !== undefined) {
    const source = await realpath(remaining)
    const nestedNodeModules = join(source, 'node_modules')
    await rm(remaining, { recursive: true, force: true })
    await cp(source, remaining, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(`${nestedNodeModules}${sep}`),
    })
    remaining = await findSymlink(nodeModules)
  }
}

async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** Remove Finder AppleDouble entries before signing or archiving a distribution. */
async function removeAppleDouble(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.name.startsWith('._')) {
      await rm(path, { recursive: true, force: true })
    } else if (entry.isDirectory()) {
      await removeAppleDouble(path)
    }
  }
}

function cliWrapper(): string {
  return `#!/bin/sh
set -eu
script_path=$0
while [ -L "$script_path" ]; do
  link_target=$(readlink "$script_path")
  case "$link_target" in
    /*) script_path=$link_target ;;
    *) script_path=$(dirname -- "$script_path")/$link_target ;;
  esac
done
bin_dir=$(CDPATH= cd -- "$(dirname -- "$script_path")" && pwd)
exec "$bin_dir/../runtime/node" "$bin_dir/../runtime/dsh/deeepseek-cli.mjs" "$@"
`
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
  const outputRoot = outputArgument(process.argv.slice(2))
  const appRoot = join(outputRoot, `${PRODUCT_NAME}.app`)
  const appZipPath = join(outputRoot, 'deeepseek-harness-macos-arm64.zip')
  const cliRoot = join(outputRoot, `${PRODUCT_NAME} CLI`)
  const cliZipPath = join(outputRoot, 'deeepseek-harness-cli-macos-arm64.zip')
  const stageRoot = join(outputRoot, '.desktop-build')
  const legacyTargets = [
    join(outputRoot, 'deepseek harness.app'),
    join(outputRoot, 'deepseek-harness-macos-arm64.zip'),
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
  const deployedDsh = join(runtime, 'dsh')
  await Promise.all([
    mkdir(macOS, { recursive: true }),
    mkdir(join(resources, 'config'), { recursive: true }),
    mkdir(runtime, { recursive: true }),
    mkdir(stageRoot, { recursive: true }),
  ])

  await run('pnpm', [
    '--filter', 'deepseek-harness-desktop-runtime', 'deploy', '--legacy', '--prod',
    '--config.node-linker=hoisted', '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true', deployedDsh,
  ])
  await restoreLegacyHoists(deployedDsh)
  await materializeStagedLinks(deployedDsh)
  // Legacy production deploy changes pnpm's source-install state. Put the
  // frozen development install back so consecutive desktop builds stay valid.
  await run('pnpm', ['install', '--offline', '--frozen-lockfile'])

  await copyFile(process.execPath, join(runtime, 'node'))
  await chmod(join(runtime, 'node'), 0o755)
  await copyFile(
    join(repoRoot, 'desktop/desktop.cordis.patch.yml'),
    join(resources, 'config/desktop.cordis.patch.yml'),
  )
  await copyFile(join(repoRoot, 'desktop/openai-auth-bridge.js'), join(resources, 'openai-auth-bridge.js'))
  await copyFile(join(repoRoot, 'desktop/openai-oauth.mjs'), join(deployedDsh, 'openai-oauth.mjs'))
  await copyFile(join(repoRoot, 'apps/desktop-runtime/cli-entry.mjs'), join(deployedDsh, 'deeepseek-cli.mjs'))
  await copyFile(
    join(repoRoot, 'desktop/cli.cordis.patch.yml'),
    join(resources, 'config/cli.cordis.patch.yml'),
  )

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

  await mkdir(cliRoot, { recursive: true })
  await Promise.all([
    mkdir(join(cliRoot, 'bin'), { recursive: true }),
    mkdir(join(cliRoot, 'config'), { recursive: true }),
  ])
  await cp(runtime, join(cliRoot, 'runtime'), { recursive: true, dereference: true })
  await Promise.all([
    copyFile(join(resources, 'config/desktop.cordis.patch.yml'), join(cliRoot, 'config/desktop.cordis.patch.yml')),
    copyFile(join(resources, 'config/cli.cordis.patch.yml'), join(cliRoot, 'config/cli.cordis.patch.yml')),
    copyFile(join(repoRoot, 'desktop/README.md'), join(cliRoot, 'README.md')),
    copyFile(join(repoRoot, 'desktop/README.zh.md'), join(cliRoot, 'README.zh.md')),
    writeFile(join(cliRoot, 'bin/deeepseek-harness'), cliWrapper(), { mode: 0o755 }),
  ])
  await chmod(join(cliRoot, 'runtime/node'), 0o755)
  await chmod(join(cliRoot, 'bin/deeepseek-harness'), 0o755)
  await removeAppleDouble(cliRoot)
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
