const { PythonShell } = require('python-shell')
const path = require('path')
const fs = require('fs/promises')
const { BaseSkill } = require('../base.js')

class BlenderSkill extends BaseSkill {
  static id = 'blender'
  static name = 'Blender 3D'
  static description = 'Render, model, export 3D assets with Blender'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.blenderPath = config.blenderPath || 'blender'
    this.scriptsDir = path.join(__dirname, 'scripts')
    this.outputDir = config.outputDir || '/tmp/blender_output'
  }

  static getTools() {
    return {
'blender.ai.texture': {
  risk: 'medium',
  description: 'Generate texture with Stable Diffusion + apply to material. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string', description: '.blend file' },
      material: { type: 'string', description: 'material name' },
      prompt: { type: 'string', description: 'e.g. "worn leather, 4k, seamless"' },
      negative: { type: 'string', default: 'blurry, lowres, text' },
      size: { type: 'number', enum: [512, 1024, 2048], default: 1024 },
      model: { type: 'string', default: 'sdxl' },
      reason: { type: 'string' }
    },
    required: ['file', 'material', 'prompt', 'reason']
  }
},
'blender.pipeline.bake': {
  risk: 'high',
  description: 'Bake textures, export GLB, upload to S3. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string' },
      objects: { type: 'array', items: { type: 'string' }, description: 'object names to bake' },
      bake_type: { type: 'string', enum: ['COMBINED', 'DIFFUSE', 'NORMAL'], default: 'COMBINED' },
      resolution: { type: 'number', default: 2048 },
      s3_bucket: { type: 'string' },
      s3_key: { type: 'string', description: 'e.g. assets/model.glb' },
      reason: { type: 'string' }
    },
    required: ['file', 'objects', 's3_bucket', 's3_key', 'reason']
  }
}
      'blender.render': {
        risk: 'medium',
        description: 'Render .blend file to image/video. Requires approval for long jobs.',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'path relative to workspace/blender/' },
            frame: { type: 'number', description: 'single frame, omit for animation' },
            start: { type: 'number', description: 'animation start frame' },
            end: { type: 'number', description: 'animation end frame' },
            format: { type: 'string', enum: ['PNG', 'JPEG', 'MP4'], default: 'PNG' },
            resolution: { type: 'string', enum: ['1080p', '4k', '720p'], default: '1080p' },
            samples: { type: 'number', default: 128, maximum: 4096 },
            reason: { type: 'string' }
          },
          required: ['file', 'reason']
        }
      },
      'blender.info': {
        risk: 'low',
        description: 'Get scene info: objects, materials, cameras',
        parameters: {
          type: 'object',
          properties: { file: { type: 'string' } },
          required: ['file']
        }
      },
      'blender.script': {
        risk: 'high',
        description: 'Run custom Python script in Blender. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '.blend to load first, optional' },
            script: { type: 'string', description: 'Python code' },
            timeout: { type: 'number', default: 60, maximum: 300 },
            reason: { type: 'string' }
          },
          required: ['script', 'reason']
        }
      },
      'blender.export': {
        risk: 'medium',
        description: 'Export scene to glTF, USD, OBJ, FBX. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            format: { type: 'string', enum: ['glb', 'gltf', 'usd', 'usda', 'obj', 'fbx'], default: 'glb' },
            selection_only: { type: 'boolean', default: false },
            reason: { type: 'string' }
          },
          required: ['file', 'reason']
        }
      }
    }
  }

  _safeBlendPath(p) {
    const base = path.resolve(this.workspace.blender_root || 'workspace/blender')
    const full = path.resolve(base, p)
    if (!full.startsWith(base)) throw new Error(`Path ${p} escapes blender_root`)
    return full
  }

  async _runBlender(args, timeout = 60000) {
    await fs.mkdir(this.outputDir, { recursive: true })
    return new Promise((resolve, reject) => {
      const opts = {
        mode: 'text',
        pythonOptions: ['-u'],
        args: args,
        timeout: timeout * 1000
      }
      const pyshell = new PythonShell(this._pythonBridge(), opts)
      let output = ''
      let error = ''

      pyshell.on('message', msg => output += msg + '\n')
      pyshell.on('stderr', err => error += err + '\n')
      pyshell.on('error', reject)
      pyshell.on('close', () => {
        if (error && !output) reject(new Error(error))
        else resolve({ output, error })
      })
    })
  }

  _pythonBridge() {
    // Write bridge script once
    const bridge = path.join(this.scriptsDir, 'bridge.py')
    return bridge
  }

  async init() {
    await fs.mkdir(this.scriptsDir, { recursive: true })
    const bridgeCode = `
import bpy
import sys
import json
import os

def main():
    req = json.loads(sys.argv[1])
    out_dir = req['out_dir']
    
    if req.get('blend_file'):
        bpy.ops.wm.open_mainfile(filepath=req['blend_file'])
    
    if req['action'] == 'info':
        data = {
            'objects': [o.name for o in bpy.data.objects],
            'materials': [m.name for m in bpy.data.materials],
            'cameras': [c.name for c in bpy.data.cameras],
            'scenes': [s.name for s in bpy.data.scenes],
            'frame_start': bpy.context.scene.frame_start,
            'frame_end': bpy.context.scene.frame_end
        }
        print(json.dumps(data))
    
    elif req['action'] == 'render':
        scene = bpy.context.scene
        scene.render.image_settings.file_format = req.get('format', 'PNG')
        if req.get('resolution') == '4k':
            scene.render.resolution_x, scene.render.resolution_y = 3840, 2160
        elif req.get('resolution') == '720p':
            scene.render.resolution_x, scene.render.resolution_y = 1280, 720
        else:
            scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
        
        if bpy.context.scene.render.engine == 'CYCLES':
            scene.cycles.samples = req.get('samples', 128)
        
        out_path = os.path.join(out_dir, f"render_{os.getpid()}")
        scene.render.filepath = out_path
        
        if req.get('frame'):
            scene.frame_set(req['frame'])
            bpy.ops.render.render(write_still=True)
            print(json.dumps({'file': out_path + '.png', 'frame': req['frame']}))
        else:
            scene.frame_start = req.get('start', scene.frame_start)
            scene.frame_end = req.get('end', scene.frame_end)
            bpy.ops.render.render(animation=True)
            print(json.dumps({'dir': out_dir, 'start': scene.frame_start, 'end': scene.frame_end}))
    
    elif req['action'] == 'export':
        out_path = os.path.join(out_dir, f"export_{os.getpid()}.{req['format']}")
        if req['format'] in ['glb', 'gltf']:
            bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB' if req['format']=='glb' else 'GLTF_SEPARATE', use_selection=req.get('selection_only', False))
        elif req['format'] in ['usd', 'usda']:
            bpy.ops.wm.usd_export(filepath=out_path, selected_objects_only=req.get('selection_only', False))
        elif req['format'] == 'obj':
            bpy.ops.wm.obj_export(filepath=out_path, export_selected_objects=req.get('selection_only', False))
        elif req['format'] == 'fbx':
            bpy.ops.export_scene.fbx(filepath=out_path, use_selection=req.get('selection_only', False))
        print(json.dumps({'file': out_path}))
    
    elif req['action'] == 'script':
        exec(req['script'], {'bpy': bpy})
        print(json.dumps({'status': 'ok'}))

if __name__ == '__main__':
    main()
`
    await fs.writeFile(path.join(this.scriptsDir, 'bridge.py'), bridgeCode)
  }

  async healthCheck() {
    const { error } = await this._runBlender([this.blenderPath, '--version'])
    if (error) throw new Error(`Blender not found: ${error}`)
    return { status: 'ok', blender: this.blenderPath }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
          case 'blender.ai.texture':
  this.logger.warn(`BLENDER AI TEXTURE ${args.file}:${args.material}`, { user: ctx.userId, prompt: args.prompt, reason: args.reason })
  const blend5 = this._safeBlendPath(args.file)
  const outTex = path.join(this.outputDir, `tex_${Date.now()}.png`)

  const sdPayload = {
    prompt: args.prompt,
    negative_prompt: args.negative,
    width: args.size,
    height: args.size,
    steps: 30,
    cfg_scale: 7,
    sampler_name: 'DPM++ 2M Karras'
  }

  const sdRes = await fetch(this.workspace.sd_api || 'http://localhost:7860/sdapi/v1/txt2img', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sdPayload)
  })
  const sdJson = await sdRes.json()
  const imgBase64 = sdJson.images[0]
  await fs.writeFile(outTex, Buffer.from(imgBase64, 'base64'))


  const script = `
import bpy
mat = bpy.data.materials.get('${args.material}')
if not mat: mat = bpy.data.materials.new('${args.material}')
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links
for n in nodes: nodes.remove(n)
out = nodes.new('ShaderNodeOutputMaterial')
bsdf = nodes.new('ShaderNodeBsdfPrincipled')
tex = nodes.new('ShaderNodeTexImage')
tex.image = bpy.data.images.load('${outTex}')
links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
`
  const req5 = { action: 'script', blend_file: blend5, out_dir: this.outputDir, script }
  await this._runBlender([this.blenderPath, '-b', '-P', this._pythonBridge(), '--', JSON.stringify(req5)], 120)

  return { file: args.file, material: args.material, texture: outTex, prompt: args.prompt }

case 'blender.pipeline.bake':
  this.logger.warn(`BLENDER PIPELINE ${args.file} -> s3://${args.s3_bucket}/${args.s3_key}`, { user: ctx.userId, reason: args.reason })
  const blend6 = this._safeBlendPath(args.file)

  const bakeScript = `
import bpy
import os
bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.device = 'GPU'
bpy.context.scene.cycles.samples = 64

for obj_name in ${JSON.stringify(args.objects)}:
    obj = bpy.data.objects[obj_name]
    bpy.context.view_layer.objects.active = obj

    # Create bake image
    img = bpy.data.images.new(f"Bake_{obj_name}", ${args.resolution}, ${args.resolution})

    # Assign to material
    for mat_slot in obj.material_slots:
        mat = mat_slot.material
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = img
        nodes.active = tex

    bpy.ops.object.bake(type='${args.bake_type}', use_selected_to_active=False)
    img.filepath_raw = os.path.join('${this.outputDir}', f"{obj_name}_baked.png")
    img.file_format = 'PNG'
    img.save()

# Export GLB
out_glb = os.path.join('${this.outputDir}', 'pipeline_${Date.now()}.glb')
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_apply=True)
print(json.dumps({'glb': out_glb}))
`
  const req6 = { action: 'script', blend_file: blend6, out_dir: this.outputDir, script: bakeScript }
  const { output: out6 } = await this._runBlender([this.blenderPath, '-b', '-P', this._pythonBridge(), '--', JSON.stringify(req6)], 600)
  const { glb } = JSON.parse(out6.trim().split('\n').pop())

  
  if (this.agent.registry.skills.aws) {
    const glbBuf = await fs.readFile(glb)
    await this.agent.registry.execute('aws.s3.put', {
      bucket: args.s3_bucket,
      key: args.s3_key,
      body_base64: glbBuf.toString('base64'),
      content_type: 'model/gltf-binary'
    }, ctx.userId)
  } else {
    throw new Error('AWS skill not enabled for S3 upload')
  }

  return { file: args.file, baked_objects: args.objects, s3_url: `s3://${args.s3_bucket}/${args.s3_key}`, size: (await fs.stat(glb)).size } 
          
        case 'blender.info':
          const blend1 = this._safeBlendPath(args.file)
          const req1 = { action: 'info', blend_file: blend1, out_dir: this.outputDir }
          const { output: out1 } = await this._runBlender([this.blenderPath, '-b', '-P', this._pythonBridge(), '--', JSON.stringify(req1)])
          return JSON.parse(out1.trim().split('\n').pop())

        case 'blender.render':
          this.logger.warn(`BLENDER RENDER ${args.file}`, { user: ctx.userId, frames: args.frame || `${args.start}-${args.end}`, reason: args.reason })
          const blend2 = this._safeBlendPath(args.file)
          const req2 = {
            action: 'render',
            blend_file: blend2,
            out_dir: this.outputDir,
            frame: args.frame,
            start: args.start,
            end: args.end,
            format: args.format,
            resolution: args.resolution,
            samples: args.samples
          }
          const { output: out2 } = await this._runBlender([this.blenderPath, '-b', '-P', this._pythonBridge(), '--', JSON.stringify(req2)], 600)
          const result = JSON.parse(out2.trim().split('\n').pop())
          if (result.file) {
            const buf = await fs.readFile(result.file)
            return { ...result, base64: buf.toString('base64'), size: buf.length }
          }
          return result

        case 'blender.script':
          this.logger.warn(`BLENDER SCRIPT on ${args.file || 'empty'}`, { user: ctx.userId, reason: args.reason })
          const blend3 = args.file ? this._safeBlendPath(args.file) : null
          const req3 = { action: 'script', blend_file: blend3, out_dir: this.outputDir, script: args.script }
          const { output: out3, error } = await this._runBlender([this.blenderPath, '-b', '-P', this._pythonBridge(), '--', JSON.stringify(req3)], args.timeout)
          if (error) throw new Error(error)
          return JSON.parse(out3.trim().split('\n').pop())

        case 'blender.export':
          this.logger.warn(`BLENDER EXPORT ${args.file} -> ${args.format}`, { user: ctx.userId, reason: args.reason })
          const blend4 = this._safeBlendPath(args.file)
          const req4 = {
            action: 'export',
            blend_file: blend4,
            out_dir: this.outputDir,
            format: args.format,
            selection_only: args.selection_only
          }
          const { output: out4 } = await this._runBlender([this.blenderPath, '-b', '-P', this._pythonBridge(), '--', JSON.stringify(req4)], 300)
          const res = JSON.parse(out4.trim().split('\n').pop())
          const buf = await fs.readFile(res.file)
          return { ...res, base64: buf.toString('base64'), size: buf.length }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Blender ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = BlenderSkill
