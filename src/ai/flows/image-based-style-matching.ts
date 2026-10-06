
'use server';
/**
 * @fileOverview An AI agent that matches clothing styles based on uploaded images.
 *
 * - imageBasedStyleMatching - A function that handles the style matching process.
 * - ImageBasedStyleMatchingInput - The input type for the imageBasedStyleMatching function.
 * - ImageBasedStyleMatchingOutput - The return type for the imageBasedStyleMatching function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {CatalogItemSchema, CATALOG_PROMPT_LIST} from '@/ai/catalog';

const ImageBasedStyleMatchingInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of a clothing item or outfit, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  description: z
    .string()
    .optional()
    .describe('Optional text description to refine the search (e.g., color, size, style).'),
  brand: z.string().optional().describe('Filter by brand.'),
  category: z.string().optional().describe('Filter by category (e.g., Shirts, Shoes).'),
  size: z.string().optional().describe('Filter by size.'),
  color: z.string().optional().describe('Filter by color.'),
  products: z.array(CatalogItemSchema).describe('The Saligue products to match against.'),
});
export type ImageBasedStyleMatchingInput = z.infer<typeof ImageBasedStyleMatchingInputSchema>;

const ImageBasedStyleMatchingOutputSchema = z.object({
  results: z
    .array(z.object({id: z.string().describe('The ID of a matching product.')}))
    .describe('Matching products, best match first.'),
});
export type ImageBasedStyleMatchingOutput = z.infer<typeof ImageBasedStyleMatchingOutputSchema>;

export async function imageBasedStyleMatching(
  input: ImageBasedStyleMatchingInput
): Promise<ImageBasedStyleMatchingOutput> {
  return imageBasedStyleMatchingFlow(input);
}

const prompt = ai.definePrompt({
  name: 'imageBasedStyleMatchingPrompt',
  input: {schema: ImageBasedStyleMatchingInputSchema},
  output: {schema: ImageBasedStyleMatchingOutputSchema},
  prompt: `You are a fashion AI assistant for the Saligue marketplace. Given a photo of a clothing item or outfit and optional filters, pick the products from the Saligue catalog below that are most similar.

Use the user's text description and other filters to refine the match. For example, if the photo shows a red shirt and the user says "I want this in blue", prefer blue shirts in a similar style.

Consider the following when matching:

*   **Type**: Match the type of clothing item (e.g., shirt, dress, pants, shoes).
*   **Style**: Match the overall style (e.g., casual, formal, vintage, modern).
*   **Color**: Prioritize the color from the color filter if provided. Otherwise, match the color from the photo.
*   **Pattern and material**: Prefer items whose description suggests a similar pattern or material.

Here are the user's search criteria:
Photo: {{media url=photoDataUri}}
{{#if description}}
Description: {{{description}}}
{{/if}}
{{#if brand}}
Brand: {{{brand}}}
{{/if}}
{{#if category}}
Category: {{{category}}}
{{/if}}
{{#if size}}
Size: {{{size}}}
{{/if}}
{{#if color}}
Color: {{{color}}}
{{/if}}

Saligue catalog:
${CATALOG_PROMPT_LIST}

Return the IDs of the matching products, best match first. Only use IDs from the catalog. If nothing is reasonably similar, return an empty array.
`,
});

const imageBasedStyleMatchingFlow = ai.defineFlow(
  {
    name: 'imageBasedStyleMatchingFlow',
    inputSchema: ImageBasedStyleMatchingInputSchema,
    outputSchema: ImageBasedStyleMatchingOutputSchema,
  },
  async input => {
    if (input.products.length === 0) {
      return { results: [] };
    }
    try {
      const {output} = await prompt(input);
      return output!;
    } catch (error) {
      console.error('Error in imageBasedStyleMatchingFlow, returning empty results.', error);
      // Return an empty result set if the AI call fails for any reason
      return { results: [] };
    }
  }
);
