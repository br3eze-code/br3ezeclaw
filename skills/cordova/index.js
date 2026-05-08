const { exec } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const fs = require('fs/promises')
const { BaseSkill } = require('../base.js')

const execAsync = promisify(exec)

class CordovaSkill extends BaseSkill {
  static id = 'cordova'
  static name = 'Cordova'
  static description = 'Automate Cordova: create, add platforms/plugins, build, sign, deploy'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.projectRoot = config.projectRoot || '/workspace/cordova'
  }

  static getTools() {
    return {
      'cordova.info': {
        risk: 'low',
        description: 'Get Cordova project info: platforms, plugins, config.xml',
        parameters: {
          type: 'object',
          properties: { project: { type: 'string', description: 'path to cordova project' } },
          required: ['project']
        }
      },
      'cordova.platform.add': {
        risk: 'medium',
        description: 'Add platform: android, ios. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            platform: { type: 'string', enum: ['android', 'ios'] },
            version: { type: 'string', description: 'e.g. cordova-android@12.0.0' },
            reason: { type: 'string' }
          },
          required: ['project', 'platform', 'reason']
        }
      },
      'cordova.plugin.add': {
        risk: 'medium',
        description: 'Add plugin. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            plugin: { type: 'string', description: 'cordova-plugin-camera' },
            variables: { type: 'object', description: 'plugin vars' },
            reason: { type: 'string' }
          },
          required: ['project', 'plugin', 'reason']
        }
      },
      'cordova.build': {
        risk: 'high',
        description: 'Build platform. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            platform: { type: 'string', enum: ['android', 'ios'] },
            release: { type: 'boolean', default: true },
            device: { type: 'boolean', default: false },
            reason: { type: 'string' }
          },
          required: ['project', 'platform', 'reason']
        }
      },
      'cordova.run': {
        risk: 'high',
        description: 'Run on device/emulator. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            platform: { type: 'string', enum: ['android', 'ios'] },
            target: { type: 'string', description: 'device id or "emulator"' },
            reason: { type: 'string' }
          },
          required: ['project', 'platform', 'reason']
        }
      },
      'cordova.sign.android': {
        risk: 'high',
        description: 'Sign Android APK/AAB. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            build_type: { type: 'string', enum: ['apk', 'aab'], default: 'aab' },
            keystore: { type: 'string', description: 'path to.keystore' },
            alias: { type: 'string' },
            reason: { type: 'string' }
          },
          required: ['project', 'keystore', 'alias', 'reason']
        }
      },
      'cordova.ios.upload': {
        risk: 'high',
        description: 'Upload IPA to App Store/TestFlight. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            ipa_path: { type: 'string' },
            reason: { type: 'string' }
          },
          required: ['project', 'ipa_path', 'reason']
        }
      }
    }
  }

  _safePath(p) {
    const base = path.resolve(this.projectRoot)
    const full = path.resolve(base, p)
    if (!full.startsWith(base)) throw new Error(`Path ${p} escapes projectRoot`)
    return full
  }

  async _cordovaCmd(project, cmd, timeout = 600) {
    const cwd = this._safePath(project)
    await fs.access(path.join(cwd, 'config.xml')) // validate cordova project
    this.logger.info(`Cordova: ${cmd} in ${cwd}`)
    const { stdout, stderr } = await execAsync(`cordova ${cmd}`, { cwd, timeout: timeout * 1000, maxBuffer: 50 * 1024 })
    if (stderr.includes('Error:')) throw new Error(stderr.slice(-2000))
    return { stdout: stdout.slice(-8000), stderr: stderr.slice(-2000) }
  }

  async healthCheck() {
    const { stdout } = await execAsync('cordova -v')
    return { status: 'ok', version: stdout.trim() }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'cordova.info':
          const proj1 = this._safePath(args.project)
          const xml2js = require('xml2js')
          const xml = await fs.readFile(path.join(proj1, 'config.xml'), 'utf8')
          const config = await xml2js.parseStringPromise(xml)
          const { stdout: platOut } = await execAsync('cordova platform ls', { cwd: proj1 })
          const { stdout: plugOut } = await execAsync('cordova plugin ls', { cwd: proj1 })
          return {
            id: config.widget.$.id,
            version: config.widget.$.version,
            name: config.widget.name[0],
            platforms: platOut.match(/Installed platforms:\n(.+)/s)?.[1]?.split('\n').map(s => s.trim()).filter(Boolean) || [],
            plugins: plugOut.split('\n').filter(Boolean)
          }

        case 'cordova.platform.add':
          this.logger.warn(`CORDOVA PLATFORM ADD ${args.platform}`, { user: ctx.userId, reason: args.reason })
          const platArg = args.version? `${args.platform}@${args.version}` : args.platform
          const { stdout } = await this._cordovaCmd(args.project, `platform add ${platArg}`, 600)
          return { project: args.project, platform: args.platform, log: stdout }

        case 'cordova.plugin.add':
          this.logger.warn(`CORDOVA PLUGIN ADD ${args.plugin}`, { user: ctx.userId, reason: args.reason })
          const vars = args.variables? Object.entries(args.variables).map(([k, v]) => `--variable ${k}="${v}"`).join(' ') : ''
          const { stdout: pout } = await this._cordovaCmd(args.project, `plugin add ${args.plugin} ${vars}`, 300)
          return { project: args.project, plugin: args.plugin, log: pout }

        case 'cordova.build':
          this.logger.warn(`CORDOVA BUILD ${args.platform} release:${args.release}`, { user: ctx.userId, reason: args.reason })
          const buildArgs = [
            'build',
            args.platform,
            args.release? '--release' : '--debug',
            args.device? '--device' : ''
          ].filter(Boolean).join(' ')
          const { stdout: bout } = await this._cordovaCmd(args.project, buildArgs, 1800)

          // Find output path
          const projPath = this._safePath(args.project)
          let output = ''
          if (args.platform === 'android') {
            const buildType = args.release? 'release' : 'debug'
            output = args.release? `platforms/android/app/build/outputs/bundle/release/app-release.aab` : `platforms/android/app/build/outputs/apk/debug/app-debug.apk`
          } else if (args.platform === 'ios') {
            output = args.device? 'platforms/ios/build/device' : 'platforms/ios/build/emulator'
          }

          return { project: args.project, platform: args.platform, release: args.release, output, log: bout.slice(-4000) }

        case 'cordova.run':
          this.logger.warn(`CORDOVA RUN ${args.platform} ${args.target}`, { user: ctx.userId, reason: args.reason })
          const runArgs = ['run', args.platform, '--device', args.target? `--target=${args.target}` : ''].filter(Boolean).join(' ')
          const { stdout: rout } = await this._cordovaCmd(args.project, runArgs, 600)
          return { project: args.project, platform: args.platform, target: args.target, log: rout.slice(-4000) }

        case 'cordova.sign.android':
          this.logger.warn(`CORDOVA SIGN ANDROID`, { user: ctx.userId, reason: args.reason })
          const proj2 = this._safePath(args.project)
          const keystore = this._safePath(args.keystore)

          // Set signing config in build.json
          const buildJson = {
            android: {
              release: {
                keystore,
                storePassword: process.env.ANDROID_KEYSTORE_PASSWORD,
                alias: args.alias,
                password: process.env.ANDROID_KEY_PASSWORD,
                keystoreType: ''
              }
            }
          }
          await fs.writeFile(path.join(proj2, 'build.json'), JSON.stringify(buildJson, null, 2))

          const { stdout: sout } = await this._cordovaCmd(args.project, `build android --release`, 1800)
          const signedPath = args.build_type === 'aab'? 'platforms/android/app/build/outputs/bundle/release/app-release.aab' : 'platforms/android/app/build/outputs/apk/release/app-release.apk'

          return { project: args.project, signed: signedPath, build_type: args.build_type, log: sout.slice(-2000) }

        case 'cordova.ios.upload':
          this.logger.warn(`CORDOVA IOS UPLOAD`, { user: ctx.userId, reason: args.reason })
          const ipa = this._safePath(args.ipa_path)
          await fs.access(ipa)

          const { stdout: uout } = await execAsync(`xcrun altool --upload-app -f "${ipa}" -t ios -u ${process.env.APPLE_ID} -p ${process.env.APPLE_APP_PWD} --output-format xml`, { timeout: 600000 })
          if (!uout.includes('No errors uploading')) throw new Error(`Upload failed: ${uout}`)

          return { project: args.project, ipa: args.ipa_path, uploaded: true, log: uout.slice(-2000) }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Cordova ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = CordovaSkill
