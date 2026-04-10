mikrotik-firebase-captive-portal/
├── server/                          # Node.js Authentication Server
│   ├── src/
│   │   ├── config/
│   │   │   ├── firebase.js
│   │   │   └── mikrotik.js
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── mikrotik.js
│   │   │   └── webhooks.js
│   │   ├── services/
│   │   │   ├── firebaseAuth.js
│   │   │   ├── mikrotikAPI.js
│   │   │   └── sessionManager.js
│   │   ├── middleware/
│   │   │   ├── auth.js
│   │   │   └── validate.js
│   │   └── utils/
│   │       ├── crypto.js
│   │       └── helpers.js
│   ├── package.json
│   ├── server.js
│   └── .env.example
├── mikrotik/                        # Router Configuration
│   ├── hotspot/
│   │   ├── login.html
│   │   ├── status.html
│   │   ├── logout.html
│   │   ├── error.html
│   │   ├── redirect.html
│   │   └── css/
│   │       └── style.css
│   ├── scripts/
│   │   ├── setup.rsc
│   │   ├── webhooks.rsc
│   │   └── monitoring.rsc
│   └── certs/
│       └── README.md
├── admin-dashboard/                 # React Admin Panel
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── firebase.js
│   ├── package.json
│   └── public/
├── docker-compose.yml
├── Dockerfile
├── deploy.sh
└── README.md
