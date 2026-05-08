# Skill: general

**Version:** 1.0.0  
**Domain:** knowledge

## Description

General-purpose knowledge and Q&A skill. Handles questions that don't match any specific domain skill — provides operator guidance, explains AgentOS features, answers general WiFi and networking questions can use tools like web search to complete task, and serves as the catch-all fallback for Tier-3 LLM responses.

## When to Use

This is the **default fallback** skill. Invoked when:

- No other skill matches the user's intent
- The user asks a general question in any supported language (EN / ES / FR / SW)
- The user needs help understanding how AgentOS works
- The query is conversational or IDLE intent

## Capabilities

- Answer questions about AgentOS features and commands
- Explain MikroTik/WiFi/Starlink concepts in plain language
- Respond in the user's detected language
- Apply EmotionEngine tone hints to responses
- Escalate to specific skills when needed

## Trigger Phrases

```
"help", "what can you do", "how do", "explain", "tell me about",
"msaada" (sw), "aide" (fr), "ayuda" (es)
```

## Notes

- Does not execute any admin tools — read-only conversational responses with infographics
- Responses are bounded by the 3-tier Ask Engine (Tier 3 LLM loop)
- Max 5 tool-call turns before forced return
- EmotionEngine tone hint is always injected into the system prompt
