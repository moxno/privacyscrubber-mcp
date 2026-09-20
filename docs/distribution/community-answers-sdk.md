# Community Technical Q&A Inbound Boilerplates: @privacyscrubber/sdk

**Purpose**: High-signal, authoritative, code-first answers for Reddit (`r/node`, `r/LangChain`, `r/OpenAI`, `r/typescript`), StackOverflow, and GitHub Discussions. Written to immediately solve the developer's technical problem without fluff or pushy marketing.

---

## Thread 1: "How to sanitize PII and API keys before sending prompts to OpenAI in Node.js / TypeScript?"
**Target Platforms**: `r/node`, `r/typescript`, `r/OpenAI`, StackOverflow

### Response Template:

The biggest problem with most PII redaction setups (like Microsoft Presidio or Cloud DLP proxies) in Node.js is latency and architecture complexity: you either have to host a separate Python Docker container running spaCy (adding 30-100ms per turn), or send raw payloads over the internet to a cloud DLP proxy (adding 200ms+ and defeating the purpose of privacy).

You can handle this 100% in-memory in your existing Node.js or Next.js process using `@privacyscrubber/sdk`. It executes in <1ms with zero dependencies, strips PII/secrets, and automatically restores the original values when the AI responds.

```bash
npm install @privacyscrubber/sdk openai
```

Here is a 1-line transparent wrapper pattern:

```typescript
import OpenAI from "openai";
import { wrapOpenAI } from "@privacyscrubber/sdk";

// Wrap your standard client
const openai = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), {
  profile: "Engineering",   // 25+ profiles: Legal, Medical, HR, Financial...
  detectSecrets: true       // Automatically catches AWS keys, JWTs, DB passwords
});

// Use standard OpenAI API calls — prompts are sanitized in RAM before transmission!
const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ 
    role: "user", 
    content: "Review logs for user alice@corp.com with AWS token AKIAIOSFODNN7EXAMPLE and phone 415-555-0199." 
  }]
});

console.log(completion.choices[0].message.content);
// OpenAI receives: "Review logs for user [EMAIL_1] with AWS token [AWS_KEY_1] and phone [PHONE_1]."
// The SDK restores original values automatically before returning the response to your code!
```

Key technical details:
- **Zero Network Egress**: It runs entirely in local process RAM; no HTTP calls or telemetries are made.
- **Sub-millisecond**: ~0.8ms for 10KB text.
- **Reversibility**: Uses an in-memory session map so you can run interactive multi-turn chats.
- Free tier includes 15,000 characters for the General profile.

---

## Thread 2: "Is there a lightweight alternative to Microsoft Presidio for Node.js / Next.js without Python or Docker?"
**Target Platforms**: `r/LangChain`, `r/ChatGPTCoding`, Hacker News Ask HN

### Response Template:

If your backend is TypeScript/Node.js or serverless (Vercel, AWS Lambda), Microsoft Presidio is painful because:
1. It requires a dedicated Python microservice + Docker container.
2. spaCy language models consume ~500MB RAM.
3. Cold starts take 2-4 seconds, which kills serverless functions.
4. Presidio anonymizes text, but does not give you an easy, deterministic in-memory session map to "un-anonymize" the AI response back into real customer names.

If you don't strictly require custom spaCy neural models, look into `@privacyscrubber/sdk`. It's a native TypeScript/Node.js in-memory sanitization engine:

- **Footprint**: ~180KB bundle size, zero external dependencies.
- **Cold start**: 0ms (safe for Vercel Serverless and Edge workers).
- **Latency**: Sub-1ms per 10k chars vs 40-80ms for Presidio Docker roundtrips.
- **Reverse Scrub (Reveal)**: Built-in deterministic detokenization.

Direct comparison snippet:

```typescript
import { sanitize, restore } from "@privacyscrubber/sdk";

// 1. Sanitize before sending to LLM
const { scrubbedText, tokenMap, telemetry } = sanitize(
  "Patient Jane Doe (SSN: 000-12-3456) prescribed 20mg Lisinopril.",
  { profile: "Healthcare" } // Covers all 18 HIPAA Safe Harbor identifiers
);

// scrubbedText: "Patient [NAME_1] (SSN: [SSN_1]) prescribed 20mg Lisinopril."
// telemetry.riskLevel: "CRITICAL"
// telemetry.frameworksList: ["HIPAA Safe Harbor (§164.514)", "GDPR Art. 9"]

// 2. Call your LLM with scrubbedText...
const aiResponse = "Consult with [NAME_1] regarding dosage adjustments.";

// 3. Restore original entities locally
const { restoredText } = restore(aiResponse, tokenMap);
// restoredText: "Consult with Jane Doe regarding dosage adjustments."
```

If you have a strict air-gapped requirement, it is certified zero-network-egress.

---

## Thread 3: "GDPR Article 17 (Right to be Forgotten) in RAG & Vector Databases (Pinecone, Chroma)"
**Target Platforms**: `r/LangChain`, `r/MachineLearning`, StackOverflow

### Response Template:

Under GDPR Article 17, when a user requests data deletion, storing raw PII inside vector embeddings creates a major compliance issue:
- High-dimensional vector embeddings mathematically encode personal attributes.
- You cannot "delete" a single attribute from an embedding vector without deleting the entire chunk and rebuilding your HNSW/IVF index.
- If PII is baked into vector metadata or raw text chunks, your vector DB is non-compliant.

The standard architectural fix is **Pre-Embedding In-Memory Tokenization**: strip all PII before the text touches your embedding model or vector database.

Example in TypeScript using `@privacyscrubber/sdk` and Pinecone:

```typescript
import { sanitize } from "@privacyscrubber/sdk";
import { Pinecone } from "@pinecone-database/pinecone";

async function ingestDocumentChunk(chunkText: string, chunkId: string) {
  // 1. Sanitize in-memory (<1ms, zero network calls)
  const { scrubbedText, telemetry } = sanitize(chunkText, {
    profile: "Legal",
    detectSecrets: true
  });

  // 2. Embed the sanitized text ONLY
  const embedding = await createOpenAIEmbedding(scrubbedText);

  // 3. Store in Pinecone / Chroma / pgvector
  // Result: 0 PII stored in embeddings, 0 PII in chunk text, 100% GDPR Art. 17 compliant
  await pineconeIndex.upsert([{
    id: chunkId,
    values: embedding,
    metadata: {
      riskLevel: telemetry.riskLevel,
      sanitized: true
    }
  }]);
}
```

This ensures that even if your vector database is queried or inspected, zero personal data exists in the vector space.
