
'use client';

import { RegisterDialog } from "@/components/auth/register-dialog";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
    const router = useRouter();

    return <RegisterDialog open={true} onOpenChange={() => router.back()} />;
}
