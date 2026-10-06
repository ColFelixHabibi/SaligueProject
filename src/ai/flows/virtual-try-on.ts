
'use server';
/**
 * @fileOverview An AI agent that creates a virtual try-on image.
 *
 * - virtualTryOn - A function that handles the virtual try-on process.
 * - VirtualTryOnInput - The input type for the virtualTryOn function.
 * - VirtualTryOnOutput - The return type for the virtualTryOn function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const VirtualTryOnInputSchema = z.object({
  personPhotoDataUri: z
    .string()
    .describe(
      "A photo of a person, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  clothingPhotoDataUri: z
    .string()
    .describe(
      "A photo of a clothing item, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  description: z
    .string()
    .optional()
    .describe('An optional text description to guide the image generation (e.g., style, pose, background).'),
});
export type VirtualTryOnInput = z.infer<typeof VirtualTryOnInputSchema>;

const VirtualTryOnOutputSchema = z.object({
  tryOnImageDataUri: z.string().describe('The generated try-on image as a data URI.'),
});
export type VirtualTryOnOutput = z.infer<typeof VirtualTryOnOutputSchema>;

export async function virtualTryOn(input: VirtualTryOnInput): Promise<VirtualTryOnOutput> {
  return virtualTryOnFlow(input);
}

const virtualTryOnFlow = ai.defineFlow(
  {
    name: 'virtualTryOnFlow',
    inputSchema: VirtualTryOnInputSchema,
    outputSchema: VirtualTryOnOutputSchema,
  },
  async ({personPhotoDataUri, clothingPhotoDataUri, description}) => {
    try {
      const prompt = `You are a virtual fashion assistant. You will be given two images: one of a person and one of a clothing item. Your task is to generate a new image where the person is realistically wearing the clothing item.

Make sure the clothing fits the person's body shape and pose naturally. The lighting and shadows in the final image should be consistent.

${description ? `The user has provided the following guidance for the final image: "${description}". Please incorporate this into the final result, considering aspects like pose, background, style, and overall composition.` : 'Use a clean, neutral background unless the user specifies otherwise.'}

Person Image: The subject for the final image.
Clothing Image: The item to be worn by the subject.

Generate the final try-on image and return it as a data URI.`;


      const {media} = await ai.generate({
        model: 'googleai/gemini-2.5-flash-image-preview',
        prompt: [
          {media: {url: personPhotoDataUri}},
          {media: {url: clothingPhotoDataUri}},
          {text: prompt},
        ],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      });

      if (!media?.url) {
        // Fallback to a placeholder if image generation fails for other reasons
        return { tryOnImageDataUri: 'https://picsum.photos/seed/tryon-fail/600/800' };
      }
      
      return { tryOnImageDataUri: media.url };

    } catch (error) {
      console.error('Virtual try-on failed, falling back to placeholder.', error);
      // Fallback to a placeholder if an exception occurs (e.g., rate limiting)
      return { tryOnImageDataUri: 'https://picsum.photos/seed/tryon-error/600/800' };
    }
  }
);
