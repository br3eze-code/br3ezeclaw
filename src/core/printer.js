const ThermalPrinter = require('node-thermal-printer').printer;
const PrinterTypes = require('node-thermal-printer').types;
const QRCode = require('qrcode');
const { execSync } = require('child_process');
const { logger } = require('./logger');

/**
 * On Windows, Bluetooth serial printers appear as COM ports.
 * This helper parses paired BT devices to find the correct COM port
 * for the connected thermal printer (RFCOMM/SPP profile).
 *
 * If PRINTER_INTERFACE is explicitly set in .env (e.g. "\\\\.\\COM7"),
 * that value takes priority and discovery is skipped.
 *
 * @returns {string|null} COM port interface string e.g. "\\\\.\\COM7" or null
 */
let cachedBtPort = null;
let lastDiscoveryTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function discoverBluetoothPrinterPort() {
    const now = Date.now();
    if (cachedBtPort && (now - lastDiscoveryTime < CACHE_TTL)) {
        logger.debug(`[Printer] Using cached Bluetooth port: ${cachedBtPort}`);
        return cachedBtPort;
    }

    try {
        // Using Get-CimInstance is significantly faster than Get-PnpDevice
        const cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_SerialPort | Where-Object { $_.Name -like \'*Bluetooth*\' } | Select-Object DeviceID, Name, PNPDeviceID | ConvertTo-Json -Compress"';
        const raw = execSync(cmd, { timeout: 10000, encoding: 'utf8' });
        
        if (!raw || !raw.trim()) {
            logger.debug('[Printer] No Bluetooth serial ports found via CimInstance.');
            return null;
        }

        const devices = JSON.parse(raw.trim());
        const list = Array.isArray(devices) ? devices : [devices];

        // Filter for "real" Bluetooth ports (avoid LOCALMFG virtual ports)
        const printerPort = list.find(d => 
            d.PNPDeviceID && 
            !d.PNPDeviceID.includes('LOCALMFG') &&
            d.Name.includes('Bluetooth')
        ) || list[0]; // Fallback to first if none match

        if (printerPort && printerPort.DeviceID) {
            const portNum = printerPort.DeviceID.replace('COM', '');
            // For Windows, COM ports > 9 often need the \\.\ prefix
            const port = parseInt(portNum) > 9 ? `serial:\\\\.\\COM${portNum}` : `serial:COM${portNum}`;
            
            cachedBtPort = port;
            lastDiscoveryTime = now;
            
            logger.info(`[Printer] Auto-discovered Bluetooth printer on ${port} (${printerPort.Name})`);
            return port;
        }
    } catch (e) {
        logger.warn(`[Printer] Bluetooth discovery failed: ${e.message}`);
    }
    return null;
}

async function printVoucher(voucherData) {
    const { username, password, profile, loginUrl } = voucherData;
    const { getConfig } = require('./config');
    const config = getConfig();

    // Bail early if printing is disabled
    if (config.printer?.enabled === false) {
        logger.info('[Printer] Printing disabled in config — skipping.');
        return { success: false, error: 'Printer disabled' };
    }

    try {
        // ── Resolve interface ────────────────────────────────────────────────
        // Priority: env PRINTER_INTERFACE > auto-discover BT COM port > config default
        let iface = config.printer?.interface;

        const isAutoDiscoverable = !iface || iface === 'tcp://192.168.88.254' || iface === 'auto' || iface.includes('COM');
        if (isAutoDiscoverable) {
            // Try to discover a paired BT printer COM port
            const btPort = discoverBluetoothPrinterPort();
            if (btPort) {
                iface = btPort;
            } else if (!iface || iface === 'auto') {
                // Keep configured TCP address as last resort
                iface = 'tcp://192.168.88.254';
            }
        }

        const printerType = config.printer?.type === 'STAR' ? PrinterTypes.STAR : PrinterTypes.EPSON;

        const printerConfig = {
            type: printerType,
            interface: iface,
            characterSet: 'PC858_EURO',
            options: { timeout: config.printer?.timeout || 5000 }
        };

        logger.info(`[Printer] Initializing thermal printer. Interface: ${iface}, Type: ${config.printer?.type || 'EPSON'}`);

        const printer = new ThermalPrinter(printerConfig);

        logger.debug('[Printer] Checking if printer is connected...');
        const isConnected = await printer.isPrinterConnected();
        logger.info(`[Printer] Connection status: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`);

        if (!isConnected) {
            logger.warn('[Printer] Printer not responding to connection check — attempting print anyway (some BT drivers report false).');
        }

        // ── Build premium voucher receipt ─────────────────────────────────────────────
        const { BRAND } = require('./config');
        
        printer.alignCenter();
        printer.setTextSize(1, 1);
        printer.bold(true);
        printer.println(`${BRAND.emoji} ${BRAND.name.toUpperCase()} ${BRAND.emoji}`);
        printer.bold(false);
        printer.setTextNormal();
        printer.println(BRAND.tagline);
        printer.drawLine();
        
        printer.bold(true);
        printer.println('WIFI ACCESS VOUCHER');
        printer.bold(false);
        printer.newLine();
        
        printer.setTextSize(1, 1);
        printer.invert(true);
        printer.println(`  CODE: ${username}  `);
        printer.invert(false);
        printer.setTextNormal();
        printer.newLine();
        
        printer.leftRight('Plan:', profile);
        if (voucherData.expires) {
            printer.leftRight('Expires:', new Date(voucherData.expires).toLocaleDateString());
        }
        printer.drawLine();
        
        printer.alignCenter();
        printer.println('SCAN TO CONNECT');
        printer.printQR(loginUrl, {
            cellSize: 6,
            correction: 'M',
            model: 2
        });

        printer.newLine();
        printer.println('Thank you for choosing us!');
        printer.println(new Date().toLocaleString());
        printer.println('------------------------------');
        printer.cut();

        logger.debug(`[Printer] Executing print job for user: ${username}`);
        await printer.execute();
        logger.info(`[Printer] ✅ Voucher printed successfully for ${username} via ${iface}`);

        const qrDataURI = await QRCode.toDataURL(loginUrl);
        return { success: true, qrDataURI, interface: iface };

    } catch (e) {
        logger.error(`[Printer] ❌ Error printing voucher for ${voucherData?.username}: ${e.message}`);
        logger.debug(`[Printer] Stack trace: ${e.stack}`);
        if (e.code) logger.error(`[Printer] Error code: ${e.code}`);
        return { 
            success: false, 
            error: e.message, 
            code: e.code,
            stack: e.stack 
        };
    }
}

module.exports = { printVoucher, discoverBluetoothPrinterPort };
