
'use client';

import { LoginDialog } from "@/components/auth/login-dialog";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  
  return <LoginDialog open={true} onOpenChange={() => router.back()} />;
}
