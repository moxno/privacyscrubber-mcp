# AI Framework Maintainer Outreach & PR Manifest

## Target AI Frameworks
1. **LangChain.js** (`langchain-ai/langchainjs`)
2. **LlamaIndex.TS** (`run-llama/LlamaIndexTS`)

---

## 1. LangChain.js: Native PrivacyScrubber Document Transformer & Runnable
- **Repository**: [https://github.com/langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs)
- **Proposed Feature**: `@langchain/community/document_transformers/privacyscrubber` or dedicated integration guide in documentation.

### Proposal Issue / Discussion Draft
- **Title**: `[RFC] Native in-memory PII sanitization document transformer via @privacyscrubber/sdk`
- **Body**:
```markdown
### Motivation
When building LangChain.js chains and RAG pipelines that ingest enterprise documents or call third-party LLMs (OpenAI, Anthropic), users need to sanitize PII and API credentials.
Currently, users either roll manual regex transformations or call out to external Python Presidio microservices, introducing network latency and container dependencies.

`@privacyscrubber/sdk` provides a zero-dependency, sub-millisecond (<1ms) in-memory PII sanitization engine that runs natively in Node.js, Bun, and browser environments.

### Proposed Implementation
Create a `PrivacyScrubberTransformer` that implements `BaseDocumentTransformer`:

```typescript
import { BaseDocumentTransformer } from "@langchain/core/documents/transformers";
import { Document } from "@langchain/core/documents";
import { sanitize } from "@privacyscrubber/sdk";

export interface PrivacyScrubberTransformerParams {
  profile?: string;
  detectSecrets?: boolean;
}

export class PrivacyScrubberTransformer extends BaseDocumentTransformer {
  private profile: string;
  private detectSecrets: boolean;

  constructor(fields?: PrivacyScrubberTransformerParams) {
    super();
    this.profile = fields?.profile ?? "General";
    this.detectSecrets = fields?.detectSecrets ?? true;
  }

  async transformDocuments(documents: Document[]): Promise<Document[]> {
    return documents.map((doc) => {
      const { scrubbedText, telemetry } = sanitize(doc.pageContent, {
        profile: this.profile,
        detectSecrets: this.detectSecrets,
      });

      return new Document({
        pageContent: scrubbedText,
        metadata: {
          ...doc.metadata,
          privacyRiskLevel: telemetry.riskLevel,
          sanitized: true,
        },
      });
    });
  }
}
```

### Benefits to LangChain Community:
1. Zero external Python microservice or Docker required.
2. In-memory execution in <1ms.
3. Fully compatible with Node.js, Vercel Serverless, and Cloudflare Workers.
```

---

## 2. LlamaIndex.TS: Pre-Ingestion NodeTransform Recipe
- **Repository**: [https://github.com/run-llama/LlamaIndexTS](https://github.com/run-llama/LlamaIndexTS)
- **Location**: `examples/cookbook/pii_sanitization.ts` or Community Integration PR.

### PR / Issue Draft
- **Title**: `Recipe: In-memory PII and credential sanitization for NodeTransform using @privacyscrubber/sdk`
- **Body**:
```markdown
### Use Case
Sanitizing personal identifiers and developer credentials before generating vector embeddings in LlamaIndex.TS to guarantee compliance with GDPR Article 17 (Right to be Forgotten).

### Implementation Snippet
```typescript
import { BaseNodeTransform, NodeWithScore, TextNode } from "llamaindex";
import { sanitize } from "@privacyscrubber/sdk";

export class PrivacyScrubberTransform extends BaseNodeTransform {
  transform(nodes: BaseNode[]): BaseNode[] {
    return nodes.map((node) => {
      if (node instanceof TextNode) {
        const { scrubbedText, telemetry } = sanitize(node.text, {
          profile: "Engineering",
          detectSecrets: true,
        });

        node.text = scrubbedText;
        node.metadata["sanitized"] = true;
        node.metadata["riskLevel"] = telemetry.riskLevel;
      }
      return node;
    });
  }
}
```
```
