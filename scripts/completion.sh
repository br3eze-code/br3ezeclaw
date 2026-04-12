#!/bin/bash

# AgentOS Bash/Zsh Completion
# Add to your shell: source <(agentos completion)

_agentos_completions() {
    local cur prev opts
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"
    
    # Main commands
    opts="onboard gateway gateway:status gateway:stop network users voucher config doctor status help --version --help --dev --profile --no-color --json"
    
    # Subcommand completions
    case "${prev}" in
        gateway)
            opts="--daemon --port --force --verbose"
            ;;
        network|net)
            opts="ping scan firewall block unblock"
            ;;
        users|user)
            opts="list kick add remove status"
            ;;
        voucher|v)
            opts="create list revoke stats"
            ;;
        config)
            opts="get set edit show"
            ;;
        *)
            ;;
    esac
    
    COMPREPLY=( $(compgen -W "${opts}" -- ${cur}) )
    return 0
}

complete -F _agentos_completions agentos
complete -F _agentos_completions aos
