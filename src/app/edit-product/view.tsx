
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { DollarSign, Tag, Palette, Shirt, Building, Info, Phone, Loader2 } from 'lucide-react';
import { useProductStore } from '@/hooks/use-product-store';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { app } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { Product } from '@/lib/types';
import type { PreparedItemPhoto } from '@/lib/image';
import { CategoryField, ItemPhotoField } from '@/components/item-photo-field';


export default function EditProductView({ id }: { id: string | null }) {
    const { toast } = useToast();
    const router = useRouter();
    const { products, updateProduct } = useProductStore();

    const [photo, setPhoto] = useState<Partial<PreparedItemPhoto> | null>(null);
    const [isPreparingPhoto, setIsPreparingPhoto] = useState(false);
    const [category, setCategory] = useState('');
    const initialFormValues = {
        name: '',
        description: '',
        price: '',
        size: '',
        color: '',
        brand: '',
        condition: '',
        contact: '',
    };
    const [formValues, setFormValues] = useState(initialFormValues);

    const [user, setUser] = useState<User | null>(null);
    const { role } = useUserRoleStore();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loadedProductId, setLoadedProductId] = useState<string | null>(null);
    const product = products.find(p => p.id === id);

    useEffect(() => {
        const auth = getAuth(app);
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        // Fill the form once; later live updates must not overwrite the seller's unsaved edits.
        if (product && loadedProductId !== product.id) {
            setLoadedProductId(product.id);
            setFormValues({
                name: product.name,
                description: product.description || '',
                price: product.price.toString(),
                size: product.size || '',
                color: product.color || '',
                brand: product.brand || '',
                condition: product.condition || '',
                contact: product.contact || '',
            });
            setPhoto({ image: product.image, cutout: product.cutout, embedding: product.embedding });
            setCategory(product.category);
        }
    }, [product, loadedProductId]);


    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { id, value } = e.target;
        setFormValues(prev => ({...prev, [id]: value}));
    }


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (isSubmitting) return;

        if (!user || role !== 'seller' || !product || product.sellerId !== user.uid) {
            toast({
                variant: 'destructive',
                title: 'Access Denied',
                description: 'You do not have permission to edit products.',
            });
            return;
        }

        if (!photo?.image) {
            toast({ variant: 'destructive', title: 'Image Required', description: 'Please upload an image for your product.' });
            return;
        }
        
        setIsSubmitting(true);

        try {
            const updatedProduct: Product = {
                id: product.id,
                name: formValues.name,
                price: parseFloat(formValues.price),
                image: photo.image,
                cutout: photo.cutout,
                embedding: photo.embedding,
                category: category || product.category,
                seller: user?.displayName || 'Anonymous Seller',
                sellerEmail: user?.email || '',
                status: product.status,
                description: formValues.description,
                size: formValues.size,
                color: formValues.color,
                brand: formValues.brand,
                condition: formValues.condition,
                contact: formValues.contact,
                createdAt: product.createdAt || new Date().toISOString(),
            };

            await updateProduct(product.id, updatedProduct);

            toast({
                title: 'Product Updated!',
                description: 'Your item has been successfully updated.',
            });
            
            router.push('/dashboard/products');
        } catch (error) {
            console.error('Failed to update product:', error);
            toast({
                variant: 'destructive',
                title: 'Update Failed',
                description: 'Something went wrong. Please try again.',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

  return (
      <div className="container mx-auto max-w-3xl py-8 px-4 md:py-12">
        <Card>
          <CardHeader>
            <CardTitle className="text-3xl font-bold tracking-tight">Edit Your Item</CardTitle>
            <CardDescription>Update the details below for your product.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              
              <ItemPhotoField photo={photo} onPhotoChange={setPhoto} onBusyChange={setIsPreparingPhoto} />

              <CategoryField value={category} onChange={setCategory} />

              <div className="space-y-2">
                  <Label htmlFor="name" className="text-lg font-medium">Product Title</Label>
                  <div className="relative">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input id="name" placeholder="e.g., Vintage Denim Jacket" className="pl-10 h-12 text-base" required value={formValues.name} onChange={handleInputChange} />
                  </div>
              </div>

              <div className="space-y-2">
                  <Label htmlFor="description" className="text-lg font-medium">Description</Label>
                  <Textarea id="description" placeholder="Describe your item, its condition, material, etc." className="min-h-[120px] text-base" required value={formValues.description} onChange={handleInputChange} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                      <Label htmlFor="price" className="text-lg font-medium">Price</Label>
                      <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                          <Input id="price" type="number" step="0.01" placeholder="0.00" className="pl-10 h-12 text-base" required value={formValues.price} onChange={handleInputChange} />
                      </div>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="size" className="text-lg font-medium">Size</Label>
                      <div className="relative">
                          <Shirt className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                          <Input id="size" placeholder="e.g., Medium, 42, 10" className="pl-10 h-12 text-base" required value={formValues.size} onChange={handleInputChange} />
                      </div>
                  </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                      <Label htmlFor="color" className="text-lg font-medium">Color</Label>
                      <div className="relative">
                          <Palette className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                          <Input id="color" placeholder="e.g., Blue" className="pl-10 h-12 text-base" required value={formValues.color} onChange={handleInputChange}/>
                      </div>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="brand" className="text-lg font-medium">Brand</Label>
                      <div className="relative">
                          <Building className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                          <Input id="brand" placeholder="e.g., Levi's" className="pl-10 h-12 text-base" value={formValues.brand} onChange={handleInputChange}/>
                      </div>
                  </div>
              </div>

              <div className="space-y-2">
                  <Label htmlFor="condition" className="text-lg font-medium">Condition</Label>
                  <div className="relative">
                      <Info className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input id="condition" placeholder="e.g., New with tags, Like new, Used" className="pl-10 h-12 text-base" required value={formValues.condition} onChange={handleInputChange}/>
                  </div>
              </div>

              <div className="space-y-2">
                  <Label htmlFor="contact" className="text-lg font-medium">Contact Info</Label>
                  <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input id="contact" type="text" placeholder="Your phone, email, or chat link" className="h-12 text-base pl-10" required value={formValues.contact} onChange={handleInputChange}/>
                  </div>
              </div>
              
              <Button type="submit" size="lg" className="w-full text-lg h-14" disabled={isSubmitting || isPreparingPhoto}>
                  {isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : 'Save Changes'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
  );
}
