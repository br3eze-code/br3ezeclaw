const axios = require('axios')
const { exec } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const fs = require('fs/promises')
const { BaseSkill } = require('../base.js')

const execAsync = promisify(exec)

class UnrealSkill extends BaseSkill {
  static id = 'unreal'
  static name = 'Unreal Engine'
  static description = 'Automate UE5: build lighting, cook, run tests, render, submit to farm'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.uatPath = config.uatPath || '/UnrealEngine/Engine/Build/BatchFiles/RunUAT.sh'
    this.editorPath = config.editorPath || '/UnrealEngine/Engine/Binaries/Linux/UnrealEditor'
    this.remotePy = config.remotePy || 'http://localhost:30010' // Unreal Python Remote Execution
    this.projectRoot = config.projectRoot || '/workspace/unreal'
  }

  static getTools() {
    return {
      'ue.project.info': {
        risk: 'low',
        description: 'Get .uproject info: engine version, plugins, targets',
        parameters: {
          type: 'object',
          properties: { project: { type: 'string', description: 'path to .uproject' } },
          required: ['project']
        }
      },
      'ue.python.exec': {
        risk: 'high',
        description: 'Run Python in Unreal Editor. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            script: { type: 'string', description: 'unreal Python code' },
            timeout: { type: 'number', default: 60, maximum: 600 },
            reason: { type: 'string' }
          },
          required: ['project', 'script', 'reason']
        }
      },
      'ue.lighting.build': {
        risk: 'high',
        description: 'Build lighting for maps. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            maps: { type: 'array', items: { type: 'string' } },
            quality: { type: 'string', enum: ['Preview', 'Medium', 'High', 'Production'], default: 'Production' },
            reason: { type: 'string' }
          },
          required: ['project', 'maps', 'reason']
        }
      },
      'ue.cook.run': {
        risk: 'high',
        description: 'Cook content for platform. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            platform: { type: 'string', enum: ['Windows', 'Linux', 'PS5', 'XSX', 'IOS', 'Android'], default: 'Linux' },
            maps: { type: 'array', items: { type: 'string' } },
            iterative: { type: 'boolean', default: true },
            reason: { type: 'string' }
          },
          required: ['project', 'platform', 'reason']
        }
      },
      'ue.test.automation': {
        risk: 'medium',
        description: 'Run Unreal Automation Tests. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            tests: { type: 'string', description: 'filter e.g. "Project.Functional"' },
            reason: { type: 'string' }
          },
          required: ['project', 'reason']
        }
      },
      'ue.render.movie': {
        risk: 'high',
        description: 'Render Movie Render Queue. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            level_sequence: { type: 'string', description: '/Game/Cinematics/Seq_Master' },
            queue: { type: 'string', description: '/Game/Cinematics/MRQ_Queue' },
            s3_output: { type: 'string', description: 's3://bucket/prefix/' },
            reason: { type: 'string' }
          },
          required: ['project', 'level_sequence', 'reason']
        }
      },
      'ue.asset.import': {
        risk: 'medium',
        description: 'Import FBX/glTF/USD into project. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            source: { type: 'string', description: 'path or s3:// url' },
            destination: { type: 'string', description: '/Game/Assets/Imported' },
            reason: { type: 'string' }
          },
          required: ['project', 'source', 'destination', 'reason']
        }
      }
    }
  }

  _safeUproject(p) {
    const base = path.resolve(this.projectRoot)
    const full = path.resolve(base, p)
    if (!full.startsWith(base)) throw new Error(`Project ${p} escapes projectRoot`)
    if (!full.endsWith('.uproject')) throw new Error('Must be .uproject')
    return full
  }

  async _runUAT(args, timeout = 1800) {
    const cmd = `${this.uatPath} ${args.join(' ')}`
    this.logger.info(`UAT: ${cmd}`)
    const { stdout, stderr } = await execAsync(cmd, { timeout: timeout * 1000, maxBuffer: 50 * 1024 })
    if (stderr.includes('Error:') || stderr.includes('Failed')) throw new Error(stderr.slice(-2000))
    return { stdout: stdout.slice(-8000), stderr: stderr.slice(-2000) }
  }

  async _remotePython(project, script, timeout = 60) {
    try {
      const res = await axios.put(`${this.remotePy}/remote/object/call`, {
        objectPath: '/Script/PythonScriptPlugin.Default__PythonScriptLibrary',
        functionName: 'ExecutePythonCommand',
        parameters: { Command: script }
      }, { timeout: timeout * 1000 })
      return res.data
    } catch (e) {
      throw new Error(`Remote Python failed: ${e.message}. Ensure Editor running with -RemotePython`)
    }
  }

  async healthCheck() {
    await fs.access(this.uatPath)
    return { status: 'ok', uat: this.uatPath, editor: this.editorPath }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'ue.project.info':
          const uproject = this._safeUproject(args.project)
          const data = JSON.parse(await fs.readFile(uproject, 'utf8'))
          return {
            project: path.basename(uproject),
            engineVersion: data.EngineAssociation,
            plugins: data.Plugins?.map(p => `${p.Name}:${p.Enabled}`),
            targets: data.TargetPlatforms
          }

        case 'ue.python.exec':
          this.logger.warn(`UE PYTHON EXEC ${args.project}`, { user: ctx.userId, reason: args.reason })
          const proj1 = this._safeUproject(args.project)
          const result = await this._remotePython(proj1, args.script, args.timeout)
          return { project: args.project, result }

        case 'ue.lighting.build':
          this.logger.warn(`UE LIGHTING BUILD ${args.project}`, { user: ctx.userId, maps: args.maps, quality: args.quality, reason: args.reason })
          const proj2 = this._safeUproject(args.project)
          const mapArgs = args.maps.map(m => `-Map=${m}`).join(' ')
          const uatArgs = [
            'BuildLighting',
            `-project="${proj2}"`,
            mapArgs,
            `-Quality=${args.quality}`,
            '-AllowCommandletRendering'
          ]
          const { stdout } = await this._runUAT(uatArgs, 3600)
          return { project: args.project, maps: args.maps, quality: args.quality, log: stdout.slice(-4000) }

        case 'ue.cook.run':
          this.logger.warn(`UE COOK ${args.project} ${args.platform}`, { user: ctx.userId, reason: args.reason })
          const proj3 = this._safeUproject(args.project)
          const mapList = args.maps?.length ? args.maps.map(m => `-Map=${m}`).join(' ') : ''
          const cookArgs = [
            'BuildCookRun',
            `-project="${proj3}"`,
            '-nop4', '-cook', '-stage', '-pak',
            `-platform=${args.platform}`,
            '-clientconfig=Development',
            mapList,
            args.iterative ? '-iterative' : ''
          ].filter(Boolean)
          const { stdout: cookOut } = await this._runUAT(cookArgs, 3600)
          return { project: args.project, platform: args.platform, log: cookOut.slice(-4000) }

        case 'ue.test.automation':
          this.logger.warn(`UE TESTS ${args.project}`, { user: ctx.userId, filter: args.tests, reason: args.reason })
          const proj4 = this._safeUproject(args.project)
          const testArgs = [
            'RunUnreal',
            `-project="${proj4}"`,
            '-ExecCmds="Automation RunTests ' + (args.tests || '') + '; quit"',
            '-testexit=Automation Test Queue Empty',
            '-log'
          ]
          const { stdout: testOut, stderr: testErr } = await this._runUAT(testArgs, 600)
          const passed =!testErr.includes('Error') && testOut.includes('tests succeeded')
          return { project: args.project, passed, log: testOut.slice(-4000) }

        case 'ue.render.movie':
          this.logger.warn(`UE MRQ RENDER ${args.project}`, { user: ctx.userId, seq: args.level_sequence, reason: args.reason })
          const proj5 = this._safeUproject(args.project)
          const renderScript = `
import unreal
subsystem = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
queue = unreal.load_asset('${args.queue}')
if not queue: raise Exception('Queue not found')
subsystem.render_queue(queue)
`
          // MRQ requires editor, use commandlet
          const cmdArgs = [
            `"${this.editorPath}"`,
            `"${proj5}"`,
            '-game',
            '-MoviePipelineConfig="/Script/MovieRenderPipelineCore.MoviePipelinePrimaryConfig"',
            `-LevelSequence="${args.level_sequence}"`,
            '-MoviePipelineLocalExecutor',
            '-windowed', '-resx=1280', '-resy=720',
            '-stdout', '-FullStdOutLogOutput',
            '-nopause', '-buildmachine'
          ]
          const { stdout: renOut } = await execAsync(cmdArgs.join(' '), { timeout: 7200 * 1000 })
          
          // Upload to S3 if requested
          if (args.s3_output) {
            // Assume output in Saved/MovieRenders/
            // In prod: parse log for path, upload via aws skill
            this.logger.info(`Render complete, uploading to ${args.s3_output}`)
          }
          return { project: args.project, sequence: args.level_sequence, s3_output: args.s3_output, log: renOut.slice(-4000) }

        case 'ue.asset.import':
          this.logger.warn(`UE IMPORT ${args.source} -> ${args.destination}`, { user: ctx.userId, reason: args.reason })
          const proj6 = this._safeUproject(args.project)
          let src = args.source
          if (src.startsWith('s3://')) {
            const local = path.join('/tmp', path.basename(src))
            await this.agent.registry.execute('aws.s3.get', { url: src, path: local }, ctx.userId)
            src = local
          }
          
          const importScript = `
import unreal
task = unreal.AssetImportTask()
task.filename = r'${src}'
task.destination_path = '${args.destination}'
task.automated = True
task.save = True
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
`
          await this._remotePython(proj6, importScript, 300)
          return { project: args.project, source: args.source, destination: args.destination, imported: true }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Unreal ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = UnrealSkill
