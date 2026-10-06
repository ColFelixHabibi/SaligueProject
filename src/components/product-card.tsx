
'use client';

import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Heart, MessageCircle, Share2, Send, ThumbsUp, ThumbsDown, Wand2 } from 'lucide-react';
import type { Product } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWishlist } from '@/hooks/use-wishlist';
import Link from 'next/link';
import { Separator } from '@/components/ui/separator';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { app } from '@/lib/firebase';
import { LoginDialog } from './auth/login-dialog';
import { RegisterDialog } from './auth/register-dialog';
import { categoryLabel } from '@/lib/categories';
import { absoluteUrl } from '@/lib/paths';
import { productHref } from '@/lib/links';


interface ProductCardProps {
  product: Product;
  className?: string;
}

type Comment = {
  id: number;
  user: string;
  avatar: string;
  text: string;
  likes: number;
  isLiked: boolean;
  dislikes: number;
  isDisliked: boolean;
  replies: Comment[];
};

const initialComments: Comment[] = [];

export default function ProductCard({ product, className }: ProductCardProps) {
  const aiHint = product.name.toLowerCase().split(' ').slice(0, 2).join(' ');
  const { wishlistItems, addToWishlist, removeFromWishlist } = useWishlist();
  const isWishlisted = wishlistItems.some((item) => item.id === product.id);
  const { toast } = useToast();

  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');

  const [user, setUser] = useState<User | null>(null);
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

  const handleWishlistToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!user) {
        setLoginOpen(true);
        return;
    }

    try {
      if (isWishlisted) {
        await removeFromWishlist(product.id);
        toast({
          title: 'Removed from My Saligue',
          description: `${product.name} has been removed from your wishlist.`,
        });
      } else {
        await addToWishlist(product);
        toast({
          title: 'Added to My Saligue',
          description: `${product.name} has been added to your wishlist.`,
        });
      }
    } catch (error) {
      console.error('Failed to update wishlist:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not update your wishlist. Please try again.' });
    }
  };
  
  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const productUrl = absoluteUrl(productHref(product));
    const shareData = {
      title: product.name,
      text: `Check out this ${product.name} on Saligue!`,
      url: productUrl,
    };

    try {
      if (!navigator.share) {
        throw new Error('Web Share API not available.');
      }
      const response = await fetch(product.image);
      const blob = await response.blob();
      const file = new File([blob], `${product.name.replace(/\s/g, '_')}.jpg`, { type: 'image/jpeg' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ ...shareData, files: [file] });
      } else {
        await navigator.share(shareData);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // User cancelled the share, do nothing.
        return;
      }
      
      // Fallback to copying the link
      try {
        await navigator.clipboard.writeText(productUrl);
        toast({
          title: 'Link Copied!',
          description: 'Sharing failed, but we copied the link for you.',
        });
      } catch (copyError) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Could not share or copy the product link.',
        });
      }
    }
  };

  const findCommentAndMutate = (
    commentsList: Comment[],
    commentId: number,
    mutator: (comment: Comment) => void
  ): boolean => {
    for (const comment of commentsList) {
      if (comment.id === commentId) {
        mutator(comment);
        return true;
      }
      if (comment.replies && findCommentAndMutate(comment.replies, commentId, mutator)) {
        return true;
      }
    }
    return false;
  };


  const handlePostComment = (e: React.FormEvent, parentId: number | null = null, text: string) => {
    e.preventDefault();
    if (!user) {
        setLoginOpen(true);
        return;
    }
    if (!text.trim()) return;

    const newId = Date.now();
    const commentToAdd: Comment = {
      id: newId,
      user: 'You',
      avatar: `https://i.pravatar.cc/150?u=${newId}`,
      text: text,
      likes: 0,
      isLiked: false,
      dislikes: 0,
      isDisliked: false,
      replies: [],
    };
    
    setComments(prev => {
        const newComments = JSON.parse(JSON.stringify(prev));
        if (parentId === null) {
            newComments.push(commentToAdd);
        } else {
            findCommentAndMutate(newComments, parentId, (comment) => {
                comment.replies.push(commentToAdd);
            });
        }
        return newComments;
    });

    if (parentId) {
        setReplyText('');
        setReplyingTo(null);
    } else {
        setNewComment('');
    }

    toast({
      title: 'Comment Posted!',
      description: 'Your comment has been added.',
    });
  };
  
  const toggleCommentReaction = (commentId: number, reaction: 'like' | 'dislike') => {
      if (!user) {
        setLoginOpen(true);
        return;
      }
      setComments(currentComments => {
          const newComments = JSON.parse(JSON.stringify(currentComments));
          findCommentAndMutate(newComments, commentId, (comment) => {
              if (reaction === 'like') {
                  const wasLiked = comment.isLiked;
                  comment.likes += wasLiked ? -1 : 1;
                  comment.isLiked = !wasLiked;
                  if (comment.isLiked && comment.isDisliked) {
                      comment.dislikes -= 1;
                      comment.isDisliked = false;
                  }
              } else { // dislike
                  const wasDisliked = comment.isDisliked;
                  comment.dislikes += wasDisliked ? -1 : 1;
                  comment.isDisliked = !wasDisliked;
                  if (comment.isDisliked && comment.isLiked) {
                      comment.likes -= 1;
                      comment.isLiked = false;
                  }
              }
          });
          return newComments;
      });
  };

  const CommentList = ({ comments, isReply = false }: { comments: Comment[], isReply?: boolean }) => (
    <div className={cn("space-y-4", isReply && "pl-6 pt-4 border-l")}>
        {comments.map((comment) => (
            <div key={comment.id}>
                <CommentItem comment={comment} />
                {replyingTo === comment.id && (
                    <form onSubmit={(e) => handlePostComment(e, comment.id, replyText)} className="flex w-full items-center space-x-2 pl-12 pt-2">
                        <Input placeholder={`Replying to ${comment.user}...`} value={replyText} onChange={(e) => setReplyText(e.target.value)} autoComplete="off" className="h-9" disabled={!user} />
                        <Button type="submit" size="sm" disabled={!user}>Reply</Button>
                    </form>
                )}
                {comment.replies.length > 0 && <CommentList comments={comment.replies} isReply={true} />}
            </div>
        ))}
    </div>
  );

  const CommentItem = ({ comment }: { comment: Comment }) => (
    <div className="flex items-start space-x-3">
        <Avatar className="h-9 w-9">
            <AvatarImage src={comment.avatar} />
            <AvatarFallback>{comment.user.charAt(0)}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
            <p className="font-semibold text-sm">{comment.user}</p>
            <p className="text-sm text-foreground/90">{comment.text}</p>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                <button 
                  className={cn("flex items-center gap-1 hover:text-primary", { 'text-primary': comment.isLiked })}
                  onClick={() => toggleCommentReaction(comment.id, 'like')}
                >
                    <ThumbsUp className="h-3.5 w-3.5" />
                    <span>{comment.likes > 0 ? comment.likes : 'Like'}</span>
                </button>
                <button 
                  className={cn("flex items-center gap-1 hover:text-destructive", { 'text-destructive': comment.isDisliked })}
                  onClick={() => toggleCommentReaction(comment.id, 'dislike')}
                >
                    <ThumbsDown className="h-3.5 w-3.5" />
                    <span>{comment.dislikes > 0 ? comment.dislikes : ''}</span>
                </button>
                <button className="hover:text-primary" onClick={() => {
                     if (!user) {
                        setLoginOpen(true);
                        return;
                    }
                    setReplyingTo(replyingTo === comment.id ? null : comment.id)
                }}>
                    {replyingTo === comment.id ? 'Cancel' : 'Reply'}
                </button>
            </div>
        </div>
    </div>
  );
  
  return (
    <>
      <Card className={cn('overflow-hidden group w-full', className)}>
        <Sheet>
            <div className="relative">
              <Link href={productHref(product)} className="block cursor-pointer">
                <Image
                  src={product.image}
                  alt={product.name}
                  width={400}
                  height={500}
                  className="object-cover w-full h-80 transition-transform duration-300 group-hover:scale-105"
                  data-ai-hint={aiHint}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
                {product.official && (
                  <span className="absolute right-2 top-2 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow">
                    INDECIANA
                  </span>
                )}
              </Link>
              
              <div className="absolute top-1/2 -translate-y-1/2 left-3 flex flex-col space-y-3">
                 <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleWishlistToggle}
                    className="h-10 w-10 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-full"
                >
                    <Heart
                    className={cn('h-6 w-6 text-white', {
                        'fill-red-500 text-red-500': isWishlisted,
                    })}
                    />
                    <span className="sr-only">Add to wishlist</span>
                </Button>
                  
                  <SheetTrigger asChild>
                      <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-10 w-10 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-full"
                      >
                          <MessageCircle className="h-6 w-6 text-white" />
                      </Button>
                  </SheetTrigger>
                  
                <Button
                    variant="ghost"
                    size="icon"
                    asChild
                    className="h-10 w-10 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-full"
                >
                  <Link href={`/mirror?item=${product.id}`}>
                    <Wand2 className="h-6 w-6 text-white" />
                    <span className="sr-only">Try it on</span>
                  </Link>
                </Button>

                <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={handleShare} 
                    className="h-10 w-10 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-full"
                >
                  <Share2 className="h-6 w-6 text-white" />
                </Button>
              </div>
            </div>
            <CardContent className="p-4 bg-card">
              <Link href={productHref(product)} className="cursor-pointer">
                <h3 className="text-base font-semibold truncate text-foreground hover:underline">{product.name}</h3>
              </Link>
              <p className="text-sm text-muted-foreground">{product.official ? 'Recommended by INDECIANA' : product.shop?.name ?? product.seller}</p>
              <div className="flex items-center justify-between mt-3">
                <p className="text-lg font-bold text-primary">${Number(product.price).toFixed(2)}</p>
                <Badge variant="outline">{categoryLabel(product.category)}</Badge>
              </div>
            </CardContent>
          <SheetContent side="bottom" className="h-[85vh] flex flex-col rounded-t-2xl p-0">
            <SheetHeader className="p-4 border-b text-left">
               <SheetTitle>Comments</SheetTitle>
               <SheetDescription>
                  Join the conversation about {product.name}.
               </SheetDescription>
            </SheetHeader>
            <ScrollArea className="flex-1 w-full">
                <div className="p-4">
                  {comments.length > 0 ? (
                    <CommentList comments={comments} />
                   ) : (
                    <div className="text-center text-muted-foreground py-10">
                      <p>No comments yet. Be the first to comment!</p>
                    </div>
                   )}
                </div>
            </ScrollArea>
            <Separator />
            <div className="p-4 bg-card">
                <form onSubmit={(e) => handlePostComment(e, null, newComment)} className="flex w-full items-center space-x-2">
                    <Input 
                        id="comment" 
                        placeholder={user ? "Add a comment..." : "Log in to comment"}
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        autoComplete="off"
                        className="h-11"
                        disabled={!user}
                    />
                    <Button type="submit" size="icon" className="h-11 w-11" disabled={!user}>
                        <Send className="h-5 w-5" />
                    </Button>
                </form>
            </div>
          </SheetContent>
        </Sheet>
      </Card>
      
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={openRegister} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={openLogin} />
    </>
  );
}
