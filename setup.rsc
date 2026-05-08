# ============================================
# Power Connect RB951 + Starlink Setup
# ============================================

# --------------------------------------------
# 1. SYSTEM IDENTITY & SECURITY BASELINE
# --------------------------------------------

/system identity set name="AgentOS-PowerConnect"

# Secure default services
/ip service set telnet disabled=yes
/ip service set ftp disabled=yes
/ip service set www port=80 disabled=no
/ip service set ssh port=2222 disabled=no
/ip service set www-ssl port=443 disabled=no
/ip service set api port=8728 disabled=no
/ip service set api-ssl port=8729 disabled=no
/ip service set winbox port=8291 disabled=no

# Strong admin password reminder (stored as note)
/system note set note="AgentOS PowerConnect\nChange: agentos-api-admin password after deploy\nSSH port: 2222\nAPI port: 8728"

# NTP — CRITICAL: scheduler-based expiry depends on accurate system time
/system ntp client set enabled=yes
/system ntp client servers add address=pool.ntp.org
/system ntp client servers add address=time.cloudflare.com
/system ntp client servers add address=time.google.com

# Watchdog — auto-reboot on network hang
/system watchdog set enabled=yes watch-address=1.1.1.1 watchdog-timer=5m

# --------------------------------------------
# 2. WAN (ether1 → Starlink)
# --------------------------------------------
/ip dhcp-client add interface=ether1 disabled=no use-peer-dns=yes use-peer-ntp=yes add-default-route=yes comment="Starlink WAN"

# Starlink-specific: Accept CGNAT range
/ip firewall address-list add list=starlink-cgnat address=100.64.0.0/10 comment="Starlink CGNAT"

# --------------------------------------------
# 3. LAN BRIDGE (ether2-5)
# --------------------------------------------

/interface bridge add name=bridge1 protocol-mode=rstp comment="LAN Bridge"
/interface bridge port add bridge=bridge1 interface=ether2
/interface bridge port add bridge=bridge1 interface=ether3
/interface bridge port add bridge=bridge1 interface=ether4
/interface bridge port add bridge=bridge1 interface=ether5

# Bridge IP
/ip address add address=192.168.88.1/24 interface=bridge1 comment="LAN Gateway"

# --------------------------------------------
# 4. DHCP SERVER
# --------------------------------------------

/ip pool add name=lan-pool ranges=192.168.88.10-192.168.88.254
/ip dhcp-server add name=lan-dhcp interface=bridge1 address-pool=lan-pool lease-time=1d disabled=no
/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1,1.1.1.1,8.8.8.8,9.9.9.9 domain=hotspot.local

# DNS with DoH fallback
/ip dns set allow-remote-requests=yes servers=1.1.1.1,8.8.8.8 verify-doh-cert=yes

# --------------------------------------------
# 5. NAT & MASQUERADE
# --------------------------------------------
/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade comment="LAN→WAN NAT"

# Hairpin NAT (for local services)
/ip firewall nat add chain=dstnat dst-address-type=local action=accept comment="Hairpin NAT"

# --------------------------------------------
# 6. FIREWALL (AgentOS)
# --------------------------------------------

# Address lists
/ip firewall address-list add list=admin-access address=192.168.88.0/24 comment="LAN Admin"
/ip firewall address-list add list=agentos-api address={{AGENTOS_IP}}/32 comment="API Access"

# Brute-force protection — rate-limit login attempts on API / SSH / Winbox
/ip firewall filter add chain=input protocol=tcp dst-port=8728,8729,2222,8291 connection-state=new src-address-list=brute-force-block action=drop comment="Block brute force"
/ip firewall filter add chain=input protocol=tcp dst-port=8728,8729,2222,8291 connection-state=new action=add-src-to-address-list address-list=brute-force-stage2 address-list-timeout=1m limit=5,30s:src-address comment="Rate limit stage 1"
/ip firewall filter add chain=input protocol=tcp dst-port=8728,8729,2222,8291 connection-state=new src-address-list=brute-force-stage2 action=add-src-to-address-list address-list=brute-force-block address-list-timeout=1d comment="Block after stage 1"

# Input chain
/ip firewall filter add chain=input connection-state=established,related action=accept comment="Accept established"
/ip firewall filter add chain=input connection-state=invalid action=drop comment="Drop invalid"
/ip firewall filter add chain=input in-interface=bridge1 action=accept comment="Accept LAN"
/ip firewall filter add chain=input in-interface=ether1 protocol=tcp dst-port=8291 src-address-list=admin-access action=accept comment="Winbox from LAN"
/ip firewall filter add chain=input in-interface=ether1 protocol=tcp dst-port=8728,8729 src-address-list=agentos-api action=accept comment="API access"
/ip firewall filter add chain=input in-interface=ether1 protocol=tcp dst-port=2222 src-address-list=admin-access action=accept comment="SSH from LAN only"
/ip firewall filter add chain=input in-interface=ether1 protocol=icmp action=accept comment="Allow ping"
/ip firewall filter add chain=input in-interface=ether1 action=drop comment="Drop WAN input"

# Forward chain
/ip firewall filter add chain=forward connection-state=established,related action=fasttrack-connection comment="Fasttrack"
/ip firewall filter add chain=forward connection-state=established,related action=accept comment="Accept established forward"
/ip firewall filter add chain=forward connection-state=invalid action=drop comment="Drop invalid forward"

# --------------------------------------------
# 7. HOTSPOT (Power Connect Captive Portal)
# --------------------------------------------

/ip hotspot profile add name=agentos hotspot-address=192.168.88.1 dns-name=hotspot.local html-directory=hotspot smtp-server=0.0.0.0 login-by=http-pap,http-chap,mac,cookie split-user-domain=no trial-uptime-reset=1d
/ip hotspot add name=hotspot1 interface=bridge1 profile=agentos addresses-per-mac=1 idle-timeout=15m keepalive-timeout=15m

# Walled Garden (AgentOS pattern: strict allowlist)

/ip hotspot walled-garden ip add dst-address=1.1.1.1 action=accept comment="Cloudflare DNS"
/ip hotspot walled-garden ip add dst-address=8.8.8.8 action=accept comment="Google DNS"
/ip hotspot walled-garden add dst-host="*.googleapis.com" action=allow comment="Firebase API"
/ip hotspot walled-garden add dst-host="*.firebaseio.com" action=allow comment="Firebase DB"
/ip hotspot walled-garden add dst-host="*.firebaseapp.com" action=allow comment="Firebase Hosting"
/ip hotspot walled-garden add dst-host="*.firebase.google.com" action=allow comment="Firebase Console"
/ip hotspot walled-garden add dst-host="*.stripe.com" action=allow comment="Stripe Payments"
/ip hotspot walled-garden add dst-host="*.paypal.com" action=allow comment="PayPal"
/ip hotspot walled-garden add dst-host="*.paystack.com" action=allow comment="Paystack"
/ip hotspot walled-garden add dst-host="hotspot.local" action=allow comment="Power Connect Portal"
/ip hotspot walled-garden add dst-host="*.com.powerconnect.zw" action=allow comment="Power Connect CDN"
/ip hotspot walled-garden add protocol=udp dst-port=53 action=allow comment="DNS"
/ip hotspot walled-garden add protocol=udp dst-port=123 action=allow comment="NTP"
/ip hotspot walled-garden add protocol=tcp dst-port=80,443 action=allow comment="HTTP/HTTPS"


# --------------------------------------------
# 8. USER PROFILES (Plan Tiers)
# --------------------------------------------
# Basic: 1 Hour / 10 Mbps / 2GB cap
/ip hotspot user profile add name=basic shared-users=1 rate-limit=10M/10M session-timeout=1h idle-timeout=15m keepalive-timeout=15m transfer-limit=2147483648 on-login=":log info \"[PLAN] Basic user $user logged in | MAC: $mac | IP: $address\"" on-logout=":log info \"[PLAN] Basic user $user logged out | Uptime: $uptime | Bytes: $bytes-in/$bytes-out\""

# Standard: 1 Day / 25 Mbps / 5GB cap
/ip hotspot user profile add name=standard shared-users=1 rate-limit=25M/25M session-timeout=4h idle-timeout=15m keepalive-timeout=15m transfer-limit=5368709120 on-login=":log info \"[PLAN] Standard user $user logged in | MAC: $mac | IP: $address\"" on-logout=":log info \"[PLAN] Standard user $user logged out | Uptime: $uptime | Bytes: $bytes-in/$bytes-out\""

# Premium: 30 Day / 50 Mbps / 20GB cap
/ip hotspot user profile add name=premium shared-users=1 rate-limit=50M/50M session-timeout=24h idle-timeout=15m keepalive-timeout=15m transfer-limit=21474836480 on-login=":log info \"[PLAN] Premium user $user logged in | MAC: $mac | IP: $address\"" on-logout=":log info \"[PLAN] Premium user $user logged out | Uptime: $uptime | Bytes: $bytes-in/$bytes-out\""

# Trial: 15 min / 2 Mbps / 100MB cap
/ip hotspot user profile add name=trial shared-users=1 rate-limit=2M/2M session-timeout=15m idle-timeout=5m keepalive-timeout=5m transfer-limit=104857600 on-login=":log info \"[TRIAL] Trial user $user logged in | MAC: $mac | IP: $address\"" on-logout=":log info \"[TRIAL] Trial user $user logged out | Uptime: $uptime | Bytes: $bytes-in/$bytes-out\""


# NOTE: 1Hour/1Day/7Day/30Day/trial profiles are defined below after queue types
# (trial is defined once in section 7 above — duplicate removed)

/system logging add topics=hotspot action=agentos-memory prefix="HOTSPOT"

/ip service set api disabled=no
# NOTE: agentos-api user uses agentos-admin group defined in section 10 below
# user creation moved to section 10 alongside group definitions

# --------------------------------------------
# 9. QUEUE MANAGEMENT (FQ-CODEL + Plan Tiers)
# --------------------------------------------
/queue type add name=fq-codel kind=fq-codel limit=10240 quantum=300
/queue type add name=pcq-down kind=pcq pcq-rate=0 pcq-limit=50KiB pcq-classifier=dst-address pcq-total-limit=2000KiB
/queue type add name=pcq-up kind=pcq pcq-rate=0 pcq-limit=50KiB pcq-classifier=src-address pcq-total-limit=2000KiB

# Global bandwidth pool (80% of Starlink typical)
/queue simple add name=total-wan target=192.168.88.0/24 max-limit=80M/20M queue=fq-codel/fq-codel comment="Total Starlink Pool"

# Per-profile queues (applied dynamically via API)
/queue simple add name=q-1Hour target=192.168.88.0/24 parent=total-wan max-limit=10M/10M queue=fq-codel/fq-codel comment="Basic Tier"
/queue simple add name=q-st target=192.168.88.0/24 parent=total-wan max-limit=25M/25M queue=fq-codel/fq-codel comment="Standard Tier"
/queue simple add name=q-premium target=192.168.88.0/24 parent=total-wan max-limit=50M/50M queue=fq-codel/fq-codel comment="Premium Tier"


# --------------------------------------------
# 10. API USER (AgentOS Pattern: Tiered Permissions)
# --------------------------------------------
# Admin tier (full access)
/user group add name=agentos-admin policy=local,read,write,test,api,rest-api,web,winbox,ssh,telnet,ftp,reboot,sniff,sensitive,romon,dude comment="Power Connect Admin"

# Operator tier (read + user management)
/user group add name=agentos-operator policy=local,read,write,test,api,rest-api,web comment="Power Connect Operator"

# Readonly tier (monitoring only)
/user group add name=agentos-readonly policy=local,read,api,rest-api,web comment="Power Connect Readonly"

# Create API users (CHANGE PASSWORDS!)
/user add name=agentos-api group=agentos-admin password="{{AGENTOS_API_PASSWORD}}" comment="API User"
/user add name=agentos-api-admin group=agentos-admin password="{{AGENTOS_ADMIN_PASSWORD}}" comment="Admin API User"
/user add name=agentos-api-operator group=agentos-operator password="{{AGENTOS_OPERATOR_PASSWORD}}" comment="Operator API User"
/user add name=agentos-api-readonly group=agentos-readonly password="{{AGENTOS_READONLY_PASSWORD}}" comment="Readonly API User"

# Plan profiles (defined here so queue types exist first)
/ip hotspot user profile add name=1Hour shared-users=1 rate-limit=10M/10M session-timeout=1h
/ip hotspot user profile add name=1Day shared-users=1 rate-limit=25M/25M session-timeout=24h
/ip hotspot user profile add name=7Day shared-users=1 rate-limit=50M/50M session-timeout=7d
/ip hotspot user profile add name=30Day shared-users=1 rate-limit=50M/50M session-timeout=30d


# --------------------------------------------
# 11. LOGGING & AUDIT TRAIL (AgentOS Pattern)
# --------------------------------------------
/system logging action add name=agentos-memory target=memory memory-lines=1000 memory-stop-on-full=no
/system logging action add name=agentos-disk target=disk disk-file-name=powerconnect disk-lines-per-file=10000 disk-file-count=5

/system logging add topics=hotspot action=agentos-memory prefix="[HOTSPOT]"
/system logging add topics=firewall action=agentos-memory prefix="[FIREWALL]"
/system logging add topics=critical action=agentos-memory prefix="[CRITICAL]"
/system logging add topics=error action=agentos-memory prefix="[ERROR]"
/system logging add topics=warning action=agentos-memory prefix="[WARN]"
/system logging add topics=system action=agentos-disk prefix="[SYSTEM]"
/system logging add topics=account action=agentos-disk prefix="[AUDIT]"

# --------------------------------------------
# 12. SENTINEL AGENT (Self-Monitoring Script)
# --------------------------------------------
/system script add name="sentinel-agent" source={
    :local wanOK false
    :local cpuLoad [/system resource get cpu-load]
    :local freeMem [/system resource get free-memory]
    :local totalMem [/system resource get total-memory]
    :local memPercent (($totalMem - $freeMem) * 100 / $totalMem)
    
    # Check WAN connectivity (as-value lets do/on-error detect failure)
    :do {
        :local pingResult [/ping address=1.1.1.1 count=2 as-value]
        :if (($pingResult->"received") > 0) do={
            :set wanOK true
        } else={
            :log warning "[SENTINEL] WAN ping failed (0 replies)"
        }
    } on-error={
        :set wanOK false
        :log warning "[SENTINEL] WAN connectivity lost"
    }
    
    # Check Starlink dish (if accessible)
    :if ($wanOK) do={
        :do {
            /tool fetch url="https://www.starlink.com" mode=https check-certificate=no
            :log info "[SENTINEL] Starlink check OK"
        } on-error={
            :log warning "[SENTINEL] Starlink web unreachable (CGNAT issue?)"
        }
    }
    
    # Memory alert
    :if ($memPercent > 85) do={
        :log warning "[SENTINEL] High memory usage: $memPercent%"
    }
    
    # CPU alert
    :if ($cpuLoad > 80) do={
        :log warning "[SENTINEL] High CPU load: $cpuLoad%"
    }
    
    # Hotspot health
    :local activeUsers [/ip hotspot active print count-only]
    :if ($activeUsers > 0) do={
        :log info "[SENTINEL] Active users: $activeUsers"
    }
    
    # Auto-cleanup expired sessions — only short-plan profiles (1Hour, basic, trial)
    # Long-plan users (1Day/7Day/30Day/premium) are managed by AgentOS reaper
    # Note: RouterOS ~ regex does not support | alternation; use separate conditions
    /ip hotspot active remove [find where uptime > "1h" && profile="1Hour"]
    /ip hotspot active remove [find where uptime > "1h" && profile="basic"]
    /ip hotspot active remove [find where uptime > "15m" && profile="trial"]
    
    :log info "[SENTINEL] Health check complete | CPU: $cpuLoad% | MEM: $memPercent% | WAN: $wanOK | Users: $activeUsers"
}

# Schedule sentinel every 2 minutes
/system scheduler add name="sentinel-run" interval=2m on-event="/system script run sentinel-agent" policy=read,write,test comment="Sentinel Agent Health Check"


# --------------------------------------------
# 13. VOUCHER GENERATOR (AgentOS Pattern)
# --------------------------------------------
/system script add name="voucher-gen" source={
    # Usage: /system script run voucher-gen
    # Pass named params via environment: :global vgPlan; :global vgCount
    :global vgPlan
    :global vgCount
    :local planName $vgPlan
    :local count $vgCount
    :if ([:typeof $count] = "nothing") do={ :set count 1 }
    :if ([:typeof $planName] = "nothing") do={
        :log error "[VOUCHER] vgPlan global not set"
        :return "ERROR: Set :global vgPlan before running"
    }
    
    :local plans {"1Hour"; "1Day"; "7Day"; "30Day"; "trial"}
    :local planFound false
    
    :foreach plan in=$plans do={
        :if ($plan = $planName) do={ :set planFound true }
    }
    
    :if (!$planFound) do={
        :log error "[VOUCHER] Invalid plan: $planName"
        :return "ERROR: Valid plans: 1Hour, 1Day, 7Day, 30Day, trial"
    }
    
    :local results ""
    :for i from=1 to=$count do={
        :local code [:pick ([/certificate scep-server otp generate minutes-valid=0 as-value]->"password") 0 8]
        :local username "V-$code"
        :local password [:pick ([/certificate scep-server otp generate minutes-valid=0 as-value]->"password") 0 12]
        :local timeNow [/system clock get time]
        
        /ip hotspot user add name=$username password=$password profile=$planName comment="Voucher $code | Generated: $timeNow" disabled=no
        
        :set results ($results . "$username:$password:$planName\n")
    }
    
    :log info "[VOUCHER] Generated $count $planName voucher(s)"
    :return $results
}

# --------------------------------------------
# 14. AUTO-SYNC SCRIPT (Firebase ↔ MikroTik)
# --------------------------------------------

/system script add name="agentos-sync" source={
    :local apiUrl "{{FIREBASE_URL}}/api/sync"
    :local apiKey "{{FIREBASE_API_KEY}}"
    
    # Fetch pending users from Firebase
    :do {
        :local fetchResult [/tool fetch url="$apiUrl/pending" mode=https http-header-field="Authorization: Bearer $apiKey" output=user as-value]
        :local status ($fetchResult->"status")
        
        :if ($status = "finished") do={
            :local data ($fetchResult->"data")
            :log info "[SYNC] Fetched pending users"
            
            # Parse and create users ( use JSON parser)
        }
    } on-error={
        :log error "[SYNC] Failed to fetch from Firebase"
    }
    
    # Upload current status
    :local activeCount [/ip hotspot active print count-only]
    :local totalUsers [/ip hotspot user print count-only]
    
    :do {
        /tool fetch url="$apiUrl/status" mode=https http-method=post http-header-field="Content-Type: application/json,Authorization: Bearer $apiKey" http-data="{\"router\":\"AgentOS\",\"activeUsers\":$activeCount,\"totalUsers\":$totalUsers,\"timestamp\":\"[/system clock get time]\"}" check-certificate=no
        :log info "[SYNC] Status uploaded"
    } on-error={
        :log error "[SYNC] Failed to upload status"
    }
}

/system scheduler add name="agentos-sync" interval=5m on-event="/system script run agentos-sync" policy=read,write,test,api comment="AgentOS Sync"

# --------------------------------------------
# 15. GRAPHING & MONITORING
# --------------------------------------------
/tool graphing interface add interface=ether1 store-on-disk=yes
/tool graphing interface add interface=bridge1 store-on-disk=yes
/tool graphing resource add store-on-disk=yes

# --------------------------------------------
# 16. BACKUP & EXPORT
# --------------------------------------------
# Backup with timestamp in filename via scheduler (can't use clock at import time)
/system backup save name=initial-config encryption=aes sha256 password={{BACKUP_PASSWORD}}
/export compact file=powerconnect-agentos-full

# Schedule weekly auto-backup
/system scheduler add name="weekly-backup" interval=7d on-event="/system backup save name=(\"agentos-backup-\" . [:pick [/system clock get date] 0 10]) encryption=aes sha256 password={{BACKUP_PASSWORD}}" policy=read,write,policy,test comment="Weekly auto-backup"

# --------------------------------------------
# 17. FINAL STATUS
# --------------------------------------------
:log info "========================================"
:log info "AgentOS PowerConnect Setup Complete"
:log info "RB951 + Starlink Backhaul"
:log info "========================================"
:log info "NTP: pool.ntp.org + time.cloudflare.com"
:log info "Watchdog: ACTIVE (watch 1.1.1.1, 5min)"
:log info "Brute-force protection: ACTIVE (API/SSH/Winbox)"
:log info "SSH port: 2222 (LAN-only)"
:log info "Sentinel Agent: ACTIVE (2min interval)"
:log info "AgentOS Sync: ACTIVE (5min interval)"
:log info "API Users: agentos-api-admin, agentos-api-operator, agentos-api-readonly"
:log info "Plans: 1Hour, 1Day, 7Day, 30Day, trial"
:log info "Weekly backup: SCHEDULED"
:log info "========================================"
:log info "ACTION REQUIRED: Change agentos-api-admin password!"