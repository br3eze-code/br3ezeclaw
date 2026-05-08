const { printVoucher } = require('../src/core/printer');
const { logger } = require('../src/core/logger');

// Override config locally for the test if arguments are provided
const mockConfig = {
    printer: {
        type: process.argv[3] || 'EPSON',
        interface: process.argv[2] || 'tcp://192.168.88.254',
        timeout: 5000
    }
};

// Mocking the getConfig temporarily to use our arguments
const configModule = require('../src/core/config');
const originalGetConfig = configModule.getConfig;
configModule.getConfig = () => ({ ...originalGetConfig(), printer: mockConfig.printer });

async function runTest() {
    console.log('==================================');
    console.log('--- Printer Debug & Diagnostics --');
    console.log('==================================');
    
    console.log('\n[1] Environment & Configuration:');
    console.log(`- Configured Interface: ${mockConfig.printer.interface}`);
    console.log(`- Configured Type: ${mockConfig.printer.type}`);
    console.log(`- Configured Timeout: ${mockConfig.printer.timeout}ms`);

    console.log('\n[2] Bluetooth Auto-Discovery:');
    try {
        const { discoverBluetoothPrinterPort } = require('../src/core/printer');
        const btPort = discoverBluetoothPrinterPort();
        if (btPort) {
            console.log(`✅ Discovered BT Printer on: ${btPort}`);
        } else {
            console.log(`⚠️ No Bluetooth printer auto-discovered.`);
        }
    } catch (e) {
        console.log(`❌ Bluetooth discovery error: ${e.message}`);
    }

    console.log('\n[3] Printing Test Voucher:');
    const sampleVoucher = {
        username: 'debug_user_99',
        password: 'debug_password',
        profile: 'Debug-Profile',
        loginUrl: 'http://hotspot.local/login?username=debug_user_99&password=debug_password'
    };

    logger.info('Sending print command...');
    try {
        const startTime = Date.now();
        const result = await printVoucher(sampleVoucher);
        const duration = Date.now() - startTime;
        
        if (result.success) {
            console.log(`\n✅ Print job completed successfully in ${duration}ms!`);
            console.log(`- Used Interface: ${result.interface}`);
            console.log(`- QR Code generated: Yes (${result.qrDataURI.substring(0, 30)}...)`);
        } else {
            console.log(`\n❌ Print job failed after ${duration}ms.`);
            console.log(`- Error Message: ${result.error}`);
            if (result.code) console.log(`- Error Code: ${result.code}`);
            if (result.stack) console.log(`- Stack Trace:\n${result.stack}`);
            
            console.log('\n--- Troubleshooting Tips ---');
            console.log('1. Ensure the printer is powered on and paired via Bluetooth.');
            console.log('2. Check if the COM port is correct and not used by another program.');
            console.log('3. If using TCP, verify the IP address and network connectivity.');
            console.log('4. Try setting PRINTER_INTERFACE explicitly in .env (e.g. PRINTER_INTERFACE=serial:\\\\.\\COM7)');
        }
    } catch (e) {
        console.error('\n❌ Unhandled Test execution error:', e);
    }
    
    console.log('==================================');
}

runTest();
