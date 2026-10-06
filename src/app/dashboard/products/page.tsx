
'use client';

import * as React from 'react';
import Image from 'next/image';
import {
  File,
  ListFilter,
  MoreHorizontal,
  PlusCircle,
  Archive,
  Trash2,
  Edit,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import Link from 'next/link';
import { useProductStore } from '@/hooks/use-product-store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Product } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useDashboardSearchStore } from '@/hooks/use-dashboard-search-store';
import { format } from 'date-fns';
import { useAuth } from '@/components/auth/auth-provider';


export default function ProductsPage() {
  const { products: allProducts, archiveProduct, deleteProduct, isInitialized } = useProductStore();
  const { user } = useAuth();
  const products = React.useMemo(
    () => allProducts.filter(p => p.sellerId === user?.uid),
    [allProducts, user]
  );
  const { toast } = useToast();
  const { searchQuery } = useDashboardSearchStore();
  
  const [showArchiveDialog, setShowArchiveDialog] = React.useState(false);
  const [productToArchive, setProductToArchive] = React.useState<Product | null>(null);

  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [productToDelete, setProductToDelete] = React.useState<Product | null>(null);

  const [activeTab, setActiveTab] = React.useState('all');

  const handleArchiveClick = (product: Product) => {
    setProductToArchive(product);
    setShowArchiveDialog(true);
  };

  const handleConfirmArchive = async () => {
    if (productToArchive) {
      const product = productToArchive;
      setShowArchiveDialog(false);
      setProductToArchive(null);
      try {
        await archiveProduct(product.id);
        toast({
          title: "Product Archived",
          description: `"${product.name}" has been archived and removed from public view.`,
        });
      } catch (error) {
        console.error('Failed to archive product:', error);
        toast({ variant: 'destructive', title: 'Archive Failed', description: 'Something went wrong. Please try again.' });
      }
    }
  };

  const handleDeleteClick = (product: Product) => {
    setProductToDelete(product);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (productToDelete) {
      const product = productToDelete;
      setShowDeleteDialog(false);
      setProductToDelete(null);
      try {
        await deleteProduct(product.id);
        toast({
          title: "Product Deleted",
          description: `"${product.name}" has been permanently deleted.`,
        });
      } catch (error) {
        console.error('Failed to delete product:', error);
        toast({ variant: 'destructive', title: 'Delete Failed', description: 'Something went wrong. Please try again.' });
      }
    }
  };
  
  const filteredProducts = React.useMemo(() => {
    let tabFiltered = products;
    if (activeTab !== 'all') {
      tabFiltered = products.filter(p => p.status === activeTab);
    }
    if (searchQuery) {
        return tabFiltered.filter(p => 
            p.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }
    return tabFiltered;
  }, [products, activeTab, searchQuery]);

  if (!isInitialized) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-1/4" />
          <Skeleton className="h-4 w-1/2" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({length: 3}).map((_, i) => (
              <div key={i} className="flex items-center space-x-4">
                <Skeleton className="h-16 w-16" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="draft">Draft</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1">
                  <ListFilter className="h-3.5 w-3.5" />
                  <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
                    Filter
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Filter by</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked>
                  Active
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem>Draft</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem>
                  Archived
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline" className="h-8 gap-1">
              <File className="h-3.5 w-3.5" />
              <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
                Export
              </span>
            </Button>
            <Button size="sm" className="h-8 gap-1" asChild>
              <Link href="/sell">
                  <PlusCircle className="h-3.5 w-3.5" />
                  <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
                  Add Product
                  </span>
              </Link>
            </Button>
          </div>
        </div>
        <TabsContent value={activeTab}>
          <Card>
            <CardHeader>
              <CardTitle>Products</CardTitle>
              <CardDescription>
                Manage your products and view their sales performance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden w-[100px] sm:table-cell">
                      <span className="sr-only">Image</span>
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">
                      Price
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      Total Sales
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      Created at
                    </TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map(product => (
                    <TableRow key={product.id} className={cn(product.status === 'archived' && 'bg-muted/50')}>
                      <TableCell className="hidden sm:table-cell">
                        <Image
                          alt={product.name}
                          className="aspect-square rounded-md object-cover"
                          height="64"
                          src={product.image}
                          width="64"
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {product.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant={product.status === 'active' ? 'outline' : 'secondary'} className="capitalize">{product.status}</Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        ${Number(product.price).toFixed(2)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        25
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {product.createdAt ? format(new Date(product.createdAt), "yyyy-MM-dd h:mm a") : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              aria-haspopup="true"
                              size="icon"
                              variant="ghost"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Toggle menu</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem asChild>
                               <Link href={`/edit-product?id=${product.id}`} className="flex items-center cursor-pointer">
                                 <Edit className="mr-2 h-4 w-4" />
                                 Edit
                               </Link>
                            </DropdownMenuItem>
                            {product.status !== 'archived' ? (
                                <DropdownMenuItem
                                onSelect={() => handleArchiveClick(product)}
                                >
                                    <Archive className="mr-2 h-4 w-4" />
                                    Archive
                                </DropdownMenuItem>
                            ) : (
                                <DropdownMenuItem
                                className="text-destructive"
                                onSelect={() => handleDeleteClick(product)}
                                >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete Permanently
                                </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
            <CardFooter>
              <div className="text-xs text-muted-foreground">
                Showing <strong>1-{filteredProducts.length}</strong> of <strong>{filteredProducts.length}</strong>{' '}
                products
              </div>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
      <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to archive this product?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will hide the product from all public listings. 
              You can find and restore it from the "Archived" tab later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setProductToArchive(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

       <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to permanently delete this product?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The product will be removed forever.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setProductToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
