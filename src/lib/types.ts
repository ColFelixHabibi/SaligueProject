
export type Product = {
  id: string;
  name: string;
  price: number;
  image: string;
  category: string;
  seller: string;
  sellerEmail?: string;
  status: 'active' | 'archived' | 'draft';
  description?: string;
  size?: string;
  color?: string;
  brand?: string;
  condition?: string;
  contact?: string;
  createdAt?: string;
};
