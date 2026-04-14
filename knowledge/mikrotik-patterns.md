# MikroTik Patterns - AgentOS Learned Knowledge

## block-streaming-work-hours
Prompt: "block youtube and tiktok 9am-5pm weekdays"
```rsc
/ip firewall address-list add list=streaming address=youtube.com
/ip firewall address-list add list=streaming address=tiktok.com
/ip firewall filter add chain=forward dst-address-list=streaming time=9h-17h,mon,tue,wed,thu,fri action=drop comment="AgentOS: streaming block"
/system scheduler add name=streaming-block-enable start-time=09:00:00 interval=1d on-event="/ip firewall filter enable [find comment~\"AgentOS: streaming\"]"
