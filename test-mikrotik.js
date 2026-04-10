const { RouterOSClient } = require('routeros-client');

const client = new RouterOSClient({
    host: '192.168.88.1',
    user: 'admin',
    password: 'admin123',
    port: 8728,
    timeout: 10000
});

async function test() {
    try {
        console.log('Connecting to MikroTik...');
        const conn = await client.connect();
        console.log('✅ Connected!');
        
        const id = await conn.menu('/system/identity').get();
        console.log('Router:', id[0].name);
        
        const res = await conn.menu('/system/resource').get();
        console.log('Version:', res[0].version);
        console.log('Uptime:', res[0].uptime);
        
        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error('Code:', err.code);
        process.exit(1);
    }
}

test();