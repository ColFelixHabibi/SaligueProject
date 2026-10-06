'use server';

/**
 * @fileOverview Recommends trending looks and outfit combinations based on user preferences.
 *
 * - getOutfitRecommendation - A function that handles the outfit recommendation process.
 * - OutfitRecommendationInput - The input type for the getOutfitRecommendation function.
 * - OutfitRecommendationOutput - The return type for the getOutfitRecommendation function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {CatalogItemSchema, CATALOG_PROMPT_LIST} from '@/ai/catalog';

const OutfitRecommendationInputSchema = z.object({
  userPreferences: z
    .string()
    .describe('The user preferences for outfits, including style, color, and occasion.'),
  products: z.array(CatalogItemSchema).describe('A list of available products to create the outfit from.'),
});
export type OutfitRecommendationInput = z.infer<typeof OutfitRecommendationInputSchema>;

const RecommendedProductSchema = z.object({
  id: z.string().describe('The ID of the recommended product.'),
  name: z.string().describe('The name of the recommended product.'),
});

const OutfitRecommendationOutputSchema = z.object({
  outfit: z
    .array(RecommendedProductSchema)
    .describe('An array of products that make up the recommended outfit.'),
  reasoning: z
    .string()
    .describe('Reasoning behind why these items were chosen for the outfit.'),
});
export type OutfitRecommendationOutput = z.infer<typeof OutfitRecommendationOutputSchema>;

export async function getOutfitRecommendation(
  input: OutfitRecommendationInput
): Promise<OutfitRecommendationOutput> {
  return outfitRecommendationFlow(input);
}

const prompt = ai.definePrompt({
  name: 'outfitRecommendationPrompt',
  input: {schema: OutfitRecommendationInputSchema},
  output: {schema: OutfitRecommendationOutputSchema},
  prompt: `You are a personal stylist providing outfit recommendations based on user preferences and a list of available products.

Your task is to create a complete outfit (top, bottom, shoes, and an accessory if possible) using ONLY the products from the provided list.

User Preferences:
"{{{userPreferences}}}"

Available Products:
${CATALOG_PROMPT_LIST}

Based on the user's preferences and the available products, construct an outfit.
1.  Select a few items from the product list that would form a stylish and coherent outfit.
2.  Provide a reasoning for your selection, explaining how it matches the user's preferences.
3.  Return the outfit as an array of objects, where each object contains the 'id' and 'name' of the recommended product.
`,
});

const outfitRecommendationFlow = ai.defineFlow(
  {
    name: 'outfitRecommendationFlow',
    inputSchema: OutfitRecommendationInputSchema,
    outputSchema: OutfitRecommendationOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
