
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
});
export type ImageBasedStyleMatchingInput = z.infer<typeof ImageBasedStyleMatchingInputSchema>;

const ImageBasedStyleMatchingOutputSchema = z.object({
  similarItems: z
    .array(z.string())
    .describe('A list of URLs of visually similar clothing items.'),
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
  prompt: `You are a fashion AI assistant. Given an image of a clothing item or outfit, and optional filters, find visually similar items available for purchase online.

Use the user's text description and other filters to refine the search. For example, if the user provides an image of a red shirt and says "I want this in blue", you should look for blue shirts in a similar style.

Consider the following when finding similar items:

*   **Style**: Match the overall style of the clothing item (e.g., casual, formal, vintage, modern).
*   **Type**: Match the type of clothing item (e.g., shirt, dress, pants, shoes).
*   **Color**: Prioritize the color from the color filter if provided. Otherwise, match the color from the image.
*   **Pattern**: Match the pattern of the clothing item.
*   **Material**: Match the material of the clothing item.

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

Return a list of URLs for visually similar items. If no items match, return an empty array. Output a JSON array of URLs:
`,
});

const imageBasedStyleMatchingFlow = ai.defineFlow(
  {
    name: 'imageBasedStyleMatchingFlow',
    inputSchema: ImageBasedStyleMatchingInputSchema,
    outputSchema: ImageBasedStyleMatchingOutputSchema,
  },
  async input => {
    try {
      const {output} = await prompt(input);
      return output!;
    } catch (error) {
      console.error('Error in imageBasedStyleMatchingFlow, returning empty results.', error);
      // Return an empty result set if the AI call fails for any reason
      return { similarItems: [] };
    }
  }
);
