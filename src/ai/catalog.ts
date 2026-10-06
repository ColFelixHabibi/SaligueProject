import {z} from 'genkit';

// Product details the AI flows can see (no images; see toCatalog in src/lib/types.ts).
export const CatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  category: z.string(),
  seller: z.string(),
  description: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  brand: z.string().optional(),
  condition: z.string().optional(),
});

// Handlebars snippet listing the catalog inside a prompt.
export const CATALOG_PROMPT_LIST = `{{#each products}}
- ID: {{id}}, Name: {{name}}, Category: {{category}}, Price: {{price}}{{#if brand}}, Brand: {{brand}}{{/if}}{{#if color}}, Color: {{color}}{{/if}}{{#if size}}, Size: {{size}}{{/if}}{{#if condition}}, Condition: {{condition}}{{/if}}{{#if description}}, Description: {{description}}{{/if}}
{{/each}}`;
