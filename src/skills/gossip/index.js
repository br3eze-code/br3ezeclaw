const { BaseSkill } = require('../base.js')
const WebSocket = require('ws')
const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')

class GossipSkill extends BaseSkill {
  static id = 'gossip'
  static name = 'Gossip Protocol'
  static description = 'Distributed gossip: peer discovery, state sync, failure detection, rumor spreading'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.nodeId = config.nodeId || crypto.randomUUID()
    this.port = config.port || 7890
    this.seedPeers = config.seedPeers || []
    this.gossipInterval = config.gossipInterval || 1000 // ms
    this.failureTimeout = config.failureTimeout || 5000 // ms

    this.peers = new Map() // peerId -> { addr, ws, lastSeen, state }
    this.localState = new Map() // key -> { value, version, nodeId, timestamp }
    this.server = null
    this.gossipTimer = null
    this.vectorClock = { [this.nodeId]: 0 } // for conflict resolution
  }

  static getTools() {
    return {
      'gossip.start': {
        risk: 'medium',
        description: 'Start gossip node: listen for peers, begin periodic sync. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            port: { type: 'number', default: 7890 },
            seeds: { type: 'array', items: { type: 'string' }, description: 'ws://host:port seeds' },
            reason: { type: 'string' }
          },
          required: ['reason']
        }
      },
      'gossip.join': {
        risk: 'low',
        description: 'Join peer by address',
        parameters: {
          type: 'object',
          properties: {
            peer: { type: 'string', description: 'ws://host:port' }
          },
          required: ['peer']
        }
      },
      'gossip.set': {
        risk: 'low',
        description: 'Set key in distributed state. Gossips to cluster.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
            ttl: { type: 'number', description: 'ms to live, 0 = forever' }
          },
          required: ['key', 'value']
        }
      },
      'gossip.get': {
        risk: 'low',
        description: 'Get key from distributed state',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string' }
          },
          required: ['key']
        }
      },
      'gossip.peers': {
        risk: 'low',
        description: 'List live peers + their state versions',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      'gossip.broadcast': {
        risk: 'medium',
        description: 'Broadcast message to all peers via rumor. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            message: { type: 'string' },
            reason: { type: 'string' }
          },
          required: ['topic', 'message', 'reason']
        }
      },
      'gossip.stop': {
        risk: 'low',
        description: 'Stop gossip node and disconnect peers',
        parameters: { type: 'object', properties: {} }
      }
    }
  }

  async healthCheck() {
    return {
      status: this.server? 'running' : 'stopped',
      nodeId: this.nodeId,
      peers: this.peers.size,
      keys: this.localState.size
    }
  }

  _incrementClock() {
    this.vectorClock[this.nodeId] = (this.vectorClock[this.nodeId] || 0) + 1
  }

  _mergeClock(remote) {
    for (const [node, time] of Object.entries(remote)) {
      this.vectorClock[node] = Math.max(this.vectorClock[node] || 0, time)
    }
    this._incrementClock()
  }

  _newer(local, remote) {
    if (!local) return true
    if (local.nodeId === remote.nodeId) return remote.version > local.version
    // Compare vector clocks
    const lv = local.vectorClock || {}
    const rv = remote.vectorClock || {}
    let localNewer = false, remoteNewer = false
    const allNodes = new Set([...Object.keys(lv),...Object.keys(rv)])
    for (const n of allNodes) {
      if ((lv[n] || 0) > (rv[n] || 0)) localNewer = true
      if ((rv[n] || 0) > (lv[n] || 0)) remoteNewer = true
    }
    if (localNewer &&!remoteNewer) return false
    if (remoteNewer &&!localNewer) return true
    // Concurrent: break tie with nodeId
    return remote.nodeId > local.nodeId
  }

  _handleMessage(peerId, msg) {
    const peer = this.peers.get(peerId)
    if (peer) peer.lastSeen = Date.now()

    switch (msg.type) {
      case 'digest':
        // Peer sends their state versions. Reply with data they lack
        const delta = []
        for (const [k, v] of this.localState) {
          const remoteV = msg.state[k]
          if (!remoteV || this._newer(v, remoteV)) {
            delta.push([k, v])
          }
        }
        this._send(peerId, { type: 'update', state: Object.fromEntries(delta), clock: this.vectorClock })
        break

      case 'update':
        // Peer sends actual k/v pairs
        this._mergeClock(msg.clock)
        let changed = false
        for (const [k, v] of Object.entries(msg.state)) {
          const local = this.localState.get(k)
          if (this._newer(local, v)) {
            this.localState.set(k, v)
            changed = true
            this.logger.debug(`GOSSIP UPDATE ${k} from ${peerId}`, { version: v.version })
          }
        }
        if (changed) this._persist()
        break

      case 'rumor':
        // Broadcast message: re-gossip to 2 random peers
        this.logger.info(`GOSSIP RUMOR ${msg.topic} from ${peerId}: ${msg.message}`)
        this.emit('rumor', { topic: msg.topic, message: msg.message, from: peerId })
        this._gossipRumor(msg, peerId)
        break
    }
  }

  _send(peerId, msg) {
    const peer = this.peers.get(peerId)
    if (peer?.ws?.readyState === WebSocket.OPEN) {
      peer.ws.send(JSON.stringify({...msg, from: this.nodeId }))
    }
  }

  _gossipRumor(msg, excludePeer) {
    const targets = [...this.peers.keys()].filter(p => p!== excludePeer).sort(() => 0.5 - Math.random()).slice(0, 2)
    targets.forEach(p => this._send(p, msg))
  }

  _gossipRound() {
    // 1. Remove dead peers
    const now = Date.now()
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > this.failureTimeout) {
        this.logger.warn(`GOSSIP PEER DEAD ${id}`)
        p.ws?.close()
        this.peers.delete(id)
      }
    }

    // 2. Pick random peer and send digest
    if (this.peers.size === 0) return
    const peerId = [...this.peers.keys()][Math.floor(Math.random() * this.peers.size)]
    const digest = {}
    for (const [k, v] of this.localState) {
      digest[k] = { version: v.version, nodeId: v.nodeId, vectorClock: v.vectorClock }
    }
    this._send(peerId, { type: 'digest', state: digest })
  }

  async _persist() {
    const statePath = path.join(this.workspace, 'gossip_state.json')
    await fs.writeFile(statePath, JSON.stringify({
      localState: [...this.localState.entries()],
      vectorClock: this.vectorClock
    }, null, 2))
  }

  async _load() {
    try {
      const statePath = path.join(this.workspace, 'gossip_state.json')
      const data = JSON.parse(await fs.readFile(statePath, 'utf8'))
      this.localState = new Map(data.localState)
      this.vectorClock = data.vectorClock || { [this.nodeId]: 0 }
    } catch {}
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'gossip.start':
          this.logger.warn(`GOSSIP START port ${args.port || this.port}`, { user: ctx.userId, reason: args.reason })
          await this._load()

          this.port = args.port || this.port
          this.server = new WebSocket.Server({ port: this.port })

          this.server.on('connection', (ws, req) => {
            const peerId = crypto.randomUUID()
            this.peers.set(peerId, { addr: req.socket.remoteAddress, ws, lastSeen: Date.now() })

            ws.on('message', data => {
              try { this._handleMessage(peerId, JSON.parse(data)) } catch (e) { this.logger.error(`GOSSIP MSG ERR: ${e.message}`) }
            })
            ws.on('close', () => this.peers.delete(peerId))
            this.logger.info(`GOSSIP PEER CONNECTED ${peerId}`)
          })

          // Connect to seeds
          for (const seed of [...this.seedPeers,...(args.seeds || [])]) {
            await this.execute('gossip.join', { peer: seed }, ctx)
          }

          // Start gossip loop
          this.gossipTimer = setInterval(() => this._gossipRound(), this.gossipInterval)
          return { nodeId: this.nodeId, port: this.port, seeds: args.seeds?.length || 0 }

        case 'gossip.join':
          this.logger.info(`GOSSIP JOIN ${args.peer}`, { user: ctx.userId })
          const ws = new WebSocket(args.peer)
          const peerId = crypto.randomUUID()

          ws.on('open', () => {
            this.peers.set(peerId, { addr: args.peer, ws, lastSeen: Date.now() })
            this.logger.info(`GOSSIP JOINED ${peerId}`)
          })
          ws.on('message', data => {
            try { this._handleMessage(peerId, JSON.parse(data)) } catch (e) { this.logger.error(`GOSSIP MSG ERR: ${e.message}`) }
          })
          ws.on('close', () => this.peers.delete(peerId))
          ws.on('error', () => this.peers.delete(peerId))

          return { peer: args.peer, peerId }

        case 'gossip.set':
          this.logger.info(`GOSSIP SET ${args.key}`, { user: ctx.userId })
          this._incrementClock()
          const entry = {
            value: args.value,
            version: Date.now(),
            nodeId: this.nodeId,
            timestamp: Date.now(),
            vectorClock: {...this.vectorClock },
            ttl: args.ttl? Date.now() + args.ttl : 0
          }
          this.localState.set(args.key, entry)
          await this._persist()
          return { key: args.key, version: entry.version, peers: this.peers.size }

        case 'gossip.get':
          this.logger.info(`GOSSIP GET ${args.key}`, { user: ctx.userId })
          const val = this.localState.get(args.key)
          if (val?.ttl && Date.now() > val.ttl) {
            this.localState.delete(args.key)
            return { key: args.key, value: null, expired: true }
          }
          return { key: args.key, value: val?.value || null, version: val?.version, nodeId: val?.nodeId }

        case 'gossip.peers':
          this.logger.info(`GOSSIP PEERS`, { user: ctx.userId })
          return {
            nodeId: this.nodeId,
            peers: [...this.peers.entries()].map(([id, p]) => ({
              id,
              addr: p.addr,
              lastSeen: Date.now() - p.lastSeen,
              connected: p.ws?.readyState === WebSocket.OPEN
            })),
            vectorClock: this.vectorClock
          }

        case 'gossip.broadcast':
          this.logger.warn(`GOSSIP BROADCAST ${args.topic}`, { user: ctx.userId, reason: args.reason })
          const msg = { type: 'rumor', topic: args.topic, message: args.message, id: crypto.randomUUID(), ts: Date.now() }
          this._gossipRumor(msg, null)
          return { topic: args.topic, sent: this.peers.size }

        case 'gossip.stop':
          this.logger.info(`GOSSIP STOP`, { user: ctx.userId })
          clearInterval(this.gossipTimer)
          this.server?.close()
          this.peers.forEach(p => p.ws?.close())
          this.peers.clear()
          await this._persist()
          return { stopped: true }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Gossip ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = GossipSkill
