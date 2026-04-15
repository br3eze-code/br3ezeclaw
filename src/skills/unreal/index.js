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
'ue.android.test': {
  risk: 'high',
  description: 'Run Gauntlet on Android device via ADB. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      device_id: { type: 'string', description: 'adb device serial' },
      test: { type: 'string', default: 'Project.Functional' },
      map: { type: 'string', default: '/Game/Maps/TestMap' },
      vulkan: { type: 'boolean', default: true },
      reason: { type: 'string' }
    },
    required: ['project', 'device_id', 'reason']
  }
},
'ue.android.playstore': {
  risk: 'high',
  description: 'Upload AAB/APK to Google Play. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      aab_path: { type: 'string', description: 'path from package build' },
      track: { type: 'string', enum: ['internal', 'alpha', 'beta', 'production'], default: 'internal' },
      release_notes: { type: 'string' },
      reason: { type: 'string' }
    },
    required: ['project', 'aab_path', 'reason']
  }
},
'ue.switch.deploy': {
  risk: 'high',
  description: 'Deploy to Nintendo Switch devkit via DevMenu. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      nsp_path: { type: 'string', description: 'path from package build' },
      devkit_ip: { type: 'string', description: 'Switch devkit IP' },
      title_id: { type: 'string' },
      reason: { type: 'string' }
    },
    required: ['project', 'nsp_path', 'devkit_ip', 'reason']
  }
},
'ue.switch.lotcheck': {
  risk: 'medium',
  description: 'Run Nintendo LotCheck automation. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      nsp_path: { type: 'string' },
      reason: { type: 'string' }
    },
    required: ['project', 'nsp_path', 'reason']
  }
}
'ue.multiplayer.deploy': {
  risk: 'high',
  description: 'Deploy dedicated server to Agones/K8s for playtest. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      image: { type: 'string', description: 'docker image: game-server:1.2.3' },
      map: { type: 'string', default: '/Game/Maps/TestMap' },
      max_players: { type: 'number', default: 16 },
      region: { type: 'string', enum: ['us-west-2', 'eu-central-1', 'ap-northeast-1'], default: 'us-west-2' },
      ttl: { type: 'number', default: 3600, description: 'auto-shutdown seconds' },
      password: { type: 'string', description: 'server password' },
      reason: { type: 'string' }
    },
    required: ['project', 'image', 'reason']
  }
},
'ue.multiplayer.stop': {
  risk: 'medium',
  description: 'Stop Agones fleet/game servers',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      fleet: { type: 'string', description: 'fleet name or "all"' }
    },
    required: ['project']
  }
},
'ue.loc.gather': {
  risk: 'low',
  description: 'Run Loc gather: text from Blueprints/C++/UMG to.po files',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      config: { type: 'string', default: 'Game', description: 'Localization target name' },
      preview: { type: 'boolean', default: false, description: 'dry run, no write' }
    },
    required: ['project']
  }
},
'ue.loc.sync': {
  risk: 'medium',
  description: 'Sync.po files to OneSky/POEditor. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      config: { type: 'string', default: 'Game' },
      service: { type: 'string', enum: ['onesky', 'poeditor'], default: 'onesky' },
      push_source: { type: 'boolean', default: true },
      pull_translations: { type: 'boolean', default: true },
      reason: { type: 'string' }
    },
    required: ['project', 'reason']
  }
}
'ue.insights.query': {
  risk: 'low',
  description: 'Query Unreal Insights trace: CPU, GPU, memory, bookmarks',
  parameters: {
    type: 'object',
    properties: {
      trace: { type: 'string', description: 'path to .utrace file' },
      query: { type: 'string', enum: ['summary', 'cpu', 'gpu', 'memory', 'loadtime', 'bookmarks'], default: 'summary' },
      filter: { type: 'string', description: 'e.g. stat name or thread' }
    },
    required: ['trace']
  }
},
'ue.uht.run': {
  risk: 'medium',
  description: 'Run UnrealHeaderTool on plugin/module. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      module: { type: 'string', description: 'module name or path to .uplugin' },
      engine_include: { type: 'boolean', default: false },
      fail_on_warning: { type: 'boolean', default: true },
      reason: { type: 'string' }
    },
    required: ['project', 'module', 'reason']
  }
}
  
'ue.p4.sync': {
  risk: 'low',
  description: 'Perforce sync workspace to CL or #head',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      changelist: { type: 'string', default: '#head', description: 'CL number or #head' },
      force: { type: 'boolean', default: false }
    },
    required: ['project']
  }
},
'ue.p4.submit': {
  risk: 'high',
  description: 'Perforce submit changelist. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      files: { type: 'array', items: { type: 'string' }, description: 'paths to add/edit' },
      description: { type: 'string' },
      reason: { type: 'string' }
    },
    required: ['project', 'files', 'description', 'reason']
  }
},
'ue.horde.job': {
  risk: 'high',
  description: 'Submit job to Horde CI: build, cook, test, render. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string' },
      stream: { type: 'string', description: 'e.g. //UE5/Main' },
      change: { type: 'string', default: 'latest' },
      template: { type: 'string', enum: ['Editor', 'Cook', 'Tests', 'Package', 'Gauntlet'], default: 'Cook' },
      target: { type: 'string', default: 'Editor' },
      platform: { type: 'string', enum: ['Win64', 'Linux', 'PS5'], default: 'Linux' },
      arguments: { type: 'string', description: 'extra UAT args' },
      reason: { type: 'string' }
    },
    required: ['project', 'stream', 'reason']
  }
},
'ue.horde.status': {
  risk: 'low',
  description: 'Check Horde job status',
  parameters: {
    type: 'object',
    properties: {
      job_id: { type: 'string' }
    },
    required: ['job_id']
  }
}
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
          case 'ue.android.test':
  this.logger.warn(`UE ANDROID TEST ${args.device_id}`, { user: ctx.userId, test: args.test, reason: args.reason })
  const proj17 = this._safeUproject(args.project)

  // Check ADB device online
  const { stdout: adbOut } = await execAsync('adb devices')
  if (!adbOut.includes(args.device_id)) throw new Error(`Device ${args.device_id} not found in adb devices`)

  const androidArgs = [
    'RunUnreal',
    `-project="${proj17}"`,
    `-test=${args.test}`,
    '-platform=Android',
    `-device=${args.device_id}`,
    args.map? `-map=${args.map}` : '',
    args.vulkan? '-vulkan' : '-opengl',
    '-build=local',
    '-config=Development',
    '-unattended'
  ].filter(Boolean)

  const { stdout: andOut, stderr: andErr } = await this._runUAT(androidArgs, 1800)
  const passed = andOut.includes('Test Successful') &&!andErr.includes('Error')

  // Pull logcat on failure
  if (!passed) {
    const { stdout: logcat } = await execAsync(`adb -s ${args.device_id} logcat -d -t 500`)
    return { project: args.project, device: args.device_id, test: args.test, passed, logcat: logcat.slice(-6000), log: andOut.slice(-2000) }
  }

  return { project: args.project, device: args.device_id, test: args.test, passed, log: andOut.slice(-4000) }

case 'ue.android.playstore':
  this.logger.warn(`UE PLAYSTORE UPLOAD ${args.aab_path}`, { user: ctx.userId, track: args.track, reason: args.reason })
  const aab = path.resolve(this.projectRoot, args.aab_path)
  await fs.access(aab)

  if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT) throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT json not set')

  // Use fastlane or gradle-play-publisher via python
  const py = `
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

creds = service_account.Credentials.from_service_account_file('${process.env.GOOGLE_PLAY_SERVICE_ACCOUNT}')
service = build('androidpublisher', 'v3', credentials=creds)

package_name = '${process.env.ANDROID_PACKAGE_NAME}'
edit_id = service.edits().insert(packageName=package_name).execute()['id']

media = MediaFileUpload('${aab}', mimetype='application/octet-stream', resumable=True)
bundle = service.edits().bundles().upload(packageName=package_name, editId=edit_id, media_body=media).execute()

track = service.edits().tracks().update(
    packageName=package_name,
    editId=edit_id,
    track='${args.track}',
    body={'releases': [{'versionCodes': [bundle['versionCode']], 'status': 'completed', 'releaseNotes': [{'language': 'en-US', 'text': """${args.release_notes}"""}]}]}
).execute()

service.edits().commit(packageName=package_name, editId=edit_id).execute()
print(f"Uploaded versionCode {bundle['versionCode']} to ${args.track}")
`
  const { stdout } = await execAsync(`python3 -c "${py.replace(/"/g, '\\"')}"`, { timeout: 600000 })
  return { project: args.project, aab: args.aab_path, track: args.track, uploaded: true, log: stdout }

case 'ue.switch.deploy':
  this.logger.warn(`UE SWITCH DEPLOY ${args.devkit_ip}`, { user: ctx.userId, nsp: args.nsp_path, reason: args.reason })
  const nsp = path.resolve(this.projectRoot, args.nsp_path)
  await fs.access(nsp)

  if (!process.env.NINTENDO_SDK_ROOT) throw new Error('NINTENDO_SDK_ROOT not set')
  const devmenu = path.join(process.env.NINTENDO_SDK_ROOT, 'Tools/CommandLineTools/DevMenu/DevMenu.exe')

  // Install via DevMenu TCP
  const cmd = `"${devmenu}" -i ${args.devkit_ip} -u install "${nsp}"`
  const { stdout } = await execAsync(cmd, { timeout: 600000 })
  if (!stdout.includes('Success')) throw new Error(`DevMenu install failed: ${stdout}`)

  // Launch
  const launch = `"${devmenu}" -i ${args.devkit_ip} -u launch ${args.title_id}`
  await execAsync(launch)

  return { project: args.project, nsp: args.nsp_path, devkit: args.devkit_ip, title_id: args.title_id, deployed: true, log: stdout.slice(-2000) }

case 'ue.switch.lotcheck':
  this.logger.warn(`UE SWITCH LOTCHECK ${args.nsp_path}`, { user: ctx.userId, reason: args.reason })
  const nsp2 = path.resolve(this.projectRoot, args.nsp_path)
  const lotcheck = path.join(process.env.NINTENDO_SDK_ROOT, 'Tools/CommandLineTools/LotCheck/LotCheck.exe')

  const { stdout: lotOut, stderr: lotErr } = await execAsync(`"${lotcheck}" -p "${nsp2}" -o "${this.outputDir}/lotcheck_${Date.now()}.html"`, { timeout: 600000 })
  const passed =!lotErr && lotOut.includes('LotCheck: PASS')
  const reportPath = lotOut.match(/Report: (.+\.html)/)?.[1]
  return { project: args.project, nsp: args.nsp_path, passed, report: reportPath, log: lotOut.slice(-4000) }
case 'ue.multiplayer.deploy':
  this.logger.warn(`UE AGONES DEPLOY ${args.project} ${args.image}`, { user: ctx.userId, region: args.region, reason: args.reason })
  const proj12 = this._safeUproject(args.project)

  // Generate Agones Fleet YAML
  const fleetName = `agentos-${path.basename(proj12, '.uproject').toLowerCase()}-${Date.now()}`
  const fleetYaml = `
apiVersion: "agones.dev/v1"
kind: Fleet
metadata:
  name: ${fleetName}
  labels:
    agentos: "true"
    ttl: "${args.ttl}"
spec:
  replicas: 1
  template:
    metadata:
      labels:
        game: ${path.basename(proj12, '.uproject')}
    spec:
      ports:
      - name: game
        portPolicy: Dynamic
        containerPort: 7777
        protocol: UDP
      template:
        spec:
          containers:
          - name: gameserver
            image: ${args.image}
            command: ["/game/GameServer.sh"]
            args: ["${args.map}?MaxPlayers=${args.max_players}${args.password? '?Password='+args.password : ''}", "-log", "-port=7777"]
            resources:
              requests:
                cpu: "2000m"
                memory: "4Gi"
              limits:
                cpu: "4000m"
                memory: "8Gi"
`

  // kubectl apply via aws skill or direct
  if (!this.agent.registry.skills.k8s) throw new Error('K8s skill required for Agones')
  const apply = await this.agent.registry.execute('k8s.apply', {
    yaml: fleetYaml,
    namespace: 'agones-system'
  }, ctx.userId)

  // Wait for allocation and get IP:port
  let addr = null
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const gs = await this.agent.registry.execute('k8s.get', {
      kind: 'GameServer',
      labelSelector: `agones.dev/fleet=${fleetName}`,
      namespace: 'agones-system'
    }, ctx.userId)
    if (gs.items?.[0]?.status?.state === 'Allocated') {
      addr = `${gs.items[0].status.address}:${gs.items[0].status.ports[0].port}`
      break
    }
  }

  // Schedule TTL deletion
  setTimeout(async () => {
    await this.agent.registry.execute('k8s.delete', { kind: 'Fleet', name: fleetName, namespace: 'agones-system' }, 'system')
    this.logger.info(`Agones fleet ${fleetName} auto-deleted after ${args.ttl}s`)
  }, args.ttl * 1000)

  return {
    project: args.project,
    fleet: fleetName,
    image: args.image,
    address: addr || 'pending',
    map: args.map,
    max_players: args.max_players,
    ttl: args.ttl,
    connect: addr? `open ${addr}` : 'wait for allocation'
  }

case 'ue.multiplayer.stop':
  this.logger.info(`UE AGONES STOP ${args.fleet}`, { user: ctx.userId })
  if (!this.agent.registry.skills.k8s) throw new Error('K8s skill required')
  const result = await this.agent.registry.execute('k8s.delete', {
    kind: 'Fleet',
    name: args.fleet === 'all'? '' : args.fleet,
    labelSelector: args.fleet === 'all'? 'agentos=true' : '',
    namespace: 'agones-system'
  }, ctx.userId)
  return { project: args.project, stopped: args.fleet, result }

case 'ue.loc.gather':
  this.logger.info(`UE LOC GATHER ${args.project} ${args.config}`, { user: ctx.userId })
  const proj13 = this._safeUproject(args.project)
  const gatherArgs = [
    'Localize',
    `-project="${proj13}"`,
    `-targetname=${args.config}`,
    args.preview? '-preview' : ''
  ].filter(Boolean)
  const { stdout } = await this._runUAT(gatherArgs, 300)
  const words = stdout.match(/Gathered (\d+) words/)?.[1] || '0'
  const files = stdout.match(/Updated (\d+) files/)?.[1] || '0'
  return { project: args.project, config: args.config, words_gathered: parseInt(words), files_updated: parseInt(files), preview: args.preview, log: stdout.slice(-2000) }

case 'ue.loc.sync':
  this.logger.warn(`UE LOC SYNC ${args.service} ${args.project}`, { user: ctx.userId, reason: args.reason })
  const proj14 = this._safeUproject(args.project)
  const locPath = path.join(path.dirname(proj14), 'Content/Localization', args.config)

  if (args.service === 'onesky') {
    const ONESKY_KEY = process.env.ONESKY_API_KEY
    const ONESKY_SECRET = process.env.ONESKY_API_SECRET
    const ONESKY_PROJECT = process.env.ONESKY_PROJECT_ID
    if (!ONESKY_KEY) throw new Error('ONESKY_API_KEY not set')

    // Push source.po
    if (args.push_source) {
      const sourcePo = path.join(locPath, 'en', `${args.config}.po`)
      const poData = await fs.readFile(sourcePo)
      const form = new FormData()
      form.append('file', poData, `${args.config}.po`)
      form.append('file_format', 'GNU_PO')
      form.append('locale', 'en')
      form.append('is_keeping_all_strings', 'false')

      await axios.post(`https://api.oneskyapp.com/1/projects/${ONESKY_PROJECT}/files`, form, {
        headers: {...form.getHeaders() },
        auth: { username: ONESKY_KEY, password: ONESKY_SECRET }
      })
    }

    // Pull translations
    if (args.pull_translations) {
      const langs = await axios.get(`https://api.oneskyapp.com/1/projects/${ONESKY_PROJECT}/languages`, {
        auth: { username: ONESKY_KEY, password: ONESKY_SECRET }
      })
      for (const lang of langs.data.data) {
        if (lang.code === 'en') continue
        const res = await axios.get(`https://api.oneskyapp.com/1/projects/${ONESKY_PROJECT}/translations`, {
          params: { locale: lang.code, source_file_name: `${args.config}.po` },
          auth: { username: ONESKY_KEY, password: ONESKY_SECRET }
        })
        const outDir = path.join(locPath, lang.code)
        await fs.mkdir(outDir, { recursive: true })
        await fs.writeFile(path.join(outDir, `${args.config}.po`), res.data)
      }
      // Recompile loc
      await this._runUAT(['Localize', `-project="${proj14}"`, `-targetname=${args.config}`, '-compile'], 120)
    }

    return { project: args.project, service: 'onesky', pushed: args.push_source, pulled: args.pull_translations }

  } else if (args.service === 'poeditor') {
    // Similar logic with POEditor API
    throw new Error('POEditor sync not implemented yet - use onesky')
  }
          case 'ue.insights.query':
  this.logger.info(`UE INSIGHTS QUERY ${args.trace} ${args.query}`, { user: ctx.userId })
  const tracePath = path.resolve(this.projectRoot, args.trace)
  await fs.access(tracePath) // validate exists
  
  // Use UnrealInsights CLI: UnrealInsights.exe <trace> -Query=Summary -ExecCmds="Query Save query.json; quit"
  const insightsExe = this.workspace.insightsPath || 'UnrealInsights'
  const outJson = path.join(this.outputDir, `insights_${Date.now()}.json`)
  
  let queryCmd = ''
  switch (args.query) {
    case 'summary':
      queryCmd = 'TimingInsights.ExportTraceInfo'
      break
    case 'cpu':
      queryCmd = `TimingInsights.ExportTimerStats ${args.filter || ''}`
      break
    case 'gpu':
      queryCmd = `TimingInsights.ExportGpuStats ${args.filter || ''}`
      break
    case 'memory':
      queryCmd = 'MemoryInsights.ExportMemTags'
      break
    case 'loadtime':
      queryCmd = 'AssetLoadingInsights.ExportTable'
      break
    case 'bookmarks':
      queryCmd = 'TimingInsights.ExportBookmarks'
      break
  }
  
  const cmd = `"${insightsExe}" "${tracePath}" -OpenLog -ExecCmds="${queryCmd} ${outJson}; quit" -Unattended`
  await execAsync(cmd, { timeout: 120000 })
  
  let result = {}
  try {
    const raw = await fs.readFile(outJson, 'utf8')
    // Insights exports CSV or JSON depending on command
    if (raw.startsWith('{') || raw.startsWith('[')) {
      result = JSON.parse(raw)
    } else {
      result = { csv: raw.split('\n').slice(0, 200).join('\n') } // first 200 lines
    }
  } catch {
    result = { error: 'No output generated. Trace may be empty or query invalid.' }
  }
  
  return { trace: args.trace, query: args.query, filter: args.filter, data: result }

case 'ue.uht.run':
  this.logger.warn(`UE UHT ${args.module}`, { user: ctx.userId, reason: args.reason })
  const proj9 = this._safeUproject(args.project)
  
  // Find UHT: Engine/Binaries/DotNET/UnrealHeaderTool/UnrealHeaderTool.dll
  const uhtDll = path.join(path.dirname(this.uatPath), '..', 'DotNET', 'UnrealHeaderTool', 'UnrealHeaderTool.dll')
  
  // Build target file list
  let targetFile = proj9
  if (args.module.endsWith('.uplugin')) {
    targetFile = path.resolve(this.projectRoot, args.module)
  }
  
  const uhtArgs = [
    'dotnet', `"${uhtDll}"`,
    `"${targetFile}"`,
    '-NoMutex',
    '-WaitMutex',
    args.engine_include ? '-IncludeEngineHeaders' : '',
    args.fail_on_warning ? '-FailIfGeneratedCodeChanges' : '',
    '-LogCmds="log UHT verbose"'
  ].filter(Boolean)
  
  const { stdout, stderr } = await execAsync(uhtArgs.join(' '), { timeout: 300000 })
  
  const passed = !stderr.includes('Error:') && !stdout.includes('error C')
  const warnings = (stdout.match(/Warning:/g) || []).length
  const errors = (stdout.match(/Error:/g) || []).length + (stdout.match(/error C\d+/g) || []).length
  
  return {
    project: args.project,
    module: args.module,
    passed,
    warnings,
    errors,
    log: stdout.slice(-6000),
    stderr: stderr.slice(-2000)
  }
          case 'ue.p4.sync':
  this.logger.info(`UE P4 SYNC ${args.project} ${args.changelist}`, { user: ctx.userId })
  const proj7 = this._safeUproject(args.project)
  const p4Args = [
    'SyncProject',
    `-project="${proj7}"`,
    `-change=${args.changelist}`,
    args.force ? '-force' : ''
  ].filter(Boolean)
  const { stdout } = await this._runUAT(p4Args, 600)
  return { project: args.project, changelist: args.changelist, log: stdout.slice(-4000) }

case 'ue.p4.submit':
  this.logger.warn(`UE P4 SUBMIT ${args.project}`, { user: ctx.userId, files: args.files.length, reason: args.reason })
  const proj8 = this._safeUproject(args.project)
  // Create changelist via Python in editor for file context
  const submitScript = `
import unreal
import os
changelist_desc = """${args.description}

Submitted via AgentOS
Reason: ${args.reason}"""
scc = unreal.get_editor_subsystem(unreal.SourceControlSubsystem)
scc.enable_source_control('Perforce')
for f in ${JSON.stringify(args.files)}:
    abs_path = os.path.join(unreal.Paths.project_dir(), f)
    if os.path.exists(abs_path):
        unreal.SourceControlHelpers.mark_file_for_add(abs_path)
    else:
        raise Exception(f'File not found: {f}')
provider = scc.get_provider()
new_cl = provider.create_changelist(changelist_desc)
provider.submit_changelist(new_cl)
print(f'Submitted CL {new_cl.get_identifier()}')
`
  await this._remotePython(proj8, submitScript, 120)
  return { project: args.project, files: args.files, description: args.description, submitted: true }

case 'ue.horde.job':
  this.logger.warn(`UE HORDE JOB ${args.template} ${args.stream}`, { user: ctx.userId, change: args.change, reason: args.reason })
  const hordeUrl = this.workspace.horde_server || process.env.HORDE_URL
  if (!hordeUrl) throw new Error('HORDE_URL not set in env or workspace')
  
  const payload = {
    name: `${args.project}-${args.template}-${Date.now()}`,
    streamId: args.stream,
    change: args.change === 'latest' ? undefined : parseInt(args.change),
    templateId: args.template,
    arguments: [
      `-Target=${args.target}`,
      `-Platform=${args.platform}`,
      args.arguments || ''
    ].filter(Boolean)
  }
  
  const res = await axios.post(`${hordeUrl}/api/v1/jobs`, payload, {
    headers: {
      'Authorization': `Bearer ${process.env.HORDE_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  
  return {
    job_id: res.data.id,
    job_name: res.data.name,
    stream: args.stream,
    template: args.template,
    url: `${hordeUrl}/job/${res.data.id}`,
    status: res.data.state
  }

case 'ue.horde.status':
  const hordeUrl2 = this.workspace.horde_server || process.env.HORDE_URL
  const res2 = await axios.get(`${hordeUrl2}/api/v1/jobs/${args.job_id}`, {
    headers: { 'Authorization': `Bearer ${process.env.HORDE_TOKEN}` }
  })
  const job = res2.data
  return {
    job_id: job.id,
    name: job.name,
    state: job.state, // Running, Complete, Failed
    outcome: job.outcome, // Success, Failure, Warning
    batches: job.batches?.map(b => ({
      id: b.id,
      state: b.state,
      steps: b.steps?.map(s => ({ name: s.name, state: s.state, log: s.logUrl }))
    })),
    url: `${hordeUrl2}/job/${job.id}`
  }
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
