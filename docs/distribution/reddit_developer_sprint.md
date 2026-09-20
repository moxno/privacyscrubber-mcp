# Reddit Developer Sprint: In-Memory PII Sanitization for Node.js / TypeScript

## Overview
This dossier provides high-signal, non-promotional technical posts tailored specifically to developer subreddits. Focus is strictly on architectural problem-solving, latency comparison, and code implementations.

---

## 1. Subreddit: `r/node`
- **Focus**: Performance, eliminating heavy Python Docker dependencies, zero-dependency packages.
- **Title**: `Benchmarking PII sanitization in Node.js: Why we replaced Microsoft Presidio with an in-memory zero-dependency engine`
- **Post Body**:

```markdown
If you are building AI agents, LLM pipelines, or RAG systems in Node.js, you have probably encountered the problem of sanitizing user PII (emails, phones, national IDs) and infrastructure secrets before sending prompts to OpenAI or Claude.

For years, the default recommendation has been Microsoft Presidio. However, running Presidio in a Node.js ecosystem brings notable operational pain:
- It requires running a separate Python Docker microservice with spaCy (~500MB container).
- Every prompt inspection adds 30ms-80ms of local HTTP network overhead.
- Cold starts (2-4 seconds) make it unusable in serverless setups (Lambda / Vercel).
- Presidio anonymizes text, but does not provide an in-memory session map to detokenize the LLM completion back to the original values.

We built and benchmarked `@privacyscrubber/sdk` as an in-process alternative for Node.js and Bun:

### Benchmark Summary (10,000 char prompt):
- `@privacyscrubber/sdk`: **0.82 ms** (in-memory RAM execution, 0 network egress, 0 dependencies).
- Microsoft Presidio (Local Docker): **38.4 ms** (HTTP localhost roundtrip + spaCy inference).
- Google Cloud DLP: **185 ms** (public cloud network egress).

### How it works in code:
Instead of manual string manipulations or HTTP calls, you wrap your existing OpenAI client in 1 line:

```typescript
import OpenAI from "openai";
import { wrapOpenAI } from "@privacyscrubber/sdk";

const openai = wrapOpenAI(new OpenAI(), {
  profile: "Engineering",
  detectSecrets: true
});

// Outbound prompt is sanitized in process RAM; LLM response is detokenized automatically
const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ 
    role: "user", 
    content: "Analyze error for user mark@corp.com with token AKIAIOSFODNN7EXAMPLE" 
  }]
});

console.log(completion.choices[0].message.content);
```

### Architecture notes:
1. **0 Dependencies**: Zero supply chain risk in your security layer.
2. **Deterministic Token Scoping**: Scoped strictly to the request lifecycle in memory; garbage collected immediately after the turn.
3. **Edge / Serverless Ready**: Package footprint is ~180KB, zero native bindings.

NPM: `npm install @privacyscrubber/sdk`
GitHub: https://github.com/moxno/privacyscrubber-mcp
Full Benchmark Data: https://github.com/moxno/privacyscrubber-mcp/blob/main/docs/benchmarks/sdk-vs-presidio.md

Curious to hear how other teams handle PII hygiene in high-throughput Node.js microservices.
```

---

## 2. Subreddit: `r/typescript`
- **Focus**: Type safety, transparent wrapper typing, developer experience.
- **Title**: `Type-safe PII sanitization in TypeScript without external microservices`
- **Post Body**:

```markdown
When piping sensitive data through third-party LLMs, keeping cleartext PII out of prompt logs is standard compliance (GDPR Art. 25/32, HIPAA Safe Harbor).

Most solutions require either setting up a Python Presidio container or passing untyped strings back and forth through regex scripts.

We wrote `@privacyscrubber/sdk` in TypeScript with two core developer goals:
1. **Zero-Latency In-Memory Execution**: Sub-millisecond latency (<1ms) inside the host process.
2. **Zero-Friction Type Preservation**: A transparent wrapper for the official `OpenAI` client that preserves complete TypeScript definitions, autocompletions, and streaming options.

### Code Example:

```typescript
import OpenAI from "openai";
import { wrapOpenAI, sanitize, restore } from "@privacyscrubber/sdk";

// 1. Transparent Wrapper
const client = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

// Full autocomplete and type-checking are preserved
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Contact support at user@domain.com" }]
});

// 2. Direct Functional API with Telemetry
const { scrubbedText, tokenMap, telemetry } = sanitize(
  "Employee Alice Smith (SSN: 000-12-3456) salary: $150,000",
  { profile: "Financial" }
);

// telemetry type is strictly defined:
// telemetry.riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
// telemetry.frameworksList: string[] ('GDPR', 'HIPAA', 'SOC 2', etc.)
```

### Key Technical Specs:
- **Bundle**: ~180KB, zero external dependencies.
- **Runtime**: Works on Node.js 18+, Bun, Deno, and Vercel Edge.
- **Memory Safety**: In-memory token maps exist strictly in volatile RAM and do not touch disk.

NPM: https://www.npmjs.com/package/@privacyscrubber/sdk
Repo: https://github.com/moxno/privacyscrubber-mcp

Feedback on API ergonomics and TypeScript definitions is welcome.
```

---

## 3. Subreddit: `r/LocalLLaMA`
- **Focus**: Air-gapped privacy, local LLM tooling, Model Context Protocol (MCP).
- **Title**: `Air-gapped PII sanitization for local LLMs and AI IDEs (Cursor/Claude Desktop) via stdio MCP and Node.js SDK`
- **Post Body**:

```markdown
If you run local LLMs (Ollama, vLLM, llama.cpp) or work in AI IDEs (Cursor, Claude Desktop), maintaining a strictly air-gapped environment is usually the whole point.

However, many developers still use hybrid workflows: local models for quick iterations, but occasionally routing difficult tasks to Claude or OpenAI. When routing out, you don't want local source code paths, database credentials, internal IPs, or user PII leaving your machine.

We open-sourced a Model Context Protocol (MCP) server and companion SDK specifically designed for air-gapped, zero-trust sanitization:

### 1. For Claude Desktop / Cursor IDE (stdio MCP)
The MCP server runs over stdio locally without network ports:

```json
{
  "mcpServers": {
    "privacyscrubber": {
      "command": "npx",
      "args": ["-y", "@privacyscrubber/mcp-server"]
    }
  }
}
```
Available tools:
- `scrub_text`: Strips PII, credentials, and infrastructure IPs, returning sanitized text + ephemeral session key.
- `reveal_text`: Re-hydrates tokens locally inside your environment.

### 2. For Headless Scripts & Local Pipelines
```bash
npm install @privacyscrubber/sdk
```
Executes in <1ms in local RAM with zero network calls and zero dependencies.

NPM: https://www.npmjs.com/package/@privacyscrubber/mcp-server
GitHub: https://github.com/moxno/privacyscrubber-mcp
Zero-Server Web App: https://privacyscrubber.com
```

---

## 4. Subreddit: `r/webdev`
- **Focus**: GDPR Article 17, Vector Databases (Pinecone/Chroma), RAG security.
- **Title**: `The GDPR Article 17 issue in RAG pipelines and how to solve it before vector embedding`
- **Post Body**:

```markdown
A common architectural oversight in RAG (Retrieval-Augmented Generation) applications is embedding customer documents containing raw personal data into vector databases (Pinecone, Chroma, pgvector).

### The Problem:
Under GDPR Article 17 ("Right to be Forgotten"), users have the legal right to demand complete deletion of their data. 
However:
1. High-dimensional vector embeddings mathematically encode personal attributes.
2. You cannot "delete" an attribute from an embedding vector without deleting the chunk and rebuilding HNSW/IVF indexes.
3. If personal data resides in vector database metadata, your database is directly exposed.

### The Architecture Fix: Pre-Embedding In-Memory Sanitization
Strip all PII before generating embeddings so that zero personal data enters the vector space:

```typescript
import { sanitize } from "@privacyscrubber/sdk";
import { Pinecone } from "@pinecone-database/pinecone";

async function indexChunk(text: string, id: string) {
  // 1. Sanitize in RAM (<1ms, zero network calls)
  const { scrubbedText } = sanitize(text, { profile: "General" });

  // 2. Embed the sanitized text ONLY
  const embedding = await getEmbedding(scrubbedText);

  // 3. Upsert to vector DB: zero PII stored, 100% GDPR Art. 17 compliant
  await pinecone.upsert([{ id, values: embedding }]);
}
```

By decoupling raw identity from the vector index, compliance requests only require clearing the isolated relational record, leaving the vector index clean and unaffected.

Package: `@privacyscrubber/sdk` (Node.js/TS, zero dependencies, <1ms execution)
GitHub: https://github.com/moxno/privacyscrubber-mcp
```
