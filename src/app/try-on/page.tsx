
'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Upload, Shirt, Sparkles, Loader2, User as UserIcon, ArrowDown, Text } from 'lucide-react';
import { virtualTryOn, type VirtualTryOnOutput } from '@/ai/flows/virtual-try-on';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { app } from '@/lib/firebase';
import { LoginDialog } from '@/components/auth/login-dialog';
import { RegisterDialog } from '@/components/auth/register-dialog';
import { Textarea } from '@/components/ui/textarea';

export default function VirtualTryOnPage() {
    const { toast } = useToast();
    
    const [personImageFile, setPersonImageFile] = useState<File | null>(null);
    const [personImagePreview, setPersonImagePreview] = useState<string | null>(null);

    const [clothingImageFile, setClothingImageFile] = useState<File | null>(null);
    const [clothingImagePreview, setClothingImagePreview] = useState<string | null>(null);

    const [description, setDescription] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<VirtualTryOnOutput | null>(null);

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
    
    const handleImageChange = (
      e: React.ChangeEvent<HTMLInputElement>, 
      setFile: React.Dispatch<React.SetStateAction<File | null>>,
      setPreview: React.Dispatch<React.SetStateAction<string | null>>
    ) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const dataUri = reader.result as string;
                setFile(file);
                setPreview(dataUri);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async () => {
        if (!user) {
            setLoginOpen(true);
            return;
        }
        if (!personImagePreview || !clothingImagePreview) {
            toast({
                variant: 'destructive',
                title: 'Information Missing',
                description: 'Please upload a photo of yourself and a photo of the clothing item.',
            });
            return;
        }
        setIsLoading(true);
        setResult(null);
        try {
            const tryOnResponse = await virtualTryOn({
                personPhotoDataUri: personImagePreview,
                clothingPhotoDataUri: clothingImagePreview,
                description: description,
            });
            setResult(tryOnResponse);

        } catch (error) {
            console.error(error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to generate the try-on image. Please try again.',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const ImageUploader = ({ id, label, icon, preview, onChange, description }: { id: string, label: string, icon: React.ReactNode, preview: string | null, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, description: string }) => (
        <Card className="flex-1 flex flex-col w-full">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">{icon} {label}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col">
                <label htmlFor={id} className="relative block w-full h-80 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary transition-colors flex items-center justify-center text-muted-foreground bg-muted/20">
                    {preview ? (
                        <Image src={preview} alt="Preview" layout="fill" className="object-contain rounded-lg p-2" />
                    ) : (
                    <div className="flex flex-col items-center p-4 text-center">
                        <Upload className="h-10 w-10 mb-2" />
                        <span>Click to upload</span>
                        <span className="text-xs">PNG, JPG, WEBP</span>
                    </div>
                    )}
                </label>
                <Input id={id} type="file" className="sr-only" accept="image/*" onChange={onChange} />
            </CardContent>
        </Card>
    );
    
    const isButtonDisabled = isLoading || !personImagePreview || !clothingImagePreview;

    return (
    <>
        <div className="container mx-auto max-w-7xl py-8 px-4 md:py-12">
            <div className="text-center mb-12">
                <Sparkles className="mx-auto h-16 w-16 mb-4 text-accent" />
                <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight font-headline text-primary">Virtual Try-On</h1>
                <p className="mt-4 text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
                See how it looks. Upload your photo and a clothing item, and let our AI generate a try-on image for you.
                </p>
            </div>

            <div className="flex flex-col gap-8">
                <div className="flex flex-col md:flex-row gap-8 items-start">
                    <ImageUploader 
                        id="person-upload"
                        label="Your Photo"
                        description="Upload a clear, full-body photo."
                        icon={<UserIcon className="h-6 w-6" />}
                        preview={personImagePreview}
                        onChange={(e) => handleImageChange(e, setPersonImageFile, setPersonImagePreview)}
                    />
                   <ImageUploader 
                        id="clothing-upload"
                        label="Clothing Photo"
                        description="Upload a photo of a clothing item."
                        icon={<Shirt className="h-6 w-6" />}
                        preview={clothingImagePreview}
                        onChange={(e) => handleImageChange(e, setClothingImageFile, setClothingImagePreview)}
                    />
                </div>
                
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Text className="h-6 w-6" /> Describe Your Vision</CardTitle>
                        <CardDescription>Give the AI directions to create the perfect image. (Optional)</CardDescription>
                    </CardHeader>
                    <CardContent>
                         <Textarea
                            placeholder="e.g., 'Make the background a cityscape at night', 'I want a more candid, laughing pose', 'Show the person walking down a street'"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="min-h-[100px] text-base"
                        />
                    </CardContent>
                </Card>

                <div className="flex justify-center">
                    <Button onClick={handleSubmit} size="lg" className="text-lg h-14 px-12" disabled={isButtonDisabled}>
                        {isLoading ? (
                            <>
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                Generate Try-On
                                <ArrowDown className="ml-2 h-5 w-5" />
                            </>
                        )}
                    </Button>
                </div>
                
                <Card>
                    <CardHeader>
                        <CardTitle className="text-center text-2xl">Generated Image</CardTitle>
                        <CardDescription className="text-center">Your AI-powered try-on result will appear below.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col justify-center items-center">
                        <div className="w-full max-w-lg aspect-[3/4] border rounded-lg flex items-center justify-center bg-muted/20 overflow-hidden">
                            {isLoading ? (
                                <div className="flex flex-col items-center text-muted-foreground">
                                    <Loader2 className="h-10 w-10 animate-spin mb-4" />
                                    <p>Generating your new look...</p>
                                </div>
                            ) : result ? (
                                <Image src={result.tryOnImageDataUri} alt="Virtual try-on result" width={600} height={800} className="object-cover w-full h-full" data-ai-hint="fashion model" />
                            ) : (
                                <p className="text-muted-foreground p-4 text-center">Your result will appear here.</p>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
        <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={openRegister} />
        <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={openLogin} />
    </>
  );
}
