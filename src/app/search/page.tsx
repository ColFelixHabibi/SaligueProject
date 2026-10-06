
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, Loader2, Search, Sparkles, Filter } from 'lucide-react';
import ProductCard from '@/components/product-card';
import { imageBasedStyleMatching, type ImageBasedStyleMatchingOutput, type ImageBasedStyleMatchingInput } from '@/ai/flows/image-based-style-matching';
import { textBasedSearch, type TextBasedSearchOutput } from '@/ai/flows/text-based-search';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Product } from '@/lib/types';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useSearchParams } from 'next/navigation';
import debounce from 'lodash.debounce';
import { useProductStore } from '@/hooks/use-product-store';

const AdvancedFilters = ({ filters, onFilterChange }: { filters: any, onFilterChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
   <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="w-full">
          <Filter className="mr-2 h-4 w-4" />
          Advanced Filters
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 p-4 border rounded-md">
              <div className="space-y-2">
                  <Label htmlFor="brand">Brand</Label>
                  <Input id="brand" name="brand" placeholder="e.g., Nike, Levi's" value={filters.brand} onChange={onFilterChange} />
              </div>
              <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Input id="category" name="category" placeholder="e.g., Shirts, Shoes" value={filters.category} onChange={onFilterChange} />
              </div>
              <div className="space-y-2">
                  <Label htmlFor="size">Size</Label>
                  <Input id="size" name="size" placeholder="e.g., Medium, 42" value={filters.size} onChange={onFilterChange} />
              </div>
              <div className="space-y-2">
                  <Label htmlFor="color">Color</Label>
                  <Input id="color" name="color" placeholder="e.g., Blue, Red" value={filters.color} onChange={onFilterChange} />
              </div>
          </div>
      </CollapsibleContent>
    </Collapsible>
  );
}


export default function SearchPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const { products: userProducts } = useProductStore();

  const allProducts = useMemo(() => [...userProducts], [userProducts]);
  
  // Text search state
  const [textSearchQuery, setTextSearchQuery] = useState(searchParams.get('q') || '');
  const [isTextSearching, setIsTextSearching] = useState(false);
  const [textSearchResults, setTextSearchResults] = useState<Product[]>([]);
  const [textFilters, setTextFilters] = useState({ brand: '', category: '', size: '', color: '' });
  
  // Image search state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageSearchDescription, setImageSearchDescription] = useState('');
  const [imageSearchResults, setImageSearchResults] = useState<ImageBasedStyleMatchingOutput | null>(null);
  const [isImageSearching, setIsImageSearching] = useState(false);
  const [imageFilters, setImageFilters] = useState({ brand: '', category: '', size: '', color: '' });
  
  const [hasSearched, setHasSearched] = useState(false);

  const handleTextFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setTextFilters(prev => ({ ...prev, [name]: value }));
  };
  
  const handleImageFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setImageFilters(prev => ({ ...prev, [name]: value }));
  };

  const performTextSearch = useCallback(async (query: string, currentFilters: typeof textFilters) => {
    if (!query.trim() && Object.values(currentFilters).every(f => !f)) {
      setTextSearchResults([]);
      setHasSearched(false);
      return;
    };
    
    setIsTextSearching(true);
    setHasSearched(true);

    try {
      const combinedQuery = [
        query,
        ...Object.entries(currentFilters)
          .filter(([, value]) => value)
          .map(([key, value]) => `${key}: ${value}`)
      ].join(', ');
      
      const result = await textBasedSearch({
        query: combinedQuery,
        products: allProducts,
      });

      if (result && result.results) {
        const foundProducts = result.results
          .map(item => allProducts.find(p => p.id === item.id))
          .filter((p): p is Product => p !== undefined);
        setTextSearchResults(foundProducts);
      } else {
        setTextSearchResults([]);
      }
    } catch (error) {
       console.error("AI search failed, showing no results:", error);
       setTextSearchResults([]);
    } finally {
      setIsTextSearching(false);
    }
  }, [allProducts]);

  const debouncedTextSearch = useMemo(() => {
      return debounce(performTextSearch, 500);
  }, [performTextSearch]);

  useEffect(() => {
    const initialQuery = searchParams.get('q');
    if (initialQuery) {
        performTextSearch(initialQuery, textFilters);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
      debouncedTextSearch(textSearchQuery, textFilters);
      return () => {
          debouncedTextSearch.cancel();
      };
  }, [textSearchQuery, textFilters, debouncedTextSearch]);


  const handleTextSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    debouncedTextSearch.cancel();
    performTextSearch(textSearchQuery, textFilters);
  };


  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImageSearchResults(null);
      setHasSearched(false);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageSearch = async () => {
    if (!imageFile || !imagePreview) return;
    setIsImageSearching(true);
    setImageSearchResults(null);
    setHasSearched(true);
    try {
      const input: ImageBasedStyleMatchingInput = {
        photoDataUri: imagePreview,
        description: imageSearchDescription,
        ...imageFilters,
      };

      const result = await imageBasedStyleMatching(input);
      setImageSearchResults(result);
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to match style. Please try again.',
      });
    } finally {
      setIsImageSearching(false);
    }
  };
  
  const showTextNoResults = hasSearched && !isTextSearching && textSearchResults.length === 0 && (textSearchQuery || Object.values(textFilters).some(f => f));
  const showImageNoResults = hasSearched && !isImageSearching && (imageSearchResults?.similarItems.length ?? 0) === 0 && imageFile;


  return (
    <div className="container mx-auto py-8 px-4 md:py-12">
        <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight font-headline text-primary">Find Your Style</h1>
            <p className="mt-4 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Use our powerful AI search to find fashion items by text or by uploading an image.
            </p>
        </div>

      <Card id="search-section" className="max-w-3xl mx-auto mb-16 shadow-lg border-2 border-primary/10">
        <Tabs defaultValue="text-search" className="w-full">
          <TabsList className="grid w-full grid-cols-2 h-14">
            <TabsTrigger value="image-search" className="h-full text-base">
              <Sparkles className="mr-2 h-5 w-5" /> Visual Search
            </TabsTrigger>
            <TabsTrigger value="text-search" className="h-full text-base">
              <Search className="mr-2 h-5 w-5" /> Text Search
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="text-search" className="p-6 space-y-4">
            <form onSubmit={handleTextSearchSubmit} className="flex flex-col gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="e.g., 'red leather jacket'"
                  value={textSearchQuery}
                  onChange={(e) => setTextSearchQuery(e.target.value)}
                  className="h-12 text-lg pl-10"
                />
              </div>
              <AdvancedFilters 
                filters={textFilters}
                onFilterChange={handleTextFilterChange}
              />
            </form>
          </TabsContent>

          <TabsContent value="image-search" className="p-6 space-y-4 text-center">
            <div className="mx-auto w-full max-w-md">
              <label htmlFor="image-upload" className="relative block w-full h-64 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary transition-colors flex items-center justify-center text-muted-foreground">
                {imagePreview ? (
                  <Image src={imagePreview} alt="Preview" fill className="object-contain rounded-lg p-2" />
                ) : (
                  <div className="flex flex-col items-center">
                    <Upload className="h-12 w-12 mb-2" />
                    <span>Click to upload an image</span>
                    <span className="text-sm">PNG, JPG, WEBP</span>
                  </div>
                )}
              </label>
              <Input id="image-upload" type="file" className="sr-only" accept="image/*" onChange={handleImageFileChange} />
            </div>

            <div className="space-y-2 text-left">
                <Label htmlFor="image-description">Describe what you want (optional)</Label>
                <Textarea
                    id="image-description"
                    placeholder="e.g., 'I want this shirt but in blue' or 'a more casual style'"
                    value={imageSearchDescription}
                    onChange={(e) => setImageSearchDescription(e.target.value)}
                />
            </div>
            
            <div className="w-full text-left">
               <AdvancedFilters 
                filters={imageFilters}
                onFilterChange={handleImageFilterChange}
              />
            </div>

            <Button onClick={handleImageSearch} size="lg" className="mt-2 w-full" disabled={isImageSearching || !imageFile}>
              {isImageSearching ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Sparkles className="mr-2 h-5 w-5" />}
              Find Similar Styles
            </Button>
          </TabsContent>
        </Tabs>
      </Card>
      
      {(hasSearched || isTextSearching || isImageSearching) && (
        <div className="mb-16">
          <h2 className="text-3xl font-bold text-center mb-8">Search Results</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {isTextSearching || isImageSearching ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-64 w-full" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))
            ) : textSearchResults.length > 0 ? (
              textSearchResults.map((product) => <ProductCard key={product.id} product={product} />)
            ) : imageSearchResults?.similarItems.length ?? 0 > 0 ? (
              imageSearchResults?.similarItems.map((url, i) => (
                <Card key={i} className="overflow-hidden group">
                  <Image src={url} alt={`Similar item ${i + 1}`} width={400} height={500} className="object-cover w-full h-80 transition-transform duration-300 group-hover:scale-105" data-ai-hint="fashion style" />
                </Card>
              ))
            ) : null}
          </div>
           {showTextNoResults && (
             <p className="text-center text-muted-foreground mt-8">No results found for your search.</p>
           )}
           {showImageNoResults && (
             <p className="text-center text-muted-foreground mt-8">No results. Please try another image.</p>
           )}
        </div>
      )}
    </div>
  );
}
