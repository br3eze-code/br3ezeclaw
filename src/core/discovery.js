'use strict';
const { logger } = require('./logger');

/**
 * DiscoveryService — Handles network exploration, IP scanning, 
 * and service detection across the MikroTik domain.
 */
class DiscoveryService {
    constructor(deps = {}) {
        this.mikrotik = deps.mikrotik;
    }

    /**
     * Scans an interface for active hosts using ARP and DHCP lease data.
     */
    async scanHosts(interfaceName = 'bridge') {
        if (!this.mikrotik) return [];
        try {
            const leases = await this.mikrotik.executeTool('dhcp.leases');
            const arp    = await this.mikrotik.executeTool('arp.table');
            
            // Merge data by MAC address
            const hosts = new Map();
            
            leases.forEach(l => {
                hosts.set(l['mac-address'], {
                    ip: l.address,
                    mac: l['mac-address'],
                    host: l['host-name'] || 'unknown',
                    status: 'leased',
                    lastSeen: l['last-seen'] || new Date().toISOString()
                });
            });

            arp.forEach(a => {
                const existing = hosts.get(a['mac-address']);
                if (existing) {
                    existing.interface = a.interface;
                    if (a.address !== existing.ip) {
                        existing.ip_alt = a.address; // IP conflict or multi-IP
                    }
                } else {
                    hosts.set(a['mac-address'], {
                        ip: a.address,
                        mac: a['mac-address'],
                        host: 'unknown',
                        status: 'active',
                        interface: a.interface
                    });
                }
            });

            return Array.from(hosts.values());
        } catch (error) {
            logger.error('Network discovery failed:', error);
            return [];
        }
    }

    /**
     * Calculates the network range from a CIDR string.
     */
    parseCIDR(cidr) {
        try {
            const [ip, mask] = cidr.split('/');
            const maskNum = parseInt(mask);
            return { ip, mask: maskNum, type: 'ipv4' };
        } catch (e) {
            return null;
        }
    }

    /**
     * Discovers Neighbor routers via MNDP/CDP.
     */
    async discoverNeighbors() {
        if (!this.mikrotik) return [];
        try {
            return await this.mikrotik.executeTool('system.neighbors');
        } catch (e) {
            logger.error('Neighbor discovery failed:', e);
            return [];
        }
    }
}

module.exports = DiscoveryService;
