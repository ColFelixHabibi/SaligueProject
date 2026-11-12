import { api } from './api';

/**
 * Counts a view for the shop's dashboard (Seller Center → Products, Views). The server keeps one per person, item
 * and day, and never counts the shop looking at its own item (server/index.mjs, /api/products/:id/view).
 * A view is: opening the item's page, opening it on the INDECIANA house page, or watching it 2 seconds in the feed.
 */
export const countView = (productId: string) => void api(`/products/${productId}/view`, { body: {} }).catch(() => {});
