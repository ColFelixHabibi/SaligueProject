
'use client';

import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { VideoField, uploadItemVideo } from '@/components/video-field';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { DollarSign, Tag, Palette, Shirt, Building, Info, Phone, Loader2, Boxes } from 'lucide-react';
import { ensureProduct, useProductStore } from '@/hooks/use-product-store';
import { useUserRoleStore } from '@/hooks/use-user-role-store';

import { useAuth } from '@/components/auth/auth-provider';
import { useRouter } from 'next/navigation';
import type { ProductInput } from '@/lib/types';
import type { PreparedItemPhoto } from '@/lib/image';
import { CategoryField, ItemPhotoField } from '@/components/item-photo-field';
import { WriteWithAi } from '@/components/write-with-ai';
import { SoundField, type ChosenSound } from '@/components/sound-field';
import { makeClip, saveProductSound } from '@/lib/audio';
import { formatPrice, salePrice } from '@/lib/orders';


export default function EditProductView({ id }: { id: string | null }) {
    const { toast } = useToast();
    const router = useRouter();
    const { products, updateProduct } = useProductStore();

    const [photo, setPhoto] = useState<Partial<PreparedItemPhoto> | null>(null);
    const [photoType, setPhotoType] = useState<'item' | 'worn'>('item');
    const [video, setVideo] = useState<File | null>(null);
    const [uploading, setUploading] = useState<number | null>(null);
    const [isPreparingPhoto, setIsPreparingPhoto] = useState(false);
    const [category, setCategory] = useState('');
    const [type, setType] = useState('');
    // A new sound replaces the current one; leaving it empty keeps the current sound.
    const [sound, setSound] = useState<ChosenSound | null>(null);
    const initialFormValues = {
        name: '',
        description: '',
        price: '',
        discount: '',
        size: '',
        color: '',
        brand: '',
        condition: '',
        contact: '',
        stock: '',
    };
    const [formValues, setFormValues] = useState(initialFormValues);

    const { user } = useAuth();
    const { role } = useUserRoleStore();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loadedProductId, setLoadedProductId] = useState<string | null>(null);
    const product = products.find(p => p.id === id);
    useEffect(() => {
      if (id && !product) void ensureProduct(id);
    }, [id, product]);


    useEffect(() => {
        // Fill the form once; later live updates must not overwrite the seller's unsaved edits.
        if (product && loadedProductId !== product.id) {
            setLoadedProductId(product.id);
            setFormValues({
                name: product.name,
                description: product.description || '',
                // The shop edits its own usual price: during a sale or a live deal the app shows the lower one,
                // so prefilling that would make the discount preview count twice.
                price: (product.discount?.was ?? product.deal?.was ?? product.price).toString(),
                discount: product.discount?.percent ? String(product.discount.percent) : '',
                size: product.size || '',
                color: product.color || '',
                brand: product.brand || '',
                condition: product.condition || '',
                contact: product.contact || '',
                stock: product.stock == null ? '' : String(product.stock),
            });
            setPhoto({ image: product.image, cutout: product.cutout, embedding: product.embedding });
            setCategory(product.category);
            setType(product.type ?? '');
            setPhotoType(product.photoType ?? 'item');
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
            const updatedProduct: ProductInput = {
                name: formValues.name,
                price: parseFloat(formValues.price),
                // A % off the shop puts on the post: the shopper is shown the usual price crossed out.
                discountPercent: formValues.discount === '' ? null : Number(formValues.discount),
                image: photo.image,
                cutout: photo.cutout,
                photoType,
                embedding: photo.embedding,
                category: category || product.category,
                type: type || product.type,
                seller: user?.displayName || 'Anonymous Seller',
                sellerEmail: user?.email || '',
                status: product.status,
                description: formValues.description,
                size: formValues.size,
                color: formValues.color,
                brand: formValues.brand,
                condition: formValues.condition,
                contact: formValues.contact,
                stock: formValues.stock === '' ? null : Math.max(0, Math.floor(Number(formValues.stock))),
                createdAt: product.createdAt || new Date().toISOString(),
            };

            if (sound) {
                const clip = await makeClip(sound.buffer, sound.start);
                updatedProduct.sound = { name: sound.name, duration: Math.round(clip.duration) };
                await saveProductSound(product.id, sound.name, clip);
            } else if (product.sound) {
                updatedProduct.sound = product.sound;
            }
            await updateProduct(product.id, updatedProduct);
            if (video) {
                setUploading(0);
                try {
                    await uploadItemVideo(product.id, video, setUploading);
                    setVideo(null);
                } catch (error) {
                    toast({ variant: 'destructive', title: 'Video not added', description: friendlyError(error) });
                } finally {
                    setUploading(null);
                }
            }

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
              
              <ItemPhotoField photo={photo} photoType={photoType} onPhotoTypeChange={setPhotoType} onPhotoChange={setPhoto} onBusyChange={setIsPreparingPhoto} />

              <VideoField file={video} onChange={setVideo} uploading={uploading} existing={product?.video ?? null}
                onRemoveExisting={() => product && api(`/products/${product.id}/video`, { method: 'DELETE' }).then(() => toast({ title: 'Video removed' })).catch((e) => toast({ variant: 'destructive', title: 'Not removed', description: friendlyError(e) }))} />

              <CategoryField value={category} onChange={setCategory} type={type} onTypeChange={setType} />

              {product?.sound && !sound && <p className="text-sm text-muted-foreground">Current sound: ♪ {product.sound.name}. Choose another below to replace it.</p>}
              <SoundField value={sound} onChange={setSound} />

              <div className="space-y-2">
                  <Label htmlFor="name" className="text-lg font-medium">Product Title</Label>
                  <div className="relative">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input id="name" placeholder="e.g., Vintage Denim Jacket" className="pl-10 h-12 text-base" required value={formValues.name} onChange={handleInputChange} />
                  </div>
              </div>

              <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="description" className="text-lg font-medium">Description</Label>
                      {/* Written from the details above, so nothing has to be invented. */}
                      <WriteWithAi
                          hasText={!!formValues.description.trim()}
                          facts={{
                              title: formValues.name,
                              category,
                              type,
                              brand: formValues.brand,
                              size: formValues.size,
                              color: formValues.color,
                              condition: formValues.condition,
                          }}
                          onWrite={(text) => setFormValues((prev) => ({ ...prev, description: text }))}
                      />
                  </div>
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

              {/* A % off is kept on the post: shoppers see the usual price crossed out beside the lower one. */}
              <div className="space-y-2">
                  <Label htmlFor="discount" className="text-lg font-medium">Discount (% off)</Label>
                  <div className="relative">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input id="discount" type="number" min="0" max="90" step="1" placeholder="0 — no discount" className="pl-10 h-12 text-base" value={formValues.discount} onChange={handleInputChange} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                      {Number(formValues.discount) > 0 && Number(formValues.price) > 0
                          ? `Shoppers pay ${formatPrice(salePrice(Number(formValues.price), Number(formValues.discount)))} and see ${formatPrice(Number(formValues.price))} crossed out.`
                          : 'Leave it empty for the usual price. Up to 90%.'}
                  </p>
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
                  <Label htmlFor="stock" className="text-lg font-medium">Quantity in stock</Label>
                  <div className="relative">
                      <Boxes className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input id="stock" type="number" min="0" step="1" placeholder="Leave empty if you don't count" className="pl-10 h-12 text-base" value={formValues.stock} onChange={handleInputChange}/>
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
