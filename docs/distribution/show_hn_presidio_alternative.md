# Show HN: PrivacyScrubber – An in-memory, zero-dependency Presidio alternative for Node.js

## Target Platform
- **Platform**: Hacker News (`news.ycombinator.com/submit`)
- **Format**: Text Submission ("Show HN")
- **Optimal Submission Window**: Tuesday or Wednesday at 13:00–14:30 UTC (9:00–10:30 AM ET).

---

## Submission Details

### Title
```text
Show HN: PrivacyScrubber – In-memory, zero-dependency Presidio alternative for Node.js
```

### URL (Optional, leave blank if submitting as text post)
Leave URL blank to submit as a Text submission.

### Post Body (Submission Text)
```text
Hey HN,

I built PrivacyScrubber SDK (@privacyscrubber/sdk), an in-memory PII and secrets sanitization engine for Node.js and TypeScript.

The problem:
When sending prompts to cloud LLMs (OpenAI, Claude) or indexing documents into vector databases, you need to scrub PII (emails, SSNs, phone numbers) and credentials (API keys, JWTs). 

The industry standard tool for this has been Microsoft Presidio. But if your stack is Node.js or TypeScript:
1. Presidio requires running a separate Python Docker container + spaCy (~500MB+ image).
2. Every request incurs HTTP serialization and container network overhead (~40-80ms added latency).
3. Cold starts take 2-4 seconds, making it unusable in serverless environments (AWS Lambda, Vercel).
4. Presidio anonymizes text, but does not provide an in-memory session map to reverse the tokens back into original values when the LLM responds.

What we did:
We built an in-process, deterministic engine in native TypeScript with zero external dependencies (~180KB package size).

Key properties:
- Sub-millisecond execution (<1ms per 10k chars; 0.82ms in our benchmarks vs 38ms for local Presidio).
- 0 bytes network egress. Everything executes strictly in local process memory (RAM).
- 1-line transparent wrapper for the official OpenAI SDK (`wrapOpenAI`). Outbound prompts are sanitized; inbound completions are detokenized automatically before returning to your code.
- Pre-embedding sanitization for RAG to satisfy GDPR Article 17 (Right to be Forgotten) in vector databases like Pinecone/Chroma.
- Volatile session mapping: original values exist only in ephemeral process RAM during the request turn and are garbage-collected immediately.

Quick example:

```typescript
import OpenAI from "openai";
import { wrapOpenAI } from "@privacyscrubber/sdk";

const openai = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), {
  profile: "Engineering",
  detectSecrets: true
});

// Outbound prompt is sanitized in RAM; inbound response is detokenized automatically
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Debug logs for alice@corp.com with key AKIAIOSFODNN7EXAMPLE" }]
});

console.log(response.choices[0].message.content);
```

Benchmarks and comparisons:
- In-memory SDK: 0.82ms latency, 0B network egress, 0 dependencies, 0ms cold start.
- Presidio (Local Docker): 38.4ms latency, internal HTTP network hop, ~500MB container.
- Google Cloud DLP / AWS Comprehend: 180-240ms latency, cloud network egress, pay-per-request.

Links:
- GitHub: https://github.com/moxno/privacyscrubber-mcp
- NPM: https://www.npmjs.com/package/@privacyscrubber/sdk
- Technical Benchmark: https://github.com/moxno/privacyscrubber-mcp/blob/main/docs/benchmarks/sdk-vs-presidio.md
- Web App (Zero-server demo): https://privacyscrubber.com

I would love to hear feedback on the architectural approach, regex optimization strategies, and edge cases in PII detection.
```

---

## First Comment by Author (To post immediately after submission)
```text
A few additional architectural details on why we chose deterministic compiled regex over local spaCy/BERT models:

1. Latency budget in LLM pipelines:
With gpt-4o or claude-3-5-sonnet, TTFT (time-to-first-token) is already 300-800ms. Adding 50-100ms for a local neural NER model (or 200ms+ for a cloud DLP API call) visibly degrades streaming performance. At 0.82ms, in-process regex sanitization is effectively free within the node event loop.

2. Determinism and hallucination in NER:
Transformer-based NER models occasionally hallucinate token boundaries or miss structured identifiers (e.g., specific formats of national IDs, secret keys, or medical codes). By structuring rules into prioritized, non-backtracking regular expressions and contextual lookarounds, detection remains 100% deterministic and reproducible across runs.

3. Zero supply-chain attack surface:
The package has 0 dependencies in package.json. No transitive node_modules dependencies means zero risk of compromised upstream packages or prototype pollution vulnerabilities in your security layer.

Happy to answer any questions about the implementation, benchmarks, or memory isolation model.
```

---

## Handling Common Hacker News Questions & Skepticisms

### Question 1: "Why not just write a few regexes yourself?"
**Response**:
```text
Writing a regex for an email or US phone number is trivial. The complexity emerges when handling:
1. Reversible tokenization: tracking token-to-cleartext mappings across multi-turn chats without memory leaks.
2. High-liability patterns: HIPAA 18 Safe Harbor identifiers, EU national IDs, IBANs, and API credentials (AWS STS tokens, JWTs, private keys) without false-positive collisions.
3. ReDoS prevention: ensuring expressions avoid catastrophic backtracking under adversarial prompt inputs.
4. Framework compliance: generating deterministic audit telemetry (risk level, detected frameworks like GDPR/HIPAA/SOC 2) for enterprise compliance teams.
```

### Question 2: "What is the license and pricing model?"
**Response**:
```text
The MCP server is open source (MIT). The SDK on npm includes a free tier for general PII sanitization up to 15,000 characters per request with zero registration. For enterprise usage across all 30 vertical profiles (Healthcare HIPAA, Legal, Finance, DevOps secrets) with unlimited characters and high-throughput batching, we offer commercial developer licenses at $199/mo.
```

### Question 3: "Does it work in Vercel Serverless / Cloudflare Workers?"
**Response**:
```text
Yes. Because there are no native C++ bindings, Python runtimes, or external filesystem dependencies, it runs out of the box in Node.js 18+, Bun, Deno, Vercel Serverless Functions, and modern browser Web Workers.
```
