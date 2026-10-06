
'use client';

import { create } from 'zustand';
import type { Product } from '@/lib/types';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

interface ProductState {
  products: Product[];
  isInitialized: boolean;
  error: string | null;
  addProduct: (item: Omit<Product, 'id'>) => Promise<string>;
  updateProduct: (id: string, updatedProduct: Product) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  archiveProduct: (id: string) => Promise<void>;
}

const productsCollection = collection(db, 'products');

// Firestore rejects `undefined` values, so drop them before writing.
function withoutUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export const useProductStore = create<ProductState>()(() => ({
  products: [],
  isInitialized: false,
  error: null,
  addProduct: async (item) => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('You must be logged in to list a product.');
    const ref = doc(productsCollection);
    await setDoc(ref, withoutUndefined({ ...item, sellerId: uid, status: 'active' }));
    return ref.id;
  },
  updateProduct: async (id, updatedProduct) => {
    // id and sellerId are never changed by an edit.
    const { id: _id, sellerId: _sellerId, ...fields } = updatedProduct;
    await updateDoc(doc(productsCollection, id), withoutUndefined(fields));
  },
  deleteProduct: async (id) => {
    await deleteDoc(doc(productsCollection, id));
  },
  archiveProduct: async (id) => {
    await updateDoc(doc(productsCollection, id), { status: 'archived' });
  },
}));

// Keeps the store in sync with the shared `products` collection. Returns an unsubscribe function.
export function subscribeToProducts() {
  const q = query(productsCollection, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const products = snapshot.docs.map((d) => ({ ...(d.data() as Omit<Product, 'id'>), id: d.id }));
      useProductStore.setState({ products, isInitialized: true, error: null });
    },
    (error) => {
      console.error('Failed to load products:', error);
      useProductStore.setState({ isInitialized: true, error: error.message });
    }
  );
}
