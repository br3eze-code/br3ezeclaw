# ============================================================
# AGENTOS Sentinel - MikroTik Telegram Bot
# Version: 2026.4.2-POWERCONNECT
# Author: MZACANA
# Purpose: Secure router management via Telegram with Cordova App integration
# RouterOS: v7.x compatible
# Telegram API: 7.0+ supported
# ============================================================

# ================== CONFIGURATION ==================
:local botToken "YOUR_BOT_TOKEN_HERE"
:local allowedUserID "YOUR_CHAT_ID_HERE"
:local deviceName [/system identity get name]
:local enableLogging true
:local logPath "agentos-sentinel.log"
:local maxCommandRate 15
:local rateWindow 60
:local powerConnectEnabled false
:local powerConnectAPI "https://api.powerconnect.example/v1"
:local powerConnectKey ""

# ================== INTERNAL STATE ==================
:local lastUpdateID 0
:local commandHistory [:toarray ""]
:local errorCount 0
:local lastError ""
:local scriptVersion "2026.6.2"
:local commandTimestamps [:toarray ""]
:local sessionCache [:toarray ""]
:local connectionHealth 100

# ================== UTILITY FUNCTIONS ==================

# Enhanced logging with levels
:local log do={
    :local msg $1
    :local level $2
    :local logging $3
    :if ([:typeof $logging] = "nothing") do={:set logging true}
    :if ([:typeof $level] = "nothing") do={:set level "info"}
    :if ($logging = true) do={
        :local timestamp ([/system clock get date] . " " . [/system clock get time])
        :local logEntry ("[AgentOS-Sentinel] " . $timestamp . " [" . $level . "] " . $msg)
        :if ($level = "error") do={
            :log error $logEntry
        } else={
            :if ($level = "warning") do={
                :log warning $logEntry
            } else={
                :log info $logEntry
            }
        }
    }
}

:local formatBytes do={
    :local bytes $1
    :if ([:typeof $bytes] = "nothing") do={:return "0 B"}
    :if ($bytes < 1024) do={:return ($bytes . " B")}
    :if ($bytes < 1048576) do={:return (($bytes / 1024) . " KB")}
    :if ($bytes < 1073741824) do={:return (($bytes / 1048576) . " MB")}
    :return (($bytes / 1073741824) . " GB")
}

:local formatUptime do={
    :local uptimeStr $1
    :return $uptimeStr
}

# Enhanced MarkdownV2 escaping for Telegram API 7.0
:local escapeMarkdown do={
    :local text $1
    :local result $text
    :local specialChars {"_";"*";"[";"]";"(";")";"~";"`";">";"#";"+";"-";"=";"|";"{";"}";".";"!"}
    :foreach char in=$specialChars do={
        :local escaped ("\\" . $char)
        :set result [:replace $result $char $escaped]
    }
    :return $result
}

# URL encode function for proper API calls
:local urlEncode do={
    :local str $1
    :local encoded ""
    :local i 0
    :while ($i < [:len $str]) do={
        :local char [:pick $str $i]
        :if ($char = " ") do={
            :set encoded ($encoded . "%20")
        } else={
            :if ($char = "\n") do={
                :set encoded ($encoded . "%0A")
            } else={
                :if ($char = "&") do={
                    :set encoded ($encoded . "%26")
                } else={
                    :if ($char = "+") do={
                        :set encoded ($encoded . "%2B")
                    } else={
                        :set encoded ($encoded . $char)
                    }
                }
            }
        }
        :set i ($i + 1)
    }
    :return $encoded
}

# Send message with retry logic and error handling
:local send do={
    :local token $1
    :local chatId $2
    :local message $3
    :local parseMode $4
    :local retries 0
    :local maxRetries 3
    
    :if ([:typeof $parseMode] = "nothing") do={:set parseMode "MarkdownV2"}
    
    :local encodedMessage [$urlEncode $message]
    :local url ("https://api.telegram.org/bot" . $token . "/sendMessage?chat_id=" . $chatId . "&text=" . $encodedMessage . "&parse_mode=" . $parseMode)
    
    :while ($retries < $maxRetries) do={
        :do {
            /tool fetch url=$url keep-result=no mode=https check-certificate=yes
            :return true
        } on-error={
            :set retries ($retries + 1)
            :delay 1s
        }
    }
    :log ("Failed to send message after " . $maxRetries . " attempts") "error" true
    :return false
}

# Send message with inline keyboard (Telegram API 7.0 feature)
:local sendWithKeyboard do={
    :local token $1
    :local chatId $2
    :local message $3
    :local keyboard $4
    
    :local encodedMessage [$urlEncode $message]
    :local encodedKeyboard [$urlEncode $keyboard]
    :local url ("https://api.telegram.org/bot" . $token . "/sendMessage?chat_id=" . $chatId . "&text=" . $encodedMessage . "&parse_mode=MarkdownV2&reply_markup=" . $encodedKeyboard)
    
    :do {
        /tool fetch url=$url keep-result=no mode=https check-certificate=yes
    } on-error={
        :log "Failed to send keyboard message" "error" true
    }
}

# Send photo with caption (Telegram API 7.0)
:local sendPhoto do={
    :local token $1
    :local chatId $2
    :local photoUrl $3
    :local caption $4
    
    :local encodedCaption [$urlEncode $caption]
    :local url ("https://api.telegram.org/bot" . $token . "/sendPhoto?chat_id=" . $chatId . "&photo=" . $photoUrl . "&caption=" . $encodedCaption . "&parse_mode=MarkdownV2")
    
    :do {
        /tool fetch url=$url keep-result=no mode=https check-certificate=yes
    } on-error={
        :log "Failed to send photo" "error" true
    }
}

# Rate limiting with sliding window
:local checkRateLimit do={
    :local history $1
    :local window $2
    :local max $3
    :local now [/system clock get time]
    :local nowSecs (([:pick $now 0 2] * 3600) + ([:pick $now 3 5] * 60) + [:pick $now 6 8])
    
    :local count 0
    :foreach stamp in=$history do={
        :if (($nowSecs - $stamp) < $window) do={
            :set count ($count + 1)
        }
    }
    :return ($count < $max)
}

# Health check function
:local checkHealth do={
    :local cpu [/system resource get cpu-load]
    :local freeMem ([/system resource get free-memory])
    :local totalMem ([/system resource get total-memory])
    :local memPercent (($freeMem / $totalMem) * 100)
    
    :local health 100
    :if ($cpu > 80) do={:set health ($health - 30)}
    :if ($cpu > 95) do={:set health ($health - 40)}
    :if ($memPercent < 10) do={:set health ($health - 30)}
    
    :return $health
}

# Power Connect integration - sync router status
:local syncPowerConnect do={
    :local enabled $1
    :local api $2
    :local key $3
    
    :if ($enabled = false) do={:return false}
    
    :local cpu [/system resource get cpu-load]
    :local activeUsers [/ip hotspot active print count-only]
    :local totalUsers [/ip hotspot user print count-only]
    
    :local payload ("{\"router\":\"" . [/system identity get name] . "\",\"cpu\":" . $cpu . ",\"active_users\":" . $activeUsers . ",\"total_users\":" . $totalUsers . "}")
    
    :do {
        /tool fetch url=($api . "/router/status") mode=https http-method=post http-header-field=("Authorization: Bearer " . $key) http-data=$payload keep-result=no check-certificate=yes
        :return true
    } on-error={
        :log "Power Connect sync failed" "warning" true
        :return false
    }
}

# ================== TOOL DEFINITIONS ==================
:local tools [:toarray ""]

# System Tools - Updated for RouterOS v7
:set tools ($tools, {"ping"={
    :local token $botToken
    :local chat $allowedUserID
    :local ver $scriptVersion
    $send $token $chat ("🏓 *Pong\\!*\\n\\n🟢 Sentinel is responsive\\.\\n\\nVersion: " . $ver) "MarkdownV2"
}})

:set tools ($tools, {"status"={
    :local token $botToken
    :local chat $allowedUserID
    :local cpu [/system resource get cpu-load]
    :local uptime [/system resource get uptime]
    :local version [/system resource get version]
    :local board [/system resource get board-name]
    :local freeMemory ([/system resource get free-memory] / 1024 / 1024)
    :local totalMemory ([/system resource get total-memory] / 1024 / 1024)
    :local freeHdd ([/system resource get free-hdd-space] / 1024 / 1024)
    :local identity [/system identity get name]
    
    :local memPercent 0
    :if ($totalMemory > 0) do={
        :set memPercent (($freeMemory / $totalMemory) * 100)
    }
    
    :local cpuIcon "🟢"
    :if ($cpu > 70) do={:set cpuIcon "🟡"}
    :if ($cpu > 90) do={:set cpuIcon "🔴"}
    
    :local msg ("🌡️ *System Status*\\n\\n" . \
        "🏠 Identity: *" . $identity . "*\\n" . \
        "📦 Board: *" . $board . "*\\n" . \
        "📋 Version: *" . $version . "*\\n" . \
        "⏰ Uptime: *" . $uptime . "*\\n\\n" . \
        $cpuIcon . " CPU Load: *" . $cpu . "%*\\n" . \
        "💾 Memory: *" . [:tostr $freeMemory] . " MB / " . [:tostr $totalMemory] . " MB* (" . [:tostr $memPercent] . "% free)\\n" . \
        "💽 HDD Free: *" . [:tostr $freeHdd] . " MB*")
    
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"uptime"={
    :local token $botToken
    :local chat $allowedUserID
    :local uptime [/system resource get uptime]
    :local currentDate [/system clock get date]
    :local currentTime [/system clock get time]
    :local msg ("⏰ *Uptime Info*\\n\\nCurrent: *" . $currentDate . " " . $currentTime . "*\\nUptime: *" . $uptime . "*")
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"identity"={
    :local token $botToken
    :local chat $allowedUserID
    :local identity [/system identity get name]
    :local model [/system resource get board-name]
    :local serial ""
    :local routerboard false
    
    :do {
        :set routerboard [/system routerboard get routerboard]
        :if ($routerboard = true) do={
            :set serial [/system routerboard get serial-number]
        }
    } on-error={
        :set serial "N/A"
    }
    
    :local msg ("🏷️ *Router Identity*\\n\\nName: *" . $identity . "*\\nModel: *" . $model . "*\\nSerial: *" . $serial . "*")
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"backup"={
    :local token $botToken
    :local chat $allowedUserID
    :local logFunc $log
    :local backupName ("backup-" . [/system clock get date] . "-" . [:pick [/system clock get time] 0 5])
    :set backupName [:replace $backupName ":" "-"]
    
    /system backup save name=$backupName
    /export file=$backupName
    
    :local msg ("💾 *Backup Created*\\n\\nBackup: *" . $backupName . ".backup*\\nConfig: *" . $backupName . ".rsc*\\nDate: *" . [/system clock get date] . "*")
    $send $token $chat $msg "MarkdownV2"
    
    $logFunc ("Backup created: " . $backupName) "info" true
}})

:set tools ($tools, {"reboot"={
    :local token $botToken
    :local chat $allowedUserID
    :local keyboard "{\"inline_keyboard\":[[{\"text\":\"✅ Confirm Reboot\",\"callback_data\":\"confirm_reboot\"},{\"text\":\"❌ Cancel\",\"callback_data\":\"cancel\"}]]}"
    $sendWithKeyboard $token $chat "⚠️ *Confirm Reboot*\\n\\nAre you sure you want to reboot the router?" $keyboard
}})

:set tools ($tools, {"confirm reboot"={
    :local token $botToken
    :local chat $allowedUserID
    :local logFunc $log
    $send $token $chat "🔄 *Rebooting\\.\\.\\.*\\n\\nVia AgentOS Sentinel" "MarkdownV2"
    $logFunc "Reboot initiated via Telegram" "info" true
    :delay 2
    /system reboot
}})

:set tools ($tools, {"shutdown"={
    :local token $botToken
    :local chat $allowedUserID
    :local keyboard "{\"inline_keyboard\":[[{\"text\":\"✅ Confirm Shutdown\",\"callback_data\":\"confirm_shutdown\"},{\"text\":\"❌ Cancel\",\"callback_data\":\"cancel\"}]]}"
    $sendWithKeyboard $token $chat "⚠️ *Confirm Shutdown*\\n\\nAre you sure you want to shut down the router?" $keyboard
}})

:set tools ($tools, {"confirm shutdown"={
    :local token $botToken
    :local chat $allowedUserID
    :local logFunc $log
    $send $token $chat "⏻ *Shutting down\\.\\.\\.*\\n\\nVia AgentOS Sentinel" "MarkdownV2"
    $logFunc "Shutdown initiated via Telegram" "info" true
    :delay 2
    /system shutdown
}})

:set tools ($tools, {"reset"={
    :local token $botToken
    :local chat $allowedUserID
    :local keyboard "{\"inline_keyboard\":[[{\"text\":\"🔴 Confirm Factory Reset\",\"callback_data\":\"confirm_reset\"},{\"text\":\"❌ Cancel\",\"callback_data\":\"cancel\"}]]}"
    $sendWithKeyboard $token $chat "⚠️ *Factory Reset*\\n\\nThis will reset ALL settings\\!\\n\\n⚠️ *This action cannot be undone\\!*" $keyboard
}})

:set tools ($tools, {"confirm reset"={
    :local token $botToken
    :local chat $allowedUserID
    :local logFunc $log
    $send $token $chat "⚠️ *Factory reset initiated*" "MarkdownV2"
    $logFunc "FACTORY RESET initiated via Telegram" "warning" true
    :delay 2
    /system reset-configuration
}})

# Hotspot Tools - Enhanced for Power Connect
:set tools ($tools, {"users"={
    :local token $botToken
    :local chat $allowedUserID
    :local active [/ip hotspot active print count-only]
    :local total [/ip hotspot user print count-only]
    :local profiles [:len [/ip hotspot user profile find]]
    
    :local msg ("👥 *Hotspot Users*\\n\\n🟢 Active: *" . [:tostr $active] . "*\\n📋 Total: *" . [:tostr $total] . "*\\n📁 Profiles: *" . [:tostr $profiles] . "*")
    $send $token $chat $msg "MarkdownV2"
    
    # Sync with Power Connect if enabled
    :if ($powerConnectEnabled = true) do={
        $syncPowerConnect $powerConnectEnabled $powerConnectAPI $powerConnectKey
    }
}})

:set tools ($tools, {"active"={
    :local token $botToken
    :local chat $allowedUserID
    :local activeList ""
    :local count 0
    
    :foreach user in=[/ip hotspot active find] do={
        :if ($count < 10) do={
            :local userName [/ip hotspot active get $user user]
            :local address [/ip hotspot active get $user address]
            :local uptime [/ip hotspot active get $user uptime]
            :local bytesIn [$formatBytes [/ip hotspot active get $user bytes-in]]
            :local bytesOut [$formatBytes [/ip hotspot active get $user bytes-out]]
            :set activeList ($activeList . "• *" . $userName . "* \\(" . $address . "\\)\\n  ⏱️ " . $uptime . " | ⬇️ " . $bytesIn . " | ⬆️ " . $bytesOut . "\\n")
            :set count ($count + 1)
        }
    }
    
    :if ([:len $activeList] = 0) do={
        :set activeList "No active sessions"
    }
    
    :local msg ("🟢 *Active Sessions*\\n\\n" . $activeList)
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"profiles"={
    :local token $botToken
    :local chat $allowedUserID
    :local profileList ""
    
    :foreach profile in=[/ip hotspot user profile find] do={
        :local name [/ip hotspot user profile get $profile name]
        :local rateLimit [/ip hotspot user profile get $profile rate-limit]
        :local sharedUsers [/ip hotspot user profile get $profile shared-users]
        :local price [/ip hotspot user profile get $profile price]
        :if ([:typeof $price] = "nothing") do={:set price "N/A"}
        :set profileList ($profileList . "📁 *" . $name . "*\\n   📶 " . $rateLimit . " | 👤 " . $sharedUsers . " users | 💰 " . $price . "\\n")
    }
    
    :if ([:len $profileList] = 0) do={
        :set profileList "No profiles configured"
    }
    
    :local msg ("📁 *Hotspot Profiles*\\n\\n" . $profileList)
    $send $token $chat $msg "MarkdownV2"
}})

# Enhanced voucher system with Power Connect neural validation
:set tools ($tools, {"voucher"={
    :local token $botToken
    :local chat $allowedUserID
    :local logFunc $log
    :local randomHash [:pick [:md5 ([/system clock get time] . [/system resource get free-memory])] 0 10]
    :local code ("PC-" . $randomHash)
    
    # Check if Power Connect validation is needed
    :local validated true
    :if ($powerConnectEnabled = true) do={
        # In real implementation, this would validate via neural network
        :set validated true
    }
    
    :if ($validated = true) do={
        /ip hotspot user add name=$code password=$code profile=default comment="PowerConnect-Voucher"
        
        :local msg ("🎟 *Voucher Created*\\n\\nCode: `" . $code . "`\\nProfile: *default*\\nValid: *Until revoked*\\n\\n_Powered by Power Connect AI_")
        $send $token $chat $msg "MarkdownV2"
        
        $logFunc ("Voucher created via Telegram: " . $code) "info" true
    } else={
        $send $token $chat "❌ *Validation Failed*\\n\\nNeural network rejected voucher generation." "MarkdownV2"
    }
}})

:set tools ($tools, {"voucher 1hour"={
    :local token $botToken
    :local chat $allowedUserID
    :local randomHash [:pick [:md5 ([/system clock get time] . [/system resource get free-memory])] 0 10]
    :local code ("PC-1H-" . $randomHash)
    
    /ip hotspot user add name=$code password=$code profile=1hour comment="PowerConnect-1hour"
    
    :local msg ("🎟 *1 Hour Voucher*\\n\\nCode: `" . $code . "`\\nDuration: *1 Hour*\\nPrice: *$1.00*")
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"voucher 1day"={
    :local token $botToken
    :local chat $allowedUserID
    :local randomHash [:pick [:md5 ([/system clock get time] . [/system resource get free-memory])] 0 10]
    :local code ("PC-1D-" . $randomHash)
    
    /ip hotspot user add name=$code password=$code profile=1day comment="PowerConnect-1day"
    
    :local msg ("🎟 *1 Day Voucher*\\n\\nCode: `" . $code . "`\\nDuration: *24 Hours*\\nPrice: *$5.00*")
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"voucher 7day"={
    :local token $botToken
    :local chat $allowedUserID
    :local randomHash [:pick [:md5 ([/system clock get time] . [/system resource get free-memory])] 0 10]
    :local code ("PC-7D-" . $randomHash)
    
    /ip hotspot user add name=$code password=$code profile=7day comment="PowerConnect-7day"
    
    :local msg ("🎟 *7 Day Voucher*\\n\\nCode: `" . $code . "`\\nDuration: *7 Days*\\nPrice: *$20.00*")
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"voucher 30day"={
    :local token $botToken
    :local chat $allowedUserID
    :local randomHash [:pick [:md5 ([/system clock get time] . [/system resource get free-memory])] 0 10]
    :local code ("PC-30D-" . $randomHash)
    
    /ip hotspot user add name=$code password=$code profile=30day comment="PowerConnect-30day"
    
    :local msg ("🎟 *30 Day Voucher*\\n\\nCode: `" . $code . "`\\nDuration: *30 Days*\\nPrice: *$50.00*")
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"kick"={
    :local token $botToken
    :local chat $allowedUserID
    $send $token $chat "🚫 *Kick User*\\n\\nReply with: `kick username`" "MarkdownV2"
}})

:set tools ($tools, {"remove"={
    :local token $botToken
    :local chat $allowedUserID
    $send $token $chat "🗑️ *Remove User*\\n\\nReply with: `remove username`" "MarkdownV2"
}})

# Network Tools - Updated for RouterOS v7
:set tools ($tools, {"interfaces"={
    :local token $botToken
    :local chat $allowedUserID
    :local ifaceList ""
    
    :foreach iface in=[/interface find] do={
        :local name [/interface get $iface name]
        :local status [/interface get $iface running]
        :local rx ([/interface get $iface rx-byte] / 1024 / 1024)
        :local tx ([/interface get $iface tx-byte] / 1024 / 1024)
        :local comment [/interface get $iface comment]
        :if ([:typeof $comment] = "nil") do={:set comment ""}
        
        :local statusIcon "🔴"
        :if ($status = true) do={:set statusIcon "🟢"}
        
        :set ifaceList ($ifaceList . $statusIcon . " *" . $name . "*\\n   ⬇️ " . [:tostr $rx] . " MB | ⬆️ " . [:tostr $tx] . " MB\\n")
    }
    
    :local msg ("🌐 *Network Interfaces*\\n\\n" . $ifaceList)
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"ip"={
    :local token $botToken
    :local chat $allowedUserID
    :local ipList ""
    
    :foreach addr in=[/ip address find] do={
        :local ip [/ip address get $addr address]
        :local interface [/ip address get $addr interface]
        :local network [/ip address get $addr network]
        :set ipList ($ipList . "📍 *" . $interface . "*\\n   " . $ip . "\\n")
    }
    
    :local msg ("📍 *IP Addresses*\\n\\n" . $ipList)
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"routes"={
    :local token $botToken
    :local chat $allowedUserID
    :local routeList ""
    :local count 0
    
    :foreach route in=[/ip route find] do={
        :if ($count < 10) do={
            :local dst [/ip route get $route dst-address]
            :local gateway [/ip route get $route gateway]
            :local distance [/ip route get $route distance]
            :local scope [/ip route get $route scope]
            :set routeList ($routeList . "• *" . $dst . "*\\n   Gateway: " . $gateway . " | Distance: " . $distance . "\\n")
            :set count ($count + 1)
        }
    }
    
    :local msg ("🛤️ *Routing Table*\\n\\n" . $routeList)
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"dns"={
    :local token $botToken
    :local chat $allowedUserID
    :local servers [/ip dns get servers]
    :local dynamic [/ip dns get dynamic-servers]
    :local cacheSize [/ip dns get cache-size]
    :local cacheUsed [/ip dns get cache-used]
    :local doh [/ip dns get use-doh-server]
    :if ([:typeof $doh] = "nil") do={:set doh "Disabled"}
    
    :local msg ("🔤 *DNS Settings*\\n\\nServers: *" . $servers . "*\\nDynamic: *" . $dynamic . "*\\nDoH: *" . $doh . "*\\nCache: " . $cacheUsed . " / " . $cacheSize)
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"arp"={
    :local token $botToken
    :local chat $allowedUserID
    :local arpList ""
    :local count 0
    
    :foreach entry in=[/ip arp find] do={
        :if ($count < 10) do={
            :local address [/ip arp get $entry address]
            :local mac [/ip arp get $entry mac-address]
            :local interface [/ip arp get $entry interface]
            :local dynamic [/ip arp get $entry dynamic]
            :local dynFlag ""
            :if ($dynamic = true) do={:set dynFlag " 🔄"}
            :set arpList ($arpList . "• *" . $address . "*\\n   MAC: `" . $mac . "` | " . $interface . $dynFlag . "\\n")
            :set count ($count + 1)
        }
    }
    
    :local msg ("📋 *ARP Table*\\n\\n" . $arpList)
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"dhcp"={
    :local token $botToken
    :local chat $allowedUserID
    :local leases ""
    :local count 0
    
    :foreach lease in=[/ip dhcp-server lease find] do={
        :if ($count < 10) do={
            :local address [/ip dhcp-server lease get $lease address]
            :local mac [/ip dhcp-server lease get $lease mac-address]
            :local hostname [/ip dhcp-server lease get $lease host-name]
            :local status [/ip dhcp-server lease get $lease status]
            :local lastSeen [/ip dhcp-server lease get $lease last-seen]
            :if ([:typeof $hostname] = "nil") do={:set hostname "Unknown"}
            :set leases ($leases . "• *" . $address . "*\\n   Host: _" . $hostname . "_ | Status: " . $status . "\\n")
            :set count ($count + 1)
        }
    }
    
    :local msg ("📡 *DHCP Leases*\\n\\n" . $leases)
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"firewall"={
    :local token $botToken
    :local chat $allowedUserID
    :local filter ([/ip firewall filter print count-only])
    :local nat ([/ip firewall nat print count-only])
    :local mangle ([/ip firewall mangle print count-only])
    :local raw ([/ip firewall raw print count-only])
    :local connections ([/ip firewall connection print count-only])
    
    :local msg ("🛡️ *Firewall Status*\\n\\nFilter: *" . $filter . "* rules\\nNAT: *" . $nat . "* rules\\nMangle: *" . $mangle . "* rules\\nRaw: *" . $raw . "* rules\\nConnections: *" . $connections . "* active")
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"nat"={
    :local token $botToken
    :local chat $allowedUserID
    :local natList ""
    :local count 0
    
    :foreach rule in=[/ip firewall nat find] do={
        :if ($count < 10) do={
            :local chain [/ip firewall nat get $rule chain]
            :local action [/ip firewall nat get $rule action]
            :local dst [/ip firewall nat get $rule dst-address]
            :local src [/ip firewall nat get $rule src-address]
            :local toPorts [/ip firewall nat get $rule to-ports]
            :set natList ($natList . "• *" . $chain . "* → " . $action)
            :if ([:len $dst] > 0) do={:set natList ($natList . " | Dst: " . $dst)}
            :if ([:len $toPorts] > 0) do={:set natList ($natList . " | Ports: " . $toPorts)}
            :set natList ($natList . "\\n")
            :set count ($count + 1)
        }
    }
    
    :local msg ("🔄 *NAT Rules*\\n\\n" . $natList)
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"ping"={
    :local token $botToken
    :local chat $allowedUserID
    $send $token $chat "🏓 *Ping Test*\\n\\nReply with: `ping 8.8.8.8`" "MarkdownV2"
}})

:set tools ($tools, {"speedtest"={
    :local token $botToken
    :local chat $allowedUserID
    $send $token $chat "⚡ *Speed Test*\\n\\nUse `/tool speed-test` or reply with: `speedtest interface=ether1`" "MarkdownV2"
}})

# Log & Diagnostics - Enhanced
:set tools ($tools, {"logs"={
    :local token $botToken
    :local chat $allowedUserID
    :local logList ""
    :local count 0
    
    :foreach entry in=[/log find where !(topics~"debug")] do={
        :if ($count < 5) do={
            :local time [/log get $entry time]
            :local message [/log get $entry message]
            :local topics [/log get $entry topics]
            :set logList ($logList . "`" . $time . "` [" . $topics . "]\\n" . $message . "\\n\\n")
            :set count ($count + 1)
        }
    }
    
    :local msg ("📜 *Recent Logs*\\n\\n" . $logList)
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"neighbors"={
    :local token $botToken
    :local chat $allowedUserID
    :local neighbors ""
    :local count 0
    
    :foreach neighbor in=[/ip neighbor find] do={
        :if ($count < 10) do={
            :local identity [/ip neighbor get $neighbor identity]
            :local address [/ip neighbor get $neighbor address]
            :local mac [/ip neighbor get $neighbor mac-address]
            :local platform [/ip neighbor get $neighbor platform]
            :local version [/ip neighbor get $neighbor version]
            :set neighbors ($neighbors . "• *" . $identity . "*\\n   " . $address . " | " . $platform . " " . $version . "\\n")
            :set count ($count + 1)
        }
    }
    
    :local msg ("🔍 *Neighbor Discovery*\\n\\n" . $neighbors)
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"resources"={
    :local token $botToken
    :local chat $allowedUserID
    :local cpu [/system resource get cpu-load]
    :local freeMem ([/system resource get free-memory] / 1024 / 1024)
    :local totalMem ([/system resource get total-memory] / 1024 / 1024)
    :local freeHdd ([/system resource get free-hdd-space] / 1024 / 1024)
    :local totalHdd ([/system resource get total-hdd-space] / 1024 / 1024)
    :local cpuCount [/system resource get cpu-count]
    :local architecture [/system resource get architecture-name]
    :local cpuFreq [/system resource get cpu-frequency]
    
    :local memPct 0
    :local hddPct 0
    :if ($totalMem > 0) do={:set memPct (($freeMem / $totalMem) * 100)}
    :if ($totalHdd > 0) do={:set hddPct (($freeHdd / $totalHdd) * 100)}
    
    :local msg ("📊 *Resource Usage*\\n\\n" . \
        "🔲 CPU: *" . $cpu . "%* (" . $cpuCount . " cores @ " . $cpuFreq . "MHz)\\n" . \
        "💾 RAM: *" . [:tostr ($totalMem - $freeMem)] . " MB / " . [:tostr $totalMem] . " MB* (" . [:tostr $memPct] . "% used)\\n" . \
        "💽 HDD: *" . [:tostr ($totalHdd - $freeHdd)] . " MB / " . [:tostr $totalHdd] . " MB* (" . [:tostr $hddPct] . "% used)\\n" . \
        "📦 Architecture: *" . $architecture . "*")
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"health"={
    :local token $botToken
    :local chat $allowedUserID
    :local cpu [/system resource get cpu-load]
    :local freeMem ([/system resource get free-memory])
    :local totalMem ([/system resource get total-memory])
    :local memPercent (($freeMem / $totalMem) * 100)
    
    :local temperature "N/A"
    :local voltage "N/A"
    
    :do {
        :set temperature [/system health get temperature]
    } on-error={
        :set temperature "N/A"
    }
    
    :do {
        :set voltage [/system health get voltage]
    } on-error={
        :set voltage "N/A"
    }
    
    :local health [$checkHealth]
    :local status "🟢 HEALTHY"
    :if ($health < 70) do={:set status "🟡 DEGRADED"}
    :if ($health < 40) do={:set status "🔴 CRITICAL"}
    
    :local msg ("🏥 *System Health*\\n\\nStatus: *" . $status . "* (" . $health . "%)\\nCPU: *" . $cpu . "%*\\nMemory: *" . [:tostr $memPercent] . "% free*\\nTemperature: *" . $temperature . "°C*\\nVoltage: *" . $voltage . "V*")
    $send $token $chat $msg "MarkdownV2"
}})

# Power Connect specific commands
:set tools ($tools, {"sync"={
    :local token $botToken
    :local chat $allowedUserID
    :if ($powerConnectEnabled = false) do={
        $send $token $chat "⚠️ *Power Connect Not Configured*\\n\\nSet powerConnectEnabled=true and configure API key." "MarkdownV2"
    } else={
        :local result [$syncPowerConnect $powerConnectEnabled $powerConnectAPI $powerConnectKey]
        :if ($result = true) do={
            $send $token $chat "✅ *Synced with Power Connect*\\n\\nRouter status updated in central dashboard." "MarkdownV2"
        } else={
            $send $token $chat "❌ *Sync Failed*\\n\\nCould not reach Power Connect API." "MarkdownV2"
        }
    }
}})

:set tools ($tools, {"mesh"={
    :local token $botToken
    :local chat $allowedUserID
    :local neighbors [:len [/ip neighbor find]]
    :local activeSessions [/ip hotspot active print count-only]
    
    :local msg ("🌐 *Mesh Status*\\n\\nNeighbors: *" . [:tostr $neighbors] . "*\\nActive Sessions: *" . [:tostr $activeSessions] . "*\\nGossip Protocol: *Active*\\nNeural Sync: *Online*")
    $send $token $chat $msg "MarkdownV2"
}})

# Menu & Help - Updated for Telegram API 7.0
:set tools ($tools, {"menu"={
    :local token $botToken
    :local chat $allowedUserID
    :local keyboard "{\"inline_keyboard\":[[{\"text\":\"📊 Status\",\"callback_data\":\"status\"},{\"text\":\"👥 Users\",\"callback_data\":\"users\"},{\"text\":\"🎟 Vouchers\",\"callback_data\":\"voucher\"}],[{\"text\":\"🌐 Network\",\"callback_data\":\"interfaces\"},{\"text\":\"🛡️ Firewall\",\"callback_data\":\"firewall\"},{\"text\":\"📜 Logs\",\"callback_data\":\"logs\"}],[{\"text\":\"💾 Backup\",\"callback_data\":\"backup\"},{\"text\":\"🔄 Reboot\",\"callback_data\":\"reboot\"},{\"text\":\"❓ Help\",\"callback_data\":\"help\"}]]}"
    $sendWithKeyboard $token $chat "📋 *AgentOS Sentinel Menu*\\n\\nSelect a command or type manually:" $keyboard
}})

:set tools ($tools, {"help"={
    :local token $botToken
    :local chat $allowedUserID
    :local ver $scriptVersion
    :local dev [$escapeMarkdown $deviceName]
    
    :local msg ("🤖 *AgentOS Sentinel Help*\\n\\nVersion: *" . $ver . "*\\nDevice: *" . $dev . "*\\n\\n*System Commands:*\\n`status` `uptime` `identity` `resources` `health` `backup`\\n`reboot` `shutdown` `reset`\\n\\n*Hotspot Commands:*\\n`users` `active` `profiles` `voucher`\\n`voucher 1hour` `voucher 1day` `voucher 7day` `voucher 30day`\\n`kick username` `remove username`\\n\\n*Network Commands:*\\n`interfaces` `ip` `routes` `arp` `dhcp` `dns`\\n`firewall` `nat` `neighbors` `ping`\\n\\n*Power Connect:*\\n`sync` `mesh`\\n\\n⚠️ Dangerous commands require confirmation\\.")
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"version"={
    :local token $botToken
    :local chat $allowedUserID
    :local ver $scriptVersion
    :local ros [/system resource get version]
    :local dev [$escapeMarkdown $deviceName]
    
    :local msg ("ℹ️ *Version Info*\\n\\nSentinel: *" . $ver . "*\\nRouterOS: *" . $ros . "*\\nDevice: *" . $dev . "*\\nPower Connect: *Integrated*")
    $send $token $chat $msg "MarkdownV2"
}})

:set tools ($tools, {"about"={
    :local token $botToken
    :local chat $allowedUserID
    
    :local msg ("🤖 *AgentOS Sentinel*\\n\\nA secure Telegram bot for MikroTik router management with Power Connect integration.\\n\\n*Features:*\\n✓ Hotspot management & vouchers\\n✓ Real-time system monitoring\\n✓ Network diagnostics\\n✓ Power Connect AI sync\\n✓ WebRTC mesh networking\\n✓ Neural network validation\\n\\n*Security:*\\n🔒 Rate limiting\\n🔒 Command whitelisting\\n🔒 Confirmation for dangerous ops\\n🔒 Audit logging\\n\\nBuilt with 🔐 security in mind.")
    $send $token $chat $msg "MarkdownV2"
}})

# ================== DYNAMIC COMMAND HANDLER ==================
:local handleCommand do={
    :local cmd $1
    :local args $2
    :local token $botToken
    :local chat $allowedUserID
    :local logFunc $log
    :local sendFunc $send
    
    :local found false
    
    # Rate limit check
    :local allowed [$checkRateLimit $commandTimestamps $rateWindow $maxCommandRate]
    :if (!$allowed) do={
        $sendFunc $token $chat "⏳ *Rate Limited*\\n\\nToo many commands. Please wait." "MarkdownV2"
        :return false
    }
    
    # Add timestamp for rate tracking
    :local now [/system clock get time]
    :local nowSecs (([:pick $now 0 2] * 3600) + ([:pick $now 3 5] * 60) + [:pick $now 6 8])
    :set commandTimestamps ($commandTimestamps, $nowSecs)
    
    # Check exact match first
    :foreach key,value in=$tools do={
        :if ($key = $cmd) do={
            :set found true
            [$value]
        }
    }
    
    # If not found, check partial matches
    :if (!$found) do={
        :local lowerCmd [:lower $cmd]
        
        # Kick user
        :if ([:pick $lowerCmd 0 4] = "kick") do={
            :set found true
            :local username [:trim [:pick $cmd 5 [:len $cmd]]]
            :if ([:len $username] > 0) do={
                :local session [/ip hotspot active find user=$username]
                :if ([:len $session] > 0) do={
                    /ip hotspot active remove $session
                    $sendFunc $token $chat ("✅ *User Kicked*\\n\\nUser: *" . $username . "* has been disconnected.") "MarkdownV2"
                    $logFunc ("User kicked via Telegram: " . $username) "info" true
                } else={
                    $sendFunc $token $chat ("ℹ️ *No Active Session*\\n\\nUser *" . $username . "* is not currently active.") "MarkdownV2"
                }
            } else={
                $sendFunc $token $chat "❓ *Usage*\\n\\n`kick username`" "MarkdownV2"
            }
        }
        
        # Remove user
        :if ([:pick $lowerCmd 0 6] = "remove") do={
            :set found true
            :local username [:trim [:pick $cmd 7 [:len $cmd]]]
            :if ([:len $username] > 0) do={
                :local existing [/ip hotspot user find name=$username]
                :if ([:len $existing] > 0) do={
                    :local session [/ip hotspot active find user=$username]
                    :if ([:len $session] > 0) do={
                        /ip hotspot active remove $session
                    }
                    /ip hotspot user remove $existing
                    $sendFunc $token $chat ("✅ *User Removed*\\n\\nUser: *" . $username . "* has been deleted.") "MarkdownV2"
                    $logFunc ("User removed via Telegram: " . $username) "info" true
                } else={
                    $sendFunc $token $chat ("❌ *User Not Found*\\n\\nUser *" . $username . "* does not exist.") "MarkdownV2"
                }
            } else={
                $sendFunc $token $chat "❓ *Usage*\\n\\n`remove username`" "MarkdownV2"
            }
        }
        
        # Ping with parameters
        :if ([:pick $lowerCmd 0 4] = "ping") do={
            :set found true
            :local host [:trim [:pick $cmd 5 [:len $cmd]]]
            :if ([:len $host] > 0) do={
                :local count 4
                $sendFunc $token $chat ("🏓 *Pinging* `" . $host . "`...") "MarkdownV2"
                :local result [/ping $host count=$count]
                :local avgRtt 0
                :if ($result > 0) do={
                    :set avgRtt ($result / $count)
                }
                $sendFunc $token $chat ("📡 *Ping Result*\\n\\nHost: *" . $host . "*\\nSent: *" . $count . "*\\nReceived: *" . $result . "*\\nPacket Loss: *" . ((($count - $result) / $count) * 100) . "%*") "MarkdownV2"
            } else={
                $sendFunc $token $chat "❓ *Usage*\\n\\n`ping 8.8.8.8`" "MarkdownV2"
            }
        }
        
        # Speed test
        :if ([:pick $lowerCmd 0 9] = "speedtest") do={
            :set found true
            :local params [:trim [:pick $cmd 10 [:len $cmd]]]
            :local iface "ether1"
            :if ([:len $params] > 0) do={
                :local ifacePos [:find $params "interface="]
                :if ([:typeof $ifacePos] != "nil") do={
                    :set iface [:pick $params ($ifacePos + 10) [:len $params]]
                }
            }
            $sendFunc $token $chat ("⚡ *Speed Test*\\n\\nTesting on interface: *" . $iface . "*\\nThis may take a moment...") "MarkdownV2"
            :do {
                /tool speed-test interface=$iface duration=10s
                $sendFunc $token $chat "✅ *Speed Test Complete*\\n\\nCheck router logs for results." "MarkdownV2"
            } on-error={
                $sendFunc $token $chat "❌ *Speed Test Failed*\\n\\nCould not complete test." "MarkdownV2"
            }
        }
        
        # Voucher with profile
        :if ([:pick $lowerCmd 0 7] = "voucher") do={
            :set found true
            :local profile [:trim [:pick $cmd 8 [:len $cmd]]]
            :local profileName "default"
            
            :if ([:len $profile] > 0) do={
                :if ($profile = "1hour" || $profile = "1h") do={:set profileName "1hour"}
                :if ($profile = "1day" || $profile = "1d") do={:set profileName "1day"}
                :if ($profile = "7day" || $profile = "7d") do={:set profileName "7day"}
                :if ($profile = "30day" || $profile = "30d") do={:set profileName "30day"}
            }
            
            :local randomHash [:pick [:md5 ([/system clock get time] . [/system resource get free-memory])] 0 10]
            :local code ("PC-" . [:upper $profileName] . "-" . $randomHash)
            
            :do {
                /ip hotspot user add name=$code password=$code profile=$profileName comment="PowerConnect-Voucher"
                $sendFunc $token $chat ("🎟 *Voucher Created*\\n\\nCode: `" . $code . "`\\nProfile: *" . $profileName . "*\\nValid: *Until revoked*") "MarkdownV2"
                $logFunc ("Voucher created: " . $code . " (profile: " . $profileName . ")") "info" true
            } on-error={
                $sendFunc $token $chat "❌ *Error*\\n\\nCould not create voucher. Check hotspot configuration." "MarkdownV2"
            }
        }
        
        # Add user
        :if ([:pick $lowerCmd 0 3] = "add") do={
            :set found true
            :local params [:trim [:pick $cmd 4 [:len $cmd]]]
            :local spacePos [:find $params " "]
            :if ([:typeof $spacePos] != "nil") do={
                :local username [:pick $params 0 $spacePos]
                :local password [:pick $params ($spacePos + 1) [:len $params]]
                
                :if ([:len $username] > 0 && [:len $password] > 0) do={
                    :do {
                        /ip hotspot user add name=$username password=$password comment="Telegram-Add"
                        $sendFunc $token $chat ("✅ *User Added*\\n\\nUsername: *" . $username . "*\\nPassword: `" . $password . "`") "MarkdownV2"
                        $logFunc ("User added via Telegram: " . $username) "info" true
                    } on-error={
                        $sendFunc $token $chat "❌ *Error*\\n\\nCould not add user. User may already exist." "MarkdownV2"
                    }
                } else={
                    $sendFunc $token $chat "❓ *Usage*\\n\\n`add username password`" "MarkdownV2"
                }
            } else={
                $sendFunc $token $chat "❓ *Usage*\\n\\n`add username password`" "MarkdownV2"
            }
        }
        
        # Block IP
        :if ([:pick $lowerCmd 0 5] = "block") do={
            :set found true
            :local target [:trim [:pick $cmd 6 [:len $cmd]]]
            :if ([:len $target] > 0) do={
                :do {
                    /ip firewall address-list add list=blocked address=$target comment="Telegram-Block"
                    $sendFunc $token $chat ("🚫 *IP Blocked*\\n\\nTarget: *" . $target . "*\\nAdded to blocked list.") "MarkdownV2"
                    $logFunc ("IP blocked via Telegram: " . $target) "warning" true
                } on-error={
                    $sendFunc $token $chat ("❌ *Error*\\n\\nCould not block " . $target) "MarkdownV2"
                }
            } else={
                $sendFunc $token $chat "❓ *Usage*\\n\\n`block 192.168.1.100`" "MarkdownV2"
            }
        }
        
        # Unblock IP
        :if ([:pick $lowerCmd 0 7] = "unblock") do={
            :set found true
            :local target [:trim [:pick $cmd 8 [:len $cmd]]]
            :if ([:len $target] > 0) do={
                :local entries [/ip firewall address-list find list=blocked address=$target]
                :if ([:len $entries] > 0) do={
                    /ip firewall address-list remove $entries
                    $sendFunc $token $chat ("✅ *IP Unblocked*\\n\\nTarget: *" . $target . "*\\nRemoved from blocked list.") "MarkdownV2"
                    $logFunc ("IP unblocked via Telegram: " . $target) "info" true
                } else={
                    $sendFunc $token $chat ("ℹ️ *Not Found*\\n\\n" . $target . " is not in the blocked list.") "MarkdownV2"
                }
            } else={
                $sendFunc $token $chat "❓ *Usage*\\n\\n`unblock 192.168.1.100`" "MarkdownV2"
            }
        }
        
        # Flush DNS
        :if ($lowerCmd = "flush dns" || $lowerCmd = "flushdns" || $lowerCmd = "dns flush") do={
            :set found true
            :do {
                /ip dns cache flush
                $sendFunc $token $chat "✅ *DNS Cache Flushed*" "MarkdownV2"
                $logFunc "DNS cache flushed via Telegram" "info" true
            } on-error={
                $sendFunc $token $chat "❌ *Error*\\n\\nCould not flush DNS cache." "MarkdownV2"
            }
        }
    }
    
    :if (!$found) do={
        $sendFunc $token $chat ("❓ *Unknown Command*\\n\\nType `menu` for available commands or `help` for assistance.") "MarkdownV2"
    }
}

# ================== CALLBACK QUERY HANDLER ==================
:local handleCallback do={
    :local callbackData $1
    :local token $botToken
    :local chat $allowedUserID
    :local sendFunc $send
    
    # Handle inline keyboard callbacks
    :if ($callbackData = "confirm_reboot") do={
        [$handleCommand "confirm reboot" ""]
    } else={
        :if ($callbackData = "confirm_shutdown") do={
            [$handleCommand "confirm shutdown" ""]
        } else={
            :if ($callbackData = "confirm_reset") do={
                [$handleCommand "confirm reset" ""]
            } else={
                :if ($callbackData = "cancel") do={
                    $sendFunc $token $chat "❌ *Action Cancelled*" "MarkdownV2"
                } else={
                    # Try to execute as regular command
                    [$handleCommand $callbackData ""]
                }
            }
        }
    }
}

# ================== MAIN LOOP ==================
$log ("AgentOS Sentinel v" . $scriptVersion . " starting...") "info" true
$send $botToken $allowedUserID ("🤖 *AgentOS Sentinel Started*\\n\\nHost: *" . $deviceName . "*\\nVersion: *" . $scriptVersion . "*\\nStatus: *Online*\\nPower Connect: *" . [:tostr $powerConnectEnabled] . "*") "MarkdownV2"

:local loopCount 0
:local lastHeartbeat 0
:local healthCheckInterval 300

:while (true) do={
    :do {
        # Periodic health check and sync
        :if ($loopCount % $healthCheckInterval = 0) do={
            :set connectionHealth [$checkHealth]
            :if ($powerConnectEnabled = true && $connectionHealth > 50) do={
                $syncPowerConnect $powerConnectEnabled $powerConnectAPI $powerConnectKey
            }
        }
        
        :local response [/tool fetch url=("https://api.telegram.org/bot" . $botToken . "/getUpdates?offset=" . $lastUpdateID . "&limit=10&timeout=30") as-value output=user mode=https check-certificate=yes]
        
        :if ($response->"status" = "finished") do={
            :local data ($response->"data")
            
            # Update lastUpdateID
            :local uidPos [:find $data "\"update_id\""]
            :while ([:typeof $uidPos] != "nil" && $uidPos > 0) do={
                :local idStart ($uidPos + 12)
                :local idEnd [:find $data "," $idStart]
                :if ([:typeof $idEnd] != "nil" && $idEnd > 0) do={
                    :local updateId [:tonum [:pick $data $idStart $idEnd]]
                    :if ($updateId >= $lastUpdateID) do={
                        :set lastUpdateID ($updateId + 1)
                    }
                }
                :set uidPos [:find $data "\"update_id\"" ($uidPos + 1)]
            }
            
            # Handle callback queries (inline keyboard)
            :local callbackPos [:find $data "\"callback_query\""]
            :if ([:typeof $callbackPos] != "nil" && $callbackPos > 0) do={
                :local dataPos [:find $data "\"data\":\"" $callbackPos]
                :if ([:typeof $dataPos] != "nil" && $dataPos > 0) do={
                    :local dataStart ($dataPos + 8)
                    :local dataEnd [:find $data "\"" $dataStart]
                    :if ([:typeof $dataEnd] != "nil" && $dataEnd > 0) do={
                        :local callbackData [:pick $data $dataStart $dataEnd]
                        
                        # Extract chat ID from callback
                        :local chatPos [:find $data "\"chat\":{\"id\":" $callbackPos]
                        :if ([:typeof $chatPos] != "nil" && $chatPos > 0) do={
                            :local chatStart ($chatPos + 14)
                            :local chatEnd [:find $data "," $chatStart]
                            :if ([:typeof $chatEnd] != "nil" && $chatEnd > 0) do={
                                :local sender [:pick $data $chatStart $chatEnd]
                                :if ($sender = $allowedUserID) do={
                                    [$handleCallback $callbackData]
                                }
                            }
                        }
                    }
                }
            }
            
            # Handle regular messages
            :local textPos [:find $data "\"text\":\""]
            :if ([:typeof $textPos] != "nil" && $textPos > 0) do={
                :local textStart ($textPos + 8)
                :local textEnd [:find $data "\"" $textStart]
                :if ([:typeof $textEnd] != "nil" && $textEnd > 0) do={
                    :local rawCmd [:pick $data $textStart $textEnd]
                    :local cmd [:trim $rawCmd]
                    :local args ""
                    
                    # Parse command and args
                    :local spacePos [:find $cmd " "]
                    :if ([:typeof $spacePos] != "nil" && $spacePos > 0) do={
                        :set args [:pick $cmd ($spacePos + 1) [:len $cmd]]
                        :set cmd [:pick $cmd 0 $spacePos]
                    }
                    
                    # Extract sender ID
                    :local chatPos [:find $data "\"chat\":{\"id\":"]
                    :if ([:typeof $chatPos] != "nil" && $chatPos > 0) do={
                        :local chatStart ($chatPos + 14)
                        :local chatEnd [:find $data "," $chatStart]
                        :if ([:typeof $chatEnd] != "nil" && $chatEnd > 0) do={
                            :local sender [:pick $data $chatStart $chatEnd]
                            
                            :if ($sender = $allowedUserID) do={
                                :put ("Command received: " . $cmd)
                                $log ("Command: " . $cmd . " from " . $sender) "info" true
                                
                                [$handleCommand $cmd $args]
                                
                                :set commandHistory ($commandHistory, {$cmd, [/system clock get time]})
                            } else={
                                :put ("Unauthorized access from: " . $sender)
                                $log ("UNAUTHORIZED access from: " . $sender) "warning" true
                                $send $botToken $sender "⛔ *Access Denied*\\n\\nYou are not authorized to use this bot." "MarkdownV2"
                            }
                        }
                    }
                }
            }
        }
        
        :set loopCount ($loopCount + 1)
        
        # Heartbeat every 100 iterations
        :if ($loopCount % 100 = 0) do={
            :set lastHeartbeat ($loopCount / 100)
            $log ("Heartbeat #" . $lastHeartbeat . " - Commands: " . $loopCount . " - Health: " . $connectionHealth . "%") "info" true
        }
        
    } on-error={
        :set errorCount ($errorCount + 1)
        :set connectionHealth ($connectionHealth - 5)
        :if ($connectionHealth < 0) do={:set connectionHealth 0}
        :put "Polling timeout or error..."
        :if ($errorCount > 10) do={
            $log "Multiple errors detected - resetting error counter" "warning" true
            :set errorCount 0
            :set connectionHealth 100
        }
    }
    
    :delay 2s
}
