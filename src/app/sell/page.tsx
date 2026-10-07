
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

import { useAuth } from '@/components/auth/auth-provider';
import { LoginDialog } from '@/components/auth/login-dialog';
import { RegisterDialog } from '@/components/auth/register-dialog';
import { Product } from '@/lib/types';
import type { PreparedItemPhoto } from '@/lib/image';
import { CategoryField, ItemPhotoField } from '@/components/item-photo-field';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { isShopComplete } from '@/lib/types';


export default function SellPage() {
    const { toast } = useToast();
    const { addProduct } = useProductStore();
    const [photo, setPhoto] = useState<PreparedItemPhoto | null>(null);
    const [isPreparingPhoto, setIsPreparingPhoto] = useState(false);
    const [category, setCategory] = useState('');
    const initialFormValues = {
        title: '',
        description: '',
        price: '',
        size: '',
        color: '',
        brand: '',
        condition: '',
        contact: '',
    };
    const [formValues, setFormValues] = useState(initialFormValues);

    const { user } = useAuth();
    const { role, shop } = useUserRoleStore();
    const hasShop = isShopComplete(shop);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [loginOpen, setLoginOpen] = useState(false);
    const [registerOpen, setRegisterOpen] = useState(false);
    

    const openRegister = () => {
        setLoginOpen(false);
        setTimeout(() => setRegisterOpen(true), 150);
      };
    
    const openLogin = () => {
        setRegisterOpen(false);
        setTimeout(() => setLoginOpen(true), 150);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { id, value } = e.target;
        setFormValues(prev => ({...prev, [id]: value}));
    }

    const resetForm = () => {
        setFormValues(initialFormValues);
        setPhoto(null);
        setCategory('');
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (isSubmitting) return;

        if (!user) {
            setLoginOpen(true);
            return;
        }

        if (role !== 'seller') {
            toast({
                variant: 'destructive',
                title: 'Access Denied',
                description: 'Only sellers can list products. Please log in as a seller.',
            });
            return;
        }

        if (!hasShop) {
            toast({ variant: 'destructive', title: 'Shop address required', description: 'Add your shop name and full address in Settings before listing.' });
            return;
        }

        if (!photo) {
            toast({ variant: 'destructive', title: 'Image Required', description: 'Please upload an image for your product.' });
            return;
        }

        if (!category) {
            toast({ variant: 'destructive', title: 'Category Required', description: 'Please choose what kind of item this is.' });
            return;
        }
        
        setIsSubmitting(true);

        try {
            const newProduct: Omit<Product, 'id'> = {
                name: formValues.title,
                price: parseFloat(formValues.price),
                image: photo.image,
                cutout: photo.cutout,
                embedding: photo.embedding,
                category,
                seller: user?.displayName || 'Anonymous Seller',
                sellerEmail: user?.email || '',
                status: 'active' as const,
                description: formValues.description,
                size: formValues.size,
                color: formValues.color,
                brand: formValues.brand,
                condition: formValues.condition,
                contact: formValues.contact,
                createdAt: new Date().toISOString(),
            };

            await addProduct(newProduct);

            toast({
                title: 'Product Listed!',
                description: 'Your item is now available on the marketplace.',
            });
            
            resetForm();
        } catch (error) {
            console.error('Failed to list product:', error);
            toast({
                variant: 'destructive',
                title: 'Listing Failed',
                description: 'Something went wrong. Please try again.',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

  return (
    <>
      <div className="container mx-auto max-w-3xl py-8 px-4 md:py-12">
        <Card>
          <CardHeader>
            <CardTitle className="text-3xl font-bold tracking-tight">List Your Item</CardTitle>
            <CardDescription>Fill out the details below to put your fashion item up for sale.</CardDescription>
          </CardHeader>
          <CardContent>
            {user && role === 'seller' && !hasShop && (
              <div className="mb-6 flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center">
                <MapPin className="h-6 w-6 shrink-0 text-primary" />
                <p className="flex-1 text-sm">Add your shop name and full address first. Buyers see it on every item you sell.</p>
                <Button asChild size="sm"><Link href="/dashboard/settings">Add shop address</Link></Button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-6">
              
              <ItemPhotoField photo={photo} onPhotoChange={setPhoto} onBusyChange={setIsPreparingPhoto} />

              <CategoryField value={category} onChange={setCategory} />

              <div className="space-y-2">
                  <Label htmlFor="title" className="text-lg font-medium">Product Title</Label>
                  <div className="relative">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input id="title" placeholder="e.g., Vintage Denim Jacket" className="pl-10 h-12 text-base" required value={formValues.title} onChange={handleInputChange} />
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
                  {isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : 'List Product'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={openRegister} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={openLogin} />
    </>
  );
}
