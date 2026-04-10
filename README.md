## AgentOS Architecture

┌─────────────────────────────────────────────────────────────┐
│                    🤖 AgentOS Gateway                       │
│                  (WebSocket + HTTP API)                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Telegram   │  │  WebSocket  │  │   HTTP REST API     │  │
│  │    Channel  │  │   Clients   │  │   (Vouchers/Tools)  │  │
│  │  (Buttons)  │  │  (Dashboard)│  │                     │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                    │             │
│         └────────────────┴────────────────────┘             │
│                          │                                  │
│                   ┌──────▼──────┐                           │
│                   │   Core      │                           │
│                   │   Engine    │                           │
│                   └──────┬──────┘                           │
│                          │                                  │
│         ┌────────────────┼────────────────┐                 │
│         │                │                │                 │
│    ┌────▼────┐    ┌─────▼─────┐    ┌────▼────┐              │
│    │Hotspot  │    │ Database  │    │ Logger  │              │
│    │ Agent   │    │(Firebase/ │    │(Winston)│              │
│    │ (Tools) │    │  Local)   │    │         │              │
│    └────┬────┘    └───────────┘    └─────────┘              │
│         │                                                   │
│    ┌────▼─────────────────────────────────────────┐         │
│    │           🔧 Available Tools                 │         │
│    │  user.add | user.kick | user.status          │         │
│    │  users.active | system.stats | system.logs   │         │
│    │  ping | traceroute | firewall.list | reboot  │         │
│    └──────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  MikroTik Router │
                    │   (192.168.88.1) │
                    └─────────────────┘

## Folder Structure

agentos/
├── bin/
│   └── agentos.js              # CLI entry point
├── src/
│   ├── cli/
│   │   ├── program.js          # Commander setup
│   │   ├── commands/
│   │   │   ├── gateway.js      # agentos gateway (run|stop|status)
│   │   │   ├── network.js      # agentos network (ping|scan|firewall)
│   │   │   ├── users.js        # agentos users (list|kick|add)
│   │   │   ├── voucher.js      # agentos voucher (create|list|revoke)
│   │   │   ├── onboard.js      # agentos onboard (interactive setup)
│   │   │   ├── config.js       # agentos config (get|set)
│   │   │   └── doctor.js       # agentos doctor (health check)
│   │   └── hooks/
│   │       └── init.js         # Pre-command checks
│   ├── core/
│   │   ├── gateway.js          # WebSocket server
│   │   ├── mikrotik.js         # RouterOS manager
│   │   ├── database.js         # Firebase/local storage
│   │   └── logger.js           # Winston logger
│   └── utils/
│       ├── helpers.js          # Formatters, validators
│       └── config-manager.js   # Config file operations
├── package.json
└── README.md

## Command Line Interface Tree

agentos
├── onboard              Interactive setup wizard
├── gateway              Run WebSocket gateway
│   ├── (default)        Run in foreground
│   ├── --daemon         Run as service
│   └── --force          Kill existing process
├── gateway:status       Check if running
├── gateway:stop         Stop service
├── network (net)        Network tools
│   ├── ping <host>      Ping test
│   ├── scan             DHCP scan
│   ├── firewall         Show rules
│   ├── block <target>   Block address
│   └── unblock <target> Unblock address
├── users (user)         User management
│   ├── list             List users (--all for all)
│   ├── kick <user>      Disconnect user
│   ├── add <user>       Create user
│   ├── remove <user>    Delete user
│   └── status <user>    Check online status
├── voucher (v)          Voucher management
│   ├── create [plan]    Generate voucher
│   ├── list             Show recent
│   ├── revoke <code>    Delete unused
│   └── stats            Statistics
├── config               Configuration
│   ├── get <path>       Read value
│   ├── set <path>       Write value
│   ├── edit             Open in editor
│   └── show             Display all
├── doctor               Health check
│   └── --fix            Auto-repair
├── status (s)           Quick overview
├── --version            Show version
├── --help               Show help
├── --dev                Development profile
└── --profile <name>     Named profile
