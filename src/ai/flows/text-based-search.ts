
'use server';
/**
 * @fileOverview An AI agent that performs text-based search for clothing items.
 *
 * - textBasedSearch - A function that handles the text-based search process.
 * - TextBasedSearchInput - The input type for the textBasedSearch function.
 * - TextBasedSearchOutput - The return type for the textBasedSearch function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {CatalogItemSchema, CATALOG_PROMPT_LIST} from '@/ai/catalog';

const TextBasedSearchInputSchema = z.object({
  query: z.string().describe('The user\'s search query for a clothing item.'),
  products: z.array(CatalogItemSchema).describe('A list of available products to search from.'),
});
export type TextBasedSearchInput = z.infer<typeof TextBasedSearchInputSchema>;

const MatchedProductSchema = z.object({
  id: z.string().describe('The ID of the matched product.'),
});

const TextBasedSearchOutputSchema = z.object({
  results: z
    .array(MatchedProductSchema)
    .describe('A list of product IDs that match the search query.'),
});
export type TextBasedSearchOutput = z.infer<typeof TextBasedSearchOutputSchema>;

export async function textBasedSearch(
  input: TextBasedSearchInput
): Promise<TextBasedSearchOutput> {
  return textBasedSearchFlow(input);
}

const prompt = ai.definePrompt({
  name: 'textBasedSearchPrompt',
  input: {schema: TextBasedSearchInputSchema},
  output: {schema: TextBasedSearchOutputSchema},
  prompt: `You are a fashion search engine. Given a user's query and a list of products, find the products that best match the query.

User Query:
"{{{query}}}"

Available Products:
${CATALOG_PROMPT_LIST}

Return a list of product IDs that are relevant to the user's query. Consider the product name, category, and other attributes. If no products match, return an empty array.
`,
});

const textBasedSearchFlow = ai.defineFlow(
  {
    name: 'textBasedSearchFlow',
    inputSchema: TextBasedSearchInputSchema,
    outputSchema: TextBasedSearchOutputSchema,
  },
  async input => {
    try {
      const {output} = await prompt(input);
      return output!;
    } catch (error) {
      console.error('Error in textBasedSearchFlow, returning empty results.', error);
      // Return an empty result set if the AI call fails for any reason
      return { results: [] };
    }
  }
);
