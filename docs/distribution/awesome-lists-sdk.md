# GitHub Awesome Lists Submission Dossier: @privacyscrubber/sdk

**Target**: Curated GitHub developer lists with high domain authority (DA 75-95) and thousands of daily AI/backend engineer views.

---

## 1. sindresorhus/awesome-nodejs (54k★)
- **Repository**: [https://github.com/sindresorhus/awesome-nodejs](https://github.com/sindresorhus/awesome-nodejs)
- **Target Section**: `## Security` or `## Text`
- **PR Title**: `Add @privacyscrubber/sdk - Zero-dependency in-memory PII and secrets redaction`
- **Markdown Line to Insert**:
```markdown
- [@privacyscrubber/sdk](https://github.com/moxno/privacyscrubber-mcp) - Zero-dependency in-memory PII and secrets redaction SDK for Node.js, Next.js, OpenAI, and LangChain (<1ms execution latency, zero network egress).
```
- **PR Justification / Message**:
```text
Hello! Submitting @privacyscrubber/sdk under Security.
It is an in-memory, zero-dependency Node.js/TypeScript SDK for sanitizing PII and secrets (AWS keys, JWTs, emails, phones, SSNs) prior to cloud LLM or vector DB ingestion.
- Zero network egress (air-gapped certified)
- Sub-millisecond latency (<1ms per 10k chars)
- 1-line transparent OpenAI SDK wrapper (`wrapOpenAI`)
- Supports Node.js 18+, Bun, Deno, and modern browser Web Workers.
Thank you for curating this awesome list!
```

---

## 2. kyrolabs/awesome-langchain (16k★)
- **Repository**: [https://github.com/kyrolabs/awesome-langchain](https://github.com/kyrolabs/awesome-langchain)
- **Target Section**: `## Tools / Services` or `## Agentic AI / Security`
- **PR Title**: `Add PrivacyScrubber SDK to Tools / Security`
- **Markdown Line to Insert**:
```markdown
- [PrivacyScrubber SDK](https://github.com/moxno/privacyscrubber-mcp) - Zero-trust in-memory PII redaction and detokenization middleware for LangChain and LlamaIndex.
```
- **PR Justification / Message**:
```text
Adding PrivacyScrubber SDK to the Tools/Security section.
LangChain TypeScript developers frequently need to strip PII and internal secrets before chaining prompts to third-party LLMs and vector stores without adding latency or running external Python/Presidio containers.
The SDK provides `createLangChainTransform()` and stateful multi-turn session token preservation with <1ms in-memory execution.
```

---

## 3. e2b-dev/awesome-ai-agents (11k★)
- **Repository**: [https://github.com/e2b-dev/awesome-ai-agents](https://github.com/e2b-dev/awesome-ai-agents)
- **Target Section**: `## Guardrails & Security`
- **PR Title**: `Add @privacyscrubber/sdk to Guardrails & Security`
- **Markdown Line to Insert**:
```markdown
- [@privacyscrubber/sdk](https://github.com/moxno/privacyscrubber-mcp) - In-memory zero-trust PII sanitization and multi-turn state preservation middleware for autonomous AI agents.
```
- **PR Justification / Message**:
```text
Hi E2B team! Submitting @privacyscrubber/sdk for the Guardrails & Security category.
Autonomous agents that store conversation history or memory chunks often leak user identifiers and API keys into vector databases.
This SDK intercepts prompts at the application boundary in RAM, assigns deterministic tokens ([NAME_1], [SECRET_1]), and restores responses upon completion with zero external network hops.
```

---

## 4. steven2358/awesome-generative-ai (12k★)
- **Repository**: [https://github.com/steven2358/awesome-generative-ai](https://github.com/steven2358/awesome-generative-ai)
- **Target Section**: `## LLM Tools / Safety & Moderation`
- **PR Title**: `Add @privacyscrubber/sdk - In-Memory PII Redaction for LLMs`
- **Markdown Line to Insert**:
```markdown
- [@privacyscrubber/sdk](https://github.com/moxno/privacyscrubber-mcp) - Zero-trust in-memory PII and secrets masking engine with 1-line OpenAI client wrapping and 25+ regulatory profiles.
```
- **PR Justification / Message**:
```text
Submitting PrivacyScrubber SDK to the LLM Tools / Safety section.
It enables zero-trust client-side data sanitization for OpenAI, Claude, and LangChain pipelines without proxy latency or server data leakage.
```

---

## 5. punkpeye/awesome-mcp-servers (93k★)
*(PrivacyScrubber is ALREADY merged in the Security section!)*
- **Repository**: [https://github.com/punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)
- **Current Entry in Security**:
  `- [privacyscrubber-mcp](https://github.com/moxno/privacyscrubber-mcp) - Zero-Trust Data Sanitization (ZTDS) stdio server for IDEs.`
- **Recommended Update PR**:
  `- [privacyscrubber-mcp](https://github.com/moxno/privacyscrubber-mcp) - Zero-Trust Data Sanitization (ZTDS) server and headless programmatic Node.js SDK (@privacyscrubber/sdk) for IDEs and autonomous AI pipelines.`
