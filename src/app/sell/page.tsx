
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Upload, DollarSign, Tag, Palette, Shirt, Building, Info, Phone, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useProductStore } from '@/hooks/use-product-store';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { app } from '@/lib/firebase';
import { LoginDialog } from '@/components/auth/login-dialog';
import { RegisterDialog } from '@/components/auth/register-dialog';
import { Product } from '@/lib/types';
import { compressImage } from '@/lib/image';


export default function SellPage() {
    const { toast } = useToast();
    const { addProduct } = useProductStore();
    const [imagePreview, setImagePreview] = useState<string | null>(null);
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

    const [user, setUser] = useState<User | null>(null);
    const { role } = useUserRoleStore();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [loginOpen, setLoginOpen] = useState(false);
    const [registerOpen, setRegisterOpen] = useState(false);
    
    useEffect(() => {
        const auth = getAuth(app);
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
        });
        return () => unsubscribe();
    }, []);

    const openRegister = () => {
        setLoginOpen(false);
        setTimeout(() => setRegisterOpen(true), 150);
      };
    
    const openLogin = () => {
        setRegisterOpen(false);
        setTimeout(() => setLoginOpen(true), 150);
    };

    const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                setImagePreview(await compressImage(file));
            } catch (error: any) {
                toast({ variant: 'destructive', title: 'Image Error', description: error.message });
            }
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { id, value } = e.target;
        setFormValues(prev => ({...prev, [id]: value}));
    }

    const resetForm = () => {
        setFormValues(initialFormValues);
        setImagePreview(null);
        // Reset file input
        const fileInput = document.getElementById('image-upload') as HTMLInputElement;
        if (fileInput) {
            fileInput.value = '';
        }
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

        if (!imagePreview) {
            toast({ variant: 'destructive', title: 'Image Required', description: 'Please upload an image for your product.' });
            return;
        }
        
        setIsSubmitting(true);

        try {
            const newProduct: Omit<Product, 'id'> = {
                name: formValues.title,
                price: parseFloat(formValues.price),
                image: imagePreview,
                category: 'New', // Simplified for now
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
            <form onSubmit={handleSubmit} className="space-y-6">
              
              <div className="space-y-2">
                  <Label htmlFor="image-upload" className="text-lg font-medium">Product Image</Label>
                  <label htmlFor="image-upload" className="relative block w-full h-80 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary transition-colors flex items-center justify-center text-muted-foreground bg-muted/20">
                      {imagePreview ? (
                          <Image src={imagePreview} alt="Preview" layout="fill" className="object-contain rounded-lg p-2" />
                      ) : (
                      <div className="flex flex-col items-center">
                          <Upload className="h-12 w-12 mb-2" />
                          <span>Click or drag to upload a full-standing image</span>
                          <span className="text-sm">PNG, JPG, WEBP up to 5MB</span>
                      </div>
                      )}
                  </label>
                  <Input id="image-upload" type="file" className="sr-only" accept="image/*" onChange={handleImageFileChange} required/>
              </div>

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
              
              <Button type="submit" size="lg" className="w-full text-lg h-14" disabled={isSubmitting}>
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
