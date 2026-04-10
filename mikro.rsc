# System script for connection notification
/system script
add name=notify-connection source={
    :local mac $"mac-address";
    :local user $"user";
    :local ip $"address";
    :local sessionId $"session-id";
    
    /tool fetch url="https://auth.yourdomain.com/api/mikrotik/webhook/connect" \
        http-method=post \
        http-data="username=$user&mac=$mac&ip=$ip&sessionId=$sessionId" \
        keep-result=no;
}

# System script for disconnection notification
/system script
add name=notify-disconnection source={
    :local user $"user";
    :local bytesIn $"bytes-in";
    :local bytesOut $"bytes-out";
    :local uptime $"uptime";
    
    /tool fetch url="https://auth.yourdomain.com/api/mikrotik/webhook/disconnect" \
        http-method=post \
        http-data="username=$user&bytesIn=$bytesIn&bytesOut=$bytesOut&uptime=$uptime" \
        keep-result=no;
}